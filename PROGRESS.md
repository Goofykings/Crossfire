# Phase 2 map improvements

Updated: 2026-10-31. Complete, in the requested Town / Industrial / City order.
This supersedes the historical Phase 2 deferral notes in older entries below.
The earlier compact-map update already reduced Town from 66 x 66 to 52 x 52 m
and the other maps from 68 x 68 to 54 x 54 m (37.9% / 36.9% less area).
This phase retains those existing footprints rather than shrinking them again;
the brief's 20–25% AREA target differs from that earlier per-dimension reduction.
Human 2–6-player balance testing is still needed before further size changes.

European Town completed: added a walk-through market shop linking the north
approach and market courtyard, with two real 1.6 m doorways. Kept the plaza
well/fountain landmark, asymmetric loops, two-ended 2.8 m gallery, and all
existing PBR/lighting. Added an optimized produce-table GLB and Blender source.
Fixed a garden-room doorway opening straight into an adjacent solid building:
authored room door sides now drive Blender geometry, collision and map queries.
The shared dressing pass now reserves real room/interior entrances as well as
decorative doors. Narrow through-rooms no longer receive tables/stools in the
walking lane. Town has 46 validated props plus the existing landmark obstacle.

Town verification: 22 relevant map/physical-portal/tactical tests and frontend
typecheck pass. Real local Chrome traversal passed both stair directions and
walking/sliding/jumping through the shop in both directions; screenshots were
visually inspected. All PBR materials loaded, no missing assets/browser errors,
and settings survived map loads. Regenerated layout, collision/debug GLB, map
GLBs, editable .blend, manifests and the top-down diagnostic. Blender completed
exports but emitted its existing thumbnail-cache/deprecation warnings.

Industrial Complex completed: added a three-door goods office between the west
gallery lane, goods link and central loading area, creating a covered alternative
to the west cross street. Preserved the 54 x 54 m footprint, two-ended 2.8 m metal
catwalk, loading/container landmarks, warehouse interiors, and real utility-yard
fence dividers. Added a material-batched valve-manifold prop in the utility yard.
Actual interior doorway landing clearance now removes obstructive dressing;
21 props remain. Regenerated all map outputs, editable Blender source and plan.
Controller tests pass for both flank directions, all interior/arcade doors, and
jumping/sliding on both stair approaches; loop/connectivity, standing/crouched
reachability, screened spawns, fence clearance and frontend/Worker revision
checks pass. Local Chrome walked both catwalk directions and walked/slid/jumped
both flank directions; materials loaded without browser/asset errors. Inspected
flank, stairs and overhead screenshots.

Modern City completed: added a diner-service through-room between the diner
alley and north plaza approach. Fixed the existing west shop passage's dead end:
interior doorway generation now accepts covered approaches, opening a fourth
shop entrance. Preserved the 54 x 54 m footprint, plaza, sidewalks, upper-floor
loop and environmental settings. Added an optimized A-frame cafe board and
relocated the bike rack onto the south sidewalk; 35 clearance-checked props
remain. Regenerated source layouts, models, collision,
editable Blender source, manifests and plan. All 24 relevant map/portal/graph/
tactical/controller tests pass. Local Chrome passed stairs and both-direction
walking/sliding/jumping through the new interior, with no browser/asset errors;
inspected the final route and gallery screenshots. The final integration audit
caught overlapping yard/interior floor faces in the Industrial connection;
its alley now meets the office at its threshold and the geometry suite passes.

Final verification: all 250 frontend tests, frontend TypeScript/production build,
181-entry asset verification, Worker typecheck and dry-run build, and all 49
Worker tests pass. Worker tests use real local WebSocket clients and cover
movement, combat/state preservation, reconnects, and all three map rotations.
Fixed their shuffle-coverage assumption: starting mid-bag can require up to five
rounds to include a full three-map bag; production rotation is unchanged. One
timing-sensitive Worker run failed while heavy browser checks were also running;
the final full Worker run without those browser checks passed. Verified all three
procedural layouts and collision exports regenerate identically from their
sources, and the generated prop catalog matches its source dimensions/colliders.
Production Chrome traversed all three maps under /crossfire/ with no missing
assets/materials or browser exceptions; repeated City after its final bike-rack
move. Inspected new props, passages, upper-route approaches and overhead views.
Updated top-down diagnostics and docs/PHASE2_MAPS.md. Public Cloudflare/Pages
deployment and human 2–6-player balance remain untested. Frontend and Worker
must be rebuilt/published together for the revised map hashes, only when
authorized. No commit, push or deployment. Stopped after Phase 2.

# Home character weapon poses and profile name

Updated: 2026-10-31. The home-only weapon pose now solves the two arm chains
using outward/downward elbow targets and orients the hands at the actual GLB
grip anchors. The previous shared IK solution put elbows above/across the
shoulders and left wrist rotations inherited from the idle pose. Four separate
home poses use the supplied references for weapon position and angle; remote
player presentation retains its existing IK. The existing character mesh has
no finger bones, so the fingers cannot individually curl around the grips.

The home preview shows the most recently active weapon from an approved match
life or a completed practice weapon switch. This preference is persisted under
`crossfire.last-used-weapon`, with an in-memory fallback; an unused loadout
selection does not overwrite it. Before any weapon has been used, the preview
falls back to the selected weapon. The active guest name appears above the
preview, and the existing idle, mouse movement, fade and no-map preview remain.

Verification: 235 frontend tests passed, as did TypeScript checks and the
production build. Browser checks visually inspected all four actual poses,
verified grip contact and elbow placement while idle and turning, name layout
at desktop and mobile sizes, first-visit fallback and no map load. The local
headless preview sustained approximately 60 fps in a short browser sample. A real
two-client local Worker test confirmed last-used persistence only after server
spawn approval, plus the existing remote weapon, chat and movement behavior.
No public deployment was tested, and no commit, push or deployment was made.

# Character metadata asset loading

Updated: 2026-10-31. Removed the Vite-invalid TypeScript import of generated
`public/assets/characters/player.json`. Character metadata is now fetched
through the existing `assetUrl` and `fetchJson` helpers before loading the
GLB; generated JSON, models, textures and audio remain in `public/assets`.
Home and remote previews retain the existing nonfatal missing-asset fallback.

Verification: 233 frontend tests and TypeScript checks pass. Both the default
production build and a build with `BASE_PATH=/crossfire/` pass. Browser smoke tests confirmed HTTP
200 for the character JSON and GLB and the animated, armed home preview on
both the Vite development server and a `/crossfire/` production preview.
No public GitHub Pages deployment was changed or tested. No commit, push or
deployment was performed.

# Phase 4 elimination, spectating and respawn

Updated: 2026-10-31. Phase 2 is deferred at the user's direction. Phase 4 is
implemented locally; no commit, push or deployment was performed.

- **Elimination animation: complete.** Preserved the existing deduplicated,
  server-confirmed 500 ms directional fall and fade, including held weapons.
- **Elimination confirmation and kill feed: complete.** The killer sees a
  short red confirmation. A bounded, fading feed shows server-issued names,
  weapon silhouettes and FFA/Teams relationship colors.
- **Spectating and respawn: complete.** Eliminated players stop controlling
  their life and follow the killer's synchronized eye position and orientation.
  The spectated body and first-person weapon are hidden. If the killer leaves,
  the last valid view remains; no unrestricted spectator controls are exposed.
  The eliminated-by label, gray countdown, blue respawn button, next-life
  weapon selection, settings, and leave action are available over the live map.
- **Server authority and reconnect: complete.** The Worker records the unique
  elimination, killer/victim, weapon, teams, server time and three-second
  eligibility deadline in the session and snapshots. It rejects early respawn
  requests and retains a pending deadline through reconnect and round changes.
  A successful new life clears the death record. Existing scores, health and
  server hit detection remain authoritative.

Phase 4 files: `shared/protocol.ts`, `server/src/index.ts`,
`src/network/MultiplayerClient.ts`, `src/game/Game.ts`,
`src/game/RemotePlayers.ts`, `src/ui/UI.ts`, `src/ui/CombatFeed.ts`,
`src/styles.css`, relevant protocol/combat/transport tests and local browser
test tools. Existing uncommitted Phase 1 and Phase 3 work remains in place.

Verification: 232 frontend tests and 49 local Worker/WebSocket tests passed;
the frontend production build, Worker dry-run build, typechecks and all three
maps' asset verification passed. Two real local browser clients verified an
actual lethal sniper hit, attribution, death-body removal, notification/feed,
disabled gray countdown, camera tracking, reconnect continuity, killer-leave
fallback, settings/weapon selection and the approved shotgun respawn. Unit
tests cover duplicate events and FFA/Teams feed relationships. A normal
pointer-lock client resumed gameplay after respawn, and the two-client Phase 3
weapon, animation, chat and scoreboard regression also passed. A separate
browser run loaded all three maps with their PBR materials and traversed both
ends of every upper route, with no missing assets or browser exceptions. The
two-client controls regression passed custom bindings, typing isolation,
chat, pause, leaderboard and server-confirmed slide-jump. The first
Worker run exposed a flaky shotgun direction assertion; its corrected
aim-relative assertion passed in the full rerun. No tests remain known to fail.

The camera follows synchronized motion only; it cannot reproduce the killer's
private first-person recoil or view model. Tests used local clients and Worker,
not the public deployment. Protocol is now **v9**: deploy a matching Worker
and frontend together when authorized, with the frontend's existing
`VITE_MULTIPLAYER_URL` pointing at the Worker and its origin allowlist including
the GitHub Pages origin. Mixed v8/v9 builds will not connect. Phase 2 remains
deferred, and no other phase was started.

# Phase 3 character weapons, chat and leaderboard

Updated: 2026-10-30. The home character and real remote characters now use the
existing weapon GLBs and their exported grip anchors. A scene-local shared
asset library supplies independent attachments, with arm IK and additive
upper-body/head aim layered on the existing movement and lean animations.
Remote loadout, yaw, pitch and ADS come from the authoritative snapshots; this
presentation does not change server positions, collision or hit detection.
Weapon attachments are replaced on a server-approved new life. The home preview
loads only its selected weapon and character, retaining the existing idle,
mouse response and fade without loading a map.

The existing server-validated public chat now defaults to Enter for new control
settings, shows the current binding above the health bar, and displays a bounded,
fading HUD feed. Existing saved custom bindings, including the earlier T default,
are preserved. Typing isolates gameplay input and restores pointer lock when
the browser permits it. Scoreboard name colors use the actual local player and
server team relationship; kills, deaths and weapon silhouettes are unchanged.
The existing server chat protocol, validation and rate limit are reused.

Verification: 231 frontend tests, 49 local Worker tests, frontend and backend
typechecks, frontend production build and Worker dry-run build passed. Two real
local browser clients verified the selected home weapon and hand anchors,
server-synchronized weapon and aim, running/sliding/jumping, a valid respawn
weapon change with one attachment, the updated home preview, chat delivery and
Escape, and FFA relationship colors. FFA and Teams name relationships and all
four weapon assets were additionally checked in frontend tests. Local tests do
not validate the publicly deployed Worker or GitHub Pages. Phase 3 changes
require a frontend publication; the Worker must already include the Phase 1
protocol-v8 chat changes. No commit, push or deployment was performed. Phase 2
was not supplied, and no later phase was started.

# Phase 1 controls, sliding, weapons and HUD

Updated: 2026-10-30. Added customizable keyboard/mouse bindings under Gameplay,
with conflict detection, Escape cancellation, individual/all resets and the
existing Apply/Back draft and localStorage behavior. Keyboard aim is supported.
The existing game had no chat; T opens a small real multiplayer room chat with
server-derived names, bounded messages and rate limiting. Gameplay input is
cleared/ignored while typing. Interact is absent from the current game.

