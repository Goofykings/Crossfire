import { STATISTICS_API_VERSION } from '../shared/statistics';
import {afterEach, expect, it, vi} from 'vitest';
import {CareerClient} from '../src/network/CareerClient';
import {careerView, createCareer} from '../shared/challenges';
import {PROTOCOL_VERSION} from '../shared/protocol';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const now=Date.UTC(2026,10,3,12),credential='a'.repeat(64),url='wss://example.test/ws';
const disk=()=>{const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};};
it('cancels a profile request before accepting or persisting data when entering Practice',async()=>{
 const storage=disk(),view=careerView(createCareer('id',now),now);let resolve!:(response:Response)=>void;
 const fetch=vi.fn((_url:RequestInfo|URL,_init?:RequestInit)=>new Promise<Response>(r=>resolve=r));vi.stubGlobal('fetch',fetch);const client=new CareerClient(url,storage),work=client.ensure();await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));const rejected=expect(work).rejects.toThrow();client.dispose();
 resolve(Response.json({v:PROTOCOL_VERSION,credential,profile:view}));await rejected;expect(client.view).toBeNull();expect(storage.getItem('crossfire.career.v1:https://example.test')).toBeNull();expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(true);
});
it('creates a server-owned wallet once and restores the credential without sending local balances',async()=>{
  const storage=disk(),view=careerView(createCareer('id',now),now);
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({v:PROTOCOL_VERSION,credential,profile:view})));vi.stubGlobal('fetch',fetch);
  const a=new CareerClient(url,storage);await a.ensure();expect(a.view?.gems).toBe(0);expect(a.joinCredential()).toBe(credential);
  expect(fetch.mock.calls[0][1]).toMatchObject({method:'POST'});expect(fetch.mock.calls[0][1].body).toBeUndefined();
  fetch.mockResolvedValue(new Response(JSON.stringify({v:PROTOCOL_VERSION,profile:view})));
  const b=new CareerClient(url,storage);await b.ensure();expect(fetch.mock.calls[1][1]).toMatchObject({method:'GET',headers:{Authorization:`Bearer ${credential}`}});
  expect(b.view?.daily).toEqual(view.daily);
});
it('coalesces overlapping requests and keeps an invalid credential rather than silently rerolling',async()=>{
  const storage=disk();storage.setItem('crossfire.career.v1:https://example.test',credential);
  const fetch=vi.fn().mockResolvedValue(new Response('{}',{status:401}));vi.stubGlobal('fetch',fetch);
  const client=new CareerClient(url,storage),a=client.ensure(),b=client.ensure();expect(a).toBe(b);
  await expect(a).rejects.toThrow('cannot be recovered');expect(fetch).toHaveBeenCalledTimes(1);expect(client.joinCredential()).toBeUndefined();expect(client.view).toBeNull();
  expect(storage.getItem('crossfire.career.v1:https://example.test')).toBe(credential);
});
it('allows temporary guest play when localStorage is blocked',async()=>{
  const view=careerView(createCareer('id',now),now);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({v:PROTOCOL_VERSION,credential,profile:view}))));
  const client=new CareerClient(url,{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});
  await client.ensure();expect(client.temporary).toBe(true);expect(client.joinCredential()).toBe(credential);expect(client.view?.gems).toBe(0);
});
it('uses a monotonic server anchor and rejects stale state, invalid schemas and incompatible versions',async()=>{
  const view=careerView(createCareer('id',now),now),client=new CareerClient(url,null);
  client.accept(view);vi.spyOn(Date,'now').mockReturnValue(now+999999999);expect(client.serverNow! - now).toBeLessThan(1000);
  client.accept({...view,revision:1,gems:100,serverTime:now+10});client.accept(view);expect(client.view?.gems).toBe(100);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({v:PROTOCOL_VERSION-1,credential,profile:view}))));
  await expect(client.ensure()).rejects.toThrow('protocol differs');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({v:PROTOCOL_VERSION,credential,profile:{...view,gems:-1}}))));
  await expect(client.ensure()).rejects.toThrow('Invalid challenge response');
});

it('reads versioned rankings and personal totals using the private credential header, rejects wrong selections',async()=>{
 const view=careerView(createCareer('id',now),now),client=new CareerClient(url,disk());
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({v:PROTOCOL_VERSION,credential,profile:view})));vi.stubGlobal('fetch',fetch);await client.ensure();
 const board={version:STATISTICS_API_VERSION,period:'all',metric:'kills',start:0,serverTime:now,rows:[],own:null};
 const personal={version:STATISTICS_API_VERSION,serverTime:now,totals:{assists:0,kills:0,deaths:0,points:0,wins:0,games:0,gems:0}};
 fetch.mockImplementation((url:URL)=>Promise.resolve(Response.json(url.pathname==='/leaderboard'?board:personal)));
 const controller=new AbortController();expect((await client.statistics('all','kills',controller.signal)).personal).toEqual(personal);
 for(const [endpoint,options]of fetch.mock.calls.slice(1)){
  expect(String(endpoint)).not.toContain(credential);expect(options.headers.Authorization).toBe(`Bearer ${credential}`);expect(options.signal).toBe(controller.signal);
 }
 await expect(client.statistics('daily','kills',controller.signal)).rejects.toThrow('incompatible');
});

it('keeps public rankings available when a stored profile is unavailable, without inventing personal stats',async()=>{
 const client=new CareerClient(url,null);
 const board={version:STATISTICS_API_VERSION,period:'all',metric:'kills',start:0,serverTime:now,rows:[],own:null};
 const fetch=vi.fn().mockImplementation((input:URL|string)=>Promise.resolve(String(input).includes('/leaderboard')?Response.json(board):new Response('{}',{status:503})));
 vi.stubGlobal('fetch',fetch);
 const result=await client.statistics('all','kills',new AbortController().signal);
 expect(result.board).toEqual(board);expect(result.personal).toBeNull();
 expect(fetch.mock.calls.some(([u])=>String(u).includes('/stats'))).toBe(false);
});
