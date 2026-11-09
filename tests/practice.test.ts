import {botThrow} from '../src/practice/botGrenades';
import {DIFFICULTIES,BOT_GRENADES,loadDifficulty,saveDifficulty,validPractice} from '../src/practice/config';
import {expect,it,vi,afterEach} from 'vitest';
import {PracticeSimulation} from '../src/practice/PracticeSimulation';
import {PracticeNavigation} from '../src/practice/Navigation';
import {DEFAULT_PRACTICE,DIFFICULTY} from '../src/practice/config';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {NO_INTENT} from '../src/player/PlayerController';
import {FIXED_DT} from '../src/config/constants';
import type {MapLayout} from '../src/maps/types';
import {WORLDS} from '../server/src/world';
import {MAP_IDS} from '../shared/maps';
import type {InputFrame} from '../shared/protocol';
import {unsafeMovement} from '../shared/movementSafety';
import {GRENADE} from '../shared/grenades';
import {PracticeClient} from '../src/practice/PracticeClient';
import {PlayerController} from '../src/player/PlayerController';
import {leanOffset} from '../shared/lean';
import {playerHeight} from '../shared/combat';
const arena=()=>{
 const world=new CollisionWorld();world.add({c:[0,-.25,0],h:[16,.25,16]});
 for(const [x,z,hx,hz]of [[0,15,16,.2],[0,-15,16,.2],[15,0,.2,16],[-15,0,.2,16]])world.add({c:[x,2,z],h:[hx,2,hz]});
 const layout={id:'european-town',playArea:[-14,-14,14,14],ground:{baseHeight:0,zones:[]},spawns:Array.from({length:12},(_,i)=>({id:'test-'+i,pos:[Math.sin(i*Math.PI/6)*10,0,Math.cos(i*Math.PI/6)*10],heading:i*30})),underground:[]} as unknown as MapLayout;
 return{world,layout,revision:'practice-arena'};
};
let sequence=0;function input(yaw=0,pitch=0,trigger=false):InputFrame{return{seq:++sequence,yaw,pitch,intent:{...NO_INTENT,aim:true},combat:{trigger,reload:false}};}
const advance=(sim:PracticeSimulation,seconds:number,frame:()=>InputFrame|null=()=>null)=>{for(let i=0;i<seconds/FIXED_DT;i++)sim.step(frame());};
afterEach(()=>vi.unstubAllGlobals());
it('local authority has no network/storage/reward dependency and supports 0-5 correctly balanced bots',()=>{
 const fetch=vi.fn(()=>{throw Error('No network in Practice');});vi.stubGlobal('fetch',fetch);vi.stubGlobal('localStorage',{getItem:()=>{throw Error('no storage');},setItem:()=>{throw Error('no storage');}});
 const data=arena(),nav=new PracticeNavigation(data.world,data.layout);
 for(let bots=0;bots<=5;bots++)for(const mode of ['ffa','teams'] as const){const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots,mode},data,'Local',{now:0,navigation:nav});expect(sim.actors).toHaveLength(bots+1);expect(sim.policy).toEqual({kind:'practice',rewards:false,persistStatistics:false,uploadResults:false});sim.spawnHuman('rifle');expect(sim.actors.every(a=>a.state.alive)).toBe(true);if(mode==='teams'){const blue=sim.actors.filter(a=>a.state.team==='blue').length,red=bots+1-blue;expect(blue-red).toBeGreaterThanOrEqual(-1);expect(blue-red).toBeLessThanOrEqual(1);expect(sim.actors[0].state.team).toBe('blue');}advance(sim,.1);}
 expect(fetch).not.toHaveBeenCalled();
});
it('real rifle rays apply weapon damage, lethal scores, nonlethal no-score, respawn and regeneration',()=>{
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:1},arena(),'Local',{now:0});sim.spawnHuman('rifle');const [human,bot]=sim.actors;bot.brain=null;human.controller.teleport({x:0,y:0,z:5},0);bot.controller.teleport({x:0,y:0,z:-5},180);
 advance(sim,.1,()=>input());const p=human.controller.leanEye(),point={x:0,y:1.1,z:-5},pitch=Math.atan2(point.y-p.y,10);
 advance(sim,.12,()=>input(0,pitch,true));expect(bot.state.health).toBeLessThan(100);expect(human.state.score).toBe(0);advance(sim,.1,()=>input(0,pitch,false));
 advance(sim,1,()=>input(0,pitch,true));expect(bot.state.alive).toBe(false);expect(human.state.kills).toBe(1);expect(human.state.score).toBe(100);expect(sim.events.some(e=>e.type==='shot'&&e.shot.hits.some(h=>h.id===bot.state.id&&h.killed))).toBe(true);
 const deaths=bot.state.deaths;advance(sim,1,()=>input(0,pitch,true));expect(bot.state.deaths).toBe(deaths);advance(sim,3);expect(sim.spawn(bot,'smg')).toBe(true);
 bot.state.health=40;bot.state.regenAt=sim.now+5000;advance(sim,5);expect(bot.state.health).toBe(40);advance(sim,3);expect(bot.state.health).toBeGreaterThanOrEqual(69);expect(bot.state.health).toBeLessThanOrEqual(70);
});
it('solid walls and teammates block real rays and do not award points',()=>{
 for(const mode of ['ffa','teams'] as const){const data=arena();if(mode==='ffa')data.world.add({c:[0,1.5,0],h:[3,1.5,.15]});const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:2,mode},data,'Local',{now:0});sim.spawnHuman('sniper');const [human,red,blue]=sim.actors;for(const b of [red,blue])b.brain=null;human.controller.teleport({x:0,y:0,z:6},0);red.controller.teleport({x:0,y:0,z:-6},180);blue.controller.teleport({x:mode==='teams'?0:7,y:0,z:2},180);advance(sim,2,()=>input(0,0,true));expect(red.state.health).toBe(100);expect(blue.state.health).toBe(100);expect(human.state.score).toBe(0);}
});
it('bot difficulty changes reactions, aim error and sliding without changing gun rules',()=>{
 expect(DIFFICULTY.absurd.error).toBe(0);expect(DIFFICULTY.absurd.reaction).toBeLessThan(DIFFICULTY.advanced.reaction);expect(DIFFICULTY.advanced.reaction).toBeLessThan(DIFFICULTY.beginner.reaction);expect(DIFFICULTY.beginner.speed).toBeLessThan(DIFFICULTY.advanced.speed);
 const data=arena(),nav=new PracticeNavigation(data.world,data.layout);
 for(const difficulty of DIFFICULTIES){const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:3,difficulty},data,'Local',{now:0,seed:123,navigation:nav});sim.spawnHuman('rifle');advance(sim,45);expect(sim.actors.slice(1).reduce((n,a)=>n+a.state.kills,0),difficulty+' actual bot eliminations').toBeGreaterThan(0);expect(sim.actors.some(a=>(a.brain?.distanceTravelled??0)>30),difficulty+' moving bots').toBe(true);expect(sim.actors.some(a=>a.state.life>1),difficulty+' respawn').toBe(true);}
},30000);

