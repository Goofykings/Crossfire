# Full-system performance audit — 2026-11-14

This continues the networking repair and Chromebook frame-time pass. It preserves
their working changes, protocol v28, authoritative damage/scoring, collision,
weapon balance, skins, maps and deployment configuration. Nothing was committed,
pushed or deployed. Local measurements below are not public-server validation.

## Findings and corrections

| Finding | Correction | Evidence and tradeoff |
| --- | --- | --- |
| First prop hit lazily built a large bullet BVH on the render thread. | Previous pass prepares the selected map's shared exact BVH/alpha cache during cancellable loading. Verified present. | Controlled Farmstead/Industrial worst shot callbacks 134.6/90.2→13.4/12.7 ms. Moves work into loading; a single asset can exceed the 8 ms between-assets yield window. |
| Static material submission was CPU-heavy on Chromebook. | Previous pass retains every vertex/material but uses 64 m cells and exact static outline-mask proxies. | Five-view real GPU masks **and main pixels** unchanged; test draws 27→16 (one view 23→14). Coarser main culling can submit more off-screen triangles; proxies add bounded map-owned vertex buffers. |
| An optimization introduced global lighting-define invalidation every frame when avatars existed. | Removed observed `push()` mutations from the pooled RTT list; indexed writes plus truncation do not notify Babylon's empty-list observer. | Captured browser stack through `ObjectRenderer._renderListHasChanged`; a 60-frame regression verifies zero global light-dirty calls. Stable shader counts alone had concealed expensive CPU define preparation. GPU pixel equivalence rechecked. |
| Practice path selection scanned the entire open set on every A* expansion. | Indexed binary heap, decrease-key and original insertion-order ties. | Same exact node IDs in 48 sampled routes over all four maps; 5,000-operation queue oracle covers ties, decreases and reopened nodes. Extra bounded per-search typed arrays trade memory for reduced scanning. No nav mesh, traversal rules, difficulty, decision rate or simulation rate change. |
| Continuous five-AI profiling still spent about 3.9 s in full-array nearest-node searches. | Reuse existing navigation cells and stop outward rings only with a proven distance bound. Small/distant components use an exact component-index scan; empty-grid work is bounded. Preserve global node-ID ties and height/component rules. | 780 queries over all four maps compare exactly with the original scan, including stacked floors, component constraints, borders, distant components and invalid positions. Timings are saved in `audit-navigation.json`; these are query microbenchmarks, not gameplay FPS ratios. |
| Practice still erased interpolation even when authority confirmed an identical predicted state. | Preserve previous position/crouch/lean only when exact full controller state matches after replay. | New real local-transport regression reproduces moving-camera endpoint loss; real changed authority still applies and current mouse look survives. No smoothing of invalid movement. |
| Correction maxima concealed timing/context and deliberate test placement. | Opt-in bounded recent correction traces include distance, ack, replay count, snapshot age and stance; no credentials or message payloads. | Default disabled; 128-entry cap and report-copy isolation tested. They provide evidence, not automatic proof of a collision or networking cause. |
| Browser Practice benchmarks could silently measure spectating or report zero after a death reset. | Independent full-interval RAF measurements and actual UI-driven respawn in bot workloads. | Per-life section statistics remain labelled separately. Earlier zero-sample/spectating phases are excluded from active-combat claims. This fixes the measurement fixture, not gameplay. |

The previous full completion record is in `CHROMEBOOK_FRAME_TIME.md`. Its final
1177-pass frontend / 104-pass backend checks were completed before this audit's
additional navigation/interpolation changes. The final checks below supersede
those frontend counts.

## Architecture and source review

- Confirmed the lossless compact motion/gun checkpoints, stale/duplicate snapshot
  guards, live local mouse ownership, lifecycle snapshot barriers and one pending
  replaceable living presentation snapshot are present. Reliable combat, chat,
  economy and lifecycle events still dispatch; they are not coalesced away.
- Shared simulation remains 120 Hz. New-work passes are capped at 12 ticks with
  retained elapsed debt; replay can separately use up to 48 retained inputs.
  No claim that this guarantees a fixed CPU-time budget on arbitrary hardware.
