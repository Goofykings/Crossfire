import { Careers, careerIdentity } from './careers';
import { advanceChallenges, type ChallengeEvent, type CareerView } from '../../shared/challenges';
import { GRENADE_SMOKE_MS } from '../../shared/grenades';
import { EnvironmentSimulation, ENVIRONMENT, validPropState, type PropState, type EnvironmentFrame } from '../../shared/environment';
import { DurableObject } from 'cloudflare:workers';
import { FIXED_DT, PLAYER_MAX_HEALTH } from '../../src/config/constants';
import { NO_INTENT, PlayerController, type ControllerState } from '../../src/player/PlayerController';
import { HEARTBEAT_TIMEOUT_MS, NETWORK_HZ, PROTOCOL_VERSION, PUBLIC_ROOM, RESPAWN_DELAY_MS, SESSION_GRACE_MS, parseClientMessage, validMotion, validGun,
  type CombatState, type InputFrame, type PlayerState, type ServerMessage, type Snapshot, type ShotResult } from '../../shared/protocol';
import { WORLDS, MOVEMENT } from './world';
import { mapRound, type MapSchedule, type MapRound } from '../../shared/maps';
import { applySpread, damageAt, Weapon, WEAPONS, type WeaponId } from '../../src/weapons/Weapon';
import { DamageSystem } from '../../src/game/Damage';
import { NO_COMBAT, rayPlayer, roundMode, teammates, type PlayerTeam, type MatchMode } from '../../shared/combat';
import { normalizeUsername } from '../../shared/username';
import { regenerate, REGEN_DELAY_MS } from './health';
import { selectSpawn } from '../../shared/spawns';
import { COMBO_WINDOW_MS, awardElimination, expireCombo, resetCombo, finalizeRound, type RoundLedger, type RoundResult, type ScoreState } from '../../shared/scoring';
import { GRENADE, advanceGrenade, blastDamage, throwGrenade, type GrenadeState, type GrenadeExplosion } from '../../shared/grenades';
import { validGrenade, validExplosion } from '../../shared/protocol';

interface Bindings {
  ROOM: DurableObjectNamespace<PublicRoom>;
  ALLOWED_ORIGINS: string;
  SESSION_GRACE_MS: string;
  HEARTBEAT_TIMEOUT_MS: string;
  MATCH_MODE?: string;
  NETWORK_DEBUG?: string;
  COMBO_WINDOW_MS?: string;
  RELEASE_SHA?: string;
}
interface Session extends ScoreState {
  profileId?: string;
  participation?: { roundId: number; firstSpawn: number; abandoned: boolean };
  crouchHeld?: boolean;
  revision: number;
  grenades: number;
  lastPlayedRound: number | null;
  lastPlayedTeam: PlayerTeam;
  roundId: number;
  alive: boolean;
  health: number;
  regenAt: number | null;
  team: PlayerTeam;
  combat: CombatState;
  life: number;
  weapon: WeaponId | null;
  kills: number;
  deaths: number;
  death: import('../../shared/protocol').Elimination | null;
  id: string;
  name: string;
  token: string;
  generation: number;
  motion: ControllerState;
  ack: number;
  lastSeen: number;
  expiresAt: number;
}
interface Attachment { openedAt: number; session?: Session }
interface Entry {
  session: Session;
  controller: PlayerController;
  queue: InputFrame[];
  received: number;
  socket?: WebSocket;
  lastSeen: number;
  rateAt: number;
  rateCount: number;
  gun: Weapon | null;
  leanHeld: -1 | 0 | 1;
  crouchHeld: boolean;
  lastChatAt: number;
}

const positive = (s: string, fallback: number) => Number.isFinite(+s) && +s > 0 ? +s : fallback;
const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'crossfire-multiplayer', stage: 2, protocol: PROTOCOL_VERSION,
        room: PUBLIC_ROOM, release: env.RELEASE_SHA ?? 'local' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/profile') {
      const origin = request.headers.get('Origin');
      if (!origin || !env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).includes(origin)) return new Response('Origin denied', { status:403 });
      const headers = { 'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Allow-Headers':'Authorization, Content-Type', 'Cache-Control':'no-store', 'Vary':'Origin' };
      if (url.search) return new Response('Use /profile without query parameters', { status:400, headers });
      if (request.method === 'OPTIONS') return new Response(null, { status:204, headers });
      // Validate before entering the shared room: a slow POST body must never
      // hold its concurrency gate and pause everyone's simulation.
      if (request.method === 'POST') {
        if (request.headers.has('Authorization') || (request.headers.get('Content-Length') && request.headers.get('Content-Length') !== '0'))
          return Response.json({error:'Profile creation accepts no player data.'},{status:400,headers});
        if (request.body) {
          const reader=request.body.getReader();let timeout:ReturnType<typeof setTimeout>|undefined;
          try {
            const first=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Body timeout')),1000);})]);
            if(first.value?.byteLength)return Response.json({error:'Profile creation accepts no player data.'},{status:400,headers});
          } catch { return Response.json({error:'An empty request body is required.'},{status:400,headers}); }
          finally {if(timeout!==undefined)clearTimeout(timeout);void reader.cancel().catch(()=>{});}
        }
        request=new Request(request.url,{method:'POST',headers:request.headers});
      }
      const response = await env.ROOM.getByName(PUBLIC_ROOM).fetch(request);
      return new Response(response.body, { status:response.status, headers:{ ...headers, 'Content-Type':'application/json' } });
    }
    if (url.pathname !== '/ws' && url.pathname !== '/presence') return new Response('Not found', { status: 404 });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const origin = request.headers.get('Origin');
    if ((origin || url.pathname === '/ws') && (!origin || !env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(origin))) return new Response('Origin denied', { status: 403 });
    if (url.pathname === '/presence') {
      const response = await env.ROOM.getByName(PUBLIC_ROOM).fetch(request);
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json',
        'Cache-Control': 'no-store', 'Vary': 'Origin', ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) } });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
    if (url.search) return new Response('Use the canonical public room without query parameters', { status: 400 });
    return env.ROOM.getByName(PUBLIC_ROOM).fetch(request);
  },
};

