import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WORLDS } from '../server/src/world';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { NO_INTENT, PlayerController, type MoveIntent } from '../src/player/PlayerController';
import { PracticeSimulation } from '../src/practice/PracticeSimulation';
import { DEFAULT_PRACTICE } from '../src/practice/config';

const data = WORLDS['industrial-complex'];
const weapons = ['rifle', 'smg', 'shotgun', 'sniper', 'semi-sniper'] as const;
// Clear edges, away from the stairs and the staged pallets in the yard.
const approaches = [
  { start: { x: 7, y: 0, z: -5 }, heading: 90, edge: 10, axis: 'x', sign: 1 },
  { start: { x: 16, y: 0, z: -5 }, heading: 270, edge: 13, axis: 'x', sign: -1 },
  { start: { x: 11.5, y: 0, z: 6 }, heading: 0, edge: 3, axis: 'z', sign: -1 },
] as const;

function approach(p: PlayerController, route: typeof approaches[number], aim = false, gap = 1) {
  let jumped = false;
  return (): MoveIntent => {
    const distance = (route.edge - p.position[route.axis]) * route.sign;
    const jump = !jumped && distance < gap;
    if (jump) jumped = true;
    return { ...NO_INTENT, z: distance > -.8 ? 1 : 0, aim, jumpPressed: jump };
  };
}

function checkTick(p: PlayerController, old: { x: number; y: number; z: number }) {
  // No push-out teleport, no accumulated penetration or upward airborne snap.
  expect(Math.hypot(p.position.x - old.x, p.position.z - old.z)).toBeLessThan(.066);
  expect(Math.abs(p.position.y - old.y)).toBeLessThan(.065);
  expect(data.world.overlapsCylinder(p.position.x, p.position.z, MOVEMENT.radius - .00001,
    p.position.y + .0001, p.position.y + p.height)).toBe(false);
}