- Validated continuous movement can continue for 350 ms through a short input
  gap; attack/jump edges cannot repeat. Explicit releases and life/round changes
  clear/replace the hold. Player/weapon clearance and map geometry remain shared.
- Client heartbeat 2 s, receive watchdog 8 s, server timeout 10 s. Every valid
  message updates liveness. Welcome cancels the 5 s handshake deadline. A brief
  pong delay does not trigger reconnection while snapshots arrive. Socket identity
  guards, cleanup, bounded jittered retry and intentional-Leave cancellation remain.
- Remote presentation observers are installed on the persistent scene/manager,
  not per avatar/respawn. Avatar removal disposes held rigs, trails, labels and
  death clones; template/catalog caches intentionally survive between matches.
- Impacts have 128 decal slots, six spark systems and 18 casing slots. Grenade,
  Legendary and trail budgets remain bounded and have clear/dispose paths. No
  particle/object transform broadcasts, shader quality escalation or new per-player
  repeating timers were added.
- Chromebook still uses lite foliage, compact textures, reduced effects, no
  reflections/SSAO/shadows and bounded optional adaptive resolution. Lower detail
  does not change collision or remove registered cosmetic identity. The adaptive
  controller now responds to sustained 100–500 ms frames instead of resetting.

## Test method and acceptance limits

All integration traffic targets isolated local workerd/Miniflare. Browser HTTP
requests outside localhost are blocked in the gameplay fixtures. There was no
production load test, no deployment and no physical Chromebook. Headless desktop
Chrome uses actual GLBs and WebGL/D3D11 at 1366×768; 2x CPU slowdown is explicitly
an approximation and does not emulate a Chromebook GPU, memory or thermals.

Tests and benchmarks run serially. Several pre-existing applications remain open;
host scheduling/GC can vary. Historical and current AI matches do not have identical
bot/death/camera states, so their FPS differences are **not** isolated causal
measurements. Only identical-route queue and GPU pixel comparisons isolate their
respective changes. Workload failures are retained in logs. Browser shutdown is
bounded and may terminate only that fixture's own process tree; it never masks an
assertion failure or kills unrelated browsers.

The deterministic transport matrix runs the real controller/client/codec at
20/30/40/60 and variable FPS, configured RTT 40/80/120 ms, jitter, delayed/burst
snapshots and 100/200/300 ms stalls. It records each nonzero correction with context
and asserts local yaw/pitch preservation. All 15 Industrial dock scenarios land
and converge within 2 cm, bounded by 48 pending inputs / 12 new ticks per pass.
Corrections are **not eliminated**: peak 0.392 m; 110 nonzero corrections across
67.5 simulated seconds. The first trace classification recorded 38 cases while
authority had advanced without new input and 72 as unknown authoritative replay.
Current held-tick state is not sufficient to assign every earlier divergence;
unknown cases are not relabelled as proven collision errors or proven fixes.
No stale-camera reversal occurred. This matrix alone does not establish that
every remaining correction is desirable or that every map/network is bug-free.

## Reproduction

From the repository root, start the built preview, then run the serial audit in
another PowerShell terminal. The server build is a **dry run**, not deployment.

```powershell
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 4236 --strictPort
```

```powershell
node tools/performance-audit-run.mjs
# Individual reruns, without running the whole suite again:
node tools/performance-audit-run.mjs online-final graphics
```

Results/logs are ignored under `test-results/`; fixtures under `.cache/`. The
runner records each actual exit status in `audit-checks.json` and returns failure
if any selected check fails. It does not change `.env.local`. The online fixture
builds an isolated frontend using its local Worker's actual ephemeral URL.

For manual local multiplayer use two terminals:

```powershell
Set-Location C:\Users\Public\Crossfire
$env:WRANGLER_LOG_PATH = "$PWD\test-results\manual-worker.log"
npm.cmd --prefix server run dev
```

