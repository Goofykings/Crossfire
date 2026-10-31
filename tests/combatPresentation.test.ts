import { expect, it } from 'vitest';
import { damageHaze, damageTurn, deathPose } from '../src/game/CombatPresentation';
import { parseClientMessage, parseServerMessage } from '../shared/protocol';
import { combatRelationship } from '../src/ui/CombatFeed';

it('colors kill-feed names relative to the local player and actual teams', () => {
  expect(combatRelationship('ffa', 'me', null, 'me', null)).toBe('friendly');
  expect(combatRelationship('ffa', 'me', null, 'other1', null)).toBe('opponent');
  expect(combatRelationship('ffa', 'me', null, 'other2', null)).toBe('opponent');
  expect(combatRelationship('teams', 'me', 'red', 'ally', 'red')).toBe('friendly');
  expect(combatRelationship('teams', 'me', 'red', 'enemy', 'blue')).toBe('opponent');
  expect(combatRelationship('teams', 'me', null, 'unassigned', null)).toBe('opponent');
});

it('weights the actual incoming ray against current camera yaw/pitch for directional edge haze', () => {
  const right = damageHaze({ x: -1, y: 0, z: 0 }, 0);
  expect(right).toEqual({ left: 0, right: 1, top: 0, bottom: 0 });
  expect(damageHaze({ x: 1, y: 0, z: 0 }, 0)).toEqual({ ...right, left: 1, right: 0 });
  const front = damageHaze({ x: 0, y: 0, z: 1 }, 0), rear = damageHaze({ x: 0, y: 0, z: -1 }, 0);
  expect(front.top).toBeGreaterThan(front.left); expect(front.bottom).toBe(0);
  expect(rear.bottom).toBe(1); expect(rear.left).toBeGreaterThan(0); expect(rear.right).toBeGreaterThan(0);
  for (const [edge, weight] of Object.entries(damageHaze({ x: -1, y: 0, z: 0 }, -Math.PI / 2))) {
    expect(weight).toBeCloseTo(front[edge as keyof typeof front]);
  }
  expect(damageHaze({ x: 0, y: -1, z: 0 }, 0, Math.PI / 2).top).toBeCloseTo(front.top);
  for (let yaw = -Math.PI; yaw <= Math.PI; yaw += .1) for (const weight of Object.values(damageHaze({ x: -1, y: 0, z: 0 }, yaw))) {
    expect(weight).toBeGreaterThanOrEqual(0); expect(weight).toBeLessThanOrEqual(1);
  }
});

it('indicates the shortest turn toward the attacker for all sides and yaw wraparound', () => {
  expect(damageTurn({ x: 0, y: 0, z: 1 }, 0)).toBe(0);
  expect(damageTurn({ x: -1, y: 0, z: 0 }, 0)).toBe(1);
  expect(damageTurn({ x: 1, y: 0, z: 0 }, 0)).toBe(-1);
  expect(damageTurn({ x: -.1, y: 0, z: -1 }, 0)).toBe(1);
  expect(damageTurn({ x: .1, y: 0, z: -1 }, 0)).toBe(-1);
  expect(damageTurn({ x: 0, y: 0, z: -1 }, 0)).toBe(1);
  expect(damageTurn({ x: 1, y: 0, z: 0 }, Math.PI / 2)).toBe(0);
  expect(damageTurn({ x: .01, y: 0, z: -1 }, -Math.PI + .02)).toBe(0);
  expect(damageTurn({ x: 0, y: -1, z: 0 }, 1)).toBe(0);
});
it('falls along the world-space incoming ray and fades completely in half a second', () => {
  for (const dir of [{ x: 1, y: -.2, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }]) {
    const start = deathPose(0, dir), mid = deathPose(.25, dir), end = deathPose(.5, dir);
    expect(start.opacity).toBe(1); expect(start.tip).toBe(0);
    expect(mid.opacity).toBeCloseTo(.5); expect(mid.tip).toBeGreaterThan(1);
    expect(mid.fall.x).toBe(dir.x); expect(mid.fall.z).toBe(dir.z);
    expect(mid.lift).toBeGreaterThanOrEqual(0);
    expect(end.done).toBe(true); expect(end.opacity).toBe(0);
  }
  expect(deathPose(2, null).opacity).toBe(0);
});
const elimination = { id: 'death-unit', victimLife: 2, direction: { x: 0, y: 0, z: 1 }, roundId: 1,
  victimId: 'victim', victimName: 'Victim', killerId: 'killer', killerName: 'Killer', weapon: 'rifle', head: false,
  at: 1000, respawnAt: 4000, killerTeam: null, victimTeam: null };
it('validates actual server direction vectors and rejects old or client-invented combat events', () => {
  const message = { v: 9, type: 'elimination', elimination };
  expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
  expect(parseServerMessage(JSON.stringify({ ...message, v: 5 }))).toBeNull();
  expect(parseServerMessage(JSON.stringify({ ...message, elimination: { ...elimination, respawnAt: 3999 } }))).toBeNull();
  for (const direction of [{ x: 0, y: 0, z: 0 }, { x: 99, y: 0, z: 1 }, { x: null, y: 0, z: 1 }, { x: 0, z: 1 }]) {
    expect(parseServerMessage(JSON.stringify({ ...message, elimination: { ...elimination, direction } }))).toBeNull();
  }
  expect(parseClientMessage(JSON.stringify(message))).toBeNull();
  expect(parseClientMessage(JSON.stringify({ v: 9, type: 'damage', direction: { x: 0, y: 0, z: 1 }, amount: 100 }))).toBeNull();
});
