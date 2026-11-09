import { PROTOCOL_VERSION } from '../../shared/protocol';
import { validAdmission, validRoomView, type RoomAdmission, type RoomSetup, type RoomView } from '../../shared/rooms';
import { presenceEndpoint, multiplayerEndpoint } from './endpoint';
class RoomUnavailable extends Error {}
/** HTTP discovery never opens gameplay sockets. Capability stays in the Authorization header. */
export class RoomClient {
 constructor(private url:string,private credential:()=>Promise<string>){}
 private async request(path:string,signal:AbortSignal,body?:unknown):Promise<unknown>{
  const url=presenceEndpoint(this.url);url.pathname=path;
  const combined=AbortSignal.any([signal,AbortSignal.timeout(10000)]);
  const credential=body?await this.credential():null;combined.throwIfAborted();
  const response=await fetch(url,{signal:combined,cache:'no-store',...(body?{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({v:PROTOCOL_VERSION,...body})}:{})});
  if(!response.ok){const data=await response.json().catch(()=>null) as {error?:string}|null;const ErrorType=[429,500,502,503,504].includes(response.status)?RoomUnavailable:Error;throw new ErrorType(data?.error??`Room service unavailable (${response.status}). Please retry.`);}
  return response.json();
 }
 async list(signal:AbortSignal):Promise<RoomView[]>{
  // Discovery alone is safe to retry. Never replay room creation/admission.
  let data:{v:number;rooms:unknown[]}|undefined;
  for(let attempt=0;attempt<3;attempt++){
   signal.throwIfAborted();
   try{data=await this.request('/rooms',signal) as typeof data;break;}
   catch(error){if(signal.aborted)throw error;
    if(attempt===2||!(error instanceof TypeError||error instanceof DOMException&&error.name==='TimeoutError'||error instanceof RoomUnavailable))throw error;
    await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},300*2**attempt+Math.random()*150);signal.addEventListener('abort',abort,{once:true});});
   }
  }
  if(!data)throw Error('Room service unavailable.');
  if(data.v!==PROTOCOL_VERSION||!Array.isArray(data.rooms)||data.rooms.length>101||!data.rooms.every(r=>validRoomView(r)&&r.privacy==='public'&&!('code' in r)))throw Error('Incompatible room directory. Refresh after the server update.');return data.rooms as RoomView[];
 }
 async join(value:{roomId:string}|{code:string},signal:AbortSignal):Promise<RoomAdmission>{const data=await this.request('/rooms/join',signal,value);if(!validAdmission(data,PROTOCOL_VERSION))throw Error('Invalid room authorization.');return data;}
 async create(value:RoomSetup,signal:AbortSignal):Promise<RoomAdmission>{const data=await this.request('/rooms',signal,value);if(!validAdmission(data,PROTOCOL_VERSION))throw Error('Invalid room configuration response.');return data;}
 socket(room:string):string {const url=multiplayerEndpoint(this.url);if(room!=='public-main')url.pathname='/ws/rooms/'+room;return url.href;}
}
