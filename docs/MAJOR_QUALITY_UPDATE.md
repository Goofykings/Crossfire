# Major bug fix and quality update - local QA record

2026-11-03. No commit, push, public deployment or public Cloudflare validation.

## Root causes and changes

- **Slide streaks:** the animation spent most of its lifetime travelling to 78vmax,
  outside the viewport. Streaks now accelerate from 17vmin to 58vmin, with the
  existing clear central mask and varied lengths/durations/alpha. Animations keep
  their phase while the container fades, including slide-to-jump cancellation.
- **Stair sliding:** the weapon sweep applied a 32 cm tall receiver volume and
  28 cm wide barrel volume along the entire gun, before the ground solver could
  step up. It consumed momentum against risers below the actual barrel. The
  shared controller now evaluates legal step support/headroom first, uses a
  12 cm tall/wide front envelope, retains the larger receiver envelope, and uses
  the measured 1.26 m sniper reach. Body collisions, step/snap rules, slide speed,
  cooldown and jump rules remain active. Frontend prediction and workerd import
  the same controller. Wall sliding and existing anti-wall-shot checks remain.
- **Sniper scope:** HUD and hidden spectator SVGs reused global gradient/mask IDs.
  The scope now uses an even-odd geometric aperture (no external mask reference)
  and separate local/spectator gradient IDs. Browser pixel checks cover all four
  supported graphics presets and confirm a usable center with the reticle.
- **Held weapon parts:** the world's 10 cm near plane clipped close view-model
  surfaces; low hip framing also put the grips below the viewport. Only the
  depth-isolated weapon rendering group uses a 1.2 cm near plane, restored after
  the pass. Hip framing rises 10.5 cm; ADS sight anchors, muzzle reach, models,
  materials, recoil/reload/cycle animations and wall pushback policy are preserved.
- **Selection backdrop:** a late opaque CSS override hid the already-loaded world.
  Selection now uses a translucent shade and 14 px blur over that same scene.
  A damped, swept third-person camera follows a real active player, prioritizes
  recent actual shots with target hysteresis, and falls back when unavailable.
  Teams preview follows teammates once assigned; FFA can follow any active player.
  No selection name tags or through-wall outlines are enabled. Empty matches use
  the existing high, slow landmark orbit. Readiness and authoritative spawn gates
  remain; viewing never creates an extra player or life.
- **Grenades:** the previous 1.8 m blast was much smaller than the main cloud.
  Shared balance is now 100 HP through 0.65 m, smoothstep-based configurable
  falloff (power 1.15), zero at 4.2 m. Server explosion-time poses and solid-world
  occlusion still determine one damage transaction. Score, combo, reward and
  elimination deduplication are unchanged.
- **Charge:** held input charges for 1.5 seconds; release creates one authoritative
  projectile. Speed interpolates from 3.2 to 24.5 m/s; 15.6 m/s remains the measured
  preceding ordinary-throw reference. Flat-world tests at three pitches enforce
  1.5-2 times that preceding range at full charge. No duration/strength is accepted
  from clients: credit is bounded by BOTH server simulation and elapsed wall time.
  Missing packets never release a throw and expire held state after 400 ms.
  Death, invalid action/inventory, round changes, clear input, chat/pause, blur,
  reconnect and Leave cancel the meter/charge. OS key-repeat cannot restart a
  cleared grenade action without a fresh configured-key press. HUD pointer holds and configured
  grenade bindings use the same path. Quick taps produce only minimal charge.
- **Explosion presentation:** cosmetic damped roll about the optical axis scales
  with distance, decays and honors reduced motion; aim angles and the forward
  shot ray do not change. Fire lobes/rings and two bounded shadowless lights are
  larger/stronger, and the existing five-second dense/seven-second total smoke is
  denser. Deterministic, swept, damped cosmetic rocks use a 48-piece pool and sleep.
  A maximum of 24 dark irregular projected marks use the existing impact texture,
  0.35 m square vs the bullet mark's 0.11 m (~10.12 times area). A real nearby
  render/collision floor must agree; midair events do not mark distant ground.
  The visible grenade grows 30%; the shared 0.065 m collision sphere is unchanged.
