# CLAUDE.md: notes for future sessions

## Character weapon rig (2026-11-03)

See docs/CHARACTER_ANIMATION.md. src/game/CharacterWeapon.ts is the ONLY arm/weapon pose
system, shared by RemotePlayers and HomeCharacter; never add a second pose table or
BoneIKController. Arm rest axes derive from bone rest matrices plus the char_geometry
A-pose; weapon grip_r/grip_l are surface contact points, so WEAPON_HOLDS offsets move to
handle centres. Gloves carry a baked grip curl (char_geometry.py). ADS anchors to the head
joint; ADS intent comes from synchronized aimHeld + action, recoil from ShotResult. No
protocol change. Inspect with __crossfire.characterLab / tools/character-pose-lab.mjs.

## Gameplay Phase 4 physics polish (2026-11-02)

See docs/PHYSICS_POLISH_PHASE4.md and newest PROGRESS.md entry. This supersedes
the older environmental budgets below: Town now has nine interactive apples/
pears, two loose bodies, two signs and one selected interior lamp (14 states).
Other maps have two loose bodies and one lamp. Keep the v12 wire fields and
14-state global cap; trusted definitions have optional basins/tilt/lights.
produce.py shares tapered bin/fruit authorship; static collision stays conservative
for players and bullets, while environment sphere sweeps use finite tapered
contacts. sweepSphere's optional filter does not change grenade defaults.
Fivefold impulses are capped at 8 m/s; 120 Hz substeps, pair support, damping and
sleep remain bounded. Keep sign brackets/light plates static and real hinges at
their upper pivots. Lamp point lights follow the cage without dynamic shadows.
Use the dominant horizontal hit projection for lamps: a truthy tiny spread
component must not swallow their front-facing impulse. Matching frontend/assets
and Worker publication is needed later. Persist decorative poses with mapVersion;
restore matching revisions only, retaining the sequence and player state when
legacy poses reset. No deployment or public validation here.

## Coordinated deployment (2026-11-02)

See docs/DEPLOYMENT.md. Main releases now check both packages, run the real
frontend transport against workerd, build/stage Pages, deploy the existing Worker
through the official Wrangler action, verify /health protocol + full release SHA,
then recheck and publish Pages. Keep workflow-wide `pages` concurrency with
cancel-in-progress false; never cancel between backend and frontend. A stale
main check runs before production changes. Protocol/schema stays shared v12;
RELEASE_SHA is additive health metadata, not a second protocol constant.
Repository secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set by
the owner. No credentials in VITE variables/artifacts. Preserve Worker config,
namespace/state, origin allowlist, frontend defaults and Pages base. Custom
hosting needs its own release adapter; current Cloudflare CI fails explicitly
if custom is selected. Deploying two services is not atomic; old tabs may need
refresh. No commit, push, cloud deployment or remote workflow execution here.

## Update Phase 4: interactive environment (2026-11-01)

Current local protocol is **v12**, superseding the historical v11 entry below.
See docs/UPDATE_PHASE4_ENVIRONMENT.md and PROGRESS.md. shared/environment.ts owns
bounded room physics/sleep. Town: six apples, two loose props, two actual sign
panels; other maps two loose props. Worker forces derive from actual weapon rays
before the nearest world/player hit, never client prop claims. Props are
decorative, not cover or player blockers. Full welcome/spawn poses and 10 Hz
changed poses plus final sleep updates support interpolation/resume. Preserve
shared stall collider refinements/environment data in world revision hashing.
interactive_environment.py authors meshes/pivots/placements. Sign mounts stay
static and hinges preserve wall clearance. No heavy physics engine. The grenade
sweep's optional half-height preserves grenade defaults. User set the gun-model
import aside; keep current weapons. Matching v12 frontend/assets/Worker releases
require authorization. No deployment or public validation. Stop after this phase.

## Update Phase 3: grenades and crouch (2026-10-31)

Current local protocol is **v11**, superseding older historical v10 notes below.
See docs/UPDATE_PHASE3_GRENADES.md and the newest PROGRESS.md entry. Shared
`grenades.ts` owns one-per-life inventory balance, 2-second elapsed fuse, swept
sphere/OBB physics and 100 HP / 1.8 m occluded radial damage. Worker consumes only
validated held input and derives origin/velocity from its controller. Grenade
simulation commits inventory/projectiles/explosion history/damage/scores together
before broadcasting; retain session revision precedence over old attachments.
Never grant stock on reconnect or duplicate an explosion across event/history.
Posthumous kills score but dead sessions cannot retain a live combo timer.

Hold crouch is optional MoveIntent.crouch through the existing shared controller,
not a second movement system. It shares headroom, lowered height, quiet footsteps
and hip-only posture. Character export now has seven real clips; CROUCH is a
1.1492-m low stance distinct from SLIDE. Regenerate with the existing Blender
character script; preserve all previous improved weapon grip/preview logic.
Grenade visuals use a shared GLB and bounded cosmetic batch, positional SFX and
complete map/leave cleanup. Keep firearm accuracy separate from grenade hits.

No deployment, commit or live Cloudflare validation was performed. Matching
frontend/Worker v11 releases require authorization; `.env.local` and hosting
configuration remain unchanged. Do not automatically start a later phase.


## Update Phase 2 geometry and ladders (2026-10-31)

