import { describe, expect, it } from 'vitest';
import { MAP_IDS, ROUND_MS, mapRound } from '../shared/maps';
import { MAPS } from '../src/maps/registry';
import { WORLDS } from '../server/src/world';
import { MOVEMENT, FIXED_DT } from '../src/config/constants';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';
import { SMG, RIFLE, SHOTGUN, SNIPER, Weapon } from '../src/weapons/Weapon';

describe('canonical public map schedule', () => {
  it('keeps all existing frontend/server maps registered with collision-clear neutral spawns', () => {
    expect(MAPS.map((m) => m.id)).toEqual([...MAP_IDS]);
    expect(Object.keys(WORLDS)).toEqual([...MAP_IDS]);
    for (const data of Object.values(WORLDS)) {
      expect(data.layout.spawns.length).toBeGreaterThanOrEqual(12);
      for (const spawn of data.layout.spawns) {
        expect(data.world.overlapsCylinder(spawn.pos[0], spawn.pos[2], MOVEMENT.radius,
          spawn.pos[1] + MOVEMENT.stepHeight, spawn.pos[1] + MOVEMENT.standHeight)).toBe(false);
        const player = new PlayerController(data.world);
        player.teleport({ x: spawn.pos[0], y: spawn.pos[1], z: spawn.pos[2] });
        for (let i = 0; i < 60; i++) player.fixedUpdate(FIXED_DT, NO_INTENT);
        expect(player.grounded).toBe(true);
      }
    }
  });
  it('randomizes complete three-map bags, rather than hardcoding a single map', () => {
    const first = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) {
      const schedule = { epoch: 1000, seed };
      first.add(mapRound(schedule, 1000).mapId);
      for (let bag = 0; bag < 10; bag++) {
        expect(new Set([0, 1, 2].map((i) => mapRound(schedule, 1000 + (bag * 3 + i) * ROUND_MS).mapId))).toEqual(new Set(MAP_IDS));
      }
    }
    expect(first).toEqual(new Set(MAP_IDS));
  });
  it('uses exact deadlines for late joins, duplicate wakeups, restart and empty-room catch-up', () => {
    const saved = { epoch: 123456, seed: 123456789 };
    expect(mapRound(saved, saved.epoch + ROUND_MS - 1).id).toBe(0);
    expect(mapRound(saved, saved.epoch + ROUND_MS).id).toBe(1);
    const now = saved.epoch + ROUND_MS * 10000 + 455000;
    const a = mapRound(saved, now);
    expect(a.id).toBe(10000);
    expect(a.endsAt - now).toBe(145000);
    expect(mapRound(JSON.parse(JSON.stringify(saved)), now)).toEqual(a);
    expect(mapRound(saved, now)).toEqual(a);
  });
});

describe('selectable SMG', () => {
  it('has distinct configurable close-range stats and reloads a finite magazine with infinite reserve', () => {
    expect(SMG.rpm).toBeGreaterThan(Math.max(RIFLE.rpm, SHOTGUN.rpm, SNIPER.rpm));
    expect(SMG.damage).toBeLessThan(Math.min(RIFLE.damage, SHOTGUN.damage, SNIPER.damage));
    const gun = new Weapon(SMG);
    const input = { trigger: true, triggerPressed: true, reloadPressed: false, aim: false, moveFactor: 0, airborne: false, sprinting: false };
    for (let i = 0; i < 60; i++) { gun.update(FIXED_DT, input); input.triggerPressed = false; }
    expect(gun.ammo).toBeLessThan(SMG.magazine - 4);
    expect(gun.reserve).toBe(Infinity);
    input.trigger = false; input.reloadPressed = true;
    gun.update(FIXED_DT, input); input.reloadPressed = false;
    for (let i = 0; i < 360; i++) gun.update(FIXED_DT, input);
    expect(gun.ammo).toBe(SMG.magazine);
  });
});
