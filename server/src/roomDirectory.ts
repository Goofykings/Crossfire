import type { PublicRoom } from './index';
import { ROOM_LIMITS, allocateRoomCode, roomCode, roomId, roomName, validSetup, type RoomSetup, type RoomView } from '../../shared/rooms';
import { PROTOCOL_VERSION } from '../../shared/protocol';
import type { CareerProfile } from '../../shared/challenges';
export interface RoomConfig extends RoomSetup { id:string; creator:string; createdAt:number; code?:string; hostId:string|null; creatorJoined:boolean; hadGuest:boolean; hadMember:boolean; emptySince:number|null; closed:boolean }
interface Ticket { room:string; identity:string; until:number }
const secret=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
export class DirectoryError extends Error { constructor(message:string,readonly status=400){super(message);} }
/** Metadata only; every game is a separate existing PublicRoom instance. */
export class RoomDirectory {
 private presenceCache:{at:number;total:number}|null=null;
 constructor(private storage:DurableObjectStorage,private rooms:DurableObjectNamespace<PublicRoom>,private profile:(identity:string)=>Promise<CareerProfile|undefined>,private legacy:()=>RoomView|null){}
 private async rate(key:string,max:number,ms=60000){
  const exceeded=await this.storage.transaction(async tx=>{const now=Date.now(),old=await tx.get<{at:number;count:number}>(key),r=old&&now-old.at<ms?old:{at:now,count:0};r.count++;await tx.put(key,r);return r.count>max;});
  if(exceeded)throw new DirectoryError('Too many attempts. Please try again in a minute.',429);
 }