See docs/UPDATE_PHASE2_GEOMETRY.md and the newest PROGRESS.md entry. Industrial
now authors three ground-to-roof ladders and connected 4.5 m service decks on
I31/I32/I34 through industrial_roofs.py. Layout ladder regions enter the existing
CollisionWorld; PlayerController derives climbing each tick from trusted regions
and existing movement intent. Existing snapshots/replay synchronize it; protocol
stays v10. Do not add separate frontend ladder physics or a client camera position
packet. Keep the 1.65 m stand-off climb line/clear top shaft: it accommodates the
unchanged longest weapon and avoids climbing through the landing slab.

Facade skins have 12 cm inward thickness; existing reveals/roofs close the skin.
Do not cap every facade cell: those caps duplicate sills/lintels and cause flicker.
Shared arch_geometry.py drives curved visual profiles and conservative collision;
Town B22's east/west arcade had an incorrect flat 2.6 m ceiling under its 3.2 m
crown. Retain the actual masonry collision. Pipe-bundle bores/rims and generic
tube cap winding are corrected in the procedural sources. Regenerate affected
map/prop GLBs and editable blends with factory-startup Blender; avoid writing
tracked Python bytecode caches. industrial_roofs.parts includes HVAC duct/grille
overhangs as well as decks, landings, rails, fans, vents and boxes. Source tests
compare actual equipment vertices to those collision envelopes.

Frontend assets and Worker require matching map revisions when publishing is
authorized. Local verification does not constitute public Cloudflare validation.

## Polish Phase 3 (2026-10-31)

See docs/POLISH_PHASE3.md and PROGRESS.md. RoundResults renders the frozen
server roster, never current-round stats. Keep full numeric ordering, relative
name colors, last approved weapon silhouettes, original team kill totals and
cross-team MVP. Result.players and Standing.weapon are optional additive v10
fields for older durable summaries; missing history must remain unavailable.
No additional protocol bump. Freeze all spawned participants before resets,
including leavers. Results actions share a one-shot guard and reuse the existing
room/loadout callbacks. Keep staged CSS animations and reduced-motion handling.
Use tools/polish-phase2-test.mjs <url> ffa|teams --phase3 for actual local Chrome
multiplayer/results checks. Public v9 still needs matching authorized releases;
no deployment or live validation was performed here.

## Polish Phase 2 (2026-10-31)

Local protocol is v10; the public health check still reported v9. No deployment
was made. Publish matching Worker/frontend builds only when authorized. See
docs/POLISH_PHASE2.md. shared/scoring.ts defines integer elimination/headshot/
combo points, expiry, deterministic rank and winner/MVP rules. The Worker owns
all awards and persists sessions, team totals, round-ledger and round-result
together. Keep team wins based on elimination totals, not individual points.
Freeze results before resetting the unchanged 600-second room schedule.
Navigation disconnect(false) preserves the resume token; explicit Leave
disconnect() forgets it. Do not restore refresh-as-Leave or drop scores on resume.
Results acknowledge into the existing map/spawn flow; reconnect during loading
must release an interrupted roundLoad promise before retrying. Timers use the
server deadline; leaderboard abbreviations truncate without changing totals.
Use tools/polish-phase2-test.mjs for actual local FFA/Teams browser checks.

## Polish Phase 1 (2026-10-31)

WeaponView owns the final hip/ADS/action transform; WeaponMotion supplies the
single cosmetic layer. DampedSpring integrates by elapsed time. Full ADS removes
decorative lateral offsets/rotations so recoil follows the optical axis. Keep
fire/landing impulses event-driven and preserve Weapon's gameplay state machine.
PlayerCamera smooths grounded height both ways without accumulating fixed-tick
step offsets; safeViewEye clamps it below ceilings. Respect reduced motion.
No sprint/manual-crouch control was added. The preceding wall fix removed
avoidWalls entirely; never restore wall-driven gun retraction/hiding. Its shared
weapon clearance uses the equipped authoritative weapon without a protocol bump,
and requires matching frontend/Worker releases when authorized. Overlaps caused
solely by in-place turns/leans, swaps or close spawns remain a known limitation.
See PROGRESS.md and tools/polish-{phase1,multiplayer}-test.mjs for verification.

## Dedicated-server preparation (2026-10-31)

Cloudflare remains the default. Provider and URL validation lives in
src/network/backendConfig.ts; custom requires VITE_CUSTOM_MULTIPLAYER_URL and
must never fall back to the Worker. The existing VITE_MULTIPLAYER_URL overrides
the Worker default. server-dedicated is an incomplete Node/WebSocket scaffold:
it validates the shared v9 protocol and returns server_incomplete, never fake
players or snapshots. The Worker retains its Durable Object and existing routes.
Pure health regeneration is now shared; the authoritative room state, session
persistence and Cloudflare lifecycle still need a real Node port. See
docs/DEDICATED_SERVER.md before changing providers. No deployment was made.

## Phase 2 maps (2026-10-31)

Implemented; see docs/PHASE2_MAPS.md and the newest PROGRESS.md entry. Retain
the existing 52/54/54 m compact footprints and two-ended upper routes. New
market/goods-office/diner-service through-routes augment them. Town room
doorSides must feed building_spec.py, collision, and tactical.roomOpenings;
never cut room doors blindly into adjacent solid lots. Physical entrances
need reserved dressing clearance. Industrial/City interior doors must accept
covered approaches, or City's west shop passage becomes a dead end again.
Keep the goods alley outside the goods-office floor to avoid coplanar faces.
Regenerate layouts, GLBs/collision, editable .blend files and diagnostics from
the sources. Worker/frontend map hashes include the prop catalog; publish both
together only when authorized. Do not change the existing match rotation.

