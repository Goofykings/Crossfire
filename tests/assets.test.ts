import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

const MAP_IDS = readdirSync('src/maps', { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`src/maps/${d.name}/layout.json`))
  .map((d) => d.name);


const WEAPON_FILES = ['rifle', 'shotgun', 'sniper', 'hands', 'casings'].map((n) => `public/assets/models/shared/weapons/${n}.glb`);
describe.each(MAP_IDS)('map %s assets', (id) => {
  const dir = `public/assets/models/${id}`;
  const idx = JSON.parse(readFileSync(`${dir}/map-assets.json`, 'utf8')) as { models: string[]; collision: string; collisionDebug?: string };
  const layout = JSON.parse(readFileSync(`src/maps/${id}/layout.json`, 'utf8'));

  it('ships every model the asset index lists, plus collision data', () => {
    expect(idx.models.length).toBeGreaterThan(5);
    for (const f of [...idx.models, idx.collision]) {
      expect(existsSync(`${dir}/${f}`), f).toBe(true);
      expect(statSync(`${dir}/${f}`).size, f).toBeGreaterThan(10_000);
    }
    const col = JSON.parse(readFileSync(`${dir}/${idx.collision}`, 'utf8'));
    expect(col.map).toBe(id);
  });

  it('only references materials the runtime library defines', () => {
    for (const f of idx.models) {
      const j = glbJson(`${dir}/${f}`);
      expect(j.meshes?.length ?? 0, f).toBeGreaterThan(0);
      for (const m of j.materials ?? []) expect(m.name.replace(/\.\d{3}$/, '') in materials, `${f}: ${m.name}`).toBe(true);
    }
  });

  it('has a model for every prop type it places', () => {
    const props = JSON.parse(readFileSync('public/assets/models/shared/props/props.json', 'utf8')).props as Record<string, { file: string }>;
    for (const t of new Set<string>([...layout.props, ...layout.obstacles].map((p: { type: string }) => p.type))) {
      expect(props[t], `prop ${t}`).toBeDefined();
      expect(existsSync(`public/assets/models/shared/props/${props[t].file}`), t).toBe(true);
    }
  });
});

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
      ...WEAPON_FILES,
      'public/assets/models/shared/props/target.glb',
    ];
    for (const f of files) {
      const j = glbJson(f);
      expect(j.meshes?.length ?? 0, f).toBeGreaterThan(0);
      for (const m of j.materials ?? []) expect(m.name.replace(/\.\d{3}$/, '') in materials, `${f}: ${m.name}`).toBe(true);
    }
  });

  it('exports each weapon with its moving parts and the anchors the view-model animates between', () => {
    const need: Record<string, string[]> = {
      rifle: ['muzzle', 'sight', 'eject', 'grip_r', 'grip_l', 'mag_grip', 'mag'],
      shotgun: ['muzzle', 'sight', 'eject', 'grip_r', 'grip_l', 'port', 'pump', 'shell'],
      sniper: ['muzzle', 'sight', 'eject', 'grip_r', 'grip_l', 'mag_grip', 'bolt_grip', 'bolt', 'mag'],
    };
    for (const [id, nodes] of Object.entries(need)) {
      const names = (glbJson(`public/assets/models/shared/weapons/${id}.glb`).nodes ?? []).map((n) => n.name);
      for (const n of nodes) expect(names, `${id}: ${n}`).toContain(n);
    }
    const hands = (glbJson('public/assets/models/shared/weapons/hands.glb').nodes ?? []).map((n) => n.name);
    for (const n of ['hand_r', 'hand_l', 'hand_r_wrist', 'hand_l_wrist', 'forearm']) expect(hands).toContain(n);
    const cases = (glbJson('public/assets/models/shared/weapons/casings.glb').nodes ?? []).map((n) => n.name);
    for (const n of ['casing_rifle', 'casing_sniper', 'casing_shell']) expect(cases).toContain(n);
    // the energy weapon is gone
    expect(existsSync('public/assets/models/shared/weapons/blaster.glb')).toBe(false);
  });

  it('exports the practice target as a hinged steel silhouette', () => {
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
