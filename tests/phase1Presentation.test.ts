import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../src/audio/AudioManager';
import { finalSeconds } from '../src/ui/MatchHud';

describe('authoritative final countdown', () => {
  it('shows exactly ten through one using the existing server deadline', () => {
    const end = 600000;
    expect(finalSeconds(end, end - 10001)).toBeNull();
    for (let i = 10; i >= 1; i--) {
      expect(finalSeconds(end, end - i * 1000)).toBe(i);
      expect(finalSeconds(end, end - i * 1000 + 999)).toBe(i);
    }
    expect(finalSeconds(end, end)).toBeNull(); expect(finalSeconds(end, end + 1)).toBeNull();
  });
  it('does not restart after reconnect, missing deadlines or invalid clocks', () => {
    expect(finalSeconds(600000, 595500)).toBe(5);
    expect(finalSeconds(600000, 596500)).toBe(4);
    expect(finalSeconds(null, 596500)).toBeNull(); expect(finalSeconds(600000, NaN)).toBeNull();
  });
});

describe('remote audio spatialization', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('does not retain source-position diagnostics during ordinary play', () => {
    const audio = new AudioManager();
    audio.playSpatial('rifle_shot', { x: 5, y: 0, z: -5 });
    expect(audio.inspectSpatial().recent).toEqual([]);
  });
  it('sets 3D position and bounded distance attenuation through the existing master gain', async () => {
    const panners: any[] = [], gains: any[] = [], sources: any[] = [];
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    class Context {
      state = 'running'; currentTime = 0; destination = node();
      createGain() { const n = { ...node(), gain: { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() } }; gains.push(n); return n; }
      createPanner() { const n = { ...node(), positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } }; panners.push(n); return n; }
      createBufferSource() { const n = { ...node(), playbackRate: { value: 1 }, start: vi.fn(), stop: vi.fn(), onended: null }; sources.push(n); return n; }
    }
    vi.stubGlobal('AudioContext', Context);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const audio = new AudioManager(true); audio.unlock(); await audio.ready;
    (audio as unknown as { buffers: Map<string, unknown> }).buffers.set('rifle_shot', {});
    audio.setVolume(.4);
    audio.playSpatial('rifle_shot', { x: 4, y: 1, z: -8 }, .9);
    expect(panners[0]).toMatchObject({ panningModel: 'equalpower', distanceModel: 'linear', refDistance: 3, maxDistance: 70, rolloffFactor: 1,
      positionX: { value: 4 }, positionY: { value: 1 }, positionZ: { value: -8 } });
    expect(gains[0].gain.value).toBe(.4); expect(gains[1].gain.value).toBe(1); expect(gains[2].gain.value).toBe(.2);
    expect(panners[0].connect).toHaveBeenCalledWith(gains[1]);
    audio.setSfxVolume(.3); expect(gains[1].gain.value).toBe(.3);
    expect(gains[1].connect).toHaveBeenCalledWith(gains[0]);
    for (let i = 0; i < 4; i++) audio.playSpatial('rifle_shot', { x: -5, y: 0, z: -5 });
    expect(sources).toHaveLength(5); // New shots replace a faded old tail rather than being dropped.
    expect(sources[0].stop).toHaveBeenCalled(); expect(gains[2].gain.setTargetAtTime).toHaveBeenCalledWith(0, 0, .01);
    sources[0].onended(); expect(audio.inspectSpatial().active).toBe(4);
    audio.playSpatial('rifle_shot', { x: 70, y: 0, z: 0 }); expect(sources).toHaveLength(5);
    expect(audio.recentSpatial.at(-1)?.x).toBe(-5);
  });
});
