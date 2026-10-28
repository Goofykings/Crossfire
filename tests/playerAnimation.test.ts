import { expect, it } from 'vitest';
import { animationVelocity, PlayerAnimationState, PlayerAnimator, type CharacterMotion, type CharacterClip } from '../src/game/PlayerAnimation';
import type { AnimationGroup } from '@babylonjs/core';
const durations = { IDLE: 2.4, RUN: .8, JUMP_START: .2, JUMP_LOOP: .8, JUMP_LAND: .3, SLIDE: 1 };
const pose = (patch: Partial<CharacterMotion> = {}): CharacterMotion => ({ grounded: true, velocity: { x: 0, y: 0, z: 0 }, slideRemaining: 0, crouch: 0, ...patch });
it('animates interpolated travel when a sparse server input batch ends with zero velocity', () => {
  const a = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
  const b = { ...a, position: { x: 0, y: 0, z: -.06 } };
  const v = animationVelocity(a, b, .05, .5);
  expect(v.z).toBeCloseTo(-1.2);
  expect(new PlayerAnimationState(durations).update(pose({ velocity: v }), .016)).toBe('RUN');
  expect(animationVelocity(b, b, .05, .5)).toEqual({ x: 0, y: 0, z: 0 });
});
it('selects full jump/landing lifecycle without fabricating a launch when joining airborne', () => {
  const s = new PlayerAnimationState(durations);
  expect(s.update(pose(), .016)).toBe('IDLE');
  const air = pose({ grounded: false, velocity: { x: 0, y: 5, z: 0 } });
  expect(s.update(air, .016)).toBe('JUMP_START');
  expect(s.update(air, .10)).toBe('JUMP_START');
  expect(s.update(air, .11)).toBe('JUMP_LOOP');
  expect(s.update(pose(), .016)).toBe('JUMP_LAND');
  expect(s.update(pose(), .15)).toBe('JUMP_LAND');
  expect(s.update(pose(), .16)).toBe('IDLE');
  expect(new PlayerAnimationState(durations).update(air, .016)).toBe('JUMP_LOOP');
});
it('uses actual speed hysteresis and keeps the slide pose while blocked under low cover', () => {
  const s = new PlayerAnimationState(durations);
  expect(s.update(pose({ velocity: { x: .5, y: 0, z: 0 } }), .016)).toBe('RUN');
  expect(s.update(pose({ velocity: { x: .25, y: 0, z: 0 } }), .016)).toBe('RUN');
  expect(s.update(pose(), .016)).toBe('IDLE');
  expect(s.update(pose({ slideRemaining: 1, crouch: .2 }), .016)).toBe('SLIDE');
  expect(s.update(pose({ crouch: 1 }), 2)).toBe('SLIDE');
  expect(s.update(pose(), .016)).toBe('IDLE');
});
it('does not restart current clips, blends changes and isolates per-player animation state', () => {
  function groups() { return Object.fromEntries(Object.keys(durations).map((name) => [name,
    { weight: 0, speedRatio: 1, to: durations[name as CharacterClip] * 60, start() {}, stop() {}, goToFrame() {}, getCurrentFrame: () => 3 }])) as unknown as Record<CharacterClip, AnimationGroup>; }
  const a = new PlayerAnimator(groups(), durations), b = new PlayerAnimator(groups(), durations);
  for (let i = 0; i < 120; i++) a.update(pose(), 1 / 60);
  expect(a.inspect().starts).toBe(1);
  a.update(pose({ velocity: { x: 4.7, y: 0, z: 0 } }), 1 / 60);
  expect(a.inspect().weights.RUN).toBeGreaterThan(0);
  expect(a.inspect().weights.IDLE).toBeGreaterThan(0);
  b.update(pose(), 1 / 60);
  expect(b.inspect().clip).toBe('IDLE');
  expect(a.inspect().clip).toBe('RUN');
  for (let i = 0; i < 60; i++) a.update(pose({ velocity: { x: 4.7, y: 0, z: 0 } }), 1 / 60);
  expect(a.inspect().starts).toBe(2);
  expect(a.inspect().weights.IDLE).toBeUndefined();
  a.dispose(); b.dispose();
});
