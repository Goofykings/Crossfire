import {expect,it} from 'vitest';
import {encodeServerMessage} from '../shared/snapshotWire';
import {parseServerMessage,PROTOCOL_VERSION,type Snapshot} from '../shared/protocol';
import {PlayerController} from '../src/player/PlayerController';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {Weapon,WEAPONS} from '../src/weapons/Weapon';
import {createMeleeState} from '../shared/melee';

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
