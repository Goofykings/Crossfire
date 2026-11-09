import type {ServerMessage} from './protocol';

const motionKeys=['yaw','pitch','grounded','crouch','slideRemaining','slideCooldown','slideHeld','slideYaw','airTime','jumpBufferTimer','jumpedThisAirborne','lean','lowClearance'] as const;
const gunKeys=['ammo','ads','action','progress','time','duration','cues','cooldown','bloom','emptyClickCooldown','stopLoading','fromEmpty'] as const;
const meleeKeys=['phase','stage','startedAt','sequence','contactDone','buffered','comboAt','toggleHeld','triggerHeld'] as const;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const vectorKeys=['x','y','z'] as const;
const quantize=(v:unknown):unknown=>typeof v==='number'&&Number.isFinite(v)&&!Number.isInteger(v)?Math.round(v*10000)/10000:v;

/** Independent snapshots: no delta chain to lose during stalls or reconnects.
 * Arrays remove repeated hot-path field names; pose precision remains submillimetre. */
export function encodeServerMessage(message:ServerMessage,compact=false):string {
 if(!compact||!('snapshot'in message))return JSON.stringify(message);
 const players=message.snapshot.players.map(p=>{
  const m=p.motion,c=p.combat;
  return {...p,motion:[...vectorKeys.map(k=>quantize(m.position[k])),...vectorKeys.map(k=>quantize(m.velocity[k])),...motionKeys.map(k=>quantize(m[k]??false))],
   combat:[c.gun?gunKeys.map(k=>k==='cues'?c.gun![k]:quantize(c.gun![k])):null,c.melee?meleeKeys.map(k=>c.melee![k]):null,c.triggerHeld,c.reloadHeld,c.aimHeld,c.grenadeHeld]};
 });
 return JSON.stringify({...message,compact:1,snapshot:{...message.snapshot,players}});
}

/** Shape checks precede expansion; the ordinary strict protocol validator then
 * checks every decoded value. No compact payload bypasses validation. */
export function expandServerMessage(value:unknown):unknown {
 if(!record(value)||!('compact'in value))return value;
 if(value.compact!==1||!['welcome','snapshot','spawned'].includes(String(value.type))||!record(value.snapshot)||!Array.isArray(value.snapshot.players)||value.snapshot.players.length>16)return null;
 const players=[];
 for(const p of value.snapshot.players){
  if(!record(p)||!Array.isArray(p.motion)||p.motion.length!==19||!Array.isArray(p.combat)||p.combat.length!==6)return null;
  const m=p.motion,c=p.combat,g=c[0],melee=c[1];
  if(g!==null&&(!Array.isArray(g)||g.length!==gunKeys.length)||melee!==null&&(!Array.isArray(melee)||melee.length!==meleeKeys.length))return null;
  const gun=g===null?null:Object.fromEntries(gunKeys.map((k,i)=>[k,g[i]]));
  const combat={gun,...(melee===null?{}:{melee:Object.fromEntries(meleeKeys.map((k,i)=>[k,melee[i]]))}),triggerHeld:c[2],reloadHeld:c[3],aimHeld:c[4],grenadeHeld:c[5]};
  players.push({...p,motion:{position:{x:m[0],y:m[1],z:m[2]},velocity:{x:m[3],y:m[4],z:m[5]},...Object.fromEntries(motionKeys.map((k,i)=>[k,m[i+6]]))},combat});
 }
 const {compact,...message}=value;return {...message,snapshot:{...value.snapshot,players}};
}
