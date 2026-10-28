import { validMap, type MapId } from './maps';
import type { MoveIntent, ControllerState } from '../src/player/PlayerController';
import type { WeaponId, WeaponState } from '../src/weapons/Weapon';
import type { CombatIntent } from './combat';

export const PROTOCOL_VERSION = 5;
export const validWeapon = (x: unknown): x is WeaponId => x === 'rifle' || x === 'shotgun' || x === 'sniper' || x === 'smg';
export const PUBLIC_ROOM = 'public-main';
export const INPUT_BATCH_LIMIT = 12;
export const MESSAGE_LIMIT = 8192;
export const NETWORK_HZ = 20;
export const SESSION_GRACE_MS = 15000;
export const HEARTBEAT_TIMEOUT_MS = 10000;

export interface InputFrame {
  seq: number;
  yaw: number;
  pitch: number;
  intent: MoveIntent;
  combat: CombatIntent;
}
export interface CombatState { gun: WeaponState | null; triggerHeld: boolean; reloadHeld: boolean; aimHeld: boolean }
export interface ShotResult {
  id: string; roundId: number; shooterId: string; weapon: WeaponId;
  hits: { id: string; amount: number; health: number; head: boolean; killed: boolean }[];
}
export interface Elimination {
  roundId: number; victimId: string; victimName: string; killerId: string | null;
  killerName: string | null; weapon: WeaponId | null; head: boolean;
}
export interface PlayerState {
  id: string;
  name: string;
  motion: ControllerState;
  ack: number;
  alive: boolean;
  health: number;
  combat: CombatState;
  life: number;
  weapon: WeaponId | null;
  kills: number;
  deaths: number;
  team: 'blue' | 'red' | null;
}
export interface Snapshot {
  room: typeof PUBLIC_ROOM;
  mapId: MapId;
  roundId: number;
  mapVersion: string;
  serverTime: number;
  players: PlayerState[];
  match: { mode: 'ffa' | 'teams' | null; endsAt: number | null; teamScores: { blue: number; red: number } | null };
}
export type ClientMessage =
  | { v: 5; type: 'join'; name: string; resumeToken?: string }
  | { v: 5; type: 'spawn'; roundId: number; mapVersion: string; weapon: WeaponId; requestId: string }
  | { v: 5; type: 'input'; roundId: number; mapVersion: string; frames: InputFrame[] }
  | { v: 5; type: 'ping'; at: number }
  | { v: 5; type: 'leave' };
export type ServerMessage =
  | { v: 5; type: 'shot'; shot: ShotResult }
  | { v: 5; type: 'elimination'; elimination: Elimination }
  | { v: 5; type: 'welcome'; selfId: string; resumeToken: string; resumed: boolean; snapshot: Snapshot }
  | { v: 5; type: 'spawned'; requestId: string; snapshot: Snapshot }
  | { v: 5; type: 'snapshot'; snapshot: Snapshot }
  | { v: 5; type: 'left'; id: string }
  | { v: 5; type: 'pong'; at: number; serverTime: number }
  | { v: 5; type: 'error'; code: string; message: string; fatal: boolean };

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const keys = (x: Record<string, unknown>, allowed: string[]) => Object.keys(x).every((k) => allowed.includes(k));

export function validFrame(x: unknown): x is InputFrame {
  if (!record(x) || !keys(x, ['seq', 'yaw', 'pitch', 'intent', 'combat'])) return false;
  if (!record(x.combat) || !keys(x.combat, ['trigger', 'reload'])
    || typeof x.combat.trigger !== 'boolean' || typeof x.combat.reload !== 'boolean') return false;
  if (!Number.isSafeInteger(x.seq) || (x.seq as number) < 1 || !finite(x.yaw) || Math.abs(x.yaw) > Math.PI
    || !finite(x.pitch) || Math.abs(x.pitch) > Math.PI / 2 || !record(x.intent)) return false;
  const i = x.intent;
  return keys(i, ['x', 'z', 'slide', 'aim', 'jumpPressed']) && finite(i.x) && Math.abs(i.x) <= 1
    && finite(i.z) && Math.abs(i.z) <= 1 && ['slide', 'aim', 'jumpPressed'].every((k) => typeof i[k] === 'boolean');
}

