# Testing

Current combat/visibility task: frontend TypeScript and unit tests, backend TypeScript, actual Worker
runtime combat/integration tests and the production Vite/Worker dry-run builds are required.
`node tools/combat-visibility-test.mjs --url http://127.0.0.1:4176/crossfire/` starts isolated real Workers
and independent browser/WebSocket clients in FFA and Teams. It checks real health/HUD changes, scores,
respawn, relative red/blue colors, clear/occluded/partly exposed/distant player visibility, teammate
labels through walls, no duplicate/dead/disconnected bodies and the explicit missing-character state.
It uses actual map geometry and server-spawned sessions; fixture RPC only positions those sessions.
See [combat runbook](MULTIPLAYER_COMBAT.md) and PROGRESS.md for final counts/evidence/limits.

Stage A (2026-10-27): build matching protocol v4 frontend and Worker, then run:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run build
node tools/serve-dist.mjs --port 4176 --base /crossfire/
# In another terminal, while the production server runs:
node tools/stage-a-test.mjs --url http://127.0.0.1:4176/crossfire/
node tools/browser-test.mjs --url http://127.0.0.1:4176/crossfire/
node tools/dev-zfight.mjs --url http://127.0.0.1:4176/crossfire/ --map european-town --eps 0.002
```

The Stage A tool starts an isolated actual production Worker and two independent browsers; it checks
physical Shift/camera timing, speed bounds, limited lowered remote bodies, cooldown/held presses,
idle release/quick repress, Ctrl removal, leaderboard and authenticated reconnection. Rendering captures
cover eight directions around the well plus its rim, all four canopy undersides and all eight benches
across the three maps (Industrial has none). Inspect these captures before claiming visual verification.
`--render-only` skips the multiplayer portion for targeted screenshot work. The z-fight audit now uses
explicit practice with an optional map rather than implicitly joining a random public map.
`tests/stageAProps.test.ts` checks procedural winding/single-sheet fabric, generated double-sided
materials, supported bench feet and solid/prop/stair clearance. Final current counts/results are in PROGRESS.md.

Current UI polish and existing map integration: run `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run typecheck --prefix server` and `npm.cmd test --prefix server`. The frontend suite includes protocol/loadout/scoreboard presentation; the backend suite uses real workerd/SQLite/WebSockets. Start local servers with [server/README.md](../server/README.md), then run:

```powershell
node tools/multiplayer-test.mjs
node tools/prespawn-test.mjs
node tools/prespawn-test.mjs --lifecycle-fixture
```

The first checks independent real movement/reconnect/failure recovery. The second checks normal Play, HTTP online count (0 -> 1 -> 2 -> 1 -> 0), four real asset previews and selectable SMG, pre-spawn/no avatar, approval, weapon lock, settings return, real leaderboard rows/local highlight, unavailable weapon placeholders, background-only edge fade, release/blur and Leave Match. The optional isolated real Worker fixture adds SMG firing/reload/audio, fall elimination, approved respawn, all four actual server-reported weapon icons and actual three-map transitions for two browsers; the test-only RPC is not bundled into production. Fixtures for FFA sorting and Teams grouping are unit presentation tests, not evidence of real Teams gameplay. Unavailable presence displays 0 Players Online with data-available=false; a confirmed zero keeps data-available=true. No fake players or public deployment are used.

Production `/crossfire/` regressions use `tools/home-test.mjs` (five viewport widths, zero pre-Play map/weapon/environment requests, eye-level lightweight Town image, reduced-motion/22-second zoom, blue Play/hover, full wordmark, persistent sliding navigation/faint light gradient, full-screen home Settings/left sidebar, Back semantics, opaque LOADING screen), `tools/browser-test.mjs` (movement/weapons/reloads/headshots/held leaderboard), `tools/maps-test.mjs` and `tools/settings-test.mjs`. Practice tools explicitly use `?practice&autoplay`; normal Play never falls back to practice. The current exact results and remaining match/combat dependencies are in [PROGRESS.md](../PROGRESS.md). Older counts/safe-zone/tactical-overlay descriptions below are historical.

To reproduce the home background, start Vite and run `node tools/capture-home-background.mjs --url http://127.0.0.1:5180/`. It screenshots the existing Town well plaza at eye level into `public/assets/ui/town-plaza.webp`; it does not modify map geometry or load a live map on home.

## Loading cancellation