```powershell
Set-Location C:\Users\Public\Crossfire
$env:VITE_MULTIPLAYER_PROVIDER = 'cloudflare'
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/?netDiagnostics=1&perf=1` in separate browser profiles
or devices with an explicitly permitted local origin. These process-local env
overrides avoid the preserved old Worker URL in `.env.local`; they do not switch
production. For another device use a reachable host and an explicitly configured
allowed origin; HTTPS frontends require WSS. Never put admin secrets in VITE vars.

### Physical Chromebook check

1. Close unrelated tabs, plug in power, enable Chromebook Mode and restart the
   browser once. Record model, Chrome version, resolution, power and thermal state.
2. Open the diagnostic URL on a matching frontend/backend release. First play
   Farmstead Practice with five bots, then Industrial multiplayer with six real
   players. Spend at least ten minutes moving, looking, jumping onto the dock,
   sliding, ADS, firing, receiving damage, dying/respawning and changing skins.
3. Repeat a short route at Low and Chromebook, then return to Chromebook. Check
   Rich/Frosted/animated skins, nametags/occlusion, interior visibility and muzzle
   effects. Return to menu and join again. Test a genuine temporary link loss and
   intentional Leave separately; Leave must not retry.
4. Use **Download** in the diagnostics panel before leaving. It exports bounded
   RTT/jitter/handler/correction/frame evidence without credentials. Record visible
   stalls with the elapsed time/map/action. For a longer trace, download at intervals
   because recent histories are capped. `__crossfire.performance()` gives detailed
   renderer statistics in DevTools; diagnostics add some overhead, so also compare
   an ordinary session without query flags.

## Final measurements and verification

The first local
six-player browser audit already completed all its checks: 7218 frames / 120.90 s,
59.7 FPS, 1% low 38.8 FPS, P95/P99 16.9/17.1 ms, >50/>100/>250 ms counts 3/1/0.
It observed one actual reconnect preserving session/life/score/weapon, six-row
results, zero remote players after Leave, Farmstead rejoin, and three created /
three closed sockets with maximum one active. This is the desktop 1x workload,
not a 2x/physical Chromebook guarantee. Final rerun figures supersede it below.

### Final automated and actual-renderer checks

- Final frontend: **1181 passed, one existing opt-in character-performance skip**,
  115 passing files / one skipped file, `--maxWorkers=1`. Production TypeScript
  and Vite build passed (`audit-production-verified.log`). Worker typecheck,
  full backend **104/104** and real protocol compatibility **1/1** passed.
  No assertions, timeouts, protocol validation or combat rules were weakened.
- **20/20 map/preset pairs**, all four maps × Chromebook/Low/Medium/High/Ultra.
  **100 actual weapon switch/ADS states** cover rifle, shotgun, sniper, SMG and
  semi-auto sniper, including their normal holster/equip and scope paths.
  Correct 256/512 reflection readiness where enabled, visible viewmodels,
  no unresolved materials, unready meshes, asset failures or shader errors.
- **72 registered cosmetic/weapon combinations**, **576** real WebGL checks
  (five presets plus three live switches each). No missing texture/shader or
  unintended identical-default signature. **42** animation checks cover Hydro
  Dip/Rainbow Glow in High/Chromebook. **50** presentation frames over eight
  representative context runs cover Rich rifle/daggers, Frosted rifle and Green
  Camo rifle in High/Chromebook: first person, ADS/reload/recoil where applicable,
  cached new-life recreation, and third person. No retired cosmetics restored.
- Five-view mask/main-frame GPU byte comparison passed again; draw reduction
  27→16 (23→14 in one view). Source world geometry/materials are unchanged.
- Actual screenshots of Farmstead Chromebook, Industrial Ultra, Modern City
  High, Rich Chromebook rifle/daggers and Frosted first/third person were reviewed.
  This is representative visual inspection, not a manual review of every skin
  in every animation frame or a physical-device certification.

The 12 repeated map loads used three cycles after warming all maps/weapons.
Every recorded scene-owned count, including materials/textures/lights and
library counts, was **identical for each map on each revisit**:

| Map | Meshes | Geometries | Materials | Textures | Transform nodes |
| --- | ---: | ---: | ---: | ---: | ---: |
| European Town | 394 | 262 | 151 | 67 | 156 |
| Industrial | 316 | 244 | 144 | 55 | 120 |
| Modern City | 348 | 268 | 159 | 66 | 124 |
| Farmstead | 339 | 255 | 171 | 78 | 126 |

Each retained one viewmodel skeleton, zero character animation groups and nine
lights in this target-range fixture. These bounded scene counts do not measure
all process/GPU memory or prove multi-hour leak freedom.

### Final 2x CPU target-range measurements

1366×768, 0.5 render scale, Chromebook, adaptive resolution off, 15 seconds per
phase. These are independent whole-interval RAF measurements. No >100 ms or
>250 ms frames occurred in these eight final intervals. Shader program counts
remained 92 Farmstead / 91 Industrial throughout each map's four phases.

| Map / phase | Average FPS | 1% low FPS | P95 / P99 ms | >50 ms frames | Sampled draws |
| --- | ---: | ---: | ---: | ---: | ---: |
| Farmstead idle | 57.6 | 28.3 | 17.0 / 33.4 | 0 | 119 |
| Farmstead rotation | 59.9 | 40.9 | 16.9 / 17.2 | 0 | 64 |
| Farmstead movement | 55.9 | 29.8 | 33.3 / 33.4 | 0 | 86 |
| Farmstead combat | 55.0 | 23.4 | 33.3 / 33.5 | 2 | 65 |
| Industrial idle | 59.9 | 47.9 | 16.9 / 17.0 | 0 | 72 |
| Industrial rotation | 59.3 | 27.0 | 16.9 / 33.3 | 1 | 107 |
| Industrial movement | 59.9 | 47.9 | 16.9 / 17.2 | 0 | 65 |
| Industrial combat | 58.4 | 28.3 | 16.9 / 33.4 | 1 | 108 |

Worst shot callbacks: **12.6 ms Farmstead / 9.0 ms Industrial**; point GPU samples
about **2.3–4.1 ms**. Host variance was substantial: the earlier audit Industrial
run recorded 21.7–28.9 FPS. Navigation changes do not affect this zero-AI fixture;
do **not** attribute its entire later FPS increase to the navigation optimization.
The earlier controlled loading/batching cycles and the exact-output query/pixel
comparisons are the stronger evidence for specific optimizations.

Final full-suite query measurements (12 paths and 195 nearest queries per map):

| Map | A* scan / heap ms | Nearest scan / indexed ms |
| --- | ---: | ---: |
| European Town | 28.7 / 14.5 | 24.8 / 4.0 |
| Industrial | 13.1 / 4.9 | 15.8 / 1.2 |
| Modern City | 24.8 / 5.0 | 14.3 / 1.2 |
| Farmstead | 114.6 / 21.2 | 158.7 / 7.3 |

All 48 routes and 780 nearest results match the original algorithms exactly.
These timings include normal host/JIT variance; the tests assert correctness,
not a machine-dependent timing threshold.

### Final continuous five-AI Farmstead Practice

Same 2x desktop CPU/Chromebook configuration. All four intervals ended playing
with five rendered bots. The fixture uses actual respawn UI and independently
counts frames through deaths, rather than dropping inconvenient transitions.

| Phase | Average FPS | 1% low FPS | P95 / P99 ms | >50 / >100 / >250 ms |
| --- | ---: | ---: | ---: | ---: |
| Idle, crowded view | 22.0 | 5.3 | 83.4 / 166.5 | 88 / 9 / 0 |
| Rotation | 37.5 | 10.6 | 50.1 / 66.7 | 37 / 2 / 0 |
| Movement | 52.6 | 19.9 | 33.4 / 33.7 | 3 / 0 / 0 |
| Combat | 31.4 | 7.9 | 66.7 / 100.0 | 48 / 3 / 0 |

The pre-index continuous run recorded 6.3/10.9/12.3/7.7 FPS and five >250 ms
frames. AI/camera/death states and host scheduling differ, so this is an observed
follow-up, **not** an isolated causal FPS ratio. The exact query benchmark and
profile removal of nearest-node scans establish that the query cost decreased.
There are still **14 frames over 100 ms** in the final 60-second AI workload.
The steady 30–40 FPS goal is **not met in the crowded idle view**; no claim of
universally smooth Chromebook play is justified.