The shared movement controller now jump-cancels slides at any point, including
after leaving an edge, preserves horizontal momentum and applies the existing
cooldown and capped air control. A lightweight masked speed-line effect fades
at the screen edges. The health bar is slightly larger with a faded line.
Shared shotgun settings now use two shells and fourteen wider-spread pellets,
stronger close hits and faster falloff; only pellets that hit deal damage.
SMG rate is 1030 RPM with an original sharper synthesized, non-clipping sound.

The Worker and frontend now use protocol v8 so changed simulation and weapon
rules cannot be mixed with old clients. Both require publication together when
authorized; no commit, push or deployment was performed. No public Cloudflare
validation was performed. See `docs/PHASE1_CONTROLS.md` for details. Phase 2
has not been supplied and was not started.

Verification: 228 frontend tests, 49 local Worker/WebSocket tests, both
typechecks, the production frontend and Worker dry-run builds, and asset
verification passed. Two local browser clients exercised rebinding and
conflicts, Apply/Back/reset and storage, keyboard aim/fire, default mouse fire,
leaderboard/pause, actual room chat and typing isolation, server-confirmed
slide-jump, edge effects and health HUD. The original SMG waveform was
reproduced from its generator and measured at a 0.8 peak with no clipped samples.
The browser and Worker results are local and do not validate public deployment.

# Q/E corner leaning

Updated: 2026-10-30. The existing shared fixed-step movement now eases held Q/E
lean, checks the upper-body path against map collision, and returns to neutral
when both keys are held or during a jump/slide. The camera and weapon move and
roll together. The weapon pulls back or hides against close cover, with bounded
pullback and recovery when clear. Q formerly selected the last weapon; number
keys and the mouse wheel still switch weapons.

The Worker validates lean input and derives the firing eye, upper-body/head
hitboxes and shot direction using authoritative movement and map collision.
Snapshots carry lean to the existing remote skeleton; the visible head was
checked against its hitbox at multiple headings. Protocol v7 requires matching
frontend and Worker releases, and persisted older motion initializes neutral.
Public Cloudflare has not been tested or changed. No commit, push or deployment
was performed. See `docs/LEANING.md` for details.

The local Worker suite passed all 45 tests, including real FFA/Teams WebSocket
shots at leaned players, map wall blocking, validation and session continuity.
All 215 frontend tests, both typechecks, the frontend production build and the
Worker dry-run build passed. Two real local browser clients verified Q/E and simultaneous-key neutral,
animated remote head alignment at two headings, walking, jump/slide cancellation,
aimed damage and reloading, both wall-limited lean directions, bounded weapon
clearance and recovery. This uses the local Worker, not public Cloudflare.

# Compact maps for 2-6 players - complete

Updated: 2026-10-30. Completed European Town, Industrial Complex, Modern City,
then shared collision/spawn validation, preserving earlier uncommitted work.
No commit, push or deployment. Details, regeneration commands and evidence:
`docs/COMPACT_MAPS.md`.

- Town: **52 x 52 m**, down from 66 x 66 m (21.2% per dimension), with offset
  street loops, well plaza, market/shop courts, garden hall and baker court.
- Industrial: **54 x 54 m**, down from 68 x 68 m (20.6%), with connected warehouse
  and workshop interiors, loading square, goods/container yards and utility yard.
- City: **54 x 54 m**, down from 68 x 68 m (20.6%), with varied roads/sidewalks,
  diner/shop routes, garden court, plaza and lobby shortcuts.
- Each has a two-ended **2.8 m upper route**: covered market gallery, metal
  warehouse catwalk, covered second-floor passage. Stairs/decks/supports/rails
  use the same procedural solid parts for visible geometry and Worker collision.
  Suspended decks retain a standing-height underpass; both stair approaches work.
- Added five optimized Blender props: flower box, market crate, stone bollard,
  pump skid and utility box. Retained existing prop assets, architecture, roof/PBR
  textures, environments, lighting/shadows and graphics presets. No model scaling.
  The revised maps place 51/23/35 props plus Town's well; clearance checks keep
  doors/stairs clear, furniture supported and wires attached to surviving poles.
  Two purposeful industrial yard fence segments replace automatic fence slivers.
- Regenerated map building GLBs, terrain, collision/debug GLBs, map indexes,
  prop catalog/new GLBs, asset manifests and editable map/props `.blend` sources.
  Removed only obsolete generated block files. Source reproduction is byte-for-byte
  identical for all three layouts. Added overhead `docs/*-compact-plan.png`
  diagnostics; no gameplay tactical map was added.
- Sixteen asymmetric spawn candidates per map retain safe ground, clearance,
  quadrant coverage and spacing. The authoritative spawn chooser now prefers
  separation and geometry-screened opponent sightlines, with a clear fallback.
  Shared layout/collision/catalog imports automatically revise frontend and Worker
  hashes. Protocol v6, public-main, 10-minute rounds, combat, health and saved
  settings are preserved. **Both frontend and Cloudflare Worker need publication
  together when authorized**; public Cloudflare was not tested or changed.

Final verification: **207 frontend tests in 23 files**, frontend TypeScript and
production builds, **178 asset entries / 213 materials**, backend TypeScript,
Wrangler dry-run build and **41 real Worker/SQLite/WebSocket tests** all pass.
New checks cover route cycles, actual prop-inclusive ground connectivity, stair
traversal in both directions, headroom/underpasses, physical yard fences, shared
revisions and screened spawn selection against 1-5 opponents across every map.
Existing geometry-overlap limits were retained; detected shared surface planes,
a canopy/stair collision, sidewalk/lobby overlap and workshop prop obstruction
were corrected in the generators/placements.

Production Chrome tests loaded all three maps under `/crossfire/`, walked all six
upper-route directions, retained settings and resolved all PBR materials, without
asset errors or uncaught browser exceptions. High-quality gallery and overhead
captures were visually inspected. Two actual browser players then stayed connected
for over **61 seconds with delayed real packets**, synchronized keyboard movement
and orientation, recovered from genuine socket closes with exactly one socket/actor
per session, preserved health/ammo/life/team/scores/round timing, and left without
retrying. This validates local multiplayer, not a public deployment or human
six-player balance. The first cohosted backend run hit an existing close-event
timing assertion; its isolated rerun passed without changing heartbeat detection.

Evidence: `test-results/compact-{frontend-tests,typecheck,build,build-local-network,
assets,server-types,server-final,browser-final,multiplayer}.log`, plus screenshots
and samples in `test-results/compact-browser/` and `compact-multiplayer/`.
The multiplayer browser build explicitly supplied the local WebSocket URL; the
GitHub Pages workflow and production URL configuration were not changed.
`git diff --check` passes; the existing large-bundle warning remains.

No implementation stage remains in this request. Stopped after completion;
further human 2-6-player balance feedback and any publication require a new request.

# Previous task: directional damage haze and health regeneration - complete

Updated: 2026-10-30. Added only the requested damage presentation and server health regeneration, preserving maps/assets, graphics settings, weapon damage/actions, scoring, teams, animations, HUD layout, protocol v6 and the previous reconnect fix. No commit, push or deployment was performed. Implementation and exact verification commands: `docs/HEALTH_AND_DAMAGE_FEEDBACK.md`.

The existing confirmed current-life hit path now weights four lightweight CSS edge gradients using the actual incoming server ray and current camera yaw/pitch. Side attacks emphasize the matching side, front attacks favor the upper edges, and rear attacks tint the perimeter with stronger bottom/rear emphasis. Turning after a valid hit updates the weights. The middle remains fully transparent, with bounded alpha, the existing quick onset/500ms fade, repeated-hit refresh and direction arrow retained. No attacker tracking or health-difference-triggered damage cues were added.

The Worker uses its existing room simulation and a private persisted `regenAt` cursor: every accepted damaging hit restarts a full five-second wait, then each complete 100ms earns 1 HP (first point at 5.1s), up to the existing 100 HP maximum. Elapsed server time determines progress regardless of tick/input frequency. New damage interrupts healing; death, respawn and round transitions clear old progress. The cursor accompanies health in SQLite sessions and socket attachments; valid resumes consume only elapsed unused steps, including time within the existing disconnect grace. Older damaged records start a conservative new wait. No client healing timer, per-player repeating timer, new public protocol field or authentication change was introduced. Existing snapshots update local HUD and peers.

Verification passes: **189 frontend tests in 22 files**, frontend TypeScript, production Vite build, backend TypeScript, Wrangler dry-run build and **41 real Worker/SQLite/TCP tests**. Exact boundary tests cover five full seconds, first 100ms, 10 HP/s, irregular cadence, serialized progress reuse without double-healing, repeated damage, interruption, death and fractional-health cap. Real FFA and Teams tests use genuine shots for delayed healing, delay resets, interruption, authoritative peer snapshots, valid resume without restarting the deadline, full-health cap, dead/unspawned exclusion, respawn and round changes. Existing packet security, weapon/rate/ammo, score, movement, heartbeat, object eviction and runtime reconstruction checks still pass. Actively healing rooms intentionally keep the shared simulation running; an exploratory forced-active-eviction check was removed because Miniflare refuses active references. No production lifecycle limit was relaxed.

The focused production-browser test passed against a real isolated Worker with one actual shooter socket and a real browser victim. Server-confirmed SMG shots from right/left/front/behind drove correctly directed rendered gradient pixels; the camera-turn and repeated-hit checks passed. Sampled center pixels were exactly clear for all directions, opacity stayed bounded, and the effect faded fully in about half a second. Captured right/rear gradient images were visually inspected. The existing HUD displayed regenerated authoritative health and the actual peer received the identical snapshot health. No uncaught browser errors or asset failures occurred. CSS pixel inspection clones only recorded real-hit HUD styles over black for deterministic captures, without synthetic hits, fabricated players or health assignments. Test rendering cost was bounded; transport/physics/health clocks remain real.

Final evidence: `test-results/health-{unit,typecheck,build,server-types,server-final,browser}.log`, plus screenshots and actual style/pixel samples in `test-results/health-browser/`. Earlier setup/timing/active-eviction attempts are superseded by these final passing records. `git diff --check` passes; existing bundle-size warnings remain. Publish the frontend and Worker when authorized to make both improvements public; no public Cloudflare session was validated by local tests. Stop here; no other feature work was started.

---

# Previous task: recurring multiplayer reconnection - complete

Updated: 2026-10-30. Prioritized this issue exclusively. The old client generated 120 input frames/second but allowed only 24 outstanding frames; delayed ACKs filled the 120-frame prediction queue and called `reconnect()` on a healthy socket. The old-code regression reproduced the first reconnect at 3,799 ms with valid 250 ms delayed snapshots. Resetting retries on every welcome made this repeat indefinitely. This is a confirmed source/local reproduction; a live public Cloudflare trace has not been obtained.

Implemented latency-aware outstanding input (24-48 frames), retaining the server's 48-frame queue and 12-frame/20 Hz batches. Full prediction queues apply bounded backpressure instead of closing sockets. Actual close events own bounded exponential retries with jitter; only 30 seconds of stability resets the budget. Duplicate state notifications/opens are guarded, old callbacks and timers/listeners are cleaned up, Leave cancels retries, and visibility resume probes before timing out. Valid packets update liveness; heartbeat intervals, receive/Worker timeouts, protocol v6 and authoritative gameplay/persistence are unchanged. Added default-silent client/Worker diagnostics, focused transport regressions, real earned-score resume assertions and a two-browser delayed-message/socket-drop harness. See `docs/NETWORK_RECONNECTION.md` for diagnosis, exact PowerShell commands, diagnostics and deployment boundary.

