import {expect,it} from 'vitest';
import {encodeServerMessage} from '../shared/snapshotWire';
import {parseServerMessage,PROTOCOL_VERSION,type Snapshot} from '../shared/protocol';
import {PlayerController} from '../src/player/PlayerController';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {Weapon,WEAPONS} from '../src/weapons/Weapon';
import {createMeleeState} from '../shared/melee';
import {NO_INTENT} from '../src/player/PlayerController';
import {FIXED_DT} from '../src/config/constants';

function message(){
 const p=new PlayerController(new CollisionWorld());p.position.x=1.123456789;
 const snapshot:Snapshot={serverTime:1000,room:'public-main',mapId:'european-town',roundId:1,mapVersion:'test',grenades:[],explosions:[],result:null,
  match:{mode:'ffa',endsAt:10000,teamScores:null},players:Array.from({length:10},(_,i)=>({id:'player-'+i,name:'Player '+i,motion:p.capture(),ack:10,life:1,
   alive:true,health:100,weapon:'rifle',combat:{gun:new Weapon(WEAPONS[0]).capture(),melee:createMeleeState(),triggerHeld:false,reloadHeld:false,aimHeld:false,grenadeHeld:false},
   grenades:1,score:0,comboCount:0,comboUntil:null,lastPlayedRound:1,lastPlayedTeam:null,kills:0,deaths:0,team:null,death:null}))};
 return {v:PROTOCOL_VERSION,type:'snapshot',snapshot} as const;
}
it('independent packed snapshots preserve gameplay state with substantially fewer bytes',()=>{
 const source=message(),plain=encodeServerMessage(source),packed=encodeServerMessage(source,true),decoded=parseServerMessage(packed);
 expect(parseServerMessage(plain)).not.toBeNull();expect(decoded?.type).toBe('snapshot');
 if(decoded?.type!=='snapshot')throw Error('Snapshot required');
 expect(packed.length).toBeLessThan(plain.length*.7);
 expect(decoded.snapshot.players[0].motion.position.x).toBeCloseTo(source.snapshot.players[0].motion.position.x,4);
 expect(decoded.snapshot.players[0].combat).toEqual(source.snapshot.players[0].combat);
 console.info('Snapshot bytes',JSON.stringify({plain:plain.length,compact:packed.length,players:10}));
});
it('packed payloads receive the same strict value validation as full snapshots',()=>{
 const packed=JSON.parse(encodeServerMessage(message(),true));
 for(const mutate of [(p:any)=>p.motion=[],(p:any)=>p.motion[0]=null,(p:any)=>p.combat[0][0]=99999,(p:any)=>p.combat[2]='true',(p:any)=>p.burn=true]){
  const bad=structuredClone(packed);mutate(bad.snapshot.players[0]);expect(parseServerMessage(JSON.stringify(bad))).toBeNull();
 }
});

it('packed motion preserves the real fixed-step coyote jump at its boundary',()=>{
 const world=new CollisionWorld();world.add({c:[0,-1,4],h:[2,1,2]});
 const authority=new PlayerController(world);authority.teleport({x:0,y:0,z:2.1});
 while(authority.capture().airTime<.095)authority.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1});
 // Twelve actual 120 Hz ticks yield 0.09999999999999999, still inside coyote time.
 const source=message();source.snapshot.players[0].motion=authority.capture();
 const decoded=parseServerMessage(encodeServerMessage(source,true));
 if(decoded?.type!=='snapshot')throw Error('Expected validated snapshot');
 const predicted=new PlayerController(world);predicted.restore(decoded.snapshot.players[0].motion);
 authority.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});
 predicted.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});
 expect(authority.velocity.y).toBeGreaterThan(6);
 expect(predicted.capture()).toEqual(authority.capture());
});

it('compact checkpoints preserve exact simulation values, including gun cooldowns',()=>{
 const source=message(),motion=source.snapshot.players[0].motion,gun=source.snapshot.players[0].combat.gun!;
 motion.velocity={x:1/3,y:-1/6,z:Math.PI};motion.airTime=12/120-Number.EPSILON;
 motion.slideRemaining=1-1/120;motion.slideCooldown=1/120;motion.jumpBufferTimer=.12-1/120;
 gun.cooldown=.00000001;gun.bloom=1/3;
 const decoded=parseServerMessage(encodeServerMessage(source,true));
 if(decoded?.type!=='snapshot')throw Error('Expected validated snapshot');
 expect(decoded.snapshot.players[0].motion).toEqual(motion);
 expect(decoded.snapshot.players[0].combat.gun).toEqual(gun);
});
