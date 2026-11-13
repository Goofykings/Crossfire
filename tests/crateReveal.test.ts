import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { COLLECTIONS, COSMETICS, CRATE, WEAPON_CATEGORIES, WEAPON_MATERIALS, collectionCosmetic, cosmetic, crateItems, drawCrate, killEffect, normalizeInventory, validCrateResult, validInventory } from '../shared/cosmetics';
import { WEAPONS } from '../src/weapons/Weapon';
import { REVEAL, cameraPose, cratePose, heroPose, lidPose, stepSpring, wrapAngle } from '../src/ui/crateTimeline';
import { REVEAL_COLORS } from '../src/ui/CrateReveal';

const seq = (...values:number[]) => { let i=0; return () => values[i++ % values.length]; };

describe('crate collections', () => {
  it('has six named families, each with a version for all five guns and the matching dagger pair', () => {
    expect(COLLECTIONS.map(c => [c.name, c.rarity])).toEqual([
      ['Green Camo','uncommon'],['Blue Camo','uncommon'],['Red Camo','uncommon'],['Marble','rare'],['Rainbow Glow','epic'],['Rich','legendary']]);
    // The six original families plus the Epic ones (Hydro Dip x3 for the five guns, Darkness for all six categories).
    expect(crateItems()).toHaveLength(36 + 25);
    for (const c of COLLECTIONS) for (const w of WEAPON_CATEGORIES) {
      const item = cosmetic(collectionCosmetic(c.id, w))!;
      expect(item).toMatchObject({ name:c.name, rarity:c.rarity, weapon:w, compatibleWith:[w], ownership:'grant', collection:c.id });
      expect(item.asset.model).toBe(w==='melee'?'assets/models/shared/melee/dagger_r.glb':`assets/models/shared/weapons/${w==='semi-sniper'?'semi_sniper':w}.glb`);
      const names = Object.keys(item.asset.materials ?? {});
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) expect(WEAPON_MATERIALS[w]).toContain(name);
      for (const patch of Object.values(item.asset.materials ?? {}))
        for (const file of [patch.albedo, patch.normal, patch.orm, patch.emissive]) if (file) expect(fs.existsSync('public/' + file), file).toBe(true);
    }
  });
  it('only Rich carries the money kill effect and no cosmetic touches weapon balance', () => {
    expect(COSMETICS.filter(c => killEffect(c.id)==='money').map(c => c.id)).toEqual(WEAPON_CATEGORIES.map(w => `rich-${w}`));
    const before = JSON.stringify(WEAPONS);
    for (const c of COSMETICS) expect(Object.keys(c).sort()).not.toContain('stats');
    expect(JSON.stringify(WEAPONS)).toBe(before);
  });
});

describe('server crate draw', () => {
  it('picks rarity by the published odds, then an unowned item of that rarity', () => {
    expect(drawCrate([], seq(0, 0))!.rarity).toBe('uncommon');
    expect(drawCrate([], seq(.56, 0))!.rarity).toBe('rare');
    expect(drawCrate([], seq(.88, 0))!.rarity).toBe('epic');
    expect(drawCrate([], seq(.96, .999))!.rarity).toBe('epic');
    expect(drawCrate([], seq(.98, 0))!.id).toBe('rich-rifle');
    expect(drawCrate([], seq(.999, .999))!.id).toBe('frosted-semi-sniper');
  });
  it('never repeats an owned item and renormalizes when a rarity is exhausted', () => {
    const owned:string[] = [];
    const random = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    for (let i = 0; i < crateItems().length; i++) { const item = drawCrate(owned, random)!; expect(owned).not.toContain(item.id); owned.push(item.id); }
    expect(new Set(owned).size).toBe(61);
    expect(drawCrate(owned, random)).toBeUndefined();
    const noUncommon = crateItems().filter(c => c.rarity === 'uncommon').map(c => c.id);
    expect(drawCrate(noUncommon, seq(0, 0))!.rarity).toBe('rare');
  });
  it('accepts only exact, server-granted results', () => {
    const inventory = { ...normalizeInventory({ owned:['marble-smg'], revision:3 }), version:1, serverTime:1 };
    expect(validInventory(inventory)).toBe(true);
    expect(validCrateResult({ version:1, item:'marble-smg', gems:20, inventory })).toBe(true);
    for (const bad of [{ item:'default-smg' }, { item:'rich-smg' }, { gems:-1 }, { version:2 }, { extra:1 }])
      expect(validCrateResult({ version:1, item:'marble-smg', gems:20, inventory, ...bad })).toBe(false);
    expect(CRATE.price).toBe(250);
  });
});

