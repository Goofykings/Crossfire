import { afterEach, expect, it, vi } from 'vitest';
import { MultiplayerClient } from '../src/network/MultiplayerClient';
import { PlayerController, NO_INTENT } from '../src/player/PlayerController';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { Weapon, WEAPONS } from '../src/weapons/Weapon';
import type { PlayerState, Snapshot } from '../shared/protocol';

// Explicit transport unit fixture. Operational multiplayer is tested separately
// with actual Worker/TCP sockets and independent browsers.
class SocketFixture {
  static OPEN = 1;
  static latest: SocketFixture;
  static instances: SocketFixture[] = [];
  readyState = 1;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: { type: string; frames?: { seq: number }[] }[] = [];
  constructor() { SocketFixture.latest = this; SocketFixture.instances.push(this); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close(code = 1000, reason = '') { this.readyState = 3; this.onclose?.({ code, reason, wasClean: true }); }
  receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
const controller = new PlayerController(new CollisionWorld());
const player = (): PlayerState => ({ id: 'transport-unit', name: 'Unit fixture', motion: controller.capture(),
  ack: 0, alive: true, health: 100, combat: { gun: new Weapon(WEAPONS[0]).capture(), triggerHeld: false, reloadHeld: false, aimHeld: false },
  life: 1, weapon: 'rifle', kills: 0, deaths: 0, team: null });
const snapshot = (p: PlayerState): Snapshot => ({ room: 'public-main', mapId: 'european-town', roundId: 0,
  mapVersion: 'fixture', serverTime: Date.now(), match: { mode: 'ffa', endsAt: Date.now() + 600000, teamScores: null }, players: [p] });
let client: MultiplayerClient | undefined;
afterEach(() => { client?.disconnect(); client = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function connect(documentFixture?: object) {
  vi.useFakeTimers(); vi.stubGlobal('window', globalThis); vi.stubGlobal('WebSocket', SocketFixture);
  if (documentFixture) vi.stubGlobal('document', documentFixture);
  SocketFixture.instances = [];
  client = new MultiplayerClient('ws://127.0.0.1:8787/ws');
  const ready = client.connect(), socket = SocketFixture.latest, p = player();
  socket.onopen?.();
  socket.receive({ v: 6, type: 'welcome', selfId: p.id, resumeToken: 'a'.repeat(64), resumed: false, snapshot: snapshot(p) });
  await ready;
  return { socket, p, client };
}
const frames = (s: SocketFixture) => s.sent.filter((m) => m.type === 'input').flatMap((m) => m.frames!);
it('stays connected with continuous input and 250ms acknowledgements while the socket is healthy', async () => {
  const { socket, p, client } = await connect();
  const states: { state: string; after: number }[] = [], start = Date.now();
  client.onState = (state) => states.push({ state, after: Date.now() - start });
  const send = socket.send.bind(socket);
  socket.send = (raw) => {
    send(raw);
    const m = JSON.parse(raw);
    if (m.type === 'input') {
      const ack = m.frames.at(-1).seq;
      setTimeout(() => { p.ack = ack; socket.receive({ v: 6, type: 'snapshot', snapshot: snapshot(p) }); }, 250);
    }
  };
  for (let i = 0; i < 15 * 120; i++) {
    client.fixedInput(controller, { ...NO_INTENT, aim: true });
    vi.advanceTimersByTime(1000 / 120);
  }
  expect(states).toEqual([]);
  expect(client.state).toBe('connected');
  expect(frames(socket).at(-1)!.seq).toBeGreaterThan(1700);
});
it('delivers a confirmed elimination before its dead snapshot, once, and rejects a previous life', async () => {
  const { socket, p, client } = await connect();
  const order: string[] = [];
  client.onElimination = () => order.push('death');
  client.onSnapshot = () => order.push('snapshot');
  const elimination = { id: 'death-1', victimLife: 1, direction: { x: 0, y: 0, z: 1 }, roundId: 0,
    victimId: p.id, victimName: p.name, killerId: 'other', killerName: 'Other', weapon: 'rifle', head: false };
  socket.receive({ v: 6, type: 'elimination', elimination });
  socket.receive({ v: 6, type: 'elimination', elimination });
  expect(order).toEqual(['death', 'snapshot']);
  p.life = 2; p.alive = true; p.health = 100;
  socket.receive({ v: 6, type: 'snapshot', snapshot: snapshot(p) }); order.length = 0;
  socket.receive({ v: 6, type: 'elimination', elimination: { ...elimination, id: 'late-death' } });
  expect(order).toEqual([]); expect(client.latest?.players[0].alive).toBe(true);
});
it('bounds catch-up batches and outstanding input to the server queue capacity', async () => {
  const { socket, p, client } = await connect();
  for (let i = 0; i < 80; i++) client.fixedInput(controller, { ...NO_INTENT, z: 1 });
  vi.advanceTimersByTime(500);
  expect(frames(socket)).toHaveLength(24);
  p.ack = 12; socket.receive({ v: 6, type: 'snapshot', snapshot: snapshot(p) });
  vi.advanceTimersByTime(100);
  expect(frames(socket)).toHaveLength(48);
  expect(frames(socket).at(-1)?.seq).toBe(48);
  p.ack = 36; socket.receive({ v: 6, type: 'snapshot', snapshot: snapshot(p) });
  vi.advanceTimersByTime(100);
  expect(frames(socket)).toHaveLength(72);
  expect(socket.sent.filter((m) => m.type === 'input').every((m) => m.frames!.length <= 12)).toBe(true);
  expect(client.inspect().inFlight).toBeLessThanOrEqual(48);
});
it('resets the sending window for a new authoritative life and discards old queued input', async () => {
  const { socket, p, client } = await connect();
  for (let i = 0; i < 60; i++) client.fixedInput(controller, { ...NO_INTENT, z: 1 });
  vi.advanceTimersByTime(100);
  p.ack = 12; p.life = 2;
  socket.receive({ v: 6, type: 'snapshot', snapshot: snapshot(p) });
  const before = frames(socket).length;
  for (let i = 0; i < 12; i++) client.fixedInput(controller, { ...NO_INTENT, z: 1 });
  vi.advanceTimersByTime(50);
  expect(frames(socket).slice(before).map((f) => f.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 13));
});
it('applies bounded input backpressure without closing a socket receiving valid heartbeats', async () => {
  const { socket, p, client } = await connect();
  for (let i = 0; i < 130; i++) client.fixedInput(controller, { ...NO_INTENT, aim: true });
  vi.advanceTimersByTime(500);
  for (let i = 0; i < 5; i++) {
    socket.receive({ v: 6, type: 'pong', at: Date.now() - 250, serverTime: Date.now() });
    vi.advanceTimersByTime(2000);
    client.fixedInput(controller, { ...NO_INTENT, aim: true });
  }
  expect(client.state).toBe('connected'); expect(client.inspect().pending).toBe(120);
  expect(client.inspect().events.some((e) => e.event === 'input_backpressure')).toBe(true);
  p.ack = 24; socket.receive({ v: 6, type: 'snapshot', snapshot: snapshot(p) });
  vi.advanceTimersByTime(100);
  expect(frames(socket).at(-1)!.seq).toBeGreaterThan(24);
  expect(client.inspect().closes).toBe(0);
});
it('uses all valid traffic for liveness even when pong delivery is delayed', async () => {
  const { socket, p, client } = await connect();
  for (let i = 0; i < 12; i++) {
    vi.advanceTimersByTime(1000);
    socket.receive({ v: 6, type: 'snapshot', snapshot: snapshot(p) });
  }
  expect(client.state).toBe('connected'); expect(client.inspect().closes).toBe(0);
  expect(client.inspect().lastPong).toBe(0);
});
it('detects an open but silent connection, then retries once with jitter and cleans up on Leave', async () => {
  const { socket, client } = await connect();
  vi.advanceTimersByTime(8050);
  expect(client.state).toBe('reconnecting'); expect(socket.readyState).toBe(3);
  const event = client.inspect().events.find((e) => e.event === 'retry_scheduled')!;
  expect(event.detail.delay).toBeGreaterThanOrEqual(240); expect(event.detail.delay).toBeLessThanOrEqual(360);
  expect(event.detail.reason).toBe('receive_timeout');
  vi.advanceTimersByTime(400);
  expect(SocketFixture.instances).toHaveLength(2);
  const replacement = SocketFixture.latest;
  const waiting = client.connect(); expect(waiting).toBe(client.connect());
  const cancelled = expect(waiting).rejects.toThrow('Connection cancelled');
  client.disconnect();
  await cancelled;
  vi.advanceTimersByTime(60000);
  expect(SocketFixture.instances).toHaveLength(2); expect(replacement.readyState).toBe(3);
  expect(vi.getTimerCount()).toBe(0); expect(client.state).toBe('closed');
});
it('bounds rapid connection flapping even when every retry receives a welcome', async () => {
  const { p, client } = await connect();
  for (let i = 0; i < 6; i++) {
    SocketFixture.latest.close(1012, 'service_restart');
    if (i === 5) break;
    vi.advanceTimersByTime(3000);
    const socket = SocketFixture.latest;
    socket.onopen?.();
    socket.receive({ v: 6, type: 'welcome', selfId: p.id, resumeToken: 'a'.repeat(64), resumed: true, snapshot: snapshot(p) });
    expect(client.state).toBe('connected');
  }
  expect(client.state).toBe('error'); expect(SocketFixture.instances).toHaveLength(6);
  vi.advanceTimersByTime(60000); expect(SocketFixture.instances).toHaveLength(6);
});
it('does not retry a protocol mismatch or a replaced session', async () => {
  const { socket, client } = await connect();
  socket.receive({ v: 5, type: 'pong', at: Date.now(), serverTime: Date.now() });
  expect(client.state).toBe('error');
  vi.advanceTimersByTime(60000); expect(SocketFixture.instances).toHaveLength(1);
});
it('does not fight another tab that replaced its session', async () => {
  const { socket, client } = await connect(); socket.close(4001, 'session_replaced');
  expect(client.state).toBe('error');
  vi.advanceTimersByTime(60000); expect(SocketFixture.instances).toHaveLength(1);
});
it('cleans up the welcome deadline and bounds failed handshakes', async () => {
  const { socket, client } = await connect();
  socket.close(1012, 'restart');
  for (let i = 0; i < 5; i++) {
    vi.advanceTimersByTime(3000);
    SocketFixture.latest.onopen?.();
    vi.advanceTimersByTime(5000);
  }
  expect(client.state).toBe('error');
  expect(client.inspect().events.filter((e) => e.event === 'handshake_timeout')).toHaveLength(5);
  expect(vi.getTimerCount()).toBe(0);
});
it('probes on visibility resume without prematurely warning, and removes its listener on Leave', async () => {
  const listeners = new Set<() => void>();
  const doc = { hidden: true, addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
  const { socket, client } = await connect(doc);
  expect(listeners.size).toBe(1);
  vi.advanceTimersByTime(7900);
  doc.hidden = false; listeners.forEach((fn) => fn());
  vi.advanceTimersByTime(1000);
  expect(client.state).toBe('connected');
  socket.receive({ v: 6, type: 'pong', at: Date.now() - 1000, serverTime: Date.now() });
  expect(client.inspect().lastPong).toBe(Date.now());
  client.disconnect();
  expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  listeners.forEach((fn) => fn()); vi.advanceTimersByTime(60000);
  expect(SocketFixture.instances).toHaveLength(1);
});