it.each(MAP_IDS)('real armed bots traverse %s without entering solids or unsafe space',id=>{
 const data=WORLDS[id],sim=new PracticeSimulation({...DEFAULT_PRACTICE,mapId:id,mode:'teams',bots:5},{world:data.world,layout:data.layout,revision:data.revision},'Local',{now:0,seed:137});sim.spawnHuman('rifle');sim.actors[0].state.alive=false;
 // Isolate navigation from combat; all five real brains still select paths, turn,
 // jump, slide and change weapons through the normal controller and clearance.
 for(const a of sim.actors.slice(1))a.state.team='blue';
 let highest=0,lowest=0,slides=0,jumps=0;
 for(let i=0;i<120*120;i++){
  sim.step();for(const a of sim.actors.slice(1)){const p=a.controller;highest=Math.max(highest,p.position.y);lowest=Math.min(lowest,p.position.y);if(p.sliding)slides++;if(a.input?.intent.jumpPressed)jumps++;
   if(i%12===0&&a.state.alive){expect(unsafeMovement(p.position,data.layout)).toBeNull();expect(data.world.overlapsCylinder(p.position.x,p.position.z,.33,p.position.y+.44,p.position.y+p.height-.02),a.state.name+' in solid').toBe(false);}
  }
  sim.events.length=0;
 }
 const stats=sim.actors.slice(1).map(a=>({name:a.state.name,distance:a.brain!.distanceTravelled,recoveries:a.brain!.recoveries,switches:a.brain!.switches,deaths:a.state.deaths}));
 console.log(id,'real navigation',JSON.stringify({highest,lowest,slides,jumps,stats}));
 expect(highest,'bots actually climbed stairs to an upper floor').toBeGreaterThan(2.8);expect(slides).toBeGreaterThan(0);
 expect(stats.every(b=>b.distance>80)).toBe(true);expect(stats.reduce((sum,b)=>sum+b.switches,0)).toBeGreaterThan(0);expect(stats.map(b=>b.deaths),'no irrecoverably stuck respawns in this navigation run').toEqual([0,0,0,0,0]);
},60000);