Frontend TypeScript, production Vite build and all **184 frontend tests** pass. Backend TypeScript, Wrangler dry-run build and **39 real Worker/SQLite/TCP tests** pass, including newly strengthened resume checks after earned nonzero kills/deaths/team scores, plus health, ammunition, weapon, life, team and round deadline. Existing rejection of malformed/replayed/flooded input, heartbeat expiry, session expiry, object eviction and complete runtime reconstruction remain tested. No production heartbeat or server queue limit was relaxed.

The final complete production-browser regression passed with two independent Chrome contexts and a real isolated Worker. Both clients remained connected for **61.719 seconds** with actual incoming packets delayed 250 ms, no additional opens/closes, no reconnecting toast and ongoing authoritative ACK progress (over 6,000 frames each between first/last samples). Real keyboard movement, peer rendered position and orientation passed. Actual server socket closes with code 1012 were reported, followed by authenticated resume with one active socket per browser, the same identities and unchanged health/ammo/life/weapon/team/scores/map/mode/deadline. No duplicate roster entries or remote actors remained. Intentional Leave closed both sockets with code 1000, produced zero Worker presence and no retry over the next five seconds. Default network console logging was silent; no uncaught browser errors or asset HTTP failures occurred. Test rendering was bounded (Low quality/half resolution/frame scheduling) to avoid cohosted GPU contention; elapsed-time physics and production transport/heartbeat timers were unchanged. This is connection validation, not an FPS benchmark.

Evidence: `test-results/reconnect-baseline.log` records the old-code failure; final passing records are `test-results/reconnect-{unit,typecheck,build,server-typecheck,server,browser-final}.log` and `test-results/reconnection-final/results.json`. Earlier concurrent asset-audit timeout, fixed-delay/browser-render-rate assertions and navigation-contention attempts are superseded by the final passing runs. The harness now awaits actual authoritative movement/orientation and tests continued ACK progress at transport cadence rather than imposing a rendering benchmark. `git diff --check` passes. The production build retains the existing large-bundle warning.

**Deployment:** the loop correction requires a rebuilt/published frontend. This task's Worker changes only add optional diagnostics, so a Worker release is needed for those logs, not for this client fix against an already matching v6 backend. Prior unshipped v6 changes in this working tree still require matching frontend/Worker versions when released. Keep the Actions `VITE_MULTIPLAYER_URL` set to the real public `wss://.../ws`, not the local test URL. Public Cloudflare/GitHub Pages two-client operation was not validated; no public endpoint trace was obtained. No commit, push or deployment was performed. No other feature stage was started. Stop here.

---

# Previous task: home character mouse look - complete

Updated: 2026-10-30. Increased the preview body's horizontal mouse response to 15 degrees and added a subtle vertical lean. The actual head rig follows the cursor horizontally and vertically with an additional, slightly stronger rotation. Its offset is applied after the IDLE animation and restored before the next animation update, preventing accumulated rotation and preserving the existing breathing motion and reduced-motion behavior. The responsive camera also makes the character slightly larger while retaining the full head and the fade above the knees. No gameplay, multiplayer or character-asset changes were made.

Frontend TypeScript and production Vite build pass. Production-browser home checks pass for upper-right and lower-left cursor movement, actual head-bone rotation, idle playback, a stationary cursor without rotation drift, return to neutral, reduced motion, existing settings/navigation and five desktop/mobile viewports. Screenshots were inspected for framing and head movement; evidence is in ignored `test-results/home/` and `test-results/home-mouse{,-build}.log`. No commit, push or deployment was performed.

---

# Previous task: home character framing - complete

Updated: 2026-10-30. Enlarged the existing home preview with an aspect-aware camera that keeps the head and shoulders in frame and shows the torso, arms and upper thighs. The canvas has a smooth transparency mask derived from character height, fading from the upper thighs to fully transparent above the knees. The procedural pad and rim remain present but disabled; no asset or character-model changes were needed. Existing IDLE, cursor response, skin, reduced-motion handling, background, navigation and lazy map loading remain intact. No gameplay or multiplayer code was changed.

Frontend TypeScript and production Vite build pass. The existing production-browser home suite passes at 1920x1080, 1280x720, 1024x600, 390x844 and 320x568, including preview skin/idle, cursor movement, platform visibility, mask, settings, navigation, reduced motion and no map/weapon/environment loads. Inspected desktop and mobile screenshots for full head, smooth fade, absence of knees/feet/platform and no black rectangle; evidence is in ignored `test-results/home/` and `test-results/home-framing{,-build}.log`. The initial dev-server browser attempt timed out during dependency optimization and logged the pre-existing public-asset import warning; the completed production build was used for visual verification. No commit, push or deployment was performed.

---

# Previous task: silhouettes, directional deaths/damage and home character - complete

Updated: 2026-10-29. Implemented the latest character-visuals attachment in its requested order, preserving the existing character GLB/six clips, maps, weapons/damage, multiplayer authority, menus and Pages/Vite configuration. No commit, push or deployment was performed. Implementation/PowerShell runbook: `docs/COMBAT_VISUALS.md`.

## Features implemented

- Replaced per-part expanded outline hulls with one shared, depth-tested visible-union mask and a thin 1.5 CSS-pixel inward contour. Skin, clothing and gear use the same mask color; no internal material boundaries or bounding boxes are outlined. Existing rig deformation follows running/jumping/sliding. Opaque map geometry and foreground weapons occlude the mask; FFA opponents are red and relative Teams allies blue. Name LOS/through-wall teammate rules remain intact. The mask is excluded from SSAO prepasses and the contour stays after bloom/AA when quality pipelines rebuild.
- Added confirmed directional deaths: the current actor tips along the actual incoming world-space shot ray, fades smoothly over 500ms, then disposes its instance/rig/groups and temporary fade materials/texture clones. A small foot lift and depth prepass limit floor/transparency artifacts. Labels/outlines stop on elimination. New authoritative lives replace unfinished effects without delaying respawns; surviving actors keep their original shared assets.
- Added bounded 500ms CSS red screen edges with a clear center and off-crosshair red turning chevron. Front hits omit the arrow; side/rear hits use the shortest turn toward the attacker, with direct-rear ambiguity consistently right. Turning updates the direction. Repeated hits refresh from current opacity with bounded strength; navigation and new lives clear stale effects.
- Added the actual multiplayer GLB/IDLE skin to the existing blurred home background on a rounded dark metallic pad with soft shadow and preview lights. The project has one skin, which is reused without another selection system/model. Cursor turning is smoothly limited to 7.2 degrees, with feet on the pad; reduced motion freezes movement. No playable map, environment texture, weapon or player connection loads for the preview. Settings/match navigation aborts loading, removes listeners and disposes the preview scene, source assets, rig, engine and canvas.
- Protocol **v6** adds server-derived normalized incoming rays and victim life to accepted hit entries, plus unique elimination IDs/life/lethal direction (null for falls). The Worker still derives hits from authoritative poses and unchanged weapon simulation; clients cannot submit hits/damage/direction. Runtime validation, bounded event deduplication and stale-round/life rejection protect presentation. Elimination is delivered before its dead snapshot removes the actor. No storage migration or gameplay balance change is introduced.

## Verification completed

- Frontend TypeScript, **175 tests in 21 files**, production Vite build, backend TypeScript, Wrangler dry-run build and **39 real Worker/SQLite/TCP WebSocket tests** pass. New units cover directional wraparound/rear ambiguity, death pose/fade, normalized event validation, duplicate/stale elimination ordering and repeated-hit timing/brightness. Real server tests verify accepted shot directions and life metadata. Asset verification passes **188 entries**, 213 materials and all three maps; character/map/weapon assets are unchanged.
- The full production-browser suite passes in **FFA and Teams**, using two independent Chrome contexts and two actual Node WebSocket sessions against isolated Workers. Actual GPU union-mask samples and screenshots show no internal seams; red/blue colors, opaque-wall/partial/scoped/distant visibility and all six movement clips pass. Real front/left/right/rear shots verify arrows, fading/tipping, removal in approximately 0.49-0.55s and normal ready skins after respawn. Existing 75-damage sniper body hits, HUD/peer health 25, browser-input damage, headshot death, Respawn/health 100, real keyboard movement, lost-spawn-ack retry and disconnect cleanup remain verified. Skeletons decrease 2 to 1 and groups 12 to 6 on leave, with private pose textures freed and shared assets retained. No unexpected asset HTTP failures or uncaught browser errors occurred.
- Home checks pass five viewport sizes, complete title and navigation, actual GLB/IDLE advancement, restrained cursor turn/neutral return, no map/weapon/environment downloads, existing settings/audio behavior and reduced-motion freezing. Cancellation tests prove the preview engine count drops 2 to 1 on joining, its canvas/rig are disposed, actual delayed join/material/character/weapon/preview/map loads and round transitions cancel safely, and retry/approved spawning work without duplicate previews. The real two-browser lifecycle suite passes all three map transitions, loadout locking, SMG fire/reload without arms, fall/respawn, settings, scoreboard, reconnect and leave.
- Final focused quality verification passes in **both FFA and Teams** after fixing asynchronous pipeline rebuild ordering and opting the unlit mask out of the main scene SSAO prepass. It uses one actual browser plus three real peer/guest sockets, waits for shader/pipeline readiness and verifies High/Medium transitions keep the contour after bloom/AA. Red/blue pixels, internal-mask probes and no uncaught browser errors also pass. The full combat suite above separately used two browsers plus two peer/guest sockets. Earlier interrupted/failing quality attempts are superseded by `test-results/polish-quality.log`; the targeted check avoids a stalled High-quality screenshot readback rather than claiming that capture succeeded.
- Evidence: ignored `test-results/polish/` contains inspected outline, wall, partial-cover, movement, directional damage and death screenshots plus actual sampled death timing JSON. Final suite logs: `test-results/polish-{unit,build,assets,server-typecheck,server,browser,home,loading,lifecycle,quality}.log`. Earlier failed fixture runs are superseded by the named final passing records where stated. The server integration fixture's grace window was widened from 3s to 10s because local runtime reconstruction could exceed 3s; explicit expiry is still tested and production timeouts remain unchanged. Browser firing uses real canvas/window Input handlers via MouseEvents because native headless CDP delivery was unreliable.

## Files and deployment boundary

New runtime files: `src/rendering/PlayerSilhouettes.ts`, `src/game/CombatPresentation.ts`, `src/ui/DamageFeedback.ts`, `src/ui/HomeCharacter.ts`. Integrated through `src/game/Game.ts`, `src/game/RemotePlayers.ts`, `src/ui/UI.ts`, `src/styles.css`, `src/network/MultiplayerClient.ts`, `shared/protocol.ts`, `server/src/index.ts`.

Verification: new `tests/combatPresentation.test.ts`, `tests/damageFeedback.test.ts`; extended `tests/multiplayerTransport.test.ts`, protocol fixtures in `tests/{combat,guestProfile,network,prespawn}.test.ts`; `server/tests/{combat,integration,runtime-fixture}.mjs`; `tools/{combat-visibility,home,loading-cancel}-test.mjs`. Documentation: `docs/COMBAT_VISUALS.md`, `docs/{CHARACTER_PIPELINE,MULTIPLAYER_ARCHITECTURE,MULTIPLAYER_COMBAT,TESTING}.md`, both READMEs, CLAUDE.md and PROGRESS.md.

