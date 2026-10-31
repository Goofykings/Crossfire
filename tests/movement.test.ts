import { describe, expect, it } from 'vitest';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { NO_INTENT, PlayerController, type MoveIntent } from '../src/player/PlayerController';

function flatWorld(): CollisionWorld {
  const w = new CollisionWorld();
  w.add({ c: [0, -1, 0], h: [100, 1, 100], tag: 'ground' });
  return w;
}

function run(p: PlayerController, seconds: number, intent: Partial<MoveIntent> = {}, dt = FIXED_DT): void {
  const it: MoveIntent = { ...NO_INTENT, ...intent };
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) p.fixedUpdate(dt, it);
}

describe('PlayerController basics', () => {
  it.each([0, .1, .5, .9])('jump cancels slide at %s seconds without losing horizontal momentum', (elapsed) => {
    const p = new PlayerController(flatWorld()); p.teleport({ x: 0, y: 0, z: 0 });
    run(p, .25, { z: 1 });
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, slide: true });
    run(p, elapsed, { z: 1, slide: true });
    const before = p.horizontalSpeed;
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, slide: true, jumpPressed: true });
    expect(p.sliding).toBe(false); expect(p.grounded).toBe(false);
    expect(p.velocity.y).toBeGreaterThan(0); expect(p.slideCooldown).toBe(MOVEMENT.slideCooldown);
    expect(p.horizontalSpeed).toBeGreaterThan(before - .05);
    run(p, .2, { z: 1, slide: true });
    expect(p.horizontalSpeed).toBeLessThanOrEqual(MOVEMENT.slideSpeed + .01);
    expect(p.slideCooldown).toBeGreaterThan(.7);
  });
  it('can cancel a slide after leaving an edge, but cannot jump twice', () => {
    const w = new CollisionWorld(); w.add({ c: [0, -1, 0], h: [3, 1, 3] });
    const p = new PlayerController(w); p.teleport({ x: 0, y: 0, z: -2.5 });
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, slide: true });
    run(p, .3, { z: 1, slide: true });
    expect(p.sliding).toBe(true); expect(p.grounded).toBe(false); expect(p.capture().airTime).toBeGreaterThan(MOVEMENT.coyoteTime);
    const speed = p.horizontalSpeed;
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, slide: true, jumpPressed: true });
    expect(p.sliding).toBe(false); expect(p.velocity.y).toBeGreaterThan(0); expect(p.slideCooldown).toBe(1);
    expect(p.horizontalSpeed).toBeGreaterThan(speed - .05);
    const vertical = p.velocity.y;
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, jumpPressed: true });
    expect(p.velocity.y).toBeLessThan(vertical);
  });
  it('settles on the ground', () => {
    const p = new PlayerController(flatWorld());
    p.teleport({ x: 0, y: 2, z: 0 });
    run(p, 1);
    expect(p.grounded).toBe(true);
    expect(p.position.y).toBeCloseTo(0, 5);
  });

  it('accelerates smoothly to walk speed and stops with friction', () => {
    const p = new PlayerController(flatWorld());
    p.teleport({ x: 0, y: 0, z: 0 }, 0);
    run(p, 0.05, { z: 1 });
    const early = p.horizontalSpeed;
    expect(early).toBeGreaterThan(0.5);
    expect(early).toBeLessThan(MOVEMENT.walkSpeed);
    run(p, 1, { z: 1 });
    expect(p.horizontalSpeed).toBeCloseTo(MOVEMENT.walkSpeed, 3);
    // heading 0 faces north (-z)
    expect(p.position.z).toBeLessThan(-3);
    run(p, 0.5);
    expect(p.horizontalSpeed).toBe(0);
  });

  it('slides for one second, decelerates, and holding Shift never repeats', () => {
    const p = new PlayerController(flatWorld());
    p.teleport({ x: 0, y: 0, z: 0 }, 90);
    run(p, 0.25, { z: 1 });
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, slide: true });
    expect(p.sliding).toBe(true);
    expect(p.horizontalSpeed).toBeCloseTo(MOVEMENT.slideSpeed);
    expect(p.crouch).toBeGreaterThan(0);
    expect(p.crouch).toBeLessThan(0.1);
    run(p, 0.5, { z: 1, slide: true });
    expect(p.height).toBeCloseTo(MOVEMENT.crouchHeight);
    expect(p.horizontalSpeed).toBeLessThan(MOVEMENT.slideSpeed);
    expect(p.horizontalSpeed).toBeGreaterThan(MOVEMENT.walkSpeed);
    run(p, 59 / 120, { z: 1, slide: true });
    expect(p.sliding).toBe(false);
    expect(p.slideCooldown).toBe(1);
    expect(p.crouch).toBe(1);
    run(p, 0.05, { z: 1, slide: true });
    expect(p.crouch).toBeGreaterThan(0);
    expect(p.crouch).toBeLessThan(1);
    run(p, 3, { z: 1, slide: true });
    expect(p.sliding).toBe(false);
    expect(p.height).toBe(MOVEMENT.standHeight);
    expect(p.horizontalSpeed).toBe(MOVEMENT.walkSpeed);
    run(p, FIXED_DT, { z: 1 });
    run(p, FIXED_DT, { z: 1, slide: true });
    expect(p.sliding).toBe(true);
  });

  it('requires a fresh press after the full post-slide cooldown, without stacking speed', () => {
    const p = new PlayerController(flatWorld());
    p.teleport({ x: 0, y: 0, z: 0 });
    run(p, 1, { z: 1, slide: true });
    expect(p.slideCooldown).toBe(1);
    run(p, 0.95, { z: 1 });
    run(p, FIXED_DT, { z: 1, slide: true });
    expect(p.sliding).toBe(false);
    run(p, 0.2, { z: 1, slide: true });
    expect(p.sliding).toBe(false); // failed early press is not buffered
    run(p, FIXED_DT, { z: 1 });
    run(p, 0.3, { z: 1, slide: true });
    expect(p.sliding).toBe(true);
    expect(p.horizontalSpeed).toBeLessThanOrEqual(MOVEMENT.slideSpeed);
  });

  it('captures momentum, allows limited steering, and restores deterministic slide snapshots', () => {
    const p = new PlayerController(flatWorld());
    p.teleport({ x: 0, y: 0, z: 0 });
    run(p, 0.3, { z: 1 });
    p.yaw = -Math.PI / 2;
    run(p, FIXED_DT, { slide: true });
    expect(p.velocity.z).toBeLessThan(-7);
    expect(Math.abs(p.velocity.x)).toBeLessThan(0.01);
    run(p, 0.25, { z: 1, slide: true });
    expect(p.velocity.x).toBeGreaterThan(0.5);
    expect(p.velocity.x).toBeLessThan(2);
    const clone = new PlayerController(flatWorld());
    clone.restore(p.capture());
    for (let i = 0; i < 360; i++) {
      const intent = { ...NO_INTENT, z: 1, slide: i < 300 };
      p.fixedUpdate(FIXED_DT, intent);
      clone.fixedUpdate(FIXED_DT, intent);
      expect(clone.capture()).toEqual(p.capture());
    }
  });

  it('does not initiate a slide at rest or in the air', () => {
    const p = new PlayerController(flatWorld());
    p.teleport({ x: 0, y: 0, z: 0 });
    run(p, 0.2, { slide: true });
    expect(p.sliding).toBe(false);
    run(p, FIXED_DT, { jumpPressed: true });
    run(p, FIXED_DT, { z: 1, slide: true });
    expect(p.sliding).toBe(false);
  });

  it('jumps to a sensible height and cannot double jump', () => {
    const p = new PlayerController(flatWorld());
    p.teleport({ x: 0, y: 0, z: 0 });
    let peak = 0;
    let jumpsStarted = 0;
    let wasGrounded = true;
    for (let i = 0; i < 240; i++) {
      // hammer the jump key every few ticks while airborne
      p.fixedUpdate(FIXED_DT, { ...NO_INTENT, jumpPressed: i === 0 || (i > 10 && i % 7 === 0 && i < 60) });
      if (wasGrounded && !p.grounded) jumpsStarted++;
      wasGrounded = p.grounded;
      peak = Math.max(peak, p.position.y);
      if (i > 20 && p.grounded) break;
    }
    const expected = (MOVEMENT.jumpSpeed * MOVEMENT.jumpSpeed) / (2 * MOVEMENT.gravity);
    expect(peak).toBeGreaterThan(expected * 0.95);
    expect(peak).toBeLessThan(expected * 1.05);
    expect(jumpsStarted).toBe(1);
  });

  it('holding jump does not bunny hop', () => {
    const p = new PlayerController(flatWorld());
    p.teleport({ x: 0, y: 0, z: 0 });
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, jumpPressed: true });
    let landings = 0;
    let prev = p.grounded;
    for (let i = 0; i < 600; i++) {
      p.fixedUpdate(FIXED_DT, { ...NO_INTENT }); // key held: no new edges
      if (!prev && p.grounded) landings++;
      if (prev && !p.grounded) throw new Error('jumped again without a new key press');
      prev = p.grounded;
    }
    expect(landings).toBe(1);
  });

  it('is frame-rate independent (fixed timestep driven by variable frames)', () => {
    const simulate = (fps: number) => {
      const p = new PlayerController(flatWorld());
      p.teleport({ x: 0, y: 0, z: 0 }, 45);
      let acc = 0;
      const frame = 1 / fps;
      for (let t = 0; t < 2; t += frame) {
        acc += frame;
        while (acc >= FIXED_DT) {
          p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, x: 0.3, slide: true });
          acc -= FIXED_DT;
        }
      }
      return p.position;
    };
    const a = simulate(30);
    const b = simulate(144);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.1);
  });
});

