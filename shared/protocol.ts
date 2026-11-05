import { roomId, validRoomView, type RoomView } from './rooms';
import { normalizeUsername } from './username';
import { validCareerView, type CareerView } from './challenges';
import { validEnvironmentFrame, type EnvironmentFrame } from './environment';
import { validMap, type MapId } from './maps';
import type { MoveIntent, ControllerState, Vec3 } from '../src/player/PlayerController';
import type { WeaponId, WeaponState } from '../src/weapons/Weapon';
import type { CombatIntent } from './combat';
import { pointsOrder, type ScoreAward, type RoundResult, type RoundStanding } from './scoring';
import { GRENADE, type GrenadeState, type GrenadeEvent, type GrenadeExplosion } from './grenades';

export const PROTOCOL_VERSION = 19;
export const validWeapon = (x: unknown): x is WeaponId => x === 'rifle' || x === 'shotgun' || x === 'sniper' || x === 'smg';
export const PUBLIC_ROOM = 'public-main';
export const INPUT_BATCH_LIMIT = 12;
export const MESSAGE_LIMIT = 8192;
export const NETWORK_HZ = 20;
export const SESSION_GRACE_MS = 15000;
export const HEARTBEAT_TIMEOUT_MS = 10000;
export const RESPAWN_DELAY_MS = 3000;

export interface InputFrame {
  seq: number;
  yaw: number;
  pitch: number;
  intent: MoveIntent;
  combat: CombatIntent;
}
export interface CombatState { gun: WeaponState | null; triggerHeld: boolean; reloadHeld: boolean; aimHeld: boolean; grenadeHeld: boolean }
export interface ShotResult {
  id: string; roundId: number; shooterId: string; weapon: WeaponId; traces?: { from: Vec3; to: Vec3 }[];
  hits: { id: string; life: number; amount: number; health: number; head: boolean; killed: boolean; direction: Vec3 }[];
}
export interface Elimination {
  assists?: {id:string;name:string;points:50}[];
  award: ScoreAward | null;
  id: string; victimLife: number; direction: Vec3 | null;
  roundId: number; victimId: string; victimName: string; killerId: string | null;
  killerName: string | null; weapon: WeaponId | 'grenade' | null; head: boolean;
  at: number; respawnAt: number; killerTeam: 'blue' | 'red' | null; victimTeam: 'blue' | 'red' | null;
}
export interface PlayerState {
  grenades: number;
  score: number;
  comboCount: number;
  comboUntil: number | null;
  lastPlayedRound: number | null;
  lastPlayedTeam: 'blue' | 'red' | null;
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
  assists?: number;
  afkDeadline?:number|null;
  team: 'blue' | 'red' | null;
  /** Last server-confirmed elimination for this life, retained across reconnects. */
  death: Elimination | null;
}
export interface Snapshot {
  environment?:EnvironmentFrame;
  grenades: GrenadeState[];
  explosions: GrenadeExplosion[];
  result: RoundResult | null;
  room: string;
  roomInfo?:RoomView;
  mapId: MapId;
  roundId: number;
  mapVersion: string;
  serverTime: number;
  players: PlayerState[];
  match: { mode: 'ffa' | 'teams' | null; endsAt: number | null; teamScores: { blue: number; red: number } | null };
}
export type ClientMessage =
  | { v: typeof PROTOCOL_VERSION; type: 'join'; name: string; resumeToken?: string; profileToken?: string; roomTicket?:string }
  | { v: typeof PROTOCOL_VERSION; type: 'spawn'; roundId: number; mapVersion: string; weapon: WeaponId; requestId: string }
  | { v: typeof PROTOCOL_VERSION; type: 'input'; roundId: number; mapVersion: string; frames: InputFrame[] }
  | { v: typeof PROTOCOL_VERSION; type: 'ping'; at: number }
  | { v: typeof PROTOCOL_VERSION; type: 'chat'; text: string }
  | { v: typeof PROTOCOL_VERSION; type: 'leave' };
