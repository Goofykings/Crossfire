import { describe,expect,it } from 'vitest';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { EnvironmentSimulation,ENVIRONMENT,validEnvironmentFrame,type EnvironmentDefinition,type PropDefinition } from '../shared/environment';
import { WORLDS } from '../server/src/world';
import { parseClientMessage,parseServerMessage,PROTOCOL_VERSION } from '../shared/protocol';

const floor=()=>{const w=new CollisionWorld();w.add({c:[0,-.5,0],h:[30,.5,30]});return w;};
const body=(id='a',x=0):PropDefinition=>({id,asset:'apple',position:[x,.076,0],yaw:0,radius:.075,halfHeight:.075,mass:.16});
const definition=(bodies=[body()]):EnvironmentDefinition=>({version:1,bodies,signs:[],replaceProps:[]});
const run=(s:EnvironmentSimulation,seconds:number,dt=1/60)=>{for(let t=0;t<seconds-1e-8;t+=dt)s.advance(dt);};
describe('bounded interactive prop physics',()=>{
  it('sleeps at rest, rejects rays behind the camera and respects wall/player occlusion distances',()=>{
    const s=new EnvironmentSimulation(definition(),floor());run(s,2);expect(s.takeChanges()).toEqual([]);
    expect(s.shoot({x:0,y:.076,z:1},{x:0,y:0,z:1},10,'rifle')).toBeNull();
    expect(s.shoot({x:0,y:.076,z:1},{x:0,y:0,z:-1},.8,'rifle')).toBeNull();
    expect(s.active).toBe(0);expect(s.shoot({x:0,y:.076,z:1},{x:0,y:0,z:-1},10,'rifle')).toBe('a');
    expect(s.active).toBe(1);
  });
  it.each(['rifle','shotgun','sniper','smg'] as const)('%s impulses stay bounded, bounce and eventually sleep',weapon=>{
    const w=floor();w.add({c:[.3,.5,0],h:[.005,.5,2]});const s=new EnvironmentSimulation(definition(),w);
    s.shoot({x:-1,y:.076,z:0},{x:1,y:0,z:0},3,weapon);let bounced=false;
    for(let i=0;i<600;i++) {s.advance(1/60);const p=s.capture()[0];
      expect(p.position.x).toBeLessThanOrEqual(.221);expect(p.position.y).toBeGreaterThanOrEqual(.075-.001);
      expect(Math.hypot(...Object.values(p.velocity))).toBeLessThanOrEqual(ENVIRONMENT.maxSpeed+1e-6);
      bounced ||= p.velocity.x<0;
    }
    if(weapon==='sniper')expect(bounced).toBe(true);
    expect(s.active).toBe(0);expect(s.capture()[0].asleep).toBe(true);
    expect(s.takeChanges()[0].asleep).toBe(true);expect(s.takeChanges()).toEqual([]);
  });
  it('wakes a neighbouring apple by contact without adding unbounded energy',()=>{
    const s=new EnvironmentSimulation(definition([body('a'),body('b',.18)]),floor());
    s.shoot({x:-1,y:.076,z:0},{x:1,y:0,z:0},3,'sniper');run(s,.2);
    expect(s.capture()[1].position.x).toBeGreaterThan(.18);expect(s.capture()[1].asleep).toBe(false);
    run(s,10);expect(s.active).toBe(0);
  });
  it('is consistent across render rates and resumes stored moving objects',()=>{
    const a=new EnvironmentSimulation(definition(),floor()),b=new EnvironmentSimulation(definition(),floor());
    a.shoot({x:0,y:.076,z:1},{x:0,y:.3,z:-1},3,'rifle');b.restore(a.capture());
    run(a,2,1/30);run(b,2,1/120);expect(a.capture()).toEqual(b.capture());
  });
  it('bounds a real hinged sign and returns it to its original pivot and rest angle',()=>{
    const def={...definition([]),signs:[{id:'sign',asset:'sign_0',position:[0,2,0],yaw:0}]};
    const s=new EnvironmentSimulation(def,floor());expect(s.shoot({x:-2,y:1.7,z:0},{x:1,y:0,z:0},3,'sniper')).toBe('sign');
    let max=0;for(let i=0;i<900;i++){s.advance(1/60);max=Math.max(max,Math.abs(s.capture()[0].angle));}
    expect(max).toBeGreaterThan(.1);expect(max).toBeLessThanOrEqual(.30);expect(s.active).toBe(0);
    expect(s.capture()[0]).toMatchObject({position:{x:0,y:2,z:0},angle:0,angularVelocity:0});
  });
});
describe('authored map and strict environment protocol',()=>{
  it.each(Object.keys(WORLDS))('%s keeps props clear of solids/spawns and within a tiny budget',id=>{
    const m=WORLDS[id as keyof typeof WORLDS],def=m.environment;
    expect(def.bodies.length).toBeLessThanOrEqual(12);expect(def.signs.length).toBeLessThanOrEqual(2);
    for(const b of def.bodies){const [x,y,z]=b.position;
      expect(m.world.overlapsCylinder(x,z,b.radius,y-b.halfHeight+.003,y+b.halfHeight-.003),b.id).toBe(false);
      for(const spawn of m.layout.spawns)expect(Math.hypot(x-spawn.pos[0],z-spawn.pos[2])).toBeGreaterThan(2);
    }
    const s=new EnvironmentSimulation(def,m.world);expect(s.active).toBe(0);
  });
  it('uses exposed 3D apples and refined bin collision instead of an invisible solid stall',()=>{
    const m=WORLDS['european-town'];expect(m.environment.bodies.filter(b=>b.asset==='apple'||b.asset==='pear')).toHaveLength(9);
    const b=m.environment.bodies[0],o={x:b.position[0],y:1.64,z:b.position[2]+2},delta={x:0,y:b.position[1]-o.y,z:-2};
    const length=Math.hypot(...Object.values(delta)),d={x:0,y:delta.y/length,z:delta.z/length};
    const wall=m.world.raycast(o.x,o.y,o.z,d.x,d.y,d.z,length);
    expect(new EnvironmentSimulation(m.environment,m.world).shoot(o,d,wall?.distance??length,'rifle')).toBe(b.id);
  });
  it('validates bounded frames, rejects duplicates/NaN and rejects client prop claims',()=>{
    const frame={roundId:0,mapVersion:'test',seq:0,at:1000,full:true,states:new EnvironmentSimulation(definition(),floor()).capture()};
    const message={v:PROTOCOL_VERSION,type:'environment',frame};
    expect(parseServerMessage(JSON.stringify(message))).toEqual(message);expect(parseClientMessage(JSON.stringify(message))).toBeNull();
    expect(validEnvironmentFrame({...frame,states:[frame.states[0],frame.states[0]]})).toBe(false);
    expect(validEnvironmentFrame({...frame,states:[{...frame.states[0],angle:2}]})).toBe(false);
    expect(validEnvironmentFrame({...frame,states:[{...frame.states[0],position:{x:NaN,y:0,z:0}}]})).toBe(false);
    expect(validEnvironmentFrame({...frame,injected:true})).toBe(false);
  });
});