it('one real grenade explosion awards two eliminations, combo, no headshots and no duplicate awards',()=>{
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:2},arena(),'Local',{now:0});sim.spawnHuman('rifle');const [human,...bots]=sim.actors;for(const [i,b]of bots.entries()){b.brain=null;b.controller.teleport({x:(i-.5)*.7,y:0,z:0},0);b.state.health=50;}
 human.controller.teleport({x:0,y:0,z:8},0);const at=sim.now;
 sim.grenades.push({id:'test-actual-blast',ownerId:human.state.id,ownerLife:human.state.life,roundId:sim.roundId,at:at-GRENADE.fuseMs,explodeAt:at+FIXED_DT*1000,updatedAt:at,position:{x:0,y:.08,z:0},velocity:{x:0,y:0,z:0}});
 sim.step();expect(bots.every(b=>!b.state.alive)).toBe(true);expect(human.state.kills).toBe(2);expect(human.state.score).toBe(220);expect(bots.map(b=>b.state.death?.award?.total)).toEqual([100,120]);expect(bots.every(b=>b.state.death?.weapon==='grenade'&&b.state.death.head===false)).toBe(true);
 advance(sim,.5);expect(human.state.score).toBe(220);expect(human.state.grenades).toBe(GRENADE.perLife+2);expect(sim.snapshot().players[0].score).toBe(220);sim.finish();expect(sim.result?.players?.find(p=>p.id===human.state.id)?.score).toBe(220);
});
it('local final results freeze and remain explicitly non-rewarding',()=>{
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:0},arena(),'Local',{now:0});sim.spawnHuman('shotgun');sim.actors[0].state.score=100;sim.finish();const result=JSON.stringify(sim.result);advance(sim,5);expect(JSON.stringify(sim.result)).toBe(result);expect(sim.result?.players).toHaveLength(1);expect(sim.policy.uploadResults).toBe(false);
});
it('the natural ten-minute local timer starts on spawn and freezes the final result',()=>{
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:0},arena(),'Local',{now:0});advance(sim,10);expect(sim.now).toBe(0);expect(sim.endsAt).toBeNull();sim.spawnHuman('sniper');expect(sim.endsAt).toBe(600000);advance(sim,599);expect(sim.result).toBeNull();advance(sim,1.1);expect(sim.result?.endedAt).toBe(600000);const at=sim.now;advance(sim,3);expect(sim.now).toBe(at);expect(sim.policy.rewards).toBe(false);
});
it('Teams credits only opponent eliminations and preserves its local team totals in results',()=>{
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,mode:'teams',bots:2},arena(),'Local',{now:0});sim.spawnHuman('sniper');const [human,red,blue]=sim.actors;red.brain=blue.brain=null;
 human.controller.teleport({x:0,y:0,z:5},0);red.controller.teleport({x:0,y:0,z:-5},180);blue.controller.teleport({x:8,y:0,z:0},180);advance(sim,.6,()=>input(0,-.054));advance(sim,.1,()=>input(0,-.054,true));expect(red.state.health).toBe(25);expect(human.state.score).toBe(0);advance(sim,1.2,()=>input(0,-.054));advance(sim,.1,()=>input(0,-.054,true));expect(red.state.alive).toBe(false);expect(human.state.kills).toBe(1);expect(human.state.score).toBe(100);expect(blue.state.health).toBe(100);expect(sim.teamScores).toEqual({blue:1,red:0});sim.finish();expect(sim.result?.winningTeam).toBe('blue');expect(sim.result?.teamScores).toEqual({blue:1,red:0});
});

