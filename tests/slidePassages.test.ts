import { expect, it } from 'vitest';
import { MOVEMENT, FIXED_DT } from '../src/config/constants';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';
import { createMapWorld } from '../shared/world';
import { playerHeight } from '../shared/combat';
import { validMotion, parseClientMessage, PROTOCOL_VERSION } from '../shared/protocol';
import collision from '../public/assets/models/industrial-complex/collision.json';
import environment from '../public/assets/models/industrial-complex/environment.json';
import layout from '../src/maps/industrial-complex/layout.json';
import catalog from '../public/assets/models/shared/props/props.json';
import type { CollisionFile, MapLayout, PropCatalog } from '../src/maps/types';
import type { EnvironmentDefinition } from '../shared/environment';
import { PracticeNavigation } from '../src/practice/Navigation';

const world=()=>createMapWorld(collision as unknown as CollisionFile,layout as unknown as MapLayout,catalog as unknown as PropCatalog,environment as unknown as EnvironmentDefinition);
it('both real Industrial maintenance passages block stand/crouch and pass all four sliding weapons in both directions',()=>{
 const w=world();expect(layout.slidePassages).toHaveLength(2);
 for(const passage of layout.slidePassages)for(const sign of [-1,1])for(const gun of ['rifle','smg','shotgun','sniper','semi-sniper'] as const){
  const [x,z]=passage.center;
  for(const mode of ['stand','crouch','slide']){
   const p=new PlayerController(w);p.weaponClearance=gun;p.teleport({x,y:0,z:z+sign*2.3},sign===1?0:180);
   for(let i=0;i<140;i++){
    p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1,slide:mode==='slide',crouch:mode==='crouch'});
    expect(w.overlapsCylinder(p.position.x,p.position.z,MOVEMENT.radius-.001,p.position.y+.43,p.position.y+p.height-.001)).toBe(false);
    expect(p.eyeHeight).toBeLessThan(p.height);
   }
   if(mode==='slide')expect(sign*(p.position.z-z)).toBeLessThan(-.8);
   else expect(sign*(p.position.z-z)).toBeGreaterThan(.4);
  }
 }
});
it('expiry under a long low ceiling retains a valid stance, survives restore, and recovers safely after exit',()=>{
 const w=new CollisionWorld();w.add({c:[0,-.5,0],h:[20,.5,20]});w.add({c:[0,1.5,-5],h:[2,.55,4]});
 w.slidePassages.push({x:0,z:-5,halfWidth:2,halfDepth:4,clearance:.95});
 const a=new PlayerController(w);a.teleport({x:0,y:0,z:1});
 for(let i=0;i<126;i++)a.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1,slide:true});
 expect(a.sliding).toBe(false);expect(a.lowClearance).toBe(true);expect(a.height).toBe(MOVEMENT.slideHeight);
 expect(playerHeight(a.capture())).toBe(a.height);expect(validMotion(a.capture())).toBe(true);
 expect(validMotion({...a.capture(),lowClearance:'yes'})).toBe(false);
 const input={v:PROTOCOL_VERSION,type:'input',roundId:0,mapVersion:'test',frames:[{seq:1,yaw:0,pitch:0,intent:{...NO_INTENT},combat:{trigger:false,reload:false}}]};
 expect(parseClientMessage(JSON.stringify(input))).not.toBeNull();
 expect(parseClientMessage(JSON.stringify({...input,frames:[{...input.frames[0],intent:{...NO_INTENT,lowClearance:true}}]}))).toBeNull();
 const b=new PlayerController(w);b.restore(a.capture());
 for(let i=0;i<400;i++){
  for(const p of [a,b])p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1});
  expect(a.capture()).toEqual(b.capture());
  expect(w.overlapsCylinder(a.position.x,a.position.z,.339,a.position.y+.43,a.position.y+a.height-.001)).toBe(false);
 }
 expect(a.position.z).toBeLessThan(-10);expect(a.lowClearance).toBe(false);expect(a.height).toBe(MOVEMENT.standHeight);
});
it('Practice navigation excludes slide-only openings for non-sliding bots while keeping alternate paths',()=>{
 const nav=new PracticeNavigation(world(),layout as unknown as MapLayout);
 for(const p of layout.slidePassages){const [x,z]=p.center,a={x,y:0,z:z+1.5},b={x,y:0,z:z-1.5};
  expect(nav.walkable(a,b)).toBe(false);const path=nav.path(a,b);expect(path.length).toBeGreaterThan(2);
  expect(Math.hypot(path.at(-1)!.x-b.x,path.at(-1)!.z-b.z)).toBeLessThan(1.2);
 }
});
