import { Quaternion } from '@babylonjs/core';
import type { RenderContext } from '../rendering/RenderContext';
import type { PlayerController, Vec3 } from './PlayerController';
import { LEAN_ANGLE, LEAN_OFFSET, leanOffset } from '../../shared/lean';
import { GRENADE } from '../../shared/grenades';
import { DampedSpring } from '../core/DampedSpring';

const DEG = Math.PI / 180;
/** Radians of yaw per mouse count at sensitivity 1. */
const BASE_LOOK = 0.0022;
const MAX_PITCH = 88 * DEG;

/**
 * Drives the Babylon camera from the kinematic controller: interpolation between physics ticks,
 * smoothed stair steps and crouching, a subtle head bob, landing dip, recoil kick and ADS zoom.
 */
export class PlayerCamera {
  private groundY: number | null = null;
  private wasGrounded = false;
  private bobPhase = 0;
  private bobWeight = 0;
  private readonly dip = new DampedSpring(Math.sqrt(120), 14 / (2 * Math.sqrt(120)));
  private readonly kickPitch = new DampedSpring(Math.sqrt(260), 22 / (2 * Math.sqrt(260)));
  private kickYaw = 0;
  private readonly blastRoll = new DampedSpring(39, .26);
  private fov = 90;
  private swayTime = 0;
  private readonly tmp: Vec3 = { x: 0, y: 0, z: 0 };
  /** Lateral head-bob offset this frame (for the weapon view). */
  bobX = 0;
  bobY = 0;

  constructor(
    private readonly ctx: RenderContext,
    private readonly player: PlayerController,
  ) {}

  applyLook(dx: number, dy: number, sensitivity: number, invertY: boolean, zoom: number): void {
    const k = BASE_LOOK * sensitivity * zoom;
    this.player.yaw -= dx * k;
    this.player.pitch -= dy * k * (invertY ? -1 : 1);
    if (this.player.pitch > MAX_PITCH) this.player.pitch = MAX_PITCH;
    if (this.player.pitch < -MAX_PITCH) this.player.pitch = -MAX_PITCH;
    // keep yaw bounded for float precision
    if (this.player.yaw > Math.PI) this.player.yaw -= Math.PI * 2;
    if (this.player.yaw < -Math.PI) this.player.yaw += Math.PI * 2;
  }

  /** Visual kick (spring-recovered) plus a small permanent drift of the real aim. */
  addRecoil(pitchDeg: number, yawDeg: number): void {
    this.kickPitch.velocity += pitchDeg * DEG * 22;
    this.kickYaw += yawDeg * DEG * (Math.random() < 0.5 ? -1 : 1);
    this.player.pitch = Math.min(MAX_PITCH, this.player.pitch + pitchDeg * DEG * 0.4);
    this.player.yaw += yawDeg * DEG * 0.25 * (Math.random() - 0.5);
  }

  /** Cosmetic roll about the optical axis: the center aim/ray never changes. */
  explosion(distance: number): void {
    const t = Math.max(0, 1 - Math.max(0, distance) / GRENADE.damageRadius);
    this.blastRoll.velocity = Math.min(2.6, this.blastRoll.velocity + 2.4 * t * t);
  }

  /** Called once per fixed tick with the controller's snap/landing info. */
  onTick(): void {
    if (this.player.landedSpeed > 3) this.dip.velocity -= Math.min(1.2, this.player.landedSpeed * 0.09);
  }

  resetMotion(): void {
    this.groundY = null; this.wasGrounded = false;
    this.dip.reset(); this.blastRoll.reset(); this.kickPitch.reset(); this.kickYaw = 0;
    this.bobWeight = this.bobX = this.bobY = 0;
  }

  snapFov(fov: number): void {
    this.fov = fov;
  }