## Phase 4 eliminations and spectating (2026-10-31)

See the newest PROGRESS.md entry. Protocol is now v9; Worker and frontend must
be published together when authorized. The Worker persists each confirmed
elimination and three-second respawn deadline in the guest session, enforces
it across reconnects and round transitions, and clears it on an approved
spawn. Spectating follows only the killer's synchronized pose, hides their
model and falls back to the last view if unavailable. Keep event deduplication,
the 500 ms death fade, server-owned scoring and local input isolation intact.
Phase 2 maps are now implemented separately. Do not commit, push or deploy automatically.

## Phase 1 controls, sliding and weapons (2026-10-30)

See docs/PHASE1_CONTROLS.md and PROGRESS.md. Settings bindings are a validated
draft until Apply; preserve keyboard aim and text-input isolation. The shared
controller handles jump-cancel and cooldown; both server and client use it.
Shotgun/SMG tuning is shared, shotgun restore clamps old six-shell saves, and
room chat uses bounded real messages with server-derived names. Protocol v8
requires matching Worker and frontend builds. No automatic deployment.

## Corner leaning (2026-10-30)

See docs/LEANING.md and the newest PROGRESS.md entry. Q/E is held lean; the
shared controller and Worker validate the collision-limited pose and shots.
Protocol v7 requires matching frontend and Worker releases. Keep remote skeleton
pose, the server head/torso hitboxes, camera and weapon clearance aligned.

## Compact maps for 2-6 players (2026-10-30)

See docs/COMPACT_MAPS.md and the newest PROGRESS.md entry. Town is 52 x 52 m;
Industrial/City are 54 x 54 m. Authored asymmetric routes live in
tools/compact_layouts.py and feed the existing three layout/style generators.
upper_routes.py supplies identical parts to visible terrain and collision.
Preserve two stair ends, standing underpasses and full gallery headroom; do not
replace suspended floors with solid terraces. compact_dressing.py validates
placement before asymmetric spawn sampling. City sidewalks must not cover lobbies.
Industrial fences are explicit useful yard dividers, never automatic thin lots.
Both sides import regenerated collision/layout/catalog and derive matching hashes.
shared/spawns.ts prefers screened, distant spawns while retaining occupancy checks.
Protocol remains v6 and rounds remain 600000 ms. Frontend and Worker both need
publication when authorized. Local tests pass; no public deployment was validated.
Direct Blender --only props,town,industrial,city preserves texture/audio outputs.
The exporter removes only stale numbered map blocks. Diagnostic plan PNGs and
legacy ground-query metadata do not introduce a tactical overlay into the HUD.

## Directional haze / health regeneration (2026-10-30)

See docs/HEALTH_AND_DAMAGE_FEEDBACK.md and the latest PROGRESS.md entry.
Protocol remains v6. Haze uses only confirmed current-life hit rays and current
camera yaw/pitch, with a clear middle and bounded 500ms fading; preserve arrows.
Worker-only regenAt persists with health/attachments. Every accepted damage hit
sets eligibility to now+5000ms; first HP at +5100ms, then 1 per complete 100ms.
Use elapsed server time, never client input volume or per-player intervals.
New damage resets the cursor; death/round/spawn clears it. Valid resumes consume
only elapsed unused steps. Keep the previous bounded reconnect fix unchanged.

## Reconnection loop fix (2026-10-30)

See docs/NETWORK_RECONNECTION.md. The old 24-frame in-flight window plus forced
reconnect at 120 pending frames disconnected healthy sockets under ACK latency.
Keep latency-aware outstanding input bounded to 48 (the unchanged server queue),
12-frame/20Hz batches and 120-frame prediction backpressure without socket churn.
Do not restore queue-triggered reconnects. Actual close owns bounded jittered
retries; only 30 seconds of stability resets their budget. Leave cancels retries.
Protocol remains v6; gameplay/heartbeat thresholds/DO persistence are unchanged.
Console diagnostics require ?networkDebug / Worker NETWORK_DEBUG=true. See the
newest PROGRESS.md entry for verification and the public-validation boundary.

## Current combat visuals / home preview (2026-10-29)

Protocol is **v6**: accepted hits carry server-derived normalized incoming rays and victim life;
eliminations also carry unique IDs (null ray for falls). Update Worker and frontend together only
when authorized. No hit/damage/balance or storage schema changes. Never accept client-assigned damage
directions. Deduplicate events; deliver elimination before applying its dead snapshot. Remote deaths
tip along the world ray and fade/dispose in 500ms without delaying respawns. Dispose temporary fade
materials/texture clones; surviving characters retain shared original materials.

PlayerSilhouettes replaces native per-mesh hulls with one depth-tested union mask and thin inward
screen contour. Map geometry and foreground weapons occlude it. All body parts use the same relative
red/blue mask color. Preserve skinned poses and LOS names. DamageFeedback uses real hits for bounded
500ms CSS edges/chevrons. HomeCharacter uses the same GLB/idle in a disposable scene, never a map;
one skin currently exists. Abort/dispose when leaving home and respect reduced motion.
See docs/COMBAT_VISUALS.md and the newest PROGRESS.md entry. No commit, push or deploy automatically.

