import { Vector3 } from '@babylonjs/core';
import { describe, expect, it } from 'vitest';
import type { CollisionWorld } from '../src/physics/CollisionWorld';
import { WeaponView } from '../src/weapons/WeaponView';

describe('view-model wall clearance', () => {
  it('bounds pullback under persistent obstruction and restores the weapon when clear', () => {
    let wall = true, enabled = true;
    const root = { position: { z: 0 }, computeWorldMatrix: () => {} };
    const camera = { globalPosition: new Vector3(0, 1, 0), computeWorldMatrix: () => {},
      getDirection: () => new Vector3(0, 0, -1) };
    const view = Object.assign(Object.create(WeaponView.prototype), {
      root, ctx: { camera }, hidden: false, wallHidden: false,
      current: { root: { setEnabled: (v: boolean) => { enabled = v; } }, flash: { setEnabled: () => {} } },
      muzzleWorld: () => new Vector3(0, 1, -.8 + root.position.z),
    }) as WeaponView;
    const world = { overlapsCylinder: () => wall } as unknown as CollisionWorld;
    for (let i = 0; i < 200; i++) view.avoidWalls(world, 1 / 60);
    expect(root.position.z).toBeLessThanOrEqual(1);
    expect(enabled).toBe(false);
    wall = false;
    for (let i = 0; i < 60; i++) view.avoidWalls(world, 1 / 60);
    expect(root.position.z).toBe(0);
    expect(enabled).toBe(true);
  });
});