  /** The exact forward aim used by the next rendered reticle and shot. */
  aimAngles(scopeSway = 0): { aimYaw: number; aimPitch: number } {
    const p = this.player;
    const steady = p.crouch > .5 ? .45 : 1;
    const sy = Math.sin(this.swayTime * .85) * .0016 * scopeSway * steady;
    const sp = Math.sin(this.swayTime * 1.7 + 1.1) * .0011 * scopeSway * steady;
    const yaw = p.yaw + Math.max(-.34, Math.min(.34, this.kickYaw + sy));
    return { aimYaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
      aimPitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, p.pitch + Math.max(-.34, Math.min(.34, this.kickPitch.value + sp)))) };
  }

  /**
   * `scopeSway` (0..1): the slow figure-of-eight drift of a magnified scope held by a breathing shooter. It moves the
   * view itself, so shots go where the reticle is.
   */
  update(dt: number, alpha: number, baseFov: number, zoom: number, scopeSway = 0, reducedMotion = false): void {
    const p = this.player;
    const pos = p.interpolated(alpha, this.tmp);
    // Follow small grounded height changes in BOTH directions. Fixed-tick step
    // offsets previously accumulated ahead of render interpolation, and downward
    // snaps had no smoothing at all. Large corrections and jumps stay physical.
    if (this.groundY === null || !p.grounded || !this.wasGrounded
      || Math.abs(pos.y - this.groundY) > p.cfg.snapDown + p.cfg.stepHeight) this.groundY = pos.y;
    else this.groundY = pos.y + (this.groundY - pos.y) * Math.exp(-dt * 16);
    this.wasGrounded = p.grounded;
    this.dip.update(dt);
    // head bob while walking on the ground
    const speed = p.horizontalSpeed;
    const moving = p.grounded && !p.sliding && speed > 0.5;
    this.bobWeight += ((moving ? Math.min(1, speed / 6) : 0) - this.bobWeight) * (1 - Math.exp(-dt * 8));
    this.bobPhase = (this.bobPhase + speed * dt * Math.PI / 2.1) % (Math.PI * 2);
    const adsDamp = 1 - (1 - zoom) * 3;
    const cosmetic = reducedMotion ? .12 : 1;
    const bw = this.bobWeight * Math.max(0.15, adsDamp) * cosmetic;
    this.bobY = Math.cos(this.bobPhase * 2) * 0.012 * bw;
    this.bobX = Math.cos(this.bobPhase) * 0.008 * bw;
    // recoil kick spring
    this.kickPitch.update(dt);
    this.kickYaw *= Math.exp(-dt * 12);

    const cam = this.ctx.camera;
    const heightBlend = p.prevCrouch + (p.crouch - p.prevCrouch) * alpha;
    const desiredEye = (p.cfg.standEye + (p.cfg.crouchEye - p.cfg.standEye) * heightBlend)*(p.prevEyeScale+(p.eyeScale-p.prevEyeScale)*alpha)/p.bodyScale
      + this.groundY - pos.y + this.bobY + this.dip.value * .1 * cosmetic;
    const eye = p.safeViewEye(pos, desiredEye);
    const lean = p.prevLean + (p.lean - p.prevLean) * alpha;
    // Include bob in the sweep so visual motion cannot nudge the camera through a wall.
    const safe = p.safeViewLean(pos, lean + this.bobX / LEAN_OFFSET, eye);
    const offset = leanOffset(p.yaw, safe, p.bodyScale);
    cam.position.set(pos.x + offset.x, pos.y + eye, pos.z + offset.z);
    const roll = this.bobX * 0.35 - lean * LEAN_ANGLE + this.blastRoll.update(dt) * cosmetic;
    cam.rotationQuaternion ??= Quaternion.Identity();
    this.swayTime += dt;
    const aim = this.aimAngles(scopeSway);
    Quaternion.RotationYawPitchRollToRef(aim.aimYaw, aim.aimPitch, roll, cam.rotationQuaternion);
    const targetFov = baseFov * zoom;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 18));
    this.ctx.setFov(this.fov);
  }
}
