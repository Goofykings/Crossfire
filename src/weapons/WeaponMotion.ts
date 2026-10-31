import { MOVEMENT } from '../config/constants';
import { DampedSpring } from '../core/DampedSpring';

export interface MotionInput {
  speed: number;
  grounded: boolean;
  sliding: boolean;
  crouch: number;
  ads: number;
  sprinting: boolean;
  reducedMotion?: boolean;
}

/** Cosmetic only: one bounded contribution to the existing hip/ADS/action pose. */
export class WeaponMotion {
  private time = 0;
  private phase = 0;
  private walk = 0;
  private slide = 0;
  private crouch = 0;
  private swayX = 0;
  private swayY = 0;
  private readonly recoil = new DampedSpring(30, .78);
  private readonly landing = new DampedSpring(19, .58);
  readonly pose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  readonly debug = { idle: 0, walk: 0, slide: 0, recoil: 0, landing: 0, shots: 0 };

  addSway(dx: number, dy: number): void {
    this.swayX = Math.max(-.035, Math.min(.035, this.swayX - dx * .00009));
    this.swayY = Math.max(-.03, Math.min(.03, this.swayY + dy * .00009));
  }

  /** One impulse per actual fire event; rapid automatic fire stays bounded. */
  fire(strength: number): void {
    this.debug.shots++;
    this.recoil.velocity = Math.min(3.5, this.recoil.velocity + 1.3 * strength);
  }

  land(speed: number): void {
    this.landing.velocity = Math.min(.8, this.landing.velocity + Math.min(.6, Math.max(0, speed - 2) * .09));
  }

  reset(): void {
    this.recoil.reset(); this.landing.reset();
    this.swayX = this.swayY = this.walk = this.slide = this.crouch = 0;
    Object.assign(this.pose, { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 });
    Object.assign(this.debug, { idle: 0, walk: 0, slide: 0, recoil: 0, landing: 0, shots: 0 });
  }

  update(dt: number, input: MotionInput): typeof this.pose {
    const { speed, grounded, sliding, ads } = input;
    const decay = Math.exp(-dt * 10), hip = 1 - ads;
    const decorative = input.reducedMotion ? .12 : 1;
    const target = grounded && !sliding ? Math.min(1.35, speed / MOVEMENT.walkSpeed) : 0;
    this.walk = target + (this.walk - target) * decay;
    this.slide = Number(sliding) + (this.slide - Number(sliding)) * Math.exp(-dt * 16);
    this.crouch = input.crouch + (this.crouch - input.crouch) * Math.exp(-dt * 16);
    this.time = (this.time + dt) % 420;
    // Same distance-based rhythm as the existing 2.1 m footstep stride.
    this.phase = (this.phase + speed * dt * Math.PI / 2.1) % (Math.PI * 2);
    this.swayX *= Math.exp(-dt * 9);
    this.swayY *= Math.exp(-dt * 9);
    const recoil = Math.max(0, Math.min(.075, this.recoil.update(dt)));
    const landing = Math.max(-.012, Math.min(.035, this.landing.update(dt)));
    const idle = (1 - Math.min(1, this.walk)) * (1 - this.slide) * decorative * hip * hip;
    const breath = this.time * Math.PI * 2 / 4.2;
    const bob = this.walk * decorative * hip * hip * (input.sprinting ? 1.2 : 1);
    const posture = this.crouch * hip * decorative;
    const slide = this.slide * hip * decorative;
    // All decorative rotations/transverse offsets disappear at full ADS. Recoil
    // translates the whole rig along its optical axis, retaining sight alignment.
    const pose = this.pose;
    pose.x = .0035 * Math.sin(breath) * idle + .015 * Math.cos(this.phase) * bob + this.swayX * hip;
    pose.y = .0025 * Math.cos(breath * 2) * idle - .009 * Math.cos(this.phase * 2) * bob
      + this.swayY * hip - .01 * posture - .018 * slide - landing * hip * decorative;
    pose.z = recoil * (1 - .25 * ads);
    pose.pitch = recoil * .8 * hip + this.swayY * hip + landing * .4 * hip * decorative;
    pose.yaw = this.swayX * hip + .055 * posture;
    pose.roll = .006 * Math.sin(breath) * idle + .018 * Math.cos(this.phase) * bob
      + this.swayX * hip - .065 * posture + .045 * slide;
    Object.assign(this.debug, { idle, walk: this.walk, slide: this.slide, recoil, landing });
    return pose;
  }
}
