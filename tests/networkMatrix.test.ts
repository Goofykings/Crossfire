/** Deterministic transport fixture, not a claim of operational multiplayer.
 * Actual TCP/workerd validation lives in server/tests/responsiveness.mjs. */
import { afterEach, expect, it, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { MultiplayerClient } from '../src/network/MultiplayerClient';
import { PlayerController, NO_INTENT } from '../src/player/PlayerController';
import { Weapon, WEAPONS } from '../src/weapons/Weapon';
import { FIXED_DT } from '../src/config/constants';
import { simulationSteps, simulationAlpha } from '../src/core/simulationBudget';
import { WORLDS } from '../server/src/world';
import { PROTOCOL_VERSION, parseClientMessage, type ClientMessage, type InputFrame, type PlayerState, type Snapshot } from '../shared/protocol';
import { encodeServerMessage } from '../shared/snapshotWire';
import { createMeleeState } from '../shared/melee';
import { MovementHold } from '../shared/movementHold';

class FixtureSocket {
  static OPEN=1;static current:FixtureSocket;
  readyState=1;bufferedAmount=0;
  onopen:(()=>void)|null=null;onclose:((e:unknown)=>void)|null=null;
  onmessage:((e:{data:string})=>void)|null=null;onerror:(()=>void)|null=null;
  outgoing:ClientMessage[]=[];
  constructor(){FixtureSocket.current=this;}
  send(raw:string){const m=parseClientMessage(raw);if(!m)throw Error('Invalid client wire');this.outgoing.push(m);}
  close(){this.readyState=3;}
  receive(data:string){this.onmessage?.({data});}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

async function run(fps:number|'variable',rtt:number,stall:number,legacy=false){
  vi.useFakeTimers();vi.setSystemTime(1000000);vi.stubGlobal('window',globalThis);vi.stubGlobal('WebSocket',FixtureSocket);
  const world=WORLDS['industrial-complex'].world;
  const make=()=>{const p=new PlayerController(world);p.weaponClearance='rifle';p.teleport({x:7,y:0,z:-5},90);return p;};
  const authority=make(),local=make();
  const held=new MovementHold();
  const player:PlayerState={id:'matrix-fixture',name:'Fixture',motion:authority.capture(),ack:0,life:1,alive:true,health:100,
    weapon:'rifle',grenades:1,score:0,comboCount:0,comboUntil:null,lastPlayedRound:0,lastPlayedTeam:null,
    kills:0,deaths:0,team:null,death:null,combat:{gun:new Weapon(WEAPONS[0]).capture(),melee:createMeleeState(),
      triggerHeld:false,reloadHeld:false,aimHeld:false,grenadeHeld:false}};
  const snap=():Snapshot=>({serverTime:Date.now(),room:'public-main',mapId:'industrial-complex',roundId:0,mapVersion:'matrix',
    match:{mode:'ffa',endsAt:1600000,teamScores:null},result:null,grenades:[],explosions:[],players:[{...player,motion:authority.capture()}]});
  const client=new MultiplayerClient('ws://127.0.0.1:8787/ws','Fixture',{diagnostics:true});
  const ready=client.connect(),socket=FixtureSocket.current;socket.onopen?.();
  socket.receive(JSON.stringify({v:PROTOCOL_VERSION,type:'welcome',selfId:player.id,resumeToken:'b'.repeat(64),resumed:false,snapshot:snap()}));await ready;
  let pending:Snapshot|null=null;client.onSnapshot=s=>{pending=s;};
  const upstream:{at:number;frames:InputFrame[]}[]=[],downstream:{at:number;wire:string}[]=[],queue:InputFrame[]=[];
  let tickDebt=0,frameDebt=0,frame=0,lastFrame=0,nextFrame=0,lastDelivery=0,lastUpstream=0,packet=0,jumped=false,stood=false;
  let maxPending=0,maxWork=0,peakCorrection=0,reconciliations=0,heldTicks=0;
  const corrections:unknown[]=[];
  const trace:unknown[]=[];
  const gaps=[-7,4,11,-3];
  try{
    for(let time=0;time<4500;time++){
      vi.advanceTimersByTime(1);
      const blocked=time>=700&&time<700+stall;
      // Outgoing fixtures pass through the real protocol decoder before scheduling.
      for(const m of socket.outgoing.splice(0))if(m.type==='input'){
        lastUpstream=Math.max(lastUpstream+.01,time+rtt/2+gaps[packet++%4]+8);
        upstream.push({at:lastUpstream,frames:m.frames});
      }else if(m.type==='ping'){
        downstream.push({at:time+rtt,wire:JSON.stringify({v:PROTOCOL_VERSION,type:'pong',at:m.at,serverTime:Date.now()+rtt/2})});
      }
      while(upstream[0]?.at<=time){const m=upstream.shift()!;queue.push(...m.frames);}
      tickDebt+=.001;
      while(tickDebt+1e-10>=FIXED_DT){
        const f=queue.shift();if(f){authority.yaw=f.yaw;authority.pitch=f.pitch;player.ack=f.seq;heldTicks=0;}else heldTicks++;
        authority.fixedUpdate(FIXED_DT,legacy?f?.intent??NO_INTENT:held.sample(f?.intent,Date.now()));tickDebt-=FIXED_DT;
        if(authority.grounded&&Math.abs(authority.position.y-1)<.001)stood=true;
      }
      if(time%50===0){
        if(rtt===120&&fps===60)trace.push({time,auth:{...authority.position},local:{...local.position},ack:player.ack,queue:queue.length,pending:client.inspect().pending,debt:frameDebt,jumped});
        const snapshot=snap();
        if(legacy){
          // Historical four-decimal checkpoint bug, intentionally confined to this fixture.
          const motion=snapshot.players[0].motion;
          snapshot.players[0].motion=JSON.parse(JSON.stringify(motion,(_key,v)=>typeof v==='number'&&!Number.isInteger(v)?Math.round(v*10000)/10000:v));
        }
        const at=Math.max(lastDelivery+.01,time+rtt/2+gaps[packet++%4]+8);lastDelivery=at;
        downstream.push({at,wire:encodeServerMessage({v:PROTOCOL_VERSION,type:'snapshot',snapshot},true)});
      }
      if(!blocked){
        downstream.sort((a,b)=>a.at-b.at);
        while(downstream[0]?.at<=time)socket.receive(downstream.shift()!.wire);
        if(time>=nextFrame){
          if(pending){const before={...local.position},yaw=local.yaw,pitch=local.pitch,at=pending.serverTime,ack=pending.players[0].ack;client.reconcile(local,pending);pending=null;
            expect(local.yaw).toBe(yaw);expect(local.pitch).toBe(pitch);
            const correction=Math.hypot(local.position.x-before.x,local.position.y-before.y,local.position.z-before.z);
            peakCorrection=Math.max(peakCorrection,correction);if(correction>.0001){reconciliations++;corrections.push({time,metres:correction,ack,snapshotAgeMs:Date.now()-at,
              pending:client.inspect().pending,heldTicks,from:before,to:{...local.position},
              // Cause evidence, not a claim that every collision can be inferred
              // from positional magnitude. Unknown cases remain explicit.
              classification:heldTicks?'authority advanced without new input':'unknown authoritative replay'});}}
          const elapsed=(time-lastFrame)/1000;lastFrame=time;frameDebt+=elapsed;
          const yaw=local.yaw;local.yaw+=.00001; // live mouse input is never replaced by reconciliation
          local.yaw=yaw;local.pitch=0;
          const due=simulationSteps(frameDebt);let work=0;
          for(let i=0;i<due;i++){
            if(!client.canPredict)break;
            // Stop sampling new movement after 2.5 s so all admitted input can settle/drain.
            const jump=!jumped&&local.position.x>9&&local.grounded&&time<2500;
            if(jump)jumped=true;
            const intent={...NO_INTENT,z:time<2500&&local.position.x<10.8?1:0,jumpPressed:jump};
            local.fixedUpdate(FIXED_DT,intent);client.fixedInput(local,intent);frameDebt-=FIXED_DT;work++;
          }
          maxWork=Math.max(maxWork,work);maxPending=Math.max(maxPending,client.inspect().pending);
          expect(simulationAlpha(frameDebt)).toBeLessThanOrEqual(1);
          nextFrame=time+(fps==='variable'?[16,25,34,50][frame++%4]:1000/fps);
        }
      }
    }
    if(pending)client.reconcile(local,pending);
    const distance=Math.hypot(local.position.x-authority.position.x,local.position.y-authority.position.y,local.position.z-authority.position.z);
    expect(maxWork).toBeLessThanOrEqual(12);expect(maxPending).toBeLessThanOrEqual(48);
    expect(distance).toBeLessThan(.02);expect(client.state).toBe('connected');expect(player.health).toBe(100);expect(player.life).toBe(1);
    if(!legacy&&!stood&&fps===60){mkdirSync('test-results',{recursive:true});writeFileSync('test-results/network-matrix-failure.json',JSON.stringify(trace,null,2));}
    if(!legacy)expect(stood,JSON.stringify({fps,rtt,stall,legacy,end:authority.position})).toBe(true);
    const diagnostics=client.diagnosticReport().telemetry;
    return {fps,rtt,stall,legacy,landed:stood,maxWork,maxPending,peakCorrection,reconciliations,corrections,finalDistance:distance,
      appRtt:diagnostics.enabled?diagnostics.metrics.rttMs:null,rttJitter:diagnostics.enabled?diagnostics.metrics.rttJitterMs:null};
  }finally{client.disconnect();vi.useRealTimers();vi.unstubAllGlobals();}
}

const reports:Awaited<ReturnType<typeof run>>[]=[];
for(const fps of [60,40,30,20,'variable'] as const)for(const rtt of [40,80,120]){
  const stall=[100,200,300][[40,80,120].indexOf(rtt)];
  it(`${fps} FPS, ${rtt} ms RTT, jitter, burst delivery and ${stall} ms stall converge at the Industrial dock`,async()=>{
    const before=await run(fps,rtt,stall,true),after=await run(fps,rtt,stall);
    reports.push(before,after);
    if(reports.length===30){mkdirSync('test-results',{recursive:true});writeFileSync('test-results/network-matrix.json',JSON.stringify(reports,null,2));}
  },30000);
}
