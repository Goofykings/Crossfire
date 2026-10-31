import { describe, expect, it } from 'vitest';
import { rayPlayer, roundMode, teammates } from '../shared/combat';
import { PlayerController } from '../src/player/PlayerController';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { Weapon, WEAPONS } from '../src/weapons/Weapon';
import { FIXED_DT } from '../src/config/constants';
import { validGun, parseClientMessage } from '../shared/protocol';
import { zoneDamage } from '../src/game/Damage';

it('distinguishes heads and bodies, including the lowered sliding collider', () => {
  const p = new PlayerController(new CollisionWorld()).capture();
  p.position = { x: 0, y: 0, z: -4 };
  for (const crouch of [0, 1]) {
    p.crouch = crouch;
    const height = crouch ? 1.15 : 1.8;
    expect(rayPlayer({ x: 0, y: height - .2, z: 0 }, { x: 0, y: 0, z: -1 }, p)?.zone).toBe('head');
    expect(rayPlayer({ x: 0, y: .5, z: 0 }, { x: 0, y: 0, z: -1 }, p)?.zone).toBe('body');
    expect(rayPlayer({ x: 1, y: .5, z: 0 }, { x: 0, y: 0, z: -1 }, p)).toBeNull();
  }
});
it('uses relative teams, no friendly protection in FFA, and deterministic server-seeded modes', () => {
  expect(teammates('teams', 'red', 'red')).toBe(true);
  expect(teammates('teams', 'blue', 'blue')).toBe(true);
  expect(teammates('teams', 'red', 'blue')).toBe(false);
  expect(teammates('ffa', 'red', 'red')).toBe(false);
  expect(teammates('teams', null, null)).toBe(false);
  expect(new Set(Array.from({ length: 20 }, (_, i) => roundMode(123, i))).size).toBe(2);
  expect(roundMode(123, 1)).toBe(roundMode(123, 1));
});
describe.each(WEAPONS)('$id authoritative weapon state', (stats) => {
  it('preserves existing damage/headshot tuning and replays fire/reload state across JSON snapshots', () => {
    expect(zoneDamage(stats.damage, 'head')).toBe(stats.damage * 1.5);
    const a = new Weapon(stats), b = new Weapon(stats);
    const input = (k: number) => ({ trigger: k < 100, triggerPressed: k === 0 || k % 140 === 0,
      reloadPressed: k === 120, aim: true, moveFactor: .3, airborne: false, sprinting: false });
    for (let i = 0; i < 73; i++) a.update(FIXED_DT, input(i));
    const state = JSON.parse(JSON.stringify(a.capture()));
    expect(validGun(state)).toBe(true);
    b.restore(state);
    for (let i = 73; i < 500; i++) {
      expect(b.update(FIXED_DT, input(i))).toEqual(a.update(FIXED_DT, input(i)));
      expect(b.capture()).toEqual(a.capture());
    }
  });
});
it('accepts control intent but never client-assigned damage, targets, shots or gun state', () => {
  const base = { v: 9, type: 'input', roundId: 0, mapVersion: 'test', frames: [{ seq: 1, yaw: 0, pitch: 0,
    intent: { x: 0, z: 0, slide: false, aim: true, jumpPressed: false }, combat: { trigger: true, reload: false } }] };
  expect(parseClientMessage(JSON.stringify(base))).toEqual(base);
  for (const forged of [{ damage: 900 }, { targetId: 'victim' }, { ammo: 99 }, { cooldown: 0 }, { origin: [0, 0, 0] }]) {
    expect(parseClientMessage(JSON.stringify({ ...base, frames: [{ ...base.frames[0], combat: { ...base.frames[0].combat, ...forged } }] }))).toBeNull();
  }
  expect(parseClientMessage(JSON.stringify({ v: 9, type: 'shot', damage: 100, targetId: 'victim' }))).toBeNull();
});
