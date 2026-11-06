# Foundry Collection: staged Blender assets

These are original Crossfire visual assets, not ownership grants. The live catalog,
Shop, Locker, gem balance, scoring, inventory authority and default weapon files
are unchanged by this asset task. The crate remains unavailable. Existing changes
from the preceding Shop/Locker implementation are preserved.

| ID / name | Weapon | Rarity | Design |
|---|---|---|---|
| `verdant-relay` / Verdant Relay | AR (`rifle`) | Uncommon | Muted olive industrial coating, angular masking, sparse edge chips, matte polymer and exposed steel. |
| `blue-current` / Blue Current | SMG | Rare | Deep blue anodized receiver, graphite furniture, raised cyan sweep insert and fine registration details. |
| `crimson-forge` / Crimson Forge | Shotgun | Epic | Oxblood furniture, dark steel, beveled stock badges, receiver inserts and pump-mounted trim. |
| `aurum-meridian` / Aurum Meridian | Sniper | Legendary | Charcoal chassis, modeled meridian inlays, gold objective housing and open optical rings, fine cartographic markings. |
| `foundry-crate` / Foundry Crate | Menu prop | Not a reward item | Beveled alloy case, blue inserts, latches, fixed handle, rubber corner boots and diamond badge. No opening animation or function. |

## Deliverables and handoff

`public/assets/cosmetics/foundry-collection.json` is the concise staged manifest.
Each weapon entry contains a ready-to-integrate `catalogEntry`, source path,
texture paths, original model hash and attachment/rig compatibility metadata.
It intentionally does **not** change `shared/cosmetics.ts` or generated live
`catalog.json`. Integrating/granting these items is a separate authorized task.

Files per weapon are in `public/assets/cosmetics/<category>/<id>/` (`ar` for rifle):

- `model.glb`: self-contained glTF 2.0 with embedded PBR maps, compatible with
  `binding:'embedded'`. No sidecar downloads required to render the GLB.
- `finish-albedo.jpg`: 1024 x 1024, sRGB, original paint/engraving atlas.
- `finish-normal.png`: 512 x 512, linear/OpenGL tangent normal, subtle grain.
- `finish-orm.png`: 512 x 512, linear; occlusion R (white), roughness G, metallic B.
- `thumbnail.png`: 960 x 460 RGBA, transparent background, actual Blender render.

Crate GLB/960 x 700 transparent thumbnail are under
`public/assets/cosmetics/crate/foundry-crate/`. It uses five texture-free PBR
materials. Editable, compressed Blender sources for all five assets are in
`blender/source/cosmetics/<id>.blend`, with packed referenced images, working
materials, UVs, named moving parts/anchors and review camera/lights. Generated
PNG normal/ORM files use palette compression; they decode to the documented
RGB channels without changing shader behavior.

Runtime paths are relative `assets/...` paths for the existing assetUrl loader,
so localhost and GitHub Pages base paths are retained. Defaults remain in
`public/assets/models/shared/weapons/`; do not overwrite them.

## Rig compatibility

All weapon geometry starts from the original `lib/weapon.py` builders. Metres,
+X right, +Y up, muzzle -Z, stock +Z; original body and moving-part rest transforms
and parents are retained. `grip_r`, `grip_l`, `sight`, `muzzle`, `eject` and
category-specific anchors have matching local and world frames within 0.00001.
No visual placement offsets are required. Use the existing RIG_CONFIGS and
WEAPON_HOLDS for each category. No weapon balance or movement settings are read
from this collection.

Decorations stay inside the original overall bounding envelope. Shotgun trim
belongs to the pump mesh and moves with it. Sniper optical rings are open; lenses
and the sight line are preserved. Stock, cheek, butt and hand contact surfaces
retain their original locations. The old shotgun/SMG flat vent details are seated
on their actual bevel-inset surfaces in these variants. New concave badge/sliver
issues were corrected, with zero-area triangles removed before export; no test
threshold was relaxed. UVs have separate physical side islands so text is readable
on either side. No new emissive/glowing decoration was added.

## Rebuild and checks (PowerShell)

```powershell
python -I tools/make_cosmetic_textures.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --factory-startup --python-exit-code 1 -P blender/cosmetics/generate_collection.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --factory-startup --python-exit-code 1 -P blender/cosmetics/inspect_collection.py
node tools/verify-cosmetic-collection.mjs
npm.cmd run assets:verify
```

The generator also supports `-- --only <cosmetic-id>` / `foundry-crate`,
`--samples <count>` and `--no-renders`. `--only manifest --no-renders` refreshes
only metadata. Blender 5.2 and system Python with Pillow were used. No external
download, image generation service or branded artwork is needed.

Development-only game-rig review:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 4201 --strictPort
# In another terminal:
node tools/review-cosmetic-assets.mjs http://127.0.0.1:4201/
python -I tools/cosmetic-contact-sheets.py
```

The separate `tools/cosmetic-asset-lab.html` realm temporarily registers staged
definitions in memory to exercise the actual WeaponView/CharacterWeapon loaders.
It is not imported into the game, never reads account credentials, never calls
inventory/room APIs and grants nothing. It requires no multiplayer backend.

Reports and actual renders are under `test-results/cosmetic-collection/` (ignored
test artifacts): model/texture budgets, source audits, browser render performance,
Blender side/front/quarter views and browser Locker/side/front, first person,
ADS, reload, recoil, walking, character ready/side/ADS and reflections-off views,
plus unchanged Default first-person/ADS reference captures.
The browser checks real hand contact, shader/asset readiness and one renderer.
See the newest PROGRESS.md entry for final test results and measured budgets.

## Limits

This collection preserves Crossfire's existing stylized silhouettes and hand rig;
it is not a replacement weapon engineering/model overhaul. Small markings become
subtle at thumbnail size. Reflection/lighting appearance depends on graphics mode;
there is no expensive new runtime shader or geometry subdivision. Texture memory
is approximately 6 MiB per finish with mipmaps, shared across instances of the same
cached model. No physical Chromebook benchmark or live multiplayer deployment was
performed for these assets. Native desktop browser rig checks are not a claim
that items are owned/equippable in the live game. Future catalog registration and
trusted grants must be implemented/tested separately; purchases remain disabled.
The isolated Default comparison also shows the existing shotgun stock near-plane
clipping; this collection preserves its framing instead of changing view offsets.
The lab's sniper ADS approximation does not include the normal gameplay scope HUD.