**Cloudflare needs redeployment alongside a matching protocol-v6 frontend when authorized.** Preserve public-main, existing SQLite bindings/storage and exact allowed Pages origin; production uses `wss://<worker-host>/ws`. Local tests do not establish public operation, full 16-player capacity or Chromebook hardware performance. Short cohosted Medium-quality outline-enabled/disabled samples were FFA 46.9/45.3 FPS and Teams 43.6/47.9 FPS; these are noisy comparisons, not hardware guarantees. Existing large-bundle warnings remain. No unrelated development stage is started.

All requested implementation and local checks are complete. `git diff --check` passes. Stop here; no commit, push or deployment was performed.

---

# Previous task: actual Blender multiplayer character - complete

Updated: 2026-10-29. Finished implementation and local verification of the supplied multiplayer-character request. The reference is `references_images/Player.png`. Reused the existing analytic humanoid geometry and generated the editable `blender/characters/player.blend` and actual skinned `public/assets/characters/player.glb` using Blender 5.2.3 LTS. The reproducible bpy source is `blender/characters/generate_player.py`; run `npm.cmd run assets:player`. See `docs/CHARACTER_PIPELINE.md` for the pipeline, axes, measurements and exact verification commands.

## Completed implementation

- The actual exported humanoid has a face, cap/beard, clothing, tactical vest/pouches, articulated hands and boots. Its audited GLB contains one 18-joint skin, 9,248 triangles, 4,931 exported vertices and three materials sharing an embedded 256px albedo/ORM atlas pair; file size is 456,152 bytes. Metadata and source atlases accompany the GLB. All six real in-place clips are exported and played: IDLE (2.4s), RUN (0.8s), JUMP_START (0.2s), JUMP_LOOP (0.8s), JUMP_LAND (0.3s), SLIDE (1.0s). Grounded feet and posed bounds are measured during generation.
- The game loads the character once and shares geometry, materials and textures across independent rigs and animation groups. Presentation normalizes height to 1.8m, preserves heading/ground alignment and blends states from existing authoritative snapshots. Animation follows interpolated server displacement even when a snapshot's final instantaneous velocity is zero. The slide uses a low articulated pose without squashing the mesh or moving the authoritative root. No local first-person humanoid is created.
- Native depth-tested skinned outlines retain red opponents and blue teammates relative to the viewer. Actual animated bones drive LOS probes and head-label anchors: enemy names require visibility; teammate names retain the existing through-wall rule inside the camera view. Static measured pose bounds avoid per-frame CPU reskinning. Leaving/death disposes the instance's skeleton, groups and private GPU pose texture while preserving shared assets for remaining players.
- Fixed observed client startup/movement issues encountered during real testing: Retry enters an already server-approved life after a lost/late spawn acknowledgement; independent pending/unsent arrays prevent duplicated input frames on reset; input sends wait for acknowledgements with at most 24 frames in flight under the unchanged 48-frame server queue. Server authority, protocol v5, maps, weapon balance/models, menus, Vite and GitHub Pages configuration remain intact.

## Final verification

- Frontend TypeScript, **170 tests in 19 files** and production Vite build pass. Backend TypeScript, Wrangler dry-run build and **39 real workerd/SQLite/TCP WebSocket tests** pass. Asset verification passes **188 manifest entries**, 213 global materials and all three maps. `tools/inspect-character.mjs` checks actual GLB skin weights, embedded textures, clip channels, in-place root and asset budgets.
- The complete production-browser character/combat suite passes in **both FFA and Teams**, against isolated real Workers with two independent Chrome contexts plus two actual Node WebSocket sessions (one unspawned). Verified actual GLB loading without placeholder bodies, all six clips, advancing RUN frames, independent poses, authoritative jump height, articulated slide, shared assets, native relative-team colors, wall/partial/distant/scoped visibility and labels. Actual browser keyboard movement stays connected. Dropping one real spawn acknowledgement verifies the Retry recovery without inventing a response.
- Real combat still passes: sniper body damage 75, victim HUD/second-browser health 25, browser input damaging another player, lethal headshot and approved Respawn/health 100. Disconnect reduces skeletons 2 to 1 and animation groups 12 to 6, frees the departed rig's private GPU pose texture, and preserves the remaining actor's ready shared textures. No unexpected asset HTTP failures or uncaught browser errors occurred. Browser firing uses MouseEvents through the real Input handlers because native headless CDP mouse delivery was unreliable; physical mouse hardware is not covered by that automation.
- Preservation regressions pass all three map transitions, approved/locked loadouts, SMG fire/reload, settings, death/respawn, reconnect and leave. Loading Back cancels actual join/material/character/weapon/preview/map transfers and round transitions, blocks stale completion and allows successful retry, including a cancelled GLB download. Home checks pass five viewport sizes, full-title visibility, text navigation, settings, reduced motion and lazy loading.
- Visually inspected the final FFA/Teams character, run, jump, slide, wall and partial-cover screenshots. Evidence is under ignored `test-results/character/`; logs are `test-results/character-{blender,glb-audit,assets,unit,build,server-typecheck,server,browser,lifecycle,loading,home}.log`. Short local outline-enabled/disabled samples were FFA 49.4/46.6 FPS and Teams 43.1/45.6 FPS with two visible remote characters. These cohosted samples do not establish full-room capacity or Chromebook hardware performance.

## Completion and limits

The character feature is complete locally. Public deployment/operation, full 16-player load and performance on actual Chromebook hardware remain unverified. This feature adds no backend/protocol change; the baseline server must support protocol v5. A frontend publication requires separate authorization. No commit, push or deployment was performed by this continuation. Stop here; no next development stage is started.

---

# Previous task: multiplayer damage and visibility - available work verified; character export pending at that time

Updated: 2026-10-28. Completed the latest attachment's authorized damage, reusable character interface, outlines, name tags and local verification. The attachment explicitly allows an interface fallback when the separate character export is unfinished. Prior Stage A work and existing hosting configuration are preserved. No commit, push or deployment was performed by this task.

## Root cause and completed changes

- The existing frontend fired only into local map/practice-target geometry. Remote bodies were visual objects; the protocol carried no combat controls or health, and the Worker had no weapon simulation or player-hit/damage path. Mesh pickability alone could not fix this.
- Protocol **v5** adds sequenced trigger/reload control and authoritative health/gun state, hit results and elimination notifications. The Worker runs the existing shared weapon state machines, derives rays from its own controller poses and validated look, checks head/torso intersections against map collisions, and applies the unchanged rifle/SMG/sniper/shotgun damage, falloff and 1.5x headshot rule. Clients cannot submit damage, targets, ammo, cooldowns, positions or scores. Finite magazines, infinite reserves, reload timing and weapon models remain intact.
- Health, eliminations, kills/deaths, team totals and approved respawns are server-owned. Missing frames do not auto-fire or manufacture trigger edges. FFA/Teams mode derives from the persisted round seed; Teams assigns balanced relationships and disables friendly fire. Neither mode has safe zones. Existing single-room ten-minute rounds/map rotation remain in place. Health, gun state and team totals persist together and survive valid authenticated resumes.
- Frontend reconciliation restores authoritative weapon/health state and replays pending control silently. Multiplayer hit markers and elimination notices use real server results/names; local muzzle/recoil/audio and environment impacts remain responsive. Dead/disconnected bodies and labels are removed without invented roster/score data.
- Remote outlines use Babylon's shared, depth-tested body outline renderer: red opponents, blue teammates relative to the viewer, including Red Team teammates. Fully occluded bodies have no outline; actual geometry clips partly exposed silhouettes. A scoped torso can stay outlined when its head-label anchor is outside the viewport. A static triangle spatial index accelerates map LOS queries without another physics system or a full-scene render per player.
- Actual server names use bounded 11-14 px projected labels. Enemy names require stable body LOS and hide immediately when occluded. Teammate names remain blue through walls while inside the camera view. Existing pose interpolation drives both bodies and labels.

## Character boundary and remaining integration

Inspected `blender/characters/` again: it contains only `char_geometry.py`; there is **no exported GLB, skeleton or animation clips**. The folder was not modified. `CharacterAsset.ts` supplies a cancellable, Pages-compatible shared loader/instancer with actual-rig/clip validation, explicit missing/error state and independently cloned poses over shared geometry/materials. `CHARACTER_ASSET` stays null and existing capsules remain explicit placeholders. No humanoid or animation completion is claimed.

When the actual GLB arrives: inspect its real clip names, skin, scale, feet and forward direction; configure verified measurements/clip mappings; implement IDLE/RUN/JUMP_START/JUMP_LOOP/JUMP_LAND/SLIDE playback and blending; test independent skinned instances, ground alignment and animated outlines with real clients. Babylon's installed outline pass supports bones, but the absent character's skinned rendering has not been tested.

## Verification

- Frontend TypeScript, **164 unit tests in 17 files** and production Vite build pass. New tests cover body/head/lowered hit volumes, relationships, unchanged damage, weapon capture/replay, strict combat input and finite triangle LOS/openings/spatial buckets. Backend TypeScript, Wrangler dry-run bundle and **39 actual workerd/SQLite/TCP WebSocket tests** pass. All four weapons damage real opponents with synchronized health; headshots/sniper elimination, scores, respawn, resume health, friendly-fire rejection, map walls, forged shots, fire rate, ammo, reload timing and replay rejection are verified. Existing connection/movement/slide/storage/round tests also pass. The suites were rerun separately after a concurrent browser run caused short fixture timeouts/queue contention; production limits were not relaxed.
- Production `tools/combat-visibility-test.mjs` exits 0 in **both FFA and Teams**, using two independent Chrome contexts plus two actual Node WebSocket sessions (one unspawned), against isolated real Workers. Fixture RPC only positions already-spawned sessions on valid map sightlines; it never applies hits/damage/scores or assigns teams. Verified the actual 75-damage sniper body shot, victim HUD/second-browser health 25, browser canvas input damaging another player, lethal headshot, Respawn/health 100, relative colors, hidden/partial/distant/scoped bodies, labels through walls only for teammates, and no duplicate/dead/disconnected actors or uncaught browser errors.
- Inspected final FFA visible/wall/partial/distance and Teams visible/wall/partial/health screenshots. Red outline pixel comparison was 0 to 1725; the Red Team ally's blue outline was 0 to 1713. At 28.8 m the name remained 13 px. Short local outline-enabled/disabled comparisons were FFA 49.8/58.0 FPS and Teams 53.7/53.9 FPS with two visible remote placeholders; this is not a full-room capacity test. Visibility queries use an index of 302444 actual triangles in 2452 cells. Evidence: ignored `test-results/combat-visibility/` and `combat-browser-final.md` (successful terminal-run record superseding the earlier concurrent failure log).
- Existing production practice gameplay regression passes movement/stairs/walls, original weapons, firing/headshots, scopes/pump/bolt, finite magazines/infinite reserves, weapon-only reloads/audio and held leaderboard with zero console errors. Real two-browser lifecycle regression passes pre-spawn/settings, approved/locked loadouts, SMG fire/reload, fall/respawn, all three map transitions, reconnect and leave. Loading Back/cancellation passes delayed actual join, materials, weapons, preview/map loading and a real round transition, with stale completion blocked and successful retry.
- Home appearance checks pass at five viewport sizes, including the full title, text navigation, settings layout/colors, existing audio behavior and reduced motion, with no browser errors. `git diff --check` passes.
- Logs: ignored `test-results/combat-{unit,build,server,server-typecheck,gameplay,lifecycle,loading,home}.log`. Existing large Babylon bundle warning remains. Browser firing uses MouseEvents through the real canvas/window Input handlers because native headless CDP mouse delivery was unreliable; physical mouse hardware is not verified by that automation.

## Feature files