## Current character integration (2026-10-28)

The latest character brief authorizes generating and integrating the actual humanoid. The supplied
reference is `references_images/Player.png`. Existing `blender/characters/char_geometry.py` is reused;
`generate_player.py` builds the weighted bpy mesh, one 18-joint rig and six in-place actions. Run
`npm.cmd run assets:player`, `node tools/inspect-character.mjs`, and `npm.cmd run assets:verify`.
Outputs include editable player.blend, self-contained player.glb, shared atlas pair and measured
player.json. Maps, damage, weapons and menus remain unchanged. Character materials are intentionally
embedded; do not replace them with map materials. See docs/CHARACTER_PIPELINE.md.

CharacterAssetLibrary loads once, shares geometry/materials and clones independent rigs/groups.
PlayerAnimationState/PlayerAnimator select and blend all six actual clips from interpolated server
motion. Do not squash the GLB for slides or move authoritative roots for animation. Measured union
bounds cover poses; current bone positions drive LOS/name anchors after Babylon evaluates animations.
Keep native depth-tested relative red/blue outlines thin enough for fingers/cuffs/cap details.
Dead/disconnected instances dispose meshes, rigs and groups; the source remains cached for respawn.

Slow local startup exposed late spawn-ack recovery: Retry enters an already-approved server life
with its existing locked weapon. Client input flushing originally bounded unacknowledged frames to 24,
retaining the server's original 48-frame queue/real-time authority and the existing reconnect limit.
Pending and unsent input arrays must be independent on life/round/disconnect resets; aliasing them
duplicates each new control frame. tests/multiplayerTransport.test.ts guards this and the send window.
Protocol remains v5; no Worker or map/balance redesign. Do not commit, push or deploy automatically.
The top of PROGRESS.md records final verification and any remaining limits.

## Current combat/visibility update (2026-10-28)

The latest attachment authorizes damage first, then the character interface/export integration,
outlines, names and verification. It supersedes the previous Stage A stop for this task only;
Extreme Quality is still not authorized. Protocol is **v5**; deploy matching frontend and Worker
only when the user authorizes it. PvP fire is bounded control intent in existing sequenced frames.
The Worker runs the shared Weapon state machine, uses authoritative positions/look and static map
collision, and applies DamageSystem's existing damage/falloff/1.5x headshots to real player bodies.
Server health, ammo/actions, eliminations, scores, FFA/Teams relationships and respawns are real;
do not replace them with local practice hits. Missing inputs never auto-fire. Health and gun state
are retained through authenticated reconnect and persisted atomically with team totals.

VisibilityWorld indexes existing opaque rendered triangles once per map. It only accelerates visual
LOS queries; it does not replace shared collision/physics. Remote outlines use the engine depth test
and bone support. Enemy names require body LOS; ally names are camera-projected blue labels through
walls. Colors use relative server-owned team relationships, including a Red Team viewer. Dead or
disconnected actors dispose their labels/meshes. Preserve lazy home loading/cancellable map loading.

The previously missing character export is now generated by the character task above. The actual
GLB/skin/clip names, metres, ground and heading are audited before enabling it. Capsules remain only
an error fallback. Do not replace actual character verification with invented clips/skeletons.
See docs/MULTIPLAYER_COMBAT.md, tools/combat-visibility-test.mjs and the top of PROGRESS.md for evidence,
current limits and the public redeployment requirement. Do not commit, push or deploy automatically.

## Current Stage A update (2026-10-27)

Shift now slides; Ctrl/C manual crouch and sprint input are removed. The shared controller owns
one-second slides, 7.8 m/s initial speed decaying to walk speed, 0.65 rad/s steering, one-second
post-slide cooldown, held-press latch and smooth height with ceiling clearance. Snapshots include
all slide replay state. Protocol is **v4**; update frontend and Worker together. Missing server
input preserves the Shift latch; client idle suppression must transmit releases, and quick physical
release/repress events must survive between fixed ticks. Legacy stored states return to pre-spawn.
Keep the old 7.1 weapon movement-spread reference independent of slide tuning; no weapon balance changed.

Town well coping winding/underside and single-sheet double-sided market fabric are fixed in the
procedural source and regenerated props/materials. Bench source coordinates and canonical Town/City
layouts leave facade/stair clearance; their runtime collider positions derive from those layouts.
Industrial has no benches. Leaderboard background feathers outside the unchanged content bounds;
its content wrapper retains scrolling without clipping the decoration. Tests: tools/stage-a-test.mjs,
tools/check-stage-a-props.py, tests/stageAProps.test.ts and shared movement/runtime regressions.
PROGRESS.md records final evidence. **Stop after Stage A. Extreme Quality/Max FPS remain Stage B and
require explicit authorization. Do not commit, push or deploy.** Older v3/sprint notes below are historical.

