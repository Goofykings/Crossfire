import { validMap, type MapId } from './maps';
import type { MoveIntent, ControllerState } from '../src/player/PlayerController';
import type { WeaponId } from '../src/weapons/Weapon';

export const PROTOCOL_VERSION = 3;
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
}
export interface PlayerState {
  id: string;
  name: string;
  motion: ControllerState;
  ack: number;
  alive: boolean;
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
  | { v: 3; type: 'join'; name: string; resumeToken?: string }
  | { v: 3; type: 'spawn'; roundId: number; mapVersion: string; weapon: WeaponId; requestId: string }
  | { v: 3; type: 'input'; roundId: number; mapVersion: string; frames: InputFrame[] }
  | { v: 3; type: 'ping'; at: number }
  | { v: 3; type: 'leave' };
export type ServerMessage =
  | { v: 3; type: 'welcome'; selfId: string; resumeToken: string; resumed: boolean; snapshot: Snapshot }
  | { v: 3; type: 'spawned'; requestId: string; snapshot: Snapshot }
  | { v: 3; type: 'snapshot'; snapshot: Snapshot }
  | { v: 3; type: 'left'; id: string }
  | { v: 3; type: 'pong'; at: number; serverTime: number }
  | { v: 3; type: 'error'; code: string; message: string; fatal: boolean };

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const keys = (x: Record<string, unknown>, allowed: string[]) => Object.keys(x).every((k) => allowed.includes(k));

export function validFrame(x: unknown): x is InputFrame {
  if (!record(x) || !keys(x, ['seq', 'yaw', 'pitch', 'intent'])) return false;
  if (!Number.isSafeInteger(x.seq) || (x.seq as number) < 1 || !finite(x.yaw) || Math.abs(x.yaw) > Math.PI
    || !finite(x.pitch) || Math.abs(x.pitch) > Math.PI / 2 || !record(x.intent)) return false;
  const i = x.intent;
  return keys(i, ['x', 'z', 'sprint', 'crouch', 'aim', 'jumpPressed']) && finite(i.x) && Math.abs(i.x) <= 1
    && finite(i.z) && Math.abs(i.z) <= 1 && ['sprint', 'crouch', 'aim', 'jumpPressed'].every((k) => typeof i[k] === 'boolean');
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
  return ['yaw', 'pitch', 'crouch', 'airTime', 'jumpBufferTimer'].every((k) => finite(x[k]))
    && typeof x.grounded === 'boolean' && typeof x.jumpedThisAirborne === 'boolean';
}

export function parseServerMessage(text: string): ServerMessage | null {
  if (text.length > 131072) return null;
  let x: unknown;
  try { x = JSON.parse(text); } catch { return null; }
  if (!record(x) || x.v !== PROTOCOL_VERSION) return null;
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
      && (p.weapon === null || validWeapon(p.weapon)) && (!p.alive || p.weapon !== null)
      && Number.isSafeInteger(p.kills) && (p.kills as number) >= 0 && Number.isSafeInteger(p.deaths) && (p.deaths as number) >= 0
      && (p.team === null || p.team === 'blue' || p.team === 'red'))) return null;
  const m = s.match;
  if (!record(m) || ![null, 'ffa', 'teams'].includes(m.mode as null | string) || !(m.endsAt === null || finite(m.endsAt))
    || !(m.teamScores === null || (record(m.teamScores) && ['blue', 'red'].every((k) => Number.isSafeInteger((m.teamScores as Record<string, unknown>)[k])
      && ((m.teamScores as Record<string, unknown>)[k] as number) >= 0)))) return null;
  return x as unknown as ServerMessage;
}