export type ServerMessage =
  | {v:typeof PROTOCOL_VERSION;type:'room_exit';reason:'afk'|'closed';message:string}
  | { v: typeof PROTOCOL_VERSION; type: 'system'; kind: 'player_joined'; id: string; name: string }
  | { v: typeof PROTOCOL_VERSION; type: 'career'; profile: CareerView }
  | { v:typeof PROTOCOL_VERSION;type:'environment';frame:EnvironmentFrame }
  | { v: typeof PROTOCOL_VERSION; type: 'grenade'; event: GrenadeEvent }
  | { v: typeof PROTOCOL_VERSION; type: 'chat'; id: string; name: string; text: string }
  | { v: typeof PROTOCOL_VERSION; type: 'shot'; shot: ShotResult }
  | { v: typeof PROTOCOL_VERSION; type: 'elimination'; elimination: Elimination }
  | { v: typeof PROTOCOL_VERSION; type: 'welcome'; selfId: string; resumeToken: string; resumed: boolean; snapshot: Snapshot }
  | { v: typeof PROTOCOL_VERSION; type: 'spawned'; requestId: string; snapshot: Snapshot }
  | { v: typeof PROTOCOL_VERSION; type: 'snapshot'; snapshot: Snapshot }
  | { v: typeof PROTOCOL_VERSION; type: 'left'; id: string }
  | { v: typeof PROTOCOL_VERSION; type: 'pong'; at: number; serverTime: number }
  | { v: typeof PROTOCOL_VERSION; type: 'error'; code: string; message: string; fatal: boolean };

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const direction = (x: unknown): boolean => record(x) && keys(x, ['x', 'y', 'z'])
  && finite(x.x) && finite(x.y) && finite(x.z) && Math.abs(Math.hypot(x.x, x.y, x.z) - 1) < .001;
