/** Pure, Babylon-free timing for the crate reveal so it can be unit tested.
 * t is seconds since the anticipation started (after the server result and the reward
 * model are ready). Stylized and exaggerated: anticipation, squash/stretch, overshoot. */
export const REVEAL = {
  /** Shake starts the sequence; the lid pops at `pop`; everything bursts at `burst`. */
  pop:.46, burst:1.38,
  /** Final crouch before the burst (seconds). */
  windup:.16,
  /** Reward rises from the crate for `rise` seconds after the burst. */
  rise:.95,
  /** Name/rarity show at `title`, buttons at `controls` (both after the burst). */
  title:1.0, controls:1.45,
  heroY:1.5, crateTargetY:.42, gravity:-9.5,
  /** Slightly angled side view: muzzle to the right and a little toward the viewer. */
  heroYaw:1.18, heroPitch:.14,
} as const;

const clamp01 = (x:number) => Math.min(1, Math.max(0, x));
export const ease = {
  inCubic:(x:number)=>x*x*x,
  outCubic:(x:number)=>1-(1-x)**3,
  inOutCubic:(x:number)=>x<.5?4*x*x*x:1-(-2*x+2)**3/2,
  outBack:(x:number,s=1.9)=>1+(s+1)*(x-1)**3+s*(x-1)**2,
  /** Damped settle from 1 toward 0 with visible overshoot. */
  wobble:(x:number,freq=14,decay=6)=>Math.exp(-decay*x)*Math.cos(freq*x),
};
const span = (t:number,a:number,b:number) => clamp01((t-a)/(b-a));

export interface CratePose {
  squashY:number; squashXZ:number; tiltX:number; tiltZ:number; crateY:number;
  /** Shared lid lift before the burst, metres. */ lidLift:number;
  /** Per-lid rattle amplitude, metres. */ rattle:number;
  /** Emissive strength of seams/core, 0 = off. */ seam:number; core:number;
  /** 0..1 visibility of light leaking from the seams and of the burst column. */ leak:number; column:number;
}
/** `motion` 0 removes shake/jitter (reduced motion) but keeps the same beats. */
export function cratePose(t:number,motion=1):CratePose {
  const { pop, burst } = REVEAL;
  let squashY=1, squashXZ=1, tiltX=0, tiltZ=0, lidLift=0, rattle=0, crateY=0;
  if(t<pop){// Anticipation: crouch down while the shake builds.
    const s=ease.inOutCubic(span(t,0,pop)), amp=(.018+.05*s)*motion;
    squashY=1-.13*s; squashXZ=1+.075*s; tiltZ=Math.sin(t*52)*amp; tiltX=Math.sin(t*41+1)*amp*.6;
  }else if(t<burst){// Pop: stretch up, lid jumps then hovers, tremble grows toward the burst.
    const k=t-pop, charge=span(t,pop,burst), amp=(.01+.03*charge)*motion;
    const stretch=ease.wobble(k,16,7);squashY=1+.16*stretch; squashXZ=1-.08*stretch;
    tiltZ=Math.sin(t*61)*amp; tiltX=Math.sin(t*53+2)*amp*.7;
    lidLift=k<.12?.12*ease.outCubic(k/.12):.035+.085*Math.max(0,ease.wobble(k-.12,18,9));
    rattle=.006*charge*motion;
    // Wind-up: the last beat before the burst crouches the body and sucks the lid down,
    // so the explosion reads as released pressure rather than a cut.
    const wind=ease.inCubic(span(t,burst-REVEAL.windup,burst));
    squashY*=1-.11*wind; squashXZ*=1+.06*wind; lidLift*=1-.85*wind; rattle*=1+2*wind;
  }else{// Burst: big squash, springy recovery, then the body sinks out of the rising shot.
    const k=t-burst;squashY=1-.2*ease.wobble(k,13,5.5);squashXZ=1+.1*ease.wobble(k,13,5.5);
    crateY=-.6*ease.inOutCubic(span(k,.2,1.2));lidLift=.035;
  }
  const charge=span(t,pop,burst);
  // After the flash the open crate cools quickly so it never competes with the rising reward.
  const seam=t<pop-.04?0:t<burst?1.2+2.6*charge*charge+Math.sin(t*24)*.35*charge:6*Math.exp(-(t-burst)*6);
  const core=t<burst?seam*.6:Math.max(.3,6*Math.exp(-(t-burst)*3.5));
  const leak=t<pop?0:t<burst?ease.outCubic(span(t,pop,pop+.3))*(.55+.45*charge):1-span(t,burst,burst+.35);
  const column=t<burst?0:Math.sin(Math.PI*span(t,burst,burst+1.25))**.6;
  return { squashY, squashXZ, tiltX, tiltZ, crateY, lidLift, rattle, seam, core, leak, column };
}

export interface LidPose { x:number; y:number; z:number; angle:number; spin:number; visible:boolean }
/** One lid quarter. `rx/rz` is its rest offset from the crate centre (sets the outward
 * direction); `seed` gives each piece its own secondary motion. Positions are offsets. */
export function lidPose(t:number,rx:number,rz:number,seed:number,motion=1):LidPose {
  const { burst, gravity } = REVEAL;
  const pose=cratePose(t,motion);
  if(t<burst){
    const r=pose.rattle*Math.sin(t*47+seed*2.1);
    return { x:0, y:pose.lidLift+r, z:0, angle:0, spin:0, visible:true };
  }
  const k=t-burst, len=Math.hypot(rx,rz)||1, dx=rx/len, dz=rz/len, jitter=.85+.3*((seed*.618)%1);
  const out=2.3*jitter, up=3.7*(1.08-.16*((seed*.37)%1));
  return { x:dx*out*k, y:pose.lidLift+up*k+.5*gravity*k*k, z:dz*out*k*.75,
    angle:(6.5+seed)*k, spin:(seed%2?1:-1)*2.2*k, visible:k<1.6 };
}

export interface HeroPose { y:number; scale:number; spin:number; visible:boolean }
/** Reward shoots up out of the crate, spins once and settles at the hero angle. */
export function heroPose(t:number):HeroPose {
  const { burst, rise, heroY, crateTargetY } = REVEAL;
  if(t<burst+.04)return { y:crateTargetY, scale:.12, spin:-Math.PI*2, visible:false };
  const k=span(t,burst+.04,burst+.04+rise);
  return { y:crateTargetY-.1+(heroY-crateTargetY+.1)*ease.outBack(k,1.5), scale:.12+.88*ease.outBack(k,1.2),
    spin:-Math.PI*2*(1-ease.outCubic(span(t,burst+.04,burst+.04+rise*1.25))), visible:true };
}

export interface CameraPose { targetY:number; beta:number; zoom:number }
/** Starts above the crate looking down; tilts up with the reward to look slightly up at it. */
export function cameraPose(t:number):CameraPose {
  const { burst, heroY, crateTargetY } = REVEAL;
  const k=ease.inOutCubic(span(t,burst-.05,burst+1.05));
  return { targetY:crateTargetY+(heroY-crateTargetY)*k, beta:1.17+(1.66-1.17)*k, zoom:k };
}

/** Semi-implicit damped spring toward 0 (slight overshoot, ~0.8 s settle). */
export function stepSpring(s:{x:number;v:number},dt:number,k=58,c=9):void {
  s.v+=(-k*s.x-c*s.v)*dt; s.x+=s.v*dt;
}
/** Shortest equivalent angle so a released turn springs back the short way. */
export const wrapAngle = (a:number) => Math.atan2(Math.sin(a), Math.cos(a));