describe('collision', () => {
  it('stops at walls and slides along them', () => {
    const w = flatWorld();
    w.add({ c: [0, 1.5, -5], h: [10, 1.5, 0.15], tag: 'wall' }); // thin wall across -z
    const p = new PlayerController(w);
    p.teleport({ x: 0, y: 0, z: 0 }, 0);
    run(p, 3, { z: 1, slide: true });
    expect(p.position.z).toBeGreaterThan(-5 + 0.15 + MOVEMENT.radius - 0.01);
    expect(p.position.z).toBeLessThan(-5 + 0.15 + MOVEMENT.radius + 0.02);
    // diagonal into the wall: keeps sliding sideways
    const x0 = p.position.x;
    run(p, 1, { z: 1, x: 1 });
    expect(p.position.x - x0).toBeGreaterThan(2);
  });

  it('never tunnels through a thin wall even at large frame steps', () => {
    const w = flatWorld();
    w.add({ c: [0, 1.5, -3], h: [10, 1.5, 0.05], tag: 'thin' });
    const p = new PlayerController(w);
    p.teleport({ x: 0, y: 0, z: 0 }, 0);
    p.velocity.z = -60; // absurd speed
    for (let i = 0; i < 30; i++) p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1 });
    expect(p.position.z).toBeGreaterThan(-3);
  });

  it.each([false, true])('climbs stairs and steps without getting stuck (slide %s)', (slide) => {
    const w = flatWorld();
    // 4 steps of 0.18 m then a 0.72 m terrace
    for (let k = 1; k <= 4; k++) {
      w.add({ c: [0, (0.18 * k - 1) / 2, -2 - 0.32 * (k - 0.5)], h: [2, (0.18 * k + 1) / 2, 0.16], tag: 'step' });
    }
    // Long enough for the faster slide route to remain on the terrace at the assertion.
    w.add({ c: [0, (0.72 - 1) / 2, -10], h: [2, (0.72 + 1) / 2, 6.72], tag: 'terrace' });
    const p = new PlayerController(w);
    p.teleport({ x: 0, y: 0, z: 0 }, 0);
    run(p, 2.5, { z: 1, slide });
    expect(p.position.y).toBeCloseTo(0.72, 3);
    expect(p.position.z).toBeLessThan(-6);
    // and back down
    run(p, 3, { z: -1 });
    expect(p.position.y).toBeCloseTo(0, 3);
    expect(p.grounded).toBe(true);
  });

  it('cannot walk up a ledge taller than the step height but can jump onto it', () => {
    const w = flatWorld();
    w.add({ c: [0, (0.72 - 1) / 2, -4], h: [3, (0.72 + 1) / 2, 2], tag: 'ledge' });
    const p = new PlayerController(w);
    p.teleport({ x: 0, y: 0, z: 0 }, 0);
    run(p, 1.5, { z: 1 });
    expect(p.position.y).toBeCloseTo(0, 3);
    expect(p.position.z).toBeGreaterThan(-2 + MOVEMENT.radius - 0.02);
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, jumpPressed: true });
    run(p, 1, { z: 1 });
    expect(p.position.y).toBeCloseTo(0.72, 3);
  });

  it('stays lowered after sliding under cover, then stands only when clear', () => {
    const w = flatWorld();
    w.add({ c: [0, 2.4, 0], h: [3, 1, 3], tag: 'low-ceiling' });
    const p = new PlayerController(w);
    p.teleport({ x: 5, y: 0, z: 0 }, 270);
    run(p, 0.25, { z: 1 });
    run(p, 1, { z: 1, slide: true });
    expect(p.position.x).toBeLessThan(0);
    expect(p.position.x).toBeGreaterThan(-3);
    run(p, 0.25);
    expect(p.height).toBeLessThan(1.4);
    run(p, 2, { z: 1 });
    expect(p.position.x).toBeLessThan(-3.5);
    run(p, 0.5);
    expect(p.height).toBeCloseTo(MOVEMENT.standHeight, 3);
  });

  it('cannot step upward into a ceiling while sliding', () => {
    const w = flatWorld();
    w.add({ c: [0, 1.65, -3], h: [2, 0.25, 1], tag: 'ceiling' });
    w.add({ c: [0, 0.15, -3], h: [2, 0.15, 1], tag: 'step' });
    const p = new PlayerController(w);
    p.teleport({ x: 0, y: 0, z: 0 });
    run(p, 1, { z: 1, slide: true });
    expect(p.position.z).toBeGreaterThan(-2);
    expect(p.position.y).toBe(0);
  });

  it('raycasts against rotated boxes with correct normals', () => {
    const w = new CollisionWorld();
    w.add({ c: [0, 1, -5], h: [1, 1, 1], yaw: Math.PI / 4, tag: 'diamond' });
    const hit = w.raycast(0, 1, 0, 0, 0, -1, 50);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(5 - Math.SQRT2, 4);
    expect(hit!.normal.z).toBeGreaterThan(0.6);
    expect(Math.abs(hit!.normal.x)).toBeGreaterThan(0.6);
    expect(w.raycast(3, 1, 0, 0, 0, -1, 50)).toBeNull();
  });
});
