import { describe, expect, it } from 'vitest';
import { presentedAction, ShotTimeline } from '../src/game/RemoteTimeline';
import type { WeaponAction, WeaponState } from '../src/weapons/Weapon';

const gun = (action: WeaponAction, time: number, duration: number): WeaponState => ({ ammo: 1, ads: 0, action, time, duration,
  progress: duration ? time / duration : 0, cues: [], cooldown: 0, bloom: 0, emptyClickCooldown: 0, stopLoading: false, fromEmpty: false });

describe('presentedAction', () => {
  it('interpolates an action by elapsed time between snapshots', () => {
    const older = { at: 1000, gun: gun('reload', .5, 2) }, newer = { at: 1050, gun: gun('reload', .55, 2) };
    expect(presentedAction(older, newer, 1025)).toEqual({ action: 'reload', progress: (.5 + .025) / 2 });
  });
  it('keeps the older action until the newer one actually began on the server', () => {
    // The pump stroke began 20 ms before the newer sample (at 1030).
    const older = { at: 1000, gun: gun('idle', 0, 0) }, newer = { at: 1050, gun: gun('cycle', .02, .6) };
    expect(presentedAction(older, newer, 1020)).toEqual({ action: 'idle', progress: 0 });
    const started = presentedAction(older, newer, 1040)!;
    expect(started.action).toBe('cycle');
    expect(started.progress).toBeCloseTo(.01 / .6, 6);
  });
  it('restarts a repeated action (successive shells) at its own start', () => {
    const older = { at: 1000, gun: gun('shell', .45, .5) }, newer = { at: 1050, gun: gun('shell', .02, .5) };
    expect(presentedAction(older, newer, 1020)!.progress).toBeCloseTo(.47 / .5, 6);
    expect(presentedAction(older, newer, 1040)!.progress).toBeCloseTo(.01 / .5, 6);
  });
  it('clamps extrapolation and reports nothing without a gun', () => {
    expect(presentedAction({ at: 0, gun: gun('reload', 1.9, 2) }, { at: 50, gun: gun('reload', 1.95, 2) }, 500)!.progress).toBe(1);
    expect(presentedAction({ at: 0, gun: null }, { at: 50, gun: null }, 25)).toBeNull();
  });
});

describe('ShotTimeline', () => {
  const RIFLE = 60000 / 700;
  /** Present frames at 60 Hz on the delayed render clock and record when recoil plays. */
  const run = (timeline: ShotTimeline, from: number, to: number) => {
    const played: number[] = [];
    for (let t = from; t <= to; t += 1000 / 60) if (timeline.due(t)) played.push(t);
    return played;
  };

  it('plays a shot when the interpolated pose reaches its snapshot, not on arrival', () => {
    const timeline = new ShotTimeline();
    // The shot arrives (estimated server time 2010), then its tick's snapshot (2000).
    timeline.receive(2010, RIFLE); timeline.stamp(2000);
    // Rendering runs 100 ms behind the server: nothing at arrival...
    expect(run(timeline, 1910, 1995)).toEqual([]);
    // ...and exactly one impulse once the rendered pose reaches 2000.
    const played = run(timeline, 1996, 2300);
    expect(played).toHaveLength(1);
    expect(played[0]).toBeGreaterThanOrEqual(2000);
    expect(played[0] - 2000).toBeLessThan(1000 / 60);
  });

  it('keeps automatic cadence for several shots inside one 50 ms tick', () => {
    const timeline = new ShotTimeline();
    timeline.stamp(1000);
    // A previous burst tick, then two shots in the next tick (1050).
    timeline.receive(1060, RIFLE); timeline.receive(1060, RIFLE); timeline.stamp(1050);
    const queued = timeline.inspect().pending.map((s) => s.at);
    expect(queued).toHaveLength(2);
    expect(queued[1]).toBe(1050);
    // Never earlier than the previous snapshot, spaced as closely as the tick allows.
    expect(queued[0]).toBeGreaterThanOrEqual(1000);
    expect(queued[1] - queued[0]).toBeCloseTo(Math.min(RIFLE, 25), 6);
    const played = run(timeline, 990, 1200);
    expect(played).toHaveLength(2);
  });

  it('spaces a sustained burst at the weapon cadence on the render clock', () => {
    const timeline = new ShotTimeline();
    let serverTime = 1000;
    timeline.stamp(serverTime);
    const shotTimes: number[] = [];
    // 700 rpm from 1000: shots land in 50 ms ticks; each tick's shots arrive before its snapshot.
    for (let shot = 0; shot < 10; shot++) shotTimes.push(1001 + shot * RIFLE);
    while (serverTime < 1000 + 10 * RIFLE) {
      serverTime += 50;
      for (const at of shotTimes) if (at > serverTime - 50 && at <= serverTime) timeline.receive(serverTime + 15, RIFLE);
      timeline.stamp(serverTime);
    }
    const played = run(timeline, 900, 2200);
    expect(played).toHaveLength(10);
    const gaps = played.slice(1).map((t, i) => t - played[i]);
    // Every gap within one tick of the true cadence; no merged impulses.
    for (const gap of gaps) { expect(gap).toBeGreaterThan(RIFLE * .5); expect(gap).toBeLessThan(RIFLE + 50); }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(Math.abs(mean - RIFLE)).toBeLessThan(10);
  });

  it('plays late shots promptly after jitter without stacking them or replaying twice', () => {
    const timeline = new ShotTimeline();
    timeline.stamp(1000);
    // The snapshot for 1050 arrives late: rendering is already at 1080.
    timeline.receive(1110, RIFLE); timeline.receive(1110, RIFLE); timeline.stamp(1050);
    const played = run(timeline, 1080, 1400);
    expect(played).toHaveLength(2);
    expect(played[0]).toBe(1080);
    expect(played[1] - played[0]).toBeGreaterThanOrEqual(RIFLE * .5);
    expect(run(timeline, 1400, 2000)).toEqual([]);
    expect(timeline.pending).toBe(0);
  });

  it('drops a long backlog after a stall and falls back to the arrival time without a snapshot', () => {
    const stalled = new ShotTimeline();
    stalled.stamp(1000); stalled.receive(1060, RIFLE); stalled.stamp(1050);
    expect(run(stalled, 1050 + ShotTimeline.MAX_LATE_MS + 20, 3000)).toEqual([]);
    const lonely = new ShotTimeline();
    lonely.receive(5000, 667);
    expect(run(lonely, 4900, 4990)).toEqual([]);
    expect(run(lonely, 4990, 5100)).toHaveLength(1);
  });

  it('bounds the queue', () => {
    const timeline = new ShotTimeline();
    for (let i = 0; i < 100; i++) timeline.receive(1000, 58);
    expect(timeline.pending).toBe(ShotTimeline.MAX_QUEUED);
  });
});