const keys = (x: Record<string, unknown>, allowed: string[]) => Object.keys(x).every((k) => allowed.includes(k));
const team = (x: unknown) => x === null || x === 'blue' || x === 'red';
const natural = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
function validStanding(x: unknown): boolean {
  return record(x) && typeof x.id === 'string' && x.id.length <= 64 && typeof x.name === 'string' && x.name.length <= 24
    && team(x.team) && natural(x.score) && natural(x.kills) && natural(x.deaths) && (x.assists===undefined||natural(x.assists))
    && (x.weapon === undefined || x.weapon === null || validWeapon(x.weapon));
}
export function validResult(x: unknown): x is RoundResult {
  if (!record(x) || !natural(x.roundId) || !validMap(x.mapId) || !['ffa', 'teams'].includes(x.mode as string)
    || !natural(x.endedAt) || typeof x.draw !== 'boolean' || !team(x.winningTeam)
    || !(x.winner === null || validStanding(x.winner)) || !(x.mvp === null || validStanding(x.mvp))) return false;
  if (x.players !== undefined) {
    if (!Array.isArray(x.players) || !x.players.every(validStanding)) return false;
    const players = x.players as RoundStanding[];
    if (new Set(players.map((p) => p.id)).size !== players.length) return false;
    // A result must agree with its frozen participants, never the next round's roster.
    const ranked = [...players].sort(pointsOrder);
    const same = (a: unknown, b: typeof players[number] | undefined) => a === null ? b === undefined
      : record(a) && !!b && ['id', 'name', 'team', 'score', 'kills', 'deaths', 'assists'].every((k) => a[k] === b[k as keyof typeof b]);
    if (!same(x.mvp, ranked[0])) return false;
    if (x.mode !== 'teams' && (x.draw !== (!ranked[0] || (ranked.length > 1 && ranked[0].score === ranked[1].score))
      || (!x.draw && !same(x.winner, ranked[0])))) return false;
  }
  if (x.mode !== 'teams') return x.teamScores === null && x.winningTeam === null
    && (x.draw ? x.winner === null : record(x.winner) && record(x.mvp) && x.winner.id === x.mvp.id && x.winner.score === x.mvp.score);
  return x.winner === null && record(x.teamScores) && natural(x.teamScores.blue) && natural(x.teamScores.red)
    && (x.draw ? x.winningTeam === null && x.teamScores.blue === x.teamScores.red
      : x.winningTeam === (x.teamScores.blue > x.teamScores.red ? 'blue' : 'red') && x.teamScores.blue !== x.teamScores.red);
}
function validAward(x: unknown, head: boolean): boolean {
  return record(x) && x.base === 100 && x.headshot === (head ? 50 : 0) && natural(x.comboCount) && x.comboCount > 0
    && x.combo === 20 * (x.comboCount - 1) && natural(x.total) && x.total === x.base + (x.headshot as number) + (x.combo as number);
}
export function validElimination(e: unknown): e is Elimination {
  return record(e) && typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 64
    && Number.isSafeInteger(e.victimLife) && (e.victimLife as number) > 0 && (e.direction === null || direction(e.direction))
    && Number.isSafeInteger(e.roundId) && (e.roundId as number) >= 0 && typeof e.victimId === 'string' && typeof e.victimName === 'string'
    && (e.killerId === null || typeof e.killerId === 'string') && (e.killerName === null || typeof e.killerName === 'string')
    && (e.weapon === null || validWeapon(e.weapon) || e.weapon === 'grenade') && typeof e.head === 'boolean'
    && (!['grenade'].includes(e.weapon as string) || e.head === false)
    && Number.isSafeInteger(e.at) && (e.at as number) >= 0 && e.respawnAt === (e.at as number) + RESPAWN_DELAY_MS
    && (e.assists===undefined || Array.isArray(e.assists)&&e.assists.length<=14&&e.assists.every(a=>record(a)&&keys(a,['id','name','points'])
      &&typeof a.id==='string'&&a.id!==e.killerId&&a.id!==e.victimId&&typeof a.name==='string'&&a.name.length<=24&&a.points===50)
      &&new Set(e.assists.map(a=>(a as {id:string}).id)).size===e.assists.length&&(e.assists.length===0||e.killerId!==null))
    && team(e.killerTeam) && team(e.victimTeam)
    && (e.award === null || (e.killerId !== null && e.killerId !== e.victimId && validAward(e.award, e.head as boolean)));
}

