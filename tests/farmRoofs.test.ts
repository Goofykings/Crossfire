import {expect,it} from 'vitest';
import {WORLDS} from '../server/src/world';
import collision from '../public/assets/models/farmstead/collision.json';
import {CollisionWorld,type BoxDesc} from '../src/physics/CollisionWorld';
import {PlayerController,NO_INTENT} from '../src/player/PlayerController';
import {FIXED_DT} from '../src/config/constants';
import {PracticeNavigation} from '../src/practice/Navigation';
import {PracticeSimulation} from '../src/practice/PracticeSimulation';
import {DEFAULT_PRACTICE} from '../src/practice/config';
it('every Farmstead roof has landing solids and exact sloped shot surfaces on both faces',()=>{
 const count=WORLDS.farmstead.layout.farm!.structures.flatMap(s=>s.elements).filter(e=>e.t==='roof').length;
 expect(collision.roofSurfaces).toHaveLength(count);
 for(const surface of collision.roofSurfaces){
  const world=new CollisionWorld(),boxes=world.addMany(collision.boxes.filter(b=>b.tag===surface.tag) as BoxDesc[]);expect(boxes.length).toBeGreaterThan(2);world.addBulletSurface(surface.mesh,[0,0,0],0,surface.tag,boxes);
  const m=surface.mesh;
  for(const side of [-1,1]){
   const x=m.center[0]+(m.half[0]<m.half[2]?side*m.half[0]*.5:0),z=m.center[2]+(m.half[0]>=m.half[2]?side*m.half[2]*.5:0),top=m.center[1]+m.half[1];
   const hit=world.raycastBullet(x,top+2,z,0,-1,0,10);expect(hit,surface.tag).not.toBeNull();expect(hit!.collider.bulletOnly).toBe(true);expect(hit!.normal.y).toBeGreaterThan(.8);
   const p=new PlayerController(world);p.teleport({x,y:top+1,z});for(let i=0;i<180;i++)p.fixedUpdate(FIXED_DT,NO_INTENT);
   expect(p.grounded,surface.tag).toBe(true);expect(Math.abs(p.position.y-hit!.point.y),surface.tag).toBeLessThan(.3);expect(p.position.y).toBeGreaterThan(hit!.point.y-.06);
  }
 }
});
it('Practice applies the shared authoritative roof-exit recovery once without granting a kill',()=>{
 const data=WORLDS.farmstead,navigation=new PracticeNavigation(data.world,{...data.layout,playArea:[-2,-2,2,2]}),sim=new PracticeSimulation({...DEFAULT_PRACTICE,mapId:'farmstead',bots:0},{world:data.world,layout:data.layout,revision:data.revision},'Local',{now:0,navigation}),player=sim.actors[0];sim.spawnHuman('rifle');
 const bounds=data.layout.farm!.perimeter!.inner;player.controller.teleport({x:bounds[2]+.02,y:6,z:0});sim.step();expect(player.state.alive).toBe(false);expect(player.state.deaths).toBe(1);expect(player.state.kills).toBe(0);sim.step();expect(player.state.deaths).toBe(1);
});
it('Practice navigation includes roof support heights, sharing the authoritative world',()=>{
 const {world,layout}=WORLDS.farmstead;
 for(const roof of collision.roofSurfaces){const m=roof.mesh,nav=new PracticeNavigation(world,{...layout,playArea:[m.center[0]-1,m.center[2]-1,m.center[0]+1,m.center[2]+1]});expect(nav.nodes.some(n=>Math.abs(n.x-m.center[0])<m.half[0]&&Math.abs(n.z-m.center[2])<m.half[2]&&n.y>=m.center[1]-.4),roof.tag).toBe(true);}
});
