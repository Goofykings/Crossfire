import { DurableObject } from 'cloudflare:workers';
import { FIXED_DT } from '../../src/config/constants';
import { NO_INTENT, PlayerController, type ControllerState } from '../../src/player/PlayerController';
import { HEARTBEAT_TIMEOUT_MS, NETWORK_HZ, PUBLIC_ROOM, SESSION_GRACE_MS, parseClientMessage,
  type InputFrame, type PlayerState, type ServerMessage, type Snapshot } from '../../shared/protocol';
import { WORLDS, MOVEMENT } from './world';
import { mapRound, type MapSchedule, type MapRound } from '../../shared/maps';
import type { WeaponId } from '../../src/weapons/Weapon';

interface Bindings {
  ROOM: DurableObjectNamespace<PublicRoom>;
  ALLOWED_ORIGINS: string;
  SESSION_GRACE_MS: string;
  HEARTBEAT_TIMEOUT_MS: string;
}
interface Session {
  roundId: number;
  alive: boolean;
  life: number;
  weapon: WeaponId | null;
  kills: number;
  deaths: number;
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
}

const positive = (s: string, fallback: number) => Number.isFinite(+s) && +s > 0 ? +s : fallback;
const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'crossfire-multiplayer', stage: 2, room: PUBLIC_ROOM });
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
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = Date.now();
  private accumulator = 0;
  private lastSave = 0;
  private schedule!: MapSchedule;
  private round!: MapRound;
  private activeMap!: typeof WORLDS[keyof typeof WORLDS];

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.schedule = await ctx.storage.get<MapSchedule>('map-schedule') ?? { epoch: Date.now(), seed: crypto.getRandomValues(new Uint32Array(1))[0] };
      await ctx.storage.put('map-schedule', this.schedule);
      this.round = mapRound(this.schedule, Date.now());
      this.activeMap = WORLDS[this.round.mapId];
      const stored = await ctx.storage.get<Session[]>('sessions') ?? [];
      for (const s of stored) {
        // An unclean restart is still resumable only for the bounded grace window.
        if (!s.expiresAt) s.expiresAt = (s.lastSeen ?? Date.now()) + this.grace;
        if (s.expiresAt > Date.now()) this.players.set(s.id, this.entry(s));
      }
      for (const socket of ctx.getWebSockets()) {
        const a = socket.deserializeAttachment() as Attachment;
        if (!a?.session) continue;
        const s = a.session;
        const existing = this.players.get(s.id);
        if (existing && existing.session.generation > s.generation) continue;
        s.expiresAt = 0;
        const e = this.entry(s);
        e.lastSeen = a.openedAt;
        e.socket = socket;
        this.players.set(s.id, e);
      }
      this.prune();
      this.start();
    });
  }

  private get grace(): number { return positive(this.env.SESSION_GRACE_MS, SESSION_GRACE_MS); }
  private get timeout(): number { return positive(this.env.HEARTBEAT_TIMEOUT_MS, HEARTBEAT_TIMEOUT_MS); }

  private entry(session: Session): Entry {
    // Migrate the movement-only records without treating them as approved spawns.
    session.alive ??= false;
    session.life ??= 0;
    session.weapon ??= null;
    session.kills ??= 0;
    session.deaths ??= 0;
    const controller = new PlayerController(this.activeMap.world);
    if (session.roundId !== this.round.id) {
      session.roundId = this.round.id;
      session.alive = false;
      session.weapon = null;
      session.kills = session.deaths = 0;
      session.motion = controller.capture();
    } else controller.restore(session.motion);
    return { session, controller, queue: [], received: session.ack, lastSeen: Date.now(), rateAt: Date.now(), rateCount: 0 };
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureRound();
    if (new URL(request.url).pathname === '/presence') {
      return Response.json({ room: PUBLIC_ROOM, online: this.connected().length });
    }
    if (this.ctx.getWebSockets().length >= 24) return new Response('Room capacity reached', { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ openedAt: Date.now() } satisfies Attachment);
    this.ctx.acceptWebSocket(server);
    this.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  private start(): void {
    if (this.timer) return;
    if (!this.simulationNeeded()) { void this.scheduleCleanup(); return; }
    // A batch contains input collected since the preceding network send. Preserve that
    // elapsed time when an idle simulation resumes, rather than losing a tick per batch.
    this.lastTick = Math.max(this.lastTick, Date.now() - 100);
    this.timer = setInterval(() => this.tick(), 1000 / NETWORK_HZ);
  }

  private simulationNeeded(): boolean {
    return [...this.players.values()].some((e) => e.socket && e.session.alive && (e.queue.length > 0 || !e.controller.grounded
      || Math.hypot(e.controller.velocity.x, e.controller.velocity.y, e.controller.velocity.z) > 0.001));
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try { socket.send(JSON.stringify(message)); } catch { void this.disconnect(socket); }
  }

  private error(socket: WebSocket, code: string, message: string, fatal = false): void {
    this.send(socket, { v: 3, type: 'error', code, message, fatal });
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
      await this.join(socket, message.name, message.resumeToken);
      return;
    }
    if (!e) { this.error(socket, 'join_required', 'Join before sending input', true); return; }
    const now = Date.now();
    if (now - e.rateAt >= 1000) { e.rateAt = now; e.rateCount = 0; }
    if (++e.rateCount > 80) { this.error(socket, 'rate_limit', 'Too many messages', true); return; }
    e.lastSeen = now;
    if ((message.type === 'input' || message.type === 'spawn') && message.roundId !== this.round.id) {
      this.error(socket, 'round_changed', 'The map changed. Wait for the new map to load.');
      this.send(socket, { v: 3, type: 'snapshot', snapshot: this.snapshot() });
      return;
    }
    if (message.type === 'leave') {
      await this.disconnect(socket, true);
      socket.close(1000, 'left');
    } else if (message.type === 'ping') {
      this.attach(e);
      this.send(socket, { v: 3, type: 'pong', at: message.at, serverTime: now });
      this.broadcast();
      await this.scheduleCleanup();
    } else if (message.type === 'spawn') {
      if (message.mapVersion !== this.activeMap.revision) { this.error(socket, 'map_mismatch', 'Client and server map assets differ', true); return; }
      if (e.session.alive) { this.error(socket, 'already_spawned', 'Your weapon is locked until the next life'); return; }
      const occupied = this.connected().filter((p) => p.session.alive);
      const candidates = this.activeMap.layout.spawns.map((s) => ({ s, gap: occupied.reduce((d, p) => Math.min(d,
        Math.hypot(p.controller.position.x - s.pos[0], p.controller.position.z - s.pos[2])), Infinity) })).sort((a, b) => b.gap - a.gap);
      const spawn = candidates.find((c) => c.gap >= MOVEMENT.radius * 2 + 0.1
        && !this.activeMap.world.overlapsCylinder(c.s.pos[0], c.s.pos[2], MOVEMENT.radius, c.s.pos[1] + MOVEMENT.stepHeight, c.s.pos[1] + MOVEMENT.standHeight));
      if (!spawn) { this.error(socket, 'spawn_busy', 'No clear spawn available. Try again.'); return; }
      e.controller.teleport({ x: spawn.s.pos[0], y: spawn.s.pos[1], z: spawn.s.pos[2] }, spawn.s.heading);
      e.session.alive = true;
      e.session.life++;
      e.session.weapon = message.weapon;
      e.queue.length = 0;
      e.received = e.session.ack;
      this.attach(e);
      await this.persist();
      this.send(socket, { v: 3, type: 'spawned', requestId: message.requestId, snapshot: this.snapshot() });
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

  private async join(socket: WebSocket, requested: string, resume?: string): Promise<void> {
    this.prune();
    let e = resume ? [...this.players.values()].find((p) => p.session.token === resume) : undefined;
    if (resume && !e) { this.error(socket, 'resume_expired', 'Session expired; join again', true); return; }
    const resumed = !!e;
    if (!e) {
      if (this.players.size >= 16) { this.error(socket, 'room_full', 'Room capacity reached', true); return; }
      const controller = new PlayerController(this.activeMap.world);
      const name = requested.normalize('NFKC').replace(/[\p{C}<>]/gu, '').trim().slice(0, 24) || 'Player';
      e = this.entry({ id: crypto.randomUUID(), name, token: token(), generation: 0, motion: controller.capture(), ack: 0,
        roundId: this.round.id, alive: false, life: 0, weapon: null, kills: 0, deaths: 0, lastSeen: Date.now(), expiresAt: 0 });
      this.players.set(e.session.id, e);
    }
    const old = e.socket;
    e.socket = socket;
    e.session.generation++;
    e.session.expiresAt = 0;
    e.queue.length = 0;
    e.received = e.session.ack;
    e.lastSeen = Date.now();
    this.attach(e);
    // Publish the replacement generation before closing the old connection.
    if (old && old !== socket) old.close(4001, 'session_replaced');
    await this.persist();
    this.send(socket, { v: 3, type: 'welcome', selfId: e.session.id, resumeToken: e.session.token, resumed, snapshot: this.snapshot() });
    this.broadcast();
    await this.scheduleCleanup();
  }

  private attach(e: Entry): void {
    e.session.motion = e.controller.capture();
    e.session.lastSeen = e.lastSeen;
    e.socket?.serializeAttachment({ openedAt: e.lastSeen, session: e.session } satisfies Attachment);
  }

  private snapshot(): Snapshot {
    const players: PlayerState[] = this.connected().map((e) => ({ id: e.session.id,
      name: e.session.name, motion: e.controller.capture(), ack: e.session.ack, alive: e.session.alive, life: e.session.life,
      weapon: e.session.weapon, kills: e.session.kills, deaths: e.session.deaths, team: null }));
    return { room: PUBLIC_ROOM, mapId: this.round.mapId, roundId: this.round.id, mapVersion: this.activeMap.revision, serverTime: Date.now(), players,
      match: { mode: null, endsAt: this.round.endsAt, teamScores: null } };
  }

  /** One canonical persisted schedule; clients never choose the public map. */
  private ensureRound(): void {
    const next = mapRound(this.schedule, Date.now());
    if (next.id === this.round.id) return;
    this.round = next;
    this.activeMap = WORLDS[next.mapId];
    this.accumulator = 0;
    this.lastTick = Date.now();
    for (const e of this.players.values()) {
      e.session.roundId = next.id;
      e.session.alive = false;
      e.session.weapon = null;
      e.session.kills = e.session.deaths = 0;
      e.controller = new PlayerController(this.activeMap.world);
      e.queue.length = 0;
      e.received = e.session.ack;
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
    const message: ServerMessage = { v: 3, type: 'snapshot', snapshot: this.snapshot() };
    for (const e of this.players.values()) if (e.socket) this.send(e.socket, message);
  }

  private tick(): void {
    const now = Date.now();
    this.ensureRound();
    let eliminated = false;
    this.accumulator += Math.min(0.25, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    // Input volume cannot advance this loop: only elapsed server time can.
    while (this.accumulator >= FIXED_DT) {
      for (const e of this.players.values()) {
        if (!e.socket || !e.session.alive) continue;
        const frame = e.queue.shift();
        if (frame) { e.controller.yaw = frame.yaw; e.controller.pitch = frame.pitch; e.session.ack = frame.seq; }
        e.controller.fixedUpdate(FIXED_DT, frame?.intent ?? NO_INTENT);
        if (e.controller.position.y < MOVEMENT.killY) {
          e.session.alive = false;
          e.session.deaths++;
          eliminated = true;
          e.queue.length = 0;
          e.received = e.session.ack;
        }
      }
      this.accumulator -= FIXED_DT;
    }
    for (const socket of this.ctx.getWebSockets()) {
      const e = this.current(socket);
      const a = socket.deserializeAttachment() as Attachment;
      if (now - (e?.lastSeen ?? a.openedAt) > (e ? this.timeout : 5000)) {
        void this.disconnect(socket);
        socket.close(4000, 'heartbeat_timeout');
      }
    }
    for (const e of this.players.values()) if (e.socket) this.attach(e);
    this.broadcast();
    if (eliminated || now - this.lastSave >= 1000) { this.lastSave = now; void this.persist(); }
    if (!this.simulationNeeded()) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      void this.scheduleCleanup();
    }
  }

  private async disconnect(socket: WebSocket, forget = false): Promise<void> {
    const e = this.current(socket);
    if (!e) return;
    this.attach(e);
    e.socket = undefined;
    e.queue.length = 0;
    e.session.expiresAt = Date.now() + this.grace;
    if (forget) this.players.delete(e.session.id);
    for (const p of this.players.values()) if (p.socket) this.send(p.socket, { v: 3, type: 'left', id: e.session.id });
    await this.persist();
    this.broadcast();
    await this.scheduleCleanup();
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    await this.disconnect(socket);
    // Complete the close handshake explicitly, including in the local runtime.
    socket.close(code === 1005 || code === 1006 ? 1000 : code, 'closed');
  }
  async webSocketError(socket: WebSocket): Promise<void> {
    await this.disconnect(socket);
    socket.close(1011, 'socket_error');
  }
  private prune(): void {
    for (const [id, e] of this.players) if (!e.socket && e.session.expiresAt <= Date.now()) this.players.delete(id);
  }
  private persist(): Promise<void> {
    for (const e of this.players.values()) e.session.motion = e.controller.capture();
    return this.ctx.storage.put('sessions', [...this.players.values()].map((e) => e.session));
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
        await this.disconnect(socket);
        socket.close(4000, 'heartbeat_timeout');
      }
    }
    this.prune();
    await this.persist();
    await this.scheduleCleanup();
  }
}
