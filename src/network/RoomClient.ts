import { PROTOCOL_VERSION } from '../../shared/protocol';
import { validAdmission, validRoomView, type RoomAdmission, type RoomSetup, type RoomView } from '../../shared/rooms';
import { presenceEndpoint, multiplayerEndpoint } from './endpoint';
/** HTTP discovery never opens gameplay sockets. Capability stays in the Authorization header. */
export class RoomClient {
 constructor(private url:string,private credential:()=>Promise<string>){}
 private async request(path:string,signal:AbortSignal,body?:unknown):Promise<unknown>{
  const url=presenceEndpoint(this.url);url.pathname=path;
  const combined=AbortSignal.any([signal,AbortSignal.timeout(10000)]);
  const credential=body?await this.credential():null;combined.throwIfAborted();
  const response=await fetch(url,{signal:combined,cache:'no-store',...(body?{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({v:PROTOCOL_VERSION,...body})}:{})});
  const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error??'Room service unavailable. Please retry.');return data;
 }
 async list(signal:AbortSignal):Promise<RoomView[]>{const data=await this.request('/rooms',signal) as {v:number;rooms:unknown[]};
  if(data.v!==PROTOCOL_VERSION||!Array.isArray(data.rooms)||data.rooms.length>101||!data.rooms.every(r=>validRoomView(r)&&r.privacy==='public'&&!('code' in r)))throw Error('Incompatible room directory. Refresh after the server update.');return data.rooms as RoomView[];
 }
 async join(value:{roomId:string}|{code:string},signal:AbortSignal):Promise<RoomAdmission>{const data=await this.request('/rooms/join',signal,value);if(!validAdmission(data,PROTOCOL_VERSION))throw Error('Invalid room authorization.');return data;}
 async create(value:RoomSetup,signal:AbortSignal):Promise<RoomAdmission>{const data=await this.request('/rooms',signal,value);if(!validAdmission(data,PROTOCOL_VERSION))throw Error('Invalid room configuration response.');return data;}
 socket(room:string):string {const url=multiplayerEndpoint(this.url);if(room!=='public-main')url.pathname='/ws/rooms/'+room;return url.href;}
}
