# Update Phase 2: geometry and Industrial roof traversal

This update extends the existing compact layouts and shared collision/controller
pipeline. It does not change room scheduling, combat, protocol v10, hosting,
frontend environment variables, Vite configuration, textures or lighting.

## Geometry fixes

The facade generators emitted a single exterior face per wall cell. They now
also emit an inward-facing skin 12 cm behind it, inside the existing solid
building footprint. Existing room walls, reveals, corners, roofs and ground
close the skin. Repeating caps on every cell caused overlap with sills and
lintels during development; those redundant caps were removed. Exterior
surfaces, their colors and UVs stay in place. Freestanding terrain walls already
had thickness; they retain it. Backface culling is not globally disabled.

Town's **B22** curved arcade spans **x=10..14, z=1..6**; travel is east/west.
Its visible crown is 3.2 m high, but collision used a full-width 2.6 m ceiling.
The four suspended Town arches similarly used full rectangular overhead slabs.
Collision now follows narrow conservative slices of the same planar arch
profile used for rendering, preserving the masonry instead of removing its
collider. The maximum approximation is a few centimetres; adjacent slices
overlap by 0.1 mm to avoid export-rounding seams. Stone gate spandrels retain
collision too. Industrial/City overhead structures retain their structure
collision without the old unnecessary 1.5 m vertical envelope.

Existing ground-level doorway/arcade passage tests passed before the changes;
the confirmed arch defect was incorrect headroom. New tests exercise complete
jumps through B22 in both directions, as well as empty crowns and solid masonry.
No separate, unidentified ground-level obstruction is claimed to be reproduced.

The arbitrary-axis tube frame winds its rings toward the start, but its cap
faces were reversed. Correcting the winding fixes outward end normals. The
Industrial pipe bundle additionally has real annular rims and inward-facing
bore surfaces at both ends, retaining its placement, diameter and materials.
Affected map/prop GLBs and editable map/props `.blend` sources were regenerated.

## Ladders and roofs

Random Industrial facade ladders previously started 2.6 m above ground and had
no traversal definitions or usable roof collision. Industrial now has three
authored ground-to-roof service ladders, replacing those random decorations:

| Access | Wall anchor (x,z) | Outward direction | Roof height |
| --- | --- | --- | --- |
| Loading west | (2, 8.4) | west | 4.5 m |
| Loading north | (10, 7) | north | 4.5 m |
| Loading south | (8.3, 14) | south | 4.5 m |

The ladder stands off the wall on real brackets, with the player's climb line
1.65 m outside the facade. This provides clearance for the existing longest
weapon without retracting it or disabling weapon collision. The top landing
stops before the shaft; the body never climbs through a ceiling slab.
Hold the configured forward action to ascend at up to 2.4 m/s, release to hold
height, and hold backward to descend. Forward at the crown walks onto the
landing; backward at the landing moves clear before descending. Strafe leaves
the shaft; Jump gives a predictable outward jump and inhibits reattachment
until landing. Ordinary collision/substeps continue to bound all movement,
including unexpected ceilings. Sliding does not enter the ladder branch.

The mode is derived each fixed tick from authoritative map regions, position
and input. It requires no new client-supplied position/state, network message,
per-player timer or persisted field. Existing snapshots, replay and hitboxes
already synchronize the vertical pose and retain it across session resume.
Remote rendering uses the existing airborne animation; this phase does not
add a dedicated hand-over-hand climbing animation.

Three existing low shed footprints (**I31, I32, I34**) become joined service
decks. Their ground routes, footprints and walls remain. The three approaches
provide alternative access/exit paths; the route stays inside the map boundary.
HVAC, fan, vent/pipe and utility-box equipment leave the main crossing and
ladder landings clear. Decks, landings, rails and equipment collision come from
the same `industrial_roofs.parts` definitions as the Blender export.
The dressing pass reserves ladder approaches before targets/spawns are chosen.

## Files

- Runtime: `src/player/PlayerController.ts`, `src/physics/CollisionWorld.ts`,
  `src/maps/types.ts`, `shared/world.ts`.
