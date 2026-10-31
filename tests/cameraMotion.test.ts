import { Quaternion, Vector3 } from '@babylonjs/core';
import { describe, expect, it } from 'vitest';
import { PlayerController } from '../src/player/PlayerController';
import { PlayerCamera } from '../src/player/PlayerCamera';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import type { RenderContext } from '../src/rendering/RenderContext';

function setup() {
  const world = new CollisionWorld();
  world.add({ c: [0, -.5, 0], h: [10, .5, 10] });
  const player = new PlayerController(world); player.teleport({ x: 0, y: 0, z: 0 });
  const camera = { position: new Vector3(), rotationQuaternion: Quaternion.Identity() };
  const rig = new PlayerCamera({ camera, setFov: () => {} } as unknown as RenderContext, player);
  return { world, player, camera, rig };
}

describe('camera stairs and impulses', () => {
  it.each([.18, -.18])('smooths a %s m grounded change and settles at the real eye height', (step) => {
    const { player, camera, rig } = setup();
    player.position.y = player.prevPosition.y = .3;
    rig.update(1 / 60, 1, 90, 1);
    const before = camera.position.y;
    player.position.y += step; player.prevPosition.y += step;
    rig.update(1 / 60, 1, 90, 1);
    expect(Math.abs(camera.position.y - before)).toBeLessThan(.06);
    for (let i = 0; i < 90; i++) rig.update(1 / 60, 1, 90, 1);
    expect(camera.position.y).toBeCloseTo(player.position.y + player.eyeHeight, 5);
  });

  it('follows jumping and large corrections directly rather than floating', () => {
    const { player, camera, rig } = setup(); rig.update(1 / 60, 1, 90, 1);
    player.grounded = false; player.position.y = player.prevPosition.y = .5;
    rig.update(1 / 60, 1, 90, 1);
    expect(camera.position.y).toBeCloseTo(.5 + player.eyeHeight, 8);
    player.grounded = true; player.position.y = player.prevPosition.y = 5;
    rig.update(1 / 60, 1, 90, 1);
    expect(camera.position.y).toBeCloseTo(5 + player.eyeHeight, 8);
  });

  it('keeps descending-stair smoothing below an overhead solid', () => {
    const { world, player, camera, rig } = setup();
    player.position.y = player.prevPosition.y = .4; rig.update(1 / 60, 1, 90, 1);
    world.add({ c: [0, 2.05, 0], h: [2, .1, 2] });
    player.position.y = player.prevPosition.y = .1;
    rig.update(1 / 60, 1, 90, 1);
    expect(camera.position.y).toBeLessThanOrEqual(1.95 - .12 + 1e-8);
  });

  it('preserves elapsed-time camera recoil at 30, 60 and 144 FPS', () => {
    const run = (fps: number) => {
      const { rig } = setup(); rig.addRecoil(2, 0);
      for (let i = 0; i < fps / 2; i++) rig.update(1 / fps, 1, 90, 1);
      return rig.aimAngles().aimPitch;
    };
    expect(run(30)).toBeCloseTo(run(60), 10); expect(run(60)).toBeCloseTo(run(144), 10);
  });
});
