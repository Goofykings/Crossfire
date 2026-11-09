import {expect,it} from 'vitest';
import {encodeClientMessage} from '../shared/inputWire';
import {parseClientMessage,PROTOCOL_VERSION,type ClientMessage} from '../shared/protocol';

it('compact input preserves every edge, aim, timestamp and sequence without inventing simulation time',()=>{
 const message:ClientMessage={v:PROTOCOL_VERSION,type:'input',roundId:1,mapVersion:'test',frames:Array.from({length:6},(_,k)=>({seq:k+1,yaw:.123,pitch:.04,viewTime:1000000+k*8,
  intent:{x:1,z:-1,slide:k===0,aim:true,jumpPressed:k===2,crouch:k>3,lean:-1},combat:{trigger:k===1,reload:k===3,melee:k===4,grenade:k===0,grenadeCancel:k===5,aimYaw:.13,aimPitch:.05}}))};
 const raw=encodeClientMessage(message),decoded=parseClientMessage(raw);
 expect(decoded).toEqual(message);expect(raw.length).toBeLessThan(JSON.stringify(message).length*.4);
});
it('malformed tuples and illegal flags still fail normal strict input validation',()=>{
 const source={v:PROTOCOL_VERSION,type:'input',roundId:1,mapVersion:'test',compact:1,frames:[[1,0,0,0,1,0,0,null,null,1000]]};
 expect(parseClientMessage(JSON.stringify(source))).not.toBeNull();
 for(const [index,value]of [[0,0],[1,99],[4,2],[5,512],[5,1.5],[6,3],[9,-1]]){
  const bad=structuredClone(source);bad.frames[0][index as number]=value;expect(parseClientMessage(JSON.stringify(bad))).toBeNull();
 }
 const bad=structuredClone(source);bad.frames[0].pop();expect(parseClientMessage(JSON.stringify(bad))).toBeNull();
});