Authority/protocol: `shared/combat.ts`, `shared/protocol.ts`, `server/src/index.ts`, `src/weapons/Weapon.ts`, `src/game/Damage.ts`. Frontend: `src/network/MultiplayerClient.ts`, `src/game/Game.ts`, `src/game/RemotePlayers.ts`, `src/game/CharacterAsset.ts`, `src/rendering/VisibilityWorld.ts`, `src/styles.css`.

Tests/tools: `tests/combat.test.ts`, `tests/visibility.test.ts`, protocol-envelope fixtures in `tests/network.test.ts`, `tests/prespawn.test.ts`, `tests/guestProfile.test.ts`; `server/package.json`, `server/tests/integration.mjs`, `server/tests/combat.mjs`, `server/tests/runtime-fixture.mjs`, `tools/combat-visibility-test.mjs`, `tools/prespawn-test.mjs` (now checks the actual server mode). Documentation: `docs/MULTIPLAYER_COMBAT.md`, `docs/MULTIPLAYER_ARCHITECTURE.md`, `docs/TESTING.md`, both READMEs, `CLAUDE.md`, `PROGRESS.md`. Earlier Stage A props/layout/graphics work remains intact.

## Deployment and limits

**Redeploy the Cloudflare Worker and publish a matching protocol-v5 frontend together, only when authorized.** The older public backend cannot process the new combat controls/health snapshots. `/health` now reports `protocol: 5`. Preserve `public-main`, SQLite bindings/storage and exact allowed Pages origin; production frontend must use `wss://<worker-host>/ws`. GitHub Pages/Vite configuration is unchanged. Exact tested local PowerShell commands and deployment requirements are in `docs/MULTIPLAYER_COMBAT.md`. Local multiplayer is verified; public deployment/operation was not tested or performed.

No historical lag compensation/rewind is implemented; server-current moving targets may be less forgiving at high latency. Alpha-cutout sheets conservatively occlude markers and tiny exposed body portions may miss the interior visibility probes. The actual character GLB/playback/skinned verification remains the next unfinished integration. A dedicated match-results phase and Extreme Quality are outside this task. **STOP after this feature; do not start unrelated stages or deploy automatically.**

---

# Current task: sliding/rendering/leaderboard update - Stage A complete

Updated: 2026-10-27. Inspected the existing shared movement/Worker/prediction, procedural props, all three layouts and scoreboard before implementation. Baseline frontend typecheck, 144 unit tests and production build passed. Sprint/manual crouch still existed; the well coping was wound downward, canopy reverse faces could collapse during Blender welding, and court benches had insufficient facade/trim clearance. Worked on Stage A only.

## Completed

- Shift initiates a roughly one-second slide, with a smooth lower/return camera and collision height, 7.8 m/s initial speed decaying toward the existing 4.7 m/s walk speed, captured travel direction and limited steering (0.65 rad/s). Sprint and Ctrl/C manual crouch bindings are removed. A one-second cooldown starts at the end; holding Shift never repeats, early presses do not queue a later slide, and speed cannot stack. Normal walking resumes. A stationary player needs movement intent before sliding.
- Existing fixed 120 Hz cylinder/box collision is retained. Walls block slides, open stairs remain climbable, stairs under insufficient ceiling clearance block ascent, and the body stays lowered beneath cover until there is room to stand. PlayerCamera interpolates the height between physics ticks and suppresses walking bob during slides. Existing weapon models, damage, ammunition, reload timing/audio and movement-spread normalization remain unchanged.
- The same controller runs in the Worker and client prediction/replay. Protocol **v4** carries held slide intent and authoritative direction/timers/press state; arbitrary client speeds, timers, positions and old sprint/crouch packets are rejected. Missing frames preserve the server's held-key latch; idle releases are explicitly sent. Quick physical release/repress events survive between fixed ticks. Remote avatars interpolate the actual lower height. Real reconnection keeps the server session. Incompatible stored controller records safely return to pre-spawn; same-round scores/life are preserved.
- Fixed the well's coping top winding, closed its actual underside and removed the coincident internal post-bottom faces found by the overlap audit. Replaced the zero-height water cylinder with its single surface. Corrected the procedural source and regenerated the existing well asset without changing its appearance or disabling stone culling/transparency globally.
- Market fabric is one sheet with an explicit double-sided, two-sided-lit material, preserving stripe textures/UVs. Removed reversed duplicate roof/valance faces that Blender welding could discard. Both red/green source variants and all four placed stands use the fix. Regenerated editable props, GLBs, materials and manifests through the existing Blender pipeline.
- Audited all eight benches in the three layouts: four in Town, four in City, none in Industrial. Moved the two mirrored court benches in each affected map away from facade trim/stair edges; plaza benches remain in place. Updated both the canonical layout coordinates and placement scripts. Client and server colliders derive from those same placements; no separate collision offset was added. Map revisions reflect the layout edits.
- Leaderboard decoration now feathers farther outward over a wider, gently stepped gradient. Its content width, names, icons, scores and server behavior are retained at full opacity. A small content wrapper preserves scrolling while allowing the background to extend beyond the content bounds. Menus/settings were not redesigned.

## Validation and evidence

- Frontend TypeScript, **154 unit tests in 15 files**, production Vite build and asset verification pass. Movement tests cover duration, cooldown, held/early presses, captured direction/steering, snapshot replay, 30/144 FPS driving, walls, thin-wall tunnelling, ordinary/slide stairs and low ceilings. New prop tests check editable normals, nonduplicate fabric sheets, generated double-sided definitions, supported bench feet and clearance from stairs/solids/other props across all three layouts.
- Backend TypeScript, Wrangler dry-run bundle and **20 Node runtime tests** pass against actual workerd/SQLite/WebSockets. Added a real-client slide/cooldown/held-key/gap/illegal-speed case. The existing flood test now sends a sustained burst: five batches could straddle a legitimate timer tick and fit the bounded queue. Time/queue limits remain unchanged. Existing identities, join/leave, movement validation, reconnect, eviction/restart, fall/respawn, round transitions and all three maps pass.
- Production `tools/stage-a-test.mjs` passes with two independent Chrome contexts and an isolated actual production Worker. Real keyboard Shift lowers/returns the camera, lasts about one second, respects the speed bound/cooldown/held latch, lowers the other browser's avatar, supports idle release/quick repress, removes Ctrl crouch, retains real leaderboard names and reconnects the same session. No synthetic connections, roster, scores or snapshots; no uncaught browser errors.
- Visually inspected production screenshots from eight directions around the well plus an elevated rim view, all four canopy undersides, all eight benches and the two-real-player leaderboard. Repeated rendering capture after the final internal-face fix and inspected the regenerated well again. All three maps load with no missing materials. Evidence: ignored `test-results/stage-a/`, including `slide-samples.json`, plus `stage-a-browser.log` and `stage-a-render-final.log`.
- Existing production practice gameplay regression passes movement/stairs/walls, original weapons, firing/headshots, scopes/pump/bolt, limited magazines/infinite reserve, weapon-only reloads and held leaderboard, with no console errors. Loading-cancellation regression passes delayed actual joins/assets/map/round loads, Back/leave, stale-result suppression and successful retry/spawn against a real isolated Worker. Settings Apply/Back/persistence regression and home appearance checks at five viewport sizes pass.
- Final 2 mm live-batch geometry audit reports **no well/canopy overlap family**. It still reports about **0.7 m2 across 22 small overlap families in unchanged building/terrain/fence/bench-joint geometry**. These existing candidates are outside this focused stage; this is not a claim that the whole game has zero overlapping triangles. The newly introduced internal well-post overlap was removed at its source before completion.
- Logs: ignored `test-results/stage-a-{unit,build,server,server-typecheck,assets,browser,gameplay,loading,settings,home,zfight,render-final}.log`; final audit JSON/dump and Blender generation logs are alongside them. Existing large Babylon bundle warning remains. `git diff --check` passes.

## Files modified

Movement/network: `src/config/constants.ts`, `src/core/Input.ts`, `src/player/PlayerController.ts`, `src/player/PlayerCamera.ts`, `src/game/Game.ts`, `src/game/RemotePlayers.ts`, `src/network/MultiplayerClient.ts`, `shared/protocol.ts`, `server/src/index.ts`.

Leaderboard: `src/styles.css`, `src/ui/Scoreboard.ts`.

Props/layouts: `blender/scripts/lib/props.py`, `blender/scripts/lib/materials.py`, `blender/source/props.blend`, `public/assets/models/shared/props/well.glb`, `public/assets/models/shared/props/market_stall.glb`, `public/assets/materials.json`, `public/assets/asset-manifest.json`, `docs/ASSET_MANIFEST.md`, `src/maps/european-town/layout.json`, `src/maps/modern-city/layout.json`, `tools/layout_design.py`, `tools/layout_city.py`.

Tests/tools: `tests/movement.test.ts`, `tests/network.test.ts`, `tests/prespawn.test.ts`, `tests/guestProfile.test.ts` (protocol envelope only), new `tests/stageAProps.test.ts`, `server/tests/integration.mjs`, new `tools/stage-a-test.mjs`, new `tools/check-stage-a-props.py`, `tools/dev-zfight.mjs` (explicit practice/map URL for reproducible audits).

Docs: `README.md`, `server/README.md`, `docs/MULTIPLAYER_ARCHITECTURE.md`, `docs/TESTING.md`, `CLAUDE.md`, `PROGRESS.md`. Generated Python cache changes were discarded; unrelated asset/weapon models and placement data were preserved.

## Remaining limits / next stage

Rebuild frontend and Worker together for **protocol v4**; old v3 clients/backends are incompatible, and Town/City placement revisions changed. GitHub Pages/Vite/Cloudflare configuration is preserved. Multiplayer was verified locally with multiple real clients; public deployment/operation was not tested. Existing combat/Teams/results limitations remain unchanged.

**Stage A complete. STOP.** Stage B is Extreme Quality/advanced material/reflection/shadow effects and settings/FPS behavior; it requires explicit authorization and was not started. No commit, push or deployment was performed.

---

# Current task: cancellable match loading and spinner

Updated: 2026-10-26. Completed the requested loading-screen Back button and activity animation.

## Completed

- Added a top-left Back button to the existing gray loading screen and a small CSS wheel above LOADING. The wheel spins every 800 ms and stays static for reduced-motion preferences. Visually inspected the actual production layout.
- Back immediately returns home, aborts the active membership/load attempt, explicitly leaves/closes its transport, stops reconnect/heartbeat timers and invalidates pending round/map work. Late completions/errors cannot switch the screen back into a match or overwrite a newer attempt. Fresh Play can join again.
- Threaded optional AbortSignals through existing material/JSON, geometry, weapon/casing, preview, target and map loaders. GLB transfers use cancellable fetch plus the existing Babylon loader on the same bytes/root URL/name; the map/world/batching/render architecture and Pages asset paths remain intact.
- Cancelling releases partial models, pools, preview engines, map environment/lights and unused shared materials. Completed reusable game assets remain cached. Failed/cancelled preparation clears its promise, and preview updates replace existing images instead of duplicating them after retry. Promise finalizers only clear their own load.
- A repeat cancellation test caught Babylon HDR prefiltering accessing a texture after disposal. Fixed by detaching the retired environment immediately and releasing that native GPU resource once its non-interruptible prefilter settles. Other cancelled work stops; no retired join or UI continuation resumes. No library patches or graphics-quality changes were made.

## Validation