- **Maps:** disconnected stair-rail pieces were confirmed in all three maps.
  Continuous sloped tubes now connect tread posts and the landing rails. Short
  conservative collision envelopes, debug geometry, navigation metadata and all
  affected exports/source .blend files were regenerated. Industrial transformer
  insulator sheds had 2 cm unsupported gaps; continuous ceramic cores now connect
  them to their stems. Its outer collider does not change. No route redesign.
- **Damage arrow:** font size 48 to 70 px; position, color, direction, timing and
  animation are unchanged.

## Compatibility and release

Shared protocol **v16** is necessary because held grenade input now means charge
and a new strictly validated `combat.grenadeCancel` distinguishes cancellation
from release. Old v15 clients must not silently throw using v16 semantics.
No client-supplied projectile position, duration, damage or score fields were added.

Publish frontend/assets and Worker together through the existing coordinated CI
only after authorization. The existing Worker URL, Durable Object, persisted
scores/profiles, origin allowlist, secrets, Vite base and release ordering stay.
New map revisions intentionally reject stale collision state; refresh old tabs.
Two-service releases are not atomic; the existing health/protocol/release gates
still deploy and verify the Worker before Pages. Do not deploy only one half.

## Screenshot review

Actual Chrome captures: `test-results/map-realism-major/` (33 initial frames) and
`test-results/map-realism-major-final/` (39 reviewed follow-up frames; 13 per map).
These are ignored local QA artifacts, not shipped assets. Each folder's results.json
records map, frame name and reproducible pose. Pose height is the controller foot
reference; the capture adds the 1.64 m eye height. Free camera does not assert
physical traversal; shared-controller and workerd tests cover traversal separately.
Some first frames after shader compilation show a cold-start FPS sample; these
are not steady-state performance measurements. The review covers specific views,
not a proof that every polygon on every map has been inspected.

The table covers every final frame; observations also apply to initial frames with
the same filename unless a changed angle or defect is described. The six new
frames (three hanging lights, plaza junction, utility fence and railing gate)
were added for explicit mounting/fence coverage. Initial occluded close-ups are
recorded as camera-fixture limitations and are not evidence of geometry defects.