it('local transport reconciles movement, pauses its clock and permanently closes on Leave',async()=>{
 const data=arena(),client=new PracticeClient({...DEFAULT_PRACTICE,bots:0},data,'Local');await client.connect();expect(client.latest!.players[0].alive).toBe(false);await client.spawn('rifle');
 const controller=new PlayerController(data.world);controller.restore(client.latest!.players[0].motion);controller.weaponClearance='rifle';
 for(let i=0;i<60;i++){const intent={...NO_INTENT,x:1};controller.fixedUpdate(FIXED_DT,intent);client.fixedInput(controller,intent);client.advance(FIXED_DT);if(client.latest)client.reconcile(controller,client.latest);}
 client.advance(.05);client.reconcile(controller,client.latest!);expect(controller.position).toEqual(client.latest!.players[0].motion.position);expect(client.inspect().pending).toBe(0);
 const now=client.simulation.now;client.advance(2,true);expect(client.simulation.now).toBe(now);client.advance(.1);expect(client.simulation.now).toBeGreaterThan(now);
 await client.leaveRoom();expect(client.state).toBe('closed');const closed=client.simulation.now;client.reconnect();client.advance(1);expect(client.simulation.now).toBe(closed);expect(client.latest).toBeNull();expect(client.inspect().opens).toBe(0);
});

it('Absurd targets the actual leaned head with zero AI error, but preserves the weapon spread',()=>{
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:1,difficulty:'absurd'},arena(),'Local',{now:0});sim.spawnHuman('rifle');const [human,bot]=sim.actors;human.controller.teleport({x:0,y:0,z:-5},20);human.controller.lean=.8;bot.controller.teleport({x:0,y:0,z:5},0);bot.brain!.reset(0);
 const ctx={actors:sim.actors,nav:sim.nav,now:0,mode:'ffa' as const,random:sim.random,switchWeapon:()=>{}};let fired=false;
 for(let i=0;i<80;i++){ctx.now=i*FIXED_DT*1000;const f=bot.brain!.input(ctx,FIXED_DT);if(!f.combat.trigger)continue;fired=true;
  const o=bot.controller.leanEye(),offset=leanOffset(human.controller.yaw,.8),p=human.controller.position,dx=p.x+offset.x-o.x,dz=p.z+offset.z-o.z;
  expect(f.combat.aimYaw).toBeCloseTo(Math.atan2(-dx,-dz),10);expect(f.combat.aimPitch).toBeCloseTo(Math.atan2(p.y+playerHeight(human.controller.capture())-.2-o.y,Math.hypot(dx,dz)),10);break;
 }
 expect(fired).toBe(true);expect(bot.gun!.stats.spreadHip).toBeGreaterThan(0);
});

