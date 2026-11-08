# Miniflare test RPC lifecycle and masked CI exceptions (2026-11-07)

Completed the test-transport fix and available verification. No production game,
combat/scoring, protocol, dependencies, timeout/concurrency, Cloudflare settings or
deployment workflow changes. No commit, push or deployment. See
`docs/TEST_RPC.md` for mechanism, commands, environment comparison and CI follow-up.

## Confirmed findings versus remaining uncertainty

- The pinned Miniflare Node proxy strips symbol properties. Both the namespace
  stub and a returned snapshot report `Symbol.dispose` as undefined in Node, so
  the old optional cleanup calls do nothing there. Native object RPC results do
  have disposers in workerd, verified by the new real-runtime regression.
- Miniflare's core proxy sets its `rpcAwaited` flag only after a successful await.
  A rejected RPC can therefore return without `MF-Op-Result-Type: Promise`; its
  Node parser masks the original error with the exact CI assertion. Reproduced
  before modifying the fixture: `placeForCombatTest` for a missing real session
  produced `AssertionError: (typeHeader === "Promise")` instead of the intended
  server-spawned-session error. Installed package files were not patched.
- `placeForCombatTest` awaits persistence and returns a normal authoritative
  snapshot, not a deliberately returned stub or unresolved nested promise. Tests
  use isolated persistence and sequential files/subtests; runtime restart code
  reacquires handles. No evidence justifies changing gameplay, sleeps or timeouts.
- The exact exception/cancellation behind the original Ubuntu RPC failure remains
  unknown because Miniflare masked it. A rejected fixture precondition or lifetime
  cancellation from undisposed RPC results is the strongest remaining hypothesis,
  not a confirmed Linux trace. Docker is absent and WSL is not installed. Public
  Actions logs could not be retrieved in this session; Ubuntu CI must verify.

## Fix

- Test controls use an isolated JSON fetch bridge in the test-only Worker fixture.
  The bridge invokes **real Durable Object RPC inside workerd**, awaits the result,
  serializes it, then calls its native disposer in `finally`. Errors cross as
  explicit failures with room/method context and their original name/message.
  No Miniflare native proxies or RPC result capabilities escape into Node.
- Node test handles have a real local disposer that invalidates them. Restarting
  tests recreate handles for the replacement runtime. The old Node-side no-op
  proxy symbol lookups are eliminated; native result disposal happens per call.
- All existing direct fixture-RPC callers use this shared transport, including
  public/private room, assist, grenade and persistence suites. Normal WebSocket
  clients and production HTTP routes are unchanged. The control handler accepts
  only test methods plus the existing read-only `roomStatus` and is not part of
  Wrangler's production entry/bundle.
- Added a warnings-enabled real-runtime lifecycle regression: native disposer
  presence, 100 actual snapshot RPCs, original placement rejection, restricted
  methods, invalidated handles, and persisted round state across restart. RPC
  disposal warnings fail this test; logging was not disabled to hide them.
- Combat map setup now sits inside its existing cleanup `try/finally`. The combo
  test also asserts an actual lethal headshot before waiting for elimination, so
  a failed hit reports the full confirmed shot rather than an opaque timeout.

## Files created or modified

- Created `server/tests/test-rpc.mjs`, `server/tests/rpc-lifecycle.mjs`,
  `docs/TEST_RPC.md`.
- Modified `server/tests/runtime-fixture.mjs`, `server/tests/room-harness.mjs`,
  `server/tests/combat.mjs`, `server/tests/assists.mjs`,
  `server/tests/challenges.mjs`, `server/tests/environment.mjs`,
  `server/tests/grenades.mjs`, `server/tests/integration.mjs`,
  `server/tests/statistics.mjs`, `server/tests/traversal.mjs`,
  `server/package.json` (includes the regression in existing CI), `PROGRESS.md`.

## Actual verification

- Baseline unmodified combat suite: **30/30 passed** on Windows. Diagnostic native
  rejection reproduced the exact CI parser assertion deterministically.
- New lifecycle regression: **1/1 passed**, warnings enabled, with zero RPC
  disposal warnings. It also passed again within the full backend run.
- Final `npm.cmd test --prefix server`: **86/86 passed** (85 existing + new
  lifecycle regression), including all 30 combat tests; Worker dry-run build
  passed. Full run took approximately 373 seconds.
- Affected FFA headshot/combo test: passed alone and **three additional consecutive
  isolated runs** after the full suite. All original score, combo, grenade reward,
  duplicate, resume and frozen-result assertions remain.
- One intermediate combat run timed out waiting for an elimination (distinct
  from the RPC parser failure). Subsequent isolated and final complete runs passed;
  the stronger shot assertion now provides evidence if that separate flake recurs.
- `npm.cmd test -- --maxWorkers=2`: **822 passed, 1 existing opt-in skip**.
- `npm.cmd run test:protocol`: **1/1 passed**, using the real frontend transport and
  production Worker messages; backend dry-run build passed again.
- Frontend/backend typechecks, JavaScript syntax checks and `git diff --check`:
  passed. The first backend build reported a nonfatal sandbox log-file permission
  warning; later Wrangler checks used a workspace-local WRANGLER_LOG_PATH.
- Local Node 24.20.0 / npm 11.19.0; CI Node 24 on Ubuntu. Installed Miniflare
  5.20261019.2-beta, workerd 1.20261019.1 and Wrangler 4.152.0 match the committed
  locks. CI's precise Node patch was not available; no dependency/workflow changes.

No production redeployment is required for this test-only change. The existing
GitHub Actions run still needs confirmation on Ubuntu after an authorized push.
If it fails, investigate the original error now reported by the bridge rather
than weakening assertions or adding arbitrary timeouts.

# Farmstead: a new outdoor map with a storm shelter (2026-11-07)

New playable map `farmstead` built from `references_images/Newoutdoormap.png`; see docs/FARMSTEAD.md.
Gameplay, scoring, networking (WebSocket v21, HTTP schemas), cosmetics and Cloudflare configuration are
unchanged. Layout, collision and map revision are new (`MAP_IDS` has a fourth map and the schedule reshuffles once
per full pass; with three maps that was identical), so the frontend assets and the Worker need a matching release when
authorized. No commit, push or deployment.

## Added
- **Surface** (74 x 92 m play area, 66 x 83.5 m fence line): farmhouse (26 x 16.5 m: living room, hall, kitchen,
  dining room, pantry, stairs, three bedrooms upstairs, a balcony over the dining porch with a drop-down gap), barn
  (double-height bay, two stalls, hayloft and stair, forebay deck), two-floor log cabin with a balcony on the west, south
  and east and a gap in the south railing, garage with a wide bay and a workshop, four shacks open on all four sides,
  post-and-rail fence with open gaps on every side, dirt paths from the south gate to the house, garage, barn and
  cabin, 39 trees, 45 crates (extra ones under the three balconies), 20 hedgerows, 9 exterior posters. No doors: every
  gap of the plan is an open entry; windows are real openings.
- **Storm shelter**: 922 m2 of rooms and tunnels at -3.5 m (3.2 m clear), eight rooms joined by ten offset tunnels in a
  loop, five entrances (house hall and barn stall stairs, three fieldstone portals), 16 piers, 59 props, concrete and
  timber styling (`underground.py` style `farm`).
- **Pipeline**: `tools/farm_structures.py` (buildings as elements) -> `blender/scripts/lib/farmstead.py` (mesh and
  collision from the same elements, roofs visual only with a solid ceiling slab under each), `tools/layout_farm.py`
  (layout, prop validation), `terrain_farm.py` (meadow, ragged dirt paths, exact interior floors), `props_farm.py` (20 new
  props), new materials and Poly Haven textures (grass, dirt, siding, logs, bark) plus procedural leaves and hay,
  `tools/farm-shots.mjs`, `farm-thumb.mjs/.py`, `farm-menu-shot.mjs`, `tests/farmstead.test.ts`.
- **Shared fixes**: `collision_gen` reads the play area per axis (non-square maps), the map schedule shuffle uses the
  map count, the tactical map draws `farm.solids`/`farm.fences`, the map-menu grid auto-fits four cards, `map.test.ts`
  probes each zone's own surface (a 1.2 m fence is not ground), `collisionSafety` probes with 1 mm, street-only suites
  (`compactMaps`, `mapRealism`, `phase2Maps`, `stairSliding`) skip the farmstead, `mapOverhaul` allows 76.5 m lanes
  on the open map, the geometry z-fight suite covers it.

## Verified
- 823 frontend tests (1 existing skip): 820 passed in the full run and the 2 `characterWeapon` timeouts that load caused
  passed alone; the Worker suite passes (integration 22/22, including both real clients rotating through all four maps
  with a farmstead spawn); typecheck, production build and `assets:verify` pass. `tests/farmstead.test.ts` walks every opening both ways with no gun, a rifle
  and a sniper rifle, every stair, the cabin balcony (railing blocks, the gap drops), the fence gaps, the shacks, all five
  shelter entrances, and Practice navigation from every spawn to every room; the shared `MAP_IDS` suites (integrity audit,
  collision safety, tactical, practice bots, overhaul walks, posters, geometry/z-fight, assets) pass for it.
- Practice bots over six seeds: no stuck bot, they climb to the 3.4 m and 3.0 m floors and descend to the shelter.
- Real Chrome screenshots (`node tools/farm-shots.mjs`, git-ignored `test-results/farm/`): six aerials, the yard and
  paths, the fence gaps, every building from outside, house/barn/cabin/garage inside (ground and upper floors, loft,
  forebay, balconies), all four shacks, all eight shelter rooms and five entrances (about 80 viewpoints). Fixes found
  that way: a green strip down the middle of wide paths, orange dirt, a brown skirt past the meadow, grey and dark
  interiors, rusty-looking posts, a window shutter against a door frame, benches and sofas in doorways, stairs that
  met a window or a door, a stair void that caught a gun barrel, and a bot pocket between a bush, a hay bale and a hedge.

## Remaining limits
- Interiors stay dim (two point lights on every map); the shelter is deliberately darker than the yard.
- The thumbnail is a game screenshot; there is no Blender preview render for this map.
- The aerial shots are hazy at 40+ m (the map's distance fog).
- Public Cloudflare behaviour was not validated; old browser tabs need a refresh after the matching releases.

# Melee polish, blade trails, bigger underground spaces and posters (2026-11-07)

Presentation, map-art and navigation pass; see docs/UNDERGROUND_POSTERS.md and the new "Expressive
arcs, blade trails and a heavier finisher" section of docs/DUAL_DAGGERS.md. `shared/melee.ts`
(damage, range, arc, contact windows, chain gates), scoring, networking (WebSocket v21, HTTP
schemas), cosmetics and Cloudflare configuration are unchanged. Layouts, collision and map
revisions of Town and City changed (Industrial's layout is byte-identical, its buildings gained
posters), so the frontend assets and the Worker need a matching release when authorized. No
commit, push or deployment.

## Changed
- **Melee arcs** (`blender/melee/dagger_design.py`, regenerated `dagger_clips.glb`/`daggers.json`):
  attack 1 now sweeps the first-person view from upper right to lower left, tip NDC x
  0.77 -> -0.76 (it was 0.68 -> -0.19), attack 2 mirrors it; the torso turns into the cut and
  the support hand ducks clear. Timing is still 250/250/400 ms with the same contact windows.
- **Finisher**: slow 95 ms wind-up pulling both hands to the chest (right above left, elbows
  folded), 110 ms hold with 1-2 cm secondary drift and a moving torso, then a 40 ms release to
  +/-0.31 m (grips at +/-0.94 NDC) and a recovery to the guard by 400 ms. Contact 215-305 ms and
  chain 310 ms unchanged.
- **Blade trails** (`src/game/melee/MeleeTrail.ts`, `MeleeView.run/sampleTrail/finishTrail`,
  `RemotePlayers.trail`): camera-facing strip along the dagger tip's animated path, Catmull-Rom
  smoothed, additive with vertex-alpha fade; slash = cool thin core + halo (150/220 ms),
  finisher = both hands, warmer, wider, 200/320 ms layers. First person samples 4 ms slices of
  an attacking frame and corrects the newest sample onto the real blade after the arm IK;
  third person is a simplified per-frame world-space strip (<= 45 m, visible players only);
  Chromebook mode: one layer, 8 ms slices. Cosmetic only.
- **Civic Central metro** (`underground.py`, `tools/underground_layouts.py`): floor -3.8 m, 3.5 m
  clear (was -2.6 / 2.3), 62 -> 375 m2: 34 x 8 m hall, two stair lobbies, gate line with four
  gate blocks, ticket machine bank, 14 piers (0.8 m; the original two kept at (2.2, 0) and
  (6.4, 0)), two pillar-row platform zones, four rooms behind door tunnels; 29 floor props
  (9 benches, 7 vending machines, 7 bins, wet-floor signs, planter, cabinets, bags), 66 wall
  items (banners, platform/exit/ticket/restroom/staff signs, two route maps, 38 posters,
  3 utility doors), ceiling LED grid and beams.
- **Cistern and wine cellar**: floor -3.5 m, 3.2 m clear, 62 -> 181 m2: cistern hall with six
  piers around a raised stone tank, wine vault (4 racks, 2 casks, barrels), two stores, brick
  and flagstone, enamel signs, 11 vintage posters; it shares nothing with the metro's look.
- **Posters** (all maps): 12 invented designs in `urban/posters_fun.jpg` (one atlas material).
  Facade pass `BuildingGenerator.poster_pass` + `interior_posters`: Town 13 (2 inside), Industrial
  17 (6 inside, framed boards), City 6 on facades plus the 38 in the metro; placement registry in
  `docs/map-posters/<map>.json`.
- **Generator**: per-style `floor_y`/`risers`/`run`, `prepare()`, piers with size, `blocks`,
  `decor` validated against real walls, `walks`; new props `vending_machine(_blue)`,
  `wet_floor_sign`, `wine_rack`, `cask`; materials `posters_fun`, `underground_signs`.
- **Tests/tools**: `tests/meleeTrail.test.ts`, `tests/posters.test.ts`, new cases in
  `tests/meleeAnimation.test.ts` and `tests/mapOverhaul.test.ts` (aisle/room walks with rifle and
  sniper both ways, pillar spans, area/height, Practice navigation); `tools/check_underground.py`,
  `tools/melee-trail-test.mjs`, `tools/underground-shots.mjs`, `tools/poster-shots.mjs`,
  `tools/make_underground_art.py`. Small fixes: `tactical.ts` ignores underground props; the
  street-bench and stair-flight tests skip underground props; `collisionSafety` tolerates float
  depth (-3.8000000000000003).

## Verified
- 762 frontend tests pass (1 existing skip); server 85/85 (rebuilt Worker bundle); typecheck,
  production build, `assets:verify` (216 materials, 3 maps), `python -B -I tools/check_underground.py`.
- Real Chrome: `node tools/melee-trail-test.mjs` 16 checks (trail at 120 and 30 FPS steps,
  sample within 2 cm of the blade, fade-out, Chromebook one layer, bot trail),
  `node tools/melee-anim-test.mjs` and `node tools/melee-browser-test.mjs` (wrists <= 23.5 deg).
- Visual inspection done by looking at the screenshots (git-ignored `test-results/`): three
  attacks' key frames and the stepped trail sheets, finisher crossed hold and release (first and
  third person), the bot's trail close-up, metro (hall both ways, ticket hall, gate line, east and
  west zones, pillars, vending/bench/bins, route map, poster wall, ceiling lights, the four rooms,
  both stairs from below and from the street), cellar (stair bottoms, hall, tank, vault, stores,
  stairs, portals) and 9-10 posters per map including interiors. Corrections found that way:
  jagged trail (sampling offset), too-wide trails, metro too dark, plain ticket machines,
  posters crossing a material seam or trim band, a lamp in front of a sign, over-bright
  bottle ends, posters hiding behind a header course.
