import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../shared/protocol';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';

describe('network simulation state', () => {
  it('restores jump/gravity state sufficiently to replay identical future movement', () => {
    const world = new CollisionWorld();
    world.add({ c: [0, -0.5, 0], h: [50, 0.5, 50] });
    const a = new PlayerController(world);
    a.teleport({ x: 0, y: 0, z: 0 });
    a.fixedUpdate(1 / 120, { ...NO_INTENT, jumpPressed: true, z: 1 });
    for (let i = 0; i < 15; i++) a.fixedUpdate(1 / 120, { ...NO_INTENT, z: 1 });
    const b = new PlayerController(world);
    b.restore(a.capture());
    for (let i = 0; i < 180; i++) {
      const intent = { ...NO_INTENT, z: 1, jumpPressed: i === 3 };
      a.fixedUpdate(1 / 120, intent);
      b.fixedUpdate(1 / 120, intent);
      expect(b.capture()).toEqual(a.capture());
    }
  });
  it('rejects malformed envelopes, versions, nonfinite look and client-assigned state', () => {
    expect(parseClientMessage('{')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ v: 99, type: 'join', name: 'Player' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ v: 1, type: 'join', name: 'Player', kills: 999 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ v: 1, type: 'input', mapVersion: 'test', frames: [{ seq: 1, yaw: NaN, pitch: 0, intent: NO_INTENT }] }))).toBeNull();
    expect(parseClientMessage(' '.repeat(8193))).toBeNull();
  });
});
