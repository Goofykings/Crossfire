import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMapWorld } from '../shared/world';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import type { CollisionFile, MapLayout, PropCatalog } from '../src/maps/types';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';
import { CollisionWorld } from '../src/physics/CollisionWorld';

const layout = JSON.parse(readFileSync('src/maps/industrial-complex/layout.json','utf8')) as MapLayout;
const collision = JSON.parse(readFileSync('public/assets/models/industrial-complex/collision.json','utf8')) as CollisionFile;
const catalog = JSON.parse(readFileSync('public/assets/models/shared/props/props.json','utf8')) as PropCatalog;
const world = createMapWorld(collision,layout,catalog);
const tick = (p: PlayerController, seconds: number, z = 0) => {
  for (let i=0;i<seconds/FIXED_DT;i++) p.fixedUpdate(FIXED_DT,{...NO_INTENT,z});
};
const at = (l: NonNullable<MapLayout['ladders']>[number], weapon: PlayerController['weaponClearance'] = 'sniper') => {
  const p = new PlayerController(world); p.weaponClearance = weapon;
  p.teleport({x:l.wall[0]+l.out[0]*2.6,y:l.bottom,z:l.wall[1]+l.out[1]*2.6},
    Math.atan2(-l.out[0],l.out[1])*180/Math.PI);
  return p;
};

it('keeps editable solids, normals, hollow pipe ends and regenerated collision consistent', () => {
  // Disable site-packages to catch accidental dependencies on locally installed Pillow, etc.
  expect(execFileSync('python',['-I','-S','-B','tools/check-update-phase2.py'],{encoding:'utf8'})).toContain('pass');
},30000);

describe.each(layout.ladders ?? [])('$id authoritative ladder', l => {
  it.each(['rifle','smg','shotgun','sniper'] as const)('walks up and onto the roof with %s clearance', weapon => {
    const p = at(l,weapon); let highest = 0;
    for(let i=0;i<120*4;i++) {
      const old = {...p.position};p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1});
      highest=Math.max(highest,p.position.y);
      expect(Math.hypot(p.position.x-old.x,p.position.y-old.y,p.position.z-old.z)).toBeLessThan(.06);
      expect(world.overlapsCylinder(p.position.x,p.position.z,MOVEMENT.radius,p.position.y+.43,p.position.y+p.height)).toBe(false);
    }
    expect(highest).toBeLessThan(l.top+.1);
    expect(p.position.y).toBeCloseTo(l.top,2);expect(p.grounded).toBe(true);
  });
  it('holds its height on release, descends, exits at ground, and replays snapshots exactly', () => {
    const p=at(l);tick(p,1.1,1);expect(p.climbing).toBe(true);
    const height=p.position.y;tick(p,1);expect(p.position.y).toBeCloseTo(height,8);
    const clone=new PlayerController(world);clone.weaponClearance=p.weaponClearance;clone.restore(p.capture());
    tick(p,.4,-1);tick(clone,.4,-1);expect(clone.capture()).toEqual(p.capture());
    expect(p.position.y).toBeLessThan(height-.8);
    tick(p,2,-1);expect(p.grounded).toBe(true);expect(p.position.y).toBeCloseTo(l.bottom,4);
    expect(p.climbing).toBe(false);
  });
  it('can return from the landing to descend and jump away without reattaching', () => {
    const p=at(l);tick(p,2.7,1);expect(p.position.y).toBeGreaterThan(l.top-.01);
    tick(p,1.4,-1);expect(p.position.y).toBeLessThan(l.top-1);
    p.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});
    expect(p.velocity.y).toBeGreaterThan(5);expect(p.climbing).toBe(false);
    const before=p.position.y;tick(p,.1);expect(p.position.y).toBeGreaterThan(before);
  });
});

it('does not climb above an intervening solid ceiling or outside authored shafts', () => {
  const w=new CollisionWorld();w.add({c:[0,-1,0],h:[20,1,20]});
  w.ladders.push({id:'blocked',wall:[0,0],out:[0,1],bottom:0,top:6});
  w.add({c:[0,3,1.65],h:[1,.1,1]});
  const p=new PlayerController(w);p.teleport({x:0,y:0,z:1.65},0);tick(p,5,1);
  expect(p.position.y+p.height).toBeLessThanOrEqual(2.9001);
  expect(p.position.y).toBeGreaterThan(1);
  p.teleport({x:4,y:0,z:1.65},0);tick(p,1,1);expect(p.position.y).toBe(0);
});