export function parseClientMessage(text: string): ClientMessage | null {
  if (text.length > MESSAGE_LIMIT) return null;
  let x: unknown;
  try { x = JSON.parse(text); } catch { return null; }
  if (!record(x) || x.v !== PROTOCOL_VERSION) return null;
  switch (x.type) {
    case 'spawn': return keys(x, ['v', 'type', 'roundId', 'mapVersion', 'weapon', 'requestId']) && validWeapon(x.weapon)
      && Number.isSafeInteger(x.roundId) && (x.roundId as number) >= 0 && typeof x.mapVersion === 'string' && x.mapVersion.length <= 64 && typeof x.requestId === 'string'
      && /^[a-zA-Z0-9-]{1,48}$/.test(x.requestId) ? x as unknown as ClientMessage : null;
    case 'join': return keys(x, ['v', 'type', 'name', 'resumeToken']) && typeof x.name === 'string' && x.name.length <= 64
      && (x.resumeToken === undefined || (typeof x.resumeToken === 'string' && /^[a-f0-9]{64}$/.test(x.resumeToken))) ? x as unknown as ClientMessage : null;
    case 'input': return keys(x, ['v', 'type', 'roundId', 'mapVersion', 'frames']) && Number.isSafeInteger(x.roundId) && (x.roundId as number) >= 0 && typeof x.mapVersion === 'string'
      && x.mapVersion.length <= 64 && Array.isArray(x.frames) && x.frames.length > 0 && x.frames.length <= INPUT_BATCH_LIMIT
      && x.frames.every(validFrame) ? x as unknown as ClientMessage : null;
    case 'ping': return keys(x, ['v', 'type', 'at']) && finite(x.at) ? x as unknown as ClientMessage : null;
    case 'leave': return keys(x, ['v', 'type']) ? x as unknown as ClientMessage : null;
    default: return null;
  }
}

export function validMotion(x: unknown): x is ControllerState {
  if (!record(x)) return false;
  for (const k of ['position', 'velocity']) {
    if (!record(x[k]) || !['x', 'y', 'z'].every((c) => finite((x[k] as Record<string, unknown>)[c]))) return false;
  }
  return ['yaw', 'pitch', 'crouch', 'airTime', 'jumpBufferTimer', 'slideRemaining', 'slideCooldown', 'slideYaw'].every((k) => finite(x[k]))
    && typeof x.slideHeld === 'boolean' && (x.crouch as number) >= 0 && (x.crouch as number) <= 1
    && (x.slideRemaining as number) >= 0 && (x.slideRemaining as number) <= 1
    && (x.slideCooldown as number) >= 0 && (x.slideCooldown as number) <= 1
    && typeof x.grounded === 'boolean' && typeof x.jumpedThisAirborne === 'boolean';
}

export function validGun(x: unknown): x is WeaponState {
  if (!record(x) || !Number.isSafeInteger(x.ammo) || (x.ammo as number) < 0 || (x.ammo as number) > 32) return false;
  return ['idle', 'equip', 'holster', 'holstered', 'cycle', 'reload', 'reloadEmpty', 'shellStart', 'shell', 'shellEnd'].includes(x.action as string)
    && ['ads', 'progress'].every((k) => finite(x[k]) && x[k] >= 0 && x[k] <= 1)
    && ['time', 'duration', 'cooldown', 'bloom', 'emptyClickCooldown'].every((k) => finite(x[k]) && x[k] >= 0 && x[k] < 120)
    && typeof x.stopLoading === 'boolean' && typeof x.fromEmpty === 'boolean'
    && Array.isArray(x.cues) && x.cues.length <= 24 && x.cues.every((c) => record(c) && finite(c.at) && c.at >= 0 && c.at <= 1
      && typeof c.cue === 'string' && c.cue.length <= 32);
}

