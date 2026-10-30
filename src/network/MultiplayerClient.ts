import { FIXED_DT } from '../config/constants';
import type { MoveIntent, PlayerController } from '../player/PlayerController';
import type { Weapon, WeaponId } from '../weapons/Weapon';
import { MOVEMENT } from '../config/constants';
import { NO_COMBAT, type CombatIntent } from '../../shared/combat';
import { multiplayerEndpoint } from './endpoint';
import { INPUT_BATCH_LIMIT, NETWORK_HZ, parseServerMessage, type ClientMessage, type InputFrame,
  type ServerMessage, type Snapshot, type ShotResult, type Elimination } from '../../shared/protocol';

type Welcome = Extract<ServerMessage, { type: 'welcome' }>;
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed';
interface NetworkEvent { at: number; event: string; detail: Record<string, unknown> }

/** Real WebSocket transport. Its timers are independent of the render loop. */
export class MultiplayerClient {
  state: ConnectionState = 'idle';
  selfId = '';
  latest: Snapshot | null = null;
  clockOffset = 0;
  onSnapshot: (snapshot: Snapshot) => void = () => {};
  onShot: (shot: ShotResult) => void = () => {};
  onElimination: (event: Elimination) => void = () => {};
  private readonly combatEvents = new Set<string>();
  private firstCombatEvent(id: string): boolean {
    if (this.combatEvents.has(id)) return false;
    this.combatEvents.add(id);
    if (this.combatEvents.size > 256) this.combatEvents.delete(this.combatEvents.values().next().value!);
    return true;
  }
  onState: (state: ConnectionState, message?: string) => void = () => {};
  private socket: WebSocket | null = null;
  private token = '';
  private attempts = 0;
  private sequence = 0;
  private sentSequence = 0;
  private stopped = false;
  private pending: InputFrame[] = [];
  private unsent: InputFrame[] = [];
  private flushTimer = 0;
  private pingTimer = 0;
  private retryTimer = 0;
  private deadline = 0;
  private lastMessage = 0;
  private lastPing = 0;
  private lastPong = 0;
  private lastAck = 0;
  private lastAckAt = 0;
  private connectedAt = 0;
  private resumedAt = 0;
  private ackLatency = 0;
  private readonly sentAt = new Map<number, number>();
  private readonly events: NetworkEvent[] = [];
  private opens = 0;
  private closes = 0;
  private lastBackpressure = 0;
  private visibilityListening = false;
  private readonly onVisibility = () => {
    if (document.hidden || this.state !== 'connected' || this.socket?.readyState !== WebSocket.OPEN) return;
    this.resumedAt = Date.now();
    this.trace('visibility_resume', { lastMessage: this.lastMessage });
    this.ping();
  };
  private resolve: ((w: Welcome) => void) | null = null;
  private reject: ((e: Error) => void) | null = null;
  private ready: Promise<Welcome> | null = null;
  private fatal = false;
  private lastYaw = NaN;
  private lastPitch = NaN;
  private lastSlide = false;
  private lastAim = false;
  private lastCombat: CombatIntent = { ...NO_COMBAT };
  private life = -1;
  private round = -1;
  private readonly url: string;
  private spawning: { id: string; resolve: (s: Snapshot) => void; reject: (e: Error) => void; timeout: number } | null = null;

  constructor(url: string, private readonly name: string | (() => string) = 'Player', private readonly options: { debug?: boolean } = {}) {
    const parsed = multiplayerEndpoint(url);
    this.url = parsed.href;
    try {
      const stored = sessionStorage.getItem(this.storageKey) ?? '';
      this.token = /^[a-f0-9]{64}$/.test(stored) ? stored : '';
    } catch { /* Storage may be disabled. */ }
  }