- Frontend TypeScript/production build and **144 unit tests in 14 files** pass. Three new cancellation tests cover immediate rejection, late-result disposal, consumed late errors and preservation of successful resources. Existing bundle-size warning remains.
- Final production cancellation test passes against an isolated real Worker/WebSocket runtime: Back during a delayed actual join, material definitions, weapon downloads, preview generation, map downloads and a real round transition. Verified real server presence returns to zero, no stale pre-spawn/error/map appears, retries work, previews do not duplicate, and joining/spawning remains server-approved. Spinner timing/position and reduced motion pass. No uncaught or unexpected browser errors; deliberately aborted browser requests are expected.
- Real two-client lifecycle regression passes pre-spawn/loadouts, authoritative icons/scores, spawn/respawn, SMG firing/reload/audio, all three map transitions, reconnect during loading and Leave Match. The independent two-browser movement test also passes position/orientation synchronization, authenticated reconnect without duplicate players and offline Retry/Back recovery.
- Final production practice gameplay regression passes map materials, movement/stairs/collision, firing/headshots, all original weapons, scopes/pump/bolt, finite magazines/infinite reserves, weapon-only reloads and held leaderboard, with no console errors. Stabilized its existing rifle headshot check with normal ADS (matching the map regression); randomized hip-fire could miss the small head at 6 m. Gameplay accuracy/stats were not changed.
- Evidence: ignored `test-results/loading-cancel/loading.png`, `test-results/loading-cancel-build.log`, `test-results/loading-cancel-browser.log`, `test-results/loading-cancel-multiplayer.log`, `test-results/loading-cancel-retry.log`, `test-results/loading-cancel-gameplay.log`. `git diff --check` passes.

## Files modified by this task

- `src/core/cancellation.ts` (new)
- `src/core/loadContainer.ts` (new)
- `src/core/assets.ts`
- `src/game/Game.ts`
- `src/game/Targets.ts`
- `src/maps/MapManager.ts`
- `src/rendering/Environment.ts`
- `src/rendering/MaterialLibrary.ts`
- `src/ui/UI.ts`
- `src/ui/WeaponPreviews.ts`
- `src/styles.css`
- `src/weapons/Effects.ts`
- `src/weapons/WeaponView.ts`
- `tests/cancellation.test.ts` (new)
- `tools/loading-cancel-test.mjs` (new)
- `tools/home-test.mjs`
- `tools/prespawn-test.mjs`
- `tools/browser-test.mjs`
- `README.md`
- `docs/TESTING.md`
- `CLAUDE.md`
- `PROGRESS.md`

Existing guest-profile work and other uncommitted changes were preserved. No backend, protocol, map geometry, weapon mechanics or deployment configuration was changed by this task. No commit, push or deployment was performed. **Loading cancellation feature complete; stop here.**

---

# Current task: simple guest profiles

Updated: 2026-10-26. Completed the requested guest-profile feature using the existing UI/settings and Cloudflare multiplayer architecture.

## Behavior

- First visit opens one small, keyboard-accessible username dialog over the existing home. Empty names are rejected; no account, password, login or profile panel is added to the regular home layout. Actual Play/autoplay waits for name setup.
- A separate `crossfire.guest.v1` localStorage record holds the normalized username and cryptographically random UUID guest ID. Future visits restore it. Clearing or corrupting data safely creates a fresh profile; unavailable/blocked/full storage retains a temporary in-memory guest without crashing.
- Settings > Gameplay > Username edits a draft. Apply saves it; Back/Escape/navigation discard it. Invalid names prevent partial application of graphics/gameplay/audio edits. Existing settings schema/storage, Defaults, graphics/sound controls and pause Settings remain intact. Defaults do not reset the guest name or ID.
- Names are used on the **next join/reconnect**, with a short note beside the Settings control. The reused networking client reads the applied name on each join. Joining without credentials gets a new authoritative session even when the local guest ID stays the same.
- No guest ID is sent to the Worker. Existing v3 join/resume messages and server UUID/resume-credential model are preserved. The Worker independently normalizes/trims/limits names (24 Unicode characters, controls/angle brackets removed), including valid resumed joins; renaming on resume preserves the existing authoritative session/state. Empty independently supplied server names still fall back to Player. No authentication/profile database, account endpoints or protocol-version change was added.

## Verification

- Frontend TypeScript/production build pass; **141 unit tests in 13 files** pass, including five profile tests covering persistence, unrelated settings, clearing/corruption, storage failures, Unicode/invalid names and rejection of guest IDs/client session IDs as join credentials.
- Backend TypeScript, Wrangler dry-run build and **19 real runtime checks** pass. Tests validate sanitized/fallback/long Unicode names, rejected local guest identifiers, distinct server IDs and renamed credential-authorized resumption, plus the existing movement/disconnection/reconnection/round cases.
- Dedicated production browser test passes with independent real clients against an isolated actual Worker/SQLite/WebSocket runtime: first-visit/blank-name setup, saved profile reload, Apply/Back and invalid-name atomicity with existing settings, visible authoritative names for two real players, local-ID/session-ID separation, renamed reconnect preserving identity, explicit Leave/rejoin producing a new server identity, actual temporary multiplayer with blocked localStorage, re-prompt on temporary reload, fresh IDs after clearing data and safe corrupted-data recovery. No fabricated roster, server snapshots, counts or connections; no browser console errors.
- Full existing Settings browser regression passes graphics, sound, gameplay, mouse/keyboard controls, draft/Apply/Back/Escape/Defaults, persisted/corrupt settings and pause entry. Responsive home checks pass at five viewport sizes with no console errors; the clean home, tab/hover behavior and lazy map loading are preserved.
- Visually inspected first-visit dialog, username Settings row and leaderboard displaying the two actual clients' names. Evidence/logs: ignored `test-results/guest/`, `test-results/guest-settings/`, `test-results/guest-*.log`. Existing large Babylon bundle warning remains. `git diff --check` passes.

## Files / limits

Core: `shared/username.ts`, `src/config/guestProfile.ts`, `src/ui/UI.ts`, `src/styles.css`, `src/game/Game.ts`, `src/network/MultiplayerClient.ts`, `server/src/index.ts`.

Tests: `tests/guestProfile.test.ts`, `server/tests/integration.mjs`, new `tools/guest-profile-test.mjs` and `tools/guest-profile-helper.mjs`. Existing browser/home/settings/prespawn/multiplayer/maps/performance/capture tools and nine `tools/dev-*.mjs` browser helpers now complete the real first-visit form, preserving their automation entry points. These helper-only edits do not change gameplay; the dedicated profile, Settings and home tools were run, not every historical developer tool.

Docs: `README.md`, `server/README.md`, `docs/TESTING.md`, `CLAUDE.md`, `PROGRESS.md`.

Display names are not unique accounts or identity proof. Profile persistence is limited to this browser/site storage; temporary profiles cannot survive reload when storage is blocked. Public deployment/operation was not tested; the updated Worker must be deployed later for renamed resumes. GitHub Pages/Vite/Worker configuration and unrelated game systems are unchanged. Existing combat/Teams/results limitations remain outside scope. No commit, push or deployment was performed. **Guest-profile feature complete; stop here.**

---

# Current task: larger main PLAY text

Updated: 2026-10-26. Increased only the main home PLAY button text from 23-30px to 34-42px responsively. Kept its desktop 88px button height, centered alignment and generous padding; the top Play navigation label is unchanged.

Files: `src/styles.css`, `PROGRESS.md`. Production build/TypeScript and existing focused browser checks passed at five viewport sizes (1920 through 320px), with no clipping or browser errors. Visually inspected the updated desktop screenshot. Logs: ignored `test-results/play-text-build.log`, `test-results/play-text-home.log`. No commit, push or deployment; stop here.

---

# Current task: faster tab switching and hover underline

Updated: 2026-10-26. Completed the requested navigation refinement.

- Selected-tab movement and underline/fade width animation now take 140 ms (previously 190 ms), retaining smooth easing and reduced-motion support.
- Added a faint white hover underline at the same height/thickness and word-width-plus-24px sizing as the corresponding selected underline. Hover previews do not change the selected page; the active solid white underline remains visible. Hover remains silent.
- Files: `src/ui/UI.ts`, `src/styles.css`, `tools/home-test.mjs`, `PROGRESS.md`.
- Validation: production build/TypeScript passed. Focused production browser checks passed at five viewport sizes, including faster timing, preview sizing/opacity, selected-page preservation, removal on pointer leave, retained click audio/no hover sounds, Back/draft behavior and no console errors. Visually inspected `test-results/home/tab-hover.png`. Logs: ignored `test-results/fast-tabs-build.log`, `test-results/fast-tabs-home.log`. Existing bundle warning remains; `git diff --check` passed.

No commit, push or deployment. Stop here.

---

# Current task: word-sized tab underline and silent hovering

Updated: 2026-10-26. Completed the requested focused follow-up.

- The floating selected-tab underline now follows the actual word width with 12 pixels of overhang on each side. Its matching upward white fade resizes with it. Retained smooth movement/width animation; ResizeObserver keeps the width correct across responsive text sizes without reacting to hover scaling.
- Removed the UI's delegated hover-sound listener for all buttons/settings tabs. Existing click sounds and game audio are preserved; no audio assets or weapon logic were changed.
- Files changed: `src/ui/UI.ts`, `src/styles.css`, `tools/home-test.mjs`, `PROGRESS.md`. Added `--appearance-only` to the existing home browser check for focused UI verification without joining/loading a map.
- Validation: production build with TypeScript passed; focused production browser checks passed at five viewport sizes, including word-sized Play/Settings underline, matching fade, no hover audio requests, retained click audio, navigation/Back behavior and no browser errors. Visually inspected the updated Settings screenshot. `git diff --check` passed. Logs: ignored `test-results/underline-hover-build.log` and `test-results/underline-hover-home.log`. Existing bundle-size warning remains.

No commit, push or deployment. Follow-up complete; stop here.

---

# Current task: blue controls and text-only home tabs

Updated: 2026-10-26. Completed the requested follow-up UI styling changes.

- Replaced the remaining orange UI accent/control colors with blue, including primary Apply/Spawn/Respawn buttons, selected settings categories, weapon cards, sliders, switches and associated focus/selection styling. Primary action text is white.
- Removed filled backgrounds and rounded button containers from the top Play/Settings navigation, including selected and hover states. Kept accessible buttons and keyboard focus behavior behind the text-only appearance.
- Added a full-width dark backdrop behind the home title and navigation that fades to transparent below the tabs.
- The floating white underline retains its shared 190 ms slide. Its white upward fade is strongest immediately above the line and becomes fully transparent upward.
- Changes are limited to `src/styles.css`, updated visual assertions in `tools/home-test.mjs`, and this progress record. Existing uncommitted project work was preserved.

Validation: production build (including TypeScript check) passed. Production browser checks passed at five viewport sizes (1920 through 320px), including transparent tabs, dark fading header, white animated underline/fade, blue Apply/category styling, draft cancellation/navigation, real local join/pre-spawn, presence failure/recovery and no unexpected browser errors. Visually inspected the new desktop home and full-screen Settings screenshots. `git diff --check` passed. Existing Babylon bundle-size warning remains. Logs: ignored `test-results/blue-tabs-build.log` and `test-results/blue-tabs-home.log`; screenshots: `test-results/home/`.

No commit, push or deployment. Follow-up complete; stop here.

---

# Current task: home, Settings, logo and leaderboard polish

Updated: 2026-10-26. Completed the latest attached **Home Screen, Settings, Animations, Logo, and Leaderboard Polish** UI-only request. Read the brief, CLAUDE.md, this record and affected code; baseline TypeScript and 136 unit tests passed. No AGENTS.md was found. The prior focused UI/map/SMG/network work was already uncommitted at the start and was preserved, including the user's existing Pages Origin edit in `server/wrangler.jsonc`.

