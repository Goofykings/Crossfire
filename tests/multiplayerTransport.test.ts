import { afterEach, expect, it, vi } from 'vitest';
import { MultiplayerClient } from '../src/network/MultiplayerClient';
import { PlayerController, NO_INTENT } from '../src/player/PlayerController';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { Weapon, WEAPONS } from '../src/weapons/Weapon';
import { PROTOCOL_VERSION, type PlayerState, type Snapshot } from '../shared/protocol';
import { createMeleeState } from '../shared/melee';

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
  score: 0, comboCount: 0, comboUntil: null, lastPlayedRound: 0, lastPlayedTeam: null,
  ack: 0, alive: true, health: 100, grenades: 1, combat: { gun: new Weapon(WEAPONS[0]).capture(), triggerHeld: false, reloadHeld: false, grenadeHeld: false, aimHeld: false },
  life: 1, weapon: 'rifle', kills: 0, deaths: 0, team: null, death: null });
const snapshot = (p: PlayerState): Snapshot => ({ result: null, grenades: [], explosions: [], room: 'public-main', mapId: 'european-town', roundId: 0,
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
  socket.receive({ v: PROTOCOL_VERSION, type: 'welcome', selfId: p.id, resumeToken: 'a'.repeat(64), resumed: false, snapshot: snapshot(p) });
  await ready;
  return { socket, p, client };
}
const frames = (s: SocketFixture) => s.sent.filter((m) => m.type === 'input').flatMap((m) => m.frames!);
it('replays melee movement clearance per tick without restarting a pending equip animation',async()=>{
  const {client,p,socket}=await connect();p.combat.melee=createMeleeState();p.combat.gun!.action='idle';
  socket.receive({v:PROTOCOL_VERSION,type:'snapshot',snapshot:snapshot(p)});
  const startedAt=Date.now();
  client.fixedInput(controller,{...NO_INTENT,z:1},{trigger:false,reload:false,melee:true});
  vi.advanceTimersByTime(8);
  client.fixedInput(controller,{...NO_INTENT,z:1},{trigger:false,reload:false,melee:false});
  vi.advanceTimersByTime(8);
  client.fixedInput(controller,{...NO_INTENT,z:1},{trigger:false,reload:false,melee:false});
  vi.advanceTimersByTime(200);
  const clearance:(string|null)[]=[],tick=vi.spyOn(controller,'fixedUpdate').mockImplementation(()=>{clearance.push(controller.weaponClearance);});
  try{
    client.reconcile(controller,snapshot(p),new Weapon(WEAPONS[0]));
    expect(clearance).toEqual(['rifle',null,null]);
    expect(client.melee.phase).toBe('equipping');expect(client.melee.startedAt).toBe(startedAt);
  }finally{tick.mockRestore();}
});
it('merges prop deltas once, rejects stale/foreign rounds and restores authoritative props on resume',async()=>{
  const {socket,p,client}=await connect();
  const state=(id:string,x:number)=>({id,position:{x,y:1,z:0},velocity:{x:0,y:0,z:0},yaw:0,spin:0,angle:0,angularVelocity:0,asleep:true});
  const full={roundId:0,mapVersion:'fixture',seq:0,at:Date.now(),full:true,states:[state('a',0),state('b',1)]};
  socket.receive({v: PROTOCOL_VERSION,type:'snapshot',snapshot:{...snapshot(p),environment:full}});
  const frame={...full,full:false,seq:1,states:[state('a',2)]};
  socket.receive({v: PROTOCOL_VERSION,type:'environment',frame});socket.receive({v: PROTOCOL_VERSION,type:'environment',frame:{...frame,seq:0,states:[state('a',-1)]}});
  socket.receive({v: PROTOCOL_VERSION,type:'environment',frame:{...frame,roundId:1,seq:9}});
  expect(client.environment?.states).toEqual([state('b',1),state('a',2)]);
  socket.close(1012,'actual transport drop');vi.advanceTimersByTime(3000);
  const resumed=SocketFixture.latest;resumed.onopen?.();
  resumed.receive({v: PROTOCOL_VERSION,type:'welcome',selfId:p.id,resumeToken:'a'.repeat(64),resumed:true,
    snapshot:{...snapshot(p),environment:{...full,seq:2,states:[state('a',3),state('b',1)]}}});
  expect(client.state).toBe('connected');expect(client.environment?.states).toEqual([state('a',3),state('b',1)]);
  socket.receive({v: PROTOCOL_VERSION,type:'environment',frame:{...frame,seq:99}});
  expect(client.environment?.seq).toBe(2);
  socket.receive({v: PROTOCOL_VERSION,type:'snapshot',snapshot:{...snapshot(p),roundId:1}});
  resumed.receive({v: PROTOCOL_VERSION,type:'snapshot',snapshot:{...snapshot(p),roundId:1}});
  expect(client.environment).toBeNull();
});
it('preserves the resume credential on navigation, while explicit Leave forgets it', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) });
  const { client, socket } = await connect();
  client.disconnect(false);
  expect([...values.values()]).toContain('a'.repeat(64));
  expect(socket.sent.some((m) => m.type === 'leave')).toBe(false);
  vi.advanceTimersByTime(10000); expect(SocketFixture.instances).toHaveLength(1);
  client.disconnect(); expect(values.size).toBe(0);
});
it('sends real chat messages and reports server rate limits', async () => {
  const { socket, client } = await connect(), received: string[] = [], errors: string[] = [];
  client.onChat = (m) => received.push(`${m.name}: ${m.text}`);
  client.onChatError = (m) => errors.push(m);
  expect(client.sendChat('  hello  ')).toBe(true);
  expect(socket.sent.at(-1)).toMatchObject({ v: PROTOCOL_VERSION, type: 'chat', text: 'hello' });
  expect(client.sendChat('   ')).toBe(false);
  socket.receive({ v: PROTOCOL_VERSION, type: 'chat', id: 'other', name: 'Other', text: 'hello' });
  socket.receive({ v: PROTOCOL_VERSION, type: 'error', code: 'chat_rate', message: 'Please wait', fatal: false });
  expect(received).toEqual(['Other: hello']); expect(errors).toEqual(['Please wait']);
});
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
      setTimeout(() => { p.ack = ack; socket.receive({ v: PROTOCOL_VERSION, type: 'snapshot', snapshot: snapshot(p) }); }, 250);
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
  const elimination = { award: { base: 100, headshot: 0, combo: 0, comboCount: 1, total: 100 }, id: 'death-1', victimLife: 1, direction: { x: 0, y: 0, z: 1 }, roundId: 0,
    victimId: p.id, victimName: p.name, killerId: 'other', killerName: 'Other', weapon: 'rifle', head: false,
    at: 1000, respawnAt: 4000, killerTeam: null, victimTeam: null };
  socket.receive({ v: PROTOCOL_VERSION, type: 'elimination', elimination });
  socket.receive({ v: PROTOCOL_VERSION, type: 'elimination', elimination });
  expect(order).toEqual(['death', 'snapshot']);
  p.life = 2; p.alive = true; p.health = 100;
  socket.receive({ v: PROTOCOL_VERSION, type: 'snapshot', snapshot: snapshot(p) }); order.length = 0;
  socket.receive({ v: PROTOCOL_VERSION, type: 'elimination', elimination: { ...elimination, id: 'late-death' } });
  expect(order).toEqual([]); expect(client.latest?.players[0].alive).toBe(true);
});
it('delivers each valid current-round shot once for remote audio', async () => {
  const { socket, client } = await connect(), received: string[] = [];
  client.onShot = (shot) => received.push(shot.id);
  const shot = { id: 'shot-1', roundId: 0, shooterId: 'other', weapon: 'rifle', hits: [] };
  socket.receive({ v: PROTOCOL_VERSION, type: 'shot', shot });
  socket.receive({ v: PROTOCOL_VERSION, type: 'shot', shot });
  socket.receive({ v: PROTOCOL_VERSION, type: 'shot', shot: { ...shot, id: 'old-shot', roundId: 1 } });
  socket.receive({ v: PROTOCOL_VERSION, type: 'shot', shot: { ...shot, id: 'invalid-shot', weapon: 'fake' } });
  expect(received).toEqual(['shot-1']);
});
it('bounds catch-up batches and outstanding input to the server queue capacity', async () => {
  const { socket, p, client } = await connect();
  for (let i = 0; i < 80; i++) client.fixedInput(controller, { ...NO_INTENT, z: 1 });
  vi.advanceTimersByTime(500);
  expect(frames(socket)).toHaveLength(24);
  p.ack = 12; socket.receive({ v: PROTOCOL_VERSION, type: 'snapshot', snapshot: snapshot(p) });
  vi.advanceTimersByTime(100);
  expect(frames(socket)).toHaveLength(48);
  expect(frames(socket).at(-1)?.seq).toBe(48);
  p.ack = 36; socket.receive({ v: PROTOCOL_VERSION, type: 'snapshot', snapshot: snapshot(p) });
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
  socket.receive({ v: PROTOCOL_VERSION, type: 'snapshot', snapshot: snapshot(p) });
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
    socket.receive({ v: PROTOCOL_VERSION, type: 'pong', at: Date.now() - 250, serverTime: Date.now() });
    vi.advanceTimersByTime(2000);
    client.fixedInput(controller, { ...NO_INTENT, aim: true });
  }
  expect(client.state).toBe('connected'); expect(client.inspect().pending).toBe(120);
  expect(client.inspect().events.some((e) => e.event === 'input_backpressure')).toBe(true);
  p.ack = 24; socket.receive({ v: PROTOCOL_VERSION, type: 'snapshot', snapshot: snapshot(p) });
  vi.advanceTimersByTime(100);
  expect(frames(socket).at(-1)!.seq).toBeGreaterThan(24);
  expect(client.inspect().closes).toBe(0);
});
it('uses all valid traffic for liveness even when pong delivery is delayed', async () => {
  const { socket, p, client } = await connect();
  for (let i = 0; i < 12; i++) {
    vi.advanceTimersByTime(1000);
    socket.receive({ v: PROTOCOL_VERSION, type: 'snapshot', snapshot: snapshot(p) });
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
    socket.receive({ v: PROTOCOL_VERSION, type: 'welcome', selfId: p.id, resumeToken: 'a'.repeat(64), resumed: true, snapshot: snapshot(p) });
    expect(client.state).toBe('connected');
  }
  expect(client.state).toBe('error'); expect(SocketFixture.instances).toHaveLength(6);
  vi.advanceTimersByTime(60000); expect(SocketFixture.instances).toHaveLength(6);
});
it('does not retry a protocol mismatch or a replaced session', async () => {
  const { socket, client } = await connect();
  let warning='';client.onState=(_state,message)=>{warning=message??'';};
  socket.receive({ v: 5, type: 'pong', at: Date.now(), serverTime: Date.now() });
  expect(client.state).toBe('error');
  expect(warning).toContain(`server v5, client v${PROTOCOL_VERSION}`);expect(warning).toContain('Refresh this page');
  vi.advanceTimersByTime(60000); expect(SocketFixture.instances).toHaveLength(1);
});
it('reports an invalid same-version message without pretending the versions differ',async()=>{
  const {socket,client}=await connect();let warning='';client.onState=(_state,message)=>{warning=message??'';};
  socket.receive({v:PROTOCOL_VERSION,type:'snapshot',snapshot:{players:[]}});
  expect(client.state).toBe('error');expect(warning).toContain('Invalid multiplayer message');
  expect(warning).not.toContain('update in progress');vi.advanceTimersByTime(60000);expect(SocketFixture.instances).toHaveLength(1);
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
  socket.receive({ v: PROTOCOL_VERSION, type: 'pong', at: Date.now() - 1000, serverTime: Date.now() });
  expect(client.inspect().lastPong).toBe(Date.now());
  client.disconnect();
  expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  listeners.forEach((fn) => fn()); vi.advanceTimersByTime(60000);
  expect(SocketFixture.instances).toHaveLength(1);
});

