import {NO_INTENT,type MoveIntent,type Vec3} from '../player/PlayerController';
import {playerHeight,teammates,type MatchMode} from '../../shared/combat';
import {WEAPONS,type WeaponId} from '../weapons/Weapon';
import type {InputFrame} from '../../shared/protocol';
import {DIFFICULTY,BOT_GRENADES,PracticeRandom,type BotDifficulty} from './config';
import type {PracticeNavigation,NavNode} from './Navigation';
import type {PracticeActor} from './types';
import {botThrow} from './botGrenades';
import {GRENADE} from '../../shared/grenades';
import {leanOffset} from '../../shared/lean';
import {ZONE_MAPS,insideZone,type ZoneControlState,type ZoneId} from '../../shared/zoneControl';
export type BotState='exploring'|'patrolling'|'searching'|'pursuing'|'attacking'|'seeking-cover'|'retreating'|'healing'|'respawning';
export interface BotContext {actors:readonly PracticeActor[];nav:PracticeNavigation;now:number;mode:MatchMode;random:PracticeRandom;switchWeapon:(a:PracticeActor,w:WeaponId)=>void;reserveGrenade?:()=>boolean;obscured?:(from:Vec3,to:Vec3)=>boolean;zones?:ZoneControlState}
const dist=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z),wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
export class BotBrain {
 private clearanceEscape=false;
 state:BotState='respawning';targetId:string|null=null;visible=false;path:NavNode[]=[];pathIndex=0;goal:NavNode|null=null;
 stuckFor=0;recoveries=0;switches=0;distanceTravelled=0;lastSeen:Vec3|null=null;
 objective:ZoneId|null=null;
 private grenadeCheck=0;private nextGrenade=0;private throwingUntil=0;
 private seenAt=-Infinity;private noticedAt=0;private thinkAt=0;private routeAt=0;private previous:Vec3;
 private nextSlide=0;private slideUntil=0;private nextJump=0;private nextSwitch=0;private triggerUntil=0;private burstAt=0;private strafe=1;private turnAt=0;
 private readonly tuning;private errorYaw=0;private errorPitch=0;private headAim=false;private seq=0;private restingUntil=0;
 constructor(private actor:PracticeActor,readonly difficulty:BotDifficulty,private random:PracticeRandom){this.tuning=DIFFICULTY[difficulty];this.previous={...actor.controller.position};}
 reset(now:number){this.clearanceEscape=false;this.objective=null;this.throwingUntil=0;this.grenadeCheck=now+1000;this.nextGrenade=Math.max(this.nextGrenade,now+2000);this.state='exploring';this.path=[];this.pathIndex=0;this.goal=null;this.targetId=null;this.visible=false;this.lastSeen=null;this.seenAt=-Infinity;this.noticedAt=0;this.thinkAt=now;this.stuckFor=0;this.previous={...this.actor.controller.position};this.nextSwitch=now+22000+this.random.next()*24000;this.routeAt=0;}
 private eye(a:PracticeActor):Vec3{return a.controller.leanEye();}
 private point(a:PracticeActor,head=true):Vec3{const p=a.controller.position,offset=leanOffset(a.controller.yaw,a.controller.lean);return{x:p.x+offset.x*(head?1:.5),y:p.y+(head?playerHeight(a.controller.capture())-.2:playerHeight(a.controller.capture())*.67),z:p.z+offset.z*(head?1:.5)};}
 private clear(a:Vec3,b:Vec3,ctx:BotContext){const length=dist(a,b);return !ctx.obscured?.(a,b)&&(length<.01||!ctx.nav.world.raycast(a.x,a.y,a.z,(b.x-a.x)/length,(b.y-a.y)/length,(b.z-a.z)/length,length-.01));}
 private perceive(ctx:BotContext){
  const self=this.actor,p=self.controller,eye=this.eye(self);let best:PracticeActor|null=null,range=48;
  for(const other of ctx.actors){if(other===self||!other.state.alive||teammates(ctx.mode,self.state.team,other.state.team))continue;const distance=dist(p.position,other.controller.position);if(distance>range)continue;
   const head=this.point(other),dx=head.x-eye.x,dz=head.z-eye.z,angle=Math.abs(wrap(Math.atan2(-dx,-dz)-p.yaw));
   // Nearby movement/sound is detectable outside the main field; no wall penetration.
   if(angle>Math.PI*.59&&distance>8)continue;if(!this.clear(eye,head,ctx)&&!this.clear(eye,this.point(other,false),ctx))continue;best=other;range=distance;
  }
  this.visible=!!best;
  if(best){if(this.targetId!==best.state.id||ctx.now-this.seenAt>1200)this.noticedAt=ctx.now+this.tuning.reaction*1000;this.targetId=best.state.id;this.lastSeen={...best.controller.position};this.seenAt=ctx.now;}
  else if(ctx.now-this.seenAt>6500){this.targetId=null;this.lastSeen=null;}
 }
 private route(ctx:BotContext,to:Vec3){this.goal=ctx.nav.nearest(to,ctx.nav.nearest(this.actor.controller.position)?.component)??null;this.path=this.goal?ctx.nav.path(this.actor.controller.position,this.goal):[];this.pathIndex=this.path.length>1?1:0;this.routeAt=ctx.now+850;}
 private cover(ctx:BotContext,enemy:PracticeActor):NavNode|undefined{
  const eye=this.eye(enemy),p=this.actor.controller.position;
  return ctx.nav.reachable(p).filter(n=>{const distance=dist(p,n);return distance>2&&distance<10&&dist(n,enemy.controller.position)>7&&!this.clear({x:n.x,y:n.y+1.5,z:n.z},eye,ctx);}).sort((a,b)=>dist(p,a)-dist(p,b))[0];
 }
 private objectiveRoute(ctx:BotContext):boolean{
  if(!ctx.zones||!this.actor.state.team)return false;
  const team=this.actor.state.team,p=this.actor.controller.position;
  const candidates=ctx.zones.zones.map(zone=>{
   const definition=ZONE_MAPS[ctx.zones!.mapId].find(d=>d.id===zone.id)!;
   const [x,y,z]=definition.position,position={x,y,z};
   const assigned=ctx.actors.filter(a=>a!==this.actor&&a.state.alive&&a.state.team===team&&a.brain?.objective===zone.id).length;
   // Spread teammates across objectives, prioritize hostile/contested zones,
   // and keep a nearly completed capture instead of wandering away.
   const cost=(zone.owner===team&&!zone.contested&&zone.capturing===null?1000:0)+assigned*35+dist(p,position)-(this.objective===zone.id?12:0);
   return {definition,position,cost};
  }).sort((a,b)=>a.cost-b.cost);
  const chosen=candidates[0];if(!chosen)return false;
  const changed=this.objective!==chosen.definition.id;this.objective=chosen.definition.id;
  if(insideZone(chosen.definition,p)){this.goal=null;this.path=[];this.pathIndex=0;}
  else if(changed||!this.goal||ctx.now>=this.routeAt)this.route(ctx,chosen.position);
  return true;
 }
 private decide(ctx:BotContext){
  this.perceive(ctx);const a=this.actor,enemy=ctx.actors.find(a=>a.state.id===this.targetId),now=ctx.now;
  this.errorYaw=(this.random.next()*2-1)*this.tuning.error*Math.PI/180;this.errorPitch=(this.random.next()*2-1)*this.tuning.error*Math.PI/180;
  this.headAim=this.difficulty==='absurd'||this.random.next()<.15;
  if((this.state==='retreating'||this.state==='healing'||this.state==='seeking-cover')&&a.state.health<85&&this.goal){
   if(dist(a.controller.position,this.goal)<.8){this.state='healing';return;}
   if(now>=this.routeAt)this.route(ctx,this.goal);return;
  }
  if(a.state.health>=85&&this.state==='healing'){this.goal=null;this.path=[];}
  if(enemy&&this.visible&&a.state.health<this.tuning.retreat){const cover=this.cover(ctx,enemy);if(cover){this.state='retreating';this.route(ctx,cover);return;}}
  if(enemy&&this.visible){
   this.state=now>=this.noticedAt?'attacking':'searching';
   if(now>=this.turnAt){this.strafe=this.random.next()<.5?-1:1;this.turnAt=now+1200+this.random.next()*1600;}
   if(a.gun?.reloading&&this.random.next()<this.tuning.cover){const cover=this.cover(ctx,enemy);if(cover){this.state='seeking-cover';this.route(ctx,cover);return;}}
   if(!this.objectiveRoute(ctx)&&now>=this.routeAt)this.route(ctx,enemy.controller.position);
  }else if(this.objectiveRoute(ctx)){this.state='patrolling';}
  else if(this.lastSeen&&now-this.seenAt<(this.difficulty==='beginner'?2000:this.difficulty==='intermediate'?4000:6500)){this.state='pursuing';if(now>=this.routeAt)this.route(ctx,this.lastSeen);}
  else{
   if(!this.goal||dist(a.controller.position,this.goal)<.7||!this.path.length||this.pathIndex>=this.path.length){
    this.state=this.random.next()<.25?'exploring':'patrolling';const reachable=ctx.nav.reachable(a.controller.position).filter(n=>dist(n,a.controller.position)>4);
    const elevated=reachable.filter(n=>n.y>1.5);const choices=this.difficulty!=='beginner'&&this.random.next()<.28&&elevated.length?elevated:reachable;
    if(choices.length)this.route(ctx,this.random.pick(choices));this.restingUntil=now+(this.difficulty==='beginner'?this.random.next()*900:0);
   }
  }
  if(now>this.nextSwitch&&!this.visible&&now-this.seenAt>1800&&!a.gun?.reloading){const choices=WEAPONS.filter(w=>w.id!==a.state.weapon);ctx.switchWeapon(a,this.random.pick(choices).id);this.switches++;this.nextSwitch=now+22000+this.random.next()*25000;}
 }
 input(ctx:BotContext,dt:number):InputFrame{
  const a=this.actor,p=a.controller,now=ctx.now,it:MoveIntent={...NO_INTENT};
  if(!a.state.alive){this.state='respawning';return{seq:++this.seq,yaw:p.yaw,pitch:p.pitch,intent:it,combat:{trigger:false,reload:false}};}
  const moved=dist(p.position,this.previous);this.distanceTravelled+=moved;this.previous={...p.position};
  if(now>=this.thinkAt){this.decide(ctx);this.thinkAt=now+this.tuning.decision*1000+(this.random.next()-.5)*25;}
  const enemy=ctx.actors.find(v=>v.state.id===this.targetId),engage=this.visible&&enemy?.state.alive&&this.state==='attacking'&&now>=this.noticedAt;
  while(this.pathIndex<this.path.length&&Math.hypot(this.path[this.pathIndex].x-p.position.x,this.path[this.pathIndex].z-p.position.z)<.38&&Math.abs(this.path[this.pathIndex].y-p.position.y)<.5)this.pathIndex++;
  const nearby=!!enemy?.state.alive&&this.visible&&dist(p.position,enemy.controller.position)<1.65;
  let next=this.path[this.pathIndex],dx=next?next.x-p.position.x:0,dz=next?next.z-p.position.z:0,length=Math.hypot(dx,dz);
  const wantsMove=length>.15&&this.state!=='healing'&&now>=this.restingUntil;
  this.stuckFor=wantsMove&&moved<dt*.12?this.stuckFor+dt:Math.max(0,this.stuckFor-dt*2);
  if(this.stuckFor>1.4&&now>=this.routeAt&&this.goal){this.route(ctx,this.goal);if(this.stuckFor>2.5){const neighbors=ctx.nav.reachable(p.position).filter(n=>dist(n,p.position)>1&&dist(n,p.position)<3);if(neighbors.length)this.route(ctx,this.random.pick(neighbors));}this.recoveries++;}
  let aim:Vec3|null=null;if(engage&&enemy)aim=this.point(enemy,this.headAim);
  else if(this.lastSeen&&now-this.seenAt<1800)aim={x:this.lastSeen.x,y:this.lastSeen.y+1.3,z:this.lastSeen.z};
  const desired=aim?Math.atan2(-(aim.x-this.eye(a).x),-(aim.z-this.eye(a).z)):length>.1?Math.atan2(-dx,-dz):p.yaw+Math.sin(now/1300)*dt*.5;
  const turn=Math.max(-this.tuning.turn*dt,Math.min(this.tuning.turn*dt,wrap(desired-p.yaw)));p.yaw=wrap(p.yaw+turn);
  if(aim){const eye=this.eye(a);p.pitch=Math.max(-1.2,Math.min(1.2,Math.atan2(aim.y-eye.y,Math.hypot(aim.x-eye.x,aim.z-eye.z))+(engage?this.errorPitch:0)));}else p.pitch*=Math.exp(-dt*3);
  if(engage&&enemy){
   const d=dist(p.position,enemy.controller.position),preferred=a.state.weapon==='shotgun'?7:a.state.weapon==='sniper'?21:a.state.weapon==='semi-sniper'?17:13;
   if(d<1.65){dx=dz=0;length=1;}
   else if(d<preferred&&!ctx.zones){dx=Math.cos(p.yaw)*this.strafe;dz=-Math.sin(p.yaw)*this.strafe;length=1;}
  }
  if(nearby){dx=dz=0;length=1;}
  if(wantsMove||engage){const speed=this.tuning.speed;it.x=(dx/(length||1)*Math.cos(p.yaw)-dz/(length||1)*Math.sin(p.yaw))*speed;it.z=(-dx/(length||1)*Math.sin(p.yaw)-dz/(length||1)*Math.cos(p.yaw))*speed;}
  if(!nearby&&(wantsMove||engage)&&p.grounded&&!p.sliding&&p.slideCooldown<=0&&now>=this.nextSlide&&p.horizontalSpeed>2){this.slideUntil=now+80;this.nextSlide=now+this.tuning.slide*1000;}
  it.slide=now<this.slideUntil;
  if(p.grounded&&now>this.nextJump&&(next&&next.y-p.position.y>.28||this.stuckFor>1.7&&this.stuckFor<2.5)){it.jumpPressed=true;this.nextJump=now+2200;}
  const close=!!engage&&!!enemy&&dist(p.position,enemy.controller.position)<1.65;
  const melee=a.state.combat.melee;
  // A long firearm can be caught below a landing after a jump onto a guard.
  // Use the normal dagger equip to recover body clearance, then restore the gun
  // once movement is free. No teleport, collision exception or artificial attack.
  if(this.stuckFor>2.5&&!nearby&&p.grounded)this.clearanceEscape=true;
  if(this.clearanceEscape&&this.stuckFor<.15&&moved>dt*.12)this.clearanceEscape=false;
  const wantsMelee=close||this.clearanceEscape;
  const toggle=!!melee&&!melee.toggleHeld&&(wantsMelee&&melee.phase==='hidden'||!wantsMelee&&!nearby&&melee.phase!=='hidden'&&melee.phase!=='unequipping');
  it.aim=!!engage&&!it.slide&&!close;
  let trigger=false;
  if(engage&&enemy&&aim&&this.clear(this.eye(a),aim,ctx)&&Math.abs(wrap(desired-p.yaw))<(this.difficulty==='absurd'?.02:.09)){
   if(a.gun?.stats.mode==='auto'){
    if(now>=this.burstAt){this.triggerUntil=now+(this.difficulty==='absurd'?800:100+this.random.next()*220);this.burstAt=this.triggerUntil+(this.difficulty==='beginner'?600:this.difficulty==='intermediate'?400:200)+this.random.next()*250;}
    trigger=now<this.triggerUntil;
   }else if(a.gun?.ready&&!a.state.combat.triggerHeld)trigger=true;
  }
  // Use held input and the real charge/inventory pipeline, never inject a projectile.
  const canThrow=!!engage&&!!enemy&&a.state.grenades>0&&a.gun?.action==='idle'&&(!melee||melee.phase==='hidden')&&p.grounded&&!p.sliding;
  let plan:ReturnType<typeof botThrow>=null;
  if(this.throwingUntil||canThrow&&now>=this.grenadeCheck&&now>=this.nextGrenade){
   const tuning=BOT_GRENADES[this.difficulty];
   if(this.throwingUntil||this.random.next()<tuning.chance){if(canThrow&&enemy)plan=botThrow(ctx.nav.world,this.eye(a),enemy.controller.position);}
   this.grenadeCheck=now+1000;
   if(plan&&!this.throwingUntil){if(ctx.reserveGrenade?.()!==false){this.throwingUntil=now+Math.max(50,plan.strength*GRENADE.chargeMs);this.nextGrenade=now+tuning.cooldown;}else plan=null;}
  }
  if(this.throwingUntil){
   const cancel=!plan,held=!!plan&&now<this.throwingUntil;
   if(plan){p.yaw=plan.yaw;p.pitch=plan.pitch;}
   if(!held)this.throwingUntil=0;
   return{seq:++this.seq,yaw:p.yaw,pitch:p.pitch,intent:{...NO_INTENT},combat:{trigger:false,reload:false,grenade:held,grenadeCancel:cancel}};
  }
  // Error is in AI target angles only; the shared weapon spread/pellet cone is unchanged.
  return{seq:++this.seq,yaw:p.yaw,pitch:p.pitch,intent:it,combat:{melee:toggle,trigger:close?!!melee&&!melee.triggerHeld&&(melee.phase==='ready'||melee.phase==='attacking'):melee&&melee.phase!=='hidden'?false:trigger,reload:!close&&!!a.gun&&(a.gun.ammo===0||!this.visible&&a.gun.ammo<a.gun.stats.magazine*.45),aimYaw:wrap(this.difficulty==='absurd'&&engage?desired:p.yaw+(engage?this.errorYaw:0)),aimPitch:p.pitch}};
 }
 inspect(){return {objective:this.objective,state:this.state,target:this.targetId,visible:this.visible,goal:this.goal?{x:this.goal.x,y:this.goal.y,z:this.goal.z}:null,path:this.path.slice(this.pathIndex).map(n=>({x:n.x,y:n.y,z:n.z})),stuckFor:this.stuckFor,recoveries:this.recoveries,switches:this.switches,distanceTravelled:this.distanceTravelled};}
}
