import { describe, expect, it } from 'vitest';
import { MAP_IDS, ROUND_MS } from '../shared/maps';
import { ROTATION_MODES, mapRound, modeMaps, pickRotation, rotationAt, type RotationPick } from '../shared/rotation';
import { ZONE_MAPS, zoneEligible } from '../shared/zoneControl';
import { roundMode, teamMode } from '../shared/combat';

/** A scripted random source: returns the queued values, then 0. */
const script = (...values: number[]) => { const q = [...values]; return () => q.shift() ?? 0; };
// Centre of the i-th of n equal slices, so the pick is exact.
const slice = (i: number, n: number) => (i + 0.5) / n;

describe('public lobby rotation (controlled random values)', () => {
  it('picks the mode and then the map from the scripted values', () => {
    expect(pickRotation(null, script(slice(0, 3), slice(2, 5)))).toEqual({ mode: 'ffa', mapId: MAP_IDS[2] });
    expect(pickRotation(null, script(slice(1, 3), slice(0, 5)))).toEqual({ mode: 'teams', mapId: MAP_IDS[0] });
    const zoneMaps = modeMaps('zone-control');
    expect(pickRotation(null, script(slice(2, 3), slice(1, zoneMaps.length)))).toEqual({ mode: 'zone-control', mapId: zoneMaps[1] });
  });
  it('never repeats the previous mode or map while an alternative exists', () => {
    for (let m = 0; m < 3; m++) for (let k = 0; k < 4; k++) {
      const previous: RotationPick = { mode: ROTATION_MODES[m], mapId: modeMaps(ROTATION_MODES[m])[0] };
      const next = pickRotation(previous, script(slice(k % 2, 2), slice(k, 4)));
      expect(next.mode).not.toBe(previous.mode);
    }
    for (const mode of ['ffa', 'teams'] as const) for (const mapId of MAP_IDS) {
      for (let k = 0; k < 20; k++) {
        const r = Math.random;
        const next = pickRotation({ mode: mode === 'ffa' ? 'teams' : 'ffa', mapId }, () => r());
        expect(next.mapId).not.toBe(mapId);
      }
    }
  });
  it('has equal mode and map probability over the whole value range', () => {
    // Exhaustive sweep over a uniform grid: each candidate gets exactly its share.
    const modes: Record<string, number> = {}, maps: Record<string, number> = {};
    const N = 60;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      const p = pickRotation(null, script((a + .5) / N, (b + .5) / N));
      modes[p.mode] = (modes[p.mode] ?? 0) + 1;
      if (p.mode === 'ffa') maps[p.mapId] = (maps[p.mapId] ?? 0) + 1;
    }
    expect(Object.values(modes)).toEqual([1200, 1200, 1200]);
    expect(Object.values(maps)).toEqual(new Array(MAP_IDS.length).fill(1200 / MAP_IDS.length));
  });
  it('only plays Zone Control on maps with valid A, B and C squares', () => {
    const eligible = MAP_IDS.filter(zoneEligible);
    expect(eligible).not.toContain('european-town');
    expect(eligible).toContain('neon-backstreets');
    expect(modeMaps('zone-control')).toEqual(eligible);
    for (const id of eligible) expect(ZONE_MAPS[id].map((z) => z.id)).toEqual(['A', 'B', 'C']);
    for (let i = 0; i < 400; i++) {
      const p = rotationAt(77, i);
      if (p.mode === 'zone-control') expect(zoneEligible(p.mapId)).toBe(true);
    }
    // Town still shows up in FFA and Teams.
    expect(new Set(Array.from({ length: 400 }, (_, i) => rotationAt(5, i)).filter((p) => p.mapId === 'european-town').map((p) => p.mode)))
      .toEqual(new Set(['ffa', 'teams']));
  });
  it('is chainable: consecutive rounds of a seed never repeat a mode or a map, and every mode and map occurs', () => {
    for (const seed of [1, 2, 123456789, 4294967295]) {
      const seenModes = new Set<string>(), seenMaps = new Set<string>();
      for (let i = 0; i < 500; i++) {
        const a = rotationAt(seed, i), b = rotationAt(seed, i + 1);
        expect(b.mode).not.toBe(a.mode);
        expect(b.mapId).not.toBe(a.mapId);
        seenModes.add(a.mode); seenMaps.add(a.mapId);
      }
      expect(seenModes).toEqual(new Set(ROTATION_MODES));
      expect(seenMaps).toEqual(new Set(MAP_IDS));
    }
  });
  it('is deterministic and independent of call order (restart, eviction, late join, empty-room catch-up)', () => {
    const forward = Array.from({ length: 50 }, (_, i) => rotationAt(99, i));
    expect(Array.from({ length: 50 }, (_, i) => rotationAt(99, 49 - i)).reverse()).toEqual(forward);
    const schedule = { epoch: 5000, seed: 99 };
    for (let i = 0; i < 50; i++) {
      const round = mapRound(schedule, schedule.epoch + i * ROUND_MS + 1234);
      expect(round).toEqual({ id: i, mapId: forward[i].mapId, mode: forward[i].mode, endsAt: schedule.epoch + (i + 1) * ROUND_MS });
      expect(roundMode(99, i)).toBe(forward[i].mode);
    }
  });
  it('covers FFA to Teams, Teams to Zone Control and Zone Control to FFA transitions', () => {
    const edges = new Set<string>();
    for (let i = 0; i < 600; i++) edges.add(`${rotationAt(31, i).mode}>${rotationAt(31, i + 1).mode}`);
    for (const e of ['ffa>teams', 'teams>zone-control', 'zone-control>ffa', 'ffa>zone-control', 'teams>ffa', 'zone-control>teams']) expect(edges).toContain(e);
    expect(teamMode('zone-control') && teamMode('teams') && !teamMode('ffa')).toBe(true);
  });
  it('drops Zone Control when no map supports it, rather than starting a broken match', () => {
    // Simulate with the pure helper: no zone-capable maps leaves only FFA and Teams as candidates.
    const saved = ZONE_MAPS['neon-backstreets'], keep = Object.fromEntries(MAP_IDS.map((id) => [id, ZONE_MAPS[id]]));
    try {
      for (const id of MAP_IDS) (ZONE_MAPS as Record<string, unknown>)[id] = [];
      expect(modeMaps('zone-control')).toEqual([]);
      for (let i = 0; i < 100; i++) expect(pickRotation(null, script(i / 100 + .004, .5)).mode).not.toBe('zone-control');
    } finally {
      for (const id of MAP_IDS) (ZONE_MAPS as Record<string, unknown>)[id] = keep[id];
      expect(ZONE_MAPS['neon-backstreets']).toBe(saved);
    }
  });
});
