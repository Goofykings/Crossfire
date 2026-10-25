# Testing

## Unit tests (`npm test`, Vitest in Node)

| File | Covers |
|---|---|
| `tests/movement.test.ts` | settling, acceleration/friction, sprint, jump height, no double jump or auto-hop, frame-rate independence (30 vs 144 fps), wall stop and slide, no tunnelling at absurd speed, stairs up/down, ledge needs a jump, crouch under low ceilings, rotated-box raycasts |
| `tests/map.test.ts` | layout structure (all 8 building types, both safe zones at opposite edges), safe-zone entrances (on the zone edge, standable ground outside, protection starts exactly at the barrier plane, no old sign props), spawns inside their zone and on clear ground, every passage open, ≥ 98% of walkable cells reachable for a player-sized body on the real `collision.json` |
| `tests/safezones.test.ts` | damage allowed outside zones, blocked for attacker or target inside, boundary straddling counts as inside, zone height, dead targets |
| `tests/weapon.test.ts` | fire rate, reload accounting, auto-reload, empty clicks, ADS blend and spread, no fire while sprinting, spread cone |
| `tests/settings.test.ts` | persistence, clamping/validation, corrupted or missing storage, change notifications |
| `tests/settingsDraft.test.ts` | draft vs applied settings: edits touch neither the game nor localStorage, Back (discard) restores, Apply commits all changes in one notification and saves, edits after Apply stay drafts, validation, Defaults are a draft, F3-style external changes, no write on open/close |
| `tests/geometry.test.ts` | z-fighting: loads every exported town GLB (shells, kit instances, terrain), finds same-facing triangle pairs within 2 mm of one plane that overlap, and bounds them (sills, shutters, terrain, door surrounds: 0; total < 1 m²). Re-breaking the sill fix measured 104 m² and failed it |
| `tests/assets.test.ts` | every map model exists and is non-trivial, GLB materials exist in `materials.json`, weapon `muzzle`/`sight` and target `plate` nodes, prop models for every layout prop, all textures on disk, all 16 catalogue buildings |

Current result: 62 tests passing.

## Asset verification (`npm run assets:verify`)

Checks all 82 manifest entries exist and are non-empty, every GLB parses with meshes and known materials, every
texture referenced by `materials.json` exists, and each map's model list and prop types resolve.

## Browser test (`node tools/browser-test.mjs`)

Runs the real game in headless Chrome/Edge (GPU via ANGLE) with `?autoplay`, then:

1. all GLB materials resolve, no console errors
2. walks out of the blue spawn through the gatehouse passage
3. walks into the gatehouse wall and stops at exactly the body radius
4. climbs the north-lane stairs onto the 0.72 m terrace
5. aims and fires at a practice target: shots, hits and a knock-down are registered
6. stands in the blue safe zone, is detected as inside, fires at the protected target: no damage; all 6 entrance barriers and labels exist; protection starts exactly at the barrier plane (z = -7.45 outside, -7.2 inside)
7. prints FPS and draw calls; `--shots` saves screenshots of eight viewpoints to `test-results/`

Run against the dev server (`npm run dev`) or the production build served under a sub-path
(`node tools/serve-dist.mjs`, then `--url http://localhost:4174/crossfire/`). Both pass.

## Performance (`node tools/perf-test.mjs`)

Measured 2026-10-25 on an **Intel Iris Xe (laptop iGPU)**, Chrome headless, D3D11, 1920 × 1080, uncapped:

| Graphics / shadows / resolution scale | Plaza | North lane | Long view | Draw calls |
|---|---:|---:|---:|---:|
| Low / Off / 75% | 95 fps | 90 fps | 100 fps | ~126 |
| Low / Low / 100% | 57 fps | 65 fps | 64 fps | ~126 |
| Medium / Medium / 100% | 45 fps | 49 fps | 45 fps | ~130 |
| High / High / 100% | ~25 fps* | 25 fps | 29 fps | ~400 |

\* the first High sample is distorted by shader compilation for SSAO.

At 1600 × 900 the Medium preset reaches the 60 fps vsync cap on the same iGPU. A mid-range desktop GPU is several
times faster than this iGPU, so 60 fps at 1080p on Medium/High is expected there, but it has **not been measured**.

Scene budget after batching: ≈ 570k vertices in ≈ 140 meshes; load time ≈ 6.5 s (dev server, local disk).

## Settings menu (`node tools/settings-test.mjs`)

Drives the real UI in headless Chrome with mouse and keyboard (dev server running; also passes against the built site under `/crossfire/`):
no native selects and no light control backgrounds; edits on all three tabs stay in the draft while the applied settings, the audio
system and `localStorage` are untouched; tabs keep edits; Back discards and the reopened menu shows the applied values; Apply updates
settings, audio, FPS counter and (from the pause menu) the live field of view, saves, keeps the menu open and goes inactive; a new edit
after Apply is a draft again; Escape closes an open dropdown first, then acts as Back; a reload restores saved values; invalid saved
values fall back; entry from both the main menu and the pause menu; keyboard control of tabs (arrows/Home/End), sliders, the dropdown
(Enter/arrows/Escape) and switches (Space). Screenshots go to `test-results/settings/`. Not covered: touch input, other browsers
(Firefox slider styling uses the `-moz-` rules and was not run).

## Z-fighting checks

Geometry audit, `node tools/dev-zfight.mjs` (dev server running): dumps every baked triangle (`__crossfire.dumpBatches()`),
finds same-facing, overlapping pairs within 6 mm of one plane (tier 1: under 2 mm, will fight at normal distances; tier 2:
only at long range), ignores pairs from one piece with one material (pixel-identical) and groups the rest by source piece.
Baseline before the fixes: tier 1 = 114 families / 355 m², tier 2 = 40 / 53 m². After: tier 1 = 23 / 0.7 m² (each family
a few cm² of trim or gutter slivers), tier 2 = 26 / 1.2 m². `--explain "<family>"` prints the actual triangles.

Flicker test, `node tools/dev-jitter.mjs` then `python -I tools/jitter_analyze.py`: renders 30 views eight times with the camera moved
0.4 mm per frame along its view direction (changes depth values, barely moves the image) and counts pixels that change by
more than 40/255 away from edges. A z-fight rewrites its pattern; stable surfaces do not. A deliberate probe (two coloured
quads 3 µm apart, `__crossfire.fightProbe`) is included as a positive control: it changes in 22% of its flat pixels. All real views
change in 0 pixels except one thin edge line against the sky (`roof_edges_up`, 245 px, anti-aliasing). Views cover stair tops,
sills, passage walls, gates, door plinths, cornice corners, ground inlays, props and the (alpha-blended) safe-zone barriers.
Limits: 8 frames per view at one resolution on one GPU (Intel Iris Xe); it checks what is in those views, not every corner of the map.

## Development helpers (`tools/dev-*.mjs`)

Need a running dev server. `dev-shot.mjs` / `dev-freecam.mjs` (screenshot from a camera), `dev-ui-shots.mjs`
(menu, settings, HUD, ADS, safe zone), `dev-sun-sweep.mjs` (find the sky's sun heading),
`dev-mirror.mjs` (mirror sphere to check IBL alignment), `dev-inspect-batch.mjs` (vertex/material data of batches).

## Not covered automatically

- Pointer lock, Esc-to-pause and the resume flow (headless browsers cannot lock the pointer).
- Audio output (sounds load and play without errors, but nobody listened in CI).
- Real-mouse feel of sensitivity and recoil.
