import bulletSurfaces from '../public/assets/models/shared/props/bullet-surfaces.json';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_IDS } from '../shared/maps';
import { createMapWorld, mapVersion } from '../shared/world';
import { WORLDS } from '../server/src/world';
import type { CollisionFile, MapLayout, PropCatalog } from '../src/maps/types';
import type { EnvironmentDefinition } from '../shared/environment';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';
import { CollisionWorld } from '../src/physics/CollisionWorld';

const catalog=JSON.parse(readFileSync('public/assets/models/shared/props/props.json','utf8')) as PropCatalog;
// (The farmstead's buildings are authored as wall/slab/stair elements: tests/farmstead.test.ts.)
describe.each(MAP_IDS.filter(id=>id!=='farmstead'))('%s enclosed circulation', id=>{
  const layout=JSON.parse(readFileSync(`src/maps/${id}/layout.json`,'utf8')) as MapLayout;
  const collision=JSON.parse(readFileSync(`public/assets/models/${id}/collision.json`,'utf8')) as CollisionFile;
  const environment=JSON.parse(readFileSync(`public/assets/models/${id}/environment.json`,'utf8')) as EnvironmentDefinition;
  const world=createMapWorld(collision,layout,catalog,environment,bulletSurfaces);
  const route=layout.circulationRoutes![0],building=layout.buildings.find(b=>b.id===route.id)!;
  it('uses matching generated collision and backend map revisions with thick enclosed walls',()=>{
    expect(WORLDS[id].revision).toBe(mapVersion(collision,layout,catalog,environment,bulletSurfaces));
    const boxes=collision.boxes.filter(b=>b.tag.startsWith(`circulation:${route.id}:`));
    const walls=boxes.filter(b=>b.tag.endsWith(':wall'));
    expect(walls.length).toBeGreaterThan(7);
    const [x0,,x1]=building.rect;
    for(const wall of walls){
      const xNormal=Math.abs(wall.c[0]-x0-.15)<.001||Math.abs(wall.c[0]-x1+.15)<.001;
      const axis=xNormal||wall.c[0]>x1-.31||wall.c[0]<x0+.31?0:2;
      const other=axis===0?2:0;
      // Door subtraction may split one thick wall into adjacent narrow pieces
      // at a corner. Measure the union, rather than mistaking a fragment for a plane.
      const spans=walls.filter(b=>Math.abs(b.c[other]-wall.c[other])<=b.h[other]+.0001&&
        Math.abs(b.c[1]-wall.c[1])<=b.h[1]+.0001)
        .map(b=>[b.c[axis]-b.h[axis],b.c[axis]+b.h[axis]]).sort((a,b)=>a[0]-b[0]);
      let lo=wall.c[axis]-wall.h[axis],hi=wall.c[axis]+wall.h[axis];
      for(let pass=0;pass<2;pass++)for(const [a,b] of spans)if(a<=hi+.0001&&b>=lo-.0001){lo=Math.min(lo,a);hi=Math.max(hi,b);}
      expect(hi-lo).toBeGreaterThanOrEqual(.299);
    }
    for(const kind of ['floor','upper-floor','ceiling','stair-a','stair-b','turn-landing','exit-stair','cabinet','light'])
      expect(boxes.some(b=>b.tag.endsWith(`:${kind}`)),kind).toBe(true);
  });
  it.each([false,true])('traverses internal turning stairs, upper floor and independent exit, reverse=%s',reverse=>{
    for(const weapon of [null,'rifle','sniper'] as const) {
      const path=reverse?[...route.waypoints].reverse():route.waypoints;
      const player=new PlayerController(world);player.weaponClearance=weapon;
      player.teleport({x:path[0][0],y:path[0][1],z:path[0][2]},0);
      let peak=0;
      for(let i=1;i<path.length;i++){
        const to=path[i],from=path[i-1];
        for(let tick=0;tick<120*15;tick++){
          const dx=to[0]-player.position.x,dz=to[2]-player.position.z,dist=Math.hypot(dx,dz);
          if(dist<.09)break;
          const toward=Math.atan2(dx,-dz)*180/Math.PI;
          // Look through the exit before strafing into a shallow upstairs landing,
          // just as a player carrying the longest gun does near any wall.
          const landing=from[1]===1.62&&to[1]===1.62;
          const groundTurn=player.position.y<.1&&Math.abs(dx)<.12&&Math.abs(dz)<.5;
          const heading=groundTurn?90:landing?(building.circulation!.flipZ?180:0)
            :player.position.y>3&&(to[1]>3||from[1]>3)?(building.circulation!.exit==='w'?270:90):toward;
          player.yaw=PlayerController.headingToYaw(heading);
          const s=Math.sin(player.yaw),c=Math.cos(player.yaw),x=dx/dist,z=dz/dist;
          player.fixedUpdate(FIXED_DT,{...NO_INTENT,x:x*c-z*s,z:-x*s-z*c});
          peak=Math.max(peak,player.position.y);
          expect(player.position.y).toBeGreaterThanOrEqual(-.02);
          expect(world.overlapsCylinder(player.position.x,player.position.z,MOVEMENT.radius,
            player.position.y+MOVEMENT.stepHeight+.01,player.position.y+MOVEMENT.standHeight)).toBe(false);
        }
        expect(Math.hypot(player.position.x-to[0],player.position.z-to[2]),
          `${weapon} segment ${i} ${JSON.stringify(player.position)} -> ${to}`).toBeLessThan(.15);
      }
      expect(peak).toBeCloseTo(route.height,2);
      for(let i=0;i<60;i++)player.fixedUpdate(FIXED_DT,NO_INTENT);
      expect(player.position.y).toBeLessThan(.1);
    }
  });
  it('keeps every spawn grounded and clear, and retains usable longer-range sightlines',()=>{
    for(const spawn of layout.spawns){
      expect(world.overlapsCylinder(spawn.pos[0],spawn.pos[2],MOVEMENT.radius,
        spawn.pos[1]+MOVEMENT.stepHeight+.01,spawn.pos[1]+MOVEMENT.standHeight),spawn.id).toBe(false);
    }
    let longest=0;
    for(let x=layout.playArea[0]+1;x<layout.playArea[2];x+=2)for(let z=layout.playArea[1]+1;z<layout.playArea[3];z+=2){
      if(world.overlapsCylinder(x,z,.34,.4,1.8))continue;
      for(let k=0;k<16;k++){
        const a=k*Math.PI/8,hit=world.raycast(x,1.64,z,Math.sin(a),0,Math.cos(a),70);
        if(hit)longest=Math.max(longest,hit.distance);
      }
    }
    expect(longest).toBeGreaterThan(20);
    // Retain medium/long views without a single uninterrupted full-width lane.
    expect(longest).toBeLessThan(Math.max(layout.playArea[2]-layout.playArea[0],layout.playArea[3]-layout.playArea[1])-2);
  });
  it('supports floor props and anchors wall fixtures to real masonry',()=>{
    const terrain=new CollisionWorld();terrain.addMany(collision.boxes);
    for(const prop of layout.props){
      const [x,y,z]=prop.pos;
      if(prop.type==='wall_lantern'){
        const a=prop.heading*Math.PI/180;
        expect(terrain.raycast(x,y,z,-Math.sin(a),0,Math.cos(a),.08),`${prop.type} ${prop.pos}`).not.toBeNull();
      }else{
        expect(terrain.groundHeight(x,z,.015,y+.03),`${prop.type} ${prop.pos}`).toBeCloseTo(y,2);
      }
    }
  });
});