- Map review draw calls (median / max): Town 128 / 192, City 117 / 177, Industrial 113 / 153
  (the project's earlier figure was about 130 median).

## Remaining limits
- The metro's clear height is 3.5 m, not more: the civic stair cannot start north of z = -12.2
  (a long gun needs 1.6 m before the plaza's building edge), which caps the stair length and so
  the depth. The cellar portals keep their old 5.4 m length for the same reason (a longer
  portal made a server test's sightline collinear).
- Practice City lost one target and the Town and City spawns were recomputed (16 each) by the
  larger stair footprints.
- Modern facades have little blank wall: City has only 6 facade posters (framed boards use a
  band under the first floor when trims allow); Industrial interior posters can sit behind
  racks. No poster is collidable by design.
- Third-person trails are one strip per frame (smoothed), so a very distant or very fast swing
  looks simpler; first person is the detailed version. Tested on one machine (headless Chrome,
  Intel iGPU); no multiplayer session with real peers, low-end device or Chromebook hardware was
  tested.
- Wall art, ceiling beams and machine screens are visual only above/against walls (no collision
  by design); the cistern tank's water is a flat surface.
- Public Cloudflare behaviour was not validated; old browser tabs need a refresh after the
  matching releases.

# Player proportions, independent weapon FOV and nametag bars (2026-11-07)

Completed the three presentation refinements. No gameplay, shared protocol,
Worker, hitbox, movement collision, hosting configuration or original GLB asset
changes. No commit, push or deployment performed.

- Nametag bars are now 4.5 px tall (50% above the previous 3 px), rounded with
  the existing translucent backing, and inherit the label color: teammate blue,
  opponent red, including FFA. Existing health/max-health interpolation remains
  frame-rate independent. Existing friendly-through-geometry / opponent LOS and
  smoke visibility rules are preserved; no raycasts were added.
- The existing depth-isolated first-person rendering group now has its own fixed
  90-degree horizontal projection and 0.012 m near plane. It shares the world
  camera's eye/view transform and restores the world projection after rendering.
  World FOV, ADS magnification and authoritative aim are unchanged. Guns,
  daggers, muzzle flashes and camera-space effects use the same projection;
  weapon offsets, reloads, recoil and animation transforms were not retuned.
- CharacterProportions broadens the shared bind mesh once at asset load: torso
  and shoulder shell approximately 12%, upper-arm thickness 16%, and legs 14%
  around their original bone centre lines, blended with the exported weights.
  It also adjusts the matching first-person dagger arm mesh. Height, head/hand
  positions, bones, grip targets, animation tracks and texture UVs are preserved.
  Geometry remains shared across the home preview, remote players and Practice
  bots; there is no added per-frame mesh deformation or simulation work.

## Files

- `src/styles.css`: bar height and inherited relationship color.
- `src/weapons/WeaponView.ts`: independent viewmodel projection in existing group.
- `src/game/CharacterProportions.ts`: shared cosmetic bind-mesh adjustment.
- `src/game/CharacterAsset.ts`, `src/game/melee/MeleeAssets.ts`: apply once on load.
- `tests/weaponProjection.test.ts`: all four real weapons at minimum/default/
  maximum and scope FOV; fixed projection, unchanged transform, world restoration.
- `tests/characterProportions.test.ts`: real GLB body/limb broadening, unchanged
  height/head/hands/bind matrices/clips/UVs/indices, idempotence and shared geometry.
- `tools/player-presentation-browser-test.mjs`: repeatable production-browser QA.

## Verification and limits

- `npm.cmd run typecheck`: passed.
- `npm.cmd test -- --maxWorkers=2`: **736 passed, 1 intentionally skipped**
  (the pre-existing opt-in character performance benchmark). Existing real-rig
  weapon grip, melee, limp-body, lean, movement and protocol tests passed.
- `npm.cmd run build`: passed; existing large-bundle warning remains.
- `node tools/player-presentation-browser-test.mjs`: **17 checks passed** against
  the production build served under `/crossfire/`, using real local Practice.
  Real teammate/opponent DOM bars match label colors and measured 4.5 px height.
  All four guns at 70/90/110 FOV, ADS, reload/muzzle-flash poses, a real sniper
  scope and dagger FOV/grip checks completed without browser errors/missing assets.
- Visually inspected `test-results/player-presentation/contact-sheet.png` and
  individual rifle/ADS renders: broader armed/three melee poses, consistent weapon
  size, centered sights, working scope, intact dagger hands. Report and PNGs are
  ignored QA outputs. Initial browser-harness assumptions about locked weapon
  switching and the scope's settling transition were corrected to use real spawn
  selection and condition-based zoom readiness; no gameplay changes were needed.
- No new public Cloudflare or live multiplayer validation was performed. Visibility
  logic was reviewed and left unchanged; the browser checks used actual Practice
  team identities. These changes require only a frontend release when authorized;
  no Worker/protocol migration is required. Exhaustive pose/device/GPU coverage
  and a new performance benchmark were not performed.

# Weapon balancing, sniper zoom and shotgun improvements (2026-11-07)

Completed on the existing shared Weapon state machine and hitscan pipeline.
Models, cosmetics, difficulty progression, melee gameplay and hosting settings
are preserved, including prior uncommitted work. No commit, push or deployment.
See `docs/WEAPON_BALANCE.md` for implementation details, commands and release notes.

## Exact final configuration

| Weapon | Magazine | RPM / trigger interval | Close body damage | Additional changes |
|---|---:|---:|---|---|
| AR | 30 | 630 / 95.238 ms | Server/local-authority integer roll 20, 21 or 22 per hit | Exactly 10% lower RPM; original recoil/range/falloff retained |
| SMG | 64 | 1122.7 / 53.443 ms | 11 | Exactly 9% higher RPM; original range, recoil and reload timing |
| Sniper | 4 | 50 / 1200 ms | 75 | 5.2 degree camera kick tuning input, view kick 26; 224 ms ADS; no permanent aim contribution |
| Shotgun | 2 | 240 / 250 ms | 14 per pellet, 14 pellets | 220 ms between-shot pump; 7 degree hip / 3.85 degree ADS pellet cone; 12-44 m falloff to 18%; 80 m maximum range |

- Existing 1.5x headshot multiplier and damage falloff apply after the AR's base
  roll. The Worker controls randomness; Practice uses its seeded RNG. The roll
  feeds confirmed damage, health, death and scoring together. SMG explicitly
  clears the new inherited AR roll option. AR's displayed base is the average 21.
- Fractional fixed-tick cooldown carry avoids rounding the new RPMs downward.
  Snapshot cooldown remains nonnegative/replayable; no catch-up burst is added.
- Shotgun aimed cone is 55% of hip (about 57% combined with its center aim cone).
  Only actual simulated gun ADS controls this cone in Worker and Practice. No
  client-supplied ADS state, damage, spread or hit claim is accepted. Hip cone and
  pellet damage remain unchanged; doubled falloff plus ADS makes medium range
  more useful without making long range reliable.
- Shotgun ADS FOV scale is 0.82 (previously 0.88), and its existing sight anchor
  moves 4 cm closer. Pump cue fractions follow the faster cycle. Shell reload
  450/500/400 ms start/per-shell/end and the 600 ms empty-reload chamber stroke
  remain unchanged through a separate shared emptyReloadCycleTime setting.
- Sniper ADS duration is 20% shorter than 280 ms. Default FOV scale is .22/.82,
  yielding about 3.73x FOV-ratio magnification (18% below the old default).
  SNIPER_ZOOM configures a smooth approximately 2.95-4.55x range, 0.25x wheel
  steps and interpolation. A small scope HUD indicator shows current zoom.
- Scoped wheel input is consumed before weapon cycling; other bindings and menu
  scrolling remain intact. Zoom changes neither aim angles nor damage/accuracy.
  Stronger camera recoil uses existing recovering springs without permanent yaw
  or pitch changes; the real sniper model also receives a stronger impulse.
- HUD, ammo/reloads and all four bot tiers reuse the shared configurations.
  Practice still has no persistent statistics/reward adapter.

## Protocol and release

Protocol is now **v21**: v20's decoder hardcoded a 32-round maximum and would
reject valid 64-round SMG snapshots. Validation now derives its upper bound from
shared weapon configuration. No new wire fields or client combat claims were
added. Actual frontend/Worker integration covers the 64-round SMG. The existing
backend-first release workflow/health gate remains unchanged.

Both frontend/assets and Worker require an authorized matching release. No
Durable Object migration, URL, env file, credentials or Pages base-path changes.
No public Cloudflare deployment or public-server validation was performed.

## Verification

- Final full frontend run (`npm test -- --maxWorkers=2`): **735 passed, 1 existing
  skip**, 75 passing files. Worker count was bounded after concurrent runs caused
  timing-only timeouts in unchanged rig/collision tests; no assertions/timeouts
  were disabled or increased.
- Focused weapon/balance/damage/replay/camera suite: **49/49 passed**. Includes
  exact RPM ratios and long-run cadence, 64/4-round capacities and reloads, two
  rapid shotgun shots, all AR rolls and head/falloff multipliers, seeded medium-
  range shotgun comparisons, smooth bounded zoom, wheel routing and no aim drift.
- Final real workerd/WebSocket run: **44/44 passed**, covering weapon-balance,
  combat, assists, melee, actual frontend protocol and match-reward integration.
  Includes FFA/Teams, server ADS cones, cooldown denial, new capacities/reloads,
  all four guns, authoritative health/score, forged ADS/spread rejection, headshots,
  leaning/walls, regeneration, session resume, assists and durable gem grants.
- Test expectations now use legal confirmed AR rolls and corresponding health.
  Assist fixtures use two actual AR bullets when the old 25+75 body-hit setup no
  longer eliminates. The second waits for acknowledged cooldown state. The melee
  resume assertion accepts legal continuation or expiry across the existing
  350 ms gate rather than predicting it from a stale snapshot. Gameplay timing
  and combo rules were not changed.
- Final production `/crossfire/` Chrome Practice suite: **15/15 passed**, zero
  browser exceptions/missing assets. Real wheel zoom, defaults/limits/HUD, no
  weapon-switch conflict, visible sniper recoil with no aim drift, smooth exit,
  shotgun follow-up shots, SMG HUD/reload to 64 and local non-persistent policy.
  Inspected sniper maximum-zoom and shotgun ADS screenshots.
- Deployment release tests: **7/7 passed**. Frontend/backend typechecks,
  production frontend build, Worker dry build and git diff --check pass.
  The existing large-bundle build warning remains.
- Reports/logs/screenshots: ignored `test-results/balance-*` and
  `test-results/weapon-balance-browser`.

## Limits

Browser checks used local Windows Chrome, not public multiplayer, physical
Chromebooks or other browsers. Medium-range balance has seeded collision/hitscan
coverage but still benefits from human playtesting. Adjustable zoom is cosmetic
and not sent to spectators; their view uses the weapon's new default zoom.
Nothing was committed, pushed or deployed.

# Confirmed melee impact, audio and knockback (2026-11-07)

Completed the focused feedback update on Claude's current fast dagger clips and
LimpBody baseline. Preserved the existing dirty animation/model work. Damage 35,
combo/scoring rules, hit validation, authored contact/chain timing, equipment and
wire protocol v20 are unchanged. No commit, push or deployment.
See `docs/MELEE_IMPACT.md` for files, tuning, commands and release details.

## Completed

- Added shared authoritative meleeKnockback after positive confirmed damage in
  both Worker and local Practice. Stages 1/2 add matching 1.4 m/s horizontal
  impulses; stage 3 adds 3.1 m/s. Direction is normalized from the server trace,
  total speed is bounded, and a small grounded lift preserves the brief reaction.
  Sliding uses its existing cancellation/cooldown. Existing controller substeps,
  wall/floor collision, snapshots and reconciliation handle actual displacement.
  No client-provided impulse or teleport path exists.
- Added configurable finite optical camera roll: left/right 100 ms responses and
  a stronger two-direction 180 ms third response. Smooth recovery reaches exactly
  zero; new hits replace rather than stack. Mouse look, player yaw/pitch, intended
  aim and shot direction are untouched. Reduced motion suppresses it; resets clear it.
- Generated original paired fast swooshes, a deeper layered finisher swoosh and
  a separate crisp non-graphic impact WAV. Existing master/SFX settings, limiter,
  spatial distance attenuation and voice budgets remain active. Local swings use
  current metadata timing and stop at clip end; remote contacts use spatial audio.
- Added bounded per-session confirmation deduplication and timing/round/readiness
  guards. Only positive confirmed contacts produce impact sound, hit marker and
  attacker camera reaction. A miss produces no false impact. Old contacts cannot
  play after the remaining clip window. Flourishes keep their separate twirl cue
  and never enter attack/damage feedback.
- Stage-3 lethal confirmations correlate with victim/life in either elimination
  event order, without adding protocol fields. DeathMotion gets one early bounded
  backward boost, then retains its swept three-sphere collision and Claude's
  captureDeath/poseDeath/LimpBody loose-joint relaxation. Duplicate or late events
  cannot repeatedly kick a corpse. Practice uses the same presentation.

## Verified

- Full frontend suite: **727 passed, 1 existing skip** (74 passing test files).
- Focused melee/camera/death/limp-body suite: **33/33 passed**, including unchanged
  authored timing, real Practice human/bot combat, impulse direction/strength/cap,
  wall/floor safety, death emphasis, finite camera response at 30/60/144 FPS,
  live mouse look/no aim drift, reduced motion, duplicate/stale events and WAVs.
- Final real workerd regression run: **38/38 passed**, across backend melee,
  combat, grenades and frontend/Worker protocol integration. Confirms FFA/Teams,
  actual knockback movement, combo kills/points, session resume, team immunity,
  assists/statistics, all four guns, ammo/reload/fire-rate validation, wall/lean
  collision, regeneration, grenade/crouch behavior and wire compatibility.
- Backend melee focused run also passed **5/5**. Its movement regression requests
  explicit free space behind the actual-map victim: an earlier valid melee fixture
  had a wall directly behind the victim that correctly prevented displacement.
  The resume test now acknowledges a neutral input before the next press, avoiding
  dependence on the old socket's release state. No arbitrary wait or timing change.
- Production `/crossfire/` Chrome + real local Worker/second WebSocket client:
  **20/20 browser checks passed**, zero browser errors/missing assets. Verified
  physical V equip, remote animation/damage, stages 1/2/3, exactly three dedicated
  impact cues for three hits, actual spatial playback with inverse attenuation,
  a confirmed miss with no impact cue, unchanged firearm ammunition, weapon return
  and killer spectating. Inspected the elimination screenshot. Existing Locker,
  crate ownership and retry-safe purchases still pass in that same scenario.
- Frontend and backend typechecks pass; frontend production build and Worker dry
  build pass. Existing frontend large-bundle warning remains. git diff --check passes.
  Reports/logs/screenshots are under ignored `test-results/melee-impact-*` and
  `test-results/melee-gameplay-browser`.

## Remaining limitations and release

- Public Cloudflare/Internet latency, physical devices and subjective speaker
  quality were not validated. These are actual local workerd/Chrome results.
- Existing limp limbs still lack individual floor colliders; collision-safe root
  approximation is preserved. A reconnecting spectator cannot infer a historical
  third-stage kill from an old elimination without its melee confirmation.
- Expired confirmations intentionally do not produce delayed cosmetic feedback.
- Both frontend/assets and Worker require an authorized release for the complete
  feature. Protocol remains v20; no Durable Object migration, URL, credentials or
  deployment workflow changes. Nothing was committed, pushed or deployed.

# Fast dagger attacks, idle flourish and limp death (2026-11-07)

Animation-only pass on the existing melee system and death presentation; see
`docs/DUAL_DAGGERS.md` (section "Fast attacks, flourish and limp death"). The rig,
dagger models, CharacterWeapon pose system, damage, range, arc, scoring, cosmetics and
protocol (v20) are unchanged. No commit, push or deployment.

## Changed
- **Attacks** (`blender/melee/dagger_design.py`, regenerated clips + `daggers.json`):
  stage 1 `attack_cross` is the right-hand diagonal (upper right to lower left, 250 ms),
  stage 2 `attack_forward` its left-hand mirror (250 ms), stage 3 `attack_finisher` the
  crossover (400 ms: arms fold and cross with the right hand above the left, ~100 ms
  hold, then both arms snap outward). The strike itself covers 40+ cm in about 30 ms
  (2-3 frames at 60 FPS); wind-up and recovery stay smooth. Clip ids are unchanged
  because gameplay and the network use them. Clips are exported at 120 Hz.
- **Transitions** (`MeleeAnimation.ts`): attacks 1-2 start in their own wind-up and are
  blended in over 70 ms from wherever the arms are, so a chain flows from the previous
  follow-through. An interruption in the middle of a crossfade now freezes the pose being
  shown and blends from it (the old code dropped the half-blended layer).
- **Idle flourish**: new clips `flourish_r` / `flourish_l` (520 ms finger spin, the other
  hand holds the guard). The animator starts one at random every 6-12 s, only from a
  settled guard, never during a blend or combat. An attack, unequip or reset cancels it
  at once. Cosmetic only; remote players and bots run their own random flourishes.
- **Death** (`src/game/LimpBody.ts`, `CharacterAsset.captureDeath/poseDeath`): every joint
  is a damped spring that starts exactly at the last living pose (gun/dagger IK
  included) and relaxes to a limp pose. The body tipping over lags into the limbs, each
  limb has its own frequency, delay and asymmetry (seeded by the elimination id), knees
  are heavily damped (no hyperextension), arms come to rest on the floor whichever way
  the body falls, hips return to standing height and the body settles 4 cm lower.
- **Combat metadata (the one gameplay-adjacent change)**: `shared/melee.ts` now mirrors
  the new timings: duration 250/250/400 ms, contact 70-160 / 70-160 / 215-305 ms (same
  90 ms width as before), chain 170 / 170 / 310 ms. Damage 35, range, arc, combo reset
  350 ms, equip and unequip are unchanged. **Side effect:** the combo cycle is about
  650 ms instead of 1190 ms, so melee damage per second is roughly 1.8x higher. Tune the
  three `chain` values (via `dagger_design.py` and `shared/melee.ts`) if that is
  unwanted; `tests/meleeCombat.test.ts` fails if the two disagree. The Worker and the
  frontend need a matching release.

## Verified
- 718 frontend tests pass (1 existing skip), server 84/84, typecheck, production build
  and `assets:verify` (8 clips). New tests: speed and pose targets, flourish scheduling
  and interruption, no-snap blending, limp relaxation (running, sliding and
  gun-and-dagger starts, no snap at capture, knees, gravity-aware arms for backward,
  forward and side falls).
- `node tools/melee-anim-test.mjs` (new, real Chrome, Practice) passes: first-person key
  poses, a mashed 60 FPS combo that never returns to idle (worst grip step 0.18 m per
  frame), a flourish and a flourish interrupted by an attack, frame-rate independence
  at 30/60/144 FPS steps, a bot flourish, and deaths while standing and running (no
  clipping, no hovering). `node tools/melee-browser-test.mjs` still passes 12/12.
- Contact sheets inspected in `test-results/melee-anim/` (git-ignored): attacks 1 and 2
  start and follow-through, the crossed pose and the release, combo frames, both
  flourishes, the interruption frames, third-person key poses, and the standing and
  running death sequences with the resting pose. Wrists stay at most 23 degrees;
  forearm clearance is at least 6 cm.

## Remaining limits
- Chain gates are shorter than before (see above); retune if the DPS change is unwanted.
- The first-person slash ends low and partly below the bottom edge at 90 degree FOV;
  other FOVs were not checked. At the finisher release the blades point forward and up
  and are partly hidden behind the fists.
- Limbs have no individual floor collision: the limp pose follows gravity and the body
  is placed by the existing three-sphere DeathMotion, so a hand may sink a few cm into
  uneven ground. Death photos use wall-clock time and were taken at 18-60 FPS headless.
- The bot flourish was photographed at 2.4 m only (small); the third-person lab sheet is
  the clear view. Idle flourishes have no spatial sound for remote players.
- No multiplayer session, low-end device or Chromebook mode was tested.

# UI sound polish, magnetic ranges and Practice bots (2026-11-07)

Completed the attached focused update using the existing UI, AudioManager,
MagneticSlider, BotBrain and local Practice authority. Preserved pre-existing
uncommitted work. No commit, push or deployment. See `docs/UI_SOUNDS_BOTS.md`.

## Completed

- One delegated UISounds manager covers existing/dynamic buttons, navigation,
  options, dialogs and crate overlays. Removed the old per-button click call.
  Disabled/inert/hidden controls remain quiet. Dropdown mouse/keyboard selection
  emits one shared activation event. Trusted gestures unlock audio; hover cannot.
- Cached 45 ms warm hover/tick buffers and a deeper/louder 55 ms click play
  immediately through existing SFX, compressor and master gains. Hover progresses
  through five gentle pitch steps, resets after 500 ms and adds tiny variation.
  A 25 ms tick/hover guard and three-voice budget bound rapid input. Existing
  assets and gameplay/spatial sound paths remain intact.
- MagneticSlider accepts min/max/step/current value/callback and labels. Spring
  coordinates use stop indices, preserving previous hysteresis and easing.
  Discrete selection alone emits a tick; initial/programmatic reset, unchanged
  input and spring oscillation are silent. Practice retains 0-5 bots; Create
  Server now reuses it with shared authoritative 2-10 limits and default six.
- Added Intermediate between Beginner/Advanced using existing states and tuning:
  600 ms reaction, +/-2.8 degree error, 82% movement, 5.5 s slide attempts, limited
  cover, low-health retreat and moderate pursuit/burst pauses. Existing Advanced
  and Absurd combat tuning stays intact. Difficulty alone persists safely in
  optional localStorage; no saved selection defaults to Advanced.
- Bots can use real available grenades through held input and the existing charge,
  inventory, physics, fuse, damage/team/owner-immunity and presentation pipeline.
  Chance/cooldown scale by difficulty; starts are spaced 3.5 s across all bots.
  Visible valid opponents, 6-20 m range and swept ballistic path checks gate
  attempts. Bots pause movement/fire while charging and cancel invalid targets
  or blocked paths. No injected/fake explosions or unlimited inventory. Existing
  legitimate elimination grenade rewards remain. Practice rewards/statistics
  upload remain disabled, with no network/profile adapter added.

## Verification

- `npm test`: **709 passed, 1 existing skip** (72 passing files, one skipped).
- Final focused sound/magnetic/Practice suite: **30/30 passed**, including actual
  AI combat at all four difficulties, all-map collision/navigation, preference
  fallback, short tone/gain/voice budgets, wall/overhead trajectory rejection,
  held charge, inventory, confirmed blast damage, owner immunity and cancellation.
- `npm run typecheck`, production `npm run build` and `git diff --check` passed.
  Build retains the existing large-bundle warning.
- Production `/crossfire/` Chrome UI suite: **19/19 passed**. Verified actual
  AudioBufferSource playback, single click cues, pitch progression/reset, disabled
  silence, exactly five keyboard ticks, no spring duplicates, lobby default and
  endpoints, mouse drag, touch, reduced motion, Intermediate refresh persistence
  and small-screen choices. Inspected lobby and 640x480 Practice screenshots.
- Existing production offline Practice suite: **21/21 passed**, across all three
  maps, real GLB bots/movement/fire/reload/grenades/scores, team presentation,
  five-bot matches and recovery after an actual failed online request.
- Same suite with actual Chromebook mode enabled: **22/22 passed**, zero backend
  traffic during Practice and unchanged account data. Five-bot samples on this
  Windows Chrome host were approximately 43-87 FPS, with measured frame fields
  approximately 6.3-15.0 ms; these are host observations, not Chromebook guarantees.
- Reports/screenshots are ignored under `test-results/ui-sounds-bots-browser`,
  `practice-browser-production` and `practice-browser-production-chromebook`.

## Limitations and release

Subjective sound quality was not certified on different speakers. Physical
Chromebook performance, Firefox/Safari and public multiplayer were not tested.
Bot aim uses a conservative low arc, so some plausible bank/lob throws are
intentionally declined. Backend code, balance, shared wire protocol and Cloudflare
configuration were not changed; no Worker deployment is required for this task.
Publish the frontend only when authorized. Local commands are in the linked doc.

# Unified header, menu refinements and magnetic slider (2026-11-07)

Implemented on the existing UI and shared motion system. No gameplay, multiplayer,
protocol, graphics, inventory ownership or purchase-rule changes. Existing dirty
work is preserved. No commit, push or deployment. See `docs/MENU_HEADER_SLIDER.md`.

## Completed

- Kept one mounted header across Play, Shop, Locker, home Settings and Leaderboard.
  The existing real account element now lives inside it; username, gem icon and
  balance remain at the upper right. No duplicate state or account polling system.
  Removed Shop's redundant second balance label; crate price display is preserved.
- Reduced header/logo spacing and moved the five tabs upward without reducing
  their 15.4 px text. One translucent vertical gradient applies to every page.
  Narrow windows scroll the horizontal tabs rather than shrink their text; selecting
  a tab brings it into view. Header identity, dimensions and position remain stable.
- Removed upward Play glows and ordinary navigation hairline outlines, retaining
  blue Play selection, background illumination, keyboard focus and the existing
  approximately 1.08 hover overshoot -> 1.03 settle and click compression.
- Removed the main Shop/Locker/Leaderboard Back buttons. Contextual Back controls
  in Settings, item previews and Practice remain. Removed the leaderboard-specific
  inset dark overlay and kept aligned filters, My Stats and independently scrolling
  rankings below the persistent header.
- Locker categories now share navigation overshoot/compression and persistent
  selection. Filtering, all five starter models, item previews and equipment remain.
- Added the custom 0–5 bot slider with native keyboard/accessibility semantics,
  visible numeric labels/count, a translucent track and a spring-driven thumb.
  Velocity-sensitive attraction and hysteresis allow fast multi-stop drags, gentle
  resistance and nearest-integer release. Only integer values reach Practice setup.
  Reduced motion snaps directly; no animation frames run once settled.
- Pointer capture, cancellation, lost capture, focus/window blur, page hiding and
  disposal clean up slider interaction/animation. Themed thin rounded scrollbars
  style actual scrolling panels; scrolling itself remains ordinary, not magnetic.
- Added room for scaled controls and focus rings without disabling legitimate
  scrolling. Corrected Practice grid minimum sizing on narrow screens, Settings
  focus-scroll padding on short screens, and Locker category width when a scrollbar
  is present. No blanket container overflow suppression.

## Verification

- Complete frontend suite: **702 passed, 1 existing skip**. Focused Settings,
  Practice and magnetic-model run: **39 passed**; final magnetic-model run: **4/4**.
- `npm run typecheck`, production `npm run build`, and `git diff --check` pass.
  The existing large-bundle warning remains; no backend build/deployment is needed
  for these UI-only changes.
- Production `/crossfire/` browser suite: **161/161 checks passed**, including all
  five menus at 1920×1080, 1366×768, 1280×720, 1024×600, 640×480 and 390×700.
  Verified identical header nodes/geometry/gradient, real account state, selected
  tabs, content clearance, borders, category animation and representative hover
  scroll bounds. Wheel scrolling through ten real API ranking rows leaves the
  header fixed. QA rank records exist only in isolated local Worker fixtures.
- Real mouse click/rapid drag, keyboard Home/End/arrows, CDP touch drag, reduced
  motion and blur/capture cleanup pass. No browser exceptions or missing assets.
- Existing UI motion browser suite: **28/28 passed**, covering live Settings,
  keyboard focus, dialogs, real server browsing, Practice selection/spawn, HUD and
  pause navigation. Existing home/Locker visual suite: **34/34 passed**, including
  all five starter thumbnails/previews, original character, responsive labels and
  preserved overshoot. Outdated glow/Back/four-starter expectations were updated
  to the requested design and the existing melee starter, with assertions retained.
- Existing real-Worker cosmetics browser regression: **34/34 passed**, including the
  real 37-gem header balance, disabled unaffordable crate, all five item previews,
  keyboard access to the last equipped slot, wallet/equipment preservation across
  browser refresh, actual remote model/movement and server-controlled ammunition.
- Visually inspected all five menus and Practice, including narrow layouts, real
  loaded weapon thumbnails and the existing home character. Reports/screenshots:
  `test-results/menu-header-browser/`, `test-results/ui-motion-browser-production/`
  and `test-results/home-locker-production/`.

## Limitations

- Browser verification used local Chrome and the real local Worker. Physical
  Chromebook/touch-device performance and Firefox rendering were not certified;
  Firefox and Chromium scrollbar styling are both supplied.
- On narrow windows, the full-size five-tab row intentionally scrolls horizontally.
  Backend/protocol/purchase behavior remains unchanged by this update. The previous
  melee task's matching protocol v20 deployment requirements still apply to it.

---

# Dual-dagger gameplay and cosmetic integration (2026-11-06)

Implemented locally on top of Claude's existing Blender models, arms, grip anchors,
six clips and IK/blending system. See `docs/MELEE_GAMEPLAY.md` for rules, code paths,
local commands and release requirements. The presentation-only handoff below is
historical. No commit, push or deployment.

## Completed

- Separate rebindable **V** melee equipment; existing customized V bindings migrate
  without being stolen. Unequipping restores the selected gun and ammunition.
  ADS, gun firing/reload/selection and grenade charging are gated during melee.
- Shared elapsed-time Cross / Forward / Finisher state machine: **35 HP per hit**,
  authored contact/chain windows, one buffered press, no automatic held-fire spam,
  one contact per swing and a configurable 350 ms combo reset after recovery.
- Worker-authoritative short-range forward-cone/capsule hits, solid occlusion,
  friendly-fire protection, damage/regen interruption, elimination, assist, feed,
  standings, statistics and existing reward paths. Clients cannot declare damage.
- Predicted local animation, input replay/reconciliation, authoritative equipment,
  stage/start timestamps and confirmed hit events; remote and spectator animation
  use the original character pose system. Death/respawn/round resets and session
  resume preserve the appropriate gun and authoritative life state.
- Practice shares the exact melee rules, and nearby bots can equip and attack with
  daggers deterministically. Practice retains its explicit non-rewarding policy.
- MELEE is the sixth Locker filter and fifth equipped slot. Existing inventories
  gain the Common **Default Daggers** starter without losing gun equipment.
  Both actual dagger GLBs appear in full-screen previews and crate reveals.
- All six existing crate skin collections have matching paired material finishes
  in first/third person. Existing price, availability and rarity odds stay intact;
  catalog now has 5 starters and 30 crate items. Ownership remains authoritative.
- Durable crate receipts share the gem/inventory storage batch; concurrent retries,
  runtime restarts and ambiguous network/5xx responses reuse the original purchase.
- Quiet equip/flourish and three distinct swing WAV cues, authored flourish/contact
  timing, existing spatial audio, non-graphic hit markers and damage feedback.

## Regressions found and fixed during verification

- The room could sleep during a stationary equip transition. Finite melee phases
  now keep the existing simulation awake; ready/hidden phases may sleep normally.
- Dead-player snapshots repeatedly reset the spectator's view. Reset now happens
  at the death transition, and a reset invalidates the cached animation key.
- Pending input replay now changes gun/melee collision clearance per tick, matching
  authority, without restarting an unacknowledged equip animation.
- V presses survive render frames shorter than a physics tick and are consumed
  once. Blur, menus and rebinding clear pending toggles.
- A grenade regression test placed four bodies through separate asynchronous RPCs
  near fuse expiry. Its setup now uses one validated atomic placement transaction;
  grenade damage, timing and assertions are unchanged.
- The new assist test fired its setup rifle shot before aiming settled. It now
  waits for authoritative ADS and checks the confirmed shot before melee scoring;
  no arbitrary sleep or weapon-accuracy change.

## Verification

- Complete frontend suite: **698 passed, 1 existing skip**. Includes real-GLB
  rig/animation, melee, transport replay and ambiguous crate-retry regression tests.
  Focused real-GLB rig/animation, melee and transport run also passed **42/42**.
- Complete backend suite: **84/84 passed**, including all five new real Worker melee
  cases, existing firearms, assists, grenades, rooms, traversal and match rewards.
- Real frontend/production-Worker protocol compatibility: **1/1 passed**.
- Frontend TypeScript/production build and backend generated types/TypeScript/dry-run
  build pass. Asset/model/texture/catalog checks pass; `git diff --check` passes.
- Production `/crossfire/` Chrome + real local Worker verification: **17/17 passed**,
  including physical V, Settings rebinding, three exact authoritative combo stages,
  reciprocal real-client hits, remote animation, spectator daggers, gun restoration,
  paired previews, real grant/equip and duplicate-request receipts. No browser
  exceptions or missing assets. Screenshots/report: `test-results/melee-gameplay-browser/`.
- Visually inspected final first-person, spectator, Default pair preview and Rich
  paired crate reveal screenshots. Authored clip/rig tests check grips, wrist angles,
  arm clearance, blending and frame-rate independence.

## Release and limitations

- **WebSocket protocol v20 requires matching frontend and Cloudflare Worker
  deployment.** Cosmetics HTTP remains v1. Existing guarded release workflow,
  Worker URL, Durable Object configuration, origins, `.env.local` and Pages base
  path are unchanged. Deploy only when authorized.
- Tests used local Workers/real WebSockets and Chrome, not the public Cloudflare
  deployment. Internet latency and physical Chromebook/laptop performance remain
  unverified. Build still reports the existing large-chunk warning.
- Contacts use a bounded forward cone/capsule with solid occlusion, not blade-mesh
  collision. Expired attack windows intentionally do not award delayed damage after
  a long server stall; local browser checks run separately from CPU-heavy suites.

---

# Dual-dagger models and melee animation (presentation)

Implemented and verified locally 2026-11-06. Details, timings and integration notes for
the combat work: `docs/DUAL_DAGGERS.md`. No commit, push or deployment. Protocol (v19),
server, gameplay, damage, input, inventory and crates are unchanged; the combat layer
(Codex) wires those.

## Completed
- **Daggers:**
  - Two original daggers from `blender/melee/generate_daggers.py`. All numbers live in
    `dagger_design.py`.
  - Matched pair with individual variation: the right has a 150 mm straight-spine blade and
    a ring pommel; the left a 140 mm recurved blade, jimping and a spike pommel.
  - Embedded PBR: two-tone coated/polished blades with a streak roughness map, a gunmetal
    guard, a knurled graphite grip and teal accents. 3.8k and 3.4k triangles.
  - Origin at the handle centre, with grip/tip/edge/guard/pommel/spin-pivot anchors.
  - Editable `blender/source/daggers.blend`, renders in `docs/melee/` and a transparent
    thumbnail.
- **First-person arms:** `melee_arms.glb` holds the player character's own arm/glove parts
  on the unchanged 26-joint rig.
- **Clips:** six GLB clips on animated empties: equip, idle, cross, forward, finisher and
  unequip, with hand sockets, finger spin and twirl, reveal scale, elbow poles and torso.
  - `daggers.json` carries per-clip duration, contact, chainFrom, recovery, anticipation,
    trail and flourish windows, the combo order, attachment/hold, first-person framing and
    Blender checkpoints.
  - Hands are authored hand-first. Knuckles are derived from the runtime two-bone IK,
    giving wrists of 14–24°.
- **Runtime:**
  - `MeleeAnimator` (crossfades, combo chaining with a one-request buffer,
    frame-rate-independent advance).
  - `DaggerPair` parents each dagger to its hand bone through the inverse grip.
  - The third-person dagger layer inside `CharacterWeapon` (still the single pose system):
    the gun lowers and hides, hands blend to the sockets, and torso, clavicles and fingers
    follow.
  - Remote players and Practice bots (lazy per avatar, survives gun swaps, hidden at death).
  - First-person `MeleeView`: real arms on the camera, shared sway/bob, gun lowered and
    hidden through `WeaponView.setMelee`.
  - A home pose-lab `melee` option.
  - Test hooks `__crossfire.melee`, `meleeInspect`, `meleeRemote`, `meleeRemoteSync` and
    `meleeRemoteInspect`.
- **Problems found during visual review and fixed:**
  - Chain crossfades snapped. Now 0.15 s smootherstep, and transitions stay within 15% of
    the clips' own acceleration.
  - The 60 ms thrust was too fast to read. Now 75 ms.
  - Wrists bent 45–84° with authored knuckles. Now derived from the IK.
  - The first-person cross happened below the screen and the finisher's spin and wind-up
    above it. Both are reframed into view.
  - Forearms passed through each other while crossing and uncrossing. Now staggered, with
    centrelines at least 6 cm apart.
  - Frozen test poses showed the previous clip. Fixed by resetting before `play`.
  - Off-screen avatars kept stale gun/dagger visibility and never bound their daggers.
    Visibility now syncs every frame and binding is eager.

## Verified
- Frontend **686 passed, 1 existing skip**, including 12 new melee tests:
  - Clips GLB against the Blender checkpoints (hands within 3 mm), the grip matrix, equip,
    combo, no snaps and frame-rate independence.
  - Real-GLB rig: sockets reached, wrists below 30°, grip anchor equals the fist's handle
    centre, all four guns lower, hide and return, gun swap with daggers out, forearm
    clearance.
- Typecheck and production build pass. `npm run assets:verify` passes, including the new
  dagger checks: references, anchors, all six clips on every channel, the 26-joint arms.
- `node tools/melee-browser-test.mjs` passed **12/12** on Vite and **12/12** on the
  production `/crossfire/` build:
  - First-person gun lowered and hidden, every clip played in order, wrists at most 23.8°,
    blades 19–22° off the crosshair in the guard.
  - The `Weapon` state is untouched.
  - Practice bots show both daggers with the gun away; the daggers stay in their fists
    mid-attack (≤1 mm) and the bots return to their guns.
  - No page errors or missing assets.
- I inspected these contact sheets:
  - First person: the stepped equip → cross → forward → finisher → return → unequip
    sequence, and frozen key poses per clip.
  - Third person: three angles, the gun lowering and return for all four guns, and grip
    close-ups.
  - A Practice bot in the European Town map under its lighting.

## Remaining limitations
- **Not implemented here** (the combat layer's job): melee input, damage and hit windows,
  network sync, inventory/crate entries, and blocking gun fire, reload or ADS during melee.
- **Fingers:** only the index fingers articulate. During the roughly 0.22 s finger spin the
  handle briefly passes the closed fingers.
- **Reveal:** the daggers scale in rather than drawing from a sheath.
- **Third-person gun:** it hides at the low point of its drop rather than being slung.
- **First-person framing:** tuned and checked only at 90° FOV.
- **Not verified:** multiplayer, a low-end device, and blade trails, which have a data
  source but no renderer.

STOP: dagger assets and animations are complete and verified; nothing else was started.

# Home screen and Locker design refinements

Implemented and verified locally 2026-11-06. No commit, push or deployment.

- Removed the large Play button's border and the selected Play tab's outline;
  each keeps a subtle blue fill and a diffuse upward radial glow. Keyboard focus
  retains its visible outline.
- Increased navigation text slightly and added a 360 ms overshooting hover to
  Play and all five navigation buttons. It peaks near 1.08, settles at 1.03 and
  reverses smoothly even when interrupted. Press feedback and reduced motion are
  preserved; no layout dimensions change and no animation loops were added.
- Lightened and shortened the shared header gradient and faded its lower edge to
  transparent across the home pages.
- Made Locker inventory cards compact 132 px squares with contained, centered
  thumbnails and rarity accents. Existing category filtering, equipment panel,
  actual cosmetic data and full 3D preview remain. Narrow-screen category labels
  fit within their buttons.
- Frontend typecheck and production build passed. Chrome checks passed **34**
  assertions against the production GitHub Pages subpath, using the real local
  Worker for inventory: hover peak, interruption and return, focus, reduced
  motion, navigation, preview, card dimensions and four viewport sizes. The
  existing menu interaction regression suite passed **28** checks.
- Visually inspected Home and Locker, including 640x480 and 390x700. No physical
  Chromebook benchmark or public deployment was performed. Gameplay, networking
  and weapon logic were not changed by this UI task.

# Complete UI animation and interaction polish

Implemented and verified locally 2026-11-06. See `docs/UI_MOTION.md` for files,
behavior, commands and limitations. No commit, push or deployment.

## Completed
- Added one shared motion stylesheet and small visibility/feedback helpers:
  consistent hover/press/selection timings, subtle persistent selection and focus,
  two-way menu/popup/dialog fades, small content travel and stable home navigation.
- Covered menu buttons/cards, Settings tabs/controls, room and Practice setup,
  Shop/Locker/previews, leaderboard/My Stats, loadout, loading, Pause, results,
  scoreboard/chat and existing HUD notifications. Essential HP/ammo/state updates
  remain immediate; optional presentation transitions never delay gameplay actions.
- Outgoing screens become inert and accessibility-hidden immediately. Rapid
  navigation has no delayed callbacks. Custom dropdowns clear on leaving, Settings
  categories scroll on short screens, and the crate overlay traps/restores keyboard
  focus and cancels stale opening callbacks.
- Saved Chromebook Mode enables a lighter CSS profile live. Reduced motion removes
  movement and decorative animations while preserving short fades/state visibility.
- Added real Chrome interaction coverage and extended the existing crate checks.

## Verification and limits
- Frontend tests: **674 passed, 1 existing skip**. Production build/typecheck passed.
- Actual frontend/Worker protocol integration: **1 passed**; no protocol change.
- Development (**29 checks**) and production `/crossfire/` (**28 checks**) browser
  runs passed, covering hover/press, actual CSS
  closing interpolation, keyboard/focus, real public rooms, Settings at 640x480,
  selected/disabled states, 24 rapid navigations, reduced motion, Chromebook profile,
  Practice spawning, weapons, scoreboard and Pause. Development also checks results.
- Real local Worker crate run: **25 checks passed**, including authoritative grant,
  charge/equip, animation/drag behavior, small-screen layout and keyboard wrap/restore.
- Major menu screenshots actually inspected. No public-server deployment/validation
  or physical Chromebook benchmark. Older browsers without discrete CSS transitions
  use immediate closing; native platform popup internals keep platform behavior.
- Frontend-only release for these UI changes; existing unrelated work is preserved.

STOP: this UI polish is complete; no later feature started.

# Grenade buffs, explosion effects and voluntary aim assist

Implemented and verified locally 2026-11-06. Details and repeatable commands:
`docs/GRENADE_AIM_ASSIST.md`. No commit, push or deployment.

## Completed
- Shared authoritative blast tuning: **200 peak raw HP**, **5.2 m radius**, 0.65 m
  full-damage plateau, smooth exponent-1.15 falloff, unchanged solid-wall occlusion.
  At least double the old raw damage at every previously damaging distance. Actual
  applied hits remain capped at remaining HP; strict protocol validation stays v19.
- Worker and offline Practice exclude the owner by authoritative ID. Surviving
  opponents receive outward `8 * damage/100` m/s and upward `3 * damage/100` m/s,
  with 12 m/s horizontal and normal-jump vertical caps. Existing controller/weapon
  collision, wall sliding, ceilings, gravity and reconciliation handle the motion.
  Blast interruption uses the existing slide cooldown, without changing its tuning.
- Smoke volume/density reduced 25%; rising/dissipation and shared visibility remain.
  Normal dirt puffs/rocks/sparks tripled to **54/36/30**, with brief gravity-driven
  motion and pooled limits; Chromebook reduces these to **12/5/4**, without burst
  lights or extra gameplay physics/network transforms.
- Confirmed local grenade damage drives finite, damage-scaled camera translation
  and optical roll, ending exactly at neutral after 0.5 seconds. No permanent aim
  change, distance-only/self shake or amplitude stacking. Reduced motion disables it.
- Full grenade charge is **1.1 seconds**. The old >6.5% ring visibility threshold
  caused the initial delay; active charging now shows immediately, with a thicker
  high-contrast track and smooth HUD interpolation. Server power remains credited
  from held simulation/authority time. Release never waits for a throw animation.
- Added an explicit persisted Gameplay aim-assist setting, **Off by default**.
  Requires deliberate mouse input, visible opponent body point, clear mesh/smoke
  LOS, **2.5° cone / 2–35 m range**. Correction is at most 12% of input, 1°/s,
  0.25° per gesture, and only within an initial 180 ms window. Motion/manual-input
  thresholds, immediate input override, a target latch and recoil/firing suppression
  prevent snapping, sticky camera, switching or autonomous tracking. No changes to
  gun damage, spread, fire rate, recoil, hit claims or backend authority.

## Verified
- Frontend **674 passed, 1 existing skipped**. Frontend/Worker typechecks and builds
  pass; real frontend/Worker protocol compatibility **1/1**.
- Full backend **79/79**, including new real four-peer FFA/Teams blast/impulse tests
  and existing grenades/crouch, scoring, assists, health, rooms, persistence and maps.
- Unit coverage includes old/new damage curves, falloff/occlusion, camera recovery,
  reduced motion, timing, particle caps, movement collision/replay at 30/60/144 FPS,
  aim cone/LOS/input/motion/target/recoil gates, persistence and frame-rate response.
- Actual Chrome/local Worker: **19/19 Vite**, **19/19 production `/crossfire/`
  Chromebook**, **20/20 production reduced motion**. Tested real charging/release,
  debris/rock counts, smoke cleanup, no self feedback, confirmed shake/knockback and
  manual aiming/stop/wall occlusion. No page exceptions or missing assets; inspected
  explosion/smoke/damage screenshots. Full charge measured about 1.1–1.2 seconds;
  local release-to-server throw was below 200 ms including batching/network time.
- Offline Practice browser checks **25/25**, including bot combat, all three maps,
  inventory/reload/grenades/results/restart, no account changes and no backend use.
- The stronger blast legitimately killed an unrelated peer in the old posthumous
  scoring fixture. Moved that staging peer outside the blast, preserving all exact
  scoring assertions. The open-space impulse fixture faces toward the blast so
  existing weapon clearance does not mask the impulse against nearby geometry.

## Limits / release
- Local validation only; no public deployment tested. Matching frontend and Worker
  releases are required through existing CI when authorized. No credentials/config
  changes. Headless Chrome checks are not a physical Chromebook benchmark.
- Aim assist is deliberately small and needs normal playtesting for final feel.
  It does not implement continuous tracking or change authoritative shot results.

# HUD polish, leaderboard, idle/death animation and match-placement gems

Implemented locally 2026-11-06. See `docs/HUD_MATCH_REWARDS.md` for rules,
persistence, verification commands and limitations. No commit, push or deployment.

## Completed
- Nametag health bars use authoritative HP / 100 with smooth, left-anchored blue
  fill. They share the label's existing LOS/smoke/teammate visibility; no extra rays.
- Live FFA scoreboard and FFA results use neutral gray names/local accents. Teams
  retain the existing relationship colors and authoritative team assignments.
- Client-only deaths receive bounded impact motion, gravity, swept three-sphere
  map collision, wall-aware landing direction, damped rig limb reactions and a
  delayed smooth fade. The original three-second respawn is unchanged. Inspection
  caught a cold-shader black silhouette: fading materials now compile before swap.
- Home tabs retain one active selection independently of hover. Global rankings
  fit below the retained dark header, scroll internally and offer only Kills/Wins;
  backend points remain. The two filter rows align at desktop and small sizes;
  My Stats remains reachable and its dropdown scrolls within the remaining height.
- Menus/buttons are slightly more transparent while preserving text, selection,
  blur and meaningful action colors. Home idle adds slow breathing/bob/body sway
  and independent held-weapon/arm movement without losing grip IK/cosmetics.
- SMG investigation: the current committed preview readiness/warm-up fix already
  renders it correctly. Verified all four actual GLB thumbnails with cold-cache
  pixel checks in Vite and the GitHub Pages `/crossfire/` production build; no asset
  path, model, balance or placeholder substitution was necessary.
- Match gems: first/second/third = **10/6/3**, plus
  **min(20, floor(finalScore / 500))**, plus **2** for eligible winning-team players.
  FFA pays the actual top three overall; Teams pays the top three per team. Ties
  use the existing deterministic points order; draws have no winning bonus.
- Server eligibility requires a full 600-second competitive round, two persistent
  profiles, a real elimination, both teams for Teams, 60 seconds of participation
  and an actual kill/death/assist. Explicit Leave/AFK forfeit placement; transport
  interruptions preserve it. Empty/solo/canceled/incomplete/Practice rounds do not
  earn placement gems. Existing independent challenge rules are preserved.
- Source-qualified match IDs and private durable per-room high-water receipts
  prevent duplicate/older payouts. Canonical wallet/statistics/receipt writes are
  atomic; custom rooms reuse the durable ordered outbox and canonical ACK. Profiles
  remain payable after session expiry/restart. Spending does not reduce lifetime
  gems. Results display only confirmed receipts, including late confirmations;
  offline Practice explicitly says **PRACTICE — NO GEMS EARNED**.

## Verification
- Frontend: **651 passed, 1 pre-existing skipped**; typecheck/production build pass.
- Worker typecheck and production dry-run build pass. Actual frontend/Worker
  protocol compatibility: **1/1**. Protocol remains **v19** with optional result
  metadata; malformed rewards are rejected and old results remain accepted.
- Full backend integration: **77/77 passed**, including combat, grenade scoring,
  assists, challenges, persistent statistics, crates, rooms, reconnects and maps.
- Chrome against actual local Worker: **27/27** in production and **27/27** in Vite,
  plus **17/17** final production menu/dropdown checks. Verified real 75 HP → 75%
  bars, opponent wall occlusion, through-wall teammate bars, FFA/Teams colors,
  death displacement and canonically confirmed result payouts. No page exceptions
  or missing assets. Screenshots inspected under `test-results/hud-browser/`.
- Fully offline Practice browser regression: **25/25**, including bots, all maps,
  firing/reloading/grenades, results/restarts, unchanged account data, and recovery
  after a real failed online attempt. No backend requests/sockets during Practice.
- Reward regressions cover formula/caps, top-three rules, draws/ties, short/solo
  matches, intentional abandonment, actual pre-result transport drops, canonical
  lost-ACK retry, persistence/reconnect/restart, source isolation and lifetime gems.
  A randomized existing daily MVP/win payout caused the first solo fixture failure;
  the test now chooses the existing combat-only challenge fixture before admission
  to isolate placement rewards without changing challenge behavior.

## Limits and release
- Deaths are a lightweight proxy/rig approximation, not per-limb rigid-body physics;
  fine limb/weapon contacts in every corner are not guaranteed. Collision tests
  cover floor/walls at 30/60/144 FPS; rendered local deaths were inspected.
- Competitive eligibility discourages empty-match farming, not coordinated
  collusion. Independent existing challenge rewards are outside placement totals.
- Validation is local only. Both Worker and frontend need the matching authorized
  release through existing CI; no public Cloudflare/Pages deployment was tested.

# Crate and cosmetics polish pass

Polished and verified locally 2026-11-06, on top of the committed crate work ("Gun
textures"). Not committed, pushed or deployed. No server, protocol, inventory schema,
odds, prices or weapon statistics changed. Details: `docs/CRATE_REVEAL.md`.

## Fixed (found by inspecting the previous screenshots)
- **Missing Locker thumbnail:** the first thumbnail a fresh engine rendered (always
  Default AR) was an empty transparent PNG. `WeaponPreviews` now waits for
  `scene.whenReadyAsync()` and renders a warm-up frame before capturing. The home
  loadout cards share this code.
- **Thumbnails missing for newly owned items:** if the inventory gained items while a
  thumbnail job was running (for example a grant from another tab), `render()` returned
  early and the new cards stayed blank. The Locker now tracks which items the running
  job covers and restarts it (cached snapshots make that cheap).
- **Closed crate:**
  - The bisect caps shared smooth normals with the dome, so every cut was rounded and
    the lid read as four cushions. The cut edges are now split.
  - At rest the seam/core materials had zero emission and showed as a black band under
    the lid. They now idle in a dim neutral ice blue that crossfades to the rarity
    colour as the crate charges, so the rarity is not spoiled. The Blender thumbnail
    uses the same idle colour.
  - The seam strips now reach the dome's crown.
- **Rich:**
  - The `gun_steel` parts (SMG magazine, receivers, barrels) rendered pale cream. They
    are now gold (`#f5b040`, roughness .3), which survives the reveal's key/rim lights
    and tone mapping.
  - Four large coins per repeat read as wallpaper in first person. The gold is now two
    medallions per repeat with polished rims, on fine guilloche engraving.
  - Raised gold is more polished (roughness about .15), with gentle large-scale variation.
- **Marble:** the sine-band veins read as map contour lines and the finish blew out to
  plain white. It now has:
  - Ridged-noise veins: bold, diagonal, with soft halos and fine cracks.
  - A slightly darker base and a tighter repeat (.3 m), so veins show in previews and
    in-game.
- **Light column:** it was a cylinder, so the texture's side fade wrapped around it and
  its silhouette edges stayed hard. It is now a Y-billboard plane with soft edges.
- **Open crate after the burst:** its full-width seam rim stayed bright (a glowing slab
  under the rising reward). Seam and core now cool quickly, the crate sinks out of the
  shot, and the glow layer eases from 1.05 to 0.6 once the reward is up.

## Polish
- **Wind-up:** the last 0.16 s before the burst crouches the body and sucks the lid
  down (new `REVEAL.windup`; unit tested).
- **Light shafts:** they widen as pressure builds between the pop and the burst.
- **Readability:** kicker, title and weapon labels have dark shadows; the weapon label
  is larger and bold, so it reads on the gold Legendary background.
- **Test fix:** `tools/crate-browser-test.mjs` now waits for the loaded GLB character
  and its visibility before the third-person screenshot. Previously it could capture
  only the name label during a load stall.

## Tested (this pass)
- Frontend `npm test`: 641 passed, 1 skipped. Typecheck (both packages) and build pass.
- Worker `npm test`: 71/71 (shared catalog value changes only; no server code changed).
- `assets:verify`: 28 items, crate parts and textures pass. Manifest check: current.
- `tools/crate-browser-test.mjs` (production `/crossfire/` build, real local Worker):
  68/68, no console errors or missing assets. All 28 Locker thumbnails, including
  Default AR, render. The match section (39 checks) was rerun three times after the
  test fix.
- Kill effect frame times (median vs baseline, headless, two browsers): 21.7 vs 20.8,
  22.8 vs 23.6 and 17.2 vs 18.2 ms. One run had a single 578 ms frame during the effect
  window that did not reproduce in the next two runs (max 45 and 22 ms).
- `tools/cosmetics-browser-test.mjs`: pass (live Shop, equip flow, server ammunition and inventory preserved, no browser exceptions or missing assets).
- Screenshots inspected: closed/charge/burst/rise/hero for all three rarities, Locker
  AR page, Marble/Rich previews, first person, third person and the kill effect
  (`test-results/crate-browser/`).

## Remaining / limits
- Rendering in headless Chrome shows a long frame (about 0.4-0.8 s) when a remote
  player's character and cosmetic first load. It was present before this pass and was
  not investigated.
- Thin dark lines remain where the closed lid quarters meet, viewed from above; they
  read as panel gaps.
- The limits listed in the entry below still apply (no reference images, texture-only
  finishes, 7,200 gems for the full set, spectated scoped view has no money effect, no
  live validation; Worker and frontend ship together).

# Reward crate, crate reveal, six skin collections and the Rich kill effect

Implemented and verified locally 2026-11-05. Not committed, pushed or deployed.
Full design and procedures: `docs/CRATE_REVEAL.md`. Protocol stays v19; inventory
HTTP schema stays v1 with one new endpoint, so the Worker and frontend must ship
together through the existing CI when authorized.

The user chose a real server crate over a visual-only demo. This supersedes the earlier
"Shop disabled, no grants" rule.

## Finished
- **Server:** `POST /cosmetics/open` in the canonical object.
  - Requires 300 gems; picks an unowned item with a crypto draw (no duplicates).
  - Odds: Uncommon 55 / Rare 40 / Legendary 5, renormalized as rarities run out.
  - The gem spend and the inventory grant commit in one storage batch; errors are
    responses, never gate rejections.
  - Client validation: `validCrateResult`.
- **Catalog:** six collections x four weapons = 24 items.
  - Green/Blue/Red Camo (Uncommon), Marble and Rainbow Glow (Rare), Rich (Legendary).
  - Material overrides on the original GLBs, so anchors, moving parts and rigs are unchanged.
  - New finish fields: `tile`, emissive with scroll, `clearcoat`.
  - Textures are generated by `blender/cosmetics/skin_textures.py`.
- **Crate model:** `blender/cosmetics/generate_reward_crate.py` produces the GLB, a Shop
  thumbnail and the editable .blend. Dark body, blue panels, orange latches, white domed
  lid cut into four quarters with their own pivots, rarity-tinted seam/core glow.
- **Reveal:** `src/ui/CrateReveal.ts`, timing in `crateTimeline.ts`.
  - Drop-in; 0.46 s squash-and-shake anticipation; lid pop with overshoot; rarity seam
    light and light shafts.
  - Burst at 1.38 s: four quarters fly out, tumble and fall; flash, sparks, rarity column
    and background wipe.
  - The reward rises with overshoot and spins into the hero angle while the camera tilts
    up; rays, motes and a rim light frame it.
  - Name and rarity at the top; EQUIP / OPEN ANOTHER / CONTINUE; SKIP; errors show with
    BACK. Drag-rotate with a damped spring return. Reduced-motion path.
- **Shop:** live crate button, odds, crate contents with owned counts, balance refresh.
  **Locker:** shows the new items through the existing owned-item flow.
- **Rich kill effect:** `MoneyBurst`, thin-instanced coins and banknotes, about 1.3 s.
  - Killer: around the first-person gun, away from the crosshair.
  - Other players within 45 m: at the killer's muzzle.
  - Driven by snapshot `cosmeticId`; no new messages. Shaders are pre-compiled at weapon load.
- **Fixes found while testing:**
  - Outside Ultra the library read ORM roughness from alpha, so every skin rendered fully
    rough; `CosmeticAssets` now reads green when a finish has an ORM.
  - Preview scenes had no reflections, so metal looked black; added `studioEnvironment()`.
  - The light shafts' StandardMaterial emissive texture washed out the rarity colour.
  - The first kill hitched 300-400 ms on shader compilation; both emitters are now
    pre-compiled.

## Tested (this session)
- Frontend `npm test`: 640 passed, 1 skipped (new `tests/crateReveal.test.ts`: draw
  odds/no duplicates, collections across four weapons, timeline beats, lid flight,
  hero settle, spring return). Typecheck (both packages), build: pass.
- Worker `npm test`: 71/71, including the new crate test:
  - Bad bodies rejected; two opens spend 300 each; a third with 50 gems fails.
  - No duplicates; lifetime statistics unchanged; equip works; survives a restart.
- Gates: protocol 1/1, deployment 7/7. `assets:verify`: pass (28 items, crate parts,
  textures). Manifest check: current.
- `tools/crate-browser-test.mjs` (production `/crossfire/` build, real local Worker): 68/68,
  no console errors or missing assets.
  - Shop states; forced Uncommon/Rare/Legendary reveals with phase screenshots (closed,
    shake, pop, charge, burst, rise, hero).
  - Lid pieces, camera tilt and rarity colours #39e57a/#4d8dff/#ffc22e; drag rotates and
    springs back.
  - Equip from the reveal; layout at 480x800 and 640x480.
  - Locker: all six collections on all four weapons with labels and colours, eight 3D
    previews, one equip per weapon.
  - Match: first person and ADS with the Rich rifle; a remote Rich sniper in third person.
  - Rich kill as killer: 21 pieces. As observer: 21 pieces.
  - Frames during the effect: median 19.5 ms vs 21.1 ms without.
- `tools/cosmetics-browser-test.mjs` (updated for the live Shop): pass.
- All screenshots inspected: `test-results/crate-browser/`.

## Remaining / limits
- The loot-box image and opening GIF named in the brief are not in
  `references_images/`; the crate follows the written description.
- No new weapon geometry (texture finishes only); coin engravings are subtle in thumbnails.
- Gem income unchanged (challenges only); all 24 items cost 7,200 gems.
- A victim spectating the killer's scoped view does not see the effect.
- Headless Chrome timings are not a target-device benchmark; no physical Chromebook run.
- No live/public validation; requires a matching authorized Worker and frontend release.

# Assist integration spawn synchronization fix

Fixed locally 2026-11-05; final verification completed 2026-11-06. Changes are confined to
`server/tests/assists.mjs`, the matching synchronization check in
`server/tests/combat.mjs`, and this log. No production gameplay, room routing,
protocol, assist eligibility/scoring, respawn delay or migration changes.
No commit, push or deployment performed; no service redeployment is needed.

Confirmed root cause: after the second elimination, the test waited for attacker
A's assist count, then immediately called `spawn(B)`. WebSocket delivery/cache
updates are independent between peers. B could still have its previous alive
snapshot (`death: null`), so the old helper calculated no countdown, sent a spawn
while the real Durable Object was still enforcing B's respawn deadline, ignored
the actual `respawn_wait` error and waited forever for an impossible `spawned`
acknowledgment. This was a test synchronization race, not broken room admission
or multiplayer spawning.

Evidence: the unmodified targeted run initially passed; a subsequent instrumented
run reproduced the failure on its first attempt. Its trace showed the second
respawn had no cached `respawnAt` and received `respawn_wait` immediately. The
server's join/spawn paths and other integration helpers confirmed valid public
room routing, round/map revision and weapon selection. Diagnostic traces remain
under ignored `test-results/assist-trace-*`; no production logging was added.

The helper now waits for B's own authoritative unspawned state, then for snapshot
`serverTime >= death.respawnAt` using existing heartbeat snapshots. It sends one
request with a unique ID, matches that exact acknowledgment, reports server errors
or socket closure immediately and checks alive/100 HP/next life/requested weapon.
No arbitrary delay, retry loop, timeout increase or weakened assertion was added.
Join rejection also reports its actual error instead of hiding behind a timeout.

Deterministic regression: hold B's actual death snapshots while A receives the
real assist award, assert that B's cache is still alive and no premature spawn is
sent, release the genuine snapshot and verify exactly one successful respawn.
All existing expired-assist, fresh 50-point assist, previous-life cleanup and
retired-session migration assertions remain.

Validation: `node --test server/tests/assists.mjs` passed after the fix and again
within the complete suite. The first full run exposed the same cross-peer cache
assumption in the Teams lethal-sniper test: it checked the shooter's kill/score
after waiting only for the victim's death. It now also waits for the shooter's
authoritative snapshot (1 kill, 150 points and the expected team total), without
changing expected values. Final full backend suite: **71/71 passed**. Actual
frontend/Worker protocol compatibility: **1/1 passed**. Worker dry-run build,
JavaScript syntax and diff whitespace checks passed. No timeout was increased.

# Fully local Practice with AI bots

Implemented locally 2026-11-05 after completing the Foundry asset work below.
Read `docs/PRACTICE.md` for architecture, usage, tests, limitations and release.
No commit, push or deployment. All earlier uncommitted work was preserved.

Completed implementation:

- Mode Select includes Practice alongside Public Servers, Join Private Server and
  Create Server. Setup uses all three existing map cards, FFA/Teams, integer 0–5
  bots (default 3), Beginner/Advanced/Absurd (default Advanced) and an explicit
  offline/no-account-rewards notice. Loading cancellation returns to setup.
- Browser-local PracticeSimulation owns health, weapons, actual ray/pellet hits,
  grenades, regen, assists, scoring, balanced teams, respawns, the 600-second clock
  and immutable results. PracticeClient feeds the existing Game presentation and
  input-reconciliation contract without a WebSocket, server credential or fake
  handshake. Pausing freezes local time; spectating continues it. Results clearly
  say PRACTICE — RESULTS NOT SAVED and offer Restart, Settings and Home.
- Shared production hitscan was extracted to `shared/hitscan.ts`; the Worker and
  Practice now use it. Existing movement/weapon/damage/grenade/regen/spawn/assist/
  scoring modules remain shared. No weapon balance, online protocol version,
  Cloudflare bindings/URL/origins, persistence or deployment workflow changes.
- Frozen non-rewarding policy, no network/storage/career adapters and no account
  event path make local statistics ineligible for upload. Cold startup and Mode
  Select make no backend requests. Public Servers/Refresh and explicit online
  actions opt into discovery/account services. Practice cancels pending admission,
  profile/lock and inventory work and stops polling. Late cancelled room requests
  cannot start a fetch after a credential resolves. Local events are discarded,
  not queued for a later multiplayer connection.
- Real animated character bots move/fire with the existing humanoids, four weapon
  rigs, spatial audio, muzzle flashes, trails, hit/death effects, names, team
  colors, HUD, kill feed, leaderboard and respawn/spectating UI. Zero bots is alone;
  human plus five bots is Blue 3 / Red 3 in Teams. No friendly damage.
- Layered 0.8 m A* navigation rebuilds from the latest actual collision/layout and
  map revision, with component filtering, sampled bidirectional step/headroom
  checks and reachable upper/underground floors. Shared controller enforces walls,
  slopes/stairs, weapon clearance, jumps and slide cooldowns. Bots replan/recover
  when stuck; only ten seconds of irrecoverable stuck movement causes elimination
  and normal respawn. Ordinary movement never teleports.
- Rule-based states cover exploring, patrol, searching, pursuit, attack, cover,
  retreat, healing and respawn. Real wall LOS and grenade smoke restrict sensing;
  unseen opponents are pursued at their last seen point. Decision cadence is
  90–220 ms, route refresh roughly 850 ms. Random weapons on spawn and occasional
  out-of-encounter switches use real ammo/equip/reload/pump/bolt rules.
- Beginner: slower movement, 950 ms reaction, ±5° error, infrequent slides.
  Advanced: normal movement, 320 ms, ±1.3°, combat strafing/cover/retreat.
  Absurd: 65 ms, zero AI error at the actual crouched/leaned head, frequent legal
  slide attempts, cover/heal/re-engage. Actual weapon spread/pellets remain intact.
- DEV-only F4 top-down node/path/visible-target diagnostics show bot state/stuck
  counters, collision sanity, map revision and FPS. Existing F2 collision and F3
  FPS remain. Overlay and early-result test action are disabled in production.
  Character assets are shared, active actors capped at six and no per-bot timers
  or inference services were introduced. Chromebook graphics settings preserved.

Validation completed:

- Frontend **628 passed, 1 existing opt-in performance test skipped** (63 files).
  Includes **19 Practice tests**: all bot counts, FFA/Teams, balancing/friendly
  blocking, real lethal/nonlethal combat, 220-point grenade double elimination
  without duplicate/headshot awards, regen, respawn, natural 10-minute completion,
  local input reconciliation/pause/Leave, seeded replay, smoke visibility,
  difficulty combat, exact leaned-head targeting and retreat/heal/re-engage.
- Five armed bots traversed each real map for **120 simulated seconds**, climbing
  upper-floor stairs, sliding and switching weapons. Repeated body-solid/safety
  checks passed, all bots travelled >80 m, no irrecoverable-stuck respawns in the
  tested seed. Graphs connect actual spawn points and accessible upper floors.
- Full backend **70/70 passed**, including real TCP/WebSocket combat, grenade
  scoring, reconnect/eviction, props, account statistics, public/private rooms,
  simultaneous six/ten-player rooms and all-map stairs/ladders/wall traversal.
  Initial overloaded concurrent run timed out one movement acknowledgment;
  isolated stress retest and complete clean rerun passed. No timeout/assertion
  bypass or production change was made to conceal that test result.
- Actual frontend transport ↔ production Worker protocol check **1/1 passed**;
  deployment-gate tests **7/7 passed**. Protocol remains v19. Worker typecheck,
  Wrangler dry-run bundle, frontend typecheck/Pages-subpath production build and
  asset verification passed. Existing Vite bundle-size/plugin-timing and local
  runtime RPC-disposal warnings remain nonfatal.
- Real Chrome DEV and production `/crossfire/` offline checks passed with backend
  fetches/gameplay sockets explicitly rejected: all three maps, real animated bots
  moving/fighting/scoring, human rifle ammo/partial reload/grenade, solo exploration,
  five-bot Teams/presentation, unchanged account-related browser data and no missing
  assets/page exceptions. DEV also verified full results, restart/reset, Settings
  and F4 cleanup. Entering Practice after an actual failed online fetch made no
  further backend requests. Screenshots were actually inspected (setup, HUD,
  scoreboard, results and navigation); label/clock overlap was fixed.

- Final-build **two real Chrome clients ↔ actual local Worker** regression passed
  **22 checks**, including Practice before any account/socket, subsequent online
  discovery, private code admission, real synchronized player movement, host
  transfer, all three maps, Teams, loading cancellation, public custom-room joins,
  AFK warning/kick and maximum one simultaneous gameplay socket per browser.
  An old thumbnail test selector initially counted both setup screens; scoping
  it to Create Server fixed the test without changing production behavior.

Reports/logs live in `test-results/practice-*`; the two-client screenshots/report
are in `test-results/rooms-browser/`.

Final DEV offline rerun passed **24 browser checks** (including results/restart and
diagnostics cleanup); final production offline rerun passed **21 browser checks**,
both with zero page/asset errors.
Five-bot Modern City low-quality/0.5-scale FPS samples were approximately
19, 44, 52, 49 and 44 (initial shader/entry recovery included); scene CPU render
samples were 13–18 ms. These are desktop headless-browser observations, not a
hardware-independent performance guarantee or physical Chromebook benchmark.
The final separate DEV five-bot sample measured 58–60 FPS / 6–10 ms scene CPU;
raw timings for both runs are retained, rather than treating one run as universal.
The final Shop/Locker browser regression also passed **32 checks**: real inventory/wallet,
all four model previews, refresh persistence, remote sniper model, peer movement,
server rifle ammunition and leaving-match inventory preservation. Earlier cosmetic
and Foundry work remains intact; no staged skins were registered or granted.

New Practice files: `src/practice/{config,types,Navigation,BotBrain,
PracticeSimulation,PracticeClient,PracticeDebug}.ts`, `src/ui/PracticeMenu.ts`,
`shared/hitscan.ts`, `tests/practice.test.ts`, `tools/practice-browser-test.mjs`
and `docs/PRACTICE.md`. Integration changes: Game, EnvironmentProps, RoomMenus,
UI, RoundResults, styles, CareerClient/RoomClient cancellation, Worker hitscan,
career/room regression tests and online/cosmetic browser test entry flows.

Known limits: simple tactical AI, no team coordination, ladder-specific planner,
bot grenade throws or actor-avoidance navmesh. Narrow spaces can cause replanning;
one tested seed and representative stairs do not prove every route. Desktop
browser performance was checked, not a physical Chromebook. Frontend assets must
be hosted/cached; no service-worker/offline installer was added. No live production
Cloudflare connection was claimed or required. Release the frontend assets and
matching Worker through existing authorized CI; no new secrets/bindings needed.
Run locally with `npm.cmd run dev`; Practice needs no backend command or .env edit.

# Foundry Collection: Blender weapon cosmetics and crate assets

Completed locally 2026-11-05 before starting the subsequently requested offline
Practice feature. See `docs/FOUNDRY_COLLECTION.md` and the staged handoff manifest
`public/assets/cosmetics/foundry-collection.json`. No commit, push or deployment.

| Asset | Category / rarity | Triangles | Draw primitives | GLB KiB |
|---|---|---:|---:|---:|
| Verdant Relay | AR / Uncommon | 1836 | 9 | 688 |
| Blue Current | SMG / Rare | 468 | 8 | 498 |
| Crimson Forge | Shotgun / Epic | 1038 | 13 | 556 |
| Aurum Meridian | Sniper / Legendary | 2504 | 12 | 611 |
| Foundry Crate | Decorative menu prop | 2832 | 5 | 363 |

Each gun has a compatible embedded-material GLB, 1K original albedo, 512px normal
and ORM maps, actual transparent 960x460 thumbnail and editable packed .blend.
Crate has five texture-free PBR materials, fixed latches/handle/diamond badge,
transparent 960x700 render and editable source. Files follow the established
category/ID directories; sources are in `blender/source/cosmetics/`.

Original base weapon files/builders and live catalog are unchanged. Named grip,
sight, muzzle, eject and action anchors, local/world transforms, moving parts and
overall clearance envelopes match defaults; no offsets or balance changes needed.
Shotgun pump trim moves with its pump. Sniper rings remain open around the optics.
No inventory grants, purchases, Shop/Locker logic or multiplayer/scoring changes
were made for this asset task. New entries are staged, not owned/equippable in the
live game. Crates remain nonfunctional.

Validation: existing assets:verify passes, including the new collection validator;
all five .blend files actually reopened/audited in Blender (valid meshes, UVs,
packed referenced images); zero degenerate triangles in all final GLBs; default
weapon file diff empty. Frontend **607 passed, 1 opt-in performance test skipped**;
frontend/lab TypeScript and production build passed. **58 actual Chrome renders**
passed with the existing WeaponView/CharacterWeapon rigs, including default
comparison captures; no missing assets/page errors. All four character grip gaps
were below 0.08 mm. Actual Blender side/front/quarter, browser Locker/front/side,
FP/ADS/reload/recoil/walk, character ready/side/ADS and reflections-off images were
inspected in contact sheets and closeups. Reports/screenshots:
`test-results/cosmetic-collection/`.

Iterations fixed mirrored side lettering, texture weight (initial 3.4 MiB gun
reduced below 0.7 MiB), vent decals sitting above bevel-inset furniture, concave
badge bevel slivers and crate bevel degenerates. Tests were not weakened.
Browser CPU render medians for isolated item views were about 0.2-1.7 ms on this
machine (not GPU frame times or physical Chromebook benchmarks). Approximate
texture allocation per finish, including mipmaps, is 6 MiB, cached/shared per model.

Remaining limits: existing stylized silhouettes/rig quality retained. Default
shotgun FP stock already clips near the camera in the same isolated framing;
the cosmetic retains that baseline rather than changing gameplay view offsets.
Small markings are intentionally subtle at thumbnail size. Real online deployment,
trusted grants, live catalog registration and physical Chromebook benchmarking are
future work, not claimed complete. Build warnings are existing bundle-size/plugin
timings; Blender's shared ORM sampler warning is harmless (same UV/sampler).

New files: collection design/generation/source-audit scripts, five .blend sources,
five GLBs, twelve PBR maps, five thumbnails, staged manifest, verification/review/
contact-sheet tools and isolated asset-lab HTML/TS. Updated cosmetic asset verifier,
asset README, CLAUDE.md, this log and handoff documentation. All earlier uncommitted
Shop/Locker work was retained.

# Shop, Locker, cosmetic inventory and crate preview

Implemented locally 2026-11-05. See `docs/COSMETICS.md` and
`public/assets/cosmetics/README.md` for authority, asset handoff and release notes.
No commit, push or deployment performed. Both frontend and Worker need a matching
authorized release through the existing CI; no new bindings/secrets are needed.

Completed:

- Five equal home tabs: PLAY | SHOP | LOCKER | SETTINGS | LEADERBOARD. Existing
  home character/background, navigation and settings retained. Shop and Locker
  use the current minimalist styling and do not load a full map/game socket.
- Locker category filters, owned cards with actual GLB-rendered thumbnails,
  separate Default/category labels, shared rarity colors and four equipped rows.
  Scrollable inventory and short-screen compact equipped rows keep all categories
  available. An isolated fullscreen model viewer has rarity gradient, orbit,
  Equip/Equipped and Back; it disposes its renderer on navigation.
- Exactly four Common Default cosmetics, all initially equipped, using the original
  weapon files. Shared catalog and asset adapter support compatible alternate GLBs
  and cloned material/texture variants without changing statistics or rig placement.
  First-person, home, remote and spectator views resolve the same visual ID.
  Initial inventory arriving during weapon loading cannot create duplicate rigs;
  asynchronous cosmetic loading cannot revert a newer weapon selection.
- Separate server inventory records in canonical public-main, authenticated with
  the existing career capability. Starter migration, ownership/compatibility
  validation, persistent equipment, revision-guarded active-room propagation.
  Wallet, challenges and statistics records are not replaced. Join/resume obtains
  canonical equipment. Guests retain the existing browser-capability limitations.
- Shop shows actual career gems, original lightweight crate artwork, a disabled
  300 GEMS - OPEN button, COMING SOON and clearly proposed future odds 50/37/10/3.
  There are no purchases, draws, spending, granting or crate-opening endpoints.
- `PlayerState.cosmeticId` is optional compatible snapshot metadata; gameplay
  protocol stays v19. Inventory HTTP schema is independently v1. Omission and
  unknown well-formed future visuals remain compatible; known wrong-category IDs
  are rejected. Existing backend-first release/deployment configuration retained.
- Asset directories and generated catalog manifest, verification included in the
  existing assets:verify CI gate, exact Blender/GLB/anchor/material handoff docs.

Validation:

- Frontend unit suite: **607 passed, 1 pre-existing opt-in skipped**, using both
  `npm test` and `npm test -- --maxWorkers=2`. Frontend TypeScript and production
  build passed (existing large-chunk warning only). Updated two material-loader test doubles to include
  readiness; added inventory/client, material isolation and embedded GLB coverage.
  An earlier unrestricted run hit the existing CPU-heavy arm-pose test's 5-second
  timeout under concurrent work; no assertion or timeout was weakened.
- Worker typecheck and dry-run production bundle passed. Full backend suite:
  **70/70 passed**, including two new real runtime/TCP inventory tests (auth,
  ownership rejection, starter records, wallet/statistics preservation, persisted
  restart, public/custom room metadata, combat state and authenticated reconnect).
- Real frontend/Worker protocol compatibility: **1/1 passed**, including actual
  optional cosmetic metadata, missing metadata and future/mismatched ID cases.
  Existing deployment gates: **7/7 passed**. Asset verification: 199 manifest
  entries, 214 materials, all three maps and four cosmetic definitions passed.
- Chrome production `/crossfire/` subpath testing with real local Durable Objects:
  **32 checks passed**, final build rechecked after the loading race fix;
  requested navigation, Shop/Locker, all filters, four model thumbnails and
  fullscreen previews, disabled crate/no requests/no spend, four equipped rows
  at 640x480 and stacked at 480x480, refresh persistence, Settings/Leaderboard navigation, home appearance,
  real browser + separate real WebSocket peer, remote sniper model, movement,
  authoritative rifle ammo and leave preserving inventory passed. No browser
  exceptions/missing assets. Screenshots inspected for Shop, Locker and every gun.
  Tool/reports: `tools/cosmetics-browser-test.mjs`, `test-results/cosmetics-browser`.

Limits: only the four real Default assets exist, so their Equip buttons correctly
show disabled EQUIPPED; future non-default artwork/grants/equip switches still
require asset-specific visual and integration checks. No fake owned test item was
added. A large future catalog needs cache-budget profiling. No live Cloudflare
or public GitHub Pages deployment was tested. The earlier map texture-retention
checks documented below remain outside this feature's scope.

Files: new shared catalog, server inventory/API/tests, CosmeticsClient, asset
adapter, CosmeticsPages/CosmeticPreview, crate SVG and category directories,
catalog exporter/verifier, cosmetics/material tests and browser tool. Updated
protocol metadata, Game/WeaponView/CharacterWeapon/RemotePlayers/HomeCharacter,
UI/styles/WeaponPreviews, two existing rig tests, package test/asset scripts and
documentation. Existing assets/maps/combat rules/deployment workflow unchanged.

STOP: Shop/Locker foundation complete; future artwork, grants and functional
crates are separate tasks.

# Map overhaul: all three maps redesigned and rebuilt

Completed locally 2026-11-05. See `docs/MAP_OVERHAUL.md` for the design, shared
systems and tools. No commit, push or deployment was performed. Layouts, collision
and map revisions changed, so frontend assets and the Worker need a matching release
when authorized.

Design (footprints unchanged: Town 52 x 52 m, Industrial and City 54 x 54 m):

- **European Town:** an irregular Piazza del Pozzo around the roofed well; Borgo Alto
  raised 1.26 m with three stairs; a 2.8 m loggia; winding lanes, four covered
  passages and two arches between five courts; B37 shop/apartment with an internal
  stair, 3.22 m floor and exterior exit. `cistern_passage` is a cellar under the
  square with two dogleg entrances, about 18.5 m long, 2.3 m clear.
- **Industrial Complex:** stores hall, fenced utility yard (electrical compound /
  pump and cable store) and machine hall to the north; west yard, dispatch hall I21
  (3.22 m office, exterior exit), loading yard, 1.1 m dock and workshop yard in the
  middle; 4.5 m service roofs reached by three ladders; 2.8 m loading catwalk,
  storage yard, goods office, warehouse B and container yard to the south.
- **Modern City:** avenue and Main Street meet at a T; civic plaza and south plaza
  joined by `metro_underpass` (two straight entrances, about 14.2 m); a 2.8 m avenue
  skywalk; commerce hall C27 with internal stair, 3.22 m office and exterior exit;
  west arcade, courts, parking lot and canopied alleys.

Defects fixed at their sources (this pass, after the earlier rebuild): decals,
manholes and storm drains drawn over stairwells; glossy oil stains showing as white
blotches (roughness 0.35 -> 0.92, stains only on vehicle surfaces); hand-placed
props silently dropped by the clearance pass (City benches, cafe sets, hydrant,
second car; Industrial valve manifold, forklift, skip bin; all Town street lanterns,
upper-town benches and pots); props on circulation approaches and exit landings;
spawn S01 (Industrial) facing an exit stair 2.9 m away; a utility pole through the
north-east alley canopy; a flower pot at a stair head and a lantern on stair treads.
Earlier fixes are listed in the doc's root-cause table. Spawns facing past 180 degrees
exposed a Worker test-harness bug: `room-harness.mjs` frames (and one integration
helper) echoed the server's yaw below -pi, which protocol validation rightly rejects;
they now wrap it as the frontend does (`MultiplayerClient.ts`). Gameplay code is unchanged.

Visual review: 140 final views (Town 48, Industrial 47, City 45) in
`test-results/map-review-final`, every one inspected, plus close-up checks of each
suspect area. Graphics presets low/medium/high/ultra and Chromebook mode were
captured for 4-5 views per map (`test-results/map-review-presets`): all geometry
present, no errors, differences limited to shadows and resolution.

Measurements (headless Chrome, Intel Iris Xe, high preset; view sets follow each
layout, so they differ from the baseline's):

| Map | Load s (base -> now) | Draw calls median/max | CPU frame ms median/max |
|---|---|---|---|
| Town | 46.8 -> 25.2 | 132/185 -> 109/182 | 8.3/12.5 -> 5.1/7.3 |
| Industrial | 18.1 -> 9.2 | 100/129 -> 94/145 | 6.7/11.8 -> 4.2/6.3 |
| City | 7.6 -> 5.5 | 116/152 -> 110/162 | 4.6/7.0 -> 4.7/7.3 |

The first map in each run includes Vite transform time; frames are vsync-capped at
60 fps. Eye-level axis sightlines (props and structures block): longest
47.5/49.5/49.5 m -> 36.5/35.5/36.5 m; median per-point maximum 23.5/26.5/29.5 m ->
18.5/14.5/22.5 m. All 16 spawns per map reach each other by walking. Distinct walking
routes between spawn pairs (each new route must avoid a 2.5 m corridor around the
previous ones): pairs with three or more routes Town 89/120, Industrial 105/120,
City 92/120; median 6/5/5; minimum 1/1/2. HEAD's open ring roads scored 115-119/120
on this measure because wide parallel lanes count as separate routes.

Verification: `npm.cmd test` 598 passed, 1 skipped; Worker 68/68; protocol
gate 1/1; deployment gate 7/7; frontend and server typecheck; `npm.cmd run build`;
`npm.cmd run assets:verify` (214 materials; 13/9/8 models). The map audit has no
errors; warnings are jump-reachable prop tops, downpipes/tyres/rails without
collision and one split 0.3 m wall reported as two thin boxes. `tools/maps-test.mjs`:
loading, materials, spawns, walking, leaderboard, headshots, settings and console
checks pass; the two leak checks fail on bounded texture retention (Town +10,
Industrial +5 after the first switch, identical over four rounds). The cause is
`MaterialLibrary.prune` keeping every tile variant of an image still in use; that
rule is in HEAD and unchanged, so this is not a growing leak and was not changed here.

Limits: no new prop models (catalogue reused; cart wheel fixed). Gable roofs above
the eaves are visual-only. Some spawn pairs have fewer than three distinct routes.
Public deployment and live multiplayer validation were not performed.

# Phase 2: multiplayer room browser and custom matches

Completed and verified locally 2026-11-04. See `docs/MULTIPLAYER_ROOMS.md` for
architecture, security, local PowerShell commands, operation and deployment.
No commit, push, Cloudflare deployment or Pages deployment was performed.
Existing uncommitted Phase 1 work was preserved.

Completed:

- Home Play -> Mode Select -> actual public room or private code/create -> existing
  Loading -> weapon selection -> authoritative spawn. Play alone loads no map and
  opens no gameplay socket. Back cancels HTTP/loading work and releases membership.
  Public discovery has explicit Refresh, loading/None/error states and real counts.
  Setup uses the active name, public/private, existing three map thumbnails,
  FFA/Teams, capacity 2-10 (default 6), and private Copy Code/host room details.
  Responsive gray panels, gradient divider, small Refresh/Back buttons and scrolling
  preserve the existing background, home character, settings and weapon previews.
- Original Worker URL, ROOM/PublicRoom binding and canonical `public-main` remain.
  Each custom game is an independent `room:<UUID>` Durable Object using the same
  authoritative simulation, combat, health, collision, physics, teams, scoring,
  grenades, chat, timers, results and respawn implementation. Custom rounds keep
  the selected map/mode; original public-main retains its 600-second rotation.
  No additional hardware, namespace, account database or deployment secret.
- Canonical room directory validates creation, privacy, names, maps/modes/capacity,
  origin/body limits, profile capabilities, creation limits and code-lookup rates.
  Secure random six-digit string codes preserve zeros, retry collisions, stay
  unique while active, expire on close and have a 24-hour reuse quarantine.
  Private codes never appear in public listing responses. A 120-second, one-use,
  room/profile-bound 256-bit ticket is checked on the actual WebSocket join.
  UUID knowledge or another profile's ticket cannot bypass authorization.
  Concurrent joins serialize capacity enforcement; one profile cannot occupy two
  rooms. Briefly disconnected sessions reserve capacity during existing grace.
- Creator retains initial host authority even if a guest connects first. Departure
  transfers host deterministically to the earliest remaining connection, UUID tie
  break. Server alarms warn at 60 seconds and close at 90 if no other profile has
  joined; any guest permanently cancels that deadline. Later empty rooms close
  after 15 seconds, invalidate codes and leave discovery. Cleanup flushes rewards,
  releases leases, stops timers and returns clients to Mode Select with explanation.
  Expired reconstructed sessions release their cross-room memberships.
- Gameplay inactivity warns at 30 seconds and removes at 45. Only validated useful
  look/input changes, actual jumps/fire/reload/grenade actions or accepted chat
  refresh activity. Constant held movement, no-op input, full-mag reload and pings
  cannot keep a session alive forever. Loading, selection, mandatory death delay,
  results/unspawned lobbies use a separate five-minute idle limit. Kicks permit a
  fresh join and never retry the kicked socket. Transport state explicitly closes
  on room_exit. Switching waits for the old connection to close before opening one.
- Profiles, wallets, challenges, global statistics and rankings remain canonical.
  Custom room rewards persist in an ordered game-state transaction/outbox; the
  canonical authority commits reward cursors, challenge wallets, stats and immutable
  projection journals together. Pure staged copies prevent double challenge credit
  after failed commits; durable cursors deduplicate lost acknowledgments/restarts.
  Global completion serials plus source-qualified IDs handle independent room
  counters. Existing participation eligibility is preserved, including abandoned
  rounds after disconnect. Canonical profile views synchronize on join and reward
  acknowledgment. No HTTP/client score claims or replacement local reward system.
- Home presence aggregates connected players across logical rooms without exposing
  private metadata; custom totals cache for at most five seconds. Directory tickets,
  rate buckets and code tombstones receive bounded incremental housekeeping.
- Shared gameplay protocol is v19; statistics HTTP schema remains v2. Strict protocol
  validation and existing backend-first CI/health/SHA gates remain active. Validation
  failures are caught inside Cloudflare concurrency gates so a rejected malicious
  join cannot reset a populated game or the canonical authority.

Executed validation on the final implementation:

- Frontend: `npm.cmd test` passes **568** tests; one existing opt-in benchmark skipped.
  The default suite passed with other diagnostics idle. Parallel Chrome/backend
  diagnostics had exceeded the existing 5-second character-pose test budget; no
  assertion or timeout was weakened to obtain the final pass.
- Worker: `npm.cmd test --prefix server` passes **68** tests, including four broad
  new room integrations. Focused rooms + grenade + environment run: **7/7** pass.
  Existing FFA/Teams damage, assists, ammo, regeneration, movement, leaning, stairs,
  ladders, collision, challenges, persistence and rankings regressions pass.
- New real Worker/TCP tests cover simultaneous creation/capacity races, private
  tickets/codes/expiry/rates/secrecy, all three map settings, isolated chat/grenade
  events/timers, actual lethal shots, wallet/global points/challenges, lost reward
  ACK followed by complete runtime restart, authenticated resume without duplicate
  players, replay dedup, room switching, independent completion counters, host
  transfer, alarm-based solo/empty cleanup and AFK/no-op resistance/rejoining.
  Actual 2-, 6- and 10-client movement checks pass, including simultaneous six- and
  ten-player game instances plus a real canonical observer (17 total connections).
- Two Chrome contexts against the production `/crossfire/` build: **21/21** checks
  pass. All three selected maps reach loading readiness/weapon selection; actual
  public/private joins, no early spawn, real movement, host details/transfer,
  cancellation, AFK warning/removal and zero overlapping sockets were observed.
  No page exceptions or missing assets. AFK QA establishes a confirmed ADS press/
  release baseline because idle input is intentionally coalesced, and focuses the
  gameplay tab rather than assuming background render/input behavior.
- Additional real-browser menu checks: **6/6** pass. Ten actual canonical clients
  fill the room; discovery displays None without creating a menu player. After one
  actual Leave, Refresh displays 9/10. Compact header controls and scrolling to
  capacity/Create work at 640x480. Captured and inspected menu/setup/host screenshots.
- Real frontend/Worker protocol gate **1/1**, deployment gate **7/7**, future Node
  scaffold checks **7/7**, generated assets verification, frontend/Worker TypeScript
  and production/dry-run builds pass. Existing Vite large-chunk warning remains.
- Stabilized two existing integration setups without changing gameplay/assertions:
  grenade charge waits for its acknowledged held-frame budget as well as elapsed
  time; tiny environmental prop shots wait for settled ADS instead of random hip
  spread. Their original damage/charge/impulse assertions remain and pass.

Files created in this phase:

- `shared/rooms.ts`, `server/src/roomDirectory.ts`, `src/network/RoomClient.ts`,
  `src/ui/RoomMenus.ts`, `tests/rooms.test.ts`, `server/tests/rooms.mjs`,
  `server/tests/room-harness.mjs`, `tools/rooms-browser-test.mjs`,
  `tools/rooms-menu-browser-test.mjs`, `docs/MULTIPLAYER_ROOMS.md`.

Files updated in this phase:

- `shared/protocol.ts`, `server/src/index.ts`, `server/src/statistics.ts`,
  `server/package.json`, `server/tests/runtime-fixture.mjs`,
  `server/tests/grenades.mjs`, `server/tests/environment.mjs`, `src/game/Game.ts`,
  `src/network/MultiplayerClient.ts`, `src/network/Presence.ts`, `src/ui/UI.ts`,
  `src/styles.css`, `tests/multiplayerTransport.test.ts`, `server/README.md`,
  `docs/MULTIPLAYER_ARCHITECTURE.md`, `CLAUDE.md`, `PROGRESS.md`.

Limitations and release:

- This is local real multiplayer validation, not a live Cloudflare or WAN claim.
  Ten-player load checks are brief TCP simulations, not ten simultaneously rendered
  browser/Chromebook performance tests. Maximum registry load, prolonged authority
  outages and production CPU/billing/latency require separate monitoring/load tests.
  Deadline boundaries use aged authoritative timestamps plus real alarm execution,
  rather than sleeping through every 60/90 or 30/45-second window in CI.
- The canonical directory/reward service is intentionally a shared serialization
  point. Existing future Node scaffold remains explicitly incomplete.
- Both Worker and frontend require a matching authorized protocol-v19 release.
  Existing CI already deploys Worker first, verifies protocol/Git SHA, then Pages;
  no workflow, Worker URL, origin allowlist, binding or secret change is required.
  Never reset public-main/wallet/statistics storage to upgrade. Two services cannot
  release atomically; old tabs need to refresh across the protocol change.
- Phase 2 is complete. Stop here; no later development phase was started.

---

# Gameplay polish Phase 1: audio, assists and Chromebook Mode

Completed and verified locally 2026-11-04. See `docs/GAMEPLAY_POLISH_PHASE1.md` for
rules, configuration, local commands, limitations and release requirements.
No commit, push, Cloudflare deployment or Pages deployment was performed.

Changes:

- Removed Powerups from rotation, shared movement/health/damage rules, protocol,
  server simulation/alarms, remote rendering, HUD, standings and weapon icons.
  Deleted its procedural rendering/rules/test modules and browser diagnostic.
  No shared normal effects, texture/audio/model assets or ordinary abilities were
  deleted. Preserved wide-ground map diagnostics in `shared/navigation.ts`.
- Shared gameplay protocol is v18. Old ability fields/messages are rejected;
  health is capped at 100. FFA/Teams, 10-minute schedule, player physics, combat,
  map revisions, hosting configuration and deployment gates remain in place.
  Old stored Powerups rounds become FFA; Giant HP returns proportionally to normal,
  retired dimensions/extra jumps/burn disappear. Live identities, life, scores,
  challenge wallets and statistics are preserved; no Durable Object reset.
- Fixed remote shot presentation's live-snapshot dependency. World-space panners
  use actual visible muzzle positions with authoritative ray fallbacks and track
  the real camera, including spectating. Weapon WAVs, master/SFX controls and
  one-playback-per-combat-event semantics remain. Increased remote audibility,
  smooth inverse attenuation, bounded/faded voice tails and an SFX compressor.
  Chrome caught and regression-covered a Vector3 getter-copy bug in the new
  listener handling before completion.
- Grenade sweeps now emit throttled, validated bounce cues, without changing
  their physics, fuse or damage. Existing clink/explosion assets play spatially;
  history/snapshots cannot replay old sounds. Actual grenade self-damage and
  normal respawning were exercised by the browser test, rather than suppressed.
- All confirmed pellet rays produce subtle pooled 220ms air trails: one draw call,
  narrow gray/white geometry, bounded alpha/count, actual occlusion/range endpoints.
  Existing interpolated remote firing animations trigger 55ms muzzle flashes at
  authored muzzle anchors, inheriting weapon transforms. No added shadow lights.
- Actual server damage records victim life/round and contributor life. Eligible
  distinct assisters get exactly 50 points, one assist per death, using configurable
  ASSIST_WINDOW_MS=10000. Zero/friendly-blocked/invalid damage never qualifies;
  respawn/round/expired-session cleanup and elimination deduplication prevent stale
  awards. Authenticated resume/reconstruction retains eligible contributions.
  Live standings, frozen results and +50 ASSIST HUD distinguish assists from kills.
  Point challenges/global points include assists; kill/headshot/combo/team-kill
  rules stay unchanged. Statistics HTTP schema v2 adds lifetime assists and migrates
  old totals without clearing recorded kills/points/wins/games/gems.
- Chromebook Mode defaults off in Graphics, uses Apply/Back and existing storage.
  Derived overrides preserve the saved preset, shadows, resolution and effects;
  incompatible controls are disabled with an explanation. Half resolution,
  disabled shadows/IBL/FXAA/MSAA expansion/bloom/SSAO/sharpen, 256px non-atlas
  base copies, no normal/ORM/coat effects, reduced particles/debris/cases/lights,
  32 trail slots and reduced distant arm solves. Geometry/collision/interactive
  props/players/weapons/HUD/smoke bounds/networking are retained. A cheap ambient
  hemisphere replaces IBL. Existing mesh light lists are refreshed once so the
  weapon is lit within Babylon's four-light budget; screenshot inspection verified
  its surface shading rather than accepting a black silhouette. Disabling restores
  prior preferences and source textures. Originals remain cached, so this is not
  an initial-download or texture-memory reduction claim.
- Damage chevron is about 3x larger (responsive clamp), points front/up, rear/down,
  left/right and rotates continuously with current yaw. Existing vignette/healing
  envelope remains. Play is muted translucent blue with a darker 180ms hover;
  optional UI.onModeSelect prepares Phase 2 without replacing real Play/join.

Executed validation:

- Frontend: 559 unit tests pass; one existing opt-in performance test skipped.
- Frontend and Worker typechecks pass. Production Vite build passes (existing
  large-chunk warning); Worker dry-run build passes.
- 23 production-build Chrome checks pass with two actual browser players plus a
  real Worker socket victim, under /crossfire/. Actual damage/assist rewards,
  scoreboard, remote audio starts, bounce/explosion audio, muzzle-to-model alignment,
  trail expiry, all four damage directions/yaw/fade, settings draft/Apply/restore,
  disabled overrides, visible players, low-cost weapon lighting, Play/join and no
  runtime/missing-asset errors. Inspected screenshots in
  `test-results/gameplay-polish/`; complete recorded checks/report alongside them.
- Representative same-view workload: 311 draw calls at medium/low shadows/0.75
  scale versus 306 with Chromebook/0.5 scale; active reflection cube 256 -> 0,
  non-atlas base textures capped at 256px. Desktop/headless timing and cold shader
  compilation are not representative Chromebook FPS measurements. No claimed FPS
  gain. Actual Chromebook hardware remains untested.
- Local real-Worker focused combat passed in FFA and Teams, including all four
  weapons, lethal shotgun scoring, unchanged headshot/combo rules, two distinct
  50-point assisters, authenticated assist resume, duplicate death protection and
  frozen results. Separate real-Worker test passed configurable eligibility expiry,
  victim respawn cleanup and a complete restart with retired stored Giant/burn state.
- Dedicated scaffold typecheck/build and 7 test checks pass; deployment gate tests
  pass; generated asset verification passes. Scaffold remains an incomplete future
  host, not a migrated game server.

- Full backend suite: **64 passed**, zero failures, including real FFA/Teams
  assists, grenade/crouch scoring, all four weapons, regeneration, map rotation,
  wall/lean/stair/ladder synchronization, reconnection and complete runtime restarts.
  Legacy statistics-schema migration preserves prior totals and repairs the index.
- Real frontend transport / production Worker protocol compatibility: **1 passed**.
  Shared parsers validate both directions; mismatched versions/forged fields fail.
- Deployment gates: **7 passed**. Future dedicated scaffold: **7 passed** plus
  typecheck/build. All generated map/weapon/texture assets verified. Existing
  Miniflare environmental-fixture RPC-disposal warning and Vite large-chunk warning
  are non-failing; no checks/assertions were disabled to pass this phase.

Deployment, only when authorized: matching Worker and frontend are both required
for protocol v18/statistics v2. Use the existing backend-first GitHub Actions flow
and current credentials. ALLOWED_ORIGINS, Worker name/URL, public-main, durable
bindings/state and .env.local were preserved. No new secret/database/migration.
Two-service release is not atomic; existing v17 browser tabs must refresh.
Public Cloudflare/GitHub Pages behavior was not validated or changed here.

Next unfinished stage: Phase 2 Mode Select, when requested. Stop after Phase 1.
All older progress sections below are historical; Powerups is retired.

---

# Global leaderboards, lifetime statistics and home navigation

Completed and verified locally 2026-11-03. See `docs/GLOBAL_STATISTICS.md`.
Previous uncommitted damage/healing/collision work was preserved. No commit,
push, public Cloudflare deployment or GitHub Pages deployment was performed.

Implemented the third LEADERBOARD home-navigation option and independent 180 ms
opacity hover highlights; removed the shared sliding indicator/ResizeObserver.
Home Play and ranking controls use more transparent gray treatments. A dedicated
page preserves the existing blurred asset, clean typography, Back navigation,
exclusive DAILY/WEEKLY/ALL and KILLS/POINTS/WINS selectors (default ALL/KILLS),
compact top ten, stable tie-breaking, local highlighting, optional own rank beyond
ten and honest empty/error states. Native buttons retain keyboard focus, and
MY STATS toggles a compact translucent panel that closes outside or with Escape.
The final table is centered and the panel leaves the leaderboard behind it.
No game map or extra gameplay WebSocket is loaded by ranking navigation.

Persistent statistics reuse the existing server-issued guest capability and
canonical SQLite-backed public-main Durable Object. No new account system,
database service, binding, secret, Worker name, URL or Wrangler migration.
`statistics:<private identity>` records hold lifetime kills/deaths/points/wins/
completed games/earned gems plus daily/weekly kills/points/wins. Each has a
separate public UUID. Records and immutable projection journal entries share
the room's atomic KV save with sessions, scores and challenge/wallet state.
A revision-checked SQLite projection supplies indexed top-ten queries and owner
rank; crash/restart journal replay cannot increment totals or regress revisions.
Background drain keeps journals small. Loaded records are bounded apart from
active/dirty identities. Rankings never scan all KV profiles on each request.

Common authoritative eliminations immediately record kills, exact points including
existing bonuses, deaths and actual challenge gem deltas before match end.
Existing alive/life guards plus elimination IDs suppress duplicates. Finalized
round IDs and participation markers protect wins/completions across replay and
reconstruction. Completed-game/win eligibility preserves the conservative existing
challenge policy: spawn within the first 30 seconds, remain connected through
finalization, no abandoned round, and an actual winning result for a win. A
late/incomplete or abandoned round does not add a global win/game; prior earned
kills/deaths/points/gems remain. Existing late-join challenge rewards are unchanged.
The existing disconnect path marks the round abandoned even if the guest resumes.

Daily boundaries are 00:00 UTC; weekly boundaries Monday 00:00 UTC, shared with
challenges. Authoritative event timestamps choose buckets, queries automatically
exclude stale buckets, and lifetime totals never reset. A historical event cannot
enter a newer period. Lifetime gems earned are separate from current wallet gems.
Known existing wallet gems seed a legacy profile's historical earned total because
no spending/shop exists yet; older kills/points/deaths/wins/games were not stored
and cannot be fabricated. Those counters begin with this release. Future wallet
spending must never decrement earned gems. Clearing browser credentials or using
another device loses guest access; this is not a recoverable account system.

New HTTP APIs: validated GET /leaderboard?period=...&stat=... (public top ten,
optional authorized own row), and private GET /stats. Origin/method/parameter and
capability checks are enforced; tokens/private hashes are never in ranking output
or URLs. API schema version 1 and validators are shared. Gameplay WebSocket
protocol remains v17 with no message/schema changes. Five-second page-only polling
replaces validated data without blanking rows; selection changes abort old work,
and closing stops requests/timers. Public rankings remain usable if wallet
bootstrap fails; unavailable personal statistics are never fabricated.

My Stats displays the requested seven lifetime values. Win ratio is one decimal
percent, 0.0% with zero completions. K/D uses two decimals, 0.00 at zero kills and
zero deaths, and an em dash for positive kills with zero deaths. Current gem
balance remains the existing independent home wallet.

Executed validation:
- Frontend `npm test`: **572 passed**, one existing opt-in performance test skipped
  (56 files passed / one skipped). Includes award deduplication, UTC midnight and
  Monday rollover, stale historical events, lifetime retention, ratios, API schema
  and private-header/public-fallback client tests.
- Frontend typecheck and production `npm run build`: passed after final UI polish.
  Existing large Babylon bundle warning remains non-fatal.
- Worker typecheck and dry build: passed. Full `npm test --prefix server`:
  **62 passed**, including all previous combat/grenade/scoring/collision/powerup
  cases, strengthened real authenticated challenge/statistics cases and the new
  persistent indexed ranking test. Final focused statistics + challenge run:
  **5 passed**. Final Worker typecheck rerun: passed.
- Real workerd persistence tests cover all nine selections, more than ten profiles,
  descending sorting and UUID ties, own rank, rename without changing identity,
  duplicate awards, no credentials in results, rejected parameters/methods/origins,
  old daily/weekly buckets, lifetime retention and complete runtime restart. A
  deliberately missing SQL projection is rebuilt from a saved journal after
  restart. Final extended persistence test: **1 passed**, including an already-
  committed journal replay, legacy earned-gem migration, a simulated wallet debit
  that cannot reduce lifetime gems, and independent earned gems after restart.
  Test-only seeded profiles/events exist only in isolated local fixtures.
- Real authenticated combat verifies one actual headshot kill adds 1 kill and 150
  points before match end, the victim gains 1 death, and 1,050 actual seeded-near-
  completion challenge gems are earned once. Duplicate death replay, reconnect,
  eligible/late/abandoned rounds and persisted totals across restarts are checked.
- `npm run test:protocol`: **1 passed**, actual frontend transport/production Worker.
  `npm run test:deployment`: **7 passed**. Existing CI configuration is untouched.
- Production Pages-base Chrome QA against a local Worker: **69 checks passed**
  using two real browser clients and an actual elimination. All nine UI selections,
  exclusive selection state, defaults, local row/totals, empty wins, saved profile/
  wallet on refresh, independent hover fading, no sliding indicator, Back, stats
  toggle/outside/Escape, ratios, no added match sockets and existing challenges/
  settings rename all pass. No browser, HTTP or asset errors.
- Final screenshots of a real scored row/panel were visually inspected. Leaderboard
  and panel fit 1280x720, 960x540, 640x480 and 390x640; existing home/challenge layout
  also fits 320x568. Results/screenshots: ignored test-results/challenges/.

Feature files created: `shared/statistics.ts`, `server/src/statistics.ts`,
`server/tests/statistics.mjs`, `src/ui/LeaderboardPage.ts`,
`tests/statistics.test.ts`, `docs/GLOBAL_STATISTICS.md`.
Feature files modified: `server/src/index.ts`, `server/package.json`,
`server/tests/runtime-fixture.mjs`, `server/tests/challenges.mjs`,
`src/network/CareerClient.ts`, `src/ui/UI.ts`, `src/game/Game.ts`, `src/styles.css`,
`tests/careerClient.test.ts`, `tools/challenges-browser-test.mjs`,
`tools/home-test.mjs`, `CLAUDE.md`, and this log. Earlier collision/VFX files remain
uncommitted as they were at the start; they were not discarded or restarted.

Limitations/deployment: no pre-release unrecorded match history, account recovery,
public-host validation or massive-population load test. Own-rank indexed counting
can require more work at much larger populations; top ten remains indexed. The
future Node scaffold is still incomplete, but pure statistics rules are reusable.
When authorized, release matching Worker then GitHub Pages through the existing
backend-first CI pipeline. SQL tables/indexes initialize in-place; do not delete
or recreate the Durable Object. No new secrets, asset export or protocol bump.
Old v17 gameplay remains compatible; new statistics UI needs the new HTTP endpoints.
STOP after this feature.

# Damage/healing edge feedback and swept collision safety

Completed and verified locally 2026-11-03. See
`docs/DAMAGE_HEALING_COLLISION.md` for implementation and reproduction details.
No commit, push, deployment or public Cloudflare validation performed.

Confirmed collision causes: endpoint-only cylinder push-out could accumulate
penetration between adjacent walls; four iterations did not guarantee separation
or bound corrections to attempted movement. A controlled acute 2 cm wall seam
reproduced a full slide escape and a 0.700759 m single-tick correction. Separately,
Industrial Complex W11 reproduced a 0.207845 m correction for a 0.05875 m intended
step: the old solver ignored the bottom 0.42 m even in flight, while a narrower
70%-radius ground probe lost support beside the raised wall. Weapon endpoint
corrections could also redirect movement without validating the body path.
The exact original user's complete map-escape route was not recorded/reproduced;
these are confirmed solver defects and a controlled full escape, not a claim to
have exhaustively reproduced every reported trajectory.

Implemented shared swept circular-cylinder movement against OBB faces and rounded
corners, bounded contact sliding without outward depenetration, airborne foot
collision, consistent full-radius landing/standing headroom, and old-to-new
vertical floor/ceiling queries. Existing fixed 120 Hz simulation, high-speed
substeps, grounded stair stepping, slide timing, ladders, leaning, weapons and
powerup rules remain. Weapon envelopes now sweep movement, followed by a final
body sweep. No wall-driven gun pushback was added.

All three maps (European Town, Industrial Complex, Modern City) were audited for
finite solid transforms/positive extents, continuous ground and existing thick
closed perimeter boxes. No missing global floor or perimeter geometry was found;
no new barriers, GLB exports, map layout changes or asset replacements were made.
Secondary authoritative safety detects outside-perimeter/below-ground/invalid
state and invokes existing no-attacker death + validated respawn with its normal
cooldown. It wakes invalid idle players, logs debug-only movement_recovery, and
prevents repeated deaths/rewards. Non-finite dead motion is sanitized at a
geometry-validated spawn so protocol validation remains intact. Practice retains
its existing respawn flow.

Damage presentation now uses eight overlapping irregular blurred red patches,
a completely clear center, damage-scaled bounded strength, 75 ms attack and
550 ms release. Repeated hits interpolate from current opacity; the original
camera-relative directional arrow/math is preserved. Confirmed non-ray damage
gets no invented attacker direction. Green has a softer 90 ms attack/short release
and appears only after real same-life authoritative HP gains; spawn, new round,
Giant maximum-health changes, stale/duplicate frames and waiting for regen never
create healing. Damage cancels it immediately and maximum HP clears it. Six
pooled, input-transparent plus nodes emit about twice per second near edges,
rise 20-40 px and fade over 500-900 ms; no catch-up bursts or extra gameplay timers.

Validation:
- `npm test`: **565 passed**, one existing opt-in performance test skipped;
  55 files passed / one skipped. Final strengthened symbol cadence test: 4 passed.
- `npm test --prefix server`: **61 passed**, including scoring, grenades/crouch,
  authoritative regen/resume, powers, anti-forgery, all-map stairs/ladders and the
  new two-peer wall/recovery integration test. The final extended recovery test
  was rerun separately: **1 passed**, also validating non-finite motion recovery.
- Frontend `npm run build` (including TypeScript): passed. Worker typecheck and
  dry build: passed. Existing large Babylon bundle warning remains non-fatal.
- `npm run test:protocol`: **1 passed** with actual frontend transport/workerd.
  `npm run test:deployment`: **7 passed**. `npm run assets:verify`: all maps passed.
- Collision regressions: thin/rotated walls, rounded corners, acute seams,
  repeated direct/diagonal slides, all four guns, jump cancellation, Giant and
  double jump, high initial speed, thin floor/ceiling, all-map stress, identical
  30/60/144 Hz simulation and delayed authoritative snapshot replay. Existing
  stair-slide tests still pass both directions on all three maps/all guns.
- A longer seeded diagnostic completed **750 runs / 1,200,000 fixed ticks** across
  all maps without escape or large sideways corrections. The automated map test
  also samples continuous ground on a 1 m grid and sweeps every perimeter side.
- Chrome against the production Pages-base build and real local Worker/shooter:
  four actual damage directions, camera rotation, repeated hits, fade timing,
  actual regeneration/HUD/peer HP, damage priority, regen restart, max-HP stop,
  bounded symbols and input transparency passed with no browser/asset errors.
  Actual gradient pixels passed clear-center/direction checks; healing checks
  passed at **800x600, 1280x720 and 640x480**. Gameplay and isolated CSS-probe
  screenshots/results are under ignored `test-results/health-browser/`.
- Earlier verification failures were resolved: the old timing assertion was
  updated for the requested envelope; idle recovery now wakes the simulation;
  irregular CSS is measured across five edge samples rather than assuming the
  old uniform midpoint. No collision/score/protocol assertion was disabled.

Files: `src/physics/CollisionWorld.ts`, `src/player/PlayerController.ts`,
`shared/movementSafety.ts`, `shared/world.ts`, `server/src/index.ts`,
`src/ui/HealthFeedback.ts`, `src/ui/DamageFeedback.ts`, `src/game/Game.ts`,
`src/styles.css`, `tests/collisionSafety.test.ts`, `tests/healthFeedback.test.ts`,
`tests/damageFeedback.test.ts`, `server/tests/runtime-fixture.mjs`,
`server/tests/traversal.mjs`, `tools/damage-regeneration-test.mjs`, this log and
`docs/DAMAGE_HEALING_COLLISION.md`.

Limits/release: local tests cannot establish public Cloudflare behavior, every
possible map trajectory, every GLB triangle/normal or performance on all devices.
Rendered map assets were not manually re-inspected because no geometry changed.
Matching frontend + Worker release is required: protocol remains **v17**, while
an explicit movement revision participates in the existing map-version hash to
reject incompatible physics. Use the existing backend-first CI/Pages pipeline
only when the user authorizes publishing. No map asset rebuild is needed. STOP.

# Shotgun combat integration scoring assertion

Completed and verified locally 2026-11-03. Focused fix in
`server/tests/combat.mjs`; no production gameplay,
weapon values, scoring rules, protocol, hosting or deployment configuration changed.

Root cause: `shot()` waits for real shot events on both peers, which precede the
following authoritative snapshot. The test immediately read `me(a).score` from
its cached pre-shot snapshot, before its existing damage-snapshot wait. Shotgun
is the only lethal body hit in that four-weapon table, so only it expected 100
instead of the same zero present before and after the nonlethal shots. The server
had already eliminated the target and synchronously awarded the points.

The fix waits with the existing utility for each peer's post-shot victim-life /
health confirmation, then asserts scoring and inventory in that exact snapshot.
It does not wait for an expected score to appear: a genuinely dead target with
an absent award still fails. No new sleep or timeout was added.

Regression coverage holds the actual pre-shot client cache while recording all
real socket packets, deterministically reproducing the original stale-cache
condition in FFA and Teams. Confirmed packets must show zero HP, dead victim,
100 base points with no headshot/combo bonus, one kill/death, one grenade reward,
one matching elimination event per peer and the Teams score increment. Replaying
the already-dead transition must not duplicate points, kills, deaths or rewards.
The original assertion fails under this regression setup; the fix passes it.

Final verification, all completed:

- Focused lethal shotgun cases in FFA and Teams: **4/4 passing** including their
  parent tests. CLI filtering was used for this focused run only; the subsequent
  full suite ran unfiltered. Log: `test-results/shotgun-scoring-focused.log`.
- `npm test --prefix server`: **60/60 passing**, including the Worker dry-run
  build, all combat/grenade/Powerups/scoring tests, lifecycle, reconnect, careers,
  maps, stairs and ladders. Log: `test-results/shotgun-scoring-backend.log`.
- `npm run test:protocol`: **1/1 passing**, with another Worker dry-run build and
  the real frontend transport talking to local workerd.
  Log: `test-results/shotgun-scoring-protocol.log`.
- `node --check server/tests/combat.mjs` and `git diff --check` passed.

Only `server/tests/combat.mjs` and this progress entry changed. Protocol stays
v17. No frontend or Worker redeployment is required for this test-only fix. No
commit, push or deployment performed; stopped after verification.

# Powerups multiplayer mode

Completed locally 2026-11-03, including the final verification requested in the
follow-up. No commit, push or deployment. Rules, balance, hosting boundary and QA
commands: [docs/POWERUPS.md](docs/POWERUPS.md). Earlier uncommitted work below was
preserved; no map assets were changed for this mode.

- Added POWERUPS to subsequent random round rotation, with FFA relationships,
  scoring, results and MVP. Existing running rounds keep their persisted mode
  across releases. FFA, Teams, round timing, weapon/ammo, grenades and movement
  remain intact.
- Added server-owned, exactly-once collectible cubes and one active ability per
  life: 15-second GIANT, DOUBLE JUMP, FIRE and SHIELD. All three maps use pools
  validated against authored ground navigation, floor support, reachability,
  bounds, wide flat clearance and actual collision geometry. Spawning uses alive
  connected counts: caps 2/3/4/5 and intervals 20/15/10/10 seconds.
- Giant reserves collision clearance before growth, preserves health percentage
  at 100/150 maximum HP, scales speed/firearm damage by 1.5, and shares the
  250 ms eye transition with server firing/prediction. Hitboxes, gun clearance,
  leaning, remote character/weapon scale and safe shrinking follow the size.
  Blocked activation leaves the pickup in place, without teleporting.
- Double Jump consumes one extra airborne press, preserves horizontal momentum,
  uses sqrt(2) launch velocity for twice normal jump height, respects ceilings
  and survives replay/resume without extra charges. Uses the existing Jump action
  and customized bindings, with a confirmed remote foot burst.
- Fire uses confirmed shot traces and one elapsed-time burn cursor: 10 HP/s for
  five seconds, refreshed rather than stacked, with latest-applier ownership.
  Regeneration waits after burn damage. Burn kills award normal/combo points,
  elimination grenade rewards and appropriate challenges, including posthumous
  credit, without a headshot bonus or a live combo timer on a dead applier.
- Shield absorbs 75 points before HP, including partial overflow, burn and blast
  damage. Added a subtle remote shell/hit pulse, bounded flames, rotating/bobbing
  cubes and ground indicators, pickup notice, smooth HUD timer/bar/shield points,
  compact leaderboard ability labels and a fire kill-feed symbol.
- Death, respawn and round change clear effects. Reconnect/reconstruction retain
  absolute deadlines, remaining shield, burn cursor/owner, jump consumption,
  identity, life, ammo and score. Room alarms handle idle spawning/expiry;
  simulation runs for movement, burns and active transitions. Fixed the new
  mode's initially continuous idle tick, which interfered with hibernation.
  Normal heartbeat timeouts and intentional-leave cleanup remain tested.
- Shared protocol is now v17, with strict matching client/server validation and
  no client-granted abilities, damage, size or positions. The existing coordinated
  Worker/Pages CI remains unchanged and includes the new backend test. Shared
  pure rules and field state remain reusable by a future dedicated server.

Final checks, all completed successfully:

- Frontend: **543 passing, 1 existing opt-in performance test skipped**; production
  build including TypeScript checks passed. Logs:
  `test-results/powerups-final-frontend-tests.log` and
  `test-results/powerups-final-frontend-build.log`.
- Worker: typecheck and dry-run build passed; full suite **60/60 passing**, including
  existing FFA/Teams combat, ammunition, grenades, regeneration, maps, stairs,
  ladders, room lifecycle, careers and the new real-WebSocket Powerups test.
  Logs: `test-results/powerups-final-backend-typecheck.log` and
  `test-results/powerups-final-backend-tests.log`.
- Real frontend/Worker protocol gate **1/1**, deployment gates **7/7**, future
  dedicated transport checks/typecheck/build **7/7**, asset verification passed.
  Logs: `test-results/powerups-final-{protocol,deployment,dedicated,assets}.log`.
- An explicit POWERUPS room lifecycle run also passed **23/23** checks, including
  eviction, real missing-heartbeat disconnect, intentional leave and resume.
- Two actual Chrome clients against local workerd and the production Pages-style
  `/crossfire/` build: **33 passing checks, 11 screenshots**, 62.5 seconds of
  connected play, one intentional reconnect, no duplicate players and no
  browser/asset errors. Verified actual 15-second Giant/shield expiration, second
  jump, shield absorption, burn, synchronized movement, leaderboard, HUD and
  960x540 layout. Reviewed representative cube, Giant, shield, fire and airborne
  screenshots. Evidence: `test-results/powerups-browser/results.json` and PNGs.
- `git diff --check` passed. Temporary browser/Worker instances and the local
  static preview server were stopped.

Limits/release: validation is local; public Cloudflare and physical Chromebook
performance were not tested. Spawn balance and simple bounded cosmetic effects
are initial tuning. The dedicated Node scaffold still does not host gameplay.
Both frontend and Worker need a matching v17 release through the existing CI
when authorized; no hosting configuration or credentials were changed. STOPPED
at completion of Powerups and its checks; no further stage started.

# Major bug fixes and quality update

Completed locally 2026-11-03. Stopped after this update. No commit,
push or deployment. Detailed causes, exact changed files, screenshot observations,
QA commands, limitations and release steps: [docs/MAJOR_QUALITY_UPDATE.md](docs/MAJOR_QUALITY_UPDATE.md).

- Outward slide streaks now spend their lifetime on screen and fade without phase
  snapping. Shared collision uses legal step support and measured barrel envelopes;
  all four guns slide both ways on both interior flights and exterior stairs on
  all three maps, with wall collision, cooldown and jump behavior preserved.
- Fixed the black sniper aperture: hidden spectator/local SVGs shared IDs. A
  geometric cutout and unique gradient IDs preserve the reticle on all graphics
  modes. View-model-only near clipping and hip framing expose previously clipped
  grips/components without changing weapon assets, ADS anchors or animation timing.
- Live blurred selection uses the loaded map, actual synchronized players and
  collision-limited following; empty/unavailable targets use a landmark orbit.
  No pre-spawn life, extra connection, name-tag reveal or duplicate map scene.
- Server-owned hold/release grenade charge reaches full strength at 1.5 seconds;
  keyboard and HUD pointer controls share cancellation for menus/focus/network/life
  changes. Shared protocol v16 strictly distinguishes cancel from release. The
  server caps charge by elapsed AND simulated time; no client strength claims.
- Configurable 100 HP center / smooth 4.2 m occluded blast falloff; unchanged fuse,
  swept physics, kill/score/combo/reward transaction and inventory authority.
  Bounded cosmetic explosion roll preserves the optical aim axis. Larger fiery
  burst/ring/light, denser five-second smoke, 48 swept cosmetic rocks, 24 projected
  scorch marks and a 30% larger visible grenade (collision sphere unchanged).
- Captured/reviewed 39 map views plus four targeted prop follow-ups after an initial
  33-frame inspection. Replaced floating stair-rail segments on all maps with
  continuous supported slopes; fixed Industrial insulator cores. Regenerated
  Blender sources, affected GLBs, collision/debug exports and navigation metadata.
- Enlarged only the working damage arrow (48 to 70 px).

Validation completed:

- Frontend: **521 passed**, one existing optional performance benchmark skipped;
  frontend typecheck and production build pass. Backend typecheck and dry-run build
  pass; final full backend suite **59 passed**. Real frontend/Worker protocol gate
  **1 passed**, including held/cancel grenade frames; deployment gate **7 passed**.
  Dedicated scaffold **7 passed**; generated asset verification passes.
- Actual local Chrome + workerd: **44 grenade/loading/reconnect checks** and
  **9 selection-background checks**, with zero browser/asset errors. Rendering/input
  browser suite: **14 checks**, all four gun rigs and scope on Low/Medium/High/Ultra.
  **17 explosion renders** verify normal/reduced modes and persistent ground marks.
- Visually reviewed 39 map views plus four targeted follow-ups; initial 33-frame
  evidence and all per-view findings are in the detailed report. SVG reproduction
  confirms the hidden duplicate caused the black scope aperture.
- A fresh-press guard prevents OS key-repeat from restarting a cancelled grenade
  charge after menus/focus loss; customized binding and movement behavior tested.
- Earlier failed tuning/fixture runs and timing failures are documented, with
  resolutions and successful reruns. No assertion or protocol validation disabled.

**Release later:** matching frontend/assets and Cloudflare Worker are required
(protocol v16 plus changed map revisions), using the existing coordinated CI.
Worker identity/URL, Durable Object, origins, credentials, Vite and Pages base are
preserved. Public-server behavior has not been validated or deployed here.

# Third-person character animation pass 2

Completed locally 2026-11-03. Stopped at this request. No commit, push or deployment.
Details, measurements and limitations: [docs/CHARACTER_ANIMATION.md](docs/CHARACTER_ANIMATION.md).

- ADS fixed at the source: the weapon GLBs were already realistic at 0.85 scale (rifle
  trigger-to-butt 0.32 m); the IK target pinned the sight to the head, leaving the butt at the
  jaw. The measured butt pad now sits in a torso-frame shoulder pocket next to the lifted
  shoulder, with a bounded neck/head cheek weld. ADS trigger wrist 41-47 -> 27-31 degrees;
  ready 38-48 -> 18-34 degrees; butt 0.7-2.9 cm above the shoulder joint instead of 8-10 cm.
- Character regenerated (`npm.cmd run assets:player`): clavicle bones with shoulder blend
  weights, and three index phalanx bones per glove (+72 triangles; 9,320 total, 26 joints,
  505 KB). Clips unchanged. Shoulders shrug/protract for ADS, reach, recoil and reloads.
- Trigger finger off the trigger at rest, on the blade (6-8 mm) when aiming or shooting,
  with a pull pulse per shot; per-weapon support index (along the fore-end or wrapped).
- Third-person reloads (magazine travels to and from the vest), sniper bolt work with the
  trigger hand on the moving knob, shotgun pump with the support hand riding it, and shell
  loading from a belt pouch, all keyed to gameplay progress and cue fractions (no timing
  change), on the interpolated timeline via `presentedAction`.
- Remote recoil now plays when the delayed pose reaches each shot's server tick (3-15 ms
  after it, ~80-107 ms after the event arrives) instead of on arrival; cadence, jitter,
  stalls and no double triggering are tested. No protocol change; Worker untouched.
- Performance: top-down world-matrix refresh and allocation-light hot paths (rig ~0.13-0.18
  ms per character in Node, 29 -> 9 KB allocations per character-frame); distant players
  reuse their solve every 2nd/3rd frame (halved distances on low quality). Chrome (Iris Xe):
  6 characters 3.9 ms median frame interval; 4x CPU throttle 26 ms. No real low-end device.

Validation: typecheck; `npm test` 493 passing (perf benchmark opt-in); production build;
`assets:verify`; `inspect-character`; home preview test (all weapons, 60 fps); real
two-client `character-animation-mp-test` passed twice (19 checks incl. recoil timing,
remote reload and pump). Visual sheets: `test-results/character-poses/improved/`.
Server/shared code untouched (server dry-run build only). Frontend needs a release after an
authorized commit; the Worker does not.

# Explosion VFX, seamless loading and trusted server join chat

Completed locally 2026-11-03. Stopped at this request. No commit, push or deployment.
Implementation, complete changed-file list, QA commands and release guidance:
[docs/EXPLOSION_LOADING_CHAT.md](docs/EXPLOSION_LOADING_CHAT.md).

- Added a pooled white/yellow additive flash, layered orange/red fire with a
  brighter core, sparks, expanding transparent rings and two brief shadowless
  local lights. Four-burst cap; inactive batches are disabled and unused sprites
  have zero area. Reduced mode uses fewer lobes/sparks. Light mesh references
  are released on clear. Uses confirmed server explosion positions/timestamps.
- Preserved grenade physics, damage/radius, five-second dense smoke, two-second
  smoke fade, spatial fog/visibility, explosion history and multiplayer timing.
- Supersedes earlier early-selection behavior: Loading now remains visible until
  authoritative state/map revision, map/collision, textures/materials/shaders,
  all four weapons, character assets and all four decoded previews are ready.
  Selection sends the existing authoritative spawn request directly; no second
  loading screen/map rebuild. Controls require spawn approval. Cancellation,
  critical failure/Retry, reconnect, spectating and respawn are preserved.
- Added strict shared protocol v15 server-only system/player_joined messages.
  The Worker announces new persisted sessions once using sanitized names and
  session-derived event IDs. Resume, actual browser refresh and snapshots do not
  reannounce. The frontend has bounded event dedupe, gray chat rows and a small
  loading-time feed queue. Player chat cannot forge system frames; a player
  named Server is labeled Server (player). Existing chat limits/rate checks stay.

Validation completed:

- Plain `npm test`: **481 passing / 46 files**. Frontend typecheck and final
  production build pass. Focused VFX/protocol/cleanup rerun: **7 passing**.
- Cloudflare typecheck and dry-run build pass. Full backend rerun: **59 passing**,
  including FFA/Teams grenade damage, scoring, regeneration, traversal and resume.
- Actual frontend/Worker protocol gate: **1 passing**, including sanitized joins,
  new-transport persisted resume, no duplicate announcements, strict schemas,
  incompatible versions and forged system-message rejection.
- Deployment gate tests: **7 passing**. Dedicated scaffold typecheck/build/tests:
  **7 passing**. Existing CI/Worker configuration, URLs, secrets, origins,
  Durable Objects and map revisions unchanged.
- Production build served under `/crossfire/`, two real Chrome contexts + local
  workerd: **18 focused delayed-load/reconnect/refresh/chat checks** and **16
  texture-failure/Retry/refresh/chat checks**, both with zero browser/asset errors.
- Normal non-autoplay UI: **28 checks**, including all four manual weapon choices,
  one connection/spawn per entry, Back cancellation, partial-magazine reload,
  persistent bindings and Controls at three resolutions. Its existing scroll
  assertion now waits for actual browser scrolling instead of assuming 220ms.
- Extended first-frame-capture browser grenade run: **38 checks**, zero browser/
  asset errors. Verified actual damage/100-point award, local statistics, feed,
  leaderboard, audio, smoke timing, inventory, resume dedupe and respawn.
- **16 deterministic Babylon renders** across eight ages and normal/reduced modes;
  inspected actual flash/fire/ring/sparks/smoke images and the production game's
  confirmed grenade explosion render. `test-results/explosion-renders/` and
  `test-results/explosion-loading-capture/explosion.png` contain the captures.
- Initial concurrent/cold local runs had frontend timeouts, a backend healing
  timing-window failure, and an unpaused browser local-statistics timeout at
  roughly 2 FPS. Final default frontend/full backend runs passed unchanged;
  the same browser statistics assertions passed with first-frame capture.
  No health/scoring logic or assertions were relaxed to make them pass.

Limitations/release: local testing only; public Cloudflare was not contacted or
updated. Fixed resource budgets and reduced mode were tested; no low-end-device
FPS benchmark was performed. Requires coordinated frontend + Worker deployment
for v15 through the existing CI health/version/revision gate. Two-service releases
are not atomic; already-open older clients must refresh. No deployment performed.

---

# Daily/weekly challenges, durable guest gems and home polish

Completed locally 2026-11-03. Stopped at this request. No commit, push or deployment.
Full behavior, changed-file list, QA commands, eligibility and guest limitations:
[docs/CHALLENGES.md](docs/CHALLENGES.md).

- Added exactly three stable randomized daily and weekly objectives from a
  shared configurable library. Selections prefer different families and survive
  refresh/reconnect. Daily reset: 00:00 UTC; weekly: Monday 00:00 UTC.
- Server-confirmed eliminations advance appropriate weapon/headshot/total-kill
  and actual point objectives. Frozen round results supply wins/MVP/completion.
  No client claims, practice damage, assists or nonlethal rewards. Disconnects
  disqualify that round's result objectives; complete-match objectives also
  require the first spawn within 30 seconds of round start. Existing gameplay
  scoring/results are preserved. See the documented conservative eligibility.
- Automatic once-only 100-gem daily / 250-gem weekly rewards (300/750 maximum
  for active periods); simultaneous completions sum correctly. Completed cards
  remain until reset. Balance carries forward. Late previous-period events
  cannot roll current periods backwards.
- Added server-minted 256-bit browser-held guest credentials, hashed on the
  server, separate from editable names/local guest UUIDs and match resume tokens.
  Wallets and challenge records persist in the existing Durable Object independently
  of room sessions. Atomic batch puts include gameplay and dirty career state;
  private owner-only updates are sent after persistence. Completion markers and
  result round IDs prevent duplicate awards after replay/restart. Bounded caches
  and dirty write versions avoid rewriting historical wallets every tick.
- Added allowlisted no-store /profile HTTP bootstrap/read endpoints and private
  v14 career frames; validated optional credential on join. Profile access never
  creates a match player. Unknown credentials/forged balances are rejected.
  Credential-scoped match resume prevents accidental cross-profile reuse;
  simultaneous sessions for one persistent guest are refused.
- Home: Daily/Weekly keyboard tabs, precise animated progress, retained completed
  and received states, UTC countdown anchored to monotonic server time, original
  shared SVG gem icon, white top-right name/balance, compact transitions and
  reduced-motion support. Brighter existing background and shorter upper shade.
  Responsive panel/character placement; short screens scroll the challenge list
  while keeping tabs/reset/Play accessible. Account display sits above the shade.
- Preserved settings/profile rename, character rig/weapon/framing/fade, maps,
  combat, graphics presets, existing Cloudflare binding/origins and coordinated
  CI. Existing browser QA redirects /profile to its actual local Worker too.

Verified:

- 475 frontend tests / 45 files; frontend TypeScript and production build passed.
- Server generated types/TypeScript and dry-run build passed; clean full backend
  suite 59/59, including four new durable challenge/combat/result scenarios.
- Real frontend/Worker protocol compatibility passed. Deployment gate tests 7/7.
  Dedicated scaffold typecheck/build/tests 7/7; scaffold remains incomplete.
- 37 production-build Chrome/local workerd browser checks: exact card counts,
  tab switching and keyboard navigation, actual zero initial balance, no home
  WebSocket, account rename, reset countdown unaffected by browser clock edits,
  1280x720/900x600/640x480/390x640/320x568 fit/no Play/title overlap and every card
  accessible, actual two-client elimination completing explicitly seeded nearly
  finished objectives, owner-only 1,050 reward sync, retained completed cards,
  weekly rewards, full refresh persistence and no credential reroll. No browser,
  HTTP or asset failures. Inspected desktop/mobile and completed screenshots.
- Unit coverage: every definition, UTC/Monday/year boundaries, period resets,
  safe delayed events, caps, simultaneous/idempotent rewards, schema rejection,
  temporary storage, request coalescing, monotonic countdown and stale responses.
  Worker coverage: unauthorized/duplicate/wrong-profile join rejection, forged
  currency rejection, nonlethal damage, headshot rewards, private views, restart,
  repeated round wakeups, resets and late/abandoned eligibility.
- One full backend run under concurrent Chrome load hit existing apple-hit and
  slide-producer timing failures; the isolated clean full rerun passed all 59.
  No movement or prop rules/assertions were weakened.

Limits/release: browser-held guest capability, not a recoverable account. Clearing
site data/loss of credential loses access; storage-blocked guests are temporary.
No cross-device login/recovery/rotation, shop or spending API. Stronger accounts
and abuse controls are needed before purchased/value-bearing currency. Legacy
pre-v14 unscoped match resume tokens do not migrate automatically into new wallets.
Public Cloudflare and low-end performance were not tested. Both frontend and
Worker require matching v14 deployment through existing CI after an authorized
commit/push; no new secrets, bindings or migrations. Existing tabs may need refresh.
Nothing was committed, pushed or deployed.

---

# Character rigging, weapon holds and smooth multiplayer animation

Completed locally 2026-11-03, preserving the uncommitted grenade/loading work below.
Stopped at this request. No commit, push or deployment. Details, root cause and
limitations: [docs/CHARACTER_ANIMATION.md](docs/CHARACTER_ANIMATION.md).

- Root cause: no sphere hands existed. Remote players used `BoneIKController` (wrist planted
  in the grip, A-pose hand roll, fixed poles); the home preview had a separate solver with
  an assumed hand-back constant; gloves had a relaxed curl; grip anchors are surface
  contact points, not handle centres.
- Regenerated the character with gripping fingers/opposed thumb (same counts).
- One shared rig for remote players and home: bind-pose-derived hinged two-bone IK, hands
  turning about the handle axis, per-weapon ready/ADS holds with measured handle offsets,
  bladed torso, head-anchored ADS cheek weld, look-pitch distribution, overreach safety.
- Time-based layers: eased per-clip crossfades (crouch 0.19 s), third-order ADS (~150 ms),
  per-weapon recoil from each server `ShotResult`, landing dip, breathing sway. ADS intent
  from synchronized `aimHeld` + action. No protocol, server or gameplay changes.
- Off-screen avatars skip IK. Lab hook `__crossfire.characterLab` and tools
  `character-pose-lab.mjs` / `character-animation-mp-test.mjs`. Fixed the stale six-clip
  list in `inspect-character.mjs`.

Verified: typecheck; 421 tests / 43 files; production build; `assets:verify`;
`inspect-character.mjs`; home preview test (4 weapons, 60 fps); real two-client
Chrome/local Durable Object animation test (all checks, 10 shots = 10 recoil impulses);
server suite 55/55 (server/shared untouched; one run under Vite+Chrome load timed out in
the existing "shot moves apple" prop test, which passed alone and in a clean full rerun). Visual passes: three lab refinement passes (full body, grip
close-ups, motion/look states) for all four weapons, plus in-map observer screenshots.

Limits: baked fingers (no finger bones/trigger motion), no clavicle, short third-person
stocks leave ~45 deg trigger-wrist deviation and a jaw-level cheek weld, no third-person
reload/pump hand motion. Frontend release needed after an authorized commit; Worker
unchanged.

---

# Grenade rewards, persistent smoke, readiness and relative team colors

Completed locally 2026-11-03. Stopped at this request. No commit, push or deployment.
Implementation, complete changed-file list, QA commands and limitations:
[docs/GRENADE_LOADING_TEAM_COLORS.md](docs/GRENADE_LOADING_TEAM_COLORS.md).

- Server-confirmed credited eliminations now award exactly one grenade in the
  existing guarded kill/score transaction. Includes firearm, multi-kill and
  posthumous grenade kills. Nonlethal hits and duplicate deaths cannot reward.
  Earned inventory can exceed one; respawn/round resets remain unchanged.
- Live local elimination events show a +1 above the grenade HUD, rising 26 px
  and fading over 800 ms. Four separated lanes handle rapid awards. Ordinary
  inventory snapshots and reconnects do not replay the animation.
- Larger flash, burst/debris and trailing smoke, plus an expanding cloud dense
  for five seconds with a two-second fade. Server timestamps/history restore
  current smoke age after loading/reconnect. Spatial billboards and blended
  depth fog limit inside visibility; smoke also obscures tags/outlines.
  Fixed pools cap effects at 128 transient particles and 12 x 32 cloud particles.
  A persisted reduced-effects setting and automatic Low reduction preserve
  smoke duration/concealment while reducing particles.
- Critical loading explicitly waits for map/weapon textures, GLB-contained
  textures, collision, immediate character assets and practical hidden-mesh
  shader variants, in addition to the existing connection/snapshot/revision
  checks. Early gun selection remains available, then waits behind loading
  until spawn is safe. Real stage labels, cancellation, asset-specific errors,
  Retry/Back and cached-asset reuse are preserved. Incomplete worlds are covered.
- One client-side perspective mapper drives HUD scores, leaderboard, results,
  winner/MVP, feed, tags and outlines. Local team appears blue regardless of its
  server ID; opponents are red. FFA colors only self blue. No membership,
  scoring, spawn or map revision changes.
- Protocol v13 expands the actual grenade-count schema from 0..1 to a
  nonnegative safe integer. No additional message fields. Updated QA clients
  read the shared version instead of copying literals. Existing coordinated
  Cloudflare/Pages deployment, credentials, origins and dedicated scaffold stay.

Verified:

- Frontend: 416 tests / 43 files; TypeScript and production build passed.
- Cloudflare: generated types/TypeScript, dry-run build and all 55 checks passed.
- Actual frontend/Worker protocol integration, all 7 release gate tests, and
  dedicated scaffold typecheck/build/all 7 checks passed.
- Real Chrome/local workerd FFA and Teams sessions: delayed gun GLB, texture
  and map geometry block spawning; HTTP 503 texture failure identifies the
  asset, covers the world and successfully retries; smoke synchronizes, stays
  dense/fades/expires, restores on resume, and does not replay reward/sound.
- Three-client FFA explosion: two actual kills, two separated +1 animations,
  accepted inventory two, correct 220-point combo and no duplicate rewards.
- Actual red-team client: own blue score, opponent red feed, correct defeat,
  relative results groups and opponent MVP. Inspected loading/error, smoke
  inside/outside, multi-kill HUD and completed results screenshots locally.
- Corrected an existing traversal-test race: normal neutral input now settles
  held movement before exact reconnect-position comparison. Server movement
  rules and the exact comparison were preserved. Full backend rerun passed.

Limits/deployment: local Chrome/workerd validation only; no public Cloudflare
or low-end device testing. Smoke is bounded billboards/local depth fog, not a
fluid simulation, and oldest clouds are culled beyond 12. Existing bundle-size
warning remains. Both frontend and Worker require the matching v13 release via
existing CI after an authorized commit/push; existing tabs must refresh. No new
secrets or configuration are needed. Nothing was deployed.

---

# Gameplay Phase 4: interactive props and physics polish

Completed locally 2026-11-02, preserving all uncommitted Phases 1–3 below.
No later phase started. No commit, push or deployment performed.
Details and deployment steps: [docs/PHYSICS_POLISH_PHASE4.md](docs/PHYSICS_POLISH_PHASE4.md).

Inspection found an existing room-owned decorative simulation, server ray-based
impulses, shared swept collision, instanced Blender props and sleeping 10 Hz
changed-pose synchronization. Extended these systems without adding a physics
engine or changing competitive gameplay.

Implemented:

- Nine individually interactive fruits (six apples/three pears), with varied
  orientations and cluster densities. A four-apple pile rests on three separated
  bottom fruits; other fruit sits on the floors. Removed the static third-bin
  fruit. Analytic support and non-overlap checks prevent floating starting poses.
- Closed tapered wooden bins sit on the counter. Meshes/definitions share the
  produce author. Decorative sphere collision uses finite sloped inside/outside
  contacts, floor/rim support and upward rebounds. Players/bullets keep a shared
  conservative shell; grenade collision retains its original defaults.
- Fivefold firearm impulses before an 8 m/s cap, 120 Hz bounded substeps,
  continuous world sweeps, mass-weighted neighbour transfers, spin, damping and
  supported-body sleeping. Static walls block high-speed props; contact position
  corrections respect world geometry. Small crates/barrels react more visibly.
- Existing sign top-edge hinges now have stronger impulses and less damping,
  returning to rest within the unchanged 0.30 radian limit. Fixed a diagonal
  bracket passing through the sign board by moving it above the projecting arm.
- One hanging lamp per enclosed map interior, with fixed ceiling plate and a
  moving chain/cage. Its short-range point light follows the actual pose without
  dynamic shadows. Corrected near-axial hits so tiny weapon spread cannot swallow
  the stronger front-facing impulse. Other fixtures remain static.
- Town uses 11 bodies/two signs/one lamp (14 states); other maps two bodies/one
  lamp. Retained the original 14-state wire budget, strict v12 fields, validated
  server-only impulses, 10 Hz changed poses and no continuing asleep traffic.
- Durable decorative poses now include the map revision. Matching revisions
  restore moved objects; legacy/revised geometry resets only decorations to
  supported starts, preserving environment sequence and all player/combat state.
  This prevents the old higher bin-floor positions floating after publication.
- Regenerated prop/map GLBs, environment definitions, editable Blender sources
  and manifests. Preserved existing material textures, graphics and multiplayer
  hosting configuration, including .env.local and the GitHub Pages base path.

Verification:

- Final frontend suite: **407 tests / 42 files passed**, including 12 physics
  polish cases. Covered force/displacement, bounded wall and tapered-bin contact,
  upward rebounds, supported fruit, neighbour transfer/sleep, hinge/light motion,
  near-axial hits, bracket clearance and unchanged wire budget. Existing crosshair,
  weapon, graphics/material, map/stair/door/thickness and combat checks passed.
- Full backend suite: **55 checks passed**. After final tuning/persistence work,
  reran the **22 public-room integration checks** and expanded environmental test
  successfully. Two real WebSocket peers verified apples/pears, signs/lamps,
  matching poses, quiet traffic, reconnect, rejection of forged forces, round
  cleanup and two complete persisted runtime reconstructions. Matching revision
  preserved moved props; stale revision reset decorations without player resets.
- Frontend typecheck/production build, backend typecheck/dry-run build, real
  frontend/Worker protocol compatibility and all generated-asset checks passed.
  Existing Vite bundle-size advisory remains. Miniflare emits non-fatal RPC stub
  disposal notices in local runtime tests; no test failures remain.
- Real production-base-path Chrome checks passed: **28 controls/weapon-joining
  checks**, **31 High/Ultra checks**, grenade/crouch/G/R/explosion/scoring/respawn
  checks, and the two-browser environmental harness across all maps plus practice.
  Inspected close fruit, rest/swing sign and light views, and the final corrected
  bracket render. Verified rendered/server pose convergence, preserved moved fruit
  on reconnect and actual light-source following without dynamic shadows. No
  browser/shader/asset errors. Captures/logs remain in ignored test-results/.

Limitations: simple decorative sphere/ellipsoid proxies and bounded hinges, not
general rigid-body physics. Local validation is not public Cloudflare validation
or a low-end-device/six-human benchmark. Both frontend/assets and Worker require
matching publication using the existing coordinated workflow when authorized;
see the linked deployment notes. Protocol remains v12. Stopped after Phase 4.

# Gameplay Phase 3: map realism, enclosed interiors and connected circulation

Completed locally 2026-11-02, preserving the uncommitted Phase 1 and Phase 2
changes below. No later phase started. No commit, push or deployment performed.
Implementation/reproduction notes: [docs/MAP_REALISM_PHASE3.md](docs/MAP_REALISM_PHASE3.md).

Inspected all three layouts, Blender authors, exported GLBs, generated collision,
tactical/navigation data and Worker world definitions. Existing compact maps
already had ground loops and external two-ended galleries, but lacked enclosed
two-storey buildings with internal turning stairs. Existing solid facade skins,
arches, pipe normals, Industrial roof ladders, landmarks and textures were retained.

Implemented:

- Town B25: enclosed provisions shop/apartment, through ground aisle, internal
  return stairs, upstairs work/storage area and independent west garden exit.
- Industrial I37: enclosed dispatch warehouse/office, four ground connections,
  internal return stairs, upstairs storage and west loading-lane egress. Raised
  the existing canopy above the upper doorway and cleared storage from stairs.
- City C28: enclosed commercial interior with north/south/arcade connections,
  internal return stairs and east upper exit. Aligned the arcade with the aisle,
  widened its approach, and offset the long north street with attached service
  enclosures that preserve alternate paths and medium/long views.
- Each building uses 30 cm walls, a floor, 22 cm upper slab, ceiling, glazing,
  2.1 m ground doors, turning landing and supported external egress stairs.
  Upper floors are 3.22 m high, preserving standing/long-weapon stair clearance.
  Added wall-mounted shelves, storage, counters and short-range practical lights.
- Moved affected benches, pallets, a planter and utility cabinet away from routes
  and onto their actual supporting floors. Shortened the Town garden wall at the
  external stair foot. Retained existing cover and the remaining route network.
- One Blender solid-parts author drives GLBs and server collision. Updated
  tactical blockers, clear route annotations and spawn placement from the new
  geometry. Regenerated map GLBs, collision/debug assets, editable .blend sources
  and manifests. Shared protocol stays v12; existing map hashes update naturally.

Verification:

- Frontend: **395 tests / 41 files passed**, including 15 new checks for both-way
  interior traversal with no weapon/rifle/sniper, wall depth, supported props,
  fixtures, longer sightlines and matching Worker revisions. Existing full-map
  flood fill, spawn access, route loops, doorway/gallery/stair/bench clearance,
  tactical accuracy, mesh overlap and deterministic collision checks passed.
- Backend: **55 checks passed** in real local workerd. Added two real WebSocket
  peers traversing every new interior with a sniper, synchronizing movement and
  resuming upstairs without duplicate players or resetting health/life/weapon/
  kills. Reran that check successfully after the final shelf placement change.
- Frontend typecheck/production build, backend typecheck/dry-run build, real
  frontend/Worker protocol compatibility and all generated-asset checks passed.
  The existing Vite bundle-size advisory remains.
- Visually inspected collision-derived top-down plans for all maps and **18 local
  Chrome views** of entrances, stairs, turns, upper exits, streets and work areas
  under Ultra. Fixed shelves initially crossing a window, then inspected the
  final wall-mounted arrangements. No missing materials/assets or browser/shader
  errors. Plans are in docs/map-realism/; captures/logs in ignored test-results/.

Limitations: these are local checks, not public Cloudflare validation or a
six-human competitive balance/performance benchmark. Publishing requires
matching frontend/assets and Worker map revisions; hosting settings are unchanged.
Stopped after Phase 3.

# Gameplay Phase 2: optional Ultra graphics and realistic materials

Completed locally 2026-11-02, continuing the uncommitted Phase 1 work below.
No subsequent phase started; no commit, push or deployment performed.

Inspection found Low / Medium / High presets (no Extreme in this checkout),
shared PBR materials, ACES tone mapping, per-map HDR image-based lighting,
packed ORM and normal maps, batching, optional SSAO and independent shadows.
Audited all 173 GLBs: map/weapon material names resolve through the authored
registry; the three character materials intentionally retain embedded skins.
Existing GLBs, base textures, normal-map orientation, skins, lighting exposure,
sun settings, shadow choices and all lower preset definitions were preserved.

Implemented:

- Ultra is an explicit highest graphics option, including Settings and the
  developer `quality=ultra` query. It persists through the existing settings
  store. Medium remains the default; no hardware detection enables Ultra.
- Ultra corrects ORM roughness: Babylon's default alpha flag was overriding
  the intended green channel. It also corrects metal props that borrowed a
  nearly dielectric blue channel: the existing `gun_metal_orm.png` contains the
  same AO/roughness data with white metallic, allowing authored metal factors
  to apply. No texture or GLB replacement needed. Low/Medium/High retain their
  previous material appearance when switching back.
- Material refinements are selective: preserve dielectric masonry, wood and
  fabric; dielectric glass with original transparency; modest clear coat on
  painted steel/containers and a stronger finish on car paint. Metal and gun
  roughness now uses the authored variation. Specular anti-aliasing reduces
  shimmering while moving. Stone, cloth, wood and rubber get no clear coat.
- Ultra lazily prefilters one cached 512px HDR cube per map, replacing the
  original 256px cube only after readiness. The URL includes `?ibl=512` because
  Babylon's HDR cache otherwise ignores requested dimensions. Sky/sun rotation
  stays aligned. Rapid preset changes cannot install a late Ultra cube after
  returning to Low; map disposal releases pending work after it settles.
  The ordinary environment remains available if the optional upgrade fails.
- Ultra uses 16x requested anisotropy, 20-sample half-resolution SSAO with
  reduced strength and lower bloom weight. Geometry batching, shadow settings,
  resolution scale and exposure are unchanged. No reflection probes, SSR,
  real-time GI or per-frame cube rendering added. Materials update in place,
  including first-person and remote weapon meshes using the shared library.

Verification:

- `npm.cmd test`: **380 tests passed / 40 files**. New tests cover settings
  persistence, default opt-in behavior, actual PBR channel flags, selective
  finishes, corrected metal maps, reversible settings, tint sharing and
  preservation of base/normal textures, weapon colors and glass alpha.
- Frontend typecheck and production build passed. The existing large-bundle
  advisory remains; no new dependency or generated asset was introduced.
- `tools/ultra-graphics-test.mjs` passed **31 checks** in real local Chrome
  against the production build served under `/crossfire/`. High/Ultra screenshots
  of all three maps, stone/wood, glass, industrial props, a town interior and all
  four weapons were visually inspected. Checks cover 256/512 actual dimensions,
  identical texture/color/alpha assignments, exposure, live switching, cached
  resources, sliding/ADS/firing, real Settings selection, refresh persistence
  and map replacement during pending prefilter work. No shader, asset-loading
  or browser exceptions. The harness accepts the existing leave-match dialog
  during its refresh test; the game's confirmation behavior was not changed.
- After warm-up, six preset changes left identical resource counts (273 meshes,
  107 materials, 124 textures in the sampled City scene). High/Ultra had the same
  geometry draw calls: Town 92, Industrial 68, City 112. Both stayed about 60 FPS
  in the sampled stationary views at 1280x720, resolution scale .8 and Medium
  shadows on this machine. Scene-processing medians were High/Ultra respectively:
  Town 3.45/3.61ms, Industrial 2.58/2.65ms, City 3.37/3.15ms. These are local,
  vsync-limited CPU/frame observations, not a GPU benchmark or low-end guarantee.

Limitations: reflection content is the static HDR environment, so nearby walls
and players are not dynamically mirrored. Authored opaque facade glazing stays
opaque; existing transparent lenses keep their alpha. The original stylized
geometry remains. First use can briefly hitch while shaders/cube filtering warm
up; cached switching adds no repeating reflection workload. Ultra's extra cube
is retained until map disposal, and is never allocated unless Ultra is chosen.
No public-hosted or Chromebook performance validation was performed.

Phase 2 files: `src/config/settings.ts`, `src/main.ts`, `src/ui/UI.ts`,
`src/rendering/quality.ts`, `src/rendering/MaterialLibrary.ts`,
`src/rendering/Environment.ts`, `src/rendering/PostFX.ts`, `src/game/Game.ts`
(preset application and read-only graphics diagnostics), `tests/settings.test.ts`,
`tests/materialQuality.test.ts`, `tools/ultra-graphics-test.mjs`, and this log.
Evidence: `test-results/ultra-graphics/results.json` and comparison screenshots.
Reproduce after `npm.cmd run build` with
`node tools/serve-dist.mjs --port 4200 --base /crossfire/`, then
`node tools/ultra-graphics-test.mjs http://127.0.0.1:4200/crossfire/`.

Phase 2 is frontend-only: no Cloudflare, shared protocol, multiplayer or gameplay
changes. Protocol remains v12. Earlier Phase 1 changes remain intact and still
require a coordinated frontend/Worker release when authorized. Stopped after
Phase 2.

---

# Gameplay Phase 1: controls, UI and weapon selection

Completed locally 2026-11-02. This is the new gameplay-controls phase, separate
from the historical numbered updates below. No later phase was started.

- Controls is a separate Settings tab using the existing draft, category
  navigation, persistence, per-action reset and Reset controls. Panels scroll
  independently; Settings heading, tabs and Apply/Back stay outside the scroll
  region. Small-screen pause and home settings keep every binding accessible.
  Gameplay input remains disabled in settings, and the canvas wheel handler
  also respects already-handled events.
- Factory defaults are R reload / G grenade, with J fire / K aim as keyboard
  alternatives to mouse buttons. Only the complete former factory binding map
  migrates automatically; customized layouts, including custom R grenade, stay
  intact. Older layouts missing grenade choose an unused key starting with G.
  Existing partial-magazine reload rules, durations and authoritative ammunition
  remain. Browser testing found quick taps could be lost because the server
  received only held keys; reload/grenade press edges now reach one input tick.
- Shared authoritative grenade launch speed increased 7.8 -> 15.6 m/s. Fuse,
  gravity, continuous swept collisions, inventory, damage (100) and radius
  (1.8 m) are unchanged. Range comparisons cover three common throw angles and
  thin-wall tests retain speeds above the new launch speed. Flash, smoke and
  debris scale by sqrt(10) for approximately tenfold apparent area; the existing
  128-particle batch, short lifetimes and smooth fade stay bounded.
- Crosshair expansion and recovery use frame-rate-independent exponential
  damping and fractional pixel gaps. This is cosmetic: accuracy, weapon spread
  and shot direction are unchanged.
- A connected, unspawned session immediately opens the four loadout cards while
  assets load in parallel. Selecting a card waits for that same map load if
  necessary, then requests the existing server-approved spawn directly. There
  is no extra Spawn confirmation. Busy cards prevent duplicate requests; Back
  can cancel joining/loading. Server round/spawn restrictions, locked loadouts,
  reconnect and spectating/respawn weapon selection remain in place.
- Weapon cards are borderless translucent gray with eased hover scaling and a
  distinct blue selection. Reserved image space prevents label jumps as previews
  arrive. Shared buttons use consistent typography, 6px radii, translucency,
  easing, keyboard focus and disabled states; primary actions are blue, leave
  actions red and secondary actions neutral. The existing home navigation bars,
  background and character preview are preserved.

Verification:

- Frontend/shared: **374 tests passed** across 39 files; frontend typecheck and
  production build passed (the existing large-bundle warning remains).
- Cloudflare backend: typecheck, dry-run build and **54 checks passed**, including
  combat/reload, grenades/score, crouch, health, reconnect, respawn, environmental
  props, movement and traversal. Real frontend/Worker protocol compatibility
  passed; all **7 deployment tests passed**. Protocol stays **v12**; no schemas,
  Cloudflare configuration, deployment workflow or credentials changed.
- Production build served at `/crossfire/`: **28 real Chrome UI checks passed**,
  covering 1280x720 / 640x480 / 390x640 home settings, small-screen pause settings,
  independent scrolling, reset/rebind, cancellation during loading, quick-tap R
  partial reload, and all four one-request/one-connection weapon selections.
  Screenshots were visually inspected under `test-results/gameplay-phase1/`.
- Two simultaneous Chrome clients against the local Worker passed crouch,
  quick-tap G throw, enlarged flash/bounded effects, actual damage and scoring,
  kill feed/leaderboard, reconnect without restocking or duplicate players,
  respawn and cleanup. No browser exceptions or asset failures. Evidence:
  `test-results/update-phase3/results.json` and screenshots. These are local
  results, not public Cloudflare/GitHub Pages validation.

Relevant files: `src/config/keybindings.ts`, `src/core/Input.ts`,
`src/game/Game.ts`, `src/ui/UI.ts`, `src/ui/CrosshairMotion.ts`,
`src/ui/RoundResults.ts`, `src/styles.css`, `src/weapons/GrenadeView.ts`,
`shared/grenades.ts`, keybinding/grenade/crosshair tests, and the two browser tools.
Reproduce browser checks after frontend/server builds with
`node tools/serve-dist.mjs --port 4200 --base /crossfire/`, then
`node tools/gameplay-phase1-test.mjs http://127.0.0.1:4200/crossfire/` and
`node tools/update-phase3-test.mjs http://127.0.0.1:4200/crossfire/ --capture-fx`.

Both frontend and Worker need a future coordinated release for the new shared
grenade tuning. No commit, push or deployment performed. Stopped after Phase 1.

---

# Grenade scoring test: delayed peer snapshot

Updated 2026-11-02. The backend integration step failed in
[GitHub run 41494601814](https://github.com/Goofykings/Crossfire/actions/runs/41494601814).
The reported `Cannot read properties of null (reading 'award')` is a test race:
the old FFA test waited for shooter A's kill count and victim B's death, then
immediately read `self(c).death.award`. Client C's independent WebSocket could
still hold its prior snapshot, where `death` was null. The exception reads
`award` from a null **death**, not `total` from a null award.

Reproduced the same exception deterministically by holding client C's actual
death snapshots in the test fixture. The server's real elimination transaction
already calculates, persists and publishes the awards. The fixed test checks
both victims and the shooter in one authoritative snapshot, verifies C can
still be stale, releases the captured real snapshot, and waits for C to receive
the same death and award. It asserts the two FFA awards are 100 and 120 points,
both have 100 base / zero headshot points, one has the 20-point combo, and
there are no duplicate explosion, damage, death, score or kill-feed events.
Teams, posthumous scoring, crouch, inventory, reconnect and respawn checks remain.

Verification: both grenade/crouch tests passed; the complete backend suite
passed **54 checks**. Five relevant frontend/shared suites passed **64 tests**;
production build/typecheck passed. Two local Chrome clients against the local
Worker and production build at `/crossfire/` verified the actual grenade kill
feed, leaderboard score/kills, match stats, effects, resume and respawn. These
are local results; the remote GitHub workflow was not rerun.

Changed `server/tests/grenades.mjs`, `tools/update-phase3-test.mjs` and this log.
No gameplay/server implementation, protocol, deployment workflow, credentials
or physics changed. This test-only fix needs no gameplay redeployment; a later
push to main will trigger the existing coordinated deployment normally. No
commit, push or deployment was performed.

---

# CI follow-up - distinguish tests from missing deployment credentials

Updated 2026-11-02. Inspected
[run 41493458383](https://github.com/Goofykings/Crossfire/actions/runs/41493458383)
for commit f6a081d. It failed at the release branch/credential preflight; npm
installation and unit tests were skipped. The push was on main, and the
credential-check script is present in the commit. All **367 tests** passed
locally. The external configuration check must still be satisfied by setting
the required repository secrets; no secret values were requested or logged.

- Moved Cloudflare credential validation after tests/build/artifact staging and
  before either production service is changed. Missing deployment credentials
  no longer prevent running npm test; they still block both deployments.
- Preflight errors now emit escaped GitHub `::error::` annotations so missing
  secret names and setup instructions appear on the Actions summary.
- Added an actual CLI regression test for nonzero status, actionable annotation
  and no token leakage. All **7 deployment tests** and actionlint passed.
- Updated deployment documentation. Owner must add/confirm repository secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` under repository Settings >
  Secrets and variables > Actions, not only the github-pages environment.

Files changed: `.github/workflows/deploy.yml`, `tools/prepare-release.mjs`,
`tools/tests/release.test.mjs`, `docs/DEPLOYMENT.md` and this log. No gameplay,
protocol, commit, push, deployment or remote workflow rerun was performed.

---

# Coordinated multiplayer and Pages deployment

Updated 2026-11-02. Implemented locally; no commit, push, Cloudflare deployment,
Pages publication or remote workflow execution was performed.

- Existing two-job Pages workflow now installs/checks frontend and backend,
  verifies actual shared-protocol interoperability, builds/stages frontend assets,
  deploys the existing Worker through official `cloudflare/wrangler-action@v4`,
  then gates Pages on a successful public health check. A second health check
  runs immediately before Pages publication. Failed backend deploys/verification
  leave the existing Pages deployment published.
- Workflow-wide `pages` concurrency now uses `cancel-in-progress: false` to
  prevent interruption between services. A pre-deployment main-SHA check rejects
  stale reruns. Newer pushes queue rather than canceling a half-finished release.
- `shared/protocol.ts` remains the sole version/schema source, v12 unchanged.
  The real browser transport runs in Node against production workerd/TCP sockets
  for join/spawn/input/orientation/chat/resume, validating actual wire messages
  and rejecting wrong versions and illegal same-version schemas. No fake players
  or simulated successful multiplayer response was introduced.
- `/health` adds an optional deployment commit `release` and `no-store`; CI
  stamps `RELEASE_SHA` through Wrangler without replacing the existing config.
  Verification checks healthy service/room, protocol and exact commit, with
  bounded retries for propagation/network failures. A public frontend
  `release.json` records the matching metadata. Generated metadata is ignored.
- Required repository secrets are `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`. Preflight reports missing secret names without logging
  values. Vite's actual production env precedence and existing provider resolver
  are reused. Explicit custom hosting fails this Cloudflare deployment clearly;
  future/local custom support remains unchanged.
- Connection errors distinguish a version/update mismatch from a malformed
  same-version message, with refresh/report guidance and strict rejection retained.
- Worker name/URL, Durable Object class/binding/state, ALLOWED_ORIGINS, existing
  VITE handling, `.env.local`, Pages base and GitHub permissions remain unchanged.
  No namespace deletion, state clearing or gameplay changes.

Validation passed: **367 frontend/shared tests**, **54 Worker integration checks**,
**1 actual frontend/Worker compatibility test**, **6 deployment gate tests**,
**7 dedicated-scaffold checks**, frontend/Worker typechecks and builds, asset
verification (**198 entries / 214 materials**), metadata preparation and diff
checks. Official actionlint **1.7.12**, downloaded into ignored test-results and
verified against its published SHA-256 checksum, accepted the workflow. A Worker
deployment **dry run** using the exact release variable preserved ROOM,
ALLOWED_ORIGINS and timer bindings. Vite SSR validation tools disable dev sockets,
watchers and dependency discovery; no fixed-port listener is required.

Manual setup, release flow, PowerShell recovery, troubleshooting and paired
rollback are documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Owner must
add/confirm the repository secrets and keep Pages Source set to GitHub Actions.
Credential validity and actual cloud publication have not been tested. Two
services cannot deploy atomically: incompatible old tabs may need refresh and a
post-Worker failure may require finishing Pages or restoring the matching Worker.
Persistent state is never rolled back/deleted automatically.

Exact files changed: `.github/workflows/deploy.yml`, `.gitignore`, `package.json`,
`server/src/index.ts`, `src/network/MultiplayerClient.ts`,
`tests/multiplayerTransport.test.ts`, new `server/tests/protocol.mjs`,
`tools/prepare-release.mjs`, `tools/verify-release.mjs`, `tools/release-config.ts`,
`tools/tests/release.test.mjs`; `docs/DEPLOYMENT.md`,
`docs/MULTIPLAYER_ARCHITECTURE.md`, `server/README.md`, `CLAUDE.md` and this log.

---

# CI fix - headless map validation without Pillow

Updated 2026-11-01. Inspected the actual failure in
[GitHub Actions run 41353123986](https://github.com/Goofykings/Crossfire/actions/runs/41353123986).
`npm test` failed because `check-update-phase2.py` imports `layout_industrial`,
which imported Pillow through `layoutkit.py` even though validation renders no
images. Pillow exists locally but is absent on the GitHub runner.

- Moved the Pillow import into `LayoutKit.render`; layout/collision validation
  now needs only Python's standard library. PNG authoring still uses Pillow.
- The existing regression test now invokes Python with `-I -S -B`, disabling
  site-packages so local Pillow installations cannot mask this CI failure.
- Reproduced the missing-PIL error before the fix; the same isolated check now
  passes. All **366 tests**, production build/typecheck and asset validation
  (**198 entries / 214 materials**) passed. A real PNG rendering smoke check
  also passed with Pillow available.

Changed `tools/layoutkit.py`, `tests/updatePhase2.test.ts` and this log. No game
behavior/assets, dependency installation or deployment workflow changes were
needed. No commit, push, deployment or remote Actions rerun was performed.

---

# Update Phase 4 - interactive environment and final quality pass

Updated 2026-11-01. Completed and tested locally. Existing uncommitted Phases
1-3 were preserved. No commit, push, deployment, hosting or endpoint change.
The separate gun-model import request was set aside by the user; existing guns
and the supplied BlenderKit files remain unchanged.

- Town's existing fruit stall now has open wooden bins, six individual 3D apples
  and three static yellow fruits, preserving its placement and architectural
  style. Fixed the old solid stall collider that enclosed empty space/produce;
  collision now follows the actual counter, posts, bins, roof and rear props.
- Actual validated server weapon rays apply bounded, mass-dependent impulses
  before their closest solid/player hit. Swept primitive collisions, low bounce,
  damping, neighbouring apple contacts, a 3.2 m/s cap and sleep let objects settle.
  Small decorative props never block players, provide moving cover or grant
  points. No arbitrary client prop forces, hit claims or positions are accepted.
- Two small loose crates/barrels per map, away from spawns and structural cover.
  Two existing Town sign panels swing on damped, limited top-edge hinges; fixed
  brackets/hooks stay in place, wall clearance stays valid and signs return to
  rest. Other signs and large structures remain static.
- Runtime-neutral shared simulation, bounded 60 Hz substeps, at most 12 bodies
  and 2 signs (actual Town 8+2, Industrial/City 2 each), shared geometry/material
  instances and sleeping. No new physics dependency. Resting props perform no
  substeps, send no transform traffic and avoid repeated rendering transforms.
- Worker-owned motion; protocol **v12** sends full welcome/spawn poses and only
  changed poses at 10 Hz plus a terminal sleep update. Frontend interpolation,
  stale-frame filtering and cached recovery preserve moved props on resume;
  round changes clear old objects. Room storage retains poses. Practice uses
  the same simulation locally. No player movement/combat controls were changed.
- Blender source `blender/source/environment.blend` plus 11 shared GLBs: apple
  (118 triangles), small crate (180), barrel (430), eight existing sign-atlas
  variants (12 each). Each map exports shared definitions and index references.
  Regenerated selected prop/map artifacts and manifests. The reusable building
  library stage also passed an isolated 16-variant Blender export without
  replacing its production files.

Verification: **366 frontend/shared tests** (38 files), **54 Worker checks**
(real local workerd/TCP clients), **7 dedicated-scaffold checks**, frontend and
Worker typechecks, production build, source/map/collision validation and asset
verification (**198 manifest entries / 214 materials**) passed. Strict protocol,
all four weapon impulses, occlusion, speed/bounce/sleep, neighbouring contacts,
hinge limits/rest, frame-rate independence, placement, resume and round cleanup
are covered. Earlier movement, leaning, weapons, ladders, scoring, regen and
grenade tests remain green.

Two real Chrome clients passed development and the production build at
**/crossfire/**: actual confirmed apple/sign/loose-prop shots, identical settled
poses, rendered interpolation convergence, no idle transform messages, resume
without duplicate props, all three map transitions and no asset/browser errors.
Production offline practice passed actual apple shooting/settling. The existing
Phase 3 production browser regression passed crouch/remote stance, real grenade
damage/score/spectating, fresh flash after a slow frame, one positional explosion
cue per client, cleanup, respawn, mouse/keyboard throw and resume inventory.
Screenshots of bins, signs and all maps were inspected. Test navigation was
corrected to acknowledge round results and account for existing autoplay spawn.
Artifacts are under ignored `test-results/update-phase4*` and
`test-results/update-phase3-final-regression/`.

Performance observations: final low-quality, 0.6-scale headless desktop samples
were approximately 60 FPS; Town/Industrial/City recorded 53/66/111 draw calls,
with zero active props after settlement. These are local observations without a
before/after hardware benchmark. No physical Chromebook or public Cloudflare
test was performed. Upright crate/barrel primitives do not simulate arbitrary
tumbling/stacking; abrupt process failure can rewind cosmetic motion by the
approximately one-second persistence cadence. Existing Vite bundle-size warning
remains. No other outstanding Phase 4 defects were found in the checks above.

Files: `shared/environment.ts` (new), `shared/grenades.ts`, `shared/protocol.ts`,
`shared/world.ts`; Worker `src/index.ts`, `src/world.ts`, test fixture/new
`tests/environment.mjs` and package test command; frontend
`src/game/EnvironmentProps.ts` (new), `Game.ts`, `network/MultiplayerClient.ts`,
`maps/MapManager.ts`/`types.ts`; Blender generator, new
`lib/interactive_environment.py`, `lib/kit.py`/`props.py`/`materials.py`; generated
assets/source/metadata/manifests; new `tests/environment.test.ts`, transport/map
tests and protocol fixture version updates; `tools/update-phase4-test.mjs`,
CLAUDE/architecture/server/asset-pipeline notes and
[implementation, commands and limits](docs/UPDATE_PHASE4_ENVIRONMENT.md).

Release requirement: matching **frontend/assets and Cloudflare Worker v12**
must be released together when authorized. Existing URL, ALLOWED_ORIGINS,
`.env.local`, GitHub Pages base and dedicated-server preparation are preserved.
The dedicated scaffold remains explicitly incomplete. Public multiplayer was
not validated or deployed. Phase 4 is complete; no further development stage
was started.

---

# Update Phase 3 - grenades, held crouch and multiplayer integration

Updated 2026-10-31. Completed and tested locally. Existing uncommitted Phase 1/2 changes
were preserved. No commit,
push, deployment, endpoint or hosting change was made.

- One configurable grenade per life, no regeneration, respawn reset; silhouette
  and count immediately left of ammo, with an accessible mouse throw button.
  New defaults are R throw, F reload, Left Control hold crouch. Legacy factory
  controls migrate; custom controls retain their keys and new actions find unused
  bindings. Existing conflict handling/settings persistence is preserved.
- Original 892-triangle PBR grenade with optimized GLB and editable Blender source.
  Short weapon throw motion; collision-safe server launch, gravity, swept OBB
  bounces, friction/settling, thin-wall protection and elapsed 2-second fuse.
- Worker-authoritative 100-HP maximum / 1.8-m linear radial damage, actual
  explosion-time poses and wall occlusion. Inventory/projectiles/explosions and
  awards persist atomically before publication; resume cannot replenish a life.
  Grenade kills retain normal scores, combos, team totals, feed, spectating and
  match results without headshot bonuses. Posthumous credit, friendly-fire rules,
  damage regeneration resets and old-round cleanup are handled.
- Shared GLB plus one capped 128-quad cosmetic batch for brief trails, flash,
  smoke and debris, with complete leave/map/results cleanup. Original synthesized
  positional explosion audio uses bounded voices and master + new SFX gain.
  Monotonic creation times prevent a slow preceding frame from skipping a new
  flash. Event/snapshot/reconnect deduplication prevents repeated explosion cues.
  Grenade hit statistics stay separate from firearm accuracy.
- Held crouch shares collision, prediction/replay and server validation; smooth
  1.15-m body / 1.02-m eye, 2.4-m/s walking, quiet footsteps and headroom checks.
  Existing outward hip posture cancels fully in ADS. Exported CROUCH animation
  (measured 1.1492 m) replaces the inappropriate slide pose for manual crouching.
- Local protocol **v11** adds validated crouch/grenade controls, inventory,
  projectiles/history/events and grenade elimination icons. Existing malformed
  message/version rejection remains. Matching frontend/assets and Worker releases
  will be required when authorized; no public Cloudflare v11 test was performed.

Verification: all **352 frontend/shared tests** (37 files), **53 Worker checks**
(real workerd/TCP clients), **7 dedicated-scaffold compatibility checks**, frontend
and Worker typechecks, production build and asset verification (**183 manifest
entries / 213 materials**) passed. Two real Chrome contexts passed dev checks and
the final production build served at **/crossfire/**, including actual grenade
kills/feed/spectating, keyboard and mouse throws, crouch animation, one positional
explosion cue per client, cleanup, respawn and resume. Screenshots were inspected.
The browser harness was corrected to poll authoritative transitions and keep
screenshots/reconnect setup out of the two-second blast-positioning window.
No physical Chromebook performance test or live public Cloudflare test was run.

See [docs/UPDATE_PHASE3_GRENADES.md](docs/UPDATE_PHASE3_GRENADES.md) for balance,
implementation, exact PowerShell commands, tests and limitations. Phase 3 is the
only new development scope; stop after final verification. No later phase was
implemented.

---

# Update Phase 2 — map geometry, ladders, rooftops and Industrial props

Updated 2026-10-31. Completed and tested locally. This is the newer **Update
Phase 2** brief, separate from the earlier compact-layout Phase 2 below. The
existing uncommitted Phase 1 work was inspected and preserved. Baseline frontend
typecheck and all 316 existing tests passed before these changes. No commit,
push, deployment or hosting change was performed.

- Added a 12 cm inward skin to the shared Town/Industrial/City facade generators,
  preserving exterior geometry, UVs, colors, physical footprints and existing
  interior/reveal surfaces. Terrain masonry already had thickness. Kept normal
  backface culling and removed redundant per-cell caps after overlap tests caught
  sill/lintel flicker during development.
- Corrected **Town B22's east/west arched arcade**: its 3.2 m visible crown had a
  flat 2.6 m collision ceiling. Curved collision now follows the same planar
  profiles used by Blender. The suspended Town arches and stone gate spandrels
  retain real masonry collision; Industrial/City overhead envelopes fit their
  structures. Narrow conservative slices overlap at export-rounding seams.
  Existing ground-level passages passed the baseline; the confirmed defect was
  incorrect headroom. Actual jumps now reach **1.061 m** through B22 in both
  directions without hitting the old invisible slab.
- Replaced unreachable random Industrial ladder decorations (previously starting
  2.6 m above ground) with three authored ground-to-roof service ladders. Hold the
  configured forward action to ascend, release to hold height, backward to
  descend, and Jump to leave outward. Existing shared fixed-step collision bounds
  motion, ceilings and top/bottom exits. The 1.65 m stand-off climb line preserves
  the longest weapon's normal clearance; its top shaft does not cross the landing.
  Climbing derives from trusted map regions and existing input/snapshots/replay,
  with no new client position field, protocol change or per-player timer.
- Made **I31/I32/I34** connected low 4.5 m service decks, with three alternative
  access/exit approaches inside the existing map. Kept all ground footprints and
  lower routes. Added HVAC, fan, vent/pipe and utility-box plant off the main path.
  Deck/landing/rail/plant collision shares the authoring definitions; actual kit
  vertices are checked against their collision envelopes, including the HVAC
  duct, louvres and fan caps. Dressing reserves the ladder approaches.
- Fixed reversed arbitrary-axis tube cap winding. The pipe bundle now has proper
  annular end rims and inward-facing bore surfaces at both ends, preserving its
  placement, materials and existing gameplay collider. Regenerated affected map
  and prop GLBs, all three collision/debug exports, four editable `.blend` files,
  asset manifest and Industrial authoring plans. Removed only bytecode-cache
  changes generated during this work.

Final verification: **338 frontend tests in 35 files and all 51 backend tests
pass**, along with frontend/backend typechecks, production Vite build, Worker
dry-run build and **181-entry / 213-material** asset verification. Source checks
reproduce Industrial layout and all three collision files. Existing geometry
overlap, spawn, movement, slide/jump/lean, combat, health, scoring, round and
session tests pass.

Local Chrome testing passed with two actual clients in development and the
production **`/crossfire/`** build. Verified rebound forward/back keys, all three
ladders, release/descending/top exits, server/prediction height agreement, remote
vertical rendering and genuine mid-ladder reconnection preserving identity,
life, health and height without duplicate avatars. The final matched frontend /
Worker run is in `test-results/update-phase2-final/`. Inspected close-ups of both
pipe ends, service roofs/plant, remote climbing, Town/City walls and B22 from both
entrances. Existing three-map production browser regression also passed both
stair ends and walking/sliding/jumping through established ground flanks, saved
settings and asset/error checks. No missing assets or uncaught browser errors.

Remote climbing retains the existing airborne animation; no dedicated climbing
clip was added. Human small-match testing remains appropriate for rooftop
balance. Live Cloudflare / public Pages validation was not performed. Publish
matching frontend assets **and** the rebuilt Worker together when authorized;
strict map-version validation and protocol **v10** remain intact. Existing
Blender cache/deprecation and Vite bundle warnings remain, and the pre-existing
untracked Blender add-on under `public/assets/weapons/blenderkit` was untouched.

See [implementation details and exact PowerShell commands](docs/UPDATE_PHASE2_GEOMETRY.md).
Stopped after this phase; no later stage was started.

# Update Phase 1 — spectating, multiplayer audio, weapons and HUD

Updated 2026-10-31. Completed locally; no commit, push, deployment, hosting
switch, server gameplay change or multiplayer protocol change. This entry is
the newer update, separate from the earlier three-stage polish update below.

Spectating now reuses the existing camera-mounted WeaponView for the actual
server-confirmed killer's weapon and synchronized weapon state. Remote ADS is
interpolated with the existing motion snapshots; FOV and the sniper scope
transition with it. The spectator follows the actual remote look direction,
sees no local-player gun, and hides the view-model/returns FOV when the target
is unavailable. The respawn loadout is labeled NEXT SPAWN to distinguish it
from the weapon being observed. A sniper spectator's remote name tags are
clipped to the scope opening: visual inspection caught a tag that previously
appeared over the black surround. Existing permitted target selection and
occlusion checks remain intact; no new network information was introduced.

Valid, deduplicated existing server shot events now play the matching local
weapon WAV through a Web Audio 3D panner and the existing master-volume gain.
The default falloff is 3–70 world units in AudioManager.spatialFalloff. Four
active remote voices are bounded; the oldest tail fades before a new shot so
rapid fire is not silently dropped. Local prediction does not double-play the
local player's shot; scoped/spectating audio follows the camera. Position is
estimated from the latest existing synchronized shooter snapshot, so it is
approximately one snapshot behind and a shot whose shooter is no longer in
that snapshot is skipped rather than assigned a fabricated origin. The game
currently has master volume only, not a separate sound-effects slider. Detailed
positional audio diagnostics are retained only in automated autoplay sessions.

Inspected blender/source/weapon.blend and smg.blend, their procedural sources,
and all four in-game gun views. Found that the shared metal ORM blue channel
averages about 2/255, making the authored firearm metal factors nearly zero.
Added a reproducible weapon-specific ORM with the same AO/roughness channels
and a true metallic channel; refined steel/black-metal and polymer roughness
and normal strength. Original colors, texture/skin inputs, UVs, mesh geometry,
and attachments are retained. The texture generator and Blender material
manifest source generate the same runtime definitions; the four GLBs are not
replaced. No visible hands are introduced. No unverified geometry rewrites.

The existing time-based weapon-motion layer now gently follows positive jump
velocity and eases back through the original landing spring. Full ADS still
preserves the sight axis and reduced-motion preference still reduces cosmetic
movement. Chat prompt/feed/input are raised, with prompt/feed hidden while the
chat input is open. Pause Resume remains blue and Leave Match is red with the
same dimensions and hover behavior. The separate larger final countdown is
derived from the existing authoritative deadline and synchronized clock, shows
10 through 1, and has no timer of its own or reconnect reset.

Verification:
- 316 frontend tests passed; frontend TypeScript and production Vite build
  passed. Asset verification passed for 181 manifest entries, 213 materials,
  three maps and all referenced textures. The preexisting large-chunk warning
  remains.
- Worker typecheck, Wrangler dry-run build and all 50 local real-runtime tests
  passed. The test-only fixture can move the real round deadline; production
  Worker and shared wire protocol remain unchanged at local v10.
- Real local multiplayer Chrome checks ran in Vite dev and again against the
  production build under /crossfire/. Two independent browsers and real Worker
  WebSocket shooters exercised all four observed guns, ADS entry/release,
  sniper scope, live look changes, shooter departures, spectator sound, actual
  server shot delivery and different weapon classes. Left/right real source
  positions and a 20 m source were checked; offline Web Audio rendering
  measured stereo direction and near/far attenuation. A transport unit test
  verifies duplicate/stale/invalid shots cannot trigger duplicate playback.
- Countdown was observed 10 through 1, positioned below the main clock, and
  reconnected with its original real server deadline. Chat/health placement
  was checked at 800x600, 1024x600, 1280x720 and 1920x1080. A real chat
  message and keyboard prompt were checked. Pause button colors and dimensions
  were measured. Screenshots of all spectator guns, scope and countdown were
  visually inspected under ignored test-results/update-phase1/.
- Existing real-browser checks passed all four guns' ADS, recoil and wall
  clearance, plus slide/jump, landing, crouched ADS, reduced motion and stairs;
  an added actual-jump check verifies rise and eventual settling. No browser
  errors were recorded. The initial pause-color check ran during its CSS hover
  transition; moving the pointer away and waiting for the transition produced
  the expected measured colors and a passing final run.

The public Cloudflare deployment was not tested or changed. This phase needs
the frontend/assets published when authorized; it does not itself require a
Worker release. The earlier local/public protocol version discrepancy should
still be checked before any release. Existing weapon proximity/turning overlap
limitations and the large Babylon bundle warning remain. No physical audio
device or Chromebook was used; Web Audio was measured in Chrome and responsive
layouts were checked at Chromebook-sized viewports.

An unrelated untracked public/assets/weapons/blenderkit directory appeared
during this session and was left untouched. It contains 181 files (~69.7 MB);
the local Vite production build copied it into dist because it is under public.
Review those files before including them in a commit or publishing a local build.

# Polish update — Phase 3: results presentation and final verification

Updated: 2026-10-31. Complete locally. No commit, push, deployment, hosting
switch, or unrelated gameplay changes. See docs/POLISH_PHASE3.md for design,
the complete file list, repeatable PowerShell checks and limitations.

Phase 1 retained: elapsed-time weapon sway/bob/recoil/landing, aligned ADS,
bounded sliding streaks, stair smoothing and reduced motion. Phase 2 retained:
authoritative elimination/headshot/combo points, persistent numeric rank,
compact scores, server countdown/team kills, winner/MVP and reconnect-safe
results/loadout flow. All three phases were checked together in this pass.

Phase 3 adds large centered blue VICTORY, red DEFEAT and neutral DRAW banners
with matching dimensions/timing, long symmetric fading bars and a subtle
opacity/transform entrance. The scoreboard, MVP and actions follow quickly;
reduced motion removes movement and delays. The existing darkened backdrop
uses a smaller CSS blur; no new rendering post-process or particle system.
Team panels stay side by side at desktop/Chromebook viewport sizes and stack
on narrow screens. Scrollable compact rows preserve both team headings and
actions. Team totals remain actual eliminations, not individual bonus points.
FFA has one numeric ranking and a winner marker, without invented team scores.
Relative blue/red names, a local row highlight, weapon silhouettes, abbreviated
points with full-value titles and the authoritative cross-team MVP are shown.
No per-player ping was available and none was fabricated.

The Worker now copies the complete real spawned-participant ledger, including
departed players and their last server-approved weapon, into the frozen result
before the next round resets. It survives real socket resumes and a full local
runtime restart. Validation checks roster fields/unique IDs, MVP agreement and
FFA winner/draw consistency. Protocol remains v10: optional result.players and
standing.weapon are compatible additions, not a new wire version. Older saved
summaries show detailed results unavailable; unknown old weapons show a dash.
No new messages or recurring timers. Results DOM is created once per result.

PLAY AGAIN and RETURN TO LOBBY share a one-shot guard and disable together.
They reuse the existing public-main/map/loadout callbacks. The public schedule
continues normally; no extra match, connection or private room is created.
Lobby return intentionally leaves, cancels retry and removes the real session.
Small interface corrections: feathered feed backgrounds, bounded spectator
names, loading/spectating fades and opacity-only reduced-motion elimination
feedback. Existing home, character, settings, HUD and gameplay were retained.

Files in this phase: src/ui/RoundResults.ts (new), src/ui/UI.ts, src/styles.css,
shared/scoring.ts, shared/protocol.ts, server/src/index.ts,
tests/scoring.test.ts, server/tests/combat.mjs, tools/polish-phase2-test.mjs,
docs/POLISH_PHASE3.md (new), CLAUDE.md and this log. Earlier uncommitted work,
including the user's Wrangler configuration and .env.local, was preserved.

Verification performed:
- Frontend: 308 tests passed; typecheck and production builds passed with both
  relative/default and /crossfire/ base paths. Final shared-rule cleanup also
  passed all 28 focused scoring/protocol/result tests.
- Worker: typecheck and dry-run build passed; all 50 real-runtime integration/
  combat tests passed, including complete frozen rosters, authoritative damage,
  regeneration, leaning, replay rejection, resume, hibernation, durable restart,
  stale heartbeat removal, actual leaving and map/round rotation.
- Dedicated scaffold: typecheck, bundle and 7 tests passed; still incomplete
  as a gameplay backend and never substituted for Cloudflare.
- Actual Chrome multiplayer: Teams on Vite dev and FFA on the production
  /crossfire/ build. Each run used two real browser contexts connected for over
  60 seconds with no extra socket opens, synchronized movement and real server
  combat against real WebSocket opponents. Verified 1470 earned points, single
  feed entries, numeric/compact rank, all nine spawned participants including
  seven departed opponents, real team totals, victory/defeat, MVP, refresh,
  transport reconnect, frozen results, Play Again/new-round reset, real draw,
  Return to Lobby and actual room removal. Final runs had no uncaught errors.
- Results checked at 1366x768, 1280x720 and 1024x600 and with reduced motion.
  Victory, defeat and draw screenshots were visually inspected against the
  provided Game_end/leaderboard references. Artifacts: ignored
  test-results/polish-phase3-{ffa,teams}/.
- Existing Phase 1 Chrome script passed all four guns' idle/recoil/ADS/actual
  cover clearance, slide/jump/landing/crouched ADS, streaks, reduced motion and
  real stairs in both directions; no missing assets or browser errors.
- Existing settings Chrome script passed Apply/Back, keyboard/mouse controls,
  persistence, live audio/FOV/FPS and pause entry; final local-backend run had
  zero console errors. No physical Chromebook/FPS benchmark was performed.

Earlier failed attempts were not hidden: a lobby test expected a nonexistent
"disconnected" status, but Game correctly disposes the client and reports idle;
the assertion now verifies idle, unchanged real socket count and room removal.
One production combo assertion failed while a build ran concurrently; the
isolated final run passed and logs confirmed kill gaps below four seconds.
The combo rule was not relaxed. A settings attempt using the public presence
endpoint failed its console check because the temporary local origin was not
permitted. It was rerun successfully against Wrangler with an explicit local
origin and process-only frontend URL overrides; no production policy changed.
There are no outstanding failures from the final runs.

Limits: public Cloudflare gameplay was not validated with this update. The last
observed public /health reported v9; local sources remain v10 from Phase 2.
Both frontend and Worker require matching authorized releases. Cloudflare stays
the default and its DO/origin/session lifecycle remains intact. The existing
large Babylon bundle warning and in-place turn/lean/swap/close-spawn weapon
overlap limitation remain outside this polish. No speculative physics or rig
rewrite was attempted. The polishing update is finished; stop here.

# Polish update — Phase 2: points, combos, match HUD and results

Updated: 2026-10-31. Implemented locally, preserving Phase 1, Cloudflare as the
default, the canonical room, 600-second schedule, map/mode selection, existing
team elimination totals, combat rules and respawn eligibility. The Worker now
awards 100 points per confirmed elimination, 50 only for the final lethal
headshot, and 20 times (combo count minus one). The server-owned four-second
deadline renews per kill, expires at its exact boundary and resets on death or
round change. COMBO_WINDOW_MS is an optional server-only binding. Duplicate
dead transitions neither award again nor extend the deadline. Valid resumes
retain score and the original combo deadline; offline time still counts.

Added shared/scoring.ts with pure scoring, expiry, point ordering and winner/MVP
rules. Integer points, combos, participant records and team totals are persisted
with the latest frozen round result. Participants remain in the round ledger
after leaving so earned points still count for winner/MVP. FFA uses highest
points; tied leaders draw. Teams still uses team elimination totals, with tied
totals drawing. MVP is highest individual points across either team, with equal
MVP scores resolved deterministically by server ID. Results freeze before the
current round resets and survive a complete local runtime restart.

Elimination feedback shows the actual server award and only earned bonus lines.
The Tab leaderboard adds Score, sorts full numeric totals with stable ID ties,
groups Teams and preserves relative blue/red names and weapon silhouettes.
Compact scores truncate to one decimal (1470 -> 1.4k); sorting never uses the
formatted text. No per-player ping existed, so none was fabricated. The new
top-center mode/countdown uses the synchronized server deadline; team totals
flank it with fading blue/red backgrounds. The result screen shows the actual
VICTORY/DEFEAT/DRAW and MVP name/points. Next Match acknowledges the result and
uses the existing map/loadout/spawn flow while the next server round continues.

Fixed refresh treating navigation as explicit Leave: navigation closes transport
while retaining the server-issued resume credential, and explicit Leave still
invalidates it and cancels retries. Existing resume grace remains 15 seconds.
An interrupted map load now releases ownership and retries after reconnection;
Next Match also works when clicked during a genuine transport interruption.

Protocol is now v10 on both local runtimes, including score/award/result runtime
validators and migration defaults for old stored sessions. Existing v9 kills/
deaths remain; new point totals begin at zero instead of inventing historical
headshot/combo awards. Incompatible wire versions fail clearly. The public
Cloudflare health endpoint was read and still reported v9; the new features
were NOT validated against the public Worker. Matching frontend and Worker
publication is required when authorized. The future dedicated transport
scaffold reuses v10 but remains intentionally incomplete. No hosting switch.

Final verification: all 304 frontend tests, frontend typecheck/production build,
Worker typecheck/dry-run build, all 50 real Worker/WebSocket tests, and all seven
dedicated scaffold checks pass. Coverage includes normal/headshot/combo awards,
expiration/death/round resets, large combos, replay protection, resume, complete
runtime reconstruction, point truncation and team sorting, wins/draws/MVP ties,
server deadlines and strict protocol compatibility. Earlier test-harness failures
from reserved alarm RPC calls, retained Miniflare references, an old binary-frame
version fixture and navigation-confirmation timing were corrected; final full
runs pass without relaxing gameplay validation or test timeouts.

tools/polish-phase2-test.mjs passed with two real Chrome players and real TCP
WebSocket opponents in FFA and Teams. Seven actual headshot eliminations earned
150/170/190/210/230/250/270 points, totaling 1470; the table showed 1.4k, while
team totals remained seven eliminations. Reconnect and browser refresh retained
identity, points, kills and the original match deadline. Victory/defeat, MVP,
frozen results and next-round reset were checked and captures visually inspected.
The final FFA run used the production build at /crossfire/ and entered an
approved next-round life after clicking Next Match during a reconnect. No browser
exceptions occurred. See docs/POLISH_PHASE2.md for configuration and policies.
No commit, push or deployment. Stopped after Polish Phase 2.

# Polish update — Phase 1: weapon motion, camera and sliding

Updated: 2026-10-31. The existing WeaponView now composes its weapon-specific
hip/ADS and action poses with one WeaponMotion contribution. Added a 4.2-second
breathing loop, distance-based walking/faster-movement bob, smooth crouch/slide
posture, a bounded per-shot whole-rig recoil impulse and a real-landing dip with
damped rebound. Existing GLBs, attachments, reload/pump/bolt actions and the
fully scoped sniper overlay remain in place; no first-person hands were added.
Decorative transverse motion and rotations fade completely at full ADS, leaving
recoil along the sight axis and restoring the original optical alignment.
System prefers-reduced-motion reduces decorative weapon/camera movement and
stops the speed-streak animation without changing gameplay recoil or controls.

Replaced render-frame Euler spring integration with elapsed-time damped springs.
The old stair camera subtracted upward snaps at fixed ticks before render
interpolation and did not smooth downward snaps. It now follows small grounded
height changes in both directions, follows jumps/large corrections directly,
and clamps the visual eye below overhead solids. The existing movement rules,
speeds, slide cooldown/jump-cancel momentum, weapon balance and protocol v9 were
not changed by the polish work. No grounded-state instability was found on the
tested stair route. There is still no separate sprint/manual-crouch control;
the existing faster movement and slide-driven lowered state feed these poses.

Speed lines use 28 preallocated CSS streaks, travelling from 14vmin near the
center toward the edges with varied lengths/opacity and the existing fade.
Their radial mask keeps the crosshair clear. No per-frame DOM objects or timers
were introduced.

The immediately preceding wall task is retained: removed avoidWalls and its
wall-hidden state, so cover never retracts or hides the gun. Equipped-weapon
movement clearance now runs in the shared controller on prediction and the
Worker, with the server choosing the existing authoritative weapon ID. It only
cancels attempted inward movement, preserving tangent motion without pushing
the player backwards. The protocol is unchanged. This bounds movement toward
cover, but does not resolve weapon overlap created solely by turning/leaning
in place, swapping weapons or spawning already too close to geometry. Those
cases are a remaining collision limitation, not a verified no-clipping claim.
The shared collision change requires matching frontend/Worker publication when
authorized; no publication was performed.

Verification: all 278 frontend tests, frontend typecheck/production build,
Worker typecheck/dry-run build and all 49 real Worker/WebSocket tests pass.
New coverage checks 30/60/144 FPS spring recovery, bounded automatic recoil,
ADS optical alignment, reduced motion, stair camera/ceiling behavior, equipped
weapon stair traversal, collision stopping/sliding and prediction consistency.
The first concurrent cold Worker run hit its existing 90-second FFA parent
timeout and cancelled the regeneration child; the isolated full rerun passed
all 49 tests without changing test limits or regeneration code.

tools/polish-phase1-test.mjs passed in actual local Chrome for all four weapons:
idle/firing/ADS, one impulse per fired shot, recoil recovery, approaches to real
map cover with zero gun retraction, slide/jump momentum, landing, crouched ADS,
reduced motion and both Town stair directions. Weapon captures were visually
inspected. Stair traces showed 17.5 cm physical snaps with about 3.4 cm camera
changes on the corresponding frames and no grounded-state flicker. Tests do not
establish every map/corner/rotation combination or every hardware configuration.
tools/polish-multiplayer-test.mjs passed with two independent Chrome sessions
and the actual local Worker: synchronized movement, shared server-confirmed
damage, one recoil impulse per shot, and reconnection preserving the life,
weapon, ammunition and health. No public Cloudflare deployment was tested.
No commit, push or deployment. Scoring/victory screens were not changed.

# Dedicated-server preparation

Updated: 2026-10-31. Cloudflare remains the default provider and the existing
VITE_MULTIPLAYER_URL override remains supported; an absent override defaults to
the public Worker endpoint. The new validated VITE_MULTIPLAYER_PROVIDER selects
cloudflare or custom. Custom requires VITE_CUSTOM_MULTIPLAYER_URL and displays a
configuration error without falling back to Cloudflare. GitHub Actions passes
the public build variables; the existing .env.local was not modified.

Created the independent TypeScript/Node server-dedicated transport scaffold.
Its real HTTP/WebSocket endpoints validate origins, size, shared v9 messages
and protocol versions, report ready:false and reject valid gameplay with an
explicit server_incomplete error. No sessions, players or matches are simulated.
The pure health regeneration rule moved to shared/health.ts; the Worker keeps
its prior import path via a re-export. Protocol, Durable Object, room lifecycle,
match rotation and other authoritative Worker systems remain in place. The
authoritative Node room, secure sessions/resume, persistence, simulation,
scoring/chat, rounds, presence and deployment/TLS integration are future work.
See docs/DEDICATED_SERVER.md for setup, deployment, migration and switching.

Verification: 253 frontend tests, frontend typecheck/production build, Worker
typecheck/dry-run build and all 49 Worker tests passed. Seven dedicated scaffold
checks passed, including real WebSocket version/schema/origin/payload rejection;
the independent Node start command and health endpoint were also exercised.
Chrome verified missing custom configuration never attempts Cloudflare and that
a valid custom URL reaches the scaffold and shows its incomplete error, in both
dev and a /crossfire/ production build. The Cloudflare-provider Pages build
connected two actual browsers to the local Worker for 61 seconds, with movement,
combat, disconnect/reconnect and state preservation checked. A shortened
five-second run had an equality assertion during legitimate health regeneration;
the normal-duration rerun passed. The public Worker health endpoint reported v9,
and one real unspawned test session joined public-main and left cleanly; no
public combat or two-client match was tested. No commit, push or deployment.

# Home preview wrist and grip alignment

Updated: 2026-10-31. The existing home-only arm solver now aligns both the
finger direction and the back of each glove using the rig's mirrored hand axes.
Previously it aligned only one axis, leaving wrist roll dependent on the idle
pose, and placed the wrist itself at the weapon anchor. The wrist target now
accounts for the palm's position; per-weapon hand frames turn the dominant
fingers across the grip and the support palm toward the fore-end. Existing
weapon placement and elbow targets remain the starting point. Remote poses,
gameplay, home framing, last-used weapon and guest name remain unchanged.

Local Chrome checked all four weapons, including grip contact, finger/palm
direction, moving idle, mouse turn, guest name, fallback selection and responsive
framing. Close front, angled and side views were visually inspected. The focused
character/last-used-weapon tests, TypeScript check and production build pass.
The existing mesh has no separately animated finger bones, so individual fingers
cannot be curled around each weapon. No commit or deployment was made.

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
