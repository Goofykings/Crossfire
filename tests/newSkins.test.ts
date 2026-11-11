import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { NullEngine, PBRMaterial, Scene, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { ALL_COLLECTIONS, COLLECTIONS, COSMETICS, CRATE, EXTRA_COLLECTIONS, FROST_LINE, GUN_CATEGORIES, WEAPON_MATERIALS, collectionCosmetic, cosmetic, crateItems,
  drawCrate, fireEffect, killEffect, normalizeInventory, validInventory } from '../shared/cosmetics';
import { loadCosmeticAsset } from '../src/rendering/CosmeticAssets';
import { SkinFxPlugin, setSkinFxLite, skinFxLite } from '../src/rendering/SkinFx';
import { icicleGeometry } from '../src/rendering/Icicles';
import { SnowBurst } from '../src/weapons/SnowBurst';
import type { MaterialLibrary } from '../src/rendering/MaterialLibrary';
import { WEAPONS } from '../src/weapons/Weapon';

const glb = (file: string) => { const b = fs.readFileSync('public/' + file); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as { materials: { name: string }[]; nodes: { name: string; translation?: number[] }[] }; };
afterEach(() => { vi.unstubAllGlobals(); setSkinFxLite(false); });

describe('2026-11-10 skin families', () => {
  it('names, rarities and coverage: every firearm, and the daggers for Darkness only', () => {
    expect(EXTRA_COLLECTIONS.map((c) => [c.id, c.name, c.rarity])).toEqual([
      ['blossom', 'Blossom', 'uncommon'], ['carbon-fiber', 'Carbon Fiber', 'rare'], ['hydro-nebula', 'Hydro Dip — Nebula', 'epic'],
      ['hydro-inferno', 'Hydro Dip — Inferno', 'epic'], ['hydro-abyss', 'Hydro Dip — Abyss', 'epic'], ['darkness', 'Darkness', 'epic'], ['frosted', 'Frosted', 'legendary']]);
    for (const c of EXTRA_COLLECTIONS) {
      for (const w of GUN_CATEGORIES) {
        const item = cosmetic(collectionCosmetic(c.id, w))!;
        expect(item).toMatchObject({ name: c.name, rarity: c.rarity, weapon: w, ownership: 'grant', collection: c.id, compatibleWith: [w] });
        expect(item.asset.binding).toBe('shared');
        const used = glb(item.asset.model).materials.map((m) => m.name);
        for (const name of Object.keys(item.asset.materials!)) { expect(used, `${item.id} ${name}`).toContain(name); expect(WEAPON_MATERIALS[w]).toContain(name); }
        for (const patch of Object.values(item.asset.materials!)) for (const file of [patch.albedo, patch.normal, patch.orm, patch.fx && 'map' in patch.fx ? patch.fx.map : undefined, patch.fx?.type === 'flow' ? patch.fx.ramp : undefined])
          if (file) expect(fs.existsSync('public/' + file), file).toBe(true);
      }
      expect(!!cosmetic(collectionCosmetic(c.id, 'melee'))).toBe(c.id === 'darkness');
    }
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
  });
  it('stays out of the crate: pool, odds and draws are exactly as before', () => {
    expect(crateItems()).toHaveLength(36);
    expect(crateItems().every((c) => COLLECTIONS.some((f) => f.id === c.collection))).toBe(true);
    expect(CRATE.distribution).toEqual([{ rarity: 'uncommon', percent: 55 }, { rarity: 'rare', percent: 40 }, { rarity: 'legendary', percent: 5 }]);
    const extra = new Set(EXTRA_COLLECTIONS.map((c) => c.id));
    for (let i = 0; i < 400; i++) { const r = () => ((i * 7919 + 13) % 997) / 997; expect(extra.has(drawCrate([], r)!.collection!)).toBe(false); }
    // With every crate item owned the crate is exhausted, even though the new skins are unowned.
    expect(drawCrate(crateItems().map((c) => c.id), () => .5)).toBeUndefined();
    // The catalog still knows them, so a later server grant validates.
    const owned = normalizeInventory({ owned: ['frosted-rifle', 'darkness-melee'], equipped: { rifle: 'frosted-rifle', melee: 'darkness-melee' } as never });
    expect(owned.equipped.rifle).toBe('frosted-rifle'); expect(validInventory({ ...owned, version: 1, serverTime: 1 })).toBe(true);
  });
  it('Hydro Dip variants are separate items on one shader configuration; only the colour ramp differs', () => {
    const fx = (id: string) => cosmetic(`${id}-rifle`)!.asset.materials!.gun_black.fx!;
    const [a, b, c] = ['hydro-nebula', 'hydro-inferno', 'hydro-abyss'].map(fx);
    for (const x of [a, b, c]) expect(x.type).toBe('flow');
    const strip = (x: typeof a) => ({ ...x, ramp: '' });
    expect(strip(b)).toEqual(strip(a)); expect(strip(c)).toEqual(strip(a));
    expect(new Set([a, b, c].map((x) => x.type === 'flow' && x.ramp)).size).toBe(3);
    expect(a.type === 'flow' && a.speed).toBeLessThanOrEqual(1);
  });
  it('effects: only Frosted has the firing snow and icicles, Rich keeps its kill effect, balance is untouched', () => {
    expect(COSMETICS.filter((c) => fireEffect(c.id)).map((c) => c.id)).toEqual(GUN_CATEGORIES.map((w) => `frosted-${w}`));
    expect(COSMETICS.filter((c) => c.asset.icicles).map((c) => c.id)).toEqual(GUN_CATEGORIES.map((w) => `frosted-${w}`));
    expect(COSMETICS.filter((c) => killEffect(c.id)).every((c) => c.collection === 'rich')).toBe(true);
    const before = JSON.stringify(WEAPONS);
    for (const c of ALL_COLLECTIONS) expect(Object.keys(c)).not.toContain('stats');
    expect(JSON.stringify(WEAPONS)).toBe(before);
  });
  it('icicles hang below the snow line and the sights, on the static body only', () => {
    for (const w of GUN_CATEGORIES) {
      const item = cosmetic(`frosted-${w}`)!, file = JSON.parse(fs.readFileSync('public/' + item.asset.icicles!, 'utf8')) as { line: number; icicles: number[][] };
      const sight = glb(item.asset.model).nodes.find((n) => n.name === 'sight')!.translation!;
      expect(file.line).toBe(FROST_LINE[w]);
      expect(file.icicles.length).toBeGreaterThanOrEqual(8); expect(file.icicles.length).toBeLessThanOrEqual(34);
      for (const [, y, , , dy, , length, radius] of file.icicles) { expect(y).toBeLessThan(sight[1] - .01); expect(dy).toBeLessThan(-.8); expect(length).toBeLessThanOrEqual(.04); expect(radius).toBeLessThanOrEqual(.005); }
      expect(new Set(file.icicles.map((i) => i[6])).size).toBeGreaterThan(4);   // irregular lengths
      const frost = item.asset.materials!.gun_black?.fx ?? Object.values(item.asset.materials!).find((m) => m.fx)!.fx!;
      expect(frost.type === 'frost' && frost.line).toBe(FROST_LINE[w]);
    }
    const data = icicleGeometry([[0, 0, 0, 0, -1, 0, .02, .003], [0, 0, .1, .2, -.9797, 0, .015, .002]]);
    expect(data.positions!.length / 3).toBe(22); expect(data.indices!.length / 3).toBe(30);   // 15 triangles each
  });
});

describe('default weapon appearances', () => {
  it('white SMG body, walnut shotgun, olive sniper chassis; materials exist and the rifle is unchanged', () => {
    const defs = JSON.parse(fs.readFileSync('public/assets/materials.json', 'utf8')).materials as Record<string, { tint: number[]; albedo?: string; metallic: number }>;
    const names = (file: string) => glb(`assets/models/shared/weapons/${file}.glb`).materials.map((m) => m.name);
    expect(names('smg')).toEqual(expect.arrayContaining(['gun_white', 'gun_black', 'gun_polymer', 'gun_steel']));
    expect(names('sniper')).toEqual(expect.arrayContaining(['gun_green', 'gun_black', 'gun_steel', 'gun_lens']));
    expect(names('shotgun')).toEqual(expect.arrayContaining(['gun_wood', 'gun_steel']));
    expect(names('rifle')).not.toContain('gun_white'); expect(names('rifle')).not.toContain('gun_green');
    expect(Math.min(...defs.gun_white.tint)).toBeGreaterThan(.6);
    const [r, g, b] = defs.gun_green.tint; expect(g).toBeGreaterThan(r); expect(g).toBeGreaterThan(b); expect(g).toBeLessThan(.12);   // dark, muted green
    expect(defs.gun_wood.albedo).toBe('assets/textures/weapons/walnut_albedo.jpg'); expect(fs.existsSync('public/' + defs.gun_wood.albedo)).toBe(true);
    expect(defs.gun_fde.tint).toEqual([.34, .27, .18]);
  });
  it('existing skins colour the new default materials as the body they replaced, never showing default paint', () => {
    for (const c of ALL_COLLECTIONS) {
      const smg = cosmetic(collectionCosmetic(c.id, 'smg'))!.asset.materials!, sniper = cosmetic(collectionCosmetic(c.id, 'sniper'))!.asset.materials!;
      expect(smg.gun_white, c.id).toEqual(smg.gun_black); expect(sniper.gun_green, c.id).toEqual(sniper.gun_black);
    }
  });
});

describe('shared skin shader and effects', () => {
  const stub = () => vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(`public/${String(url).replace(/^.*?assets\//, 'assets/')}`)));
  const library = (scene: Scene) => { const shared = new PBRMaterial('shared', scene); return { get: () => shared, ready: async () => {} } as unknown as MaterialLibrary; };
  const modes = (meshes: { material: unknown }[]) => [...new Set(meshes.map((m) => m.material).filter((m): m is PBRMaterial => m instanceof PBRMaterial && m.name.startsWith('cosmetic:')))]
    .map((m) => (m.pluginManager?.getPlugin('SkinFx') as SkinFxPlugin | null)?.mode ?? null);
  it('attaches one plugin per effect material, strips maps for Darkness, survives Material.clone, adds icicles', async () => {
    stub();
    const engine = new NullEngine(), scene = new Scene(engine), materials = library(scene), signal = new AbortController().signal;
    try {
      const hydro = await loadCosmeticAsset(cosmetic('hydro-abyss-rifle')!, scene, materials, signal);
      expect(modes(hydro.meshes)).toContain('flow');
      const dark = await loadCosmeticAsset(cosmetic('darkness-melee')!, scene, materials, signal);
      const shadows = [...new Set(dark.meshes.map((m) => m.material).filter((m): m is PBRMaterial => m instanceof PBRMaterial && m.name.startsWith('cosmetic:')))];
      expect(shadows.length).toBeGreaterThan(0);
      for (const m of shadows) {
        expect(m.albedoTexture).toBeNull(); expect(m.bumpTexture).toBeNull(); expect(m.metallicTexture).toBeNull();
        expect(m.emissiveColor.equalsFloats(0, 0, 0)).toBe(true); expect(Math.max(m.albedoColor.r, m.albedoColor.g, m.albedoColor.b)).toBeLessThan(.01);
        expect(m.alpha).toBe(1); expect(m.needAlphaBlending()).toBe(false);
        // The elimination fade clones weapon materials: the clone must keep the effect.
        const copy = m.clone('death:test')!; expect((copy.pluginManager?.getPlugin('SkinFx') as SkinFxPlugin).mode).toBe('shade'); copy.dispose();
      }
      const frost = await loadCosmeticAsset(cosmetic('frosted-smg')!, scene, materials, signal), base = await loadCosmeticAsset(cosmetic('default-smg')!, scene, materials, signal);
      expect(modes(frost.meshes)).toContain('frost');
      const icicles = frost.meshes.find((m) => m.name === 'frost_icicles')!;
      expect(icicles.parent).toBe(frost.transformNodes.find((n) => n.name === 'muzzle')!.parent);
      expect(icicles.isPickable).toBe(false); expect(icicles.getTotalIndices() / 3).toBeLessThanOrEqual(34 * 15);
      expect(frost.meshes.length).toBe(base.meshes.length + 1);
      // Anchors and moving parts are the default gun's: nothing to re-rig.
      for (const name of ['muzzle', 'sight', 'eject', 'grip_r', 'grip_l', 'mag_grip', 'mag']) {
        const a = [...frost.transformNodes, ...frost.meshes].find((n) => n.name === name), b = [...base.transformNodes, ...base.meshes].find((n) => n.name === name);
        expect(!!a).toBe(!!b); if (a && b) expect((a as { position: Vector3 }).position.equalsWithEpsilon((b as { position: Vector3 }).position, 1e-6)).toBe(true);
      }
      for (const c of [hydro, dark, frost, base]) c.dispose();
    } finally { scene.dispose(); engine.dispose(); }
  });
  it('snowflakes are bounded, rate-limited and cut down in Chromebook mode', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    try {
      const snow = new SnowBurst(scene);
      for (let i = 0; i < 80; i++) snow.emit(Vector3.Zero(), new Vector3(0, 0, -1), i * 100);
      expect(snow.inspect()).toMatchObject({ active: 72, capacity: 72, blended: true });
      const count = snow.active; snow.emit(Vector3.Zero(), new Vector3(0, 0, -1), 79 * 100 + 10);   // 10 ms after the last shot
      expect(snow.active).toBe(count);
      setSkinFxLite(true); expect(skinFxLite()).toBe(true);
      const lite = new SnowBurst(scene);
      for (let i = 0; i < 40; i++) lite.emit(Vector3.Zero(), new Vector3(0, 0, -1), i * 100);
      expect(lite.inspect()).toMatchObject({ active: 20, capacity: 20, blended: false });
      expect(lite.meshes()[0].isPickable).toBe(false);
      snow.dispose(); lite.dispose();
    } finally { scene.dispose(); engine.dispose(); }
  });
});
