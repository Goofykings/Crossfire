import { testRoom } from './test-rpc.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import WebSocket from 'ws';
import {PROTOCOL_VERSION as v} from '../../tools/protocol-version.mjs';
export const origin='http://localhost:5173';
export async function until(fn,label,ms=8000){const end=Date.now()+ms;while(Date.now()<end){const x=await fn();if(x)return x;await delay(10);}throw Error('Room timeout: '+label);}
export async function harness(t,bindings={}){
 const options=convertV4MiniflareOptions({name:'rooms-test',modules:[{type:'ESModule',path:fileURLToPath(new URL('runtime-fixture.mjs',import.meta.url))},{type:'ESModule',path:fileURLToPath(new URL('../dist/index.js',import.meta.url))}],
 compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,resourcePersistencePath:fs.mkdtempSync(fileURLToPath(new URL('../.wrangler/rooms-',import.meta.url))),durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:origin,MATCH_MODE:'ffa',...bindings},log:new Log(LogLevel.ERROR)});
 let mf=new Miniflare(options);
 let base=(await mf.ready).href;const clients=[],stubs=[];
 const room=id=>{const r=testRoom(mf, id==='public-main'?id:'room:'+id);stubs.push(r);return r;};
 let central=room('public-main');
 async function restart(){for(const c of clients){clearInterval(c.timer);if(c.ws.readyState===1){c.ws.close();await until(()=>c.ws.readyState===3,'transport close');}}for(const r of stubs)r[Symbol.dispose]?.();stubs.length=0;await mf.dispose();mf=new Miniflare(options);base=(await mf.ready).href;central=room('public-main');}
 t.after(async()=>{for(const c of clients){clearInterval(c.timer);c.ws.terminate();}for(const r of stubs)r[Symbol.dispose]?.();await mf.dispose();});
 async function api(path,token,body){const response=await fetch(new URL(path,base),{headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify({v,...body})}:{})});return {status:response.status,data:await response.json()};}
 async function profile(){const r=await fetch(new URL('/profile',base),{method:'POST',headers:{Origin:origin}});assert.equal(r.status,201);return(await r.json()).credential;}
 async function create(token,changes={}){const r=await api('/rooms',token,{name:'Real room',privacy:'public',mapId:'european-town',mode:'ffa',maxPlayers:6,...changes});assert.equal(r.status,200,JSON.stringify(r));return r.data;}
 async function admission(token,value){const r=await api('/rooms/join',token,value);assert.equal(r.status,200,JSON.stringify(r));return r.data;}
 async function open(ad,credential,changes={}){
  const ws=new WebSocket(new URL(ad.room.id==='public-main'?'/ws':'/ws/rooms/'+ad.room.id,base).href.replace('http:','ws:'),{origin}),c={ws,messages:[],seq:0,credential,ad};clients.push(c);
  ws.on('message',raw=>{const m=JSON.parse(String(raw));c.messages.push(m);if(m.snapshot)c.snapshot=m.snapshot;});ws.on('error',()=>{});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  c.send=m=>ws.send(JSON.stringify({v,...m}));c.send({type:'join',name:'Room player '+clients.length,profileToken:credential,roomTicket:ad.ticket,...changes});
  const w=await until(()=>c.messages.find(m=>m.type==='welcome'||m.type==='error'),'welcome or rejection');c.welcome=w;
  if(w.type==='welcome'){c.id=w.selfId;c.token=w.resumeToken;c.seq=self(c).ack;c.timer=setInterval(()=>{if(ws.readyState===1)c.send({type:'ping',at:Date.now()});},500);ws.once('close',()=>clearInterval(c.timer));}
  return c;
 }
 async function spawn(c,weapon='rifle'){const requestId=crypto.randomUUID();c.send({type:'spawn',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,weapon,requestId});await until(()=>c.messages.find(m=>m.type==='spawned'&&m.requestId===requestId),'spawn');assert.equal(self(c).health,100);}
 async function leave(c){if(c.ws.readyState===1){c.send({type:'leave'});await until(()=>c.ws.readyState===3,'intentional leave');}}
 return {get mf(){return mf;},get base(){return base;},get central(){return central;},room,api,profile,create,admission,open,spawn,leave,clients,restart};
}
export const self=c=>c.snapshot?.players.find(p=>p.id===c.id);
// Inputs carry yaw in [-pi, pi], wrapped as the frontend sends it; a spawn heading past 180 degrees
// leaves the server's own yaw below -pi.
export const wrapYaw=a=>Math.atan2(Math.sin(a),Math.cos(a));
export function frames(c,{yaw=wrapYaw(self(c).motion.yaw),pitch=0,x=0,z=0,reload=false,trigger=false,grenade=false,melee=false,aim=false,viewTime}={}){c.send({type:'input',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,frames:Array.from({length:6},(_,k)=>({...(viewTime===undefined?{}:{viewTime}),seq:++c.seq,yaw,pitch,intent:{x,z,slide:false,aim,jumpPressed:false},combat:{trigger:trigger&&k===0,reload,grenade,melee:melee&&k===0}}))});return c.seq;}
export async function ack(c,seq=c.seq){return until(()=>self(c)?.ack>=seq,'movement acknowledgment');}
export async function aim(c,target){const p=c.position,q=target.position,dx=q[0]-p[0],dz=q[2]-p[2];const look={yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(q[1]+.9-p[1]-1.64,Math.hypot(dx,dz)),aim:true};for(let i=0;i<13;i++){frames(c,look);await delay(50);}await ack(c);return look;}
