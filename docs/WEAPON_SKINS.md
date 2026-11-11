# Weapon skins and default appearances (2026-11-10)

Seven new skin families (31 catalog items) and new default looks for the SMG, shotgun and bolt sniper. Visual
only: weapon statistics, hitboxes, anchors, animation timing, melee timing and the protocol are untouched.

**Not obtainable yet.** The families are in the catalog (`EXTRA_COLLECTIONS` in `shared/cosmetics.ts`) so the
Locker, first person, characters and the crate reveal can render them, but they are deliberately outside the crate
pool: `crateItems()`, `drawCrate()`, `CRATE` odds, prices, inventory storage and every Worker endpoint are unchanged.
Granting them (crate, shop or otherwise) is the separate backend task. Until then no account can own or equip one;
`normalizeInventory`/`validInventory` already accept the ids, so a later server grant needs no client change.

## Families

| Family | id | Rarity | Covers | Look |
|---|---|---|---|---|
| Blossom | `blossom` | Uncommon | 5 firearms | Ivory lacquer, dark branches, large saturated pink cherry blossoms (3 to 4 cm across), buds and loose petals |
| Carbon Fiber | `carbon-fiber` | Rare | 5 firearms | Black and dark grey 2x2 twill with a clear coat, gunmetal steel, matte black polymer |
| Hydro Dip — Nebula | `hydro-nebula` | Epic | 5 firearms | Flowing pink and purple marbling with a little blue |
| Hydro Dip — Inferno | `hydro-inferno` | Epic | 5 firearms | Flowing red, orange and yellow |
| Hydro Dip — Abyss | `hydro-abyss` | Epic | 5 firearms | Dark blue and green with thin white streaks |
| Darkness | `darkness` | Epic | 5 firearms + dual daggers | A near-black silhouette |
| Frosted | `frosted` | Legendary | 5 firearms | Vivid ice blue with snowflakes, a white snow cap, icicles, snowflakes when firing |

Item ids are `<family>-<weapon>` (`frosted-semi-sniper`, `darkness-melee`). The three Hydro Dip variants are
independent items. Every item is a material override on the original default GLB (`binding: 'shared'`), so anchors,
moving parts, reloads, holds and previews need nothing new.

## Material identifiers

A finish names the library materials it replaces; a weapon takes the entries its GLB actually has
(`WEAPON_MATERIALS`). Three default-only body colours are aliases (`MATERIAL_ALIAS`): `gun_gold` (semi-sniper),
`gun_white` (SMG receiver) and `gun_green` (sniper chassis) take a family's body finish, so no skin shows default
paint underneath and the six older families look as they did.

| Family | `gun_black`, `gun_fde`, `gun_wood` (+ aliases) | `gun_steel` | `gun_polymer` | other |
|---|---|---|---|---|
| Blossom | blossom texture, tile 0.30 m, clear coat 0.3 | default | default | |
| Carbon Fiber | weave albedo/normal/ORM, tile 0.115 m, clear coat 0.7 | `#3a3d44` metal | `#0b0c0e` | |
| Hydro Dip | `fx: flow` (source normal/ORM kept) | same as body | `#0d0d12` | |
| Darkness | `fx: shade`, `plain` | same | same | `gun_rubber`; daggers: `dagger_coat`, `dagger_steel`, `dagger_metal`, `dagger_grip`, `dagger_accent` |
| Frosted | ice texture + `fx: frost`, clear coat 0.25 | snow texture | snow texture | icicle mesh `frost_icicles`, material `frost_icicle` |

Sights, glass, lenses, reticles, brass and shells are never overridden.

## Assets

| Path | Contents |
|---|---|
| `public/assets/cosmetics/skins/blossom/` | `albedo.jpg` (1024), `orm.png` |
| `public/assets/cosmetics/skins/carbon-fiber/` | `albedo.jpg`, `normal.png`, `orm.png` (512) |
| `public/assets/cosmetics/skins/fx/flow.png` | shared flow map (R marbling field, G/B warp), 512, linear |
| `public/assets/cosmetics/skins/hydro-dip/` | `nebula-ramp.png`, `inferno-ramp.png`, `abyss-ramp.png` (256 x 4, periodic) |
| `public/assets/cosmetics/skins/frosted/` | `ice-*` and `snow-*` albedo/normal/ORM (512), `icicles-<weapon>.json` |
| `public/assets/textures/weapons/walnut_*.jpg` | default shotgun walnut (library material `gun_wood`) |

All 1.6 MB of textures tile seamlessly (weapon UVs are in metres) and come from
`blender/cosmetics/skin_textures.py` (stages `carbon`, `hydro`, `blossom`, `frosted`, `walnut`):

```powershell
& "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-expr "import sys; sys.dont_write_bytecode=True" -P blender/cosmetics/skin_textures.py -- carbon hydro blossom frosted walnut
python -B -I blender/cosmetics/icicle_design.py     # icicle placements (plain Python)
node tools/export-cosmetics.mjs                     # public/assets/cosmetics/catalog.json
```

## Shader (`src/rendering/SkinFx.ts`)

One Babylon material plugin (`SkinFxPlugin`) on the cloned PBR material; a skin supplies parameters
(`CosmeticMaterial.fx`). The modes are compile-time defines of the same shader: no extra pass, render target or
per-vertex CPU work, and geometry is never displaced.

