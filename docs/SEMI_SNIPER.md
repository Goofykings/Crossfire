# Semi-Auto Sniper

## Playable integration (2026-11-09)

The original model is now the fifth playable firearm. Existing AR, SMG, shotgun,
bolt sniper, melee, slide passages and recent character/viewmodel animation work
are preserved. Runtime ID: `semi-sniper`; original asset filename: `semi_sniper.glb`.

| Property | Final value |
|---|---|
| Magazine / reserve | 15 / infinite |
| Fire mode | Semi-automatic; one shot per distinct press |
| Nominal maximum | 567 RPM = current AR 630 RPM × 0.9 |
| Minimum interval | 105.8201 ms; fixed-tick simulation may round upward, never borrow cooldown time |
| Body damage | Independent authoritative integer roll: 32, 33, 34 or 35 |
| Head damage | Exactly 50, replacing the 1.5× multiplier |
| Range / falloff | 500 m / none (body damage remains 32–35 throughout valid range) |
| Camera recoil | 1.35° pitch, 0.32° yaw; current AR-style ADS attenuation and recovery |
| View kick | Stats 12; model impulse 1.5 (between AR and bolt sniper) |
| ADS entry / exit | 220 ms |
| ADS power | 1.5× AR optical magnification at the current world FOV |
| Reload / empty reload | Current AR magazine handling: 2.1 / 2.6 seconds |
| Movement clearance | 1.21 m (AR 1.12 m + the model's approximately 9 cm extra barrel) |
| Hip / ADS spread | 2° / 0.035°, with existing movement/bloom rules |

ADS uses `2 atan(tan(AR_ADS_FOV / 2) / 1.5)`, rather than multiplying angles.
World FOV 70/90/110 gives ADS FOV 39.0361/51.6875/65.5463 degrees. The independent
90-degree viewmodel projection and optical sight anchor remain unchanged. The
world stays visible around the optic; no sniper overlay, weapon hiding, scope
sway or scroll zoom is enabled for this firearm.

`Weapon.ts` remains shared by Worker, client prediction and Practice. The server
derives press edges from held input and validates sequence/time budgets; no shot,
damage, camera origin or ammo claim was added to the client protocol. Semi-auto
cooldown does not use the existing automatic-gun fractional carry. Existing guns'
definitions and automatic timing are unchanged. Fixed head damage is resolved by
the common `DamageSystem` from authoritative weapon identity, so Worker, bots and
local targets cannot accidentally apply an extra multiplier.

The real GLB uses AR-compatible grip/stock/magazine anchors, existing rifle action
clips, current first-person weapon-lowering reload and third-person hand IK. New
moderate recoil presets, casing/flash/trail presentation and an original distinct
WAV follow the existing event/audio paths, including remote and spectator views.
Regenerate only the new sound with `python -B -I tools/make_audio.py --semi-sniper-only`.
The new optic uses its alpha-cutout material in third person and Locker instead of
the GLB's opaque white placeholder; first person retains the additive reticle.

The fifth loadout card has a real model thumbnail and magazine/range information.
Slot 5 defaults to Digit5/Numpad5 where switching is already permitted; existing
one-gun-per-life multiplayer rules remain. Missing saved bindings migrate without
stealing custom keys. Home preview/last-used persistence, remote preload, icons,
spectating, bot selection and switching include the new weapon. All four bot
difficulty settings and Practice's no-rewards/no-statistics policy are unchanged.

Cosmetics have a sixth equipment category internally, grouped under **Sniper** in
the existing Locker filter. The Common default uses the original gold model and
is automatically normalized into old and new inventories. Six existing material
collections reuse their textures on this GLB (including `gun_gold`), with normal
ownership, equip persistence and crate selection. Existing rarity odds, price,
availability, gem balances and other equipment are unchanged. Regenerate the
reviewable catalog with `node tools/export-cosmetics.mjs`.

WebSocket protocol **v23** is required for the new weapon enum/metadata. Release
matching frontend/assets and Worker through the existing backend-first workflow
when authorized. No Durable Object migration, origin/URL change, new credential or
dedicated-server migration is required. The dedicated server remains a transport
scaffold. Local tests do not establish successful public Cloudflare deployment.

Verification and actual final results are recorded in `PROGRESS.md`. Browser QA:
`tools/semi-sniper-browser-test.mjs` against a build configured for an isolated
local Worker (test origin `http://127.0.0.1:4200`, WS `ws://127.0.0.1:8788/ws`).
It uses two genuine guest profiles, room admission, WebSockets and inventory;
no fabricated multiplayer data. Screenshots: `test-results/semi-sniper/game/`.
Headless Chrome verifies Web Audio playback starts, not physical speaker quality.

## Original model handoff (2026-11-08)

An original gold marksman rifle that sits between the AR and the bolt Sniper. The
handoff below records its original asset contract and review; gameplay integration
is described above. No commit, push or deployment has been performed.

Inspired by the Deadshot "Semi-Auto Sniper" card (`references_images/deadshot_gun_selection.png`):
gold receiver, handguard and stock, dark barrel, brake, rail and magazine, black optic.
The geometry is original; it is not a copy of the reference.

## Files

| Path | What |
|---|---|
| `public/assets/models/shared/weapons/semi_sniper.glb` | The model (shared-material GLB like the other weapons, 1962 triangles, 164 KiB) |
| `public/assets/models/shared/weapons/semi_sniper-thumbnail.png` | 960 x 460 transparent Blender render for the Locker/Shop card |
| `blender/source/semi_sniper.blend` | Editable source (preview materials, same naming as the GLB) |
| `blender/scripts/lib/weapon.py` | `semi_sniper()` builder (+ `_slab`, `_panel`, `_rect`, `_rail` helpers); added to `WEAPONS` |
| `blender/scripts/generate_semi_sniper.py` | Writes only the GLB, the .blend and their manifest rows (SMG precedent) |
| `blender/scripts/render_semi_sniper.py` | Review renders: side, three-quarter, rear, top, thumbnail, lineup with the AR and Sniper |
| `blender/scripts/lib/materials.py`, `public/assets/materials.json` | New material `gun_gold` (same metal ORM as the other guns; no new texture) |
| `tools/review-semi-sniper.mjs`, `tools/cosmetic-asset-lab.ts` (`?semi`) | Real-rig review (below) |
| `tests/semiSniper.test.ts` | Anchor / butt pad / length / material / triangle checks |

Regenerate: `blender -b --factory-startup --python-expr "import sys; sys.dont_write_bytecode = True" -P blender/scripts/generate_semi_sniper.py`
(no tracked `.pyc` changes), `python -B -I` with `materials.write_manifest(Path('public'))` after editing `gun_gold`.
`npm run assets` / `--only weapon` now also exports it, but `weapon.blend` was **not** regenerated.

## Model contract

Game space like every weapon: metres, +x right, +y up, muzzle toward -z, stock +z, origin at the
centre of the pistol grip where the right hand closes. Root node `semi_sniper` (the body mesh) with
child `mag` and anchor empties. Identity rest transforms; no scale.

| Anchor | Position (x, y, z) | Use |
|---|---|---|
| `muzzle` | 0, 0.062, -0.749 | flash and tracer origin (AR -0.66, Sniper -0.855) |
| `sight` | 0, 0.1355, -0.049 | ADS eye point = optical axis at the rear lens (AR 0.1375, -0.049) |
| `eject` | 0.0178, 0.064, -0.055 | case ejection, on the receiver's right face |
| `grip_r` | 0, -0.05, 0.03 | right hand (same as the AR) |
| `grip_l` | 0, 0.032, -0.33 | support hand on the handguard (same as the AR) |
| `mag_grip` | 0, -0.12, -0.085 | left hand takes the magazine (same as the AR) |

Moving parts: only `mag` (rest identity, same footprint as the AR magazine, so `rifleClips` and the
reload hand work apply). No `bolt`/`pump`/`shell`. Bounds: body x -0.0405..0.0343, y -0.127..0.172,
z -0.749..0.348 (length 1.097 m; AR 1.004, Sniper 1.262); magazine y down to -0.202.
**The rear-most z is the rubber butt pad at z = 0.348, y -0.04..0.094, identical to the AR**, which is
what `measureButt` reads, so the ADS shoulder pocket and head weld behave as for the AR.

Materials (all defined in `materials.json`): `gun_gold` (receiver, handguard, stock, grip, floor plate,
turret caps), `gun_black` (rails, optic, rings, gas block, brake, hand stop, magazine), `gun_steel`
(barrel, brake ports, ribs), `gun_polymer` (cheek riser, stock panels), `gun_rubber` (butt pad, grip
panels), `gun_glass` (scope end glasses), `reticle_holo` (one quad inside the optic), `sight_dot`, `brass`.
12 draw calls first person (AR 10), 15 with the character; render CPU about 1 ms in headless Chrome.
No new textures, so Chromebook mode needs nothing extra (gold reads correctly with reflections off).

Design: lower/upper receiver with ejection port, deflector, side charging handle, selector, bolt catch
and magazine release; 28.5 cm free-float octagonal handguard with vent slots, hand stop and a long top
rail; heavy barrel, gas block with front sight blade, slotted 12.5 cm brake; fixed stock with a cheek
riser, belly and side panels; AR-outline grip with rubber panels and finger bumps; open 4x-style scope
(eyepiece flare with an eyecup rim, tube, objective bell with a recessed lens, elevation/windage turrets,
two-ring mount; see "Scope fix (2026-11-10)" for how the openings are built) over a curved dark magazine with a gold floor plate.

## Scope fix (2026-11-10)

Symptom: the optic looked incomplete. From behind (hip fire, third person from the rear) the eyepiece end was an
open hole with the world showing through it; from the front the objective was hollow; in ADS a large pale disc
surrounded the dark ring.

Root cause (found with `tools/scope-probe.mjs`, which hides the view-model primitives one at a time in the real
game, and `tools/scope-shots.mjs` / `tools/scope-orbit.mjs`): the tubes are single-sided meshes (outward faces,
back-face culling on), so any surface seen from the inside is culled.

- The eyepiece flare narrows away from the shooter. Seen from behind it is a funnel, and a funnel's inside is a
  back face: it never rendered, so the rear of the scope was a see-through hole. Only the objective bell (which
  widens away from the shooter and so faces the eye) rendered, as a detached ring.
- The two end "glasses" were single-sided `gun_glass` discs (alpha 0.16), one at the eyepiece 0.21 m in front of
  the ADS eye and one at the objective. The eyepiece one is the pale disc: at that distance it spans about 80 px
  and it is wider than the optic body around it. The objective one faces the shooter, so from the front it was
  culled and the bell was hollow.
- Not the cause: missing meshes, materials (all 13 primitives and 9 materials exported), near-plane clipping (the
  weapon group uses 0.012), frustum culling (`alwaysSelectAsActiveMesh`), attachment or ADS alignment, presets.

Fix (`semi_sniper()` in `blender/scripts/lib/weapon.py`, new material `scope_glass`, `ztube(..., inward=True)`,
`_ring()`): the eyepiece funnel also has inward faces (a dark funnel seen from the shooter), a rubber eyecup rim
faces the shooter at the funnel mouth (outer radius 24 mm instead of 27 mm, so ADS keeps its peripheral view), a
faint double-sided `scope_glass` (alpha 0.07) sits at the funnel's throat instead of the big disc, and the
objective has a front rim, a recess wall and a dark `gun_lens` disc facing forward (the same lens material as the
bolt sniper). Inside the tube nothing blocks the view, so the sight picture is still the reticle and the world.
Tubes are 16-sided; 2122 triangles (AR 1836, Sniper 1936; the test limit moved from 2100 to 2200). Stats, ADS
optics, the reticle quad and every anchor are unchanged; the thumbnail was re-rendered.

Checked in the real game (Practice, `tools/scope-shots.mjs`: hip, ADS, reload at High, Low and Chromebook mode)
and in the lab (`tools/review-semi-sniper.mjs`: Locker, third person, third-person ADS, front).

## Original integration handoff (historical)

Rig presets reuse the AR; every value was verified with the real classes:

- `WeaponView.RIG_CONFIGS`: `hip [0.22,-0.24,-0.4]`, `hipRot [0.03,0.09,-0.06]`, `eye 0.21` (the
  sight-to-eye distance; the reticle was centred to within a pixel), `casing 'casing_rifle'` (a
  larger case would need a new `casings.glb` entry), `flash` about 1.2, `kick` between the AR (1) and
  Sniper (2): choose with the balance pass. The model is heavier than the AR, so a slightly larger kick,
  motion weight and recoil is appropriate; none of that was changed.
- `CharacterWeapon.WEAPON_HOLDS`: start from `rifle` (`ready`, `ads` at `[-.095,.03,-.1]`, both hand
  holds, `index`, `trigger [0,-.012,-.027]`; the trigger blade is at the AR position). Measured hand
  gaps stayed below 1 cm in ready and ADS, and the head welds to the scope in ADS.
- `CharacterActions.ts` clip map: use `rifleClips` (same magazine and `mag_grip`).
- Places that list weapons (grep `smg`): `Weapon.ts` (`WeaponId`, stats, `WEAPONS`), `RemotePlayers.ts`
  preload list, `HomeCharacter.ts` ids, `UI.ts` labels/cards, `WeaponIcons.ts` silhouette, `PlayerController.ts`
  weapon move table, `AudioManager.ts` shot sound, `shared/cosmetics.ts` (`WEAPON_CATEGORIES`,
  `WEAPON_MATERIALS` must list `gun_gold`, default cosmetic, collections), `export-cosmetics`/`verify-cosmetics`.
  Skins override `gun_black`/`gun_fde`/`gun_wood`; the gold body is `gun_gold`, so a skin set must patch it.
  Protocol/ammo/damage belong to the balance task; the reference card says Ammo 8, Range Long.
- Locker: `semi_sniper-thumbnail.png` is the preview; the 3D preview uses the GLB through
  `loadCosmeticAsset` like the other weapons.

## Verification (2026-11-08)

`node tools/review-semi-sniper.mjs http://127.0.0.1:4210/` (Vite dev server) loads the model through
`cosmetic-asset-lab.html?semi`, which stages an in-memory definition on the AR (`rifle`) rig: the real
`WeaponView`, `CharacterWeapon`, character and Locker loaders, at the game's 90 degree viewmodel FOV.
All 11 contexts pass (locker, side, front, hip, ADS, reload, recoil, walk, third person ready/side/ADS),
one renderer, no console or HTTP errors, hand gap < 1 cm; images in `test-results/semi-sniper/browser/`,
Blender views (including the lineup) in `test-results/semi-sniper/blender/` (ignored artifacts).
`npm run assets:verify`, `tests/assets`, `materialQuality`, `cosmeticAssets`, `geometry` and the new
`semiSniper` test pass. The lab is dev-only, grants nothing and never contacts inventory.

## Known issues and decisions

- **`solid()` only handles convex profiles.** A concave profile gets some faces flipped by its centroid
  test, which shows as a hollow stock/receiver from one side. Found while building: the stock and the lower
  receiver here were split or simplified to convex pieces, and the review confirmed solid sides. The AR's
  stock and lower receiver profiles are concave and show the same hollow side in the lab; that existing
  model was not touched.
- **Original white sliver in Locker and third person (fixed for this weapon during integration).** `CosmeticAssets.patchCosmetic` previously skipped `reticle_holo`, so
  outside `WeaponView` the GLB's plain white blend material shows as a thin vertical slit at the reticle
  quad. The new weapon now uses the authored alpha-cutout material there. The AR
  retains its prior behavior. First person and ADS use the proper additive reticle.
- Side details (vents, port recess, grip and stock panels, brake ports) are 2.5 mm proud, not the usual
  0.6 mm: at 0.6-1.5 mm they flickered in and out with the camera angle at review distances on this machine's
  depth buffer. Existing weapons' 0.6 mm details have the same limit.
- The model itself has no separate magnifying render target; current ADS uses the optical FOV calculation above.
  (The faint circular tint that used to surround the eyepiece in ADS was a defect; it is gone, see below.)
- Blender renders use the flat preview materials, so the thumbnail is paler than in game. The game
  render (reflections on and off) is the reference for colour.
- No physical Chromebook run; budget numbers are from headless desktop Chrome on an Intel iGPU.
