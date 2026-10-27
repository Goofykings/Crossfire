import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage, type PlayerState, type Snapshot } from '../shared/protocol';
import { PlayerController } from '../src/player/PlayerController';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { Loadout } from '../src/weapons/Weapon';
import { scoreboardGroups } from '../src/ui/Scoreboard';
import { presenceEndpoint } from '../src/network/endpoint';

const motion = new PlayerController(new CollisionWorld()).capture();
const player = (id: string, kills: number, deaths: number, team: PlayerState['team'] = null): PlayerState => ({
  id, name: id, kills, deaths, team, motion, ack: 0, alive: false, life: 0, weapon: null,
});
const snapshot = (players: PlayerState[]): Snapshot => ({ room: 'public-main', mapId: 'european-town', roundId: 0, mapVersion: 'test',
  serverTime: 1000, players, match: { mode: null, endsAt: null, teamScores: null } });

describe('pre-spawn protocol and loadout', () => {
  it('accepts only implemented loadouts and never client scores, positions or live state', () => {
    const request = { v: 3, type: 'spawn', roundId: 0, mapVersion: 'test', requestId: 'life-1', weapon: 'shotgun' };
    expect(parseClientMessage(JSON.stringify(request))).toEqual(request);
    for (const fields of [{ weapon: 'invalid' }, { alive: true }, { kills: 8 }, { position: { x: 100, y: 0, z: 0 } }, { requestId: '' }]) {
      expect(parseClientMessage(JSON.stringify({ ...request, ...fields }))).toBeNull();
    }
  });
  it('validates authoritative life and score fields instead of accepting malformed snapshots', () => {
    const s = snapshot([player('Connected menu player', 0, 0)]);
    const message = { v: 3, type: 'snapshot', snapshot: s };
    expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
    for (const fields of [{ kills: -1 }, { deaths: 1.5 }, { alive: true, weapon: null }, { life: -1 }, { team: 'fake' }]) {
      expect(parseServerMessage(JSON.stringify({ ...message, snapshot: { ...s, players: [{ ...s.players[0], ...fields }] } }))).toBeNull();
    }
  });
  it('locks every switching path during a life and accepts a different loadout on the next spawn', () => {
    const loadout = new Loadout();
    loadout.reset(2, true);
    expect(loadout.current.stats.id).toBe('sniper');
    loadout.select(0); loadout.cycle(1); loadout.cycle(-1); loadout.selectPrevious();
    expect(loadout.switchingTo).toBeNull();
    expect(loadout.current.stats.id).toBe('sniper');
    loadout.current.ammo = 1;
    loadout.reset(1, true);
    expect(loadout.current.stats.id).toBe('shotgun');
    expect(loadout.current.ammo).toBe(loadout.current.stats.magazine);
    loadout.select(0);
    expect(loadout.switchingTo).toBeNull();
  });
  it('derives read-only HTTP presence from local or secure public endpoints', () => {
    expect(presenceEndpoint('ws://127.0.0.1:8787/ws').href).toBe('http://127.0.0.1:8787/presence');
    expect(presenceEndpoint('wss://example.workers.dev/ws').href).toBe('https://example.workers.dev/presence');
    for (const url of ['', 'ws://public.example/ws', 'https://example.com/ws', 'wss://example.com/ws?token=secret']) expect(() => presenceEndpoint(url)).toThrow();
  });
});

describe('server scoreboard presentation (fixtures, not multiplayer players)', () => {
  it('sorts FFA by kills descending and deaths ascending, including connected menu players', () => {
    const s = snapshot([player('C', 1, 0), player('B', 3, 2), player('A', 3, 1)]);
    s.match.mode = 'ffa';
    expect(scoreboardGroups(s).map((g) => g.players.map((p) => p.id))).toEqual([['A', 'B', 'C']]);
    expect(s.players[0].id).toBe('C'); // Do not mutate the authoritative roster.
  });
  it('preserves Teams assignments and authoritative team scores, keeping unassigned clients visible', () => {
    const s = snapshot([player('Red', 5, 1, 'red'), player('Menu', 0, 0), player('Blue', 2, 4, 'blue')]);
    s.match = { mode: 'teams', endsAt: 601000, teamScores: { blue: 12, red: 8 } };
    const groups = scoreboardGroups(s);
    expect(groups.map((g) => g.label)).toEqual(['BLUE · 12', 'RED · 8', 'UNASSIGNED']);
    expect(groups.map((g) => g.players.map((p) => p.id))).toEqual([['Blue'], ['Red'], ['Menu']]);
  });
});
