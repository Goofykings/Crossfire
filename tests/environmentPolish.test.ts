import {describe,it,expect} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EnvironmentSimulation,validEnvironmentFrame,type EnvironmentDefinition} from '../shared/environment';
import {WORLDS} from '../server/src/world';
import {execFileSync} from 'node:child_process';
const floor=()=>{const w=new CollisionWorld();w.add({c:[0,-.5,0],h:[30,.5,30]});return w;};
const definition=():EnvironmentDefinition=>({version:1,bodies:[{id:'a',asset:'apple',position:[0,.076,0],yaw:0,radius:.075,halfHeight:.075,mass:.16}],signs:[],replaceProps:[]});
const run=(s:EnvironmentSimulation,seconds:number)=>{for(let i=0;i<seconds*120;i++)s.advance(1/120);};
describe('environment physics polish',()=>{
  it('keeps the authored fixed brace out of the suspended sign board',()=>{
    expect(execFileSync('python',['-I','-B','tools/check-physics-polish.py'],{encoding:'utf8'})).toContain('clearance pass');
  });
  it('starts at five times the former impulse and gives roughly five times free-floor displacement',()=>{
    const a=new EnvironmentSimulation(definition(),floor()),old=new EnvironmentSimulation(definition(),floor());
    a.shoot({x:-1,y:.076,z:0},{x:1,y:0,z:0},3,'rifle');
    expect(a.capture()[0].velocity.x).toBeCloseTo(.22/.16*5);
    const slow=a.capture();for(const k of ['x','y','z'] as const)slow[0].velocity[k]/=5;
    old.restore(slow);run(a,4);run(old,4);
    expect(a.capture()[0].position.x/old.capture()[0].position.x).toBeGreaterThan(4);
    expect(a.capture()[0].position.x/old.capture()[0].position.x).toBeLessThan(7);
  });
  it('keeps a selected hanging light attached, visibly swinging, bounded and asleep after damping',()=>{
    const def={...definition(),bodies:[],lights:[{id:'light',asset:'hanging_light',position:[0,3,0],yaw:0}]};
    const s=new EnvironmentSimulation(def,floor());
    expect(s.shoot({x:-2,y:2.64,z:0},{x:1,y:0,z:0},3,'rifle')).toBe('light');
    let peak=0;for(let i=0;i<120;i++){s.advance(1/120);peak=Math.max(peak,Math.abs(s.capture()[0].angle));}
    expect(peak).toBeGreaterThan(.2);expect(peak).toBeLessThanOrEqual(.30);
    expect(s.capture()[0].position).toEqual({x:0,y:3,z:0});run(s,10);
    expect(s.active).toBe(0);expect(s.capture()[0].angle).toBe(0);
  });
  it('keeps front-facing light hits visible despite a tiny sideways spread component',()=>{
    const def={...definition(),bodies:[],lights:[{id:'light',asset:'hanging_light',position:[0,3,0],yaw:0}]};
    const s=new EnvironmentSimulation(def,floor());
    expect(s.shoot({x:0,y:2.64,z:2},{x:.00001,y:0,z:-Math.sqrt(1-.00001**2)},3,'rifle')).toBe('light');
    let peak=0;for(let i=0;i<120;i++){s.advance(1/120);peak=Math.max(peak,Math.abs(s.capture()[0].angle));}
    expect(peak).toBeGreaterThan(.2);
  });
  it('starts fruit on the bin floor or on three neighbours, with gaps and no sphere overlaps',()=>{
    const def=WORLDS['european-town'].environment,fruit=def.bodies.filter(b=>b.asset==='apple'||b.asset==='pear');
    expect(fruit).toHaveLength(9);expect(fruit.some(b=>b.asset==='pear')).toBe(true);
    expect(def.bodies.length+def.signs.length+def.lights!.length).toBe(14);
    expect(def.basins).toHaveLength(3);expect(new Set(fruit.map(b=>JSON.stringify(b.tilt))).size).toBeGreaterThan(3);
    for(const a of fruit){
      const base=def.basins!.find(b=>Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2])<.25)!;
      const neighbours=fruit.filter(b=>b!==a&&b.position[1]<a.position[1]&&Math.abs(Math.hypot(...a.position.map((v,i)=>v-b.position[i]))-a.radius-b.radius)<.00001);
      expect(Math.abs(a.position[1]-a.radius-base.position[1])<.00001||neighbours.length===3,a.id).toBe(true);
      for(const b of fruit)if(b!==a)expect(Math.hypot(...a.position.map((v,i)=>v-b.position[i]))).toBeGreaterThanOrEqual(a.radius+b.radius-.00001);
    }
  });
  it('settles the disturbed pile, transfers movement, and emits valid final sleep states',()=>{
    const m=WORLDS['european-town'],def=m.environment,s=new EnvironmentSimulation(def,m.world),apple=def.bodies[0];
    s.shoot({x:apple.position[0]-1,y:apple.position[1],z:apple.position[2]},{x:1,y:0,z:0},2,'rifle');let adjacent=false;
    for(let i=0;i<2400;i++){
      s.advance(1/120);
      expect(validEnvironmentFrame({roundId:1,mapVersion:'x',seq:1,at:1,full:false,states:s.capture()})).toBe(true);
      adjacent ||= s.capture().some(p=>p.id!==apple.id&&p.id.startsWith('apple')&&!p.asleep);
    }
    expect(adjacent).toBe(true);expect(s.active).toBe(0);
    expect(s.takeChanges().some(p=>p.asleep)).toBe(true);expect(s.takeChanges()).toEqual([]);
  });
  it('uses continuous tapered side contacts to rebound upward and retain a slow fruit inside the bin',()=>{
    const def=definition();def.basins=[{position:[0,0,0],yaw:0,halfWidth:.30,halfDepth:.24,height:.22,flare:.06}];
    const w=floor(),s=new EnvironmentSimulation(def,w);
    s.shoot({x:-1,y:.076,z:0},{x:1,y:0,z:0},2,'shotgun');let rebound=false,up=false;
    for(let i=0;i<500;i++){s.advance(1/120);const p=s.capture()[0];rebound ||=p.velocity.x<0;up ||=p.velocity.y>.4;
      expect(p.position.x).toBeLessThan(.30+.06-.07);}
    expect(rebound).toBe(true);expect(up).toBe(true);run(s,10);expect(s.active).toBe(0);
  });
  it('blocks a fast outside fruit from passing through the tapered wooden wall',()=>{
    const def=definition();def.bodies[0].position=[.7,.076,0];
    def.basins=[{position:[0,0,0],yaw:0,halfWidth:.30,halfDepth:.24,height:.22,flare:.06}];
    const s=new EnvironmentSimulation(def,floor());s.shoot({x:2,y:.076,z:0},{x:-1,y:0,z:0},3,'rifle');
    let rebound=false;for(let i=0;i<600;i++){s.advance(1/120);const p=s.capture()[0];expect(p.position.x).toBeGreaterThan(.39);rebound ||=p.velocity.x>0;}
    expect(rebound).toBe(true);expect(s.active).toBe(0);
  });
  it('retains the original fourteen-state wire budget even with lights',()=>{
    const def=definition();def.bodies=Array.from({length:12},(_,i)=>({...def.bodies[0],id:String(i)}));
    def.signs=[{id:'s1',asset:'sign_0',position:[0,3,0],yaw:0},{id:'s2',asset:'sign_1',position:[1,3,0],yaw:0}];
    def.lights=[{id:'light',asset:'hanging_light',position:[2,3,0],yaw:0}];
    expect(()=>new EnvironmentSimulation(def,floor())).toThrow('budget');
  });
  it.each(Object.keys(WORLDS))('%s light cage clears walls and ceiling throughout its swing',id=>{
    const m=WORLDS[id as keyof typeof WORLDS],light=m.environment.lights![0];
    for(const angle of [-.30,0,.30]){
      const x=light.position[0]+Math.sin(angle)*.36,y=light.position[1]-Math.cos(angle)*.36;
      expect(m.world.overlapsCylinder(x,light.position[2],.16,y-.18,y+.18)).toBe(false);
    }
  });
});
