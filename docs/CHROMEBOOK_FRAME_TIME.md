# Chromebook frame-time pass (2026-11-13–14)

This pass preserves the previous networking repair, protocol v28, fixed-step
simulation, authoritative combat, map collision and cosmetics. No commit,
push or deployment is performed. This pass's production changes are frontend
only; the preceding networking repair has its own backend release requirement.

## Confirmed costs and implementation

1. **First-impact CPU stall:** Chrome CPU profiles identify the recursive
   `BulletMesh.tree` builder inside the first `fireShot`. The exploratory
   Farmstead/Industrial runs recorded shot callbacks of 191.5/150.8 ms at 2x
   CPU slowdown. `prepareBulletWorld` now builds each selected map's unique
   prop BVH and alpha-mask cache during loading. It shares the original exact
   ray/decal data; it does not substitute bounding boxes or change movement.
   It checks cancellation and yields between assets after an 8 ms work window.
   One large asset can take longer than that window during loading. Weak-keyed
   caches do not pin unloaded geometry; the existing reusable catalog remains.
2. **Static draw submission:** profiles spend most active CPU in material/light
   binding, readiness and active-mesh evaluation, rather than shader compilation.
   Chromebook batches use 64 m cells versus standard Low's 40 m. This retains
   every vertex/material, reduces submissions and trades some frustum precision
   for lower CPU cost. It changes no collision, visibility query, prop interaction
   or network representation. The existing lite foliage, compact textures,
   reflection-free cosmetic shaders and disabled shadows/SSAO remain in use.
   Cell size takes effect on the next map load; switching presets still applies
   the existing live shading/foliage/resolution changes immediately. Static
   geometry is not rebuilt in the middle of combat.
3. **Remote presentation:** read the viewport, camera direction and frustum once
   before label writes, rather than repeating layout reads after each player's
   DOM mutations. All existing immediate enemy occlusion, friendly visibility,
   smoke rules and body probes remain. No additional rays or animation throttles.
   Empty rooms skip that presentation setup. The silhouette mask reuses its
   render-list array and detaches its composite only when attached.
4. **Outline depth submission (third pass):** the six-peer profile showed CPU
   rendering as the remaining large cost (e.g. 220 draws / 38 ms mean render
   CPU versus 2.9 ms GPU). The depth/color mask drew each static material batch
   separately even though all use the same black unlit override. Exact immutable
   `batch:` geometry is now combined per cell into position/index-only mask
   proxies. Original main-scene meshes/materials remain untouched. Proxies use
   layer mask 0 (only the explicit outline RTT renders them), no canonical
   metadata, picking, shadows or collision. Toggled bush/ivy LODs, live props,
   weapons and skeletons remain independent. Proxies are disposed on map release.
   Real WebGL comparison produced byte-identical RGBA depth/color masks from
   five viewpoints, with visible player pixels behind curved/angled geometry;
   test-scene draw calls fell 27 -> 16 (23 -> 14 at one view). The follow-up also
   compared the final main-scene pixels byte-for-byte: unchanged at every view.
   Actual Industrial replaced **127 static mask sources with 4 mask meshes**.
5. **Adaptive quality:** active frames between 100 and 500 ms now participate in
   the existing sustained-load controller. Previously each reset its sampling
   window, so severe sustained slowdown could never lower a previously raised
   resolution. Suspended frames over 500 ms still reset the window. Existing
   bounds, hysteresis, recovery, opt-out and simulation rate are unchanged.

No global active-mesh/material freeze, model removal, skin fallback, new shadow
passes, scene-wide bullet picking, combat-time texture loading or per-frame asset
recreation was introduced. Existing impact, grenade and Legendary effect pools
remain bounded. The shader and cosmetic quality code is unchanged.

## Diagnostics and method

`?perf=1` enables the bounded frame sampler, Long Tasks/Long Animation Frames
when available, Babylon CPU/GPU/shader instrumentation and network diagnostics.
The overlay remains exclusive to `?netDiagnostics=1`. Debug instrumentation is
off by default. `__crossfire.performance()` exposes frame quantiles/1% low,
full-period average/count, >50/>100/>250 ms counts, forced layout time, shader
counts/time, active indices/3, mesh/material/texture counts, CPU sections and
nullable GPU time. Browser tools sample JS heap; that is not total GPU memory.
Quantiles and the existing `fps` field cover the latest 600 frames; stall counts,
`averageFps` and section means cover the full interval since reset.

