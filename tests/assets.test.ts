import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function glbJson(file: string): { meshes?: unknown[]; materials?: { name: string }[]; nodes?: { name?: string }[] } {
  const buf = readFileSync(file);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

const materials = JSON.parse(readFileSync('public/assets/materials.json', 'utf8')).materials as Record<string, object>;
const index = JSON.parse(readFileSync('public/assets/models/european-town/map-assets.json', 'utf8')) as {
  models: string[];
  collision: string;
};

describe('generated assets', () => {
  it('ships every European Town model referenced by the asset index', () => {
    expect(index.models.length).toBeGreaterThan(5);
    for (const f of index.models) {
      const p = `public/assets/models/european-town/${f}`;
      expect(existsSync(p), p).toBe(true);
      expect(statSync(p).size, p).toBeGreaterThan(10_000);
    }
  });

  it('only references materials that the runtime library defines', () => {
    const files = [
      ...index.models.map((f) => `public/assets/models/european-town/${f}`),
      'public/assets/models/shared/weapons/blaster.glb',
      'public/assets/models/shared/props/target.glb',
    ];
    for (const f of files) {
      const j = glbJson(f);
      expect(j.meshes?.length ?? 0, f).toBeGreaterThan(0);
      for (const m of j.materials ?? []) expect(m.name.replace(/\.\d{3}$/, '') in materials, `${f}: ${m.name}`).toBe(true);
    }
  });

  it('exports the weapon with muzzle and sight nodes and the target with a hinged plate', () => {
    const weapon = glbJson('public/assets/models/shared/weapons/blaster.glb');
    const names = (weapon.nodes ?? []).map((n) => n.name);
    expect(names).toContain('muzzle');
    expect(names).toContain('sight');
    const target = glbJson('public/assets/models/shared/props/target.glb');
    expect((target.nodes ?? []).map((n) => n.name)).toContain('plate');
  });

  it('has a model for every prop the layout uses', () => {
    const props = JSON.parse(readFileSync('public/assets/models/shared/props/props.json', 'utf8')).props as Record<string, { file: string }>;
    const layout = JSON.parse(readFileSync('src/maps/european-town/layout.json', 'utf8'));
    const used = new Set<string>([...layout.props, ...layout.obstacles].map((p: { type: string }) => p.type));
    for (const t of used) {
      expect(props[t], `prop ${t}`).toBeDefined();
      expect(existsSync(`public/assets/models/shared/props/${props[t].file}`)).toBe(true);
    }
  });

  it('keeps every material texture on disk', () => {
    for (const [name, def] of Object.entries(materials) as [string, Record<string, string>][]) {
      for (const k of ['albedo', 'normal', 'orm']) {
        if (def[k]) expect(existsSync(`public/${def[k]}`), `${name}.${k}`).toBe(true);
      }
    }
  });

  it('generated the building catalogue for all eight building types', () => {
    for (const t of ['stone2', 'plaster3', 'shop', 'corner', 'narrow_passage', 'archway', 'balcony', 'room']) {
      for (const v of [1, 2]) expect(existsSync(`public/assets/models/shared/buildings/${t}_v${v}.glb`), `${t}_v${v}`).toBe(true);
    }
  });
});