## Completed

- Main Play is rich blue with white, padded text and a restrained hover color. Major menu buttons now enlarge around their original center with smooth easing instead of translating. Keyboard focus remains visible.
- Persistent top Play/Settings navigation keeps its position between pages. The short white underline and faint upward white fade share one indicator, which moves with 190 ms easing. Current tab shading and quick content fades are included.
- Home Settings fills the viewport with Gameplay, Sound and Graphics in a left sidebar, including on narrow screens. It reuses the existing controls, SettingsDraft and Apply/Back handlers. Pause/pre-spawn Settings keeps its compact layout. Navigation back to Play discards unapplied edits just like Back.
- Home has an original CROSS / crossed fictional rifles / FIRE wordmark in bold condensed italic type, with a matching SVG favicon. The entire accessible CROSSFIRE title fits at all tested widths. Artwork is lightweight original SVG, with no copied game assets or external font dependency.
- Replaced the overhead thumbnail with an optimized 1600x900 WebP screenshot of the **actual Town well plaza**, taken at eye level. Asset size is 204,098 bytes (about 199 KiB). `tools/capture-home-background.mjs` reproduces it from the existing map. Home still requests no playable map, weapon geometry, environment or material textures. Blur/dimming remain; a transform-only 3% zoom cycle takes 22 seconds and respects reduced-motion preferences. A clipped backdrop frame contains the transform without horizontal overflow.
- Missing/unavailable presence displays **0 Players Online**. Presence still sends null on failure, and the UI retains `data-available=false`; a confirmed zero uses `data-available=true`. Real valid counts still display normally. No connection-status panels or invented roster/count data were added.
- The held-Tab leaderboard has a background-only horizontal transparency gradient, keeping names/statistics opaque. Four original small SVG silhouettes use each row's existing server-reported `weapon` value; null/unknown data shows a neutral placeholder. Weapon changes are part of the row-update signature, so respawn refreshes icons. No protocol or backend changes were needed. Sorting, local highlighting, FFA/Teams presentation and actual timer/data remain intact.

## Verification

- Frontend TypeScript, all **136 unit tests**, and final production build pass. The pre-existing large Babylon bundle warning remains. `git diff --check` passes.
- Backend typecheck and Wrangler **dry-run** build pass, confirming compatibility; backend code/config/protocol were not changed by this task. No deployment was run.
- Production home browser test passes at 1920x1080, 1280x720, 1024x600, 390x844 and 320x568: full logo, blue padded Play, no clipping, lightweight-only requests, centered hover scaling, persistent navigation/moving white indicator/fade, full-screen Settings/left sidebar, Back/navigation draft cancellation, reduced-motion handling, real local Play/loading/pre-spawn, and unavailable/confirmed presence recovery. Normal browser checks reported no console errors; deliberate offline requests were separately checked for recovery and no uncaught JavaScript errors.
- Production Settings browser regression passes mouse/keyboard dropdowns, sliders/switches, category draft retention, Defaults as a draft, Apply/Back/Escape, local persistence, corrupted-value sanitization and live pause Settings. No console errors.
- Two independent production browser clients plus an HTTP-only observer were tested against the real local Worker/SQLite/WebSocket fixture. Verified actual counts, pre-spawn and placeholder icons, all four server-approved weapon icons (including remote selection and updated sniper after respawn), real fall death, spawn/loadout lock, SMG firing/reload/audio/no arms, held Tab/release/blur, background-only fading, reconnect, all three map transitions and Leave Match. No fabricated clients, scores or snapshots. No uncaught browser errors.
- Visually inspected the captured source plaza image, production home at desktop/320px, full-screen desktop/narrow Settings, and real two-player rifle/sniper and shotgun/sniper leaderboard screenshots. Evidence/logs are under ignored `test-results/home/`, `test-results/prespawn/`, `test-results/ui-polish-settings/` and `test-results/ui-polish-*.log`.

## Existing limits / next unfinished work

- Town currently has a **well**, not a fountain. Used its existing recognizable plaza rather than changing map geometry or inventing a fountain image.
- **Extreme Quality and Max FPS do not exist** in the current settings schema/renderer. Preserved every implemented control (including High quality, shadow quality, resolution scale and Show FPS); did not add cosmetic controls that do nothing. Their implementation remains separate rendering work.
- Actual Teams assignment/combat mode randomization, player-vs-player combat and match results remain unfinished, as documented previously. Existing Teams/FFA presentation is preserved and unit-tested; real Teams gameplay is not claimed. Public deployment/operation was not tested or changed.
- This focused UI update is complete. Stop here; remaining gameplay/rendering stages require a new request. No commit, push or deployment was performed.

## Files modified by this UI task

- `src/ui/UI.ts`
- `src/ui/Scoreboard.ts`
- `src/ui/WeaponIcons.ts` (new original SVG artwork)
- `src/styles.css`
- `public/favicon.svg`
- `public/assets/ui/town-plaza.webp` (new map screenshot)
- `tools/capture-home-background.mjs` (new reproducible capture tool)
- `tools/home-test.mjs`
- `tools/prespawn-test.mjs`
- `tools/settings-test.mjs`
- `tools/multiplayer-test.mjs` (updated home assertion)
- `README.md`
- `docs/TESTING.md`
- `CLAUDE.md`
- `PROGRESS.md`

The other uncommitted files listed by Git belong to earlier work and were not rewritten by this task. Historical task records follow.

---

# Current task: focused UI redesign and three-map integration

Updated: 2026-10-26. Completed the attached **focused UI redesign and map-integration fix**; this task supersedes the old stage order and disabled-SMG placeholder below. Only this focused scope was implemented. Read the attachment, CLAUDE.md, progress/architecture notes, current Git status and affected UI/loading/registry/network/weapon/Blender code first. No AGENTS.md was found. The existing uncommitted `server/wrangler.jsonc` change adding the Pages Origin was preserved without modification.

## Why only one map appeared

- The frontend registry already contained European Town, Industrial Complex and Modern City. Their generated models, collision, material/prop assets and 16 neutral spawn points per map existed and were loadable through practice. Missing assets, spawn configuration or frontend registry entries were not the cause.
- `server/src/world.ts` imported only European Town layout/collision. `PublicRoom` always created Town controllers, chose Town spawns and published `mapId: 'european-town'`. The shared snapshot type/parser also accepted only that map. There was **no actual server map rotation** to include Industrial or City. Those earlier files represented completed map assets, not multiplayer integration.
- Fixed the actual restriction: one server world catalog now includes the three existing map datasets, revisions and spawns; the protocol accepts all three IDs; the canonical room selects the current map; clients load and validate that map. No map layout/collision/texture or existing weapon asset was rebuilt.

## UI and loading changes

- Home now uses the existing 23 KB Town thumbnail as a blurred, dimmed static background. It has the full CROSSFIRE title near the top, Home/Settings navigation and a large bottom-centered Play button with hover/fade polish. Kept the real small online count. No character, map chooser, party/private/join UI or feature/status panels were added.
- Removed menu map preloading and deferred material, environment, weapon/casing model and preview loading until Play connects. Home never calls `MapManager.load` and skips scene rendering. The engine remains the existing Babylon engine; this is not a replacement app or renderer. Returning home shows the static backdrop and can reuse previously joined assets on a later Play.
- The opaque dark-gray loading screen contains only centered LOADING. It covers connection and real asset/map readiness, then opens pre-spawn. The existing MapManager shader-readiness/disposal path is reused; serial map requests coalesce to the newest server round. A reconnect during loading resumes that preparation instead of leaving the client stuck.
- Weapon selection is a full-screen dimmed/blurred overlay with four horizontal cards, in the requested order: SMG, Assault Rifle, Sniper Rifle, Shotgun. All are selectable and show renders of their actual game models. Hover, selected state, spacing/type and responsive horizontal scrolling are implemented. Selection immediately persists and returns to pre-spawn; approved life loadouts remain locked.
- The supplied attachment contained **only the text brief**; Image A and Image B were not attached. The design follows the written layout/style requirements. No exact visual comparison against those missing images is claimed, and no Deadshot assets/logo were copied.

## Four functional loadouts

- Added the minimum working SMG needed by the four-selectable-card requirement: an original compact Blender model, its separate editable `blender/source/smg.blend`, 37 KB GLB, runtime rig/anchors, configurable stats (960 RPM, 32 rounds, 11 damage, close-range falloff), original short synthesized audio and existing magazine/reload/HUD integration. Infinite reserve and the central 1.5x headshot multiplier are preserved.
- `blender/scripts/generate_smg.py` exports only this new asset and updates the manifest; it does not regenerate the other guns, hands or maps. The main pipeline can also regenerate SMG from the shared weapon source. Audio is reproducible with the existing procedural sound tool. No replacement arms/hands, sliding or changes to the existing rifle optic/models were made.

## Shared public rotation and connectivity

- `shared/maps.ts` defines the three map IDs and deterministic seeded shuffle. A persisted room epoch and server-generated seed define **600-second map rounds**, with all three maps included once per three-map bag. Shared state derives from elapsed time and survives restarts/hibernation, late joins and empty-room catch-up. Empty rooms do not run a simulation/clock loop. Connected-room deadlines use the existing alarm system.
- Protocol v3 adds round IDs to movement/spawn requests and snapshots. Map revisions and server collision/spawn data remain shared with the browser. Old-round requests are rejected without accepting stale input or dropping the connection. Transitions clear live bodies/queued movement, reset round stats and return real connected sessions to pre-spawn. There is no client-selected public map or duplicate room/transport system.
- Kept session credentials, heartbeat/removal, resume grace, replacement-generation protection, input validation/prediction, real player counts, interpolation and Leave Match. Both client and Worker must use v3 when eventually deployed. Vite config and Pages workflow are unchanged; no cloud resources, deployment, commit or push were performed.

## Validation

- Baseline frontend TypeScript and all 132 existing unit tests passed before changes. Current frontend TypeScript and production build pass; **136 unit tests in 12 files** pass. New tests cover complete random bags, exact deadline/restart/empty catch-up behavior, clear grounded spawns on every map, and SMG state behavior. The existing asset tests now validate SMG materials/anchors too.
- Backend runtime typecheck and dry-run bundle pass (about 287 KiB uncompressed / 36 KiB gzip). **18 real workerd/Miniflare checks pass**, including two real WebSocket clients on every rotated map, all four approved loadouts, movement, stale-round rejection, spawn validation, elimination/respawn, heartbeat/disconnect/resume/replacement, active-socket hibernation and full runtime recovery with the current map/deadline retained. Network test inputs normalize headings to the same canonical yaw range as the actual frontend, including 270-degree map spawns.
- Production `/crossfire/` home check passes at 1920, 1280, 1024, 390 and 320 pixels: full unclipped title, upper navigation, bottom-centered Play, real blurred image, no selector, and **zero map/weapon/environment/material-texture requests before Play**. Held actual asset requests to inspect the loading screen: only LOADING, with an opaque gray background; then the real connected pre-spawn screen appears.
- Production browser fixture passes four real model previews, requested card order, a horizontal desktop row and contained narrow scroller, saved selection, Settings/Back/Escape, actual SMG spawn, firing/audio/magazine/reload without arms, per-life lock, real fall death/respawn/score update, both browsers loading all three server maps, map-correct actual spawns, reconnect during map loading, removal/Leave Match and Offline presence recovery. It uses actual Worker sockets and authoritative snapshots; only the isolated test room's epoch/fall position is advanced through a test-only RPC. No fake connections, player roster, score awards or public deployment are used.
- Ordinary local Wrangler production integration also passes with two independent Chrome clients: authoritative movement/interpolation/orientation, authenticated reconnect without duplication, Leave Match, real Offline Retry/Back and recovery. Full production settings regression passes mouse/keyboard controls, draft/Apply/Back, persistence/corrupt storage, and pause entry with no browser errors.
- Production all-map practice regression passes material resolution, grounded neutral spawns, walking, held leaderboard and headshot damage on Town/Industrial/City, plus repeated-switch scene-object counts and retained settings with no browser errors.
- Final production gameplay regression passes original movement/stairs/collision, rifle/shotgun/sniper firing and 1.5x headshots, pump/bolt/scope, magazine limits/infinite reserves, weapon-only reload motion/audio, and held leaderboard behavior with no browser errors. SMG firing/reload/audio and locked loadouts were separately verified in the real-network browser fixture.
- Asset verification passes: 183 manifest entries, 213 existing materials and all three map asset sets. Screenshot outputs under ignored `test-results/home/` and `test-results/prespawn/` were visually inspected. Existing large Babylon bundle warning remains.