export function validFrame(x: unknown): x is InputFrame {
  if (!record(x) || !keys(x, ['seq', 'yaw', 'pitch', 'intent', 'combat'])) return false;
  if (!record(x.combat) || !keys(x.combat, ['trigger', 'reload', 'grenade', 'grenadeCancel', 'aimYaw', 'aimPitch'])
    || typeof x.combat.trigger !== 'boolean' || typeof x.combat.reload !== 'boolean') return false;
  if (!Number.isSafeInteger(x.seq) || (x.seq as number) < 1 || !finite(x.yaw) || Math.abs(x.yaw) > Math.PI
    || !finite(x.pitch) || Math.abs(x.pitch) > Math.PI / 2 || !record(x.intent)) return false;
  const i = x.intent;
  const c = x.combat;
  if (c.aimYaw !== undefined || c.aimPitch !== undefined) {
    if (!finite(c.aimYaw) || Math.abs(c.aimYaw) > Math.PI || !finite(c.aimPitch) || Math.abs(c.aimPitch) > Math.PI / 2
      || Math.abs(Math.atan2(Math.sin(c.aimYaw - x.yaw), Math.cos(c.aimYaw - x.yaw))) > .35
      || Math.abs(c.aimPitch - x.pitch) > .35) return false;
  }
  return (c.grenadeCancel === undefined || typeof c.grenadeCancel === 'boolean') && !(c.grenadeCancel && c.grenade)
    && (c.grenade === undefined || typeof c.grenade === 'boolean') && (i.crouch === undefined || typeof i.crouch === 'boolean')
    && keys(i, ['x', 'z', 'slide', 'crouch', 'aim', 'jumpPressed', 'lean']) && finite(i.x) && Math.abs(i.x) <= 1
    && (i.lean === undefined || i.lean === -1 || i.lean === 0 || i.lean === 1)
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
    case 'join': return keys(x, ['v', 'type', 'name', 'resumeToken', 'profileToken', 'roomTicket']) && typeof x.name === 'string' && x.name.length <= 64
      && (x.roomTicket===undefined||typeof x.roomTicket==='string'&&/^[a-f0-9]{64}$/.test(x.roomTicket))
      && (x.profileToken === undefined || (typeof x.profileToken === 'string' && /^[a-f0-9]{64}$/.test(x.profileToken)))
      && (x.resumeToken === undefined || (typeof x.resumeToken === 'string' && /^[a-f0-9]{64}$/.test(x.resumeToken))) ? x as unknown as ClientMessage : null;
    case 'input': return keys(x, ['v', 'type', 'roundId', 'mapVersion', 'frames']) && Number.isSafeInteger(x.roundId) && (x.roundId as number) >= 0 && typeof x.mapVersion === 'string'
      && x.mapVersion.length <= 64 && Array.isArray(x.frames) && x.frames.length > 0 && x.frames.length <= INPUT_BATCH_LIMIT
      && x.frames.every(validFrame) ? x as unknown as ClientMessage : null;
    case 'ping': return keys(x, ['v', 'type', 'at']) && finite(x.at) ? x as unknown as ClientMessage : null;
    case 'chat': return keys(x, ['v', 'type', 'text']) && typeof x.text === 'string' && x.text.length > 0 && x.text.length <= 200
      && !/[\u0000-\u001f\u007f]/.test(x.text) && !!x.text.trim() ? x as unknown as ClientMessage : null;
    case 'leave': return keys(x, ['v', 'type']) ? x as unknown as ClientMessage : null;
    default: return null;
  }
}