it('Advanced retreats into real cover when hurt, regenerates, and re-engages',()=>{
 const data=arena();data.world.add({c:[3,1.5,4],h:[.22,1.5,2]});
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:1},data,'Local',{now:0});sim.spawnHuman('rifle');const [human,bot]=sim.actors;
 human.controller.teleport({x:0,y:0,z:-5},180);bot.controller.teleport({x:0,y:0,z:5},0);bot.state.health=20;bot.state.regenAt=5000;bot.brain!.reset(0);
 const states=new Set<string>();for(let i=0;i<120*20;i++){sim.step();states.add(bot.brain!.state);sim.events.length=0;}
 expect(states.has('retreating')).toBe(true);expect(states.has('healing')).toBe(true);expect(bot.state.health).toBe(100);expect(states.has('attacking')).toBe(true);
});

it('seeded local simulations reproduce decisions, combat and final scores',()=>{
 const data=arena(),navigation=new PracticeNavigation(data.world,data.layout),run=()=>{const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:3,difficulty:'absurd'},data,'Local',{seed:741,now:0,navigation});sim.spawnHuman('smg');advance(sim,15);return sim.snapshot();};
 expect(run()).toEqual(run());
});
it('bots lose visibility in real grenade smoke instead of tracking through it',()=>{
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:1,difficulty:'absurd'},arena(),'Local',{now:1000});sim.spawnHuman('rifle');const [human,bot]=sim.actors;human.controller.teleport({x:0,y:0,z:-5},0);bot.controller.teleport({x:0,y:0,z:5},0);bot.brain!.reset(sim.now);
 sim.explosions.push({id:'smoke',grenadeId:'actual-blast-history',ownerId:human.state.id,ownerLife:human.state.life,roundId:sim.roundId,at:0,position:{x:0,y:0,z:0},hits:[]});advance(sim,.5);
 expect(bot.brain!.visible).toBe(false);expect(bot.brain!.targetId).toBeNull();expect(human.state.health).toBe(100);
});
it.each(MAP_IDS)('%s navigation connects real spawns and includes reachable stair/interior floors',id=>{
 const data=WORLDS[id],nav=new PracticeNavigation(data.world,data.layout);const roots=data.layout.spawns.map(s=>nav.nearest({x:s.pos[0],y:s.pos[1],z:s.pos[2]}));
 expect(roots.every(Boolean)).toBe(true);expect(new Set(roots.map(n=>n!.component)).size).toBe(1);
 const start=roots[0]!;expect(nav.nodes.some(n=>n.component===start.component&&n.y>2.8),'connected upper floor').toBe(true);
 for(const n of roots.slice(1))expect(nav.path(start,n!).length).toBeGreaterThan(1);
 const invalid=nav.nodes.filter(n=>n.component===start.component&&data.world.overlapsCylinder(n.x,n.z,.34,n.y+.44,n.y+1.8));expect(invalid).toHaveLength(0);
 console.log(id,nav.inspect());
},30000);

