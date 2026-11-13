# Weapon rendering fixes (2026-11-12)

Visual only. Combat, protocol (v26), balance, animations, cosmetics ownership and the Worker are untouched. The crate odds and
pool changed on request (see "Crate odds and Shop").

## Root cause

Every firearm GLB was drawn through the **transparent queue**: alpha-blended, no depth writes, sorted back to front per mesh.

- Blender always exports vertex colours as RGBA (`COLOR_0`, `VEC4`, alpha 1). Babylon's glTF loader turns a four-component colour into
  `mesh.hasVertexAlpha = true`, and `PBRMaterial.needAlphaBlendingForMesh` then returns true even though the material is opaque.
- Parts of one weapon therefore overdrew each other in sort order instead of by depth. Anything hidden inside another part (the AR
  magazine's brass round, the shotgun's loading shell, magazine ribs, the grip finger grooves) showed through solid surfaces at some
  angles and disappeared at others; it changed while rotating because the per-mesh sort key follows the camera. The same loader serves
  first person, third person, Locker, Shop reveal and thumbnails, so all of them were affected.
- Found with a GL call log (`blend: true, depthMask: false` on the first opaque draw), a ray test (the receiver wall was in front of the
  brass in 3D, yet the brass was drawn over it) and `needDepthPrePass` making the defect disappear.
- The dual daggers have no vertex colours and were never affected.

Fix: `normalizeWeaponMeshes` (src/rendering/CosmeticAssets.ts), called by `loadCosmeticAsset`, switches `hasVertexAlpha` off for meshes
whose vertex alpha is 1 everywhere (meshes with real alpha keep it) so the weapon renders in the opaque pass with the depth buffer. It
also keeps animation-only nodes (`ANIMATION_ONLY_NODES` = `shell`) disabled until an animator enables them. No material is duplicated,
nothing is made double sided and no depth test is disabled.

## Geometry defects fixed at the source (blender/scripts/lib/weapon.py)

- **Shotgun stock**: `solid()` oriented every extruded edge face by "away from the profile centre". On a concave outline that is wrong at a
  reflex edge: the underside notch near the pistol grip was wound inside out (invisible from below under back-face culling, hollow
  looking). Edge faces now take their outward direction from the edge and the outline's orientation; the two caps keep the centre test
  (they point along x). tools/weapon_face_classes.py reports 0 flipped faces for every weapon (it was 1).
- **Optic glass** (AR sight window, semi-auto sniper scope glass): a single pane facing the shooter vanished seen from the muzzle side.
  `glass()` adds a second pane 0.4 mm behind it facing forward (a coincident reversed copy is welded away by the exporter). The blended
  material draws without depth writes, so the pair costs nothing visible; first person sees exactly the same pane as before.
- Hidden internals (the brass rounds inside the receivers, the shell) are left in the models: with the opaque pass they are occluded
  correctly, and the shell is a real reload prop.
- Regenerated: rifle.glb, shotgun.glb, semi_sniper.glb (smg.glb, sniper.glb, hands.glb and the daggers are byte for byte unchanged).
  The Foundry collection's base hashes were refreshed.

## Locker preview (src/ui/CosmeticPreview.ts)

- The camera orbits a target at the model's bounds centre; the model itself is never rotated or transformed, so there is no transform
  corruption. Depth planes are fitted to the model after every resize (`minZ = radius * .05`, `maxZ = radius * 30`).
- The key light follows the camera (above-left of the viewer) so every angle is lit like the default view; a world-fixed light left the
  far side dark and made it look wrong from there.
- One scene per open preview, disposed on close (scene, engine, canvas, resize listener). Reload-only parts are hidden.
- Review hooks: `setAngles(azimuth, elevation)` and `debug` (used by the lab and tools below).

## Tools and tests

- `tools/preview-lab.html` / `preview-lab.ts`: the real CosmeticPreview in a bare page (`window.__previewLab`: `open`, `shot`, `pick`,
  `only`, `state`, `project`, `nodes`). `shot(az, el, diagnose)` can also render a per-triangle id map with back-face culling on and off;
  triangles that appear only with culling off are missing or flipped faces (open tubes and single-sided panels show up there by design).