export function validMotion(x: unknown): x is ControllerState {
  if (!record(x) || ['scale','eyeScale','doubleJump','extraJumpUsed','extraJumpCount'].some(k=>k in x)) return false;
  for (const k of ['position', 'velocity']) {
    if (!record(x[k]) || !['x', 'y', 'z'].every((c) => finite((x[k] as Record<string, unknown>)[c]))) return false;
  }
  return ['yaw', 'pitch', 'crouch', 'airTime', 'jumpBufferTimer', 'slideRemaining', 'slideCooldown', 'slideYaw', 'lean'].every((k) => finite(x[k]))
    && Math.abs(x.lean as number) <= 1
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
  if(x.type==='room_exit')return keys(x,['v','type','reason','message'])&&['afk','closed'].includes(String(x.reason))&&typeof x.message==='string'&&x.message.length<=200?x as unknown as ServerMessage:null;
  if (x.type === 'system') return keys(x, ['v', 'type', 'kind', 'id', 'name'])
    && x.kind === 'player_joined' && typeof x.id === 'string' && /^join:[0-9a-f-]{36}$/.test(x.id)
    && typeof x.name === 'string' && normalizeUsername(x.name) === x.name ? x as unknown as ServerMessage : null;
  if (x.type === 'career') return keys(x, ['v', 'type', 'profile']) && validCareerView(x.profile) ? x as unknown as ServerMessage : null;
  if(x.type==='environment')return keys(x,['v','type','frame'])&&validEnvironmentFrame(x.frame)?x as unknown as ServerMessage:null;
  if (x.type === 'grenade') {
    const e=x.event;
    return keys(x,['v','type','event']) && record(e) && (e.kind==='throw' ? keys(e,['kind','id','projectile']) && typeof e.id==='string' && e.id===`throw:${record(e.projectile)?e.projectile.id:''}` && validGrenade(e.projectile)
      : e.kind==='bounce' ? keys(e,['kind','id','grenadeId','roundId','at','position','strength']) && identifier(e.id) && identifier(e.grenadeId)
        && natural(e.roundId) && natural(e.at) && vector(e.position) && finite(e.strength) && e.strength > 0 && e.strength <= 1
      : e.kind==='explode' && validExplosion(e)) ? x as unknown as ServerMessage : null;
  }
  if (x.type === 'chat') return keys(x, ['v', 'type', 'id', 'name', 'text']) && typeof x.id === 'string' && x.id.length <= 64
    && typeof x.name === 'string' && x.name.length <= 24 && typeof x.text === 'string' && x.text.length > 0 && x.text.length <= 200
    && !/[\u0000-\u001f\u007f]/.test(x.text) ? x as unknown as ServerMessage : null;
  if (x.type === 'shot') {
    const s = x.shot;
    return record(s) && typeof s.id === 'string' && typeof s.shooterId === 'string' && validWeapon(s.weapon)
      && Number.isSafeInteger(s.roundId) && !('fire' in s)
      && (s.traces===undefined || Array.isArray(s.traces) && s.traces.length<=16 && s.traces.every(t=>record(t)&&keys(t,['from','to'])&&vector(t.from)&&vector(t.to))) && Array.isArray(s.hits) && s.hits.length <= 16 && s.hits.every((h) => record(h)
        && typeof h.id === 'string' && Number.isSafeInteger(h.life) && (h.life as number) > 0 && direction(h.direction)
        && finite(h.amount) && h.amount > 0 && h.amount <= 175
        && finite(h.health) && h.health >= 0 && h.health <= 100 && typeof h.head === 'boolean' && typeof h.killed === 'boolean')
      ? x as unknown as ServerMessage : null;
  }
  if (x.type === 'elimination') {
    return validElimination(x.elimination) ? x as unknown as ServerMessage : null;
  }
  if (x.type === 'left' && typeof x.id === 'string') return x as unknown as ServerMessage;
  if (x.type === 'pong' && finite(x.at) && finite(x.serverTime)) return x as unknown as ServerMessage;
  if (x.type === 'error' && typeof x.code === 'string' && typeof x.message === 'string' && typeof x.fatal === 'boolean') return x as unknown as ServerMessage;
  if (x.type !== 'snapshot' && x.type !== 'welcome' && x.type !== 'spawned') return null;
  if (x.type === 'spawned' && typeof x.requestId !== 'string') return null;
  if (x.type === 'welcome' && (typeof x.selfId !== 'string' || typeof x.resumeToken !== 'string' || typeof x.resumed !== 'boolean')) return null;
  const s = x.snapshot;
  if (!record(s) || ('pickups' in s) || (s.environment!==undefined&&!validEnvironmentFrame(s.environment)) || !roomId(s.room) || (s.roomInfo!==undefined&&(!validRoomView(s.roomInfo)||s.roomInfo.id!==s.room)) || !validMap(s.mapId) || !Number.isSafeInteger(s.roundId) || (s.roundId as number) < 0 || typeof s.mapVersion !== 'string' || !finite(s.serverTime)
    || !Array.isArray(s.grenades) || s.grenades.length>32 || !s.grenades.every(g=>validGrenade(g)&&g.roundId===s.roundId)
    || new Set(s.grenades.map(g=>(g as GrenadeState).id)).size!==s.grenades.length
    || !Array.isArray(s.explosions) || s.explosions.length>64 || !s.explosions.every(e=>validExplosion(e)&&e.roundId===s.roundId)
    || !Array.isArray(s.players) || s.players.length > 16 || !s.players.every((p) => record(p) && !('powerup' in p) && !('burn' in p) && typeof p.id === 'string'
      && natural(p.grenades)
      && (p.assists===undefined||natural(p.assists)) && natural(p.score) && natural(p.comboCount) && (p.comboUntil === null || natural(p.comboUntil))
      && (p.comboCount === 0 ? p.comboUntil === null : p.alive === true && p.comboUntil !== null)
      && (p.lastPlayedRound === null || natural(p.lastPlayedRound)) && team(p.lastPlayedTeam)
      && (p.afkDeadline===undefined||p.afkDeadline===null||natural(p.afkDeadline))
      && typeof p.name === 'string' && Number.isSafeInteger(p.ack) && validMotion(p.motion)
      && typeof p.alive === 'boolean' && Number.isSafeInteger(p.life) && (p.life as number) >= 0
      && finite(p.health) && p.health >= 0 && p.health <= 100 && (p.alive ? p.health > 0 : p.health === 0)
      && record(p.combat) && typeof p.combat.triggerHeld === 'boolean' && typeof p.combat.reloadHeld === 'boolean'
      && typeof p.combat.aimHeld === 'boolean'
      && typeof p.combat.grenadeHeld === 'boolean'
      && (p.combat.gun === null ? !p.alive : validGun(p.combat.gun))
      && (p.weapon === null || validWeapon(p.weapon)) && (!p.alive || p.weapon !== null)
      && Number.isSafeInteger(p.kills) && (p.kills as number) >= 0 && Number.isSafeInteger(p.deaths) && (p.deaths as number) >= 0
      && team(p.team) && (p.death === null || (validElimination(p.death) && !p.alive && p.death.victimId === p.id
        && p.death.victimLife === p.life && p.death.roundId <= (s.roundId as number))))) return null;
  if (!(s.result === null || (validResult(s.result) && s.result.roundId < (s.roundId as number)))) return null;
  const m = s.match;
  if (!record(m) || ![null, 'ffa', 'teams'].includes(m.mode as null | string) || !(m.endsAt === null || finite(m.endsAt))
    || !(m.teamScores === null || (record(m.teamScores) && ['blue', 'red'].every((k) => Number.isSafeInteger((m.teamScores as Record<string, unknown>)[k])
      && ((m.teamScores as Record<string, unknown>)[k] as number) >= 0)))) return null;
  return x as unknown as ServerMessage;
}

