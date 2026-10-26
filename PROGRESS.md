# Crossfire multiplayer update

Updated: 2026-10-25. This is the current continuation record. Stage numbers now follow Part 15 of the user's full "CROSSFIRE - Major Multiplayer, Menu, Match System, and Map Redesign" brief. This supersedes the stage order previously inferred from the shorter request. `docs/UPDATE_PROGRESS.md` describes an older map/weapons update and its stage table is stale.

## Stage 2: multiplayer foundation

Implemented a separate local Cloudflare Worker project in `server/` with its own package/lockfile, Wrangler configuration, generated runtime typecheck, dry-run build and actual workerd/Miniflare integration tests. The frontend's Vite settings and Pages hosting workflow are preserved. Exact PowerShell startup/check instructions are in [server/README.md](server/README.md).

- `GET /health` checks the Worker; `/ws` validates the method, upgrade, exact allowed Origin and canonical route, then uses one SQLite-backed Durable Object named `public-main` for every client.
- Shared versioned protocol and runtime validation live in `shared/protocol.ts`. Clients send bounded input, never trusted positions or scores. The server runs the existing pure controller at 120 Hz, bounded by elapsed server time, validates sequence/order/batch/queue/message rate and size, and broadcasts actual authoritative player state. Generated collision and rotated prop boxes come from a shared pure builder, with matching map fingerprints on both sides.
- Real joins/leaves, opaque server-issued session credentials, live-socket replacement, 15-second resume grace, heartbeat deadlines, expiration cleanup, stored sessions and hibernation attachments are implemented. Closing a socket explicitly completes its handshake. Idle/empty rooms stop the physics timer; deadlines use an alarm. Reconstructing the object preserves liveness timestamps rather than granting an indefinite fresh timeout.
- `src/network/MultiplayerClient.ts` handles connection errors, bounded reconnect/backoff, endpoint validation, per-tab resume persistence, input batching independent of FPS, local prediction and authoritative reconciliation/replay. Idle standing frames are suppressed. Lost connections clear remote bodies and freeze local movement; actual final failures show Retry/Back without practice fallback.
- `src/game/RemotePlayers.ts` renders only real other connected players and interpolates position, yaw and look pitch. Stage 2 uses simple capsule bodies, no teams/name tags/combat presentation. No artificial player entries or successful connections are manufactured.
- The explicit `?multiplayer` entry path uses the configured `VITE_MULTIPLAYER_URL` and a fixed European Town movement-test scene. `?multiplayer&autoplay` is the automation entry point. Practice targets are omitted from that scene's visuals/collision; original practice remains unchanged without the flag. The minimal home still has only CROSSFIRE/PLAY/SETTINGS.
- No 10-minute schedule, randomized rounds, Teams, combat scoring, leaderboard or map expansion was added. There is no public backend deployment. Initial room/session capacity is bounded at 16; only two simultaneous browser clients have been validated, not production load capacity.

Stage 2 validation:

- Backend typecheck passed using Wrangler-generated runtime types; dry-run Worker bundle passed (about 134 KiB uncompressed, 20 KiB gzip). The Worker import graph contains no Babylon or Node-only server modules.
- All 13 local runtime checks passed: HTTP/Origin validation, two-client join, bounded movement/orientation, replay and forged-coordinate rejection, input flooding, disconnect/resume/replacement, idle timeout, active-socket object eviction, full runtime restart/session recovery, explicit leave and expired-credential rejection. These run actual local workerd, SQLite and real WebSockets, not a mock backend.
- Two independent Chrome browser contexts passed the real local Vite/Worker integration test: same canonical room, distinct IDs, exactly two actual players, visible synchronized movement/orientation and interpolated body, automatic authenticated reconnect without duplication, remote removal on leave, offline connection failure with Retry/Back and successful recovery, minimal home preserved, no uncaught browser errors.
- Frontend TypeScript/production build passed; 126 tests passed in 10 files; assets verified (181 manifest entries, 213 materials, all three maps). The existing Babylon bundle-size warning remains.
- Production `/crossfire/` regressions passed: minimal home/title sizing and Settings/Back/Play, all three practice maps, movement/spawns/materials, repeated map-switch disposal counts, settings retained across switches, all weapons/reloads/headshots/scope and the existing held-Tab tactical overlay. Normal practice opened no multiplayer socket and requested no hands asset. No browser errors were reported.
- Test tools are `npm.cmd test --prefix server` and `node tools/multiplayer-test.mjs` (the latter needs the local servers running). Documentation links and whitespace checks passed; production build log is ignored at `test-results/stage2-client-build.log`.

**Stage 2 complete locally. Next unfinished stage is Stage 3: public match system. Stop here.** No commit, push, public deployment or paid infrastructure provisioning was performed.

## Latest focused task: minimal UI, weapon-only reloads, connectivity diagnosis

The user's focused cleanup request supersedes the earlier detailed menu requirements. Keep only CROSSFIRE, PLAY and SETTINGS over the existing 3D background. Do not restore username/loadout panels, map controls, instructional copy or connection-status panels from the earlier brief.

