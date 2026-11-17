/** Protocol-validated unit transport; real TCP peers are covered separately. */
import {afterEach,expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {MultiplayerClient} from '../src/network/MultiplayerClient';
import {PlayerController,NO_INTENT} from '../src/player/PlayerController';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {Weapon,WEAPONS} from '../src/weapons/Weapon';
import {PROTOCOL_VERSION,parseClientMessage,type InputFrame,type PlayerState,type Snapshot} from '../shared/protocol';
class Wire {
 static OPEN=1;static current:Wire;readyState=1;bufferedAmount=0;frames:InputFrame[]=[];bytes=0;
 onopen:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;
 constructor(){Wire.current=this;}
 send(raw:string){const m=parseClientMessage(raw);if(!m)throw Error('Invalid wire');if(m.type==='input'){this.frames.push(...m.frames);this.bytes+=new TextEncoder().encode(raw).byteLength;}}
 close(){}receive(m:unknown){this.onmessage?.({data:JSON.stringify(m)});}
}
let client:MultiplayerClient;
afterEach(()=>{client?.disconnect();vi.useRealTimers();vi.unstubAllGlobals();});
it('sends idle camera turns at snapshot cadence, preserves local look and immediately sends action edges',async()=>{
 vi.useFakeTimers();vi.stubGlobal('window',globalThis);vi.stubGlobal('WebSocket',Wire);
 const p=new PlayerController(new CollisionWorld());p.grounded=true;
 const self:PlayerState={id:'look-unit',name:'Fixture',motion:p.capture(),ack:0,life:1,alive:true,health:100,weapon:'rifle',grenades:1,score:0,comboCount:0,comboUntil:null,lastPlayedRound:0,lastPlayedTeam:null,kills:0,deaths:0,team:null,death:null,combat:{gun:new Weapon(WEAPONS[0]).capture(),triggerHeld:false,reloadHeld:false,aimHeld:false,grenadeHeld:false}};
 const snapshot=():Snapshot=>({serverTime:Date.now(),room:'public-main',mapId:'european-town',roundId:0,mapVersion:'fixture',match:{mode:'ffa',endsAt:Date.now()+600000,teamScores:null},result:null,grenades:[],explosions:[],players:[{...self,motion:p.capture()}]});
 client=new MultiplayerClient('ws://127.0.0.1:8787/ws');const ready=client.connect(),wire=Wire.current;wire.onopen?.();wire.receive({v:PROTOCOL_VERSION,type:'welcome',selfId:self.id,resumeToken:'a'.repeat(64),resumed:false,snapshot:snapshot()});await ready;
 const reference=process.env.NETWORK_IDLE_LOOK_BASELINE==='1',start=Date.now();
 for(let i=0;i<120;i++){
  // Historical control: restore the original unthrottled idle-look path only
  // inside this labelled unit fixture. Production never exposes this switch.
  if(reference)(client as unknown as {lastLookSampleAt:number}).lastLookSampleAt=-Infinity;
  p.yaw+=.001;client.fixedInput(p,NO_INTENT);vi.advanceTimersByTime(Math.round((i+1)*1000/120)-Math.round(i*1000/120));
  self.ack=wire.frames.at(-1)?.seq??0;wire.receive({v:PROTOCOL_VERSION,type:'snapshot',snapshot:snapshot()});
 }
 mkdirSync('test-results',{recursive:true});writeFileSync(`test-results/idle-look-${process.env.NETWORK_AUDIT_LABEL??'latest'}.json`,JSON.stringify({reference,simulatedSeconds:(Date.now()-start)/1000,frames:wire.frames.length,inputBytes:wire.bytes,localYaw:p.yaw}));
 expect(wire.frames.length).toBeLessThanOrEqual(reference?120:22);expect(wire.frames.length).toBeGreaterThanOrEqual(reference?110:18);expect(p.yaw).toBeCloseTo(.12);
 const before=wire.frames.length;client.fixedInput(p,{...NO_INTENT,z:1});vi.advanceTimersByTime(1);expect(wire.frames.length).toBe(before+1);
 client.fixedInput(p,NO_INTENT);vi.advanceTimersByTime(1);const released=wire.frames.length;
 p.yaw=.75;client.fixedInput(p,NO_INTENT,{trigger:true,reload:false});vi.advanceTimersByTime(1);
 expect(wire.frames.length).toBe(released+1);expect(wire.frames.at(-1)).toMatchObject({yaw:.75,combat:{trigger:true}});
});