| Map / PNG basename | Observation and resolution |
|---|---|
| `european-town-work-area.png` | Wooden crates sit on wall shelves; their rear edges meet masonry. Kept. |
| `european-town-entry.png` | Thick doorway reveals and the stair underside meet the floor/walls; passage remains clear. Kept. |
| `european-town-stairwell.png` | First flight has continuous solid risers and a supported turning landing. Kept; shared slide clearance fixed. |
| `european-town-turn.png` | Upper flight joins the landing and a second exit; no long dead-end room. Kept. |
| `european-town-upper.png` | Exterior landing and supports reconnect to the street. Initial disconnected descent rails replaced and recaptured. |
| `european-town-stair-close.png` | Initial camera was inside the second flight, giving an occluded image; corrected capture shows solid stairwell corner/window, not a missing wall. No geometry workaround. |
| `european-town-ceiling-mounts.png` | Ceiling meets brick walls; revised angle shows the flush wall fixture over attached storage. Kept. |
| `european-town-railing-return.png` | Window reveals and upper opening have solid sides. Landing guard is attached, not an isolated floating bar. Kept. |
| `european-town-street.png` | Confirmed floating stepped handrail pieces in initial frame. Replaced with continuous sloped rail, tread posts and joined top landing; final frame checked. |
| `european-town-hanging-light.png` | Suspension rod reaches an actual mounting plate under the upper slab. Kept; no invented mount defect. |
| `european-town-market.png` | Stall posts/container stand on paving, canopy is supported, and side routes stay open. Kept; lower final angle complements the initial elevated view. |
| `european-town-roof-junction.png` | Chimney meets roof; eaves and multiple street branches remain recognizable. Kept. |
| `european-town-plaza-junction.png` | Covered well/plaza landmark has posts seated on the stone rim and circulation space on both sides. Kept. |
| `industrial-complex-work-area.png` | Storage rests on wall-mounted shelves clear of the aisle. Kept. |
| `industrial-complex-entry.png` | Concrete stair and slab are supported; floor doorway and crate placement leave a through passage. Kept. |
| `industrial-complex-stairwell.png` | Stair risers meet the turning landing; window/door wall has thickness. Kept; shared slide clearance fixed. |
| `industrial-complex-turn.png` | Second flight meets upper slab and the through exit remains open. Kept. |
| `industrial-complex-upper.png` | Loading-bay canopy has beams; landing opens to a real exterior stair. Disconnected rail replaced, other architecture kept. |
| `industrial-complex-stair-close.png` | Initial close capture was occluded by solid stairs; corrected view confirms the window/ceiling corner renders. No thin-wall workaround. |
| `industrial-complex-ceiling-mounts.png` | Upper slab/ceiling joins masonry and the wall fixture is flush. Kept. |
| `industrial-complex-railing-return.png` | Solid upper guard panel is seated on its floor edge. Kept. |
| `industrial-complex-street.png` | Initial exterior rail had suspended stairlets. Continuous sloped tubes now join upright supports; final frame checked. |
| `industrial-complex-hanging-light.png` | Rod and plate connect the selected lamp to the slab. Kept. |
| `industrial-complex-service-props.png` | Revised camera shows pump/manifold supports, transformer plinth and the maintenance yard. Source confirmed unsupported ceramic sheds; added continuous insulator cores and regenerated shared prop/source. |
| `industrial-complex-roof-junction.png` | Roof ladder, landing guards, HVAC and pipe-bridge supports are present; open yard branches connect. Kept. |
| `industrial-complex-utility-fence.png` | Divider separates utility equipment from storage with an access opening, rather than covering a solid facade. Posts meet ground. Kept. |
| `modern-city-work-area.png` | Boxes rest on shelves attached to the wall. Kept. |
| `modern-city-entry.png` | Bench is beside the wall outside the main entry aisle; stair underside and slab join solidly. Kept. |
| `modern-city-stairwell.png` | Tiled risers and turn landing connect; window is enclosed by thick wall. Kept; shared slide clearance fixed. |
| `modern-city-turn.png` | Second flight joins the upper floor; lower route and alternate exit remain usable. Kept. |
| `modern-city-upper.png` | Guard/floor and open exterior doorway connect to the street stairs. Disconnected external rails replaced. |
| `modern-city-stair-close.png` | Initial close camera was occluded by stair geometry; revised view checks solid window/slab surfaces. No geometry defect claimed from the bad angle. |
| `modern-city-ceiling-mounts.png` | Ceiling is continuous at the wall join; wall-mounted light clears the shelving. Kept. |
| `modern-city-railing-return.png` | Guard panel sits on the stair opening, attached to the slab. Kept. |
| `modern-city-street.png` | Initial staircase rail was a series of floating horizontal pieces. Continuous supported rail now follows the descent; final frame checked. |
| `modern-city-hanging-light.png` | Light has an actual suspension and ceiling plate, with wall/ceiling clearance. Kept. |
| `modern-city-street-furniture.png` | Initial frame checked fire-escape triangular braces; revised ground view checks bench placement beside the route and wall-mounted AC brackets. Kept; perspective overlap is not an actual prop intersection. |
| `modern-city-roof-junction.png` | Rooftop HVAC sits on feet behind a thick parapet; adjoining streets/roof access remain. Kept. |
| `modern-city-railing-gate.png` | Fenced verge has ground-seated posts and a broad real opening to the road; fence is separate from the rear masonry wall. Kept. |


Follow-up after the transformer export: four additional reviewed captures in
`test-results/map-realism-core-followup/`:

| PNG basename | Observation and resolution |
|---|---|
| `industrial-complex-transformer-bushings.png` | All three ceramic columns now have continuous cores joining the separated sheds and dark base stems. Confirmed close-up; shared GLB and source regenerated. |
| `industrial-complex-service-props.png` | The repaired transformer remains on its plinth; adjacent manifold/radiator supports are intact and the access route remains clear. |
| `industrial-complex-utility-fence.png` | Rechecked the equipment/storage separation after the prop replacement; access opening stays unobstructed. |
| `industrial-complex-hanging-light.png` | Rechecked plate/rod attachment under the slab in the regenerated source/export; intact. |

Other actual visual checks: `test-results/major-quality/` (21 weapon/scope/slide
frames), `test-results/selection-background/` (empty and real-player selection),
`test-results/major-grenade-browser/` (charge, confirmed explosion, inside/outside
smoke and fade), and `test-results/explosion-renders/` (17 deterministic renders).
Representative renders were opened and inspected, not inferred from JSON alone.
The original SVG defect was isolated in `test-results/scope-repro.json`: a single
original scope had 98.88% usable center pixels, adding the hidden duplicate scope
reduced that to 0.16%, and the corrected pair restored 98.88%. This confirms the
shared SVG references, rather than a server/graphics-quality issue, as the root
cause of the black opening.

