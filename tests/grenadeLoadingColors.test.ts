import { describe, it, expect, vi } from 'vitest';
import { texturesReady } from '../src/core/assetReadiness';
import { smokeEnvelope, smokeInterior, smokeObscures, smokeRadius } from '../src/weapons/grenadeSmoke';
import { displayTeam, playerColor, teamOrder } from '../src/ui/teamColors';
import { DEFAULT_SETTINGS, sanitizeSettings, SettingsStore } from '../src/config/settings';
import { GRENADE } from '../shared/grenades';
import type { BaseTexture } from '@babylonjs/core';

describe('required texture readiness', () => {
  it('waits for hidden assets rather than resolving on object creation', async () => {
    vi.useFakeTimers();
    try {
      let ready = false, done = false;
      const texture = {name:'gun-normal', loadingError:false, isReady:()=>ready} as BaseTexture;
      const work = texturesReady([texture]).then(()=>{done=true;});
      await vi.advanceTimersByTimeAsync(1000); expect(done).toBe(false);
      ready = true; await vi.advanceTimersByTimeAsync(25); await work; expect(done).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {vi.useRealTimers();}
  });
  it('reports the failed asset, cancellation, and timeout instead of entering gameplay', async () => {
    const failed = {name:'gun-albedo',loadingError:true,isReady:()=>false} as BaseTexture;
    await expect(texturesReady([failed])).rejects.toThrow('gun-albedo');
    const pending = {...failed,loadingError:false} as BaseTexture;
    const controller = new AbortController(); const work = texturesReady([pending],controller.signal);
    controller.abort(); await expect(work).rejects.toMatchObject({name:'AbortError'});
    await expect(texturesReady([pending],undefined,0)).rejects.toThrow('timed out: gun-albedo');
  });
});
describe('authoritative smoke timing and spatial density',()=>{
  it('remains dense for five seconds then smoothly fades over two',()=>{
    expect(smokeEnvelope(-1)).toBe(0); expect(smokeEnvelope(0)).toBe(0);
    for(const age of [300,1000,4999,5000])expect(smokeEnvelope(age)).toBe(.75);
    expect(smokeEnvelope(6000)).toBeCloseTo(.375);expect(smokeEnvelope(6999)).toBeLessThan(.001);
    expect(smokeEnvelope(7000)).toBe(0);expect(smokeEnvelope(9000)).toBe(0);
    expect(GRENADE.damageRadius).toBe(5.2);expect(GRENADE.damage).toBe(200);expect((smokeRadius(5000)/4.2)**3).toBeCloseTo(.75);
  });
  it('hides revealing presentation across smoke without blocking unrelated sightlines',()=>{
    const cloud={x:0,y:0,z:0},from={x:-6,y:1,z:0},to={x:6,y:1,z:0};
    expect(smokeObscures(from,to,cloud,1000)).toBe(true);
    expect(smokeObscures({...from,z:6},{...to,z:6},cloud,1000)).toBe(false);
    expect(smokeObscures(from,to,cloud,7000)).toBe(false);
  });
  it('blends the boundary and restores visibility outside and after expiration',()=>{
    expect(smokeInterior(0,4000)).toBe(.75);expect(smokeInterior(smokeRadius(4000)-.7,4000)).toBeCloseTo(.375);
    expect(smokeInterior(4.2,4000)).toBe(0);expect(smokeInterior(5,4000)).toBe(0);
    expect(smokeInterior(0,6000)).toBe(.375);expect(smokeInterior(0,7000)).toBe(0);
  });
});
describe('single player-relative presentation mapping',()=>{
  it.each(['blue','red'] as const)('maps actual %s to friendly blue without mutating identity',selfTeam=>{
    const enemy=selfTeam==='blue'?'red':'blue';
    expect(displayTeam(selfTeam,selfTeam)).toBe('blue');expect(displayTeam(enemy,selfTeam)).toBe('red');
    expect(teamOrder(selfTeam)).toEqual([selfTeam,enemy]);
    expect(playerColor('teams','me',selfTeam,'ally',selfTeam)).toBe('friendly');
    expect(playerColor('teams','me',selfTeam,'enemy',enemy)).toBe('opponent');
    expect(playerColor('ffa','me',selfTeam,'ally',selfTeam)).toBe('opponent');
    expect(playerColor('ffa','me',selfTeam,'me',selfTeam)).toBe('friendly');
    expect(playerColor('teams','me',null,'stranger',null)).toBe('opponent');
  });
});

it('persists reduced effects without resetting existing player settings',()=>{
  let saved: string | null = null;
  const storage: Storage = {get length(){return saved===null?0:1;},clear:()=>{saved=null;},key:()=>null,removeItem:()=>{saved=null;},
    getItem:()=>saved,setItem:(_key:string,value:string)=>{saved=value;}};
  const store=new SettingsStore(storage);
  store.update({mouseSensitivity:2.3,graphicsQuality:'ultra',reducedEffects:true});
  const restored=new SettingsStore(storage).value;
  expect(restored.reducedEffects).toBe(true);expect(restored.graphicsQuality).toBe('ultra');expect(restored.mouseSensitivity).toBe(2.3);
  expect(sanitizeSettings({...DEFAULT_SETTINGS,reducedEffects:'invalid'}).reducedEffects).toBe(false);
});
