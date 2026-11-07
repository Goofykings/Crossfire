import { describe, expect, it } from 'vitest';
import { GrenadeCharge } from '../shared/grenadeCharge';
import { GRENADE, throwGrenade, advanceGrenade } from '../shared/grenades';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { NO_INTENT } from '../src/player/PlayerController';
import { parseClientMessage, PROTOCOL_VERSION } from '../shared/protocol';

describe('server-clock grenade charging',()=>{
  it('releases a quick tap once, caps at 1.1 seconds, and does not throw while held',()=>{
    const c=new GrenadeCharge();
    expect(c.update(true,1000,1/120,true)).toBeNull();
    expect(c.update(false,1008,1/120,true)).toBe(0);
    expect(c.update(false,1016,1/120,true)).toBeNull();
    c.update(true,2000,1/120,true);
    for(let i=1;i<=240;i++)expect(c.update(true,2000+i*1000/120,1/120,true)).toBeNull();
    expect(c.progress(4000)).toBe(1);expect(c.update(false,4000,1/120,true)).toBe(1);
  });
  it('cannot bank charge from frame flooding or missing packets',()=>{
    const c=new GrenadeCharge();c.update(true,1000,1/120,true);
    for(let i=0;i<1000;i++)c.update(true,1000,1/120,true);
    expect(c.update(false,1001,1/120,true)).toBeLessThan(.001);
    c.update(true,2000,1/120,true);c.update(undefined,2500,1/120,true);
    expect(c.active).toBe(false);expect(c.update(false,2501,1/120,true)).toBeNull();
  });
  it.each(['cancel','dead','inventory','slide','reconnect'])('cancels %s without creating a projectile',reason=>{
    const c=new GrenadeCharge();c.update(true,1000,1/120,true);c.update(true,1100,.008,true);
    if(reason==='reconnect')c.reset();
    else expect(c.update(false,1110,.008,reason==='cancel',reason==='cancel')).toBeNull();
    expect(c.active).toBe(false);expect(c.update(false,1120,.008,true)).toBeNull();
  });
  it.each([0,.2,.45])('full charge travels 1.5–2 times the preceding ordinary throw, pitch=%s',pitch=>{
    const w=new CollisionWorld();w.add({c:[0,-.5,0],h:[100,.5,100]});
    const eye={x:0,y:1.64,z:0},dir={x:0,y:Math.sin(pitch),z:-Math.cos(pitch)},zero={x:0,y:0,z:0};
    const data={id:'g',ownerId:'a',ownerLife:1,roundId:0,at:1000};
    const old=throwGrenade(w,eye,eye,dir,zero,data)!,full=throwGrenade(w,eye,eye,dir,zero,data,1)!,tap=throwGrenade(w,eye,eye,dir,zero,data,0)!;
    for(const g of [old,full,tap])advanceGrenade(g,g.explodeAt,w);
    const ratio=(Math.abs(full.position.z)-.38)/(Math.abs(old.position.z)-.38);
    expect(ratio).toBeGreaterThanOrEqual(1.5);expect(ratio).toBeLessThanOrEqual(2);
    expect(Math.abs(tap.position.z)).toBeLessThan(Math.abs(old.position.z)*.4);
    expect(full.explodeAt-full.at).toBe(GRENADE.fuseMs);
  });
  it('accepts explicit cancellation, rejects contradictory holds and invented charge strength',()=>{
    const frame={seq:1,yaw:0,pitch:0,intent:NO_INTENT,combat:{trigger:false,reload:false,grenadeCancel:true}};
    const message={v:PROTOCOL_VERSION,type:'input',roundId:0,mapVersion:'test',frames:[frame]};
    expect(parseClientMessage(JSON.stringify(message))).not.toBeNull();
    for(const patch of [{grenade:true},{charge:1},{grenadeCancel:1},{chargeMs:1500}])
      expect(parseClientMessage(JSON.stringify({...message,frames:[{...frame,combat:{...frame.combat,...patch}}]}))).toBeNull();
  });
});
