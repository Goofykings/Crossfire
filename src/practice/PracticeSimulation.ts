import {defaultEquipment} from '../../shared/cosmetics';
import {eliminationEffect} from '../../shared/eliminationCosmetics';
import {createMeleeState,stepMelee,meleeBlocked,traceMelee,meleeKnockback,MELEE} from '../../shared/melee';
import {FIXED_DT,MOVEMENT,PLAYER_MAX_HEALTH} from '../config/constants';
import {MovementHold} from '../../shared/movementHold';
import {PlayerController,type Vec3} from '../player/PlayerController';
import {WEAPONS,Weapon,type WeaponId} from '../weapons/Weapon';
import {DamageSystem} from '../game/Damage';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {MapLayout} from '../maps/types';
import type {MapId} from '../../shared/maps';
import {ROUND_MS} from '../../shared/maps';
import {RESPAWN_DELAY_MS,type Snapshot,type InputFrame,type ShotResult,type Elimination} from '../../shared/protocol';
import {teammates,teamMode,NO_COMBAT} from '../../shared/combat';
import {createZoneControl,advanceZoneControl,zoneScores,type ZoneControlState} from '../../shared/zoneControl';
import {traceWeaponShot} from '../../shared/hitscan';
import {regenerate,REGEN_DELAY_MS} from '../../shared/health';
import {selectSpawn} from '../../shared/spawns';
import {awardElimination,expireCombo,resetCombo,finalizeRound,type RoundStanding,type RoundResult} from '../../shared/scoring';
import {DamageContributions,ASSIST_POINTS} from '../../shared/assists';
import {unsafeMovement} from '../../shared/movementSafety';
import {GrenadeCharge} from '../../shared/grenadeCharge';
import {GRENADE,GRENADE_SMOKE_MS,throwGrenade,advanceGrenade,blastDamage,grenadeKnockback,type GrenadeState,type GrenadeExplosion,type GrenadeEvent} from '../../shared/grenades';
import type {EnvironmentSimulation,EnvironmentFrame} from '../../shared/environment';
import {defaultCosmetic} from '../../shared/cosmetics';
import {PracticeNavigation} from './Navigation';
import {BotBrain,type BotContext} from './BotBrain';
import {PRACTICE_POLICY,PracticeRandom,validPractice,type PracticeSetup} from './config';
import type {PracticeActor} from './types';
import {smokeObscures} from '../weapons/grenadeSmoke';
export type PracticeEvent={type:'melee';event:import('../../shared/protocol').MeleeResult}|{type:'shot';shot:ShotResult}|{type:'elimination';elimination:Elimination}|{type:'grenade';event:GrenadeEvent};
export interface PracticeWorld {world:CollisionWorld;layout:MapLayout;revision:string;environment?:EnvironmentSimulation}
/** Browser-local authority. No fetch/WebSocket/storage/profile/reward adapter exists here.
 * Orchestration is local; movement, hitscan, damage, spread, grenades, regeneration,
 * spawn validation, assists, scoring and final rankings reuse production rules. */