`tests/cancellation.test.ts` verifies immediate cancellation, late-result disposal, consumed late errors and retained successful resources. After frontend/server builds and starting the existing production preview, run:

```powershell
node tools/loading-cancel-test.mjs --url http://127.0.0.1:4176/crossfire/
```

This uses independent real browser/Worker transports, delays an actual join message and actual asset transfers, then clicks the real Back button while waiting for the server, material definitions, weapon models, previews, map models and a real round transition. It checks the spinner, reduced motion, empty server presence, home state/no stale completion, successful retries and approved spawning. No fabricated players or snapshots are used. Intentional request cancellations can emit browser-level ERR_ABORTED messages; uncaught or other unexpected errors fail the test. The fixture-only round RPC is not in production. `tools/prespawn-test.mjs --lifecycle-fixture`, `tools/multiplayer-test.mjs` and `tools/browser-test.mjs` cover the existing multiplayer and gameplay paths after these changes. The home browser check now expects Back, a spinner and LOADING on the gray screen.

## Guest profiles

`tests/guestProfile.test.ts` covers persistence, separate settings storage, cleared/corrupt data, missing/throwing storage, invalid/Unicode names and rejection of guest IDs as join/session credentials. Worker runtime tests validate server names, reject client-selected identifiers, and verify that an authenticated resume can change the display name while retaining authoritative identity/state.

After frontend and server builds and starting the existing production preview, run:

```powershell
node tools/guest-profile-test.mjs --url http://127.0.0.1:4176/crossfire/
node tools/settings-test.mjs --url http://127.0.0.1:4176/crossfire/ --out test-results/guest-settings
node tools/home-test.mjs --appearance-only --url http://127.0.0.1:4176/crossfire/
```

The profile browser test starts an isolated real Worker runtime and uses actual WebSocket clients. It checks first-visit/blank-name behavior, restoration, draft cancellation and Apply with existing settings, real server names/independent IDs, reconnect/leave/rejoin, blocked-storage multiplayer, cleared/corrupt data and browser errors. It retains only name/key evidence from join frames, never resume credentials. Browser automation uses `tools/guest-profile-helper.mjs` to complete the real first-visit form rather than bypassing setup or creating fake players. Existing development browser helpers also complete that form; their other behavior is unchanged.

## Unit tests (`npm test`, Vitest in Node)

| File | Covers |
|---|---|
| `tests/movement.test.ts` | settling, acceleration/friction, timed slides/cooldown/press handling/steering/replay, jump height, no double jump or auto-hop, frame-rate independence (30 vs 144 fps), wall stop and slide, no tunnelling at absurd speed, stairs up/down, ledge needs a jump, safe slide height under low ceilings, rotated-box raycasts |
| `tests/map.test.ts` | layout structure (all 8 building types, both safe zones at opposite edges), safe-zone entrances (on the zone edge, standable ground outside, protection starts exactly at the barrier plane, no old sign props), spawns inside their zone and on clear ground, every passage open, ≥ 98% of walkable cells reachable for a player-sized body on the real `collision.json` |
| `tests/safezones.test.ts` | damage allowed outside zones, blocked for attacker or target inside, boundary straddling counts as inside, zone height, dead targets |
| `tests/weapon.test.ts` | fire rate, reload accounting, auto-reload, empty clicks, ADS blend and spread, no fire while sprinting, spread cone |
| `tests/settings.test.ts` | persistence, clamping/validation, corrupted or missing storage, change notifications |
| `tests/settingsDraft.test.ts` | draft vs applied settings: edits touch neither the game nor localStorage, Back (discard) restores, Apply commits all changes in one notification and saves, edits after Apply stay drafts, validation, Defaults are a draft, F3-style external changes, no write on open/close |
| `tests/geometry.test.ts` | z-fighting: loads every exported town GLB (shells, kit instances, terrain), finds same-facing triangle pairs within 2 mm of one plane that overlap, and bounds them (sills, shutters, terrain, door surrounds: 0; total < 1 m²). Re-breaking the sill fix measured 104 m² and failed it |
| `tests/assets.test.ts` | every map model exists and is non-trivial, GLB materials exist in `materials.json`, weapon `muzzle`/`sight` and target `plate` nodes, prop models for every layout prop, all textures on disk, all 16 catalogue buildings |

Stage A result: 154 tests passing in 15 files (see PROGRESS.md for final browser/server evidence).

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
