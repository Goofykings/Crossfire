import {afterEach,expect,it,vi} from 'vitest';
import {ROOM_LIMITS,allocateRoomCode,roomCode,roomName,validSetup,validRoomView,validAdmission} from '../shared/rooms';
import {parseClientMessage,parseServerMessage,PROTOCOL_VERSION as v} from '../shared/protocol';
import {Presence} from '../src/network/Presence';
import {RoomClient} from '../src/network/RoomClient';
const id='12345678-1234-4123-8123-123456789abc',ticket='a'.repeat(64),credential='b'.repeat(64);
const setup={name:'Guest Server',privacy:'public' as const,mapId:'european-town' as const,mode:'ffa' as const,maxPlayers:6};
const room={...setup,id,players:0,hostId:null,warningAt:60000,closesAt:90000};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('accepts all three maps, FFA/Teams and integer capacities 2-10; rejects injected gameplay or ownership',()=>{
 for(const mapId of ['european-town','industrial-complex','modern-city'])for(const mode of ['ffa','teams'])for(const maxPlayers of [2,6,10])expect(validSetup({...setup,mapId,mode,maxPlayers})).toBe(true);
 for(const invalid of [{maxPlayers:1},{maxPlayers:11},{maxPlayers:2.5},{mode:'powerups'},{mapId:'secret'},{hostId:'fake'},{name:''},{name:' <x>'}])expect(validSetup({...setup,...invalid})).toBe(false);
 expect(ROOM_LIMITS).toMatchObject({warnMs:60000,soloMs:90000,afkWarnMs:30000,afkKickMs:45000});
});
it('preserves leading zeros, sanitizes names and strictly validates discovery and capabilities',()=>{
 expect(roomCode('012345')).toBe(true);for(const code of [123456,'12345','1234567',' 123456','123e45'])expect(roomCode(code)).toBe(false);
 expect(roomName('  <Player>\u202e\n Server  ')).toBe('Player Server');expect(roomName('x'.repeat(99))).toHaveLength(48);
 expect(validRoomView(room)).toBe(true);expect(validRoomView({...room,players:7})).toBe(false);expect(validRoomView({...room,code:'012345'})).toBe(false);
 expect(validAdmission({v,room,ticket},v)).toBe(true);expect(validAdmission({v:v-1,room,ticket},v)).toBe(false);
});
it('protocol authorizes joins only through bounded tickets and accepts explicit room exit reasons',()=>{
 const join={v,type:'join',name:'Guest',profileToken:credential,roomTicket:ticket};expect(parseClientMessage(JSON.stringify(join))).toEqual(join);
 for(const extra of [{roomTicket:'123456'},{roomId:id},{host:true}])expect(parseClientMessage(JSON.stringify({...join,...extra}))).toBeNull();
 const exit={v,type:'room_exit',reason:'afk',message:'Removed for inactivity.'};expect(parseServerMessage(JSON.stringify(exit))).toEqual(exit);expect(parseServerMessage(JSON.stringify({...exit,reason:'arbitrary'}))).toBeNull();
});
it('discovers without credentials or gameplay sockets and uses base-independent configured backend URLs',async()=>{
 const fetch=vi.fn().mockResolvedValue(Response.json({v,rooms:[room]}));vi.stubGlobal('fetch',fetch);const auth=vi.fn(async()=>credential),client=new RoomClient('wss://backend.example/ws',auth);
 expect(await client.list(new AbortController().signal)).toEqual([room]);expect(auth).not.toHaveBeenCalled();expect(String(fetch.mock.calls[0][0])).toBe('https://backend.example/rooms');expect(client.socket(id)).toBe('wss://backend.example/ws/rooms/'+id);expect(client.socket('public-main')).toBe('wss://backend.example/ws');
});
it('cancels room admission while its credential is pending without starting a late request',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);let complete!:(token:string)=>void;
 const client=new RoomClient('wss://backend.example/ws',()=>new Promise<string>(resolve=>complete=resolve)),controller=new AbortController(),work=client.join({roomId:id},controller.signal);
 controller.abort();complete(credential);await expect(work).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
it('sends private codes unchanged and capability in header, validates replies and surfaces friendly errors',async()=>{
 const privateRoom={...room,privacy:'private',code:'012345'},fetch=vi.fn().mockResolvedValue(Response.json({v,room:privateRoom,ticket}));vi.stubGlobal('fetch',fetch);const client=new RoomClient('ws://localhost:8787/ws',async()=>credential),signal=new AbortController().signal;
 await client.join({code:'012345'},signal);const [url,options]=fetch.mock.calls[0];expect(String(url)).toBe('http://localhost:8787/rooms/join');expect(String(url)).not.toContain(credential);expect(options.headers.Authorization).toBe('Bearer '+credential);expect(JSON.parse(options.body)).toEqual({v,code:'012345'});
 fetch.mockResolvedValue(Response.json({error:'This room is full.'},{status:409}));await expect(client.join({roomId:id},signal)).rejects.toThrow('full');
 fetch.mockResolvedValue(Response.json({v,rooms:[privateRoom]}));await expect(client.list(signal)).rejects.toThrow('Incompatible');
 fetch.mockResolvedValue(Response.json({v:v-1,room,ticket}));await expect(client.create(setup,signal)).rejects.toThrow('Invalid');
});
it('cancels requests on navigation and bounds stalled directory requests',async()=>{
 vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason));})));const controller=new AbortController(),client=new RoomClient('ws://localhost/ws',async()=>credential);const pending=client.list(controller.signal);controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
});

it('allocates six-digit codes with leading zeros, retries collisions and rejects biased samples',async()=>{
 const samples=[4294967295,12345,12345,654321],available=vi.fn(async(code:string)=>code!=='012345');
 expect(await allocateRoomCode(available,()=>samples.shift()!)).toBe('654321');expect(available.mock.calls.map(c=>c[0])).toEqual(['012345','012345','654321']);
 expect(await allocateRoomCode(async()=>true,()=>0)).toBe('000000');expect(await allocateRoomCode(async()=>false,()=>1)).toBeUndefined();
});

it('home presence accepts actual multi-room totals above the old single-room ceiling, with a bounded aggregate',async()=>{
 vi.stubGlobal('window',globalThis);vi.stubGlobal('document',{hidden:false});const fetch=vi.fn().mockResolvedValue(Response.json({room:'public-main',online:17}));vi.stubGlobal('fetch',fetch);const update=vi.fn(),presence=new Presence('wss://backend.example/ws',update,()=>true);
 await presence.poll();expect(update).toHaveBeenLastCalledWith(17);fetch.mockResolvedValue(Response.json({room:'public-main',online:1011}));await presence.poll();expect(update).toHaveBeenLastCalledWith(null);
});
