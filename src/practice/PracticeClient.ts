import {createMeleeState,stepMelee,meleeBlocked} from '../../shared/melee';
import type {MultiplayerClient,ConnectionState} from '../network/MultiplayerClient';
import type {Snapshot,InputFrame} from '../../shared/protocol';
import {NETWORK_HZ} from '../../shared/protocol';
import type {PlayerController,MoveIntent} from '../player/PlayerController';
import {FIXED_DT,MOVEMENT} from '../config/constants';
import {NO_COMBAT,type CombatIntent} from '../../shared/combat';
import type {Weapon,WeaponId} from '../weapons/Weapon';
import type {EnvironmentFrame} from '../../shared/environment';
import {PracticeSimulation,type PracticeWorld} from './PracticeSimulation';
import type {PracticeSetup} from './config';
type SessionFields='melee'|'onMelee'|'state'|'selfId'|'latest'|'environment'|'clockOffset'|'onRoomExit'|'onCareer'|'onSnapshot'|'onShot'|'onElimination'|'onGrenade'|'onEnvironment'|'onChat'|'onSystem'|'onChatError'|'onState'|'spawn'|'fixedInput'|'reconcile'|'sendChat'|'disconnect'|'leaveRoom'|'reconnect';
/** Presentation contract only. A local session never manufactures a WebSocket handshake. */
export type MatchSession=Pick<MultiplayerClient,SessionFields>&{connect():Promise<unknown>;inspect():unknown};
export class PracticeClient implements MatchSession {
 melee=createMeleeState();private inputTimes=new Map<number,number>();
 onMelee:MatchSession['onMelee']=()=>{};
 state:ConnectionState='idle';readonly selfId='practice-player';latest:Snapshot|null=null;environment:EnvironmentFrame|null=null;clockOffset=0;
 readonly simulation:PracticeSimulation;
 onRoomExit:MatchSession['onRoomExit']=()=>{};onCareer:MatchSession['onCareer']=()=>{};
 onSnapshot:MatchSession['onSnapshot']=()=>{};onShot:MatchSession['onShot']=()=>{};onElimination:MatchSession['onElimination']=()=>{};onGrenade:MatchSession['onGrenade']=()=>{};onEnvironment:MatchSession['onEnvironment']=()=>{};
 onChat:MatchSession['onChat']=()=>{};onSystem:MatchSession['onSystem']=()=>{};onChatError:MatchSession['onChatError']=()=>{};onState:MatchSession['onState']=()=>{};
 private queue:InputFrame[]=[];private pending:InputFrame[]=[];private sequence=0;private accumulator=0;private sinceSnapshot=0;
 constructor(setup:PracticeSetup,world:PracticeWorld,name:string){this.simulation=new PracticeSimulation(setup,world,name,{seed:crypto.getRandomValues(new Uint32Array(1))[0],roundId:Date.now()});}
 async connect():Promise<void>{if(this.state==='connected')return;this.state='connected';this.publish(true);this.onState('connected');}
 private publish(full=false){
  if(this.state!=='connected')return;
  this.clockOffset=this.simulation.now-Date.now();this.latest=this.simulation.snapshot();const ack=this.latest.players[0].ack;this.pending=this.pending.filter(f=>f.seq>ack);
  const frame=this.simulation.environment(full);if(frame){this.environment={...frame,full:true,states:frame.full?frame.states:[...(this.environment?.states??[]).filter(s=>!frame.states.some(n=>n.id===s.id)),...frame.states]};this.onEnvironment(frame);}
  for(const event of this.simulation.events.splice(0)){if(event.type==='melee')this.onMelee(event.event);else if(event.type==='shot')this.onShot(event.shot);else if(event.type==='elimination')this.onElimination(event.elimination);else this.onGrenade(event.event);}
  this.onSnapshot(this.latest);this.sinceSnapshot=0;
 }
 advance(dt:number,paused=false){
  if(this.state!=='connected')return;if(!paused){this.accumulator+=Math.min(.25,Math.max(0,dt));while(this.accumulator>=FIXED_DT){this.simulation.step(this.queue.shift()??null);this.accumulator-=FIXED_DT;this.sinceSnapshot+=FIXED_DT;}if(this.sinceSnapshot>=1/NETWORK_HZ||this.simulation.events.length||this.simulation.result&&!this.latest?.result)this.publish();}
  this.clockOffset=this.simulation.now-Date.now();
 }
 async spawn(weapon:WeaponId){if(this.state!=='connected')throw Error('Practice is closed.');this.queue=[];this.pending=[];this.inputTimes.clear();this.melee=createMeleeState();this.accumulator=0;this.sinceSnapshot=0;this.simulation.spawnHuman(weapon);this.publish(true);return this.latest!;}
 fixedInput(player:PlayerController,intent:MoveIntent,combat:CombatIntent=NO_COMBAT){
  if(this.state!=='connected'||!this.simulation.actors[0].state.alive)return;stepMelee(this.melee,Math.floor(this.simulation.now),combat,this.simulation.actors[0].gun?.action==='idle');const frame={seq:++this.sequence,yaw:player.yaw,pitch:player.pitch,intent:{...intent},combat:{...combat}};this.inputTimes.set(frame.seq,Math.floor(this.simulation.now));this.queue.push(frame);this.pending.push(frame);
 }
 reconcile(player:PlayerController,snapshot:Snapshot,gun?:Weapon){
  const self=snapshot.players.find(p=>p.id===this.selfId);if(!self?.alive)return;this.melee=structuredClone(self.combat.melee??createMeleeState());for(const seq of this.inputTimes.keys())if(seq<=self.ack)this.inputTimes.delete(seq);const yaw=player.yaw,pitch=player.pitch;player.restore(self.motion);player.weaponClearance=meleeBlocked(this.melee)?null:self.weapon;if(gun&&self.combat.gun)gun.restore(self.combat.gun);
  let trigger=self.combat.triggerHeld,reload=self.combat.reloadHeld;
  for(const f of this.pending)if(f.seq>self.ack){player.weaponClearance=meleeBlocked(this.melee)?null:self.weapon;stepMelee(this.melee,Math.max(this.melee.startedAt,this.inputTimes.get(f.seq)??snapshot.serverTime),f.combat,gun?.action==='idle');const blocked=meleeBlocked(this.melee);player.yaw=f.yaw;player.pitch=f.pitch;player.fixedUpdate(FIXED_DT,f.intent);gun?.update(FIXED_DT,{trigger:!blocked&&f.combat.trigger,triggerPressed:!blocked&&f.combat.trigger&&!trigger,reloadPressed:!blocked&&f.combat.reload&&!reload,aim:!blocked&&f.intent.aim,moveFactor:player.horizontalSpeed/MOVEMENT.weaponMoveReference,airborne:!player.grounded,sprinting:false});trigger=f.combat.trigger;reload=f.combat.reload;}
  player.yaw=yaw;player.pitch=pitch;
 }
 sendChat(_text:string){return false;}reconnect(){/* This local session has no transport to reconnect. */}
 disconnect(_forget=true){this.state='closed';this.queue=[];this.pending=[];this.latest=null;this.environment=null;this.simulation.events.length=0;this.onState('closed');}
 async leaveRoom(){this.disconnect();}
 inspect(){return{transport:'local',socketState:null,opens:0,closes:0,pending:this.pending.length,...this.simulation.inspect()};}
}
