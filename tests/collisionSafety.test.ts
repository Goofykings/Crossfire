import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { PlayerController, NO_INTENT } from '../src/player/PlayerController';
import { FIXED_DT } from '../src/config/constants';
import { WORLDS } from '../server/src/world';
import { MAP_IDS } from '../shared/maps';
import { groundLocations } from '../shared/navigation';
import { unsafeMovement } from '../shared/movementSafety';

it('sweeps thin rotated walls without tunneling and preserves tangential movement', () => {
  for (const yaw of [0, .3, Math.PI / 4]) {
    const w = new CollisionWorld(); w.add({ c: [0, 2, 0], h: [.005, 2, 10], yaw });
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const start = { x: -2 * c, z: 2 * s };
    const move = w.moveCylinder(start.x, start.z, 5 * c + 2 * s, -5 * s + 2 * c, .34, .01, 1.8);
    expect(move.x * c - move.z * s).toBeLessThanOrEqual(-.34499);
    expect(move.x * s + move.z * c).toBeCloseTo(2, 4);
    expect(w.overlapsCylinder(move.x, move.z, .33999, .01, 1.8)).toBe(false);
  }
});
it('rounds OBB corners without the invisible square corner of an expanded AABB', () => {
  const w = new CollisionWorld(); w.add({ c: [0, 1, 0], h: [1, 1, 1] });
  const move = w.moveCylinder(1.3, 1.3, .02, -.02, .34, 0, 1.8);
  expect(move.x).toBeCloseTo(1.32); expect(move.z).toBeCloseTo(1.28);
});
it('does not propel an initially embedded cylinder toward another exit face', () => {
  const w = new CollisionWorld(); w.add({ c: [0, 2, 0], h: [.02, 2, 4] });
  const move = w.moveCylinder(-.1, 0, .05, .1, .34, 0, 1.8);
  expect(move.x).toBeCloseTo(-.1); expect(move.z).toBeCloseTo(.1);
});
it('repeated diagonal slides/jump cancellation cannot cross a thin corner', () => {
  const w = new CollisionWorld(); w.add({ c: [0, -1, 0], h: [20, 1, 20] });
  w.add({ c: [0, 3, 0], h: [.01, 3, 12] }); w.add({ c: [-6, 3, -3], h: [6, 3, .01] });
  for (const weapon of ['rifle', 'smg', 'shotgun', 'sniper'] as const) {
    const p = new PlayerController(w); p.weaponClearance = weapon;
    p.teleport({ x: -3, y: 0, z: 1 }); p.yaw = -Math.PI / 4;
    p.velocity.x = 60; p.velocity.z = -60;
    for (let n = 0; n < 2400; n++) {
      p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, slide: n % 300 < 130, jumpPressed: n % 180 === 20 || n % 180 === 45 });
      expect(p.position.x).toBeLessThan(-.01 + 1e-5); expect(p.position.z).toBeGreaterThan(-2.99 - 1e-5);
      expect(p.position.y).toBeGreaterThanOrEqual(0);
    }
  }
});
describe.each(MAP_IDS)('%s actual map safety', id => {
  it('has continuous ground, thick closed perimeter, and valid solids', () => {
    const { world, layout } = WORLDS[id];
    for (const c of world.all()) {
      expect([c.cx,c.cy,c.cz,c.hx,c.hy,c.hz,c.yaw].every(Number.isFinite)).toBe(true);
      expect(Math.min(c.hx,c.hy,c.hz)).toBeGreaterThan(0);
    }
    const [x0,z0,x1,z1] = layout.playArea;
    for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1)
      expect(world.groundHeight(x,z,0,.001)).toBeGreaterThanOrEqual(layout.ground.baseHeight);
    const boundaries = [...world.all()].filter(c => c.tag === 'boundary');
    expect(boundaries).toHaveLength(4);
    for (const c of boundaries) expect(Math.min(c.hx,c.hz)).toBeGreaterThanOrEqual(1);
    for (let d = -1; d <= 1; d += .1) {
      for (const [dx,dz] of [[100,d*25],[-100,d*25],[d*25,100],[d*25,-100]]) {
        // Isolate actual perimeter from intervening buildings, retaining authored transforms.
        const walls = new CollisionWorld(); for (const c of boundaries) walls.add({ c:[c.cx,c.cy,c.cz],h:[c.hx,c.hy,c.hz],yaw:c.yaw });
        const end = walls.moveCylinder(0,0,dx,dz,.34,.01,1.8);
        expect(unsafeMovement({ ...end, y:0 },layout)).toBeNull();
      }
    }
  });
  it('stress replays normal bodies, jumps and slide spam without escape or correction teleports', () => {
    const { world, layout } = WORLDS[id], pool = groundLocations(layout,world);
    let seed = 713; const random = () => ((seed = (Math.imul(seed,1664525)+1013904223) >>> 0) / 4294967296);
    for (let trial = 0; trial < 20; trial++) {
      const p = new PlayerController(world);
      p.weaponClearance = (['rifle','smg','shotgun','sniper'] as const)[trial % 4];
      p.teleport(pool[Math.floor(random()*pool.length)]); let yaw = random()*Math.PI*2;
      for (let n = 0; n < 900; n++) {
        if (n % 45 === 0) yaw += (random()-.5)*2.5; p.yaw = yaw;
        const old = { ...p.position };
        p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1,x:trial%3===0?.7:0,slide:n%250<130,jumpPressed:n%170===15||n%170===45});
        expect(unsafeMovement(p.position,layout), JSON.stringify({trial,n,old,pos:p.position})).toBeNull();
        expect(Math.hypot(p.position.x-old.x,p.position.z-old.z)).toBeLessThan(.13);
      }
    }
  });
});
it('secondary safety tolerates legal edge contact and airborne movement, identifies real invalid states', () => {
  const layout = WORLDS['industrial-complex'].layout;
  expect(unsafeMovement({x:27.2,y:0,z:0},layout)).toBeNull();
  expect(unsafeMovement({x:0,y:50,z:0},layout)).toBeNull();
  expect(unsafeMovement({x:29,y:0,z:0},layout)).toBe('outside_perimeter');
  expect(unsafeMovement({x:0,y:-1.01,z:0},layout)).toBe('below_ground');
  expect(unsafeMovement({x:NaN,y:0,z:0},layout)).toBe('non_finite');
});

