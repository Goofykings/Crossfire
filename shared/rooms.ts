import { validMap, type MapId } from './maps';
export const ROOM_LIMITS = { playersMin:2, playersMax:10, defaultPlayers:6, active:100, owned:2,
  warnMs:60000, soloMs:90000, emptyMs:15000, afkWarnMs:30000, afkKickMs:45000, lobbyMs:300000, ticketMs:120000 } as const;
export interface RoomSetup { name:string; privacy:'public'|'private'; mapId:MapId; mode:'ffa'|'teams'; maxPlayers:number }
export interface RoomView extends RoomSetup { id:string; players:number; hostId:string|null; code?:string; warningAt:number|null; closesAt:number|null }
export interface RoomAdmission { v:number; room:RoomView; ticket:string }
export const roomId=(x:unknown):x is string=>typeof x==='string'&&(x==='public-main'||/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x));
export const roomCode=(x:unknown):x is string=>typeof x==='string'&&/^\d{6}$/.test(x);
export const roomName=(x:string):string=>x.normalize('NFKC').replace(/[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').replace(/\s+/g,' ').trim().slice(0,48);
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function validSetup(x:unknown):x is RoomSetup {
 return record(x)&&Object.keys(x).every(k=>['name','privacy','mapId','mode','maxPlayers'].includes(k))&&typeof x.name==='string'&&x.name===roomName(x.name)&&x.name.length>0
 &&['public','private'].includes(String(x.privacy))&&validMap(x.mapId)&&['ffa','teams'].includes(String(x.mode))&&Number.isInteger(x.maxPlayers)&&Number(x.maxPlayers)>=2&&Number(x.maxPlayers)<=10;
}
export function validRoomView(x:unknown):x is RoomView {
 if(!record(x))return false;const {id,players,hostId,code,warningAt,closesAt,...setup}=x;
 return validSetup(setup)&&roomId(id)&&Number.isInteger(players)&&Number(players)>=0&&Number(players)<=setup.maxPlayers
 &&(hostId===null||typeof hostId==='string'&&hostId.length<=64)&&(code===undefined||setup.privacy==='private'&&roomCode(code))
 &&[warningAt,closesAt].every(t=>t===null||Number.isSafeInteger(t)&&Number(t)>=0);
}
export function validAdmission(x:unknown,version:number):x is RoomAdmission {
 return record(x)&&Object.keys(x).every(k=>['v','room','ticket'].includes(k))&&x.v===version&&validRoomView(x.room)&&typeof x.ticket==='string'&&/^[a-f0-9]{64}$/.test(x.ticket);
}

/** Rejection sampling avoids modulo bias. The optional draw is for deterministic rule tests. */
export async function allocateRoomCode(available:(code:string)=>Promise<boolean>,draw=()=>crypto.getRandomValues(new Uint32Array(1))[0]):Promise<string|undefined>{
 for(let i=0;i<40;i++){const n=draw();if(n>=4294000000)continue;const code=String(n%1000000).padStart(6,'0');if(await available(code))return code;}
 return undefined;
}