  private get storageKey(): string { return `crossfire.session.v1:${this.url}`; }
  private saveToken(): void {
    try { if (this.token) sessionStorage.setItem(this.storageKey, this.token); else sessionStorage.removeItem(this.storageKey); } catch { /* Optional persistence. */ }
  }
  private trace(event: string, detail: Record<string, unknown> = {}): void {
    const row = { at: Date.now(), event, detail };
    this.events.push(row); if (this.events.length > 128) this.events.shift();
    if (this.options.debug) console.debug('[crossfire network]', row);
  }
  inspect() {
    return { state: this.state, socketState: this.socket?.readyState ?? null, opens: this.opens, closes: this.closes,
      attempts: this.attempts, lastMessage: this.lastMessage, lastPing: this.lastPing, lastPong: this.lastPong,
      lastAck: this.lastAck, lastAckAt: this.lastAckAt, pending: this.pending.length, unsent: this.unsent.length,
      inFlight: this.sentSequence - this.lastAck, ackLatency: this.ackLatency, inputWindow: this.inputWindow,
      events: [...this.events] };
  }
  // Even if all packets arrive together, outstanding input must fit the server's
  // unchanged 48-frame queue. Longer delays apply backpressure, never reconnect.
  private get inputWindow(): number { return Math.max(24, Math.min(48, Math.ceil((this.ackLatency + 150) / (FIXED_DT * 1000)))); }
  private setState(state: ConnectionState, message?: string): void {
    if (state === this.state) return;
    this.trace('state', { from: this.state, to: state, message });
    this.state = state; this.onState(state, message);
  }

  connect(): Promise<Welcome> {
    if (this.state === 'connected' && this.ready) return this.ready;
    if (this.state === 'reconnecting') {
      if (!this.resolve) this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
      return this.ready!;
    }
    if (this.ready && this.state === 'connecting') return this.ready;
    this.stopped = false;
    this.attempts = 0;
    this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.open();
    return this.ready;
  }