it.each(MAP_IDS)('%s collision is identical at 30/60/144 render Hz and after delayed snapshot replay', id => {
  const world = WORLDS[id].world;
  const start = groundLocations(WORLDS[id].layout,world)[0];
  const make = () => { const p = new PlayerController(world); p.weaponClearance='sniper'; p.teleport(start); return p; };
  const frames = Array.from({length:720},(_,i)=>({ yaw:Math.sin(i/90)*2,
    intent:{...NO_INTENT,z:1,x:Math.sin(i/30),slide:i%240<120,jumpPressed:i%170===15||i%170===45} }));
  const authority = make(); let checkpoint = authority.capture();
  for (let i=0;i<frames.length;i++) { const f=frames[i];authority.yaw=f.yaw;authority.fixedUpdate(FIXED_DT,f.intent);if(i===359)checkpoint=authority.capture(); }
  for(const fps of [30,60,144]) {
    const predicted=make();let acc=0,tick=0;
    while(tick<frames.length) {
      acc+=1/fps;
      while(acc+1e-10>=FIXED_DT&&tick<frames.length){const f=frames[tick++];predicted.yaw=f.yaw;predicted.fixedUpdate(FIXED_DT,f.intent);acc-=FIXED_DT;}
    }
    expect(predicted.capture()).toEqual(authority.capture());
    // A delayed authoritative snapshot rewinds 360 ticks; remaining queued intents replay exactly.
    predicted.restore(checkpoint);
    for(let i=360;i<frames.length;i++){const f=frames[i];predicted.yaw=f.yaw;predicted.fixedUpdate(FIXED_DT,f.intent);}
    expect(predicted.capture()).toEqual(authority.capture());
  }
});
it('sweeps vertical motion through thin floors and ceilings without losing support', () => {
  const w = new CollisionWorld();w.add({c:[0,-.005,0],h:[10,.005,10]});w.add({c:[0,4.005,0],h:[10,.005,10]});
  const p=new PlayerController(w);p.teleport({x:0,y:0,z:0});
  p.position.y=1;p.grounded=false;p.velocity.y=-240;p.fixedUpdate(FIXED_DT,NO_INTENT);
  expect(p.position.y).toBe(0);expect(p.grounded).toBe(true);
  p.velocity.y=240;p.grounded=false;p.fixedUpdate(FIXED_DT,NO_INTENT);
  expect(p.position.y+p.height).toBeLessThanOrEqual(4.00001);
});

it('cannot accumulate penetration and escape an acute thin-wall seam under repeated slides', () => {
  const w=new CollisionWorld();w.add({c:[0,-1,0],h:[100,1,100]});
  w.add({c:[0,3,0],h:[.01,3,100]});w.add({c:[0,3,0],h:[.01,3,100],yaw:.02});
  const p=new PlayerController(w);p.teleport({x:.5,y:0,z:50});
  for(let n=0;n<3000;n++){
    const before={...p.position};p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1,slide:n%240<125});
    expect(Math.hypot(p.position.x-before.x,p.position.z-before.z)).toBeLessThan(.066);
    expect(w.overlapsCylinder(p.position.x,p.position.z,.33999,p.position.y+.001,p.position.y+p.height)).toBe(false);
  }
  // Old endpoint projection crossed the seam, teleported .70 m and reached z=-75.6.
  expect(p.position.z).toBeGreaterThan(34.9);expect(p.position.x).toBeCloseTo(.35,4);
});
