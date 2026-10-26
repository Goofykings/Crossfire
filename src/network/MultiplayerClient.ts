import { FIXED_DT } from '../config/constants';
import type { MoveIntent, PlayerController } from '../player/PlayerController';
import { INPUT_BATCH_LIMIT, NETWORK_HZ, parseServerMessage, type ClientMessage, type InputFrame,
  type ServerMessage, type Snapshot } from '../../shared/protocol';

type Welcome = Extract<ServerMessage, { type: 'welcome' }>;
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed';

/** Real WebSocket transport. Its timers are independent of the render loop. */
export class MultiplayerClient {
  state: ConnectionState = 'idle';
  selfId = '';
  latest: Snapshot | null = null;
  clockOffset = 0;
  onSnapshot: (snapshot: Snapshot) => void = () => {};
  onState: (state: ConnectionState, message?: string) => void = () => {};
  private socket: WebSocket | null = null;
  private token = '';
  private attempts = 0;
  private sequence = 0;
  private stopped = false;
  private pending: InputFrame[] = [];
  private unsent: InputFrame[] = [];
  private flushTimer = 0;
  private pingTimer = 0;
  private retryTimer = 0;
  private deadline = 0;
  private lastMessage = 0;
  private resolve: ((w: Welcome) => void) | null = null;
  private reject: ((e: Error) => void) | null = null;
  private ready: Promise<Welcome> | null = null;
  private fatal = false;
  private lastYaw = NaN;
  private lastPitch = NaN;
  private readonly url: string;

  constructor(url: string, private readonly name = 'Player') {
    if (!url) throw new Error('Set VITE_MULTIPLAYER_URL to the local or public WebSocket endpoint.');
    const parsed = new URL(url);
    if (parsed.protocol !== 'wss:' && !(parsed.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
      throw new Error('Multiplayer requires wss://, or ws:// on localhost for development.');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Use a WebSocket endpoint without credentials or query parameters.');
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
  private setState(state: ConnectionState, message?: string): void { this.state = state; this.onState(state, message); }

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
    this.fatal = false;
    this.setState(this.attempts ? 'reconnecting' : 'connecting');
    this.pending = [];
    this.unsent = [];
    this.lastYaw = this.lastPitch = NaN;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.deadline = window.setTimeout(() => socket.close(), 5000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.send({ v: 1, type: 'join', name: this.name, ...(this.token ? { resumeToken: this.token } : {}) });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      const m = parseServerMessage(event.data);
      if (!m) { this.fail('Invalid message from multiplayer server'); socket.close(); return; }
      this.lastMessage = Date.now();
      if (m.type === 'error') {
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
        this.pending = [];
        this.unsent = [];
        this.attempts = 0;
        this.clockOffset = m.snapshot.serverTime - Date.now();
        this.latest = m.snapshot;
        this.setState('connected');
        this.startTimers();
        this.resolve?.(m);
        this.resolve = this.reject = null;
        this.onSnapshot(m.snapshot);
      } else if (m.type === 'snapshot') {
        this.latest = m.snapshot;
        const ack = m.snapshot.players.find((p) => p.id === this.selfId)?.ack ?? 0;
        this.pending = this.pending.filter((f) => f.seq > ack);
        this.onSnapshot(m.snapshot);
      } else if (m.type === 'left' && this.latest) {
        this.latest = { ...this.latest, players: this.latest.players.filter((p) => p.id !== m.id) };
        this.onSnapshot(this.latest);
      } else if (m.type === 'pong') {
        this.clockOffset = m.serverTime - (m.at + Date.now()) / 2;
      }
    };
    socket.onerror = () => { /* Close gives a single retry path, including failed upgrade handshakes. */ };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.stopTimers();
      this.socket = null;
      this.pending = this.unsent = [];
      if (this.stopped || this.fatal) return;
      if (event.code === 4001) {
        // Duplicated tabs may copy sessionStorage. Do not fight the replacement
        // connection in a reconnect loop; Retry can create a separate identity.
        this.token = '';
        this.saveToken();
        this.fail('This session was opened in another tab. Retry to join as a new player.');
        return;
      }
      if (++this.attempts > 5) { this.fail('Unable to connect to the multiplayer server. Check the endpoint and allowed origin, then Retry.'); return; }
      this.setState('reconnecting', 'Connection lost; reconnecting…');
      this.retryTimer = window.setTimeout(() => this.open(), Math.min(3000, 300 * 2 ** (this.attempts - 1)));
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
    this.flushTimer = window.setInterval(() => {
      if (Date.now() - this.lastMessage > 8000) { this.socket?.close(); return; }
      if (this.unsent.length && this.latest && (this.socket?.bufferedAmount ?? 0) < 32768) {
        this.send({ v: 1, type: 'input', mapVersion: this.latest.mapVersion, frames: this.unsent.splice(0, INPUT_BATCH_LIMIT) });
      }
    }, 1000 / NETWORK_HZ);
    this.pingTimer = window.setInterval(() => this.send({ v: 1, type: 'ping', at: Date.now() }), 2000);
  }
  private stopTimers(): void {
    for (const t of [this.flushTimer, this.pingTimer]) window.clearInterval(t);
    window.clearTimeout(this.deadline);
    window.clearTimeout(this.retryTimer);
  }
  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  fixedInput(player: PlayerController, intent: MoveIntent): void {
    if (this.state !== 'connected') return;
    const yaw = Math.atan2(Math.sin(player.yaw), Math.cos(player.yaw));
    // No need to stream 120 identical standing frames per second. The room's
    // neutral input still settles gravity/friction, and heartbeats maintain liveness.
    if (player.grounded && Math.hypot(player.velocity.x, player.velocity.y, player.velocity.z) < 0.001
      && player.crouch === 0 && !intent.crouch && !intent.jumpPressed && intent.x === 0 && intent.z === 0
      && yaw === this.lastYaw && player.pitch === this.lastPitch) return;
    if (this.pending.length >= 120) { this.reconnect(); return; }
    this.lastYaw = yaw;
    this.lastPitch = player.pitch;
    const frame: InputFrame = { seq: ++this.sequence, yaw, pitch: player.pitch, intent: { ...intent } };
    this.pending.push(frame);
    this.unsent.push(frame);
  }

  reconcile(player: PlayerController, snapshot: Snapshot): void {
    const self = snapshot.players.find((p) => p.id === this.selfId);
    if (!self) return;
    const yaw = player.yaw, pitch = player.pitch;
    player.restore(self.motion);
    for (const frame of this.pending) {
      if (frame.seq <= self.ack) continue;
      player.yaw = frame.yaw;
      player.pitch = frame.pitch;
      player.fixedUpdate(FIXED_DT, frame.intent);
    }
    // Snapshots must not overwrite mouse look that has not reached a fixed tick yet.
    player.yaw = yaw;
    player.pitch = pitch;
  }

  /** Deliberate transport interruption for diagnostics; resumes the existing authenticated session. */
  reconnect(): void {
    if (!this.socket || this.stopped) return;
    this.setState('reconnecting', 'Connection interrupted; reconnecting…');
    this.socket.close(4000, 'reconnect');
  }

  disconnect(): void {
    this.stopped = true;
    this.send({ v: 1, type: 'leave' });
    this.socket?.close(1000, 'left');
    this.socket = null;
    this.stopTimers();
    this.token = '';
    this.saveToken();
    this.latest = null;
    this.pending = this.unsent = [];
    this.reject?.(new Error('Connection cancelled'));
    this.reject = this.resolve = null;
    this.ready = null;
    this.setState('closed');
  }
}