export class PracticeSimulation {
 private readonly movement=new WeakMap<PracticeActor,MovementHold>();
 readonly policy=PRACTICE_POLICY;readonly selfId='practice-player';readonly actors:PracticeActor[]=[];readonly nav:PracticeNavigation;
 readonly random:PracticeRandom;readonly events:PracticeEvent[]=[];readonly roundId:number;
 now:number;started=false;endsAt:number|null=null;result:RoundResult|null=null;private serial=0;private environmentSeq=0;
 readonly teamScores={blue:0,red:0};private readonly damage=new DamageSystem();private readonly contributions=new DamageContributions();private botContext:BotContext;private nextBotGrenade=0;
 grenades:GrenadeState[]=[];explosions:GrenadeExplosion[]=[];
 private zoneControl:ZoneControlState|undefined;
 constructor(readonly setup:PracticeSetup,readonly data:PracticeWorld,name:string,options:{seed?:number;now?:number;roundId?:number;navigation?:PracticeNavigation}={}){
  if(!validPractice(setup))throw Error('Invalid Practice settings.');this.now=options.now??Date.now();this.roundId=options.roundId??1;this.random=new PracticeRandom(options.seed??12345);this.nav=options.navigation??new PracticeNavigation(data.world,data.layout);
  this.actors.push(this.create(this.selfId,name,teamMode(setup.mode)?'blue':null));
  for(let i=0;i<setup.bots;i++)this.actors.push(this.create('practice-bot-'+(i+1),'Bot '+(i+1),teamMode(setup.mode)?(i%2===0?'red':'blue'):null));
  for(const a of this.actors.slice(1))a.brain=new BotBrain(a,setup.difficulty,this.random);
  this.botContext={actors:this.actors,nav:this.nav,now:this.now,mode:setup.mode,random:this.random,reserveGrenade:()=>{if(this.now<this.nextBotGrenade)return false;this.nextBotGrenade=this.now+3500;return true;},switchWeapon:(a,w)=>this.switchWeapon(a,w),obscured:(from,to)=>this.explosions.some(e=>smokeObscures(from,to,e.position,this.now-e.at))};
 }
 private id(kind:string){return `practice:${this.roundId}:${kind}:${++this.serial}`;}
 private create(id:string,name:string,team:'blue'|'red'|null):PracticeActor{
  const controller=new PlayerController(this.data.world);
  return{controller,gun:null,brain:null,input:null,charge:new GrenadeCharge(),state:{id,name,team,motion:controller.capture(),ack:0,alive:false,health:100,life:0,weapon:null,combat:{melee:createMeleeState(),gun:null,triggerHeld:false,reloadHeld:false,aimHeld:false,grenadeHeld:false},grenades:GRENADE.perLife,score:0,kills:0,deaths:0,assists:0,comboCount:0,comboUntil:null,lastPlayedRound:null,lastPlayedTeam:null,death:null,regenAt:null}};
 }
 spawn(a:PracticeActor,weapon:WeaponId):boolean{
  if(this.result||a.state.alive||a.state.death&&this.now<a.state.death.respawnAt)return false;
  const occupants=this.actors.filter(p=>p!==a&&p.state.alive).map(p=>({...p.controller.position,eyeHeight:p.controller.eyeHeight,opponent:!teammates(this.setup.mode,a.state.team,p.state.team)}));
  const spawn=selectSpawn(this.data.layout,this.data.world,occupants);if(!spawn)return false;
  a.controller.teleport({x:spawn.pos[0],y:spawn.pos[1],z:spawn.pos[2]},spawn.heading);a.controller.weaponClearance=weapon;a.gun=new Weapon(WEAPONS.find(w=>w.id===weapon)!);a.charge.reset();a.input=null;this.movement.delete(a);
  Object.assign(a.state,{alive:true,health:PLAYER_MAX_HEALTH,life:a.state.life+1,death:null,regenAt:null,grenades:GRENADE.perLife,weapon,cosmeticId:defaultCosmetic(weapon),lastPlayedRound:this.roundId,lastPlayedTeam:a.state.team,combat:{melee:createMeleeState(),gun:a.gun.capture(),triggerHeld:false,reloadHeld:false,aimHeld:false,grenadeHeld:false}});
  resetCombo(a.state);this.contributions.clear(a.state.id);a.brain?.reset(this.now);return true;
 }
 spawnHuman(weapon:WeaponId):Snapshot{
  if(!WEAPONS.some(w=>w.id===weapon))throw Error('Choose a valid weapon.');const human=this.actors[0];
  if(!human.state.alive&&!this.spawn(human,weapon))throw Error('Wait for a valid respawn.');
  if(!this.started){this.started=true;this.endsAt=this.now+ROUND_MS;for(const bot of this.actors.slice(1))this.spawn(bot,this.random.pick(WEAPONS).id);
   if(this.setup.mode==='zone-control'){this.zoneControl=createZoneControl(this.setup.mapId,this.roundId,Math.floor(this.now),Math.floor(this.endsAt));this.botContext.zones=this.zoneControl;}
  }
  this.updateZones();
  return this.snapshot();
 }
 switchWeapon(a:PracticeActor,weapon:WeaponId){if(!a.state.alive||a.gun?.reloading||a.state.weapon===weapon)return;a.gun=new Weapon(WEAPONS.find(w=>w.id===weapon)!);a.gun.equip();a.state.weapon=weapon;a.state.cosmeticId=defaultCosmetic(weapon);a.controller.weaponClearance=weapon;a.state.combat={gun:a.gun.capture(),triggerHeld:false,reloadHeld:false,aimHeld:false,grenadeHeld:false};}
 private eliminate(victim:PracticeActor,killer:PracticeActor|null,head=false,direction:Vec3|null=null,weapon?:'grenade'|'melee'){
  if(!victim.state.alive)return;const id=this.id('death'),at=Math.floor(this.now),credited=killer&&killer!==victim?killer:null;
  victim.state.alive=false;victim.state.combat.melee=createMeleeState();victim.state.health=0;victim.state.regenAt=null;victim.state.deaths++;victim.charge.reset();resetCombo(victim.state);victim.input=null;
  if(victim.brain){victim.brain.state='respawning';victim.brain.visible=false;victim.brain.targetId=null;victim.brain.path=[];victim.brain.goal=null;}
  const assists:{id:string;name:string;points:50}[]=[];
  for(const source of this.contributions.take(victim.state.id,victim.state.life,this.roundId,at)){
   const helper=this.actors.find(a=>a.state.id===source.id);if(!credited||!helper||helper===credited||helper===victim||helper.state.life!==source.life)continue;
   helper.state.assists=(helper.state.assists??0)+1;helper.state.score+=ASSIST_POINTS;assists.push({id:helper.state.id,name:helper.state.name,points:50});
  }
  const award=credited?awardElimination(credited.state,at,head):null;
  if(credited){credited.state.kills++;credited.state.grenades++;if(this.setup.mode==='teams'&&credited.state.team)this.teamScores[credited.state.team]++;if(!credited.state.alive)resetCombo(credited.state);}
  const event:Elimination={id,at,respawnAt:at+RESPAWN_DELAY_MS,roundId:this.roundId,victimId:victim.state.id,victimName:victim.state.name,victimLife:victim.state.life,victimTeam:victim.state.team,killerId:killer?.state.id??null,killerName:killer?.state.name??null,killerTeam:killer?.state.team??null,weapon:weapon??killer?.state.weapon??null,head,direction,award,assists};
  if(credited){const equipment=defaultEquipment();if(credited.state.weapon)equipment[credited.state.weapon]=credited.state.cosmeticId??equipment[credited.state.weapon];equipment.melee=credited.state.meleeCosmeticId??equipment.melee;event.cosmeticEffect=eliminationEffect(equipment,event.weapon,victim.controller.position);}
  victim.state.death=event;this.events.push({type:'elimination',elimination:event});
 }
 private apply(victim:PracticeActor,killer:PracticeActor|null,amount:number,zone:'head'|'body',point:Vec3,direction:Vec3,weapon:WeaponId|'grenade'|'melee'):number{
  let applied=0;this.damage.tryApply({id:killer?.state.id??'environment',position:()=>point},{id:victim.state.id,alive:victim.state.alive,position:()=>victim.controller.position,applyDamage:damage=>{
   applied=Math.min(victim.state.health,damage);if(killer)this.contributions.damage(victim.state.id,victim.state.life,this.roundId,killer.state.id,killer.state.life,applied,this.now);
   victim.state.health-=applied;victim.state.regenAt=this.now+REGEN_DELAY_MS;if(victim.state.health===0)this.eliminate(victim,killer,zone==='head',direction,weapon==='grenade'||weapon==='melee'?weapon:undefined);
  }},{bodyDamage:amount,zone,point,weapon});return applied;
 }
 private fire(a:PracticeActor,spread:number,control:InputFrame['combat']){
  const gun=a.gun!,origin=a.controller.leanEye(),shot:ShotResult={id:this.id('shot'),roundId:this.roundId,shooterId:a.state.id,weapon:gun.stats.id,hits:[]};
  shot.traces=traceWeaponShot(this.data.world,origin,control.aimYaw??a.controller.yaw,control.aimPitch??a.controller.pitch,gun.stats,spread,
   ()=>this.actors.filter(t=>t!==a&&t.state.alive).map(t=>({value:t,motion:t.controller.capture()})),
   (target,hit)=>{if(teammates(this.setup.mode,a.state.team,target.state.team))return;const applied=this.apply(target,a,hit.bodyDamage,hit.zone,hit.point,hit.direction,gun.stats.id),previous=shot.hits.find(h=>h.id===target.state.id);
    if(previous){previous.amount+=applied;previous.health=target.state.health;previous.head ||=hit.zone==='head';previous.killed ||=!target.state.alive;}
    else shot.hits.push({id:target.state.id,life:target.state.life,amount:applied,health:target.state.health,head:hit.zone==='head',killed:!target.state.alive,direction:hit.direction});},
   (dir,distance)=>this.data.environment?.shoot(origin,dir,distance,gun.stats.id),this.random.next,gun.ads);
  this.events.push({type:'shot',shot});
 }
 private updateGrenades(){
  this.explosions=this.explosions.filter(e=>this.now-e.at<GRENADE_SMOKE_MS);
  for(const g of [...this.grenades]){
   advanceGrenade(g,this.now,this.data.world,(position,speed)=>{if(speed>1)this.events.push({type:'grenade',event:{kind:'bounce',id:this.id('bounce'),grenadeId:g.id,roundId:this.roundId,at:Math.floor(this.now),position:{...position},strength:Math.min(1,speed/12)}});});
   if(this.now<g.explodeAt)continue;this.grenades=this.grenades.filter(v=>v!==g);const owner=this.actors.find(a=>a.state.id===g.ownerId)??null;
   const blast:GrenadeExplosion={id:this.id('blast'),grenadeId:g.id,ownerId:g.ownerId,ownerLife:g.ownerLife,roundId:this.roundId,at:Math.floor(this.now),position:{...g.position},hits:[]};
   for(const victim of this.actors){if(!victim.state.alive||victim.state.id===g.ownerId||teammates(this.setup.mode,owner?.state.team??null,victim.state.team))continue;
    const amount=blastDamage(this.data.world,g.position,victim.controller.capture());if(amount<=0)continue;const p=victim.controller.position,dx=p.x-g.position.x,dy=p.y+victim.controller.eyeHeight-g.position.y,dz=p.z-g.position.z,n=Math.hypot(dx,dy,dz)||1,direction={x:dx/n,y:dy/n,z:dz/n};
    const applied=this.apply(victim,owner,amount,'body',p,direction,'grenade');if(applied>0&&victim.state.alive)grenadeKnockback(victim.controller,g.position,applied);if(applied>0)blast.hits.push({id:victim.state.id,life:victim.state.life,amount:applied,health:victim.state.health,killed:!victim.state.alive,direction});
   }
   if(owner&&!owner.state.alive)resetCombo(owner.state);this.explosions.push(blast);if(this.explosions.length>64)this.explosions.shift();this.events.push({type:'grenade',event:{kind:'explode',...blast}});
  }
 }
 step(input:InputFrame|null=null,dt=FIXED_DT){
  if(!this.started||this.result)return;this.now+=dt*1000;
  if(this.endsAt!==null&&this.now>=this.endsAt){this.finish();return;}
  this.updateZones();this.botContext.now=this.now;
  for(const a of this.actors){expireCombo(a.state,this.now);regenerate(a.state,this.now);if(a.brain&&!a.state.alive&&a.state.death&&this.now>=a.state.death.respawnAt)this.spawn(a,this.random.pick(WEAPONS).id);}
  for(const a of this.actors){
   if(!a.state.alive)continue;const frame=a===this.actors[0]?input:a.brain?.input(this.botContext,dt)??null;a.input=frame;
   if(frame){a.controller.yaw=frame.yaw;a.controller.pitch=frame.pitch;a.state.ack=frame.seq;}
   let held=this.movement.get(a);if(!held)this.movement.set(a,held=new MovementHold());
   a.controller.weaponClearance=meleeBlocked(a.state.combat.melee)?null:a.state.weapon;a.controller.fixedUpdate(dt,held.sample(frame?.intent,this.now));
   if(unsafeMovement(a.controller.position,this.data.layout)||a.controller.position.y<MOVEMENT.killY||a.brain&&a.brain.stuckFor>10)this.eliminate(a,null);
  }
  // Move everyone first, exactly like the Worker; resolve all weapons from this pose.
  for(const a of this.actors){
   if(!a.state.alive||!a.gun)continue;const f=a.input,control=f?.combat??NO_COMBAT,c=a.state.combat;
   c.melee??=createMeleeState();
   const contact=stepMelee(c.melee,Math.floor(this.now),f?.combat,a.gun.action==='idle');
   const blocked=meleeBlocked(c.melee);if(blocked)a.charge.reset();
   if(contact){const event:import('../../shared/protocol').MeleeResult={id:this.id('melee'),roundId:this.roundId,shooterId:a.state.id,life:a.state.life,at:Math.floor(this.now),stage:contact.stage,hits:[]};
    const found=traceMelee(this.data.world,a.controller.capture(),this.actors.filter(t=>t!==a&&t.state.alive).map(t=>({value:t,motion:t.controller.capture()})));
    if(found&&!teammates(this.setup.mode,a.state.team,found.target.state.team)){const t=found.target,amount=this.apply(t,a,MELEE.damage,'body',found.hit.point,found.hit.direction,'melee');if(amount>0)meleeKnockback(t.controller,found.hit.direction,contact.stage);event.hits.push({id:t.state.id,life:t.state.life,amount,health:t.state.health,head:false,killed:!t.state.alive,direction:found.hit.direction});}
    this.events.push({type:'melee',event});
   }
   const charge=a.charge.update(f?!!control.grenade:undefined,this.now,dt,!blocked&&a.state.grenades>0&&a.gun.action==='idle'&&!a.controller.sliding,!!control.grenadeCancel);
   if(charge!==null&&this.grenades.length<32){const p=a.controller,g=throwGrenade(this.data.world,p.leanEye(),{x:p.position.x,y:p.position.y+p.eyeHeight,z:p.position.z},p.lookDirection(),p.velocity,{id:this.id('grenade'),ownerId:a.state.id,ownerLife:a.state.life,roundId:this.roundId,at:this.now},charge);if(g){a.state.grenades--;this.grenades.push(g);this.events.push({type:'grenade',event:{kind:'throw',id:this.id('throw'),projectile:g}});}}
   const events=a.gun.update(dt,{trigger:!blocked&&control.trigger,triggerPressed:!blocked&&control.trigger&&!c.triggerHeld,reloadPressed:!blocked&&control.reload&&!c.reloadHeld,aim:!blocked&&(f?.intent.aim??c.aimHeld),moveFactor:a.controller.horizontalSpeed/MOVEMENT.weaponMoveReference,airborne:!a.controller.grounded,sprinting:false});
   c.triggerHeld=control.trigger;c.reloadHeld=control.reload;c.aimHeld=f?.intent.aim??false;c.grenadeHeld=!!control.grenade;
   for(const event of events)if(event.type==='fire')this.fire(a,event.spread,control);
  }
  this.updateGrenades();this.updateZones();this.data.environment?.advance(dt);
 }
 private updateZones(){
  if(!this.zoneControl)return;
  advanceZoneControl(this.zoneControl,this.now,this.actors.map(a=>({alive:a.state.alive,connected:true,team:a.state.team,position:a.controller.position})));
  Object.assign(this.teamScores,zoneScores(this.zoneControl));
 }
 finish(){if(this.result)return;this.updateZones();const players:Record<string,RoundStanding>={};for(const a of this.actors)players[a.state.id]={id:a.state.id,name:a.state.name,team:a.state.team,weapon:a.state.weapon,kills:a.state.kills,deaths:a.state.deaths,assists:a.state.assists??0,score:a.state.score};this.result=finalizeRound({roundId:this.roundId,mapId:this.setup.mapId,mode:this.setup.mode,endsAt:Math.floor(this.endsAt??this.now),players},this.teamScores);this.grenades=[];}
 environment(full=false):EnvironmentFrame|null{const env=this.data.environment;if(!env)return null;const states=full?env.capture():env.takeChanges();if(full)env.takeChanges();return !full&&!states.length?null:{roundId:this.roundId,mapVersion:this.data.revision,seq:++this.environmentSeq,at:Math.floor(this.now),full,states};}
 snapshot():Snapshot{return {...(this.zoneControl?{zoneControl:structuredClone(this.zoneControl)}:{}),room:'practice-local',roundId:this.roundId,mapId:this.setup.mapId as MapId,mapVersion:this.data.revision,serverTime:Math.floor(this.now),match:{mode:this.setup.mode,endsAt:this.endsAt===null?null:Math.floor(this.endsAt),teamScores:teamMode(this.setup.mode)?{...this.teamScores}:null},players:this.actors.map(a=>({...a.state,motion:a.controller.capture(),combat:{...a.state.combat,gun:a.gun?.capture()??null}})),grenades:structuredClone(this.grenades),explosions:structuredClone(this.explosions),result:this.result};}
 inspect(){return {policy:this.policy,setup:this.setup,now:this.now,started:this.started,nav:this.nav.inspect(),bots:this.actors.slice(1).map(a=>({id:a.state.id,name:a.state.name,health:a.state.health,weapon:a.state.weapon,position:{...a.controller.position},...a.brain!.inspect()}))};}
}