it('connects the low roofs with continuous supported routes and collidable plant', () => {
  // Walk between the centres of every pair of adjoining service roofs: one continuous deck.
  const roofs=layout.buildings.filter(b=>(b as {serviceRoof?:boolean}).serviceRoof);
  expect(roofs.length).toBeGreaterThan(0);
  // A single workshop roof is crossed edge to edge.
  if(roofs.length===1){
    // Along the north side, clear of the HVAC plant (which is deliberately collidable cover).
    const [x0,z0,x1]=roofs[0].rect,z=z0+1,end=Math.min(x1,layout.playArea[2])-1;
    const p=new PlayerController(world);p.teleport({x:x0+1,y:4.5,z},90);
    for(let i=0;i<120*6&&p.position.x<end;i++){p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1});expect(p.position.y).toBeGreaterThan(4.4);}
    expect(p.position.x).toBeGreaterThan(end-.3);
  }
  const centreX=(b:typeof roofs[number])=>(b.rect[0]+Math.min(b.rect[2],layout.playArea[2]-1))/2;
  let pairs=0;
  for(const a of roofs)for(const b of roofs){
    if(a===b||!(a.rect[2]===b.rect[0]&&a.rect[1]<b.rect[3]&&b.rect[1]<a.rect[3]))continue;
    pairs++;
    const ax=centreX(a),bx=centreX(b),z=(Math.max(a.rect[1],b.rect[1])+Math.min(a.rect[3],b.rect[3]))/2;
    const p=new PlayerController(world);p.teleport({x:ax,y:4.5,z},90);
    for(let i=0;i<120*4&&p.position.x<bx-.2;i++){p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1});expect(p.position.y,`${a.id}->${b.id}`).toBeGreaterThan(4.4);}
    expect(p.position.x,`${a.id}->${b.id} roof route blocked`).toBeGreaterThan(bx-.3);
  }
  expect(pairs+(roofs.length===1?1:0)).toBeGreaterThan(0);
  expect([...world.all()].filter(c=>c.tag.startsWith('roof:equipment:'))).toHaveLength(5);
  expect([...world.all()].some(c=>c.tag==='roof:equipment:hvac_duct')).toBe(true);
});

it('preserves the Town arch crown opening while retaining masonry and both passage directions', () => {
  const l=JSON.parse(readFileSync('src/maps/european-town/layout.json','utf8')) as MapLayout;
  const c=JSON.parse(readFileSync('public/assets/models/european-town/collision.json','utf8')) as CollisionFile;
  const w=createMapWorld(c,l,catalog);
  // Every curved arcade keeps its visible 3.2 m crown opening: an old full-width 2.6 m slab
  // interrupted jumps through it. Walk and jump through each one in both directions.
  const arcades=l.buildings.flatMap(b=>(b.passages??[]).filter(p=>p.style==='arch'));
  expect(arcades.length).toBeGreaterThan(1);
  for(const passage of arcades) {
    const [x0,z0,x1,z1]=passage.rect,cx=(x0+x1)/2,cz=(z0+z1)/2,alongX=x1-x0>=z1-z0;
    expect(w.ceilingHeight(cx,cz,.2,.5),`${passage.rect} crown`).toBeGreaterThan(passage.clear-.04);
    for(const reverse of [false,true]) {
      const p=new PlayerController(w);p.weaponClearance='rifle';
      const start=alongX?{x:reverse?x1+.9:x0-.9,y:0,z:cz}:{x:cx,y:0,z:reverse?z1+.9:z0-.9};
      p.teleport(start,alongX?(reverse?270:90):(reverse?0:180));
      let peak=0;
      const length=(alongX?x1-x0:z1-z0)+2;
      for(let i=0;i<120*length/4;i++) {
        p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1,jumpPressed:i===26});
        peak=Math.max(peak,p.position.y);
      }
      expect(peak,`${passage.rect} jump strikes an invisible crown barrier`).toBeGreaterThan(1.02);
      const end=alongX?p.position.x:p.position.z;
      expect(reverse?end<(alongX?x0:z0)+.3:end>(alongX?x1:z1)-.3,`${passage.rect} reverse=${reverse}`).toBe(true);
    }
  }
  for(const a of l.arches) {
    const [x0,z0,x1,z1]=a.rect, x=(x0+x1)/2,z=(z0+z1)/2;
    expect(w.pointInside(x,a.spring+.5,z),a.id).toBeNull();
    expect(w.pointInside(x,a.spring+1.4,z)?.tag,a.id).toBe(`arch:${a.id}`);
    for(const sign of [-1,1]) {
      const p=new PlayerController(w);
      p.teleport({x,y:0,z:z+sign*1.5},sign===1?0:180);tick(p,.7,1);
      expect((p.position.z-z)*sign,a.id).toBeLessThan(-.8);
    }
  }
});