const vector = (x: unknown): x is Vec3 => record(x) && keys(x,['x','y','z']) && ['x','y','z'].every(k=>finite(x[k])&&Math.abs(x[k] as number)<1000);
const identifier = (x: unknown): x is string => typeof x==='string' && x.length>0 && x.length<=64;
export function validGrenade(x: unknown): x is GrenadeState {
  return record(x) && keys(x,['id','ownerId','ownerLife','roundId','at','explodeAt','updatedAt','position','velocity'])
    && identifier(x.id)&&identifier(x.ownerId)&&natural(x.ownerLife)&&x.ownerLife>0&&natural(x.roundId)
    && natural(x.at)&&x.explodeAt===x.at+GRENADE.fuseMs&&finite(x.updatedAt)&&x.updatedAt>=x.at&&x.updatedAt<=x.explodeAt
    && vector(x.position)&&vector(x.velocity);
}
export function validExplosion(x: unknown): x is GrenadeExplosion {
  return record(x)&&keys(x,['kind','id','grenadeId','ownerId','ownerLife','roundId','at','position','hits'])&&identifier(x.id)&&identifier(x.grenadeId)&&x.id===`blast:${x.grenadeId}`&&identifier(x.ownerId)
    && natural(x.ownerLife)&&x.ownerLife>0&&natural(x.roundId)&&natural(x.at)&&vector(x.position)
    && Array.isArray(x.hits)&&x.hits.length<=16&&x.hits.every(h=>record(h)&&identifier(h.id)&&natural(h.life)&&h.life>0
      && finite(h.amount)&&h.amount>0&&h.amount<=GRENADE.damage&&finite(h.health)&&h.health>=0&&h.health<=100
      && typeof h.killed==='boolean'&&h.killed===(h.health===0)&&direction(h.direction))&&new Set(x.hits.map(h=>h.id)).size===x.hits.length;
}