export function parseServerMessage(text: string): ServerMessage | null {
  if (text.length > 131072) return null;
  let x: unknown;
  try { x = JSON.parse(text); } catch { return null; }
  if (!record(x) || x.v !== PROTOCOL_VERSION) return null;
  if (x.type === 'shot') {
    const s = x.shot;
    return record(s) && typeof s.id === 'string' && typeof s.shooterId === 'string' && validWeapon(s.weapon)
      && Number.isSafeInteger(s.roundId) && Array.isArray(s.hits) && s.hits.length <= 16 && s.hits.every((h) => record(h)
        && typeof h.id === 'string' && finite(h.amount) && h.amount > 0 && h.amount <= 100
        && finite(h.health) && h.health >= 0 && h.health <= 100 && typeof h.head === 'boolean' && typeof h.killed === 'boolean')
      ? x as unknown as ServerMessage : null;
  }
  if (x.type === 'elimination') {
    const e = x.elimination;
    return record(e) && Number.isSafeInteger(e.roundId) && typeof e.victimId === 'string' && typeof e.victimName === 'string'
      && (e.killerId === null || typeof e.killerId === 'string') && (e.killerName === null || typeof e.killerName === 'string')
      && (e.weapon === null || validWeapon(e.weapon)) && typeof e.head === 'boolean' ? x as unknown as ServerMessage : null;
  }
  if (x.type === 'left' && typeof x.id === 'string') return x as unknown as ServerMessage;
  if (x.type === 'pong' && finite(x.at) && finite(x.serverTime)) return x as unknown as ServerMessage;
  if (x.type === 'error' && typeof x.code === 'string' && typeof x.message === 'string' && typeof x.fatal === 'boolean') return x as unknown as ServerMessage;
  if (x.type !== 'snapshot' && x.type !== 'welcome' && x.type !== 'spawned') return null;
  if (x.type === 'spawned' && typeof x.requestId !== 'string') return null;
  if (x.type === 'welcome' && (typeof x.selfId !== 'string' || typeof x.resumeToken !== 'string' || typeof x.resumed !== 'boolean')) return null;
  const s = x.snapshot;
  if (!record(s) || s.room !== PUBLIC_ROOM || !validMap(s.mapId) || !Number.isSafeInteger(s.roundId) || (s.roundId as number) < 0 || typeof s.mapVersion !== 'string' || !finite(s.serverTime)
    || !Array.isArray(s.players) || s.players.length > 16 || !s.players.every((p) => record(p) && typeof p.id === 'string'
      && typeof p.name === 'string' && Number.isSafeInteger(p.ack) && validMotion(p.motion)
      && typeof p.alive === 'boolean' && Number.isSafeInteger(p.life) && (p.life as number) >= 0
      && finite(p.health) && p.health >= 0 && p.health <= 100 && (p.alive ? p.health > 0 : p.health === 0)
      && record(p.combat) && typeof p.combat.triggerHeld === 'boolean' && typeof p.combat.reloadHeld === 'boolean'
      && typeof p.combat.aimHeld === 'boolean'
      && (p.combat.gun === null ? !p.alive : validGun(p.combat.gun))
      && (p.weapon === null || validWeapon(p.weapon)) && (!p.alive || p.weapon !== null)
      && Number.isSafeInteger(p.kills) && (p.kills as number) >= 0 && Number.isSafeInteger(p.deaths) && (p.deaths as number) >= 0
      && (p.team === null || p.team === 'blue' || p.team === 'red'))) return null;
  const m = s.match;
  if (!record(m) || ![null, 'ffa', 'teams'].includes(m.mode as null | string) || !(m.endsAt === null || finite(m.endsAt))
    || !(m.teamScores === null || (record(m.teamScores) && ['blue', 'red'].every((k) => Number.isSafeInteger((m.teamScores as Record<string, unknown>)[k])
      && ((m.teamScores as Record<string, unknown>)[k] as number) >= 0)))) return null;
  return x as unknown as ServerMessage;
}