describe('reveal timeline', () => {
  it('builds anticipation, pops the lid with seam light, then bursts at about 1.4 s', () => {
    expect(cratePose(.3).squashY).toBeLessThan(.95);
    expect(cratePose(.2).seam).toBe(0);
    expect(cratePose(REVEAL.pop + .1).lidLift).toBeGreaterThan(.08);
    expect(cratePose(REVEAL.pop + .3).lidLift).toBeLessThan(.08);
    expect(cratePose(REVEAL.burst - .05).seam).toBeGreaterThan(cratePose(REVEAL.pop + .05).seam);
    expect(cratePose(REVEAL.burst + .02).column).toBeGreaterThan(0);
    expect(REVEAL.burst).toBeGreaterThan(1); expect(REVEAL.burst).toBeLessThan(1.6);
  });
  it('winds up just before the burst: the body crouches and the lid is sucked down', () => {
    const before = cratePose(REVEAL.burst - REVEAL.windup - .02), last = cratePose(REVEAL.burst - .005);
    expect(last.squashY).toBeLessThan(before.squashY - .05);
    expect(last.lidLift).toBeLessThan(before.lidLift * .4);
    expect(last.seam).toBeGreaterThan(before.seam);
  });
  it('keeps all beats without shake under reduced motion', () => {
    expect(cratePose(.3, 0).tiltZ).toBe(0);
    expect(cratePose(REVEAL.pop + .1, 0).lidLift).toBeGreaterThan(.08);
  });
  it('sends the four lid quarters outward, up, then down out of frame', () => {
    const corners = [[-1,-1],[1,-1],[-1,1],[1,1]];
    for (const [i, [x, z]] of corners.entries()) {
      const rising = lidPose(REVEAL.burst + .2, x * .24, z * .18, i + 1), falling = lidPose(REVEAL.burst + 1.2, x * .24, z * .18, i + 1);
      expect(Math.sign(rising.x)).toBe(x); expect(Math.sign(rising.z)).toBe(z); expect(rising.y).toBeGreaterThan(.4);
      expect(falling.y).toBeLessThan(-1); expect(Math.abs(falling.angle)).toBeGreaterThan(5);
      expect(lidPose(REVEAL.burst + 2, x, z, i + 1).visible).toBe(false);
    }
    const spins = corners.map(([x, z], i) => lidPose(REVEAL.burst + .5, x, z, i + 1).spin);
    expect(new Set(spins.map(Math.sign)).size).toBe(2);
  });
  it('shoots the reward up with overshoot, spins once and settles at the hero pose', () => {
    expect(heroPose(REVEAL.burst - .1).visible).toBe(false);
    const samples = Array.from({ length: 60 }, (_, i) => heroPose(REVEAL.burst + i * .02).y);
    expect(Math.max(...samples)).toBeGreaterThan(REVEAL.heroY);
    const settled = heroPose(REVEAL.burst + 2);
    expect(settled.y).toBeCloseTo(REVEAL.heroY, 5); expect(settled.scale).toBeCloseTo(1, 5); expect(settled.spin).toBeCloseTo(0, 5);
    expect(REVEAL.heroYaw).toBeGreaterThan(.9); expect(REVEAL.heroYaw).toBeLessThan(Math.PI / 2);
  });
  it('tilts the camera up with the reward', () => {
    const a = cameraPose(0), b = cameraPose(REVEAL.burst + 1.2);
    expect(a.beta).toBeLessThan(Math.PI / 2); expect(b.beta).toBeGreaterThan(Math.PI / 2);
    expect(b.targetY).toBeCloseTo(REVEAL.heroY, 5);
  });
  it('springs a dragged rotation back to the hero angle the short way, with slight overshoot', () => {
    const s = { x:wrapAngle(5.5), v:0 }; let crossed = false;
    expect(Math.abs(s.x)).toBeLessThan(Math.PI);
    for (let i = 0; i < 120; i++) { const sign = Math.sign(s.x); stepSpring(s, 1 / 120); if (Math.sign(s.x) !== sign && sign) crossed = true; }
    expect(crossed).toBe(true);
    for (let i = 0; i < 300; i++) stepSpring(s, 1 / 120);
    expect(Math.abs(s.x)).toBeLessThan(.01);
  });
  it('uses green, blue and gold reveal light for the three crate rarities', () => {
    expect(REVEAL_COLORS.uncommon).toBe('#39e57a'); expect(REVEAL_COLORS.rare).toBe('#4d8dff'); expect(REVEAL_COLORS.legendary).toBe('#ffc22e');
  });
});
