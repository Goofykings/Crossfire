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
    expect(parseClientMessage(JSON.stringify({ v: 7, type: 'join', name: 'Player', kills: 999 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ v: 7, type: 'input', roundId: 0, mapVersion: 'test', frames: [{ seq: 1, yaw: NaN, pitch: 0, intent: NO_INTENT }] }))).toBeNull();
    expect(parseClientMessage(' '.repeat(8193))).toBeNull();
  });
  it('accepts slide intent but rejects old movement packets and client-assigned slide speeds or timers', () => {
    const frame = { seq: 1, yaw: 0, pitch: 0, intent: { ...NO_INTENT, z: 1, slide: true }, combat: { trigger: false, reload: false } };
    const message = { v: 7, type: 'input', roundId: 0, mapVersion: 'test', frames: [frame] };
    expect(parseClientMessage(JSON.stringify(message))).toEqual(message);
    expect(parseClientMessage(JSON.stringify({ ...message, v: 4 }))).toBeNull();
    for (const injected of [{ sprint: true }, { crouch: true }, { speed: 99 }, { slideCooldown: 0 }, { slideRemaining: 10 }, { slide: 1 }]) {
      expect(parseClientMessage(JSON.stringify({ ...message, frames: [{ ...frame, intent: { ...frame.intent, ...injected } }] }))).toBeNull();
    }
  });
});