- Replaced the home layout with the full title in the upper-left, a large Play button and smaller Settings button beneath it. Removed map selection and menu-only selection/preloading callbacks, feature copy, captions, hints, decorative panels and static "Multiplayer not connected" text. Kept the 3D orbit background, loading/start flow, settings and runtime map-loading API.
- Removed runtime loading of hand/arm assets and hand/forearm animation, spare magazine cloning and hand-held shell animation. The existing rifle, shotgun and sniper models remain. Reloads lower smoothly over 180 ms, hold during loading and return; shotgun shell phases remain continuously lowered. Magazine limits, infinite reserve, weapon state-machine timing, sounds, HUD and firing pump/bolt actions are preserved. Generated Blender assets were not replaced or regenerated.
- Investigated networking and recorded all eight requested findings, exact current PowerShell frontend commands and the smallest separate-server proposal in [MULTIPLAYER_DIAGNOSIS.md](docs/MULTIPLAYER_DIAGNOSIS.md).
- There is no functioning backend, network client, configured endpoint or game WebSocket attempt. Existing Wrangler/Cloudflare Vite development dependencies do not supply these components. No known public backend is configured; external accounts were not inspected. No shared match or synchronized round clock exists. Play still enters actual local practice; no fake multiplayer connection or client-randomized public match was added.
- Updated existing browser tools for the removed selector/status and new reload motion, keeping map switching and settings regressions runnable.

Verification for this focused cleanup:

- TypeScript check passed; 124 tests in 9 files passed; production build passed with the pre-existing Babylon bundle-size warning; asset verification passed (181 manifest entries, 213 materials, all three maps).
- Production home test passed under `/crossfire/`: exactly three text labels and two buttons; full title and correct layout at 1920x1080, 1280x720, 1024x600, 390x844 and 320x568; Settings/Back and Play work; no `hands.glb` request; zero WebSocket URLs observed; no browser errors.
- Production gameplay test passed: all three weapons' reload dip/return and full magazines with infinite reserve, no visible hand/arm/spare-magazine meshes, rifle reload sounds, pump/bolt cycles, headshots, scope, movement, stairs and the existing held-Tab map. No browser errors. Home and reload screenshots were visually reviewed.
- Production map regression passed for all three maps: actual loading, materials, spawns, movement, tactical overlay and headshot damage; repeated switches returned mesh/material/texture/geometry/light/node counts to the same values, with settings preserved. Production settings regression passed for home/pause entry, draft/Apply/Back, keyboard controls, persistence, live FOV/audio/FPS and corrupted saved data. Both runs had zero browser errors.
- Documentation links and whitespace checks passed. Logs/screenshots are under ignored `test-results/home`, `test-results/cleanup*` and `test-results/ui-cleanup-build.log`.

**Focused task complete.** This task does not implement the proposed backend. Stop here; no commit, push or deployment was performed.

## Inspection and baseline

- Read `CLAUDE.md`, README, architecture, level design, asset pipeline, deployment and testing notes, and the older update log. No `AGENTS.md` or previous root `PROGRESS.md` was present.
- Inspected the existing TypeScript/Babylon game loop, menus/input, map loader/registry/layouts, damage/teammate code, Blender generation dispatch and map generators, and browser/unit test tools.
- The working tree already contained extensive uncommitted changes and untracked map/weapon assets from Claude. Preserve them; no reset, regeneration, commit, push or deployment was performed in this stage.
- Existing working foundation: three registered practice maps with real generated GLBs/collision, map selection/switching, 16 spawns and 24 practice targets per map, movement, three weapons, headshot damage, settings, and a held-Tab tactical map. These are practice systems, not multiplayer.
- No backend, network transport/client, shared public match, round clock, remote-player rendering, player name tags, leaderboard, kill/death scoring or round transitions were found. `TeammateRegistry` is an empty integration interface; it does not establish connections.
- Maps are currently 66 x 66 m (Town) and 68 x 68 m (Industrial/City). There are courtyards/plazas, raised areas/stairs and some ground-floor interiors. Town's centre is a **well**, not the requested fountain. The requested enlargement, wider passages, fountain and accessible second floors remain unfinished; existing files do not establish completion.
- Baseline before edits: TypeScript passed; all 124 tests in 9 files passed; production build passed with the existing Babylon bundle-size warning.
- On this PowerShell host use `npm.cmd`: the `npm.ps1` shim is blocked by execution policy. Browser GPU processes require execution outside the filesystem sandbox; tests use a temporary browser profile, not the user's profile.

## Stage order and status (full brief)