it('Intermediate progresses between Beginner and Advanced and persists without requiring storage',()=>{
 expect(DIFFICULTIES).toEqual(['beginner','intermediate','advanced','absurd']);
 for(const key of ['reaction','error','decision','slide'] as const){expect(DIFFICULTY.intermediate[key]).toBeLessThan(DIFFICULTY.beginner[key]);expect(DIFFICULTY.intermediate[key]).toBeGreaterThan(DIFFICULTY.advanced[key]);}
 for(const key of ['speed','turn','retreat','cover'] as const){expect(DIFFICULTY.intermediate[key]).toBeGreaterThan(DIFFICULTY.beginner[key]);expect(DIFFICULTY.intermediate[key]).toBeLessThan(DIFFICULTY.advanced[key]);}
 for(let i=1;i<DIFFICULTIES.length;i++){expect(BOT_GRENADES[DIFFICULTIES[i]].chance).toBeGreaterThan(BOT_GRENADES[DIFFICULTIES[i-1]].chance);expect(BOT_GRENADES[DIFFICULTIES[i]].cooldown).toBeLessThan(BOT_GRENADES[DIFFICULTIES[i-1]].cooldown);}
 const entries=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>entries.get(k),setItem:(k:string,v:string)=>entries.set(k,v)});
 expect(loadDifficulty()).toBe('advanced');saveDifficulty('intermediate');expect(loadDifficulty()).toBe('intermediate');expect(validPractice({...DEFAULT_PRACTICE,difficulty:loadDifficulty()})).toBe(true);
 vi.stubGlobal('localStorage',{getItem:()=>{throw Error();},setItem:()=>{throw Error();}});expect(loadDifficulty()).toBe('advanced');expect(()=>saveDifficulty('intermediate')).not.toThrow();
});
it('grenade planning rejects walls, overhead obstacles and unsuitable ranges',()=>{
 const data=arena(),eye={x:0,y:1.65,z:6},target={x:0,y:0,z:-6};expect(botThrow(data.world,eye,target)).not.toBeNull();
 expect(botThrow(data.world,eye,{x:0,y:0,z:5})).toBeNull();expect(botThrow(data.world,eye,{x:0,y:0,z:-30})).toBeNull();
 data.world.add({c:[0,2,0],h:[3,2,.2]});expect(botThrow(data.world,eye,target)).toBeNull();
 const roof=arena();roof.world.add({c:[0,2.2,0],h:[5,.2,10]});expect(botThrow(roof.world,eye,target)).toBeNull();
});
it('a real bot charges, consumes one grenade, explodes with normal damage and cannot refill without kills',()=>{
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:1,difficulty:'intermediate'},arena(),'Local',{now:0});sim.spawnHuman('rifle');const [human,bot]=sim.actors;
 human.controller.teleport({x:0,y:0,z:-6},0);bot.controller.teleport({x:0,y:0,z:6},0);bot.brain!.reset(0);vi.spyOn(sim.random,'next').mockReturnValue(0);
 // Isolate grenade decisions from bullets and locomotion, retaining the real brain,
 // charge, launch, sweep/bounce, explosion, damage and inventory pipeline.
 vi.spyOn(bot.gun!,'update').mockReturnValue([]);vi.spyOn(bot.controller,'fixedUpdate').mockImplementation(()=>{});
 let thrown=false,charged=false;
 for(let i=0;i<120*8;i++){sim.step();charged ||= bot.charge.active;if(sim.events.some(e=>e.type==='grenade'&&e.event.kind==='throw')){thrown=true;break;}}
 expect(charged).toBe(true);expect(thrown).toBe(true);expect(bot.state.grenades).toBe(0);
 human.state.health=100;human.controller.teleport({...sim.grenades[0].position,y:0},0);
 // Follow the projectile to test the actual confirmed blast damage deterministically.
 while(sim.grenades.length){human.controller.teleport({...sim.grenades[0].position,y:0},0);sim.step();}
 expect(sim.events.some(e=>e.type==='grenade'&&e.event.kind==='explode'&&e.event.hits.some(h=>h.id===human.state.id&&h.amount>0))).toBe(true);
 expect(bot.state.health).toBe(100);expect(sim.policy.persistStatistics).toBe(false);expect(sim.policy.uploadResults).toBe(false);
 const throws=sim.events.filter(e=>e.type==='grenade'&&e.event.kind==='throw').length;
 bot.state.grenades=0;advance(sim,25);expect(sim.events.filter(e=>e.type==='grenade'&&e.event.kind==='throw')).toHaveLength(throws);
});
it('multiple bots space grenade attempts and cancel a charge when a wall blocks the opponent',()=>{
 const data=arena(),sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:3,difficulty:'absurd',mode:'teams'},data,'Local',{now:0});sim.spawnHuman('rifle');vi.spyOn(sim.random,'next').mockReturnValue(0);
 sim.actors[0].controller.teleport({x:0,y:0,z:-7},0);
 for(const [i,bot]of sim.actors.slice(1).entries()){bot.state.team='red';bot.controller.teleport({x:i*2,y:0,z:7},0);bot.brain!.reset(0);vi.spyOn(bot.gun!,'update').mockReturnValue([]);vi.spyOn(bot.controller,'fixedUpdate').mockImplementation(()=>{});}
 for(let i=0;i<120*8&&!sim.actors.some(a=>a.charge.active);i++)sim.step();expect(sim.actors.filter(a=>a.charge.active).length).toBe(1);
 data.world.add({c:[0,3,0],h:[12,3,.2]});advance(sim,1);expect(sim.actors.some(a=>a.charge.active)).toBe(false);expect(sim.events.filter(e=>e.type==='grenade'&&e.event.kind==='throw')).toHaveLength(0);
 expect(sim.actors.slice(1).map(a=>a.state.grenades)).toEqual([1,1,1]);
});