Crossfire is a browser FPS (TypeScript + Babylon.js 9 + Vite). All 3D assets are generated by Blender
Python scripts; the map layout is data (`src/maps/<id>/layout.json`). Read this before changing
coordinates, materials, the asset pipeline or the renderer.

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` (port 5173) |
| Type-check / unit tests | `npm run typecheck`, `npm test` (Vitest, Node) |
| Build | `npm run build` (tsc + vite, output `dist/`) |
| Local multiplayer server | `npm.cmd run dev --prefix server` (Worker/Durable Object, port 8787) |
| Server typecheck / dry-run build / runtime tests | `npm.cmd run typecheck --prefix server`, `npm.cmd run build --prefix server`, `npm.cmd test --prefix server` |
| Two-browser movement/reconnection check | `node tools/multiplayer-test.mjs` (Vite on 5180 with `VITE_MULTIPLAYER_URL`, plus local Worker) |
| Regenerate all Blender assets | `npm run assets` (`-- --only town,props --previews`) |
| Verify assets | `npm run assets:verify` |
| Regenerate layouts | `python -I tools/layout_design.py --write` (town; then `tools/plan_overlay.py`), `tools/layout_industrial.py --write`, `tools/layout_city.py --write` |
| Re-download textures | `python -I tools/fetch_textures.py` |
| Browser smoke test | `node tools/browser-test.mjs [--shots] [--url ...]` (needs a running server) |
| Every map + switching leaks | `node tools/maps-test.mjs [--shots] [--url ...]` |
| Perf matrix | `node tools/perf-test.mjs [--map <id>]` |
| Wall-gap audit (needs dev server) | `node tools/dev-wallgaps.mjs --map <id>` (see-through holes in walls) |
| Tactical maps as JSON + SVG | `node tools/export-tactical.mjs` (docs/tactical/) |
| Settings UI test (needs dev server) | `node tools/settings-test.mjs` |
| Z-fight audit (needs dev server) | `node tools/dev-zfight.mjs [--reuse] [--eps 0.006] [--explain "<family>"]` |
| Flicker test (needs dev server) | `node tools/dev-jitter.mjs` then `python -I tools/jitter_analyze.py` |

Blender: `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe` (or `BLENDER_PATH`). Run headless:
`blender -b --factory-startup -P blender/scripts/generate_all.py -- --only town`.

## Coordinates and orientation (most common source of bugs)

- **Game space = glTF space**: metres, +x east, +y up, +z south. The Babylon scene uses
  `useRightHandedSystem = true`, so GLBs load without any conversion node.
- **Blender** (x, y, z) = game (x, -z, y). `meshkit.MeshData` is authored in game coordinates and
  converted once in `to_object()`. A Blender Z-rotation φ equals a game Y-rotation φ.
- **Rects** in layout.json are `[x0, z0, x1, z1]`. Plan images put +z downward (north up).
- **Headings** (layout spawns/props/targets) are compass degrees: 0 = facing north (−z), 90 = east (+x).
  Internal yaw = −heading (radians), a right-handed rotation about +Y. Forward = (−sin yaw, 0, −cos yaw).
- **Box yaw** in collision data uses the same right-handed rotation: world.x = lx·cos + lz·sin, world.z = −lx·sin + lz·cos.
- Props/kit pieces face **local −z** ("front looks north at heading 0"). Facade kit pieces have their
  origin on the wall's outer plane at the opening's bottom centre; outward = local −z.
- Babylon camera: `rotationQuaternion = RotationYawPitchRoll(yaw, pitch, roll)`; in RH mode the
  camera looks down local −Z, positive pitch looks up.
- Text/UV on outward-facing quads: u must increase toward local **−x** (the viewer's right).

## Architecture (see docs/ARCHITECTURE.md)

- `physics/CollisionWorld` and `player/PlayerController` are Babylon-free and unit-tested; keep them
  that way (they are meant to run on a future server). Fixed 120 Hz simulation in `game/Game.ts`.
- Collision is **oriented boxes only** (`collision.json` from Blender + prop boxes from `props.json` +
  target boxes). Player = cylinder above step height + ground probe; stairs are box stacks.
- **Free-for-all**: no safe zones or teams. Spawns are spread over each map by `blender/scripts/lib/spawn_points.py`
  (called by all three layout tools); the game picks a random one. The teammate registry stays for future team modes
  (`localTeam` is null, so the Tab map shows only the player).
- Damage must go through `game/Damage.ts` → `DamageSystem.tryApply`, which applies the headshot rule
  (`HEADSHOT_MULTIPLIER` 1.5 for zone `'head'`) centrally; weapons pass body damage (after falloff, `damageAt`).
  Practice targets are steel silhouettes with separate head and body colliders (`game/Targets.ts` = `props.TARGET_*`).
- Weapons (`weapons/Weapon.ts`): Babylon-free state machines (`Weapon`, `Loadout`) driven at 120 Hz. Infinite reserve,
  limited magazines. Actions (`equip`, `cycle`, `reload`, `reloadEmpty`, `shellStart/shell/shellEnd`) expose `progress`
  and emit timed `cue` events that drive sounds (`CUE_SOUNDS` in Game.ts) and the `eject` of cases.
- View-model (`weapons/WeaponView.ts`): existing weapon GLBs, no hands/arms loaded. Reloads dip the weapon over 180 ms, hold it down while loading, and return smoothly without changing `Weapon` timing/ammo/cues. Shotgun shell phases stay lowered continuously; firing pump/bolt cycles remain. Placement lives in `RIG_CONFIGS`; tuning hooks remain available.
- `maps/MapManager` is map-agnostic: it reads `map-assets.json`, GLBs, `collision.json`, layout props/targets/lights.
- European Town specifics live only in `src/maps/european-town/` and `tools/layout_design.py`.

## Settings

- `SettingsStore` holds the **applied** settings (live in the game, saved on change). The settings screen edits a separate
  `SettingsDraft` (`config/settingsDraft.ts`): edits never reach the game or localStorage until `apply()`; `discard()` is Back.
  Add a new setting to `Settings`, `sanitizeSettings`, a control row in `UI.buildSettings` (pick its category) and `Game.applySettings`.
- Controls are custom (`ui/Dropdown.ts`, styled range/switch in styles.css) because native select popups cannot be themed.
  Apply stays focusable (`aria-disabled`) instead of using `disabled`. `node tools/settings-test.mjs` checks the whole flow.

## Rendering decisions

- **Materials by name**: GLBs are exported with `export_image_format='NONE'`. The runtime
  `MaterialLibrary` builds PBR materials from `public/assets/materials.json` (written from
  `blender/scripts/lib/materials.py`) and binds shared textures. To add a material: add it to
  `MATERIALS` in materials.py, run the materials stage. Unknown names render magenta and are listed
  in `__crossfire.stats().missingMaterials`.
- UVs are authored **in metres** (world-space box projection); `tile` in materials.json sets metres per texture repeat.
- Tints are **linear RGB** multipliers (same numbers in Blender and Babylon).
- **Batching**: `rendering/StaticBatcher.GeometryBatcher` bakes shells, kit instances and props into one mesh
  per *canonical* material per 40 m cell. Tint variants (e.g. `shutter_<palette>`) collapse into one material
  with the tint baked into vertex colours (`MaterialLibrary.canonical`). Result: ~140 meshes, ~130 draw calls.
- **Gotcha**: glTF meshes in a RH scene have `sideOrientation = CounterClockWise`. Any mesh you build from their
  vertex data must copy `sideOrientation`, or back faces get culled (floors vanish, walls look smeared).
- Instanced meshes report their source's material; never assign materials to `InstancedMesh`.
- **Shadows**: Low/Medium use one ShadowGenerator over the whole map rendered once (`REFRESHRATE_RENDER_ONCE`);
  High uses cascaded shadows and includes moving targets. Re-render the static map (`resetRefreshCounter`) if static casters change.
- **Sky alignment**: `hdriSunHeading` in the map definition is *measured* (`tools/dev-sun-sweep.mjs`): heading of the
  HDRI sun with no rotation. Sky mesh rotation = +(hdri − desired); HDR texture rotationY = −(hdri − desired).
  Verified with `tools/dev-mirror.mjs` (IBL) and the sweep (visible sky).
- **Z-fighting**: never put two visible surfaces on one plane (same-facing, overlapping, within ~2 mm). The camera's
  `minZ` is 0.1 (24-bit depth: error ≈ d²/(minZ·2²⁴)). `tests/geometry.test.ts` fails if the generators reintroduce
  overlaps; `tools/dev-zfight.mjs` also covers props and prints each offending family. Fix the generator
  (see "Z-fighting" in docs/ASSET_PIPELINE.md), not the exported GLBs. Polygon offset is only for `decal` materials.
- The weapon view-model renders in rendering group 1 with depth clear and is excluded from the sun
  (no shadow receiving). The holographic reticle is an additive emissive quad (`reticle_holo`, replaced at runtime);
  the sniper scope is a DOM/SVG overlay and the weapon is hidden behind it.
- Image processing (ACES) runs per material, not as a post-process, so the display-referred sky can opt out.

## Asset pipeline (see docs/ASSET_PIPELINE.md)

- `blender/scripts/generate_all.py` stages: materials, props, weapon, library, kit, then the map stages town, industrial,
  city (`MAP_STAGES`), previews.
- Walls the facade generator must not skip: a building next to a see-through or inset wall (fence, railing, pillar:
  `layout_util.OPEN_WALLS`) or at a passage's mouth builds its own plain wall; door-type openings get a dark back face
  (`building.back_opening`) so seams never show the sky. `node tools/dev-wallgaps.mjs` finds holes.
- Shared pure-Python modules (no bpy) are imported by both Blender and tools: `catalog.py` (building types,
  palettes, prop sizes/colliders), `materials.py`, `building_spec.py` (derived dimensions), `collision_gen.py`.
  Visual geometry and collision both derive from `building_spec`, so they cannot disagree.
- Facade details are **kit pieces** (linked duplicates, `KIT_<piece>__<material>#n`) and are baked by the runtime batcher.
- Outputs: `public/assets/models/<map>/buildings/block_XX.glb`, `terrain.glb`, `collision.json`,
  `collision_debug.glb`, `map-assets.json`; `shared/props/*.glb` + `props.json`; `shared/weapons/{rifle,shotgun,sniper,hands,casings}.glb`;
  `shared/buildings/*.glb` (catalogue); `shared/kit/*.glb`; `blender/source/*.blend`; manifest JSON + `docs/ASSET_MANIFEST.md`.