- `node tools/review-weapon-angles.mjs <vite url> [--ids a,b] [--diagnose] [--sweep] [--full] [--name x]`: ten required angles (right, back,
  left, front, top, bottom, four three-quarter views) plus an eight-step rotation sweep, one contact sheet per cosmetic in
  test-results/weapon-angles/. Needs the Vite dev server.
- `python -B -I tools/weapon_face_classes.py [weapon]`: ray-parity face audit of every closed solid (exit 1 on a flipped face);
  `tools/weapon_mesh_audit.py`: weld-based open edge / winding report.
- `tests/weaponRendering.test.ts` (loads defaults and five skin families through the real loader with NullEngine): no mesh in the
  transparent queue unless its material is translucent; the normalisation unit test; shell hidden; valid positions, normals, indices,
  bounds, materials and finite transforms; anchors and moving parts; optics present; glass visible from both sides; python face audit;
  Shop has no contents list; Locker depth range and cleanup. Disabling the fix makes the first and third of these fail.

## Crate odds and Shop

- `CRATE.distribution` is Uncommon 50, Rare 37, Epic 10, Legendary 3 (it sums to 100). The Epic families (Hydro Dip Nebula/Inferno/Abyss
  for the five guns, Darkness for all six categories, 21 items) carry `crate: true` in `EXTRA_COLLECTIONS` and join the pool, so the Epic
  tier can drop (pool 57 items). Blossom, Carbon Fiber and Frosted are still outside the crate. `drawCrate` is unchanged (renormalises
  over rarities with unowned items); the server draw uses the same shared function.
- The Shop no longer renders the crate-contents list (heading, container and CSS removed); it keeps the crate image, the open button
  with the price, the status line and the ODDS block printed from `CRATE.distribution` in the existing rarity colours.

## Verification (2026-11-12)

In Chrome (real CosmeticPreview via the lab, Intel Iris Xe), every one of the 78 catalogued cosmetics was rendered at the ten required
angles (right, back, left, front, top, bottom, rear-right, rear-left, front-left, front-right) with no console or network errors
(`all-<id>.jpg` sheets), and the six defaults additionally through the eight-step 20..335 degree rotation sweep. Back-face-culling
on/off comparison, worst angle per default weapon, differing pixels out of 518,400 (the AR was 26,253 before the fix):

| Weapon | Worst view | px | What remains |
|---|---|---|---|
| AR | top | 133 | steel tube ends (rifle_primitive1) and the glass pane's reverse side |
| SMG | bottom | 35 | open tube ends |
| Sniper | sweep 245 | 73 | two faces of one scope part (sniper_primitive3) seen from behind |
| Shotgun | sweep 200 | 170 | two downward faces of a small steel part (shotgun_primitive1), a few receiver cap pixels |
| Semi-auto sniper | front-left | 254 | rim of the scope's objective bell (semi_sniper_primitive2, open tube end) |
| Dual daggers | sweep 245 | ~1,300 over two blades | the grip collar ring (dagger_*_mesh_primitive3) and small accents |

These are single-sided tubes and rims whose far side is never exposed to a viewer outside the model; none shows as a missing part in the
sheets. Checked by eye: the contact sheets of the AR, shotgun, semi-auto sniper, Hydro Dip Inferno AR, Frosted shotgun, Darkness sniper and
daggers and the default daggers' sweep; at full size the AR, shotgun (stock grain on both sides) and Frosted AR/sniper (snow cap and
icicles survive). The other cosmetics were rendered and error-checked but not each inspected by eye. First person: tools/skins-game-test.mjs against the dev server, 25 of 25 (all families on the
first-person gun, Hydro animation, Frosted flurry, Darkness daggers, Chromebook shader path). Shop: 1280x720 screenshot shows the crate, the
button and the four odds only.

Remaining limits
- The lab's top and bottom views crop the dagger pair (framing of the review camera only; the Locker camera is unchanged).
- Third person, Shop reveal and Chromebook rendering use the same loader and were covered by the loader test and the in-game test, but
  were not stepped through frame by frame in this pass. Real-Chromebook frame times were not measured.
- tools/crate-browser-test.mjs (needs the local Worker and a built dist) was updated for the new odds and the missing list but not run.
- Public Cloudflare behaviour was not validated; the frontend and the Worker need a matching release (crate pool and odds are shared code).