| Mode | Parameters | What it does | Texture reads (full / lite) |
|---|---|---|---|
| `flow` | `map`, `ramp`, `tile` 0.4 m, `bands` 2.4, `speed` 0.55 | Reads the flow map at three slowly drifting offsets (two warp, one field) and indexes the variant's periodic colour ramp; replaces the albedo only | 4 / 2 |
| `frost` | `map`, `line` (per weapon), `wave` 0.011 m | Snow above a gun-space height with a wavy edge, and on upward faces, from the object-space position and normal (it does not slide when the gun turns) | 1 / 0 |
| `shade` | `rim` 0.04 | Faint view-dependent edge sheen added after lighting | 0 / 0 |

Animation: drift rates are 0.0045 to 0.013 repeats per second times `speed`; the ramp phase advances 0.012 cycles per
second. Every offset is taken modulo one repeat on the CPU and both textures tile, so there is no loop point.
`prefers-reduced-motion` freezes the clock. `skinFxClock.now` can be replaced in tests.

Darkness (`plain` + `shade`): the source albedo, normal and ORM maps are removed, albedo `#010101`, roughness 1,
metallic 0, environment 0.1, F0 0.12, specular 0.2, direct 0.45. It is an ordinary opaque lit material (no emissive
colour, no transparency); the sheen is at most 4% at grazing angles.

Frosted snow lines (`FROST_LINE`, metres above the grip origin): AR 0.068, SMG 0.086, sniper 0.039, shotgun 0.063,
semi-auto sniper 0.070. `icicle_design.py` reads the same table.

`Material.clone` (the elimination fade) recreates the plugin by class name and copies its configuration.

## Icicles (`src/rendering/Icicles.ts`, `blender/cosmetics/icicle_design.py`)

Placements are derived from each gun's own side faces where the snow line crosses them: icicles hang from the snow
edge down the face (toward its middle), lean 6 to 14 degrees outward, some lean along the barrel, lengths 12 to 31 mm,
irregular spacing. 13 to 34 per gun, 15 triangles each (at most 510), one mesh and one draw call, parented to the
static body node. Nothing is placed on the magazine, pump or bolt, near the ejection port or the hand positions, or
above the snow line (which is below every sight line). Not pickable, no collision, no shadows, opaque.

## Snowflakes (`src/weapons/SnowBurst.ts`)

When a Frosted gun fires: 7 small six-armed flakes (white and pale blue) drift outward from the barrel for 0.5 to
0.85 s and fade. One thin-instanced mesh, CPU-integrated, no physics, lights or network messages; at most 72 live
flakes, shots closer than 55 ms share a burst.

- First person: camera-space emitter in the weapon render group (`WeaponView`). No flakes while aiming (the barrel
  lies on the sight line) or while the weapon is hidden (scope overlay, daggers).
- Other players: one shared world-space emitter per scene (`CharacterWeaponLibrary`), skipped beyond 40 m.

## Chromebook mode

`Game.applySettings` calls `setSkinFxLite(chromebookMode)`; it applies live, without a reload.

- Hydro Dip: one flow read and one ramp read instead of four; still animated.
- Frosted: the snow edge uses two sine terms instead of a texture read; icicles unchanged (510 triangles).
- Snowflakes: 3 per shot, at most 20, rendered opaque (they shrink instead of fading): no blending or sorting.
- Darkness, Carbon Fiber and Blossom have no extra shader cost in any mode.

## Default appearances (`blender/scripts/lib/weapon.py`, `materials.py`)

- **SMG**: white receiver (`gun_white`) framed by a black top cover, rear end plate, nose cap and ejection port;
  grip, handguard, stock, barrel and magazine stay dark.
- **Shotgun**: `gun_wood` is now an oiled walnut texture set with straight grain (`grain_along()` turns the wood UVs
  so the grain follows the gun on every face); the forend is 7 cm longer and runs under the barrel and the magazine
  tube. Barrel, tube and receiver are the original blued steel.
- **Sniper**: the chassis (forend, action bed, buttstock) is dark olive (`gun_green`); scope, rings, barrel, bipod,
  grip and magazine keep their dark metal and polymer.

Rebuild: `--only materials,weapon` on `generate_all.py` (with the bytecode guard), then restore
`hands.glb`/`semi_sniper.glb` (`git checkout`) and run `generate_smg.py`. The staged Foundry collection's recorded
default-model hashes (`foundry-collection.json`) were updated for the three changed GLBs; its anchor and envelope
checks still pass.

## Checks

```powershell
npm.cmd run typecheck; npm.cmd test; npm.cmd run assets:verify; npm.cmd run build
node tools/skin-fx-test.mjs       # lab, controlled clock: flow continuity, silhouette, Frosted, Darkness (58 checks)
node tools/skins-game-test.mjs    # offline Practice match: first person, firing, daggers, Chromebook (25 checks)
node tools/review-skins.mjs [--ids ..] [--contexts locker,fp,third-side,snow] [--low]   # contact sheets
```

All three browser tools need the Vite dev server on port 4210. `__crossfire.previewSkin(id)` (DEV builds only) shows
a catalog skin on the local first-person weapon or daggers; it owns, equips, saves and sends nothing.

## Limits

- The skins cannot be obtained until the backend task adds a grant path; the Shop's crate contents list is unchanged.
- Finishes are world-space tiled textures on box-projected UVs: patterns do not continue across face edges.
- The snow cap is a height rule per weapon, not hand-painted: small parts above the line are fully white.
- Hydro Dip keeps animating at distance and in the Locker; there is no per-distance fallback beyond Chromebook mode.
- Headless Chrome on the development iGPU is not a performance benchmark; no physical Chromebook was measured.