 async active(id:string){return id==='public-main'||!!await this.storage.get('room-record:'+id);}
 async list(){
  const entries=await this.storage.list<RoomConfig>({prefix:'room-record:',limit:ROOM_LIMITS.active});
  const statuses=await Promise.all(['public-main',...[...entries.values()].filter(r=>r.privacy==='public').map(r=>r.id)].map(async id=>{
   try{const s=id==='public-main'?this.legacy():await this.rooms.getByName('room:'+id).roomStatus();return s?.id===id?s:null;}catch{return null;}
  }));
  return statuses.filter((s):s is RoomView=>!!s&&s.privacy==='public'&&s.players<s.maxPlayers).map(({code,...room})=>room);
 }
 async online(){
  if(this.presenceCache&&Date.now()-this.presenceCache.at<5000)return this.presenceCache.total;
  const rows=await this.storage.list<RoomConfig>({prefix:'room-record:',limit:ROOM_LIMITS.active});
  const counts=await Promise.all([...rows.values()].map(async r=>{try{return await this.rooms.getByName('room:'+r.id).onlineCount();}catch{return 0;}}));
  const total=counts.reduce((a,b)=>a+b,0);this.presenceCache={at:Date.now(),total};return total;
 }
 private async issue(id:string,identity:string){
  const rows=await this.storage.list<Ticket>({prefix:'room-ticket:',limit:512});let active=0;
  for(const[k,t]of rows){if(t.until<Date.now()||t.identity===identity)await this.storage.delete(k);else active++;}
  if(active>=500)throw new DirectoryError('Room admission is busy. Please retry.',503);
  const ticket=secret();await this.storage.put('room-ticket:'+ticket,{room:id,identity,until:Date.now()+ROOM_LIMITS.ticketMs});return ticket;
 }
 async create(identity:string,ip:string,raw:unknown){
  if(!await this.profile(identity))throw new DirectoryError('A valid guest profile is required.',401);
  await this.rate('room-create:'+identity,3);await this.rate('room-create-ip:'+ip,20);
  const x=raw as RoomSetup;if(x&&typeof x.name==='string')x.name=roomName(x.name);
  if(!validSetup(x))throw new DirectoryError('Choose a name, valid map, FFA or Teams, and 2-10 players.');
  const rows=await this.storage.list<RoomConfig>({prefix:'room-record:',limit:101});
  if(rows.size>=ROOM_LIMITS.active)throw new DirectoryError('Room hosting is busy. Please retry later.',503);
  if([...rows.values()].filter(r=>r.creator===identity).length>=ROOM_LIMITS.owned)throw new DirectoryError('You already have two active rooms. Leave and let an unused room close first.',429);
  const code=x.privacy==='private'?await allocateRoomCode(async candidate=>{const old=await this.storage.get<{id:string;until:number}>('room-code:'+candidate);return !old||old.until<Date.now();}):undefined;
  if(x.privacy==='private'&&!code)throw new DirectoryError('Unable to allocate a code. Please retry.',503);
  const config:RoomConfig={...x,id:crypto.randomUUID(),creator:identity,createdAt:Date.now(),hostId:null,creatorJoined:false,hadGuest:false,hadMember:false,emptySince:null,closed:false,...(code?{code}:{})};
  await this.storage.put({['room-record:'+config.id]:config,...(code?{['room-code:'+code]:{id:config.id,until:Number.MAX_SAFE_INTEGER}}:{})});
  try{await this.rooms.getByName('room:'+config.id).configureRoom(config);}catch(error){await this.remove(config.id);throw error;}
  const room=await this.rooms.getByName('room:'+config.id).roomStatus();if(!room)throw new DirectoryError('Room closed before joining.',410);
  return {v:PROTOCOL_VERSION,room,ticket:await this.issue(config.id,identity)};
 }
 async admit(identity:string,ip:string,raw:unknown){
  if(!await this.profile(identity))throw new DirectoryError('A valid guest profile is required.',401);
  await this.rate('room-admit:'+identity,20);const x=raw as Record<string,unknown>;
  if(!x||Object.keys(x).some(k=>!['roomId','code'].includes(k))||Number(x.roomId!==undefined)+Number(x.code!==undefined)!==1)throw new DirectoryError('Select a room or enter a six-digit code.');
  let id=x.roomId;
  if(x.code!==undefined){await this.rate('room-code-ip:'+ip,8);if(!roomCode(x.code))throw new DirectoryError('Enter exactly six digits.');
   const match=await this.storage.get<{id:string;until:number}>('room-code:'+x.code);id=match?.id;
  }
  if(!roomId(id)||!await this.active(id))throw new DirectoryError('Room not found or code expired.',404);
  const stored=id==='public-main'?null:await this.storage.get<RoomConfig>('room-record:'+id);
  if(stored?.privacy==='private'&&x.code!==stored.code)throw new DirectoryError('Enter the private room code.',403);
  const room=id==='public-main'?this.legacy():await this.rooms.getByName('room:'+id).roomStatus();
  if(!room||room.id!==id)throw new DirectoryError('This room has closed.',410);if(room.players>=room.maxPlayers)throw new DirectoryError('This room is full.',409);
  return {v:PROTOCOL_VERSION,room,ticket:await this.issue(id,identity)};
 }
 async consume(ticket:string,id:string,identity:string){
  const t=await this.storage.get<Ticket>('room-ticket:'+ticket);
  if(!t||t.until<Date.now()||t.room!==id||t.identity!==identity||!await this.active(id))throw new DirectoryError('Room authorization expired. Select the room again.',403);
  await this.storage.delete('room-ticket:'+ticket);
 }
 // Bounded incremental sweep: expired capabilities, rate buckets and code tombstones
 // cannot accumulate forever, even when the canonical gameplay room is empty.
 async cleanup(){
  const prefixes=['room-ticket:','room-code:','room-create:','room-create-ip:','room-admit:','room-code-ip:'];
  const state=await this.storage.get<{index:number;after?:string}>('room-janitor')??{index:0};
  const rows=await this.storage.list<{until?:number;at?:number}>({prefix:prefixes[state.index],limit:128,...(state.after?{startAfter:state.after}:{})});
  const expired=[...rows].filter(([,v])=>v.until!==undefined?v.until<Date.now():(v.at??0)+60000<Date.now()).map(([k])=>k);
  if(expired.length)await this.storage.delete(expired);
  await this.storage.put('room-janitor',rows.size===128?{index:state.index,after:[...rows.keys()].at(-1)}:{index:(state.index+1)%prefixes.length});
 }
 async remove(id:string){const r=await this.storage.get<RoomConfig>('room-record:'+id);await this.storage.delete('room-record:'+id);
  if(r?.code)await this.storage.put('room-code:'+r.code,{id:'closed',until:Date.now()+86400000});
 }
}
