import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORLDS } from '../server/src/world';
import { MAP_IDS } from '../shared/maps';
import { PlayerController, NO_INTENT } from '../src/player/PlayerController';
import { FIXED_DT } from '../src/config/constants';

describe.each(MAP_IDS)('%s slide stair clearance',id=>{
  const layout=JSON.parse(readFileSync(`src/maps/${id}/layout.json`,'utf8'));
  const path=layout.circulationRoutes[0].waypoints as number[][];
  it.each(['rifle','smg','shotgun','sniper'] as const)('%s preserves momentum on both interior flights and the exterior stairs',weapon=>{
    const base=path.length-6;
    for(const [a,b] of [[base,base+1],[base+2,base+3],[path.length-2,path.length-1]])for(const reverse of [false,true]){
      const from=path[reverse?b:a],to=path[reverse?a:b];
      const p=new PlayerController(WORLDS[id].world);p.weaponClearance=weapon;
      const dx=to[0]-from[0],dz=to[2]-from[2],length=Math.hypot(dx,dz);
      p.teleport({x:from[0],y:from[1],z:from[2]},Math.atan2(dx,-dz)*180/Math.PI);
      p.velocity.x=dx/length*4.7;p.velocity.z=dz/length*4.7;
      let reached=false,slidingHeight=false;
      for(let n=0;n<150;n++){
        p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1,slide:true});
        if(p.sliding&&Math.abs(p.position.y-from[1])>.3){slidingHeight=true;expect(p.horizontalSpeed,JSON.stringify({id,weapon,a,b,reverse,pos:p.position})).toBeGreaterThan(3.5);}
        const progress=(p.position.x-from[0])*dx/length+(p.position.z-from[2])*dz/length;
        if(progress>length*.5 && Math.abs(p.position.y-to[1])<.03){reached=true;break;}
      }
      expect(slidingHeight,`${weapon} ${a}->${b} reverse=${reverse}`).toBe(true);
      expect(reached,`${weapon} stalled at ${JSON.stringify(p.position)}`).toBe(true);
      expect(Math.abs(p.position.y-to[1])).toBeLessThan(.43);
    }
  });
});
