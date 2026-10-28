import type { AnimationGroup } from '@babylonjs/core';
import type { ControllerState, Vec3 } from '../player/PlayerController';

export type CharacterClip = 'IDLE' | 'RUN' | 'JUMP_START' | 'JUMP_LOOP' | 'JUMP_LAND' | 'SLIDE';
export type CharacterMotion = Pick<ControllerState, 'velocity' | 'grounded' | 'slideRemaining' | 'crouch'>;

/** Match the position interpolation even when a sparse input batch finishes with
 * zero velocity at the snapshot boundary. Both positions remain server-owned. */
export function animationVelocity(a: Pick<ControllerState, 'position' | 'velocity'>,
  b: Pick<ControllerState, 'position' | 'velocity'>, seconds: number, k: number): Vec3 {
  return { x: seconds > 0 ? (b.position.x - a.position.x) / seconds : b.velocity.x,
    z: seconds > 0 ? (b.position.z - a.position.z) / seconds : b.velocity.z,
    y: a.velocity.y + (b.velocity.y - a.velocity.y) * k };
}

/** Presentation state only; never changes an authoritative root, collider or packet. */
export class PlayerAnimationState {
  clip: CharacterClip = 'IDLE';
  elapsed = 0;
  private grounded: boolean | null = null;
  private moving = false;
  constructor(private readonly durations: Record<CharacterClip, number>) {}
  update(m: CharacterMotion, dt: number): CharacterClip {
    this.elapsed += dt;
    const speed = Math.hypot(m.velocity.x, m.velocity.z);
    this.moving = speed > (this.moving ? .18 : .4);
    let next: CharacterClip;
    if (m.slideRemaining > 0 || m.crouch > .55) next = 'SLIDE';
    else if (!m.grounded) {
      if (this.grounded === true && m.velocity.y > 0) next = 'JUMP_START';
      else if (this.clip === 'JUMP_START' && this.elapsed < this.durations.JUMP_START && m.velocity.y > 0) next = 'JUMP_START';
      else next = 'JUMP_LOOP';
    } else if (this.grounded === false) next = 'JUMP_LAND';
    else if (this.clip === 'JUMP_LAND' && this.elapsed < this.durations.JUMP_LAND) next = 'JUMP_LAND';
    else next = this.moving ? 'RUN' : 'IDLE';
    this.grounded = m.grounded;
    if (next !== this.clip) { this.clip = next; this.elapsed = 0; }
    return this.clip;
  }
}

/** Crossfade actual exported groups, retaining independent state for each real player. */
export class PlayerAnimator {
  readonly state: PlayerAnimationState;
  private active = new Map<CharacterClip, number>();
  private held = false;
  private starts = 0;
  private readonly history: CharacterClip[] = [];
  constructor(private readonly groups: Record<CharacterClip, AnimationGroup>,
    private readonly durations: Record<CharacterClip, number>) {
    this.state = new PlayerAnimationState(durations);
  }
  update(m: CharacterMotion, dt: number): void {
    const previous = this.state.clip;
    const clip = this.state.update(m, dt);
    if (previous !== clip || !this.active.size) {
      if (!this.active.has(clip)) {
        const group = this.groups[clip];
        group.weight = this.active.size ? 0 : 1;
        group.start(true, 1);
        this.active.set(clip, group.weight);
        this.starts++;
      }
      this.held = false;
      this.history.push(clip); if (this.history.length > 16) this.history.shift();
    }
    const current = this.groups[clip];
    const oneShot = clip === 'SLIDE' || clip === 'JUMP_START' || clip === 'JUMP_LAND';
    if (oneShot && this.state.elapsed >= this.durations[clip] - .04) {
      // Keep the last pose evaluated so it can still crossfade, including low cover.
      current.speedRatio = 0;
      if (!this.held) { current.goToFrame(current.to - .001, true); this.held = true; }
    } else current.speedRatio = clip === 'RUN' ? Math.max(.45, Math.min(1.6, Math.hypot(m.velocity.x, m.velocity.z) / 4.7)) : 1;
    const blend = Math.min(1, dt / .10);
    for (const [name, weight] of this.active) {
      const w = weight + ((name === clip ? 1 : 0) - weight) * blend;
      this.groups[name].weight = w;
      if (name !== clip && w < .005) { this.groups[name].stop(true); this.active.delete(name); }
      else this.active.set(name, w);
    }
  }
  inspect() {
    return { clip: this.state.clip, elapsed: this.state.elapsed, starts: this.starts, history: [...this.history],
      frame: this.groups[this.state.clip].getCurrentFrame(),
      weights: Object.fromEntries(this.active) };
  }
  dispose(): void { for (const name of this.active.keys()) this.groups[name].stop(true); this.active.clear(); }
}