  private open(): void {
    if (this.stopped) return;
    if (this.socket) { this.trace('overlapping_open_blocked'); return; }
    this.stopTimers();
    this.fatal = false;
    this.connectedAt = 0;
    this.resumedAt = 0;
    this.sentAt.clear(); this.ackLatency = 0;
    this.setState(this.attempts ? 'reconnecting' : 'connecting');
    this.pending = [];
    this.unsent = [];
    this.lastYaw = this.lastPitch = NaN;
    this.lastSlide = false;
    this.lastAim = false;
    this.lastCombat = { ...NO_COMBAT };
    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.trace('connect_attempt', { attempt: this.attempts });
    this.deadline = window.setTimeout(() => {
      if (this.socket !== socket) return;
      this.trace('handshake_timeout', { socketState: socket.readyState });
      socket.close(4000, 'handshake_timeout');
    }, 5000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.opens++; this.trace('open');
      this.send({ v: 6, type: 'join', name: typeof this.name === 'function' ? this.name() : this.name, ...(this.token ? { resumeToken: this.token } : {}) });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      const m = parseServerMessage(event.data);
      if (!m) {
        let version: unknown = null;
        try { version = JSON.parse(event.data).v; } catch { /* Malformed JSON. */ }
        this.trace('protocol_rejected', { expected: 6, received: typeof version === 'number' ? version : null });
        this.fail('Invalid message from multiplayer server (expected protocol v6). Rebuild matching frontend and backend.');
        socket.close(4002, 'protocol_error'); return;
      }
      this.lastMessage = Date.now();
      if (m.type === 'error') {
        this.trace('server_error', { code: m.code, fatal: m.fatal });
        this.cancelSpawn(m.message);
        if (m.code === 'resume_expired') { this.token = ''; this.saveToken(); return; }
        if (m.fatal) { this.fail(m.message); socket.close(); }
        return;
      }
      if (m.type === 'welcome') {
        window.clearTimeout(this.deadline);
        this.selfId = m.selfId;
        this.token = m.resumeToken;
        this.saveToken();
        this.sequence = m.snapshot.players.find((p) => p.id === m.selfId)?.ack ?? 0;
        this.sentSequence = this.sequence;
        this.lastAck = this.sequence; this.lastAckAt = Date.now();
        this.round = m.snapshot.roundId;
        this.life = m.snapshot.players.find((p) => p.id === m.selfId)?.life ?? -1;
        this.pending = [];
        this.unsent = [];
        this.connectedAt = Date.now();
        this.trace('welcome', { resumed: m.resumed, id: m.selfId });
        this.clockOffset = m.snapshot.serverTime - Date.now();
        this.latest = m.snapshot;
        this.setState('connected');
        this.startTimers();
        this.resolve?.(m);
        this.resolve = this.reject = null;
        this.onSnapshot(m.snapshot);
      } else if (m.type === 'snapshot' || m.type === 'spawned') {
        if (m.snapshot.roundId !== this.round) this.cancelSpawn('The map changed. Select a loadout after loading.');
        this.latest = m.snapshot;
        const self = m.snapshot.players.find((p) => p.id === this.selfId);
        const ack = self?.ack ?? 0;
        if (!self?.alive || self.life !== this.life || m.snapshot.roundId !== this.round) {
          this.pending = [];
          this.unsent = [];
          this.sequence = ack;
          this.sentSequence = ack;
          this.sentAt.clear(); this.ackLatency = 0;
          this.life = self?.life ?? -1;
          this.round = m.snapshot.roundId;
          this.lastYaw = this.lastPitch = NaN;
        } else this.pending = this.pending.filter((f) => f.seq > ack);
        if (ack !== this.lastAck) {
          let sent: number | undefined;
          for (const [seq, at] of this.sentAt) if (seq <= ack) { sent = at; this.sentAt.delete(seq); }
          if (sent !== undefined) {
            const sample = Math.max(0, Date.now() - sent);
            this.ackLatency = this.ackLatency ? this.ackLatency * .8 + sample * .2 : sample;
          }
          this.lastAckAt = Date.now();
        }
        this.lastAck = ack;
        this.onSnapshot(m.snapshot);
        if (m.type === 'spawned' && this.spawning?.id === m.requestId) {
          const pending = this.spawning;
          this.spawning = null;
          window.clearTimeout(pending.timeout);
          pending.resolve(m.snapshot);
        }
      } else if (m.type === 'shot') {
        if (m.shot.roundId === this.latest?.roundId && this.firstCombatEvent(m.shot.id)) this.onShot(m.shot);
      } else if (m.type === 'elimination') {
        if (m.elimination.roundId !== this.latest?.roundId || !this.firstCombatEvent(m.elimination.id)
          || this.latest.players.find((p) => p.id === m.elimination.victimId)?.life !== m.elimination.victimLife) return;
        // Presentation must retain the existing living instance before the dead snapshot removes it.
        this.onElimination(m.elimination);
        this.latest = { ...this.latest, players: this.latest.players.map((p) => p.id === m.elimination.victimId ? { ...p, health: 0, alive: false } : p) };
        this.onSnapshot(this.latest);
      } else if (m.type === 'left' && this.latest) {
        this.latest = { ...this.latest, players: this.latest.players.filter((p) => p.id !== m.id) };
        this.onSnapshot(this.latest);
      } else if (m.type === 'pong') {
        this.lastPong = Date.now();
        this.trace('pong', { sentAt: m.at, receivedAt: this.lastPong, rtt: this.lastPong - m.at });
        this.clockOffset = m.serverTime - (m.at + Date.now()) / 2;
      }
    };
    socket.onerror = () => { if (this.socket === socket) this.trace('socket_error'); /* Close owns retries. */ };
    socket.onclose = (event) => {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      this.closes++;
      this.trace('close', { code: event.code, reason: event.reason ?? '', clean: event.wasClean ?? false,
        stale: this.socket !== socket, lastMessage: this.lastMessage, lastPong: this.lastPong,
        lastAckAt: this.lastAckAt, pending: this.pending.length });
      if (this.socket !== socket) return;
      this.stopTimers();
      this.cancelSpawn('Connection interrupted. Try spawning again after reconnection.');
      this.socket = null;
      this.pending = [];
      this.unsent = [];
      if (this.stopped || this.fatal) return;
      if (event.code === 4001) {
        // Duplicated tabs may copy sessionStorage. Do not fight the replacement
        // connection in a reconnect loop; Retry can create a separate identity.
        this.token = '';
        this.saveToken();
        this.fail('This session was opened in another tab. Retry to join as a new player.');
        return;
      }
      if (this.connectedAt && Date.now() - this.connectedAt >= 30000) this.attempts = 0;
      if (++this.attempts > 5) { this.fail('Unable to connect to the multiplayer server. Check the endpoint and allowed origin, then Retry.'); return; }
      this.setState('reconnecting', 'Connection lost; reconnecting…');
      const delay = Math.min(3000, 300 * 2 ** (this.attempts - 1) * (.8 + Math.random() * .4));
      this.trace('retry_scheduled', { attempt: this.attempts, delay, reason: event.reason ?? '', code: event.code });
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
  }

  private fail(message: string): void {
    this.fatal = true;
    this.stopTimers();
    this.reject?.(new Error(message));
    this.reject = this.resolve = null;
    this.ready = null;
    this.setState('error', message);
  }

  private startTimers(): void {
    this.stopTimers();
    if (typeof document !== 'undefined' && !this.visibilityListening) {
      document.addEventListener('visibilitychange', this.onVisibility); this.visibilityListening = true;
    }
    this.flushTimer = window.setInterval(() => {
      const now = Date.now();
      if (now - Math.max(this.lastMessage, this.resumedAt) > 8000) {
        this.trace('receive_timeout', { lastMessage: this.lastMessage, lastPing: this.lastPing, lastPong: this.lastPong });
        this.socket?.close(4000, 'receive_timeout'); return;
      }
      if (this.unsent.length && this.latest && (this.socket?.bufferedAmount ?? 0) < 32768) {
        const ack = this.latest.players.find((p) => p.id === this.selfId)?.ack ?? 0;
        // In-flight frames include propagation/ACK time, not just the Worker's
        // queue. Retain bounded 20Hz batches and allow a backlog to drain.
        const count = Math.min(INPUT_BATCH_LIMIT, this.unsent.length,
          Math.max(0, this.inputWindow - (this.sentSequence - ack)));
        if (count) {
          const frames = this.unsent.splice(0, count);
          this.send({ v: 6, type: 'input', roundId: this.latest.roundId, mapVersion: this.latest.mapVersion, frames });
          this.sentSequence = frames[frames.length - 1].seq;
          this.sentAt.set(this.sentSequence, now);
        }
      }
    }, 1000 / NETWORK_HZ);
    this.pingTimer = window.setInterval(() => this.ping(), 2000);
  }
  private ping(): void {
    this.lastPing = Date.now(); this.trace('ping', { sentAt: this.lastPing, lastPong: this.lastPong });
    this.send({ v: 6, type: 'ping', at: this.lastPing });
  }
  private stopTimers(): void {
    for (const t of [this.flushTimer, this.pingTimer]) window.clearInterval(t);
    window.clearTimeout(this.deadline);
    window.clearTimeout(this.retryTimer);
    if (this.visibilityListening) { document.removeEventListener('visibilitychange', this.onVisibility); this.visibilityListening = false; }
  }
  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  fixedInput(player: PlayerController, intent: MoveIntent, combat: CombatIntent = NO_COMBAT): void {
    if (this.state !== 'connected' || !this.latest?.players.find((p) => p.id === this.selfId)?.alive) return;
    const yaw = Math.atan2(Math.sin(player.yaw), Math.cos(player.yaw));
    // No need to stream 120 identical standing frames per second. The room's
    // neutral input still settles gravity/friction, and heartbeats maintain liveness.
    if (player.grounded && Math.hypot(player.velocity.x, player.velocity.y, player.velocity.z) < 0.001
      && player.crouch === 0 && !player.sliding && player.slideCooldown === 0 && !this.lastSlide && !intent.slide && !intent.jumpPressed && intent.x === 0 && intent.z === 0
      && !intent.aim && !this.lastAim && !combat.trigger && !combat.reload && !this.lastCombat.trigger && !this.lastCombat.reload
      && yaw === this.lastYaw && player.pitch === this.lastPitch) return;
    if (this.pending.length >= 120) {
      if (Date.now() - this.lastBackpressure >= 1000) {
        this.lastBackpressure = Date.now();
        this.trace('input_backpressure', { pending: this.pending.length, lastAckAt: this.lastAckAt,
          lastMessage: this.lastMessage, socketState: this.socket?.readyState });
      }
      return;
    }
    this.lastYaw = yaw;
    this.lastPitch = player.pitch;
    // An idle Shift release must reach the server before another press can be an edge.
    this.lastSlide = intent.slide;
    this.lastAim = intent.aim;
    this.lastCombat = { ...combat };
    const frame: InputFrame = { seq: ++this.sequence, yaw, pitch: player.pitch, intent: { ...intent }, combat: { ...combat } };
    this.pending.push(frame);
    this.unsent.push(frame);
  }

  reconcile(player: PlayerController, snapshot: Snapshot, gun?: Weapon): void {
    const self = snapshot.players.find((p) => p.id === this.selfId);
    if (!self?.alive) return;
    const yaw = player.yaw, pitch = player.pitch;
    player.restore(self.motion);
    if (gun && self.combat.gun) gun.restore(self.combat.gun);
    let trigger = self.combat.triggerHeld, reload = self.combat.reloadHeld;
    for (const frame of this.pending) {
      if (frame.seq <= self.ack) continue;
      player.yaw = frame.yaw;
      player.pitch = frame.pitch;
      player.fixedUpdate(FIXED_DT, frame.intent);
      gun?.update(FIXED_DT, { trigger: frame.combat.trigger, triggerPressed: frame.combat.trigger && !trigger,
        reloadPressed: frame.combat.reload && !reload, aim: frame.intent.aim,
        moveFactor: player.horizontalSpeed / MOVEMENT.weaponMoveReference, airborne: !player.grounded, sprinting: false });
      trigger = frame.combat.trigger; reload = frame.combat.reload;
    }
    // Snapshots must not overwrite mouse look that has not reached a fixed tick yet.
    player.yaw = yaw;
    player.pitch = pitch;
  }

  /** Deliberate transport interruption for diagnostics; resumes the existing authenticated session. */
  reconnect(): void {
    if (!this.socket || this.stopped) return;
    this.trace('manual_reconnect');
    this.socket.close(4000, 'reconnect');
  }

  disconnect(): void {
    this.cancelSpawn('Left match');
    this.stopped = true;
    this.trace('intentional_leave');
    this.send({ v: 6, type: 'leave' });
    if (this.socket) this.socket.onopen = this.socket.onmessage = this.socket.onerror = null;
    this.socket?.close(1000, 'left');
    this.socket = null;
    this.stopTimers();
    this.token = '';
    this.saveToken();
    this.latest = null;
    this.pending = [];
    this.unsent = [];
    this.reject?.(new Error('Connection cancelled'));
    this.reject = this.resolve = null;
    this.ready = null;
    this.setState('closed');
  }

  spawn(weapon: WeaponId): Promise<Snapshot> {
    if (this.state !== 'connected' || !this.latest) return Promise.reject(new Error('Wait for the multiplayer connection.'));
    if (this.spawning) return Promise.reject(new Error('Spawn request already pending.'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.spawning = { id, resolve, reject, timeout: window.setTimeout(() => this.cancelSpawn('Spawn request timed out. Try again.'), 5000) };
      this.send({ v: 6, type: 'spawn', requestId: id, weapon, roundId: this.latest!.roundId, mapVersion: this.latest!.mapVersion });
    });
  }

  private cancelSpawn(message: string): void {
    if (!this.spawning) return;
    window.clearTimeout(this.spawning.timeout);
    this.spawning.reject(new Error(message));
    this.spawning = null;
  }
}
