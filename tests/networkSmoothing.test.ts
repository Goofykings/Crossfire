import {expect,it} from 'vitest';
import {NetworkTiming} from '../src/network/NetworkTiming';
import {extrapolatedPosition} from '../src/network/remoteMotion';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerController} from '../src/player/PlayerController';
import {MotionHistory,shotViewTime} from '../shared/lagCompensation';
import {rayPlayer} from '../shared/combat';

it('a queued pong does not shift the clock and playback never reverses',()=>{
 const t=new NetworkTiming();t.reset(100000,95000);
 t.probe(95000,100040,95080);expect(t.offset).toBe(5000);
 t.probe(97000,102040,97500);expect(t.offset).toBe(5000);
 let last=t.time(98000);
 for(let local=98016;local<99000;local+=16){t.offset-=.2;const next=t.time(local);expect(next).toBeGreaterThanOrEqual(last);expect(next-last).toBeLessThanOrEqual(18);last=next;}
});
it('healthy links reduce the buffer, jitter adds bounded padding without rewinding',()=>{
 const t=new NetworkTiming();t.reset(10000,10000);
 for(let i=0;i<100;i++)t.snapshot(10000+i*50,10000+i*50);
 expect(t.delay).toBeLessThan(75);
 for(let i=100;i<140;i++)t.snapshot(10000+i*50,10000+i*50+(i%2?70:0));
 expect(t.delay).toBeGreaterThan(100);expect(t.delay).toBeLessThanOrEqual(160);
});
it('snapshot gaps use bounded velocity prediction and never cross a solid wall',()=>{
 const world=new CollisionWorld(),p=new PlayerController(world);p.teleport({x:0,y:0,z:0});
 const m=p.capture();m.grounded=true;m.velocity={x:6,y:0,z:0};
 expect(extrapolatedPosition(m,50,null).x).toBeCloseTo(.3);
 expect(extrapolatedPosition(m,5000,null).x).toBeCloseTo(.6);
 world.add({c:[.8,1,0],h:[.1,1,2]});
 expect(extrapolatedPosition(m,100,world).x).toBeLessThan(.37);
});
it('historical hits test the displayed body, clamp time claims and never mix lives or maps',()=>{
 const p=new PlayerController(new CollisionWorld()),history=new MotionHistory();p.teleport({x:0,y:0,z:-5});
 const old=p.capture();history.record(1000,1,1,old);p.position.x=1.2;history.record(1100,1,1,p.capture());
 const displayed=history.sample(1000,1,1)!;
 expect(rayPlayer({x:0,y:1,z:0},{x:0,y:0,z:-1},displayed)).not.toBeNull();
 expect(rayPlayer({x:0,y:1,z:0},{x:0,y:0,z:-1},p.capture())).toBeNull();
 expect(history.sample(1050,1,1)?.position.x).toBeCloseTo(.6);
 expect(history.sample(900,1,1)).toBeNull();expect(history.sample(1000,2,1)).toBeNull();expect(history.sample(1000,1,2)).toBeNull();
 history.record(1200,2,1,p.capture());expect(history.sample(1100,1,1)).toBeNull();
 expect(shotViewTime(2000,-99999,0)).toBe(1800);expect(shotViewTime(2000,99999,900)).toBe(2000);
 expect(shotViewTime(2000,1000,900)).toBe(1700);expect(shotViewTime(2000,undefined,900)).toBe(2000);
});