## Verification commands

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
npm.cmd run test:protocol
npm.cmd run test:deployment
npm.cmd run assets:verify
npm.cmd test --prefix server-dedicated

# Serve the production bundle with a Pages-like prefix for local Chrome QA.
node tools/serve-dist.mjs --port 4200 --base /crossfire/
# Separate terminal, one browser suite at a time:
node tools/major-quality-browser-test.mjs http://127.0.0.1:4200/crossfire/
node tools/selection-background-test.mjs http://127.0.0.1:4200/crossfire/
$env:CROSSFIRE_TEST_OUTPUT = 'test-results/major-grenade-browser'
node tools/grenade-loading-colors-test.mjs http://127.0.0.1:4200/crossfire/ --capture-fx
$env:CROSSFIRE_TEST_OUTPUT = 'test-results/map-realism-major-final'
node tools/map-realism-test.mjs http://127.0.0.1:4200/crossfire/
$env:CROSSFIRE_TEST_OUTPUT = 'test-results/map-realism-core-followup'
node tools/map-realism-test.mjs http://127.0.0.1:4200/crossfire/ --industrial-details

# Isolated explosion renderer (one terminal), then capture (another):
node tools/explosion-fixture-server.mjs
node tools/explosion-render-test.mjs http://127.0.0.1:4201/
```

The two multiplayer browser tools start their own ephemeral local workerd with
real sockets; test-only RPC seeds safe positions, never fabricated players,
damage, scores or successful connections. Other test and build workloads should
be stopped while measuring realtime fuses/reconnects on a shared machine.
No credentials or public Cloudflare access are needed for these local tests.

## Failed iterations and resolutions

- Actual-map sliding tests first failed on the steep flights; narrowed the
  overestimated barrel envelope, applied legal step support and measured sniper
  reach. A middle lateral probe closes the gap between narrower front probes.
  All 72 up/down map/weapon/flight combinations now pass, along with wall tests.
- Initial full-charge speed 26.5 m/s exceeded the requested range ratio at upward
  pitches; tuned to 24.5 m/s. All three comparable-angle range tests pass.
- Two frontend assertions initially failed: the historical 1.8 m radius assertion
  needed the explicitly requested balance update, and generated navigation still
  described the old rail volumes. Updated the expectation and regenerated actual
  navigation; source/collision/revision checks pass without disabling assertions.
- The first cohosted backend run had a late grenade setup (already past its fuse)
  and a test socket lost during a short heartbeat window. The isolated complete
  rerun passed all 59, with production timing and test assertions unchanged.
- A new render-fixture assertion initially recreated already expired history and
  expected a decal. Corrected the fixture to advance the existing explosion and
  let realtime transient dust expire; it now asserts both persistent marking and
  no resurrection from expired history. Unit tests also enforce no midair marks,
  pool caps, collision and cleanup.

## Limitations

- Public GitHub Pages / Cloudflare deployment was not changed or tested. Real
  multiplayer verification here is local Chrome + Cloudflare workerd only.
- No physical Chromebook, phone or other low-end device benchmark. Warm local
  captures are generally interactive; compilation/teleport/inside-fog frames can
  be slower. Particle/light/mark budgets and reduced settings remain bounded;
  no claim of a guaranteed frame rate on every device.
- View-model stocks/grips naturally leave the viewport in close ADS and reload
  poses; enabled mesh components are preserved. No replacement weapon/hand assets.
- Rocks and marks are cosmetic. Marks persist locally until overwritten or the
  map clears; reconnect can restore the recent seven-second explosion history,
  not every older cosmetic mark from the whole round.
- Inspection fixes confirmed defects in the reviewed views. It is not a blanket
  assertion that every architectural detail throughout every map is perfect.

## Final validation results

- Frontend **521 passed**, one existing opt-in performance benchmark skipped
  (53 files; 52 passing and that benchmark file skipped). Frontend type checks
  and final production build pass, including the fresh-press cancellation guard.
- Backend typecheck and dry-run build pass; final full workerd suite **59 passed**.
  FFA/Teams grenade cases cover one-shot scoring, 100/120 point two-opponent combo,
  no headshot bonus, no duplicates, charge/cancel, inventory, resume and respawn.
  Combat/health/round/ladder/interior traversal suites also pass.
- Shared protocol gate **1 passed** using the real frontend client and Worker,
  now explicitly round-tripping held/cancel frames with no projectile consumption.
  Deployment gate **7 passed**; dedicated scaffold **7 passed**; asset verification
  passes. Existing CI and Cloudflare configuration are unchanged.
- Production `/crossfire/` Chrome renderer suite **14 checks**, **21 captures**:
  four weapons at hip/crouch/ADS/recoil, sniper usable pixel coverage at every
  quality, outward slide motion/fade and arrow size. Zero browser/asset errors.
- Two real local Chrome clients + workerd: **9 selection checks** and **44 grenade,
  loading, crouch, chat, charge, cancellation, scoring, smoke and reconnect checks**;
  zero browser/asset errors. The grenade run verifies a live surface scorch mark
  remains after smoke and rocks are gone. Normal and reduced clients coexist.
- **17 deterministic explosion renders** pass normal/reduced timing/pool caps,
  no resurrection from expired history, and persistence of an existing ground mark.
  Actual representative images and the confirmed multiplayer burst were inspected.
- **39 reviewed map views + four prop follow-ups**, preceded by 33 initial captures.
  All recorded observations appear above. No capture/geometry defects were invented.
- `git diff --check` passes. Nothing committed, pushed or deployed. Local QA servers
  and Chrome processes started for this update have been stopped.

Ignored detailed outputs: `test-results/major-release-final-*.log`,
`test-results/major-release-final-checks.json`, and the capture folders listed above.

## Files changed

- `CLAUDE.md`
- `PROGRESS.md`
- `blender/scripts/lib/circulation.py`
- `blender/scripts/lib/props_industrial.py`
- `blender/source/european-town.blend`
- `blender/source/industrial-complex.blend`
- `blender/source/modern-city.blend`
- `blender/source/props.blend`
- `docs/ASSET_MANIFEST.md`
- `docs/MAJOR_QUALITY_UPDATE.md`
- `public/assets/asset-manifest.json`
- `public/assets/models/european-town/buildings/block_06.glb`
- `public/assets/models/european-town/collision.json`
- `public/assets/models/european-town/collision_debug.glb`
- `public/assets/models/industrial-complex/buildings/block_06.glb`
- `public/assets/models/industrial-complex/collision.json`
- `public/assets/models/industrial-complex/collision_debug.glb`
- `public/assets/models/modern-city/buildings/block_08.glb`
- `public/assets/models/modern-city/collision.json`
- `public/assets/models/modern-city/collision_debug.glb`
- `public/assets/models/shared/props/transformer.glb`
- `server/src/index.ts`
- `server/tests/grenades.mjs`
- `server/tests/protocol.mjs`
- `shared/combat.ts`
- `shared/grenadeCharge.ts`
- `shared/grenades.ts`
- `shared/protocol.ts`
- `src/core/Input.ts`
- `src/game/Game.ts`
- `src/maps/european-town/layout.json`
- `src/maps/industrial-complex/layout.json`
- `src/maps/modern-city/layout.json`
- `src/network/MultiplayerClient.ts`
- `src/player/PlayerCamera.ts`
- `src/player/PlayerController.ts`
- `src/styles.css`
- `src/ui/UI.ts`
- `src/weapons/ExplosionBurst.ts`
- `src/weapons/ExplosionGround.ts`
- `src/weapons/GrenadeView.ts`
- `src/weapons/WeaponView.ts`
- `tests/cameraMotion.test.ts`
- `tests/explosionGround.test.ts`
- `tests/explosionJoin.test.ts`
- `tests/grenadeCharge.test.ts`
- `tests/grenadeInput.test.ts`
- `tests/grenadeLoadingColors.test.ts`
- `tests/grenades.test.ts`
- `tests/leanWeaponClearance.test.ts`
- `tests/stairSliding.test.ts`
- `tests/weaponProjection.test.ts`
- `tools/explosion-lab.html`
- `tools/explosion-render-test.mjs`
- `tools/grenade-loading-colors-test.mjs`
- `tools/major-quality-browser-test.mjs`
- `tools/map-realism-test.mjs`
- `tools/selection-background-test.mjs`
