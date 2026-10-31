import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { NO_INTENT, PlayerController, WEAPON_CLEARANCE } from '../src/player/PlayerController';
import type { WeaponId } from '../src/weapons/Weapon';

function scene(id: WeaponId) {
  const world = new CollisionWorld();
  world.add({ c: [0, -.5, 0], h: [50, .5, 50] });
  world.add({ c: [0, 2, -3], h: [20, 2, .1] });
  const player = new PlayerController(world);
  player.weaponClearance = id;
  player.teleport({ x: 0, y: 0, z: 0 });
  return player;
}

describe('equipped weapon movement clearance', () => {
  for (const id of ['smg', 'rifle', 'shotgun', 'sniper'] as const) {
    it(`stops ${id} before the wall and permits sliding and backing away`, () => {
      const player = scene(id);
      for (let i = 0; i < 180; i++) player.fixedUpdate(1 / 60, { ...NO_INTENT, z: 1 });
      expect(player.position.z).toBeGreaterThanOrEqual(-2.9 + WEAPON_CLEARANCE[id] + .13 - .02);
      const stopped = player.position.z;
      for (let i = 0; i < 60; i++) player.fixedUpdate(1 / 60, { ...NO_INTENT, x: 1, z: 1, aim: true });
      expect(player.position.x).toBeGreaterThan(1);
      expect(player.position.z).toBeGreaterThanOrEqual(stopped - .02);
      for (let i = 0; i < 60; i++) player.fixedUpdate(1 / 60, { ...NO_INTENT, z: -1 });
      expect(player.position.z).toBeGreaterThan(stopped + 1);
    });
  }

  it('does not push the player backwards when already inside the clearance envelope', () => {
    const player = scene('sniper');
    player.teleport({ x: 0, y: 0, z: -2 });
    const before = player.position.z;
    player.fixedUpdate(1 / 60, { ...NO_INTENT, z: 1 });
    expect(player.position.z).toBeLessThanOrEqual(before + .00001);
  });

  it('produces the same movement for prediction and authoritative simulation', () => {
    const client = scene('shotgun'), server = scene('shotgun');
    for (let i = 0; i < 240; i++) {
      const intent = { ...NO_INTENT, z: 1, x: i > 80 ? 1 : 0, aim: i > 100, lean: (i > 140 ? 1 : 0) as 0 | 1 };
      client.fixedUpdate(1 / 60, intent);
      server.fixedUpdate(1 / 60, intent);
    }
    expect(client.capture()).toEqual(server.capture());
  });
});
