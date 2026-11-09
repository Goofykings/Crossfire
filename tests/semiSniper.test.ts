import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Glb {
  json: { nodes: { name?: string; translation?: number[]; mesh?: number; children?: number[] }[]; meshes: { name?: string; primitives: { attributes: { POSITION: number }; indices: number; material: number }[] }[];
    accessors: { count: number; min?: number[]; max?: number[] }[]; materials: { name: string }[] };
}

function glb(name: string): Glb {
  const buf = readFileSync(`public/assets/models/shared/weapons/${name}.glb`);
  return { json: JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) };
}

const anchors = (g: Glb) => Object.fromEntries(g.json.nodes.filter((n) => n.translation).map((n) => [n.name, n.translation!]));
/** Bounds of the body mesh (everything but the moving magazine), in weapon space. */
function bodyBounds(g: Glb, meshName: string) {
  const mesh = g.json.meshes.find((m) => m.name === meshName)!;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.primitives) {
    const a = g.json.accessors[p.attributes.POSITION];
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a.min![k]); hi[k] = Math.max(hi[k], a.max![k]); }
  }
  return { lo, hi };
}
const triangles = (g: Glb) => g.json.meshes.reduce((n, m) => n + m.primitives.reduce((k, p) => k + g.json.accessors[p.indices].count / 3, 0), 0);

describe('semi-automatic sniper model', () => {
  const semi = glb('semi_sniper'), ar = glb('rifle'), bolt = glb('sniper');
  const materials = JSON.parse(readFileSync('public/assets/materials.json', 'utf8')).materials as Record<string, { metallic?: number }>;

  it('exports the AR anchor set and its moving magazine so existing clips and holds apply', () => {
    const names = semi.json.nodes.map((n) => n.name);
    for (const n of ['muzzle', 'sight', 'eject', 'grip_r', 'grip_l', 'mag_grip', 'mag']) expect(names, n).toContain(n);
    expect(names).not.toContain('bolt');
    expect(names).not.toContain('pump');
  });

  it('keeps the AR hand, magazine and butt-pad frames (WEAPON_HOLDS / RIG_CONFIGS presets stay valid)', () => {
    const a = anchors(semi), r = anchors(ar);
    for (const n of ['grip_r', 'grip_l', 'mag_grip', 'sight']) for (let k = 0; k < 3; k++) expect(a[n][k], `${n}[${k}]`).toBeCloseTo(r[n][k], 2);
    expect(a.sight[1]).toBeCloseTo(.1355, 3); // scope axis, within 2 mm of the AR holo sight
    const sb = bodyBounds(semi, 'semi_sniper'), rb = bodyBounds(ar, 'rifle');
    expect(sb.hi[2]).toBeCloseTo(rb.hi[2], 3); // butt pad rear face: the measured ADS shoulder point
  });

  it('is longer than the AR and shorter than the bolt sniper, with the sight eye relief unchanged', () => {
    const m = anchors(semi).muzzle, mr = anchors(ar).muzzle, ms = anchors(bolt).muzzle;
    expect(m[2]).toBeLessThan(mr[2]);
    expect(m[2]).toBeGreaterThan(ms[2]);
    expect(m[1]).toBeCloseTo(.062, 3);
    expect(m[0]).toBe(0);
    const sb = bodyBounds(semi, 'semi_sniper');
    expect(sb.lo[2]).toBeGreaterThan(m[2] - .01);
    expect(sb.lo[2]).toBeLessThan(m[2] + .01);
  });

  it('uses runtime-defined materials, including the new gold, and stays near the AR/sniper triangle budget', () => {
    const used = semi.json.materials.map((m) => m.name);
    expect(used).toEqual(expect.arrayContaining(['gun_gold', 'gun_black', 'gun_steel', 'reticle_holo']));
    for (const n of used) expect(n in materials, n).toBe(true);
    expect(triangles(semi)).toBeLessThan(2100);
    expect(triangles(semi)).toBeGreaterThan(triangles(ar));
  });
});
