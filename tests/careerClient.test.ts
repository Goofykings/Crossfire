import {afterEach, expect, it, vi} from 'vitest';
import {CareerClient} from '../src/network/CareerClient';
import {careerView, createCareer} from '../shared/challenges';
import {PROTOCOL_VERSION} from '../shared/protocol';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const now=Date.UTC(2026,10,3,12),credential='a'.repeat(64),url='wss://example.test/ws';
const disk=()=>{const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};};
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
