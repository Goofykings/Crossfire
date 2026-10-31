import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/config/constants';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { NO_INTENT, PlayerController, type MoveIntent } from '../src/player/PlayerController';
import { LEAN_OFFSET } from '../shared/lean';
import { rayPlayer } from '../shared/combat';
import { parseClientMessage, validMotion } from '../shared/protocol';

function world() {
  const w = new CollisionWorld();
  w.add({ c: [0, -.5, 0], h: [50, .5, 50] });
  return w;
}
function run(p: PlayerController, seconds: number, intent: Partial<MoveIntent>, dt = FIXED_DT) {
  for (let i = 0; i < Math.round(seconds / dt); i++) p.fixedUpdate(dt, { ...NO_INTENT, ...intent });
}

describe('held, authoritative lean', () => {
  it('eases left and right without moving the planted body, and returns to neutral', () => {
    const p = new PlayerController(world()); p.teleport({ x: 0, y: 0, z: 0 });
    run(p, .15, { lean: -1 });
    expect(p.lean).toBeLessThan(-.94);
    expect(p.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(p.leanEye().x).toBeCloseTo(-LEAN_OFFSET * Math.abs(p.lean), 5);
    run(p, .2, { lean: 0 }); expect(Math.abs(p.lean)).toBeLessThan(.02);
    run(p, .2, { lean: 1 }); expect(p.lean).toBeGreaterThan(.98);
    run(p, .2, { lean: 0 }); expect(Math.abs(p.lean)).toBeLessThan(.02);
  });
  it('has consistent elapsed-time easing and replays from captured state', () => {
    const w = world(), a = new PlayerController(w), b = new PlayerController(w);
    a.teleport({ x: 0, y: 0, z: 0 }); b.teleport({ x: 0, y: 0, z: 0 });
    run(a, .15, { lean: 1 }, 1 / 120); run(b, .15, { lean: 1 }, 1 / 60);
    expect(a.lean).toBeCloseTo(b.lean, 5);
    b.restore(a.capture());
    for (let i = 0; i < 80; i++) {
      const intent: MoveIntent = { ...NO_INTENT, lean: i < 40 ? -1 : 0, x: .4 };
      a.fixedUpdate(FIXED_DT, intent); b.fixedUpdate(FIXED_DT, intent);
      expect(a.capture()).toEqual(b.capture());
    }
  });
  it('sweeps the entire upper-body path against thin walls', () => {
    const w = world(); w.add({ c: [.46, 1.2, 0], h: [.01, 1.2, 3] });
    const p = new PlayerController(w); p.teleport({ x: 0, y: 0, z: 0 });
    run(p, .4, { lean: 1 });
    const eye = p.leanEye();
    expect(eye.x).toBeGreaterThan(.1);
    expect(eye.x).toBeLessThanOrEqual(.22);
    expect(w.overlapsCylinder(eye.x, eye.z, .2, eye.y - .65, eye.y + .16)).toBe(false);
    run(p, .4, { lean: -1 }); expect(p.lean).toBeLessThan(-.99);
  });
  it('returns smoothly while jumping and sliding and cannot start a lean in the air', () => {
    const p = new PlayerController(world()); p.teleport({ x: 0, y: 0, z: 0 });
    run(p, .2, { lean: 1 }); const before = p.lean;
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, lean: 1, jumpPressed: true });
    expect(p.grounded).toBe(false); expect(p.lean).toBeGreaterThan(0); expect(p.lean).toBeLessThan(before);
    run(p, .2, { lean: 1 }); expect(Math.abs(p.lean)).toBeLessThan(.02);
    const q = new PlayerController(world()); q.teleport({ x: 0, y: 0, z: 0 });
    run(q, .2, { lean: -1 }); q.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, slide: true, lean: -1 });
    expect(q.sliding).toBe(true); run(q, .2, { slide: true, lean: -1, z: 1 }); expect(Math.abs(q.lean)).toBeLessThan(.02);
  });
  it('exposes the leaned head and upper torso while the legs stay planted', () => {
    const p = new PlayerController(world()); p.teleport({ x: 0, y: 0, z: 0 });
    const neutral = p.capture(); run(p, .3, { lean: 1 }); const leaned = p.capture();
    const direction = { x: 0, y: 0, z: -1 };
    expect(rayPlayer({ x: .42, y: 1.6, z: 3 }, direction, neutral)).toBeNull();
    expect(rayPlayer({ x: .42, y: 1.6, z: 3 }, direction, leaned)?.zone).toBe('head');
    expect(rayPlayer({ x: .45, y: 1.1, z: 3 }, direction, leaned)?.zone).toBe('body');
    expect(rayPlayer({ x: 0, y: .3, z: 3 }, direction, leaned)?.zone).toBe('body');
  });
  it('allows a clear peek but rejects a shot through an extended corner', () => {
    const w = world(); const wall = w.add({ c: [-2, 1.5, -.1], h: [2, 1.5, .1] });
    const p = new PlayerController(w); p.teleport({ x: -.18, y: 0, z: .4 });
    run(p, .3, { lean: 1 }); const eye = p.leanEye();
    expect(eye.x).toBeGreaterThan(.08);
    expect(w.raycast(eye.x, eye.y, eye.z, 0, 0, -1, 4)).toBeNull();
    expect(w.raycast(p.position.x, eye.y, p.position.z, 0, 0, -1, 4)?.collider).toBe(wall);
    w.add({ c: [.12, 1.5, -.1], h: [.12, 1.5, .1] });
    expect(w.raycast(eye.x, eye.y, eye.z, 0, 0, -1, 4)).not.toBeNull();
  });
  it('rejects forged offsets, invalid lean and aim angles, and old protocol versions', () => {
    const frame = { seq: 1, yaw: 0, pitch: 0, intent: { ...NO_INTENT, lean: 1 },
      combat: { trigger: true, reload: false, aimYaw: .1, aimPitch: .05 } };
    const message = { v: 7, type: 'input', roundId: 0, mapVersion: 'test', frames: [frame] };
    expect(parseClientMessage(JSON.stringify(message))).toEqual(message);
    expect(parseClientMessage(JSON.stringify({ ...message, v: 6 }))).toBeNull();
    for (const lean of [-2, .5, 2, 'right', null]) {
      expect(parseClientMessage(JSON.stringify({ ...message, frames: [{ ...frame, intent: { ...frame.intent, lean } }] }))).toBeNull();
    }
    for (const combat of [{ ...frame.combat, origin: [9, 0, 0] }, { ...frame.combat, aimYaw: 1 }, { ...frame.combat, aimPitch: 1 }]) {
      expect(parseClientMessage(JSON.stringify({ ...message, frames: [{ ...frame, combat }] }))).toBeNull();
    }
    const motion = new PlayerController(world()).capture();
    expect(validMotion(motion)).toBe(true);
    expect(validMotion({ ...motion, lean: 1.01 })).toBe(false);
  });
});
