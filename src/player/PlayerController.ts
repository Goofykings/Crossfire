import { MOVEMENT, type MovementConfig } from '../config/constants';
import type { CollisionWorld, CylinderContact } from '../physics/CollisionWorld';
import { LEAN_RATE, leanOffset, safeLean } from '../../shared/lean';
import type { WeaponId } from '../weapons/Weapon';

// Eye-to-muzzle distances include a small margin for view-model sway. Based on
// the existing model anchors and the most forward of the hip and ADS poses.
export const WEAPON_CLEARANCE: Record<WeaponId, number> = {
  smg: .88, rifle: 1.12, shotgun: 1.13, sniper: 1.26,
};

/** Per-tick intent, produced by the input layer (or a network packet in the future). */
export interface MoveIntent {
  /** Strafe, -1 (left) .. 1 (right). */
  x: number;
  /** Forward, -1 (back) .. 1 (forward). */
  z: number;
  /** Held Shift; the shared simulation requires a release before another slide. */
  slide: boolean;
  aim: boolean;
  /** True on the tick the jump key went down (edge, not level). */
  jumpPressed: boolean;
  /** Held direction, never a client-assigned position. */
  lean?: -1 | 0 | 1;
  crouch?: boolean;
}

export const NO_INTENT: MoveIntent = { x: 0, z: 0, slide: false, aim: false, jumpPressed: false };

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Full simulation state for trusted snapshots, prediction replay and server reconstruction. */
export interface ControllerState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  crouch: number;
  slideRemaining: number;
  slideCooldown: number;
  slideHeld: boolean;
  slideYaw: number;
  airTime: number;
  jumpBufferTimer: number;
  jumpedThisAirborne: boolean;
  lean: number;
}

/**
 * Kinematic first-person character controller.
 *
 * The body is a vertical cylinder that only collides above `stepHeight`; below that, a ground probe
 * finds the highest surface under the player and snaps the feet onto it. That makes stairs and curbs
 * smooth while walls still block. All simulation runs at a fixed timestep, so movement is
 * independent of frame rate.
 *
 * Orientation: `yaw` is a right-handed rotation about +Y (yaw 0 looks toward -Z / north,
 * positive yaw turns left). `pitch` is positive looking up.
 */
export class PlayerController {
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  readonly prevPosition: Vec3 = { x: 0, y: 0, z: 0 };
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;
  grounded = false;
  /** 0 = standing, 1 = fully crouched. */
  crouch = 0;
  prevCrouch = 0;
  lean = 0;
  prevLean = 0;
  /** Equipped, server-owned weapon; null disables the additional weapon sweep. */
  weaponClearance: WeaponId | null = null;
  slideRemaining = 0;
  slideCooldown = 0;
  slideHeld = false;
  private slideYaw = 0;
  get cfg(): MovementConfig { return this.baseConfig; }

  get sliding(): boolean { return this.slideRemaining > 0; }
  /** Derived from trusted map geometry and the existing snapshot; no new client position field. */
  get climbing(): boolean { return !this.grounded && !this.jumpedThisAirborne && !!this.ladderRegion(); }
  /** Seconds since the player last stood on ground (for coyote time). */
  private airTime = 0;
  private jumpBufferTimer = 0;
  private jumpedThisAirborne = false;
  /** Accumulated upward snaps this tick, used by the camera to smooth stairs. */
  stepUpDelta = 0;
  /** True on the tick the player landed, with the impact speed. */
  landedSpeed = 0;
  private readonly contacts: CylinderContact[] = [];

  constructor(
    private readonly world: CollisionWorld,
    private readonly baseConfig: MovementConfig = MOVEMENT,
  ) {}

  get height(): number {
    return this.cfg.standHeight + (this.cfg.crouchHeight - this.cfg.standHeight) * this.crouch;
  }

