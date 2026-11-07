import {expect,it} from 'vitest';
import fs from 'node:fs';
import {MELEE,createMeleeState,stepMelee,traceMelee,validMelee} from '../shared/melee';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerController,NO_INTENT} from '../src/player/PlayerController';
import {PracticeSimulation} from '../src/practice/PracticeSimulation';
import {DEFAULT_PRACTICE} from '../src/practice/config';
import {FIXED_DT} from '../src/config/constants';
import type {MapLayout} from '../src/maps/types';
import {defaultBindings,sanitizeBindings} from '../src/config/keybindings';
import {normalizeInventory,crateItems,compatibleCosmetic,drawCrate,CRATE} from '../shared/cosmetics';
import {parseClientMessage,parseServerMessage,PROTOCOL_VERSION} from '../shared/protocol';

it('authoritative attack timings exactly match all authored clips',()=>{
 const meta=JSON.parse(fs.readFileSync('public/assets/models/shared/melee/daggers.json','utf8'));
 expect(MELEE.equip).toBe(meta.clips.equip.duration*1000);expect(MELEE.unequip).toBe(meta.clips.unequip.duration*1000);
 for(const attack of MELEE.attacks){const clip=meta.clips[attack.clip];expect([attack.duration,attack.contact,attack.contactEnd,attack.chain]).toEqual([clip.duration,clip.contact[0],clip.contact[1],clip.chainFrom].map(n=>n*1000));}
});
it('one contact per animation, held fire cannot spam and rapid presses chain all three clips',()=>{
 const s=createMeleeState();stepMelee(s,0,{melee:true,trigger:false});stepMelee(s,500,{trigger:false});expect(s.phase).toBe('ready');
 stepMelee(s,510,{trigger:true});expect(stepMelee(s,639,undefined)).toBeNull();expect(stepMelee(s,640,undefined)?.stage).toBe(1);
 for(let t=641;t<700;t++)expect(stepMelee(s,t,{trigger:true})).toBeNull();expect(s.sequence).toBe(1);
 stepMelee(s,700,{trigger:false});stepMelee(s,720,{trigger:true});stepMelee(s,810,undefined);expect(s.stage).toBe(2);
 expect(stepMelee(s,950,{trigger:false})?.stage).toBe(2);stepMelee(s,960,{trigger:true});stepMelee(s,1100,undefined);expect(s.stage).toBe(3);
 expect(stepMelee(s,1500,{trigger:false})?.stage).toBe(3);expect(stepMelee(s,1600,undefined)).toBeNull();expect(validMelee(s)).toBe(true);
});
it('combo expires, transitions block firing and interrupted swings never repeat',()=>{
 const s=createMeleeState();stepMelee(s,0,{melee:true,trigger:false},false);expect(s.phase).toBe('hidden');
 stepMelee(s,1,{trigger:false});stepMelee(s,2,{melee:true,trigger:false});stepMelee(s,502,{trigger:false});stepMelee(s,510,{trigger:true});stepMelee(s,640,{trigger:false});stepMelee(s,1130,undefined);
 stepMelee(s,1500,{trigger:true});expect(s.stage).toBe(1);stepMelee(s,1510,{trigger:false,melee:true});expect(s.phase).toBe('unequipping');expect(stepMelee(s,1700,undefined)).toBeNull();stepMelee(s,1910,undefined);expect(s.phase).toBe('hidden');
});
it('suspended attack windows cannot produce a delayed phantom contact',()=>{
 const s=createMeleeState();stepMelee(s,0,{melee:true,trigger:false});stepMelee(s,500,{trigger:false});stepMelee(s,510,{trigger:true});
 expect(stepMelee(s,2000,undefined)).toBeNull();expect(s.phase).toBe('ready');expect(s.contactDone).toBe(true);
});
it('close-range arc, aim, walls and nearest-body obstruction are enforced',()=>{
 const world=new CollisionWorld(),a=new PlayerController(world),b=new PlayerController(world);a.teleport({x:0,y:0,z:0},0);b.teleport({x:0,y:0,z:-1.3},0);
 const targets=()=>[{value:'victim',motion:b.capture()}];expect(traceMelee(world,a.capture(),targets())?.target).toBe('victim');
 b.teleport({x:0,y:0,z:-3},0);expect(traceMelee(world,a.capture(),targets())).toBeNull();
 b.teleport({x:1.3,y:0,z:0},0);expect(traceMelee(world,a.capture(),targets())).toBeNull();
 b.teleport({x:0,y:0,z:-1.3},0);world.add({c:[0,1,-.65],h:[2,1,.1]});expect(traceMelee(world,a.capture(),targets())).toBeNull();
});
it('V migrates without stealing a custom key; melee skins are real owned paired catalog entries',()=>{
 expect(defaultBindings().melee).toEqual(['KeyV']);const old=defaultBindings();delete (old as Partial<typeof old>).melee;old.reload=['KeyV'];const migrated=sanitizeBindings(old);expect(migrated.reload).toEqual(['KeyV']);expect(migrated.melee).not.toContain('KeyV');
 const inv=normalizeInventory();expect(inv.owned).toContain('default-melee');expect(inv.equipped.melee).toBe('default-melee');
 const pool=crateItems().filter(c=>c.weapon==='melee');expect(pool).toHaveLength(6);for(const c of pool){expect(compatibleCosmetic(c.id,'melee')).toBe(true);expect(fs.existsSync('public/'+c.asset.model)).toBe(true);expect(fs.existsSync('public/'+c.asset.secondaryModel)).toBe(true);}
 const selected=drawCrate(crateItems().filter(c=>c.id!=='rich-melee').map(c=>c.id),()=>0);expect(selected?.id).toBe('rich-melee');expect(CRATE.distribution.map(d=>d.percent)).toEqual([55,40,5]);
});
it('protocol rejects client damage claims, incompatible versions and invalid melee confirmation',()=>{
 const frame={seq:1,yaw:0,pitch:0,intent:{...NO_INTENT},combat:{trigger:true,reload:false,melee:true}};
 const message={v:PROTOCOL_VERSION,type:'input',roundId:1,mapVersion:'test',frames:[frame]};expect(parseClientMessage(JSON.stringify(message))).not.toBeNull();
 expect(parseClientMessage(JSON.stringify({...message,frames:[{...frame,combat:{...frame.combat,damage:999}}]}))).toBeNull();
 expect(parseClientMessage(JSON.stringify({...message,v:19}))).toBeNull();
 const event={id:'melee:test',roundId:1,shooterId:'player',life:1,at:100,stage:1,hits:[{id:'target',life:1,amount:35,health:65,head:false,killed:false,direction:{x:0,y:0,z:-1}}]};
 expect(parseServerMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'melee',event}))).not.toBeNull();event.hits[0].amount=36;expect(parseServerMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'melee',event}))).toBeNull();
});
it('Practice uses the same 35/35/35 contacts, elimination points and non-rewarding policy',()=>{
 const world=new CollisionWorld();world.add({c:[0,-.25,0],h:[12,.25,12]});
 const layout={id:'european-town',playArea:[-11,-11,11,11],ground:{baseHeight:0,zones:[]},spawns:[{id:'a',pos:[-5,0,0],heading:0},{id:'b',pos:[5,0,0],heading:0}],underground:[]} as unknown as MapLayout;
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:1},{world,layout,revision:'melee-test'},'Player',{now:0});sim.spawnHuman('rifle');const [a,b]=sim.actors;b.brain=null;
 a.controller.teleport({x:0,y:0,z:0},0);b.controller.teleport({x:0,y:0,z:-1.3},0);let seq=0;
 const tick=(trigger=false,melee=false)=>sim.step({seq:++seq,yaw:0,pitch:0,intent:{...NO_INTENT},combat:{trigger,reload:false,melee}});
 tick(false,true);for(let t=0;t<.51;t+=FIXED_DT)tick();
 for(const seconds of [.4,.4,.6]){tick(true);for(let t=0;t<seconds;t+=FIXED_DT)tick();}
 expect({alive:b.state.alive,health:b.state.health,melee:a.state.combat.melee,events:sim.events.filter(e=>e.type==='melee')}).toMatchObject({alive:false,health:0});expect(a.state.kills).toBe(1);expect(a.state.score).toBe(100);expect(b.state.death).toMatchObject({weapon:'melee',head:false,award:{total:100}});
 expect(sim.events.filter(e=>e.type==='melee').flatMap(e=>e.type==='melee'?e.event.hits.map(h=>h.amount):[])).toEqual([35,35,30]);
 expect(sim.policy.rewards).toBe(false);expect(sim.policy.persistStatistics).toBe(false);expect(a.gun?.ammo).toBe(30);
});
it('a deterministic Practice bot chooses and uses the actual melee state machine nearby',()=>{
 const world=new CollisionWorld();world.add({c:[0,-.25,0],h:[12,.25,12]});
 const layout={id:'european-town',playArea:[-11,-11,11,11],ground:{baseHeight:0,zones:[]},spawns:[{id:'a',pos:[-5,0,0],heading:0},{id:'b',pos:[5,0,0],heading:0}],underground:[]} as unknown as MapLayout;
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:1,difficulty:'absurd'},{world,layout,revision:'melee-bot'},'Player',{now:0,seed:42});sim.spawnHuman('rifle');
 sim.actors[0].controller.teleport({x:0,y:0,z:-1.3},180);sim.actors[1].controller.teleport({x:0,y:0,z:0},0);
 for(let t=0;t<4&&!sim.events.some(e=>e.type==='melee'&&e.event.hits.length);t+=FIXED_DT)sim.step();
 expect(sim.events.some(e=>e.type==='melee'&&e.event.shooterId==='practice-bot-1'&&e.event.hits.some(h=>h.amount===35)),JSON.stringify({a:sim.actors[0].controller.capture(),b:sim.actors[1].controller.capture(),events:sim.events})).toBe(true);
});