## Remaining limits

- Existing player-vs-player combat, team assignment/mode randomization and match results are still unfinished and outside this focused task. The public map clock is now real; mode remains explicitly unavailable instead of inventing FFA/Teams state. This rotation is the minimum 600-second map lifecycle, not the older plan's results/transition system.
- No cloud deployment/public endpoint test was performed here. The updated v3 frontend/Worker need matched deployment before public use; local multi-client evidence does not establish live public operation.
- Exact matching to Image A/B cannot be verified because the images were not included. No other requested focused feature remains intentionally disabled.

## Files changed by this task

- `CLAUDE.md`
- `PROGRESS.md`
- `README.md`
- `blender/scripts/generate_all.py`
- `blender/scripts/generate_smg.py`
- `blender/scripts/lib/weapon.py`
- `blender/source/smg.blend`
- `docs/ASSET_MANIFEST.md`
- `docs/MULTIPLAYER_ARCHITECTURE.md`
- `docs/TESTING.md`
- `public/assets/asset-manifest.json`
- `public/assets/audio/smg_shot.wav`
- `public/assets/models/shared/weapons/smg.glb`
- `server/README.md`
- `server/src/index.ts`
- `server/src/world.ts`
- `server/tests/integration.mjs`
- `server/tests/runtime-fixture.mjs`
- `shared/maps.ts`
- `shared/protocol.ts`
- `src/audio/AudioManager.ts`
- `src/game/Game.ts`
- `src/network/MultiplayerClient.ts`
- `src/styles.css`
- `src/ui/UI.ts`
- `src/ui/WeaponPreviews.ts`
- `src/weapons/Weapon.ts`
- `src/weapons/WeaponView.ts`
- `tests/assets.test.ts`
- `tests/network.test.ts`
- `tests/prespawn.test.ts`
- `tests/rotation.test.ts`
- `tests/weapon.test.ts`
- `tools/home-test.mjs`
- `tools/make_audio.py`
- `tools/multiplayer-test.mjs`
- `tools/prespawn-test.mjs`
- `tools/settings-test.mjs`

The pre-existing `server/wrangler.jsonc` Origin edit is not part of this task's modifications. Generated Python bytecode was restored/removed after asset generation. Full historical records follow. **Stop after this focused task; do not automatically start sliding, map expansion/target removal, Teams/combat or Extreme/FPS work.**

---

# Current task: Gameplay/UI update - Stage 1

Updated: 2026-10-25. The latest attached **Gameplay, UI, Weapons, and Extreme Graphics Update** defines a new four-stage sequence and authorizes **Stage 1 only**. This section supersedes the stage order and menu restrictions in the historical record below. Inspected the attachment, CLAUDE.md, this record, multiplayer architecture, existing networking/game/UI/weapon/asset code and Git status before editing. No AGENTS.md was found. The tracked working tree was clean at the start; the prior Cloudflare foundation was already present.

## Stage 1 implementation

- Home retains CROSSFIRE, Play, Settings and the existing 3D background. Adds only a small real player count beneath the buttons. `GET /presence` reads the same canonical `public-main` Durable Object and counts current, open, joined sessions within their heartbeat deadline, including pre-spawn clients. Pending handshakes, disconnected/grace records and replaced sockets do not add players. No identities/tokens or new player socket are exposed by this endpoint. Exact-origin CORS, no-store responses, five-second visible-home polling, request timeout, non-overlapping requests and Offline recovery are implemented.
- Normal Play now connects to the configured backend, loads its fixed European Town and stops at a centered pre-spawn menu. There is no map chooser or party panel. Connected menu sessions are authoritative `alive=false` entries with no weapon/avatar and cannot send movement. `?practice` preserves explicit local development and all three existing maps; no failed public connection falls back to practice.
- Switch Gun opens four selection areas. Rifle, shotgun and sniper use 960 x 460 previews rendered from the actual existing GLBs and shared PBR definitions. The temporary preview scene/engine is disposed afterward. Selection returns immediately, shows the preview/name under Switch Gun and persists the pending preference. **SMG is visibly disabled with Stage 2 indicated**; no fourth weapon/model or misleading borrowed preview was generated ahead of its stage.
- Protocol v2 adds spawn requests/approval, life state, approved weapon, kills/deaths and explicit nullable match metadata. Spawn validates the implemented weapon and map revision, chooses a collision-clear position separated from live players, increments the life, persists it and acknowledges the request. Repeated spawn requests cannot change a living player's weapon. The client waits for approval, equips only that weapon and uses the existing pointer-lock behavior. All Loadout switching paths (numbers, Q, wheel, direct select) are locked for the life; the public HUD lists only that weapon.
- Server-detected falls below the existing kill boundary mark the player eliminated, increment deaths once, clear queued motion and persist the result. The browser returns to pre-spawn with RESPAWN, releases the mouse, hides the gun/scope and allows a new pending loadout. Respawn obtains a new approved position/life without resetting deaths. No respawn cooldown existed, so none was invented. In-page reconnection preserves life/loadout and avoids resetting the current local magazine; pending input is discarded on death/life changes. Existing weapon capacity, reserve, reload motion/audio, headshot rule and practice behavior remain.
- Pause now says Leave Match. It invalidates the real session, removes remote bodies, clears local input/overlays/effects and returns home. Escape also permits leaving before spawning; Resume returns to pre-spawn without granting a life. Pre-spawn Settings/Back/Escape preserve preferences and draft/Apply semantics; heartbeat snapshots do not interrupt its pause menu.
- Tab now has one leaderboard binding. No TacticalMapView is instantiated in normal/practice gameplay; pure level-development derivation/export utilities remain. The board uses connected server names, kills/deaths, sorted kills descending/deaths ascending, local-session highlighting and automatic roster/score updates. Release/blur/hidden page/screen changes hide it; Tab prevents browser focus movement in play/pre-spawn. Teams grouping/team-score display is implemented for actual server metadata, with unit fixtures testing assignments/sorting. No synthetic runtime roster is used.
- Vite configuration, Pages workflow, generated maps/Blender assets, movement rules, weapon models and graphics settings are preserved. The existing Pages workflow already consumes the public endpoint variable. Local production-test origin 4176 was explicitly allowlisted alongside development ports 5173/5180. Client/server must both use protocol v2. Startup/configuration/testing instructions are updated in [server/README.md](server/README.md).

## Stage 1 remaining prerequisites and limits

- **The existing backend has no ten-minute rounds, randomized map schedule, FFA/Teams mode assignment or player-vs-player combat.** Those were planned later in the old architecture and are not implemented by this UI stage. Server mode/deadline/team totals remain explicitly null; the compact scoreboard shows `Mode unavailable` and `--:--`. Team grouping is presentation-tested with fixtures, not proven live Teams gameplay. No artificial countdown/mode/team score was added.
- Kills are server-owned and initialized to zero; without player combat there is no genuine kill-award source. Local target hits cannot change multiplayer scores. Real fall deaths do update and persist. No claim of combat elimination/kill scoring or cooldown rules is made.
- A functional SMG preview/selection requires the new brief's Stage 2 SMG implementation. Its disabled slot is the intentional dependency boundary.
- No public backend is configured or tested here; tests use local actual Worker runtimes. Public end-to-end checks still require a separately approved deployment, exact Pages Origin allowlisting and build-time `VITE_MULTIPLAYER_URL`. No cloud provisioning, commit, push or deployment was performed.

## Validation

- Before edits: frontend TypeScript, 126 tests in 10 files, and production build passed. Inspected actual implementation rather than inferring completeness from existing files.
- Current frontend TypeScript passed; **132 unit tests in 11 files** passed, including protocol injection/loadout validation, every switching path locked for a life, actual endpoint rules, FFA sorting and Teams grouping fixtures. Asset verification passed: 181 manifest entries, 213 materials and all three maps.
- Backend runtime typecheck and dry-run bundle passed (about 137 KiB, 21 KiB gzip). **17 real workerd/Miniflare checks passed**, including connected-menu presence/no extra session, spawn approval/loadout locking, invalid loadouts/map/score injection, movement/orientation, replay/flood checks, leave/timeout/resume/replacement, object hibernation, full runtime recovery and fall elimination/approved second-life loadout. A test-only subclass RPC seeds one real session below the world to exercise the boundary; production never bundles that entry. Hibernation checks run before its RPC to avoid test-owned runtime references preventing eviction.
- Two independent Chrome clients against ordinary local Wrangler/Vite passed real movement, interpolation, orientation, reconnect without duplicates, Leave Match, offline Retry/Back and recovery. The normal-flow browser test also passed actual HTTP count progression (0 -> 1 -> 2 -> 1 -> 0), pre-spawn/no avatar, real asset previews, saved selection, Settings/Back, approval, locked weapons, held leaderboard/local row, release/blur and clean leave.
- Production `/crossfire/` home passed five viewport sizes (1920, 1280, 1024, 390 and 320 pixels), full unclipped title, two buttons/no selector, Settings and normal public Play. No hands asset is requested. Production gameplay regression passed movement/stairs/collision, all three weapons, headshot damage, infinite reserves, reload lowering/return/audio, scope, and held leaderboard with zero invented practice players. No browser errors.
- All three production maps passed loading/materials/spawns/movement/headshots/leaderboard and repeated-switch object-count checks, with settings retained and no scene growth/errors. Corrected the map test to use ADS for its headshot assertion: random 1.4-degree hip spread at 5 m could miss independently of map/damage correctness; gameplay accuracy was not changed. The full production settings regression passed keyboard, draft/Apply/Back, persistence/corrupt storage and pause settings, with no browser errors.
- Final production Stage 1 lifecycle browser run passed against an isolated actual Worker: real fall elimination returned to RESPAWN, the board showed the authoritative death, a different second-life weapon was approved, its single-weapon HUD label updated, and remote bodies disappeared/reappeared correctly. Also passed Settings keyboard-focus return, pause remaining open across heartbeat snapshots, Escape/Resume without spawning, Offline presence/recovery and no uncaught browser errors. The home count observer never opened a player socket.
- Menu, weapon picker, leaderboard and RESPAWN screenshots were visually inspected under ignored `test-results/prespawn/`; production home captures are in `test-results/home/`. The existing large Babylon bundle warning remains.

**Stop after this Stage 1 work.** The UI/session features are implemented and locally tested; the unavailable SMG and full match/combat metadata above remain explicit dependencies. The next stage in the latest brief is **Stage 2: sliding, SMG and weapon models**, only when explicitly requested. Do not start map fixes/target removal or Extreme/FPS work.

---

# Historical multiplayer continuation record

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