it('Practice uses real semi-auto presses, exact head damage and offline-only rewards',()=>{
 const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:1},arena(),'Marksman',{now:0});sim.spawnHuman('semi-sniper');
 const [human,bot]=sim.actors;bot.brain=null;human.controller.teleport({x:0,y:0,z:5},0);bot.controller.teleport({x:0,y:0,z:-5},180);
 advance(sim,.3,()=>input());const eye=human.controller.leanEye(),pitch=Math.atan2(1.6-eye.y,10);
 advance(sim,1,()=>input(0,pitch,true));const first=sim.events.filter(e=>e.type==='shot');expect(first).toHaveLength(1);expect(bot.state.health).toBe(50);expect(human.gun!.ammo).toBe(14);
 advance(sim,.2,()=>input(0,pitch,false));advance(sim,.1,()=>input(0,pitch,true));expect(bot.state.alive).toBe(false);expect(human.state.score).toBe(150);expect(human.state.kills).toBe(1);
 expect(sim.policy).toMatchObject({rewards:false,persistStatistics:false,uploadResults:false});expect(sim.snapshot().players.find(p=>p.id===human.state.id)!.weapon).toBe('semi-sniper');
});
it('every bot difficulty taps the semi-auto, respects its rate/ammo, reloads and can switch back to existing guns',()=>{
 const data=arena(),nav=new PracticeNavigation(data.world,data.layout);
 for(const difficulty of DIFFICULTIES){
  const sim=new PracticeSimulation({...DEFAULT_PRACTICE,bots:1,difficulty},data,'Local',{now:0,navigation:nav});sim.spawnHuman('rifle');const [human,bot]=sim.actors;
  sim.switchWeapon(bot,'semi-sniper');human.controller.teleport({x:0,y:0,z:6},0);bot.controller.teleport({x:0,y:0,z:-6},180);bot.state.grenades=0;
  const times:number[]=[];let reloaded=false,lastAmmo=15,seen=0,previousTrigger=false;
  for(let i=0;i<120*15;i++){
   human.state.health=100;sim.step(input());const gun=bot.gun!;
   expect(gun.stats.id).toBe('semi-sniper');expect(gun.ammo).toBeGreaterThanOrEqual(0);expect(gun.ammo).toBeLessThanOrEqual(15);
   if(gun.ammo>lastAmmo)reloaded=true;lastAmmo=gun.ammo;
   const shots=sim.events.filter(e=>e.type==='shot'&&e.shot.shooterId===bot.state.id);
   if(shots.length>seen){expect(shots.length-seen).toBe(1);expect(previousTrigger).toBe(false);expect(bot.state.combat.triggerHeld).toBe(true);times.push(sim.now);seen=shots.length;}
   previousTrigger=bot.state.combat.triggerHeld;
  }
  expect(times.length,difficulty).toBeGreaterThan(15);expect(reloaded,difficulty).toBe(true);
  for(let i=1;i<times.length;i++)expect(times[i]-times[i-1]+.0001).toBeGreaterThanOrEqual(60000/(630*.9));
  for(let i=0;i<400&&bot.gun!.reloading;i++)sim.step(input());sim.switchWeapon(bot,'rifle');expect(bot.state.weapon).toBe('rifle');
 }
});
