import { Quaternion } from '@babylonjs/core';
import type { RenderContext } from '../rendering/RenderContext';
import type { PlayerController, Vec3 } from './PlayerController';

const DEG = Math.PI / 180;
/** Radians of yaw per mouse count at sensitivity 1. */
const BASE_LOOK = 0.0022;
const MAX_PITCH = 88 * DEG;

/**
 * Drives the Babylon camera from the kinematic controller: interpolation between physics ticks,
 * smoothed stair steps and crouching, a subtle head bob, landing dip, recoil kick and ADS zoom.
 */
export class PlayerCamera {
  private stepOffset = 0;
  private bobPhase = 0;
  private bobWeight = 0;
  private dip = 0;
  private dipVel = 0;
  private kickPitch = 0;
  private kickYaw = 0;
  private kickVel = 0;
  private fov = 90;
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
    this.kickVel += pitchDeg * DEG * 22;
    this.kickYaw += yawDeg * DEG * (Math.random() < 0.5 ? -1 : 1);
    this.player.pitch = Math.min(MAX_PITCH, this.player.pitch + pitchDeg * DEG * 0.4);
    this.player.yaw += yawDeg * DEG * 0.25 * (Math.random() - 0.5);
  }

  /** Called once per fixed tick with the controller's snap/landing info. */
  onTick(): void {
    if (this.player.stepUpDelta > 0) this.stepOffset -= this.player.stepUpDelta;
    if (this.player.landedSpeed > 3) this.dipVel -= Math.min(1.2, this.player.landedSpeed * 0.09);
  }

  snapFov(fov: number): void {
    this.fov = fov;
  }

  update(dt: number, alpha: number, baseFov: number, zoom: number): void {
    const p = this.player;
    const pos = p.interpolated(alpha, this.tmp);
    // smooth stair snaps back to zero
    this.stepOffset *= Math.exp(-dt * 16);
    if (Math.abs(this.stepOffset) < 1e-4) this.stepOffset = 0;
    // landing dip spring
    this.dipVel += (-this.dip * 120 - this.dipVel * 14) * dt;
    this.dip += this.dipVel * dt;
    // head bob while walking on the ground
    const speed = p.horizontalSpeed;
    const moving = p.grounded && speed > 0.5;
    this.bobWeight += ((moving ? Math.min(1, speed / 6) : 0) - this.bobWeight) * Math.min(1, dt * 8);
    this.bobPhase += speed * dt * 1.85;
    const adsDamp = 1 - (1 - zoom) * 3;
    const bw = this.bobWeight * Math.max(0.15, adsDamp);
    this.bobY = Math.sin(this.bobPhase * 2) * 0.028 * bw;
    this.bobX = Math.cos(this.bobPhase) * 0.02 * bw;
    // recoil kick spring
    this.kickVel += (-this.kickPitch * 260 - this.kickVel * 22) * dt;
    this.kickPitch += this.kickVel * dt;
    this.kickYaw *= Math.exp(-dt * 12);

    const cam = this.ctx.camera;
    const eye = p.eyeHeight + this.stepOffset + this.bobY + this.dip * 0.1;
    cam.position.set(pos.x + this.bobX * Math.cos(p.yaw), pos.y + eye, pos.z - this.bobX * Math.sin(p.yaw));
    const roll = this.bobX * 0.35;
    cam.rotationQuaternion ??= Quaternion.Identity();
    Quaternion.RotationYawPitchRollToRef(p.yaw + this.kickYaw, p.pitch + this.kickPitch, roll, cam.rotationQuaternion);
    const targetFov = baseFov * zoom;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 18);
    this.ctx.setFov(this.fov);
  }
}