## Conventions

- TypeScript strict, no unused locals; 2-space indent; classes per file; comments explain *why*.
- Python: 4-space, type hints where useful, `from __future__ import annotations`; keep bpy out of shared modules.
- Asset names: snake_case; materials named after texture sets (`stone_rubble`, `plaster_ochre`, `shutter_<palette>`).
- Never hand-edit generated files (`layout.json` is the exception: it is the canonical layout; regenerating it overwrites edits).

## Testing hooks

`window.__crossfire` (always present): `ready()`, `teleport(x,y,z,heading,pitch)`, `freeCam(...)`, `look(heading,pitch)`,
`hold(action, held)`, `stats()`, `inspectBatch(material)`, `dumpBatches()` (world-space triangles for geometry audits),
`mirrorSphere(x,y,z)`, `fightProbe(x,y,z)` / `clearFightProbe()` (a deliberate z-fight to prove the flicker test works),
`setSetting(patch)`, `play(id)` / `loadMap(id)`, `mapInfo()`, `memory()`, `tactical()`, `weapon()`, `selectWeapon(i)`,
`lastShot()`, `sounds()` (recently requested sounds), `aimAt(x,y,z)`, `targetPoints(id)`, `casingInfo()`, and the
view-model tuning hooks `viewPose(action, progress, ads)`, `inspectView(alpha, beta, radius)`, `tuneView(id, patch)`, `holdFlash(on)`. Right after `ready()` wait a few seconds before screenshots: meshes whose shaders are still compiling are skipped.
URL params: `?autoplay` (skip menus/pointer lock), `nohud`, `map=<id>`, `cam=x,y,z,heading,pitch`, `quality=`, `shadows=`, `scale=`.