| Stage | State | Remaining work / evidence |
| --- | --- | --- |
| 1. Project inspection | **Complete** | Reviewed existing changes, hosting configuration and reusable gameplay modules. Added [architecture and migration plan](docs/MULTIPLAYER_ARCHITECTURE.md), verified current Cloudflare runtime guidance, and reran baseline checks. |
| 2. Multiplayer foundation | **Complete locally** | Separate Worker/Durable Object backend, real WebSockets, shared protocol, server-simulated movement, interpolated remote bodies, connection/session lifecycle and local runtime/two-browser tests. See the current Stage 2 section above. Not publicly deployed. |
| 3. Public match system | **Next; not started** | The canonical room exists; still needs persisted epoch/seed, 600 seconds active plus a defined short transition, shared random map/mode, accurate late joins, zero-player catch-up and synchronized results/transitions. |
| 4. FFA and Teams | Not started | Team assignment, relative blue-friendly/red-opponent tags with occlusion, server-validated damage, health/elimination, kills/deaths/team scoring, valid separated spawns and respawn. Existing neutral spawn data and pure damage/weapon/movement code are reusable foundations. |
| 5. Home screen and leaderboard | **Partial** | Latest request simplifies the menu to CROSSFIRE/PLAY/SETTINGS and removes map controls; this visual cleanup is implemented. Public Play with real failure handling, held-Tab server scoreboard, authoritative multiplayer HUD and results remain unfinished. Do not re-add older username/loadout panel requirements without a new request. |
| 6. Map improvements | Partial foundation only | All three maps exist, but moderate expansion, varied/wider routes, fountain plaza and limited accessible upper floors remain unfinished. Preserve Blender/assets, add traversal and collision/geometry validation. |
| 7. Validation | Not started as an end-to-end multiplayer stage | Existing practice checks pass. Still needs client + server builds, real multi-client gameplay/round tests, load/bandwidth measurement, map audits and tested independent deployment instructions. |

The earlier focused cleanup was requested independently of the stage order. Stage 2 is now implemented and validated locally; **Stage 3 - Public match system** is next. Do not commit, push, deploy or provision services without permission.

## Stage 1 completion under the full brief

- Reconciled the full brief with the actual implementation; retained earlier code and test evidence without treating placeholders or generated files as multiplayer completion.
- Inspected the configured Git remote and Pages workflow. No live hosting/account configuration was queried; no backend deployment record/configuration was found in the repository. Do not infer that a live backend exists.
- Added `docs/MULTIPLAYER_ARCHITECTURE.md`: existing-to-planned module mapping, Worker/Durable Object boundary, authoritative movement/combat protocol, sessions/reconnection, persisted round schedule with empty-room behavior, staged client migration, security/configuration and test gates for all seven stages.
- Checked current official Cloudflare WebSocket/hibernation, durable storage, alarm, local development and Worker test documentation. Plan is explicitly proposed, not an implemented server. Node-only test/build tooling must stay outside the Worker runtime graph.
- Reran `npm.cmd run typecheck`: passed.
- Reran `npm.cmd test`: 124 tests passed across 9 files.
- Reran `npm.cmd run assets:verify`: 181 manifest entries, 213 materials and all three map asset sets passed.
- Reran `npm.cmd run build`: passed with the existing large Babylon bundle warning; log in ignored `test-results/stage1-build.log`.
- This continuation changes documentation only. No new browser run, server build or multiplayer integration run was performed; no server exists to build/test yet. Prior practice browser checks are retained below as historical evidence.

## Previous home visual pass validation (before the full brief)

- `npm.cmd test` — all 124 tests in 9 files passed again after changes.
- `npm.cmd run typecheck` — passed after changes.
- `npm.cmd run assets:verify` — passed: 181 manifest entries, 213 materials, all three map asset sets.
- `npm.cmd run build` — passed after changes; existing large Babylon bundle warning remains.
- `node tools/home-test.mjs --url http://127.0.0.1:5174/` — passed in real Chrome: all three maps loaded, thumbnails resolved, selected-map details and Play target agreed, keyboard Enter/Tab/Escape navigation, settings/Back, Play to the selected map's start screen, no browser errors, and expanded-chooser layout/control reachability at 1920x1080, 1280x720, 1024x600 and 390x844.
- Desktop and narrow screenshots visually reviewed; screenshots and build log are under ignored `test-results/home/`.
- `node tools/settings-test.mjs --url http://127.0.0.1:5174/` — all checks passed: home and pause entry, draft/Apply/Back, keyboard controls, persistence, live settings and no console errors.
- `node tools/browser-test.mjs --url http://127.0.0.1:4175/crossfire/` — all checks passed against the production build served locally under a Pages-style subpath: asset loading, walking/collision/stairs, rifle/shotgun/sniper, headshots, reload animation/sounds, infinite reserve and held-Tab tactical map. No console errors. An existing nonfatal `forearm-l:TransformNode` warning was observed; no weapon or renderer changes were made in this stage. This is a single-client practice smoke test, not multiplayer validation.

Current status supersedes the historical inspection/cleanup notes: Stage 2 real multiplayer movement is implemented and tested with multiple local clients. The full public match game is unfinished and no public backend is deployed. See the Stage 2 record and server README above.