  get eyeHeight(): number {
    return (this.baseConfig.standEye + (this.baseConfig.crouchEye - this.baseConfig.standEye) * this.crouch);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  capture(): ControllerState {
    return { position: { ...this.position }, velocity: { ...this.velocity }, yaw: this.yaw, pitch: this.pitch,
      grounded: this.grounded, crouch: this.crouch, airTime: this.airTime, jumpBufferTimer: this.jumpBufferTimer,
      slideRemaining: this.slideRemaining, slideCooldown: this.slideCooldown, slideHeld: this.slideHeld, slideYaw: this.slideYaw,
      jumpedThisAirborne: this.jumpedThisAirborne, lean: this.lean };
  }

  restore(s: ControllerState): void {
    Object.assign(this.position, s.position);
    Object.assign(this.prevPosition, s.position);
    Object.assign(this.velocity, s.velocity);
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.grounded = s.grounded;
    this.crouch = s.crouch;
    this.prevCrouch = s.crouch;
    this.lean = this.prevLean = s.lean ?? 0;
    this.slideRemaining = s.slideRemaining;
    this.slideCooldown = s.slideCooldown;
    this.slideHeld = s.slideHeld;
    this.slideYaw = s.slideYaw;
    this.airTime = s.airTime;
    this.jumpBufferTimer = s.jumpBufferTimer;
    this.jumpedThisAirborne = s.jumpedThisAirborne;
    this.stepUpDelta = this.landedSpeed = 0;
  }

  /** Compass heading in degrees (0 = north, 90 = east) -> internal yaw. */
  static headingToYaw(headingDeg: number): number {
    return (-headingDeg * Math.PI) / 180;
  }

  teleport(pos: Vec3, headingDeg?: number): void {
    this.position.x = this.prevPosition.x = pos.x;
    this.position.y = this.prevPosition.y = pos.y;
    this.position.z = this.prevPosition.z = pos.z;
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    if (headingDeg !== undefined) this.yaw = PlayerController.headingToYaw(headingDeg);
    this.pitch = 0;
    this.crouch = 0;
    this.prevCrouch = 0;
    this.lean = this.prevLean = 0;
    this.slideRemaining = this.slideCooldown = this.slideYaw = 0;
    this.slideHeld = false;
    this.jumpedThisAirborne = false;
    this.grounded = false;
    this.airTime = 0;
    this.jumpBufferTimer = 0;
    this.settle();
  }

  /** Drop onto the ground directly below (used after teleporting). */
  settle(): void {
    const g = this.world.groundHeight(this.position.x, this.position.z, this.cfg.radius * 0.7, this.position.y + 2);
    if (g > -Infinity) {
      this.position.y = this.prevPosition.y = g;
      this.grounded = true;
    }
  }

  /** Unit forward vector on the ground plane for the current yaw. */
  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  /** Unit look direction including pitch. */
  lookDirection(): Vec3 {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }

  fixedUpdate(dt: number, intent: MoveIntent): void {
    const c = this.cfg;
    const p = this.position;
    const v = this.velocity;
    this.prevPosition.x = p.x;
    this.prevPosition.y = p.y;
    this.prevPosition.z = p.z;
    this.stepUpDelta = 0;
    this.landedSpeed = 0;
    this.prevCrouch = this.crouch;
    this.prevLean = this.lean;

    if (!this.sliding) this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    const pressed = intent.slide && !this.slideHeld;
    this.slideHeld = intent.slide;
    if (pressed && this.grounded && !this.sliding && this.slideCooldown === 0
      && (this.horizontalSpeed > 0.5 || Math.hypot(intent.x, intent.z) > 0.01)) {
      // Momentum chooses the starting direction, even if the view turns during this press.
      const f = this.forward();
      this.slideYaw = this.horizontalSpeed > 0.5 ? Math.atan2(v.z, v.x)
        : Math.atan2(f.z * intent.z + f.x * intent.x, f.x * intent.z - f.z * intent.x);
      this.slideRemaining = c.slideDuration;
    }

    // Held crouch and slides share the same lowered collider and headroom checks.
    let crouchTarget = this.sliding || intent.crouch ? 1 : 0;
    if (crouchTarget < this.crouch) {
      // only stand up if there is head room for the taller body
      const standTop = p.y + c.standHeight;
      const ceiling = this.world.ceilingHeight(p.x, p.z, c.radius, p.y + c.stepHeight + 0.01);
      if (ceiling < standTop) crouchTarget = this.crouch;
    }
    const crouchStep = c.crouchRate * dt;
    this.crouch += Math.max(-crouchStep, Math.min(crouchStep, crouchTarget - this.crouch));

    // --- desired horizontal velocity ----------------------------------------------------------
    let ix = intent.x;
    let iz = intent.z;
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    const wishX = -sinY * iz + cosY * ix;
    const wishZ = -cosY * iz - sinY * ix;
    let maxSpeed = c.walkSpeed;
    if (this.crouch > 0.5) maxSpeed = c.crouchSpeed;
    else if (intent.aim) maxSpeed = c.aimSpeed;
    const targetX = wishX * maxSpeed;
    const targetZ = wishZ * maxSpeed;

    if (this.sliding) {
      if (len > 0.01) {
        const targetYaw = Math.atan2(wishZ, wishX);
        const turn = Math.atan2(Math.sin(targetYaw - this.slideYaw), Math.cos(targetYaw - this.slideYaw));
        this.slideYaw += Math.max(-c.slideSteerRate * dt, Math.min(c.slideSteerRate * dt, turn));
      }
      const speed = c.walkSpeed + (c.slideSpeed - c.walkSpeed) * this.slideRemaining / c.slideDuration;
      v.x = Math.cos(this.slideYaw) * speed;
      v.z = Math.sin(this.slideYaw) * speed;
    } else if (this.grounded) {
      const hasInput = len > 0.01;
      const rate = (hasInput ? c.groundAccel : c.groundDecel) * dt;
      const dx = targetX - v.x;
      const dz = targetZ - v.z;
      const dl = Math.hypot(dx, dz);
      if (dl <= rate) {
        v.x = targetX;
        v.z = targetZ;
      } else {
        v.x += (dx / dl) * rate;
        v.z += (dz / dl) * rate;
      }
    } else if (len > 0.01) {
      // limited air control: steer toward the wish direction without exceeding the current max
      const before = Math.hypot(v.x, v.z);
      v.x += wishX * c.airAccel * dt;
      v.z += wishZ * c.airAccel * dt;
      const after = Math.hypot(v.x, v.z);
      const cap = Math.max(before, maxSpeed);
      if (after > cap) {
        v.x *= cap / after;
        v.z *= cap / after;
      }
    }

    const climbing = this.ladderMotion(intent);

    // --- jumping ------------------------------------------------------------------------------
    if (intent.jumpPressed) this.jumpBufferTimer = c.jumpBuffer;
    else this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    const jumpCancelsSlide = this.sliding && intent.jumpPressed && !this.jumpedThisAirborne;
    // A slide can carry the player off an edge; its one jump remains available
    // until that slide ends, without enabling a second jump in the same airtime.
    const canJump = !climbing && (this.grounded || this.airTime < c.coyoteTime || jumpCancelsSlide) && !this.jumpedThisAirborne;
    if (this.jumpBufferTimer > 0 && canJump && (jumpCancelsSlide || (this.crouch < 0.5 && !this.sliding))) {
      if (jumpCancelsSlide) {
        // Keep the velocity earned by the slide; normal air control caps any
        // subsequent acceleration and the regular cooldown still applies.
        this.slideRemaining = 0;
        this.slideCooldown = c.slideCooldown;
      }
      v.y = c.jumpSpeed;
      this.grounded = false;
      this.jumpedThisAirborne = true;
      this.jumpBufferTimer = 0;
    }

    // --- gravity ------------------------------------------------------------------------------
    if (!this.grounded && !climbing) v.y -= c.gravity * dt;

    // --- integrate with substeps --------------------------------------------------------------
    const travel = Math.hypot(v.x, v.z) * dt + Math.abs(v.y) * dt;
    const steps = Math.max(1, Math.ceil(travel / c.maxSubstep));
    const sdt = dt / steps;
    const wasGrounded = this.grounded;
    for (let i = 0; i < steps; i++) this.substep(sdt, wasGrounded);

    if (this.sliding) {
      this.slideRemaining = Math.max(0, this.slideRemaining - dt);
      if (this.slideRemaining < 1e-8) {
        this.slideRemaining = 0;
        this.slideCooldown = c.slideCooldown;
      }
    }

    if (this.grounded) {
      this.jumpedThisAirborne = false;
      this.airTime = 0;
    } else {
      this.airTime += dt;
    }

    const leanTarget = this.grounded && !this.sliding && !intent.jumpPressed ? (intent.lean ?? 0) : 0;
    const nextLean = this.lean + (leanTarget - this.lean) * (1 - Math.exp(-LEAN_RATE * dt));
    this.lean = safeLean(this.world, p, this.yaw, this.eyeHeight, nextLean);
    if (Math.abs(this.lean) < .0001) this.lean = 0;

    if (p.y < c.killY) {
      // fell out of the world: caller decides where to respawn; stop the fall meanwhile
      v.x = v.y = v.z = 0;
    }
  }

  private ladderRegion() {
    const p = this.position;
    return this.world.ladders.find((l) => {
      const dx = p.x - l.wall[0], dz = p.z - l.wall[1];
      const outward = dx * l.out[0] + dz * l.out[1];
      const across = dx * l.out[1] - dz * l.out[0];
      return Math.abs(across) < .5 && outward > 1.3 && outward < 2.08
        && p.y >= l.bottom - .08 && p.y <= l.top + .09;
    });
  }

  private ladderMotion(intent: MoveIntent): boolean {
    const l = this.ladderRegion();
    if (!l || this.sliding || this.jumpedThisAirborne || Math.abs(intent.x) > .4) return false;
    const p = this.position, v = this.velocity, f = this.forward();
    const facing = -(f.x * l.out[0] + f.z * l.out[1]) > .45;
    const bottom = p.y <= l.bottom + .04, top = p.y >= l.top - .01;
    if (this.grounded && (bottom ? intent.z <= 0 || !facing : intent.z >= 0 || !facing)) return false;
    if (intent.jumpPressed) {
      v.x = l.out[0] * this.cfg.walkSpeed;
      v.z = l.out[1] * this.cfg.walkSpeed;
      v.y = this.cfg.jumpSpeed;
      this.grounded = false;
      this.jumpedThisAirborne = true;
      this.jumpBufferTimer = 0;
      return false;
    }
    const dx = p.x - l.wall[0], dz = p.z - l.wall[1];
    const outward = dx*l.out[0] + dz*l.out[1];
    const across = dx*l.out[1] - dz*l.out[0];
    // Step off the landing before descending; at the crown forward naturally
    // walks onto it. The shaft itself stays clear of the landing/ceiling slab.
    const exitingTop = top && intent.z > .01;
    const clearingLanding = top && intent.z < -.01 && outward < 1.64;
    const along = exitingTop ? -2 : clearingLanding || (bottom && intent.z < 0) ? 2
      : Math.max(-1.8, Math.min(1.8, (1.65 - outward) * 8));
    const side = Math.max(-1.8, Math.min(1.8, -across * 8));
    v.x = l.out[0]*along + l.out[1]*side;
    v.z = l.out[1]*along - l.out[0]*side;
    v.y = clearingLanding ? 0 : intent.z > .01 ? Math.min(2.4, Math.max(0, (l.top + .08 - p.y) * 12))
      : intent.z < -.01 ? -2.4 : 0;
    return true;
  }

  /** Collision-limited eye origin, shared by the authoritative server and prediction. */
  leanEye(): Vec3 {
    const offset = leanOffset(this.yaw, this.lean);
    return { x: this.position.x + offset.x, y: this.position.y + this.eyeHeight, z: this.position.z + offset.z };
  }

  safeViewLean(position: Vec3, amount: number, eyeHeight: number): number {
    return safeLean(this.world, position, this.yaw, eyeHeight, amount);
  }

  /** Visual stair smoothing must not lift the eye through an overhead surface. */
  safeViewEye(position: Vec3, height: number): number {
    const ceiling = this.world.ceilingHeight(position.x, position.z, .12, position.y + this.cfg.stepHeight);
    return Math.min(height, ceiling - position.y - .12);
  }

  private substep(dt: number, wasGrounded: boolean): void {
    const c = this.cfg;
    const p = this.position;
    const v = this.velocity;
    const h = this.height;
    const oldX = p.x, oldZ = p.z;

    // Only a grounded body may step over a riser. Airborne feet must collide too;
    // ignoring them let descending players enter raised walls before push-out.
    const bottom = p.y + (this.grounded && v.y <= 0 ? c.stepHeight : .00001);
    const res = this.world.moveCylinder(p.x, p.z, v.x * dt, v.z * dt,
      c.radius, bottom, p.y + h, this.contacts);
    p.x = res.x;
    p.z = res.z;
    for (const ct of res.contacts) {
      // remove the velocity component pushing into the wall (slide along it)
      const into = v.x * ct.nx + v.z * ct.nz;
      if (into < 0) {
        v.x -= ct.nx * into;
        v.z -= ct.nz * into;
      }
    }

    // Sweep a small collection of cylinders along the view weapon. Unlike
    // enlarging the body cylinder, this keeps sideways movement and doorways
    // usable. Only remove attempted movement: an existing overlap (e.g. after
    // spawning or turning) must never push the player backwards.
    if (this.weaponClearance && Math.hypot(p.x - oldX, p.z - oldZ) > 1e-8) {
      const forward = this.forward();
      const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
      const lean = leanOffset(this.yaw, this.lean);
      const length = WEAPON_CLEARANCE[this.weaponClearance];
      const horizontal = Math.cos(this.pitch);
      // Test the weapon at the legal step-up height of this very movement.
      // Previously crouched guns hit the riser before the ground solver could
      // raise the body, consuming all slide momentum. Never lift over a wall
      // or into a ceiling, and never grant this clearance during a jump.
      const support = this.grounded && v.y <= 0
        ? this.world.groundHeight(p.x, p.z, c.radius * .7, p.y + c.stepHeight) : p.y;
      const headroom = this.world.ceilingHeight(p.x, p.z, c.radius * .95, p.y + c.stepHeight + .01);
      const stepLift = support > p.y && support + h <= headroom + .0005 ? support - p.y : 0;

      for (let pass = 0; pass < 2; pass++) {
        for (let distance = length; distance > .25; distance -= .18) {
          for (const lateral of [0, .1, .19]) {
            const dx = lean.x + forward.x * distance * horizontal + rightX * lateral;
            const dz = lean.z + forward.z * distance * horizontal + rightZ * lateral;
            // The long front section is a barrel/handguard, not a 32 cm
            // tall receiver. The old full-height band hit steps well below the
            // actual model, especially at the lowered slide eye height.
            const half = (distance > .5 ? .06 : .16);
            const y = p.y + stepLift + this.eyeHeight - .08 + Math.sin(this.pitch) * distance;
            const probe = this.world.moveCylinder(oldX + dx, oldZ + dz, p.x - oldX, p.z - oldZ,
              (distance > .5 ? .06 : .14), y - half, y + half, this.contacts);
            p.x = probe.x - dx; p.z = probe.z - dz;
            for (const ct of probe.contacts) {
              const into = v.x * ct.nx + v.z * ct.nz;
              if (into < 0) { v.x -= ct.nx * into; v.z -= ct.nz * into; }
            }
          }
        }
      }
    }

    // Weapon contacts can redirect a diagonal move: sweep that final path against
    // the body as well, so one envelope cannot slide the other through a corner.
    const body = this.world.moveCylinder(oldX, oldZ, p.x - oldX, p.z - oldZ,
      c.radius, bottom, p.y + h, this.contacts);
    p.x = body.x; p.z = body.z;
    for (const ct of body.contacts) {
      const into = v.x * ct.nx + v.z * ct.nz;
      if (into < 0) { v.x -= ct.nx * into; v.z -= ct.nz * into; }
    }

    // A climbable stair can still be too close to a ceiling for the current body.
    const nextGround = this.world.groundHeight(p.x, p.z, c.radius, p.y + c.stepHeight);
    const ceiling = this.world.ceilingHeight(p.x, p.z, c.radius, p.y + c.stepHeight + 0.01);
    if (nextGround > p.y + 0.0005 && nextGround + h > ceiling + 0.0005) {
      p.x = oldX; p.z = oldZ;
      v.x = v.z = 0;
    }

    // Query from the old vertical position: a thin ceiling/floor may have been
    // crossed by the endpoint, even with bounded high-speed substeps.
    const oldY = p.y;
    const overhead = this.world.ceilingHeight(p.x, p.z, c.radius, oldY + h - .00001,
      oldY + h + Math.max(0, v.y * dt) + .001);
    p.y += v.y * dt;

    // ceiling
    if (v.y > 0) {
      const ceil = overhead;
      if (p.y + h > ceil) {
        p.y = ceil - h;
        v.y = 0;
      }
    }

    // ground probe: highest surface we could be standing on
    const probeR = c.radius;
    const reach = v.y > 0.01 ? 0 : c.stepHeight;
    const ground = this.world.groundHeight(p.x, p.z, probeR, Math.max(oldY, p.y) + reach);
    const snap = this.grounded && wasGrounded && v.y <= 0 ? c.snapDown : 0.0005;
    if (v.y <= 0 && ground > -Infinity && p.y <= ground + snap) {
      if (ground > p.y) this.stepUpDelta += ground - p.y;
      if (!this.grounded) this.landedSpeed = Math.max(this.landedSpeed, -v.y);
      p.y = ground;
      v.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
  }

  /** Interpolated render position between the last two fixed ticks. */
  interpolated(alpha: number, out: Vec3): Vec3 {
    out.x = this.prevPosition.x + (this.position.x - this.prevPosition.x) * alpha;
    out.y = this.prevPosition.y + (this.position.y - this.prevPosition.y) * alpha;
    out.z = this.prevPosition.z + (this.position.z - this.prevPosition.z) * alpha;
    return out;
  }
}