## Environment gotchas (this Windows machine)

- Git Bash converts args like `/crossfire/` into Windows paths: prefix with `MSYS_NO_PATHCONV=1`.
- Pass **absolute** output paths to Blender render scripts (a relative `docs/x.png` landed in `C:\docs`).
- Headless Chrome caps at 60 fps (vsync); `perf-test.mjs` adds `--disable-gpu-vsync --disable-frame-rate-limit`.
  Navigating a page that renders uncapped can time out: use a fresh page.
- The dev GPU is an Intel Iris Xe iGPU; desktop performance has not been measured. Long sessions heat it: uncapped
  frame rates drop by up to 40% over a few minutes, so compare builds in alternation (A/B), not against old numbers.
- The Bash tool collapses `\\n` inside heredocs and breaks heredocs with an odd number of apostrophes: write patch
  scripts to the scratchpad and run them.

## Status / next steps

Current continuation plan and verified stage status: see `PROGRESS.md`. Work on one unfinished stage at a time and stop after updating that record; do not commit, push or deploy without permission.

Stage numbers follow Part 15 of the full multiplayer brief. Stage 2 is implemented and tested locally; Stage 3 (public match lifecycle) is next. Read `server/README.md`, `PROGRESS.md` and the existing architecture before continuing. Normal Play remains practice; `?multiplayer` opts into the real fixed-map movement test. Do not add full rounds, Teams, combat scoring, leaderboard or map expansions until their stages are requested.

See README "Features", docs/ARCHITECTURE.md "Known limitations" and docs/UPDATE_PROGRESS.md (log of the map, tactical
map, free-for-all and weapons updates). Not implemented yet: full public matches, bots, player damage sources.

## Latest focused cleanup (2026-10-25)

The focused cleanup overrides the earlier menu detail requirements: keep only CROSSFIRE, PLAY and SETTINGS over the existing 3D background. No map selector, connection-status panel, extra copy, or visible arms/hands. Do not add username/loadout panels from the older brief without a new request. `docs/MULTIPLAYER_DIAGNOSIS.md` is now historical; the subsequently authorized Stage 2 adds a real backend, endpoint consumer and WebSocket client, described in `server/README.md`. Deployment remains unauthorized.

## Multiplayer implementation boundaries

- Shared `protocol.ts` validates untrusted input; only server snapshots may restore `PlayerController` state. Never accept client positions or score fields. The pure collision builder is shared with `MapManager` and includes rotated props; the network scene omits practice targets on both sides.
- Fixed 120 Hz movement, at most 12 frames per message, bounded 48-frame server queue and 20 Hz batching/broadcast during motion. Idle frames are suppressed. Idle/empty rooms stop physics timers; heartbeat and resume expiry use alarms. These are foundation tuning values, not a load-capacity claim.
- Keep resume tokens out of logs/debug snapshots/URLs. Generation/socket checks protect replacement connections. Server storage/attachments restore sessions and last-seen deadlines. Explicitly reply to WebSocket close frames for reliable local/browser reconnects.
- `VITE_MULTIPLAYER_URL` is public configuration; local loopback `ws://` and public `wss://` only. Server Origins are exact allowlisted origins, without repo paths. Keep the Vite config and Pages hosting boundary intact.

## Latest brief: Gameplay/UI update, Stage 1 (2026-10-25)

The latest four-stage user brief supersedes the old stage order/menu restrictions above. Only its Stage 1 is authorized in this execution: real HTTP presence beneath home buttons, normal Play -> connected pre-spawn, asset-derived weapon picker, server-approved spawn/per-life loadout, Leave Match and Tab leaderboard. `?practice` is now the explicit local path; normal Play always connects. Protocol is v2; rebuild client and backend together. The server still has no round clock, Teams assignment or player combat, so match metadata is explicitly unavailable. Do not fabricate timer/mode/kills or a fourth weapon; SMG remains disabled until new Stage 2. See the top of PROGRESS.md for current validation and limits. Pure tactical/export utilities remain; no tactical-map view is instantiated. Later stages (sliding/SMG/models, map fixes/targets, Extreme/FPS) require a new user instruction. Do not commit, push or deploy.