export class PublicRoom extends DurableObject<Bindings> {
  private readonly players = new Map<string, Entry>();
  private readonly careers = new Careers(this.ctx.storage, () => new Set([...this.players.values()].flatMap(e => e.session.profileId ? [e.session.profileId] : [])));
  private readonly careerSent = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = Date.now();
  private accumulator = 0;
  private lastSave = 0;
  private schedule!: MapSchedule;
  private round!: MapRound;
  private activeMap!: typeof WORLDS[keyof typeof WORLDS];
  private scores = { roundId: -1, blue: 0, red: 0 };
  private ledger!: RoundLedger;
  private lastResult: RoundResult | null = null;
  private readonly damage = new DamageSystem();
  private environment!:EnvironmentSimulation;
  private environmentSeq=0;
  private environmentSent=0;
  private environmentUpdated=Date.now();
  private grenades: GrenadeState[] = [];
  private explosions: GrenadeExplosion[] = [];
  private tickBusy = false;
  private deferred: ServerMessage[] | null = null;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.schedule = await ctx.storage.get<MapSchedule>('map-schedule') ?? { epoch: Date.now(), seed: crypto.getRandomValues(new Uint32Array(1))[0] };
      await ctx.storage.put('map-schedule', this.schedule);
      this.round = mapRound(this.schedule, Date.now());
      this.activeMap = WORLDS[this.round.mapId];
      const scores = await ctx.storage.get<typeof this.scores>('team-scores');
      const ledger = await ctx.storage.get<RoundLedger>('round-ledger');
      this.lastResult = await ctx.storage.get<RoundResult>('round-result') ?? null;
      if (ledger && ledger.roundId < this.round.id) this.lastResult = finalizeRound(ledger,
        scores?.roundId === ledger.roundId ? scores : { blue: 0, red: 0 });
      this.ledger = ledger?.roundId === this.round.id ? ledger : this.emptyLedger();
      if (scores?.roundId === this.round.id) this.scores = scores;
      else this.scores.roundId = this.round.id;
      this.environment=new EnvironmentSimulation(this.activeMap.environment,this.activeMap.world);
      const props=await ctx.storage.get<{roundId:number;mapVersion?:string;seq:number;states:PropState[]}>('environment');
      if(props?.roundId===this.round.id){
        if(Number.isSafeInteger(props.seq)&&props.seq>=0)this.environmentSeq=props.seq;
        // Old basket geometry used a higher floor. Restoring its sleeping poses
        // into a revised map would leave fruit floating above the new container.
        if(props.mapVersion===this.activeMap.revision&&props.states.every(validPropState))this.environment.restore(props.states);
      }
      const stored = await ctx.storage.get<Session[]>('sessions') ?? [];
      const attachments = ctx.getWebSockets().map(s => (s.deserializeAttachment() as Attachment)?.session);
      await Promise.all([...new Set([...stored, ...attachments].flatMap(s => s?.profileId ? [s.profileId] : []))].map(id => this.careers.load(id)));
      this.grenades = ((await ctx.storage.get<unknown[]>('grenades')) ?? []).filter(validGrenade).filter(g=>g.roundId===this.round.id);
      this.explosions = ((await ctx.storage.get<unknown[]>('explosions')) ?? []).filter(validExplosion).filter(e=>e.roundId===this.round.id&&Date.now()-e.at<GRENADE_SMOKE_MS);
      for (const s of stored) {
        // An unclean restart is still resumable only for the bounded grace window.
        if (!s.expiresAt) s.expiresAt = (s.lastSeen ?? Date.now()) + this.grace;
        if (s.expiresAt > Date.now()) this.players.set(s.id, this.entry(s));
      }
      for (const socket of ctx.getWebSockets()) {
        const a = socket.deserializeAttachment() as Attachment;
        if (!a?.session) continue;
        let s = a.session;
        const existing = this.players.get(s.id);
        if (existing && existing.session.generation > s.generation) continue;
        // A committed grenade transaction can be newer than the socket's last
        // attachment if eviction occurs between the atomic put and attachment.
        if (existing && existing.session.generation === s.generation && existing.session.revision > (s.revision ?? 0)) s=existing.session;
        s.expiresAt = 0;
        const e = this.entry(s);
        e.lastSeen = a.openedAt;
        e.socket = socket;
        this.players.set(s.id, e);
      }
      if (ledger && ledger.roundId < this.round.id && this.lastResult) this.finishCareerRound(this.lastResult);
      this.trace('restore', { sockets: ctx.getWebSockets().length, sessions: this.players.size });
      this.prune();
      await this.persist();
      this.start();
    });
  }

  private get grace(): number { return positive(this.env.SESSION_GRACE_MS, SESSION_GRACE_MS); }
  private get timeout(): number { return positive(this.env.HEARTBEAT_TIMEOUT_MS, HEARTBEAT_TIMEOUT_MS); }
  private trace(event: string, detail: Record<string, unknown> = {}): void {
    if (this.env.NETWORK_DEBUG === 'true') console.log(JSON.stringify({ service: 'crossfire-network', at: Date.now(), event, ...detail }));
  }
  private get mode(): MatchMode {
    return this.env.MATCH_MODE === 'ffa' || this.env.MATCH_MODE === 'teams' ? this.env.MATCH_MODE : roundMode(this.schedule.seed, this.round.id);
  }
  private chooseTeam(): PlayerTeam {
    if (this.mode !== 'teams') return null;
    const all = [...this.players.values()];
    return all.filter((p) => p.session.team === 'blue').length <= all.filter((p) => p.session.team === 'red').length ? 'blue' : 'red';
  }

  private entry(session: Session): Entry {
    session.revision ??= 0;
    session.grenades ??= 0; // Never grant a fresh grenade to an already active legacy life.
    // Migrate the movement-only records without treating them as approved spawns.
    session.alive ??= false;
    session.life ??= 0;
    session.weapon ??= null;
    session.kills ??= 0;
    session.deaths ??= 0;
    session.score ??= 0;
    session.comboCount ??= 0;
    session.comboUntil ??= null;
    session.lastPlayedRound ??= session.life > 0 ? session.roundId : null;
    session.lastPlayedTeam ??= session.team ?? null;
    session.death ??= null;
    if (session.death) session.death.award ??= null;
    if (session.alive) session.death = null;
    session.health ??= session.alive ? PLAYER_MAX_HEALTH : 0;
    // Older stored records have no damage timestamp: begin a conservative full
    // waiting period rather than granting health on migration.
    if (session.regenAt === undefined) session.regenAt = session.alive && session.health < PLAYER_MAX_HEALTH ? Date.now() + REGEN_DELAY_MS : null;
    session.combat ??= { gun: null, triggerHeld: false, reloadHeld: false, aimHeld: false, grenadeHeld: false };
    session.combat.grenadeHeld ??= false;
    session.team = this.mode === 'teams' ? session.team ?? this.chooseTeam() : null;
    // Stored protocol-v6 sessions have no lean state; keep their lives intact.
    if (session.motion && session.motion.lean === undefined) session.motion.lean = 0;
    const controller = new PlayerController(this.activeMap.world);
    const changedRound = session.roundId !== this.round.id;
    if (changedRound || !validMotion(session.motion)) {
      session.roundId = this.round.id;
      session.alive = false;
      session.health = 0;
      session.regenAt = null;
      session.combat = { gun: null, triggerHeld: false, reloadHeld: false, aimHeld: false, grenadeHeld: false };
      session.weapon = null;
      session.grenades = 0;
      if (!session.death || Date.now() >= session.death.respawnAt) session.death = null;
      if (changedRound) session.kills = session.deaths = 0;
      if (changedRound) { session.score = 0; resetCombo(session); }
      session.motion = controller.capture();
    } else controller.restore(session.motion);
    regenerate(session, Date.now());
    expireCombo(session, Date.now());
    const stats = WEAPONS.find((w) => w.id === session.weapon);
    const gun = stats ? new Weapon(stats) : null;
    if (gun && validGun(session.combat.gun)) gun.restore(session.combat.gun);
    return { session, controller, gun, queue: [], received: session.ack, lastSeen: Date.now(), rateAt: Date.now(), rateCount: 0, leanHeld: 0, crouchHeld: session.crouchHeld??false, lastChatAt: 0 };
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureRound();
    if (new URL(request.url).pathname === '/profile') return this.ctx.blockConcurrencyWhile(() => this.careers.http(request));
    if (new URL(request.url).pathname === '/presence') {
      return Response.json({ room: PUBLIC_ROOM, online: this.connected().length });
    }
    if (this.ctx.getWebSockets().length >= 24) return new Response('Room capacity reached', { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ openedAt: Date.now() } satisfies Attachment);
    this.ctx.acceptWebSocket(server);
    this.trace('open', { sockets: this.ctx.getWebSockets().length });
    this.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  private start(): void {
    if (this.timer) return;
    this.environmentUpdated=Date.now();
    if (!this.simulationNeeded()) { void this.scheduleCleanup(); return; }
    // A batch contains input collected since the preceding network send. Preserve that
    // elapsed time when an idle simulation resumes, rather than losing a tick per batch.
    this.lastTick = Math.max(this.lastTick, Date.now() - 100);
    this.timer = setInterval(() => this.tick(), 1000 / NETWORK_HZ);
  }

  private simulationNeeded(): boolean {
    return this.environment.active>0 || this.grenades.length>0 || [...this.players.values()].some((e) => e.socket && e.session.alive && (e.queue.length > 0 || !e.controller.grounded
      || (e.controller.crouch !== Number(e.crouchHeld) && (e.crouchHeld || this.activeMap.world.ceilingHeight(
          e.controller.position.x, e.controller.position.z, MOVEMENT.radius * .95,
          e.controller.position.y + MOVEMENT.stepHeight + .01) >= e.controller.position.y + MOVEMENT.standHeight))
      || e.controller.sliding || e.controller.slideCooldown > 0
      || e.gun?.simulating
      || e.session.regenAt !== null
      || e.session.comboCount > 0
      || Math.hypot(e.controller.velocity.x, e.controller.velocity.y, e.controller.velocity.z) > 0.001));
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try { socket.send(JSON.stringify(message)); } catch { void this.disconnect(socket); }
  }

  private error(socket: WebSocket, code: string, message: string, fatal = false): void {
    this.trace('protocol_error', { id: this.current(socket)?.session.id, code, fatal });
    this.send(socket, { v: PROTOCOL_VERSION, type: 'error', code, message, fatal });
    if (fatal) { void this.disconnect(socket); socket.close(1008, code); }
  }

  private current(socket: WebSocket): Entry | undefined {
    const a = socket.deserializeAttachment() as Attachment;
    const e = a?.session ? this.players.get(a.session.id) : undefined;
    return e?.socket === socket ? e : undefined;
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    this.ensureRound();
    if (typeof raw !== 'string') { this.error(socket, 'invalid_message', 'Expected a JSON message', true); return; }
    const message = parseClientMessage(raw);
    if (!message) { this.error(socket, 'invalid_message', 'Invalid protocol message', true); return; }
    const e = this.current(socket);
    if (message.type === 'join') {
      if (e) { this.error(socket, 'already_joined', 'Already joined'); return; }
      await this.join(socket, message.name, message.resumeToken, message.profileToken);
      return;
    }
    if (!e) { this.error(socket, 'join_required', 'Join before sending input', true); return; }
    const now = Date.now();
    if (now - e.rateAt >= 1000) { e.rateAt = now; e.rateCount = 0; }
    if (++e.rateCount > 80) { this.error(socket, 'rate_limit', 'Too many messages', true); return; }
    e.lastSeen = now;
    if ((message.type === 'input' || message.type === 'spawn') && message.roundId !== this.round.id) {
      this.error(socket, 'round_changed', 'The map changed. Wait for the new map to load.');
      this.send(socket, { v: PROTOCOL_VERSION, type: 'snapshot', snapshot: this.snapshot() });
      return;
    }
    if (message.type === 'leave') {
      await this.disconnect(socket, true);
      socket.close(1000, 'left');
    } else if (message.type === 'chat') {
      if (now - e.lastChatAt < 750) { this.error(socket, 'chat_rate', 'Wait before sending another message'); return; }
      e.lastChatAt = now;
      this.publish({ v: PROTOCOL_VERSION, type: 'chat', id: e.session.id, name: e.session.name, text: message.text.trim() });
    } else if (message.type === 'ping') {
      this.trace('heartbeat', { id: e.session.id, sentAt: message.at, receivedAt: now, lastSeen: e.lastSeen });
      this.attach(e);
      this.send(socket, { v: PROTOCOL_VERSION, type: 'pong', at: message.at, serverTime: now });
      this.broadcast();
      await this.scheduleCleanup();
    } else if (message.type === 'spawn') {
      if (message.mapVersion !== this.activeMap.revision) { this.error(socket, 'map_mismatch', 'Client and server map assets differ', true); return; }
      if (e.session.alive) { this.error(socket, 'already_spawned', 'Your weapon is locked until the next life'); return; }
      if (e.session.death && now < e.session.death.respawnAt) { this.error(socket, 'respawn_wait', 'Wait for the respawn countdown'); return; }
      const occupied = this.connected().filter((p) => p.session.alive);
      const spawn = selectSpawn(this.activeMap.layout, this.activeMap.world, occupied.map((p) => ({
        ...p.controller.position, eyeHeight: p.controller.eyeHeight,
        opponent: !teammates(this.mode, e.session.team, p.session.team),
      })));
      if (!spawn) { this.error(socket, 'spawn_busy', 'No clear spawn available. Try again.'); return; }
      e.controller.teleport({ x: spawn.pos[0], y: spawn.pos[1], z: spawn.pos[2] }, spawn.heading);
      e.leanHeld = 0;
      e.crouchHeld = false;
      e.session.grenades = GRENADE.perLife;
      e.session.alive = true;
      e.session.death = null;
      e.session.health = PLAYER_MAX_HEALTH;
      e.session.regenAt = null;
      if (e.session.participation?.roundId !== this.round.id) e.session.participation = { roundId:this.round.id, firstSpawn:now, abandoned:false };
      e.session.lastPlayedRound = this.round.id;
      e.session.lastPlayedTeam = e.session.team;
      e.gun = new Weapon(WEAPONS.find((w) => w.id === message.weapon)!);
      e.session.combat = { gun: e.gun.capture(), triggerHeld: false, reloadHeld: false, aimHeld: false, grenadeHeld: false };
      e.session.life++;
      e.session.weapon = message.weapon;
      e.queue.length = 0;
      e.received = e.session.ack;
      this.attach(e);
      await this.persist();
      this.send(socket, { v: PROTOCOL_VERSION, type: 'spawned', requestId: message.requestId, snapshot: this.snapshot(true) });
      this.broadcast();
      this.start();
    } else {
      if (!e.session.alive) { this.error(socket, 'not_spawned', 'Spawn before sending movement'); return; }
      if (message.mapVersion !== this.activeMap.revision) { this.error(socket, 'map_mismatch', 'Client and server map assets differ', true); return; }
      let seq = e.received;
      for (const frame of message.frames) {
        if (frame.seq <= seq || frame.seq > seq + 64) { this.error(socket, 'stale_input', 'Input sequence was replayed or skipped'); return; }
        seq = frame.seq;
      }
      if (e.queue.length + message.frames.length > 48) { this.error(socket, 'input_overflow', 'Input queue exceeded real-time budget', true); return; }
      e.queue.push(...message.frames);
      e.received = seq;
      this.start();
    }
  }

  private async join(socket: WebSocket, requested: string, resume?: string, profileToken?: string): Promise<void> {
    this.prune();
    let e = resume ? [...this.players.values()].find((p) => p.session.token === resume) : undefined;
    if (resume && !e) { this.error(socket, 'resume_expired', 'Session expired; join again', true); return; }
    const profileId = profileToken ? await careerIdentity(profileToken) : undefined;
    if (profileId && !await this.careers.load(profileId)) { this.error(socket, 'profile_invalid', 'Guest challenge credential is invalid. Reload to retry.', true); return; }
    if (e?.session.profileId && e.session.profileId !== profileId) { this.error(socket, 'profile_mismatch', 'This match session belongs to a different guest credential.', true); return; }
    // A persistent guest cannot farm challenges through overlapping player sessions.
    if (profileId && [...this.players.values()].some(p => p !== e && p.session.profileId === profileId && (p.socket || p.session.lastPlayedRound === this.round.id))) {
      this.error(socket, 'profile_in_use', 'This guest is already in the public match. Resume the original tab or wait for the next round.', true); return;
    }
    const resumed = !!e;
    const name = normalizeUsername(requested) ?? 'Player';
    if (!e) {
      if (this.players.size >= 16) { this.error(socket, 'room_full', 'Room capacity reached', true); return; }
      const controller = new PlayerController(this.activeMap.world);
      e = this.entry({ id: crypto.randomUUID(), name, token: token(), generation: 0, revision: 0, grenades: 0, motion: controller.capture(), ack: 0,
        roundId: this.round.id, alive: false, health: 0, regenAt: null, team: this.chooseTeam(), combat: { gun: null, triggerHeld: false, reloadHeld: false, aimHeld: false, grenadeHeld: false },
        life: 0, weapon: null, kills: 0, deaths: 0, death: null, score: 0, comboCount: 0, comboUntil: null,
        lastPlayedRound: null, lastPlayedTeam: null, lastSeen: Date.now(), expiresAt: 0 });
      this.players.set(e.session.id, e);
    }
    // A valid resume credential preserves the session, while display names remain editable.
    regenerate(e.session, Date.now());
    expireCombo(e.session, Date.now());
    e.session.profileId = profileId;
    e.session.name = name;
    const old = e.socket;
    e.socket = socket;
    e.session.generation++;
    e.session.expiresAt = 0;
    e.queue.length = 0;
    e.session.combat.triggerHeld = e.session.combat.reloadHeld = e.session.combat.aimHeld = false;
    e.session.combat.grenadeHeld = false;
    e.received = e.session.ack;
    e.lastSeen = Date.now();
    this.attach(e);
    // Publish the replacement generation before closing the old connection.
    this.trace('join', { id: e.session.id, resumed, generation: e.session.generation, replaced: !!old && old !== socket });
    if (old && old !== socket) old.close(4001, 'session_replaced');
    await this.persist();
    this.send(socket, { v: PROTOCOL_VERSION, type: 'welcome', selfId: e.session.id, resumeToken: e.session.token, resumed, snapshot: this.snapshot(true) });
    // The persisted session/resume credential is the once-only announcement marker.
    // Socket replacement, refresh, hibernation and round snapshots never replay it.
    if (!resumed) this.publish({ v: PROTOCOL_VERSION, type: 'system', kind: 'player_joined', id: `join:${e.session.id}`, name: e.session.name });
    this.broadcast();
    await this.scheduleCleanup();
    this.start();
  }

  private attach(e: Entry): void {
    e.session.crouchHeld=e.crouchHeld;
    e.session.motion = e.controller.capture();
    e.session.combat.gun = e.gun?.capture() ?? null;
    e.session.lastSeen = e.lastSeen;
    e.socket?.serializeAttachment({ openedAt: e.lastSeen, session: e.session } satisfies Attachment);
  }

  private environmentFrame(full:boolean,states=this.environment.capture()):EnvironmentFrame {
    return {roundId:this.round.id,mapVersion:this.activeMap.revision,seq:this.environmentSeq,at:Date.now(),full,states};
  }

  private snapshot(full=false): Snapshot {
    for (const e of this.players.values()) expireCombo(e.session, Date.now());
    const players: PlayerState[] = this.connected().map((e) => ({ id: e.session.id,
      grenades: e.session.grenades,
      score: e.session.score, comboCount: e.session.comboCount, comboUntil: e.session.comboUntil,
      lastPlayedRound: e.session.lastPlayedRound, lastPlayedTeam: e.session.lastPlayedTeam,
      name: e.session.name, motion: e.controller.capture(), ack: e.session.ack, alive: e.session.alive, life: e.session.life,
      health: e.session.health, combat: { ...e.session.combat, gun: e.gun?.capture() ?? null },
      weapon: e.session.weapon, kills: e.session.kills, deaths: e.session.deaths, team: e.session.team, death: e.session.death }));
    return { ...(full?{environment:this.environmentFrame(true)}:{}),grenades: this.grenades, explosions: this.explosions, result: this.lastResult, room: PUBLIC_ROOM, mapId: this.round.mapId, roundId: this.round.id, mapVersion: this.activeMap.revision, serverTime: Date.now(), players,
      match: { mode: this.mode, endsAt: this.round.endsAt, teamScores: this.mode === 'teams' ? { blue: this.scores.blue, red: this.scores.red } : null } };
  }

  private emptyLedger(): RoundLedger {
    return { roundId: this.round.id, mapId: this.round.mapId, mode: this.mode, endsAt: this.round.endsAt, players: {} };
  }
  private recordStanding(e: Entry): void {
    const s = e.session;
    if (s.lastPlayedRound !== this.round.id) return;
    this.ledger.players[s.id] = { id: s.id, name: s.name, team: s.lastPlayedTeam, score: s.score, kills: s.kills, deaths: s.deaths, weapon: s.weapon };
  }

  /** One canonical persisted schedule; clients never choose the public map. */
  private ensureRound(): void {
    const next = mapRound(this.schedule, Date.now());
    if (next.id === this.round.id) return;
    for (const e of this.players.values()) this.recordStanding(e);
    this.lastResult = finalizeRound(this.ledger, this.scores);
    this.finishCareerRound(this.lastResult);
    this.round = next;
    this.ledger = this.emptyLedger();
    this.activeMap = WORLDS[next.mapId];
    this.environment=new EnvironmentSimulation(this.activeMap.environment,this.activeMap.world);this.environmentSeq=0;this.environmentSent=0;
    this.scores = { roundId: next.id, blue: 0, red: 0 };
    this.accumulator = 0;
    this.grenades = [];this.explosions = [];
    this.lastTick = Date.now();
    for (const e of this.players.values()) {
      e.session.roundId = next.id;
      e.session.alive = false;
      e.session.health = 0;
      e.session.regenAt = null;
      e.session.combat = { gun: null, triggerHeld: false, reloadHeld: false, aimHeld: false, grenadeHeld: false };
      e.gun = null;
      e.session.weapon = null;
      e.session.grenades = 0;
      e.crouchHeld = false;
      if (!e.session.death || Date.now() >= e.session.death.respawnAt) e.session.death = null;
      e.session.kills = e.session.deaths = 0;
      e.session.score = 0;
      resetCombo(e.session);
      e.controller = new PlayerController(this.activeMap.world);
      e.queue.length = 0;
      e.received = e.session.ack;
      this.attach(e);
    }
    let team = 0;
    for (const e of [...this.players.values()].sort((a, b) => a.session.id.localeCompare(b.session.id))) {
      e.session.team = this.mode === 'teams' ? team++ % 2 ? 'red' : 'blue' : null;
      this.attach(e);
    }
    void this.persist();
    this.broadcast();
    void this.scheduleCleanup();
  }

  private connected(): Entry[] {
    return [...this.players.values()].filter((e) => e.socket?.readyState === WebSocket.OPEN && Date.now() - e.lastSeen <= this.timeout);
  }

  private broadcast(): void {
    if(this.deferred)return;
    const message: ServerMessage = { v: PROTOCOL_VERSION, type: 'snapshot', snapshot: this.snapshot() };
    for (const e of this.players.values()) if (e.socket) this.send(e.socket, message);
  }

  private publish(message: ServerMessage): void {
    if(this.deferred){this.deferred.push(message);return;}
    for (const e of this.connected()) this.send(e.socket!, message);
  }

  private eliminate(victim: Entry, killer: Entry | null, head = false, direction: { x: number; y: number; z: number } | null = null, weapon?: 'grenade'): void {
    if (!victim.session.alive) return;
    victim.session.alive = false;
    victim.session.health = 0;
    victim.session.regenAt = null;
    resetCombo(victim.session);
    victim.session.deaths++;
    victim.queue.length = 0;
    victim.received = victim.session.ack;
    const at = Date.now();
    const credited = killer && killer !== victim ? killer : null;
    const award = credited ? awardElimination(credited.session, at, head, Math.max(1, Math.trunc(positive(this.env.COMBO_WINDOW_MS ?? '', COMBO_WINDOW_MS)))) : null;
    if (credited) {
      credited.session.kills++;
      credited.session.grenades++; // Same exactly-once transaction as the authoritative kill award.
      if (this.mode === 'teams' && credited.session.team) this.scores[credited.session.team]++;
      this.advanceCareer(credited, { kind:'kill', weapon:weapon ?? credited.session.weapon!, head, points:award!.total }, at);
      this.recordStanding(credited);
    }
    this.recordStanding(victim);
    const elimination: import('../../shared/protocol').Elimination = { id: crypto.randomUUID(), victimLife: victim.session.life,
      award,
      direction, roundId: this.round.id, victimId: victim.session.id,
      victimName: victim.session.name, killerId: killer?.session.id ?? null, killerName: killer?.session.name ?? null,
      weapon: weapon ?? killer?.session.weapon ?? null, head, at, respawnAt: at + RESPAWN_DELAY_MS,
      killerTeam: killer?.session.team ?? null, victimTeam: victim.session.team };
    victim.session.death = elimination;
    this.publish({ v: PROTOCOL_VERSION, type: 'elimination', elimination });
  }

  private fire(e: Entry, spread: number, control: InputFrame['combat']): boolean {
    const gun = e.gun!;
    const p = e.controller;
    const origin = p.leanEye();
    const yaw = control.aimYaw ?? p.yaw, pitch = control.aimPitch ?? p.pitch, cp = Math.cos(pitch);
    const aim = applySpread({ x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp }, spread);
    const result: ShotResult = { id: crypto.randomUUID(), roundId: this.round.id, shooterId: e.session.id, weapon: gun.stats.id, hits: [] };
    for (let k = 0; k < gun.stats.pellets; k++) {
      const dir = gun.stats.pellets > 1 ? applySpread(aim, gun.stats.pelletSpread) : aim;
      const wall = this.activeMap.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, gun.stats.range);
      let nearest: { entry: Entry; distance: number; zone: 'head' | 'body' } | null = null;
      for (const target of this.connected()) {
        if (target === e || !target.session.alive) continue;
        const hit = rayPlayer(origin, dir, target.controller.capture());
        if (hit && hit.distance <= gun.stats.range && (!nearest || hit.distance < nearest.distance)) nearest = { entry: target, ...hit };
      }
      this.environment.shoot(origin,dir,Math.min(gun.stats.range,wall?.distance??Infinity,nearest?.distance??Infinity),gun.stats.id);
      if (!nearest || (wall && wall.distance <= nearest.distance + .0001)
        || teammates(this.mode, e.session.team, nearest.entry.session.team)) continue;
      const target = nearest.entry;
      const before = target.session.health;
      const point = { x: origin.x + dir.x * nearest.distance, y: origin.y + dir.y * nearest.distance, z: origin.z + dir.z * nearest.distance };
      this.damage.tryApply({ id: e.session.id, position: () => p.position }, {
        id: target.session.id, alive: target.session.alive, position: () => target.controller.position,
        applyDamage: (amount) => {
          target.session.health = Math.max(0, target.session.health - amount);
          target.session.regenAt = Date.now() + REGEN_DELAY_MS;
          if (target.session.health === 0) this.eliminate(target, e, nearest!.zone === 'head', { ...dir });
        },
      }, { bodyDamage: damageAt(gun.stats, nearest.distance), zone: nearest.zone, point, weapon: gun.stats.id });
      const previous = result.hits.find((h) => h.id === target.session.id);
      if (previous) {
        previous.amount += before - target.session.health;
        previous.health = target.session.health;
        previous.head ||= nearest.zone === 'head';
        previous.killed ||= !target.session.alive;
      } else result.hits.push({ id: target.session.id, life: target.session.life, direction: { ...dir }, amount: before - target.session.health, health: target.session.health,
        head: nearest.zone === 'head', killed: !target.session.alive });
    }
    this.publish({ v: PROTOCOL_VERSION, type: 'shot', shot: result });
    return result.hits.length > 0;
  }

  private tick(): void {
    if(this.tickBusy)return;
    const durable=this.grenades.length>0||[...this.players.values()].some(e=>e.queue.some(f=>f.combat.grenade));
    if(!durable){this.runTick();return;}
    this.tickBusy=true;
    void this.ctx.blockConcurrencyWhile(async()=>{
      this.deferred=[];
      try {
        this.runTick();
        for(const e of this.players.values())e.session.revision++;
        await this.persist();
        const events=this.deferred;this.deferred=null;
        for(const e of this.players.values())this.attach(e);
        for(const event of events)this.publish(event);
        this.broadcast();
      } finally {this.deferred=null;this.tickBusy=false;}
    });
  }

  private launchGrenade(e: Entry, now: number): void {
    if(!e.session.alive||e.session.grenades<=0||e.gun?.action!=='idle'||e.controller.sliding||this.grenades.length>=32)return;
    const p=e.controller;
    const g=throwGrenade(this.activeMap.world,p.leanEye(),{x:p.position.x,y:p.position.y+p.eyeHeight,z:p.position.z},p.lookDirection(),p.velocity,
      {id:crypto.randomUUID(),ownerId:e.session.id,ownerLife:e.session.life,roundId:this.round.id,at:now});
    if(!g)return;
    e.session.grenades--;this.grenades.push(g);
    this.publish({v:PROTOCOL_VERSION,type:'grenade',event:{kind:'throw',id:`throw:${g.id}`,projectile:g}});
  }

  private updateGrenades(now: number): void {
    this.explosions=this.explosions.filter(e=>now-e.at<GRENADE_SMOKE_MS);
    for(const g of [...this.grenades]) {
      advanceGrenade(g,now,this.activeMap.world);
      if(now<g.explodeAt)continue;
      this.grenades=this.grenades.filter(p=>p.id!==g.id);
      const owner=this.players.get(g.ownerId);
      const event:GrenadeExplosion={id:`blast:${g.id}`,grenadeId:g.id,ownerId:g.ownerId,ownerLife:g.ownerLife,roundId:g.roundId,at:now,position:{...g.position},hits:[]};
      for(const victim of this.connected()) {
        if(!victim.session.alive||(victim!==owner&&teammates(this.mode,owner?.session.team??null,victim.session.team)))continue;
        const amount=blastDamage(this.activeMap.world,g.position,victim.controller.capture());
        if(amount<=0)continue;
        const p=victim.controller.position, dx=p.x-g.position.x,dy=p.y+victim.controller.eyeHeight-g.position.y,dz=p.z-g.position.z,len=Math.hypot(dx,dy,dz)||1;
        const direction={x:dx/len,y:dy/len,z:dz/len},before=victim.session.health;
        this.damage.tryApply({id:g.ownerId,position:()=>g.position},{id:victim.session.id,alive:true,position:()=>p,applyDamage:(damage)=>{
          victim.session.health=Math.max(0,victim.session.health-damage);victim.session.regenAt=now+REGEN_DELAY_MS;
          if(victim.session.health===0)this.eliminate(victim,owner??null,false,direction,'grenade');
        }},{bodyDamage:amount,zone:'body',point:p,weapon:'grenade'});
        event.hits.push({id:victim.session.id,life:victim.session.life,amount:before-victim.session.health,health:victim.session.health,killed:!victim.session.alive,direction});
      }
      // Posthumous kills still score, but dead sessions must never retain a live combo timer.
      if(owner&&!owner.session.alive)resetCombo(owner.session);
      this.explosions.push(event); if(this.explosions.length>64)this.explosions.shift();this.publish({v:PROTOCOL_VERSION,type:'grenade',event:{kind:'explode',...event}});
    }
  }

  private runTick(): void {
    const now = Date.now();
    this.ensureRound();
    let eliminated = false;
    let regeneratedToFull = false;
    for (const e of this.players.values()) if (e.socket) {
      expireCombo(e.session, now);
      const healed = regenerate(e.session, now);
      regeneratedToFull ||= healed > 0 && e.session.health === PLAYER_MAX_HEALTH;
    }
    this.accumulator += Math.min(0.25, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    // Input volume cannot advance this loop: only elapsed server time can.
    while (this.accumulator >= FIXED_DT) {
      const frames = new Map<Entry, InputFrame | undefined>();
      for (const e of this.players.values()) {
        if (!e.socket || !e.session.alive) continue;
        const frame = e.queue.shift();
        frames.set(e, frame);
        if (frame) { e.controller.yaw = frame.yaw; e.controller.pitch = frame.pitch; e.session.ack = frame.seq; e.leanHeld = frame.intent.lean ?? 0; e.crouchHeld=frame.intent.crouch??false; }
        e.controller.weaponClearance = e.session.weapon;
        e.controller.fixedUpdate(FIXED_DT, frame?.intent ?? { ...NO_INTENT, slide: e.controller.slideHeld, lean: e.leanHeld, crouch:e.crouchHeld });
        if (e.controller.position.y < MOVEMENT.killY) {
          this.eliminate(e, null);
          eliminated = true;
          e.queue.length = 0;
          e.received = e.session.ack;
        }
      }
      // Everyone moves first; then all weapons use the same fixed-step world state.
      for (const [e, frame] of frames) {
        if (!e.session.alive || !e.gun) continue;
        const intent = frame?.combat ?? NO_COMBAT;
        const combat = e.session.combat;
        if(intent.grenade&&!combat.grenadeHeld)this.launchGrenade(e,now);
        const events = e.gun.update(FIXED_DT, { trigger: intent.trigger,
          triggerPressed: intent.trigger && !combat.triggerHeld, reloadPressed: intent.reload && !combat.reloadHeld,
          aim: frame?.intent.aim ?? combat.aimHeld, moveFactor: e.controller.horizontalSpeed / MOVEMENT.weaponMoveReference,
          airborne: !e.controller.grounded, sprinting: false });
        if (frame) { combat.triggerHeld = intent.trigger; combat.reloadHeld = intent.reload; combat.aimHeld = frame.intent.aim; combat.grenadeHeld=!!intent.grenade; }
        for (const event of events) if (event.type === 'fire') eliminated = this.fire(e, event.spread, intent) || eliminated;
      }
      this.accumulator -= FIXED_DT;
    }
    this.updateGrenades(now);
    const environmentWasActive=this.environment.active>0;
    this.environment.advance(Math.min(.25,Math.max(0,(now-(this.environmentUpdated??now))/1000)));
    const environmentSettled=environmentWasActive&&this.environment.active===0;
    this.environmentUpdated=now;
    if(now-this.environmentSent>=1000/ENVIRONMENT.hz||environmentSettled){
      const changes=this.environment.takeChanges();
      if(changes.length){this.environmentSeq++;this.publish({v:PROTOCOL_VERSION,type:'environment',frame:this.environmentFrame(false,changes)});}
      this.environmentSent=now;
    }
    for (const socket of this.ctx.getWebSockets()) {
      const e = this.current(socket);
      const a = socket.deserializeAttachment() as Attachment;
      if (now - (e?.lastSeen ?? a.openedAt) > (e ? this.timeout : 5000)) {
        this.trace('heartbeat_timeout', { source: 'tick', id: e?.session.id, lastSeen: e?.lastSeen ?? a.openedAt, timeout: e ? this.timeout : 5000 });
        void this.disconnect(socket);
        socket.close(4000, 'heartbeat_timeout');
      }
    }
    if(!this.deferred) {
      for (const e of this.players.values()) if (e.socket) this.attach(e);
      this.broadcast();
      if (environmentSettled || eliminated || regeneratedToFull || now - this.lastSave >= 1000) { this.lastSave = now; void this.persist(); }
    }
    if (!this.simulationNeeded()) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      void this.scheduleCleanup();
    }
  }

  private async disconnect(socket: WebSocket, forget = false): Promise<void> {
    const e = this.current(socket);
    if (!e) return;
    this.trace('disconnect', { id: e.session.id, intentional: forget, lastSeen: e.lastSeen });
    this.attach(e);
    if (e.session.participation?.roundId === this.round.id) {
      e.session.participation.abandoned = true;
      const profile=e.session.profileId?this.careers.profiles.get(e.session.profileId):null;
      if(profile){profile.abandonedRound=this.round.id;this.careers.mark(e.session.profileId!);}
    }
    this.careerSent.delete(e.session.id);
    e.socket = undefined;
    e.queue.length = 0;
    e.session.expiresAt = Date.now() + this.grace;
    if (forget) {
      const live=this.grenades.filter(g=>g.ownerId===e.session.id);
      if(live.length){e.session.token=token();e.session.expiresAt=Math.max(...live.map(g=>g.explodeAt))+100;}
      else this.players.delete(e.session.id);
    }
    for (const p of this.players.values()) if (p.socket) this.send(p.socket, { v: PROTOCOL_VERSION, type: 'left', id: e.session.id });
    await this.persist();
    this.broadcast();
    await this.scheduleCleanup();
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.trace('close', { id: (socket.deserializeAttachment() as Attachment)?.session?.id, code, reason, wasClean });
    await this.disconnect(socket);
    // Complete the close handshake explicitly, including in the local runtime.
    socket.close(code === 1005 || code === 1006 ? 1000 : code, 'closed');
  }
  async webSocketError(socket: WebSocket): Promise<void> {
    this.trace('socket_error', { id: this.current(socket)?.session.id });
    await this.disconnect(socket);
    socket.close(1011, 'socket_error');
  }
  private prune(): void {
    for (const [id, e] of this.players) if (!e.socket && e.session.expiresAt <= Date.now()) this.players.delete(id);
  }
  private persist(): Promise<void> {
    for (const e of this.players.values()) {
      e.session.crouchHeld=e.crouchHeld;
      expireCombo(e.session, Date.now());
      this.recordStanding(e);
      e.session.motion = e.controller.capture();
      e.session.combat.gun = e.gun?.capture() ?? null;
    }
    const views = this.careers.views(Date.now()), pending = this.careers.capture();
    return this.ctx.storage.put({ ...pending.records, environment:{roundId:this.round.id,mapVersion:this.activeMap.revision,seq:this.environmentSeq,states:this.environment.capture()},grenades:this.grenades,explosions:this.explosions,'team-scores': this.scores, 'round-ledger': this.ledger, 'round-result': this.lastResult,
      sessions: [...this.players.values()].map((e) => e.session) }).then(() => { this.careers.committed(pending.versions); this.sendCareerViews(views); });
  }
  private advanceCareer(e: Entry, event: ChallengeEvent, at: number): void {
    const id = e.session.profileId, profile = id ? this.careers.profiles.get(id) : null;
    if (profile && id) { const revision=profile.revision;advanceChallenges(profile, id, event, at);if(profile.revision!==revision)this.careers.mark(id); }
  }
  private finishCareerRound(result: RoundResult): void {
    const eligible = new Set<string>();
    for (const e of this.connected()) {
      const id=e.session.profileId, participation=e.session.participation, p=id?this.careers.profiles.get(id):null;
      if(!id||!p||eligible.has(id)||!participation||participation.roundId!==result.roundId||participation.abandoned||p.abandonedRound===result.roundId||p.lastMatchRound>=result.roundId)continue;
      const standing=result.players?.find(s=>s.id===e.session.id);
      if(!standing)continue;
      eligible.add(id);p.lastMatchRound=result.roundId;this.careers.mark(id);
      advanceChallenges(p,id,{kind:'round',won:!result.draw&&(result.mode==='teams'?standing.team===result.winningTeam:result.winner?.id===standing.id),
        mvp:result.mvp?.id===standing.id,complete:participation.firstSpawn<=result.endedAt-600000+30000},result.endedAt);
    }
  }
  private sendCareerViews(views: Map<string, CareerView>): void {
    for(const e of this.connected()) {
      const view=e.session.profileId?views.get(e.session.profileId):null;
      if(!view||this.careerSent.get(e.session.id)===view.revision)continue;
      this.careerSent.set(e.session.id,view.revision);this.send(e.socket!,{v:PROTOCOL_VERSION,type:'career',profile:view});
    }
  }
  private async scheduleCleanup(): Promise<void> {
    const deadlines = [...this.players.values()].filter((e) => !e.socket).map((e) => e.session.expiresAt);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const e = this.current(socket);
      const a = socket.deserializeAttachment() as Attachment;
      deadlines.push(e ? e.lastSeen + this.timeout : a.openedAt + 5000);
    }
    if (this.connected().length) deadlines.push(this.round.endsAt);
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.min(...deadlines));
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm(): Promise<void> {
    this.ensureRound();
    for (const socket of this.ctx.getWebSockets()) {
      const e = this.current(socket);
      const a = socket.deserializeAttachment() as Attachment;
      if (Date.now() - (e?.lastSeen ?? a.openedAt) >= (e ? this.timeout : 5000)) {
        this.trace('heartbeat_timeout', { source: 'alarm', id: e?.session.id, lastSeen: e?.lastSeen ?? a.openedAt, timeout: e ? this.timeout : 5000 });
        await this.disconnect(socket);
        socket.close(4000, 'heartbeat_timeout');
      }
    }
    this.prune();
    await this.persist();
    await this.scheduleCleanup();
  }
}