- Authoring: new `blender/scripts/lib/arch_geometry.py` and
  `industrial_roofs.py`; existing `building.py`, `building_industrial.py`,
  `terrain.py`, `terrain_industrial.py`, `collision_gen.py`, `meshkit.py`,
  `props_industrial.py` and `compact_dressing.py`.
- Layout/tools: `tools/layout_industrial.py`, `tools/compact_diagnostics.py`,
  Industrial `layout.json` and Industrial diagnostic plans.
- Generated outputs: the three maps' GLBs/collision, affected shared prop GLBs,
  asset manifest and four editable map/props `.blend` sources.
- Verification: `tests/updatePhase2.test.ts`, `tools/check-update-phase2.py`,
  `tools/update-phase2-test.mjs`, `server/tests/traversal.mjs`, and the backend
  test script in `server/package.json`.
- Notes: this document, `PROGRESS.md` and `CLAUDE.md`. Earlier Phase 1 working
  changes were preserved.

## Reproduce

From the repository root, in PowerShell:

```powershell
python -IB tools/layout_industrial.py --write
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' -b --factory-startup --python-expr 'import sys; sys.dont_write_bytecode=True' --python-exit-code 1 -P blender/scripts/generate_all.py -- --only props,town,industrial,city
python -IB tools/compact_diagnostics.py industrial-complex
npm.cmd test
npm.cmd run typecheck
npm.cmd run assets:verify
npm.cmd run build
$env:XDG_CONFIG_HOME = $env:TEMP
npm.cmd --prefix server run typecheck
npm.cmd --prefix server test
```

`server/tests/traversal.mjs` uses two real TCP WebSocket clients on workerd.
Only initial positioning uses the test-only fixture; actual input causes all
climbing, holding and descending. It checks peer synchronization and genuine
mid-ladder reconnection without identity/life/weapon/health resets.

For local interactive play, start these in separate PowerShell terminals:

```powershell
Set-Location C:\Users\Public\Crossfire
npm.cmd --prefix server run dev
```

```powershell
Set-Location C:\Users\Public\Crossfire
$env:VITE_MULTIPLAYER_PROVIDER = 'cloudflare'
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

These terminal-scoped URL overrides enable interactive local multiplayer;
the existing `.env.local` was not overwritten. Close that terminal to discard
its overrides.
The automated browser test redirects only its own WebSocket connections to an
isolated local Worker, so it needs no change to production configuration:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 4199 --strictPort
# In another terminal:
node tools/update-phase2-test.mjs http://127.0.0.1:4199/
```

For a production Pages-style base path:

```powershell
node tools/serve-dist.mjs --port 4200 --base /crossfire/
# In another terminal:
$env:CROSSFIRE_TEST_OUTPUT = 'test-results/update-phase2-production'
node tools/update-phase2-test.mjs http://127.0.0.1:4200/crossfire/
node tools/compact-maps-test.mjs --url http://127.0.0.1:4200/crossfire/
```

The browser checks use two actual Chrome contexts, rebound forward/back keys,
server/client height agreement, remote render positions and an actual reconnect.
Screenshots include ladder first/third-person views, roof equipment, both pipe
ends and Town/City walls. Existing compact-map tests exercise both stairs and
the established ground flanks on all maps. Inspect results under `test-results/`.

## Release requirements and limits

Frontend assets and the Cloudflare Worker must both be rebuilt and published
together when deployment is authorized. Existing map-version validation rejects
mismatched layout/collision revisions; it has not been relaxed. No deployment
or live Cloudflare validation is performed by these local scripts. The existing
public Worker and Pages site are unchanged until explicitly deployed.

The local build still includes the pre-existing untracked Blender add-on under
`public/assets/weapons/blenderkit`; it was left untouched. It is not used by this
feature. Existing Blender thumbnail-cache/deprecation and Vite bundle-size
warnings are unchanged. Human small-match playtesting remains appropriate for
final rooftop balance; automated traversal is not a balance assessment.