References: [Babylon instrumentation](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene/),
[Chrome Long Animation Frames](https://developer.chrome.com/docs/web-platform/long-animation-frames).

The browser fixture uses the actual game/GLBs in Chrome WebGL at 1366x768,
fixed 0.5 resolution, adaptive quality off, and 2x CPU slowdown. All nonlocal
requests are blocked. Four 15 s scenarios reset to the same poses: Farmstead
(0,0,12), heading 0; Industrial (7,0,-5), heading 90. Scenarios: idle, continuous
rotation, forward movement, rotation while firing. Each uses a fresh page; the
same scenarios run in the same order. Generated comparison bundles retain the
current networking/game rules. The historical fixture disables only prewarming
and selects original 40 m batching; pass1 enables prewarming with 40 m cells;
current uses 64 m. The cached bundles also reflect the presentation code present
when built, so isolated presentation gains are not inferred from offline results.

Exploratory runs without fixed poses, an early incorrect historical batching
override and interrupted browser runs are excluded from comparative conclusions.
Reports explicitly retain errors/cleanup warnings. Chrome occasionally stalled,
closed a renderer, or stayed alive after requesting shutdown on this Windows
host. The runner bounds cleanup of its own browser process tree; workload errors
still fail the command. Neither driver stalls nor browser crashes are evidence
of a fixed gameplay issue. Several other pre-existing Vite processes remain
untouched. There is no physical Chromebook, WAN or public gameplay validation.

## Reproduction (PowerShell, repository root)

Build the three fixtures one at a time:

```powershell
node tools/frame-variant-build.mjs baseline
node tools/frame-variant-build.mjs pass1
node tools/frame-variant-build.mjs current
```

In three separate terminals, start their local static servers:

```powershell
node tools/frame-time-server.mjs baseline 4237
node tools/frame-time-server.mjs pass1 4238
node tools/frame-time-server.mjs current 4239
```

Then run sequential comparisons without other builds/tests:

```powershell
node tools/frame-suite-run.mjs
# Real local Practice with five AI bots (not online peers):
node tools/frame-time-test.mjs http://127.0.0.1:4239/ practice-six farmstead 2 30 bots
# Standard Low at the same pixel scale:
node tools/frame-time-test.mjs http://127.0.0.1:4239/ standard-low farmstead 2 15 low
# One actual browser + five real TCP/WebSocket peers, production local Worker:
npm.cmd --prefix server run build
node tools/frame-online-test.mjs 120
```

The online fixture builds an isolated frontend with the local Worker's actual
URL. It does not edit `.env.local` or any deployment settings. Scripted players
join, spawn, move, fire and reload through the real protocol. Test-only RPCs
place actors in an existing collision-checked arena; they do not grant kills,
damage, inventory or fake server responses. Reports/profiles/screenshots live
in ignored `test-results/frame-time/`; generated bundles in ignored `.cache/`.

## Results and limits

Both optimization cycles completed, all 24 map/scenario measurements, without
page errors. Every run needed bounded browser-process cleanup after the workload;
this is recorded as `cleanupForced`, not hidden. Fixed-pose measurements:

| Map / scenario | Baseline FPS | Final FPS | Baseline P95 / P99 ms | Final P95 / P99 ms |
|---|---:|---:|---|---|
| Farmstead idle | 33.1 | 36.7 | 44.4 / 74.4 | 34.1 / 40.7 |
| Farmstead rotation | 36.1 | 47.7 | 42.6 / 58.4 | 28.3 / 32.4 |
| Farmstead movement | 36.1 | 44.0 | 40.5 / 47.9 | 28.7 / 36.9 |
| Farmstead combat | 26.6 | 39.2 | 65.0 / 126.8 | 34.0 / 43.7 |
| Industrial idle | 51.6 | 51.4 | 24.6 / 31.1 | 24.9 / 30.9 |
| Industrial rotation | 51.2 | 49.3 | 25.6 / 34.7 | 25.7 / 31.0 |
| Industrial movement | 54.8 | 54.6 | 23.7 / 29.3 | 23.5 / 28.7 |
| Industrial combat | 43.0 | 43.0 | 31.2 / 41.0 | 32.2 / 36.9 |

The first cycle (prewarm, 40 m) reduced worst shot callbacks from **134.6 to
15.7 ms** on Farmstead and **90.2 to 13.7 ms** on Industrial. The second cycle
recorded **13.4 / 12.7 ms**. Farmstead >100 ms frames totaled **9 -> 0**, >50 ms
**80 -> 6** across its four 15 s intervals. Industrial >100 ms **2 -> 1** (the
remaining event was idle, not a shot). No >250 ms frame occurred in these final
controlled cycles. The earlier exploratory runs did have larger unexplained
gaps; they are not claimed fixed.

The second cycle's incremental benefit is modest: Farmstead idle draw calls
**125 -> 119**, rotation **67 -> 64**, movement **92 -> 86**. Idle triangles
**229,816 -> 234,216** (about +1.9%) due to coarser culling. Industrial's compact
layout has the same submission counts with either cell size. GPU readings were
about 3–4 ms Farmstead and 2–3.3 ms Industrial; active CPU rendering remained the
larger cost. Shader counts stayed fixed within each four-scenario run (Farmstead
91, Industrial 90); material/texture counts stayed **171/74** and **144/51**.
Heap samples fluctuated with GC rather than monotonically increasing (final
Farmstead roughly 247–278 MB, Industrial 209–264 MB); this short observation does
not establish long-term leak freedom. Full rows, 1% lows and intermediate-cycle
results: `test-results/frame-time/summary.md`, generated by `frame-summary.mjs`.

Do not attribute every FPS difference to one change: host scheduling varies,
Industrial average FPS is largely unchanged, and second-cycle P99 sometimes
regressed relative to the first even while remaining below baseline. A final
focused review removes the unnecessary viewport setup in empty rooms; no further
quality cuts are justified by these measurements.

Final full-suite and additional browser verification are recorded in PROGRESS.md.

### Intermediate two-minute local online run after the third pass

One real Chrome renderer plus five scripted real TCP/WebSocket clients connected
to the production local Worker. All five movement streams advanced beyond 100
authoritative acknowledgments. All 24 samples retained six sessions; firing,
reload, actual damage/death and UI-driven respawn ran through the real protocol.
The browser remained connected and produced no page errors. Independent RAF
sampling (not reset by respawning) recorded **5,011 frames / 121.23 s, 41.3 FPS**,
P50 **16.7 ms**, P95 **50.1 ms**, P99 **66.7 ms**, 1% low **13.6 FPS**; >50 ms
**311**, >100 ms **3**, >250 ms **0**. This is **1x desktop CPU**, unlike the 2x
offline matrix. Close crowded views still missed a consistent 30 FPS; this is
not a claim that every Chromebook or every six-player view reaches the target.

Shader count stayed **83** across the sampled death/respawn (no repeated
compilation). Scene counts ranged from 351 to 369 meshes, including four new
mask-only meshes versus the previous maximum of 365. Point GPU
samples had median **1.86 ms**; render CPU median **24 ms**, indicating continued
CPU rendering/rig/submission limits. Observed draw-call range **41–230** versus
**39–334** in the earlier six-peer run. Those online runs have different respawn
positions/camera timing; do not interpret their ranges as a controlled FPS ratio.
The isolated five-view GPU comparison is the controlled proof of equivalent
pixels and reduced submissions. CPU profiles are saved for further diagnosis.
Initial test placement causes a deliberate large network correction; it is not
ordinary movement or evidence of a new reconciliation defect.

The final foliage-heavy Practice check used a separate fixed west-farm pose and
the final production build after empty-room presentation was skipped. All four
scenarios completed without page errors or >100 ms frames; firing P95/P99
**37.1 / 45.9 ms**, FPS **41.8**, worst shot **26.7 ms**, no hot shader-count
increase. It is a different camera route and is not compared to the central-yard
baseline. Farmstead and Industrial screenshots and the final online frame were
visually inspected; this does not verify every map angle or every cosmetic.
CPU throttling does not emulate Chromebook GPU, memory bandwidth or thermal
behavior. The requested 30–40 FPS is a target, not a guarantee on all devices.

### Final Practice regression and completion checks

The real five-AI Farmstead run caught a regression that the empty target range
could not exercise. Refilling the pooled RTT `renderList` with `push()` triggered
Babylon's observed-array empty-to-nonempty callback. That callback invalidated
lighting defines on every scene mesh every frame. A browser probe captured the
stack through `ObjectRenderer._renderListHasChanged`; this was repeated CPU
define preparation even though the compiled shader count stayed constant.
Indexed writes followed by length truncation now reuse the list without that
notification. A 60-update regression asserts zero global light-dirty calls; the
final five-view actual WebGL check still has byte-identical mask **and main-scene**
pixels, with 27→16 (one view 23→14) draws.

The post-fix real five-bot Practice run at **2x desktop CPU slowdown** recorded
9.8/19.8/21.1/18.3 FPS for idle/rotation/movement/combat. The earlier broken
render-list run recorded 4.7 FPS idle. These are moving AI scenes with different
bot/death states, not an isolated causal FPS comparison. Material-define churn
disappeared from the dominant profile, but navigation, collision queries and
CPU rendering remain costly. Idle P99 was 491.5 ms; combat P99 210.9 ms. This
does **not** meet a steady 30–40 FPS target. The following full-system audit
investigates the remaining navigation work rather than declaring it fixed.

Previous-pass verification is complete: **1177 frontend tests passed, one existing
skip**; backend **104/104**, protocol integration **1/1**, Worker typecheck and
production TypeScript/build passed. Focused render-list/label tests **3/3** and
actual GPU comparison **5/5** passed. Eight real cosmetic shader/texture samples
(Rich rifle/daggers, Frosted rifle, Green Camo rifle × High/Chromebook) passed.
This is not a visual audit of every registered skin. The build warning about
large chunks and local workerd alarm warnings remain. Browser cleanup sometimes
requires terminating only the benchmark's owned process after a bounded close.
Logs: `frame-material-dirty-regression.log`, `frame-practice-verified.log`,
`audit-mask.log`, `audit-frontend.log`, `frame-backend-full.log`,
`frame-protocol.log`, `frame-server-typecheck.log`,
`frame-production-verified.log`, `frame-cosmetic-browser.log` in `test-results/`.

No public gameplay or physical Chromebook was tested. Current follow-up results
belong in `docs/PERFORMANCE_AUDIT.md`; the intermediate online numbers above are
preserved as measurements of that earlier state, not relabelled as final results.