## Current focused UI/map task (2026-10-26)

The latest attachment supersedes the prior Stage 1 placeholders: home is now a blurred static existing thumbnail with upper navigation and bottom Play, with no playable-map/weapon/environment loading before joining. Play and rotation use one plain gray LOADING screen. Four horizontal cards now select real SMG/rifle/sniper/shotgun loadouts. SMG has a separate minimal Blender source/export and audio; the other weapon/map assets are preserved. Sliding and unrelated later-stage features remain unauthorized.

Protocol v3 carries round IDs and all three MapIds. PublicRoom persists a 600-second seeded shuffled map schedule; all three worlds use existing generated collision and spawns. Clients reload from authoritative snapshots and recover loading across transport reconnects; no client-side public map choice. Game.prepareGameAssets is lazy and MapManager already waits for shaders. Preserve the existing Pages Origin allowlist edit. Read PROGRESS.md for the actual verified status and remaining Teams/combat/results/deployment limits. Stop at the focused task; no commit, push or deployment.

## Current UI polish (2026-10-26)

The latest UI-only attachment is complete; see the top of PROGRESS.md. Preserve the persistent `.home-header` outside individual screens: it stays fixed between menu and full-screen home Settings, while the menu is an inert/aria-hidden backdrop behind Settings. `UI.show` manages home-page state; Play navigation uses the existing Settings Back/discard path. Pause/pre-spawn Settings still shares the exact same draft/controls in its compact card. Major button hovers scale rather than translate.

Home uses `assets/ui/town-plaza.webp`, an eye-level screenshot of the actual well plaza, with CSS-only 22-second breathing zoom and reduced-motion support. Reproduce with `node tools/capture-home-background.mjs --url http://127.0.0.1:5180/` against Vite. Do not load map geometry on home. The title uses original inline crossed-rifle SVG artwork, also reflected in the favicon. WeaponIcons.ts supplies flat silhouettes from existing server `weapon` data; scoreboard signatures include weapon changes. Unavailable presence displays zero but retains null in the Presence callback and data-available=false in the UI. Do not interpret that fallback as a confirmed count.

No backend/protocol/gameplay/map geometry changes were made in this task. Town has no fountain; Extreme Quality and Max FPS are not implemented in the existing schema/renderer. Do not invent those controls or claim live Teams/public deployment. UI task verified locally with production screenshots and independent real Worker clients. Stop after UI polish; no commit, push or deployment without permission.

## Guest profiles (2026-10-26)

GuestProfileStore (`src/config/guestProfile.ts`) is a separate localStorage preference under `crossfire.guest.v1`: random guestId plus username, with temporary in-memory fallback. Never use this ID as multiplayer authentication or transmit it to the server. UI.ensureGuestProfile opens a native first-visit name dialog before Play/autoplay; later visits retain the clean home. Settings > Gameplay contains a separate username draft that participates in Apply/Back/dirty markers without changing the graphics/sound/gameplay schema. Defaults do not reset the profile. A bad name prevents partially applying other edits. Name edits take effect on the next join/reconnect.

MultiplayerClient accepts a name provider so the reused transport reads the current applied name each join. The Worker independently validates names via shared/username.ts on both new and credential-authorized resumed joins. Session UUIDs/resume credentials and existing protocol v3 remain server-owned. Browser test helpers complete the actual first-visit form. See PROGRESS.md and tools/guest-profile-test.mjs for real-client evidence, storage-failure handling and remaining limits. Stop after this feature; no commit or deployment authorized.

## Cancellable match loading (2026-10-26)

Loading has a top-left Back button and a CSS wheel (static with prefers-reduced-motion). Back uses Game.quitToMenu: abort the current membership/load controller before disconnecting, dispose the retired transport, invalidate pending round/map work and unload a partial map. Keep callbacks and all post-await UI transitions guarded by the attempt's captured signal/network. Old promise finalizers must only clear themselves, not a newer load. Fully prepared game assets can still be reused on later Play; failed/cancelled preparation resets its cached promise and disposes partial resources. Preview replacement must not add duplicate card images on retry.

Pass optional AbortSignals through the existing loaders. core/loadContainer.ts fetches our geometry-only GLBs with a cancellable fetch, then invokes the existing Babylon loader on bytes with the original root/name for Pages compatibility. core/cancellation.ts stops waiting on native loader/readiness operations and disposes late containers without resuming UI. MapManager retains its existing batching/world pipeline within a cancellation/error cleanup boundary. WeaponView/Effects retain imported containers for disposal of incomplete assets, and shared materials are pruned only when unused. Preserve the existing resource ownership and never clear a newer environment/load from an older cancellation.

See tools/loading-cancel-test.mjs and PROGRESS.md for actual local cancellation/retry evidence. Backend/protocol/map geometry and existing guest/settings systems are unchanged by this task. Stop after this feature; no commit or deployment.

Cancellation testing also exposed a Babylon HDR prefilter race: never dispose an unfinished HDRCubeTexture mid-prefilter. Environment.dispose detaches the retired map immediately, is idempotent and releases HDR after its onLoad/onError callback settles. Only clear scene.environmentTexture if it is still this environment's texture. This keeps the same lighting quality and avoids invalidating a newer map or generating a late native shader error. The gameplay browser headshot assertion uses ADS so it checks damage/collision rather than randomized hip-fire spread.
