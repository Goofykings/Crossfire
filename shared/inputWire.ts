import type {ClientMessage} from './protocol';

/** Fixed-size intent tuples keep the 120 Hz prediction stream inexpensive.
 * This carries the same inputs and sequence numbers, never positions or hits. */
export function encodeClientMessage(message:ClientMessage):string {
 if(message.type!=='input')return JSON.stringify(message);
 const frames=message.frames.map(f=>{
  const i=f.intent,c=f.combat,flags=Number(i.slide)|Number(i.aim)<<1|Number(i.jumpPressed)<<2|Number(!!i.crouch)<<3
   |Number(c.trigger)<<4|Number(c.reload)<<5|Number(!!c.grenade)<<6|Number(!!c.grenadeCancel)<<7|Number(!!c.melee)<<8;
  return [f.seq,f.yaw,f.pitch,i.x,i.z,flags,i.lean??0,c.aimYaw??null,c.aimPitch??null,f.viewTime??null];
 });
 return JSON.stringify({...message,compact:1,frames});
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function expandClientMessage(value:unknown):unknown {
 if(!record(value)||!('compact'in value)||value.type==='join')return value;
 if(value.compact!==1||value.type!=='input'||!Array.isArray(value.frames)||value.frames.length>12)return null;
 const frames=[];
 for(const f of value.frames){
  if(!Array.isArray(f)||f.length!==10||!Number.isInteger(f[5])||f[5]<0||f[5]>511)return null;
  const flags=f[5],flag=(bit:number)=>!!(flags&(1<<bit));
  frames.push({seq:f[0],yaw:f[1],pitch:f[2],intent:{x:f[3],z:f[4],slide:flag(0),aim:flag(1),jumpPressed:flag(2),crouch:flag(3),lean:f[6]},
   combat:{trigger:flag(4),reload:flag(5),grenade:flag(6),grenadeCancel:flag(7),melee:flag(8),...(f[7]===null&&f[8]===null?{}:{aimYaw:f[7],aimPitch:f[8]})},
   ...(f[9]===null?{}:{viewTime:f[9]})});
 }
 const {compact,...message}=value;return {...message,frames};
}
