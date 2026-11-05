import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_IDS } from '../shared/maps';
import { audit, loadMap, type Finding, type LoadedMap } from './mapAudit';

/** Whole-map geometry audit (see tests/mapAudit.ts). MAP_AUDIT=1 also writes every finding to
 * test-results/map-audit/<map>.json for inspection; the assertions keep the fixed classes fixed. */
describe.each(MAP_IDS)('%s geometry integrity audit', (id) => {
  let loaded: LoadedMap | undefined;
  const map = () => loaded ??= loadMap(id);

  it('has no see-through walls, escapes, floating props/lights or unreachable spawns', () => {
    const result = audit(map());
    if (process.env.MAP_AUDIT) {
      mkdirSync('test-results/map-audit', { recursive: true });
      const counts: Record<string, number> = {};
      for (const f of result.findings) counts[`${f.check}:${f.severity}`] = (counts[`${f.check}:${f.severity}`] ?? 0) + 1;
      writeFileSync(`test-results/map-audit/${id}.json`, JSON.stringify({ stats: result.stats, counts, findings: result.findings }, null, 1));
    }
    const errors = result.findings.filter((f: Finding) => f.severity === 'error');
    expect(errors.map((f) => `${f.check} ${f.at}: ${f.detail}`)).toEqual([]);
  }, 600_000);

  it('leaves every stairwell visibly open where its collision drops below the street', () => {
    // A street decal, manhole or prop drawn across a stairwell floats over the steps a player
    // actually walks down. Wherever collision has no street-level ground inside an entrance,
    // the first visible surface straight down must be the stair, not something at street level.
    const { layout, world, grid } = map();
    const floating: string[] = [];
    for (const passage of layout.underground ?? []) for (const e of passage.entrances) {
      // Inside the 0.3 m walls and clear of the wall-mounted handrails along them.
      const [x0, z0, x1, z1] = e.rect;
      let open = 0;
      for (let x = x0 + .5; x < x1 - .5; x += .1) for (let z = z0 + .5; z < z1 - .5; z += .1) {
        if (world.groundHeight(x, z, .01, .5) > -.12 || world.overlapsCylinder(x, z, .01, -.1, .5)) continue;
        open++;
        const hit = grid.raycast([x, .6, z], [0, -1, 0], 1);
        if (hit && .6 - hit.t > -.12) floating.push(`${e.id} ${x.toFixed(2)},${z.toFixed(2)} ${grid.tris.material(hit.tri)} at ${(.6 - hit.t).toFixed(3)}`);
      }
      // Most of each stairwell is open: the check is not vacuous.
      expect(open, `${e.id} open samples`).toBeGreaterThan(300);
    }
    expect(floating.slice(0, 12), `${floating.length} street-level samples over open stairwells`).toEqual([]);
  }, 600_000);
});