it('deduplicates explosion packets, snapshot recovery and reconnect history without hiding new events', async () => {
  const { socket, p, client } = await connect(), events: string[] = [];
  client.onGrenade = (e) => events.push(e.id);
  const explosion = { id:'blast:g',grenadeId:'g',ownerId:'other',ownerLife:1,roundId:0,at:Date.now(),position:{x:0,y:0,z:0},hits:[] };
  socket.receive({v: PROTOCOL_VERSION,type:'grenade',event:{kind:'explode',...explosion}});
  socket.receive({v: PROTOCOL_VERSION,type:'grenade',event:{kind:'explode',...explosion}});
  socket.receive({v: PROTOCOL_VERSION,type:'snapshot',snapshot:{...snapshot(p),explosions:[explosion]}});
  expect(events).toEqual(['blast:g']);
  client.reconnect(); vi.advanceTimersByTime(4000);
  const next=SocketFixture.latest; next.onopen?.();
  next.receive({v: PROTOCOL_VERSION,type:'welcome',selfId:p.id,resumeToken:'a'.repeat(64),resumed:true,snapshot:{...snapshot(p),explosions:[explosion]}});
  expect(events).toEqual(['blast:g']); expect(client.state).toBe('connected');
  next.receive({v: PROTOCOL_VERSION,type:'snapshot',snapshot:{...snapshot(p),explosions:[{...explosion,id:'blast:h',grenadeId:'h'}]}});
  expect(events).toEqual(['blast:g','blast:h']);
  next.receive({v: PROTOCOL_VERSION,type:'grenade',event:{kind:'explode',...explosion,id:'blast:old',grenadeId:'old',roundId:1}});
  expect(events).toHaveLength(2);
});

it('server room removal closes transport state and never retries the kicked session',async()=>{
 const {socket,client}=await connect(),exit=vi.fn();client.onRoomExit=exit;
 socket.receive({v:PROTOCOL_VERSION,type:'room_exit',reason:'afk',message:'You may rejoin.'});
 expect(client.state).toBe('closed');expect(exit).toHaveBeenCalledWith('You may rejoin.');socket.close(4003,'afk');vi.advanceTimersByTime(60000);expect(SocketFixture.instances).toHaveLength(1);
});
