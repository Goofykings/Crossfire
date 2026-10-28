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
  readyState = 1;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: { type: string; frames?: { seq: number }[] }[] = [];
  constructor() { SocketFixture.latest = this; }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
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
async function connect() {
  vi.useFakeTimers(); vi.stubGlobal('window', globalThis); vi.stubGlobal('WebSocket', SocketFixture);
  client = new MultiplayerClient('ws://127.0.0.1:8787/ws');
  const ready = client.connect(), socket = SocketFixture.latest, p = player();
  socket.onopen?.();
  socket.receive({ v: 5, type: 'welcome', selfId: p.id, resumeToken: 'a'.repeat(64), resumed: false, snapshot: snapshot(p) });
  await ready;
  return { socket, p, client };
}
const frames = (s: SocketFixture) => s.sent.filter((m) => m.type === 'input').flatMap((m) => m.frames!);
it('bounds unacknowledged input below the server queue during a render/network backlog', async () => {
  const { socket, p, client } = await connect();
  for (let i = 0; i < 80; i++) client.fixedInput(controller, { ...NO_INTENT, z: 1 });
  vi.advanceTimersByTime(500);
  expect(frames(socket)).toHaveLength(24);
  p.ack = 12; socket.receive({ v: 5, type: 'snapshot', snapshot: snapshot(p) });
  vi.advanceTimersByTime(100);
  expect(frames(socket)).toHaveLength(36);
  expect(frames(socket).at(-1)?.seq).toBe(36);
  p.ack = 36; socket.receive({ v: 5, type: 'snapshot', snapshot: snapshot(p) });
  vi.advanceTimersByTime(100);
  expect(frames(socket)).toHaveLength(60);
});
it('resets the sending window for a new authoritative life and discards old queued input', async () => {
  const { socket, p, client } = await connect();
  for (let i = 0; i < 60; i++) client.fixedInput(controller, { ...NO_INTENT, z: 1 });
  vi.advanceTimersByTime(100);
  p.ack = 12; p.life = 2;
  socket.receive({ v: 5, type: 'snapshot', snapshot: snapshot(p) });
  const before = frames(socket).length;
  for (let i = 0; i < 12; i++) client.fixedInput(controller, { ...NO_INTENT, z: 1 });
  vi.advanceTimersByTime(50);
  expect(frames(socket).slice(before).map((f) => f.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 13));
});