Remaining CPU costs are remote post-animation presentation, active-mesh
evaluation, material/draw binding, animation and collision/LOS queries. Captured
mean rendering CPU ranges about 11.4–33.2 ms versus about 2.0–4.5 ms mean local
Practice authority work. Worst shot callback in the last life: 5.7 ms; death
callbacks in captured intervals were at most 1.4 ms. This is not recurring lazy
BVH construction or global lighting invalidation. No collision/AI-rate/animation
removal shortcut was used. Physical-device profiling is needed before more cuts.

Sampled JS heap grew through this short warming/respawn workload from about
279 MB to a peak 370 MB. Material/texture counts stayed **175/81**; meshes varied
383–419 with held assets/effects/life states. This does **not** establish a JS
leak or prove there is none. The map-cycle plateau and bounded pools provide
separate resource evidence; a longer target-device session remains necessary.

### Failed attempts retained and resolved

The incomplete initial preset sweep asserted ADS after a fixed 350 ms and failed
at Farmstead High. The final sweep waits for actual ADS/reflection readiness and
passes all 20 pairs/100 weapon states. An initial spatial search had costly
distant-component/empty-grid cases; exact component fallbacks bound that work.
The invalid-infinite-position oracle also caught and fixed an Infinity tie case.
The final 780-query oracle and full frontend suite pass. An interrupted parallel
frontend run with timeouts is retained as `audit-frontend-grid-incomplete.log`,
not presented as a completed pass. Final verification uses one worker; no test
timeout or assertion was relaxed.

The forced-death browser fixture initially waited for an obsolete extra weapon
screen. Current gameplay respawns the selected gun directly. The fixture now
waits for authoritative death/life counters and follows the current UI, preserving
gameplay. That failed attempt is retained in `audit-online-obsolete-respawn-screen.log`.

### Final three-minute real local multiplayer check

One actual Chrome renderer plus five real scripted TCP/WebSocket peers, production
local Worker/Durable Object; 1x desktop CPU. This is not six rendered browser
instances or a public-server/hardware test. All 36 periodic samples retained six
sessions, and every scripted movement stream advanced beyond 100 acknowledged
inputs. Browser actions enter the real room directory, join unspawned, select and
spawn, move/jump/slide/aim/fire, receive damage, eliminate and get eliminated.

- A normal validated rifle attack produced one elimination / 100 points. A real
  peer then killed the browser: authoritative health 0, life 1, deaths 1. The
  current direct-respawn UI restored health 100, life 2, deaths 1, six sessions.
  Initial outgoing-combat and victim-death samples had no >50 ms frames; shot
  callbacks peaked at 2.4 ms and captured death callbacks at 1.1 ms. These short
  setup samples are separate from the longer window below.
- The main window also encountered a later real death (two periodic spectating
  samples) and UI-driven respawn. Independent RAF measurement includes these
  transitions rather than resetting on a new life.
- **10,836 frames / 181.14 s: 59.8 FPS**, 1% low **44.9 FPS**, P50 **16.7 ms**,
  P95/P99 **16.9/17.1 ms**, >50/>100/>250 ms **2/0/0**.
- A deliberate transport close/retry preserved the same session, life 2,
  score 100 and rifle. No duplicate remote session appeared. Final event history
  contains the manual reconnect, one close and one scheduled retry; no receive
  timeout or overlapping-open event. Stable operation did not repeatedly reconnect.
- Normal server completion was triggered with 1.8 seconds remaining through the
  test-only clock hook: six-row results appeared, then Leave removed all remote
  avatars. Joining Farmstead through the directory worked with one participant.
  **Three sockets created, three closed; maximum one active; zero left open.**
  This checks the real transition but does not wait an entire natural ten-minute
  browser round. The natural local match timer is separately covered by unit tests.

Network telemetry is bounded (latest 128 samples per metric; RTT had fewer samples)
and includes application/browser/server scheduling, not just link time:

| Metric | Median | P95 | Maximum |
| --- | ---: | ---: | ---: |
| Application RTT, ms | 6.2 | 35.5 | 131.2 |
| Successive RTT variation, ms | 2.9 | 44.9 | 125.9 |
| Snapshot arrival gap, ms | 62.0 | 69.9 | 88.3 |
| Client message handler, ms | 0.6 | 1.4 | 2.0 |
| Message dispatch age, ms | 0.0 | 0.1 | 0.4 |
| Reconciliation CPU, ms | 0.1 | 0.4 | 0.7 |
| Camera rotation correction, radians | 0 | 0 | 0 |

There were ten nonzero positional corrections in the retained complete trace.
One **40.238 m** correction is the explicit test arena placement before combat;
it is preserved, not hidden in the maxima. The other nine are **0.019–0.256 m**
(about three per minute). The largest ordinary corrections occur while airborne.
Their precise collision/input-timing cause is not proved by position traces alone;
they remain authoritative-replay cases requiring further investigation if felt on
the target device. No smoothing, geometry bypass or aim overwrite conceals them.
Separately, the delayed real six-peer backend test passed at 20/30/40/60 FPS:
per-peer median RTT 34.4–49.1 ms, RTT variation 1.0–19.0 ms, peak correction 0.180 m.
The deterministic matrix above supplies the harsher controlled 40–120 ms RTT cases.

Online sampled draws **33–239**; JS heap **230–289 MB**, ending below the first
sample. Meshes **351–369**, materials **147**, textures **57–58**, without a
monotonic count increase. Shader programs 83→89 as death/respawn states warm;
no continuous compilation growth. Menu cleanup left 279 meshes / 147 materials /
53 textures (the intentionally retained map/assets), not a second active room.
This short-run evidence does not certify long-term CPU/GPU memory behavior.

### Acceptance and release limits

All eleven latest entries in `test-results/audit-checks.json` have actual exit
code 0; earlier failed/incomplete logs remain. Build/type checks, frontend,
backend, protocol, real rendering, cosmetics, resource cycles and lifecycle
verification have completed. `audit-online-verified-run.log` records the final
180-second online rerun; `audit-final-checks.log` preserves the earlier fixture
failure and the other successful checks. Existing large-bundle, NullEngine test
capability and local workerd alarm warnings were not suppressed.

This audit fixed confirmed defects and removed measured navigation work. It does
**not** certify every requested smoothness goal: crowded 2x-CPU Practice still
falls below 30 FPS, occasional >100 ms AI-workload frames remain, and some
nonzero authoritative replay corrections are not individually attributed. Public
gameplay, WAN, a physical Chromebook, natural full-round browser soak and
multi-hour memory behavior remain unverified. Use the device procedure above.

This audit's production edits are frontend/local-Practice only. The preceding
networking repair also changes the actual authoritative backend and needs a
matching release there. Preserve the current provider, endpoint, origins and
protocol; the incomplete dedicated scaffold is not a replacement gameplay server.
Identify the active host's real build/restart procedure before releasing those
earlier backend fixes. No commit, push, deployment or endpoint switch occurred.

### Files in this final audit

- Production: new `src/practice/NavFrontier.ts`; `src/practice/Navigation.ts`,
  `src/practice/PracticeClient.ts`; correction telemetry additions in
  `src/network/NetworkDiagnostics.ts` and `src/network/MultiplayerClient.ts`.
- Regression coverage: `tests/navigationFrontier.test.ts`, `tests/practice.test.ts`,
  `tests/networkDiagnostics.test.ts`, `tests/networkMatrix.test.ts`.
- Browser/verification tooling: `tools/graphics-audit-test.mjs`,
  `tools/performance-audit-run.mjs`, additions to `tools/frame-time-test.mjs` and
  `tools/frame-online-test.mjs`; bounded owned-browser cleanup in
  `tools/cosmetic-compatibility-test.mjs`.
- Documentation: this report, completion notes in `docs/CHROMEBOOK_FRAME_TIME.md`
  and `PROGRESS.md`. The working tree also retains the earlier networking/rendering
  pass files enumerated in those separate progress entries.