describe('Industrial loading dock regression', () => {
  it('has a collision deck safely below the discrete jump apex', () => {
    const flat = new CollisionWorld(); flat.add({ c: [0,-1,0], h: [20,1,20] });
    const p = new PlayerController(flat); p.teleport({ x:0,y:0,z:0 });
    let peak = 0;
    for (let i=0;i<120;i++) { p.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:i===0}); peak=Math.max(peak,p.position.y); }
    expect(peak).toBeCloseTo(1.0616666667);
    const dock = data.layout.terraces.find(t => t.id === 'loading_dock')!;
    expect(dock.height).toBeLessThan(peak - .05);
    const tops = [...data.world.all()].filter(c => c.tag === 'terrace:loading_dock').map(c => c.maxY);
    expect(tops.length).toBeGreaterThan(0);
    for (const top of tops) expect(top).toBeCloseTo(dock.height, 6);
  });

  it('exports the visible terrain deck at the same height as authoritative collision', () => {
    const glb=readFileSync('public/assets/models/industrial-complex/terrain.glb');
    const jsonLength=glb.readUInt32LE(12),gltf=JSON.parse(glb.subarray(20,20+jsonLength).toString());
    const binary=28+jsonLength,heights:number[]=[];
    for(const primitive of gltf.meshes[0].primitives){
      const accessor=gltf.accessors[primitive.attributes.POSITION],view=gltf.bufferViews[accessor.bufferView];
      expect(accessor.componentType).toBe(5126);
      for(let i=0;i<accessor.count;i++){
        const at=binary+(view.byteOffset??0)+(accessor.byteOffset??0)+i*(view.byteStride??12);
        const x=glb.readFloatLE(at),y=glb.readFloatLE(at+4),z=glb.readFloatLE(at+8);
        if(x>10.5&&x<12.5&&z>-7&&z<-2)heights.push(y);
      }
    }
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.max(...heights)).toBeCloseTo(data.layout.terraces[0].height,5);
  });

  it.each(weapons)('%s lands from three directions, hip-fire and ADS, without correction jumps', weapon => {
    for (const route of approaches) for (const aim of [false,true]) {
      const p = new PlayerController(data.world); p.weaponClearance=weapon; p.teleport(route.start,route.heading);
      const intent=approach(p,route,aim); let stood=0;
      for(let tick=0;tick<240;tick++) {
        const old={...p.position};p.fixedUpdate(FIXED_DT,intent());checkTick(p,old);
        if(p.grounded)stood=Math.max(stood,p.position.y);
      }
      expect(stood, JSON.stringify({weapon,route,aim,end:p.position})).toBeCloseTo(1,5);
      expect(p.grounded).toBe(true);expect(p.position.y).toBeCloseTo(1,5);
    }
  });

  it.each([.4,.7,1,1.3,1.6])('lands with a jump triggered %s m before the edge', gap => {
    const route=approaches[0],p=new PlayerController(data.world);p.weaponClearance='rifle';p.teleport(route.start,route.heading);
    const intent=approach(p,route,false,gap);
    for(let i=0;i<240;i++)p.fixedUpdate(FIXED_DT,intent());
    expect(p.grounded).toBe(true);expect(p.position.y).toBeCloseTo(1,5);
  });

  it.each([60,30,20,'variable'] as const)('has identical landing/replay at %s render FPS', fps => {
    const make=()=>{const p=new PlayerController(data.world);p.weaponClearance='sniper';p.teleport(approaches[0].start,90);return p;};
    const authority=make(),intent=approach(authority,approaches[0]);
    const inputs:MoveIntent[]=[],states=[authority.capture()];
    for(let i=0;i<240;i++){inputs.push(intent());authority.fixedUpdate(FIXED_DT,inputs[i]);states.push(authority.capture());}
    const predicted=make();let accumulator=0,tick=0,frame=0;
    while(tick<inputs.length){
      accumulator+=fps==='variable'?[1/60,1/20,1/30,.083,1/90][frame++%5]:1/fps;
      while(accumulator+1e-10>=FIXED_DT&&tick<inputs.length){
        const old={...predicted.position};predicted.fixedUpdate(FIXED_DT,inputs[tick++]);accumulator-=FIXED_DT;checkTick(predicted,old);
        // 100–183 ms delayed snapshots with jitter, replay all unacknowledged input.
        if(tick%6===0){const ack=Math.max(0,tick-[12,18,22][Math.floor(tick/6)%3]);predicted.restore(states[ack]);
          for(let i=ack;i<tick;i++)predicted.fixedUpdate(FIXED_DT,inputs[i]);}
        expect(predicted.capture()).toEqual(states[tick]);
      }
    }
    expect(predicted.position.y).toBe(1);expect(predicted.grounded).toBe(true);
  });

  it('lands through the actual local Practice authority after a fresh spawn', () => {
    const sim=new PracticeSimulation({...DEFAULT_PRACTICE,mapId:'industrial-complex',bots:0},
      {world:data.world,layout:data.layout,revision:data.revision},'Dock test',{now:0});
    sim.spawnHuman('rifle');const p=sim.actors[0].controller;p.teleport(approaches[0].start,90);
    const intent=approach(p,approaches[0]);
    for(let seq=1;seq<=240;seq++)sim.step({seq,yaw:p.yaw,pitch:0,intent:intent(),combat:{trigger:false,reload:false}});
    expect(p.grounded).toBe(true);expect(p.position.y).toBe(1);expect(sim.actors[0].state.alive).toBe(true);
    expect(sim.actors[0].state.health).toBe(100);
  });
});

it.each([1.1,1.5,3])('rejects a %s m ledge at its side without entering it or snapping backward', height => {
  const world=new CollisionWorld();world.add({c:[0,-1,0],h:[20,1,20]});
  world.add({c:[0,(height-1)/2,-4],h:[3,(height+1)/2,2]});
  const p=new PlayerController(world);p.weaponClearance='rifle';p.teleport({x:0,y:0,z:0});
  for(let tick=0;tick<240;tick++){
    const old={...p.position};p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1,jumpPressed:tick===0});
    expect(p.position.z).toBeLessThanOrEqual(old.z+1e-8);
    expect(p.position.z).toBeGreaterThanOrEqual(-2+MOVEMENT.radius-.00001);
    expect(world.overlapsCylinder(p.position.x,p.position.z,MOVEMENT.radius-.00001,p.position.y+.0001,p.position.y+p.height)).toBe(false);
  }
  expect(p.position.y).toBe(0);expect(p.grounded).toBe(true);
});
