# Chromebook responsiveness investigation (2026-11-12)

## Confirmed code paths

- Prediction previously kept stepping the local controller after `fixedInput`
  silently stopped retaining frames at its 120-input cap. Those movements could
  never be replayed when authority acknowledged older input. Low frame rates and
  stalls increase the chance of collecting an input backlog. Admission now gates
  the fixed step itself, with a 48-input bound matching the unchanged server queue.
  Backpressure pauses prediction; mouse look remains live. Press edges survive
  until an admitted tick and clear on blur/menu/rebinding.
- The 20 Hz flush previously sent at most 12 frames per callback, adding another
  50 ms per packet when a stalled render collected several batches. It now drains
  the available sending window in legal <=12-frame messages. Timer frequency,
  server tick rate, queue validation and speed rules are unchanged.
- Ordinary reconciliation already saved/restored local yaw and pitch. Two other
  paths lacked ordering guards: `spawned` snapshots bypassed stale timestamp
  checks, and snapshots from an older round could replace the current round.
  Regression fixtures reproduced an older life/orientation being restored.
  Both snapshot types now enforce monotonic round, timestamp, life and ACK state,
  including protection against same-life resurrection. A late valid spawn receipt
  still completes its request against the newer accepted state without rollback.
  This establishes a real code defect, not proof that these packets caused every
  reported camera jerk on the user's device; no device trace was available.
- Every ordinary snapshot previously ran prediction replay, avatar updates and HUD
  work immediately, including a burst queued during a blocked frame. Game now
  applies the latest routine living snapshot once per rendered frame. Deaths,
  life changes, maps, results, spawn confirmations and confirmed combat events
  retain their immediate handling. Transport validation/ACK processing still
  processes every accepted message. Remote presentation keeps its existing buffer.
- Tiny corrections (<4 cm) may retain one frame of existing body interpolation on
  a grounded, clear cylinder path. Current authoritative position is never moved.
  Walls, height differences over 2 cm, jumps and slides reject this smoothing; larger errors
  still correct immediately. The collision world and all gameplay values remain
  unchanged. Reconciliation continues to preserve local mouse orientation.

## Measured combat hotspot and changes

A local Chrome CPU profile at 1366x768, Chromebook Mode and 4x CDP CPU slowdown
measured **613.5 ms** in the first remote-death presentation call. That call
cloned all body/weapon materials and launched transparent shader compilation.
The profile recorded `DeepCopy` and garbage collection as well as rendering,
visibility and simulation work.

Chromebook deaths now keep the original opaque materials and collision-safe
ragdoll. They use the same fall and 2.2-second lifetime, then disappear without
translucent fade. No material clones or fade shader compilations occur there;
normal graphics retain the existing fade. Post-fix first-death calls measured
**11.4 ms** and **8.8 ms** in two throttled runs. A regression checks zero material
clones, preserved material identity, one ragdoll capture and duplicate protection.

Existing firearm, dagger, hit-mark, particle, skin and snow pools are preserved.
The mark clipper stops once its existing vertex budget is filled (output is
unchanged). Pooled impact materials/particle effects now warm after map lighting
is ready, during loading, without emitting particles or drawing flashes. Frosted
warms the transparency/instancing variant for the selected graphics mode, avoiding
a first-shot define change. Audio already uses decoded buffers and bounded voices;
no evidence justified changing its gameplay playback path.

## Measurements and their limits

Raw local artifacts are under `test-results/responsiveness/`:

| Run | P50 ms | P95 ms | P99 ms | First-death call ms |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 117.0 | 526.3 | 743.3 | 613.5 |
| Post-fix sample A | 16.8 | 108.6 | 183.6 | 11.4 |
| Post-fix sample B | 66.9 | 225.6 | 718.3 | 8.8 |

These short profiles include randomized Practice bots, cold/warm driver caches,
profiler overhead, different diagnostic settings and local machine scheduling.
The whole-scene percentile variation is large: do **not** claim a reproducible
aggregate frame-rate improvement from this table. The targeted death work removal
is corroborated by the call measurements and zero-clone regression. Some >600 ms
frames remained in the throttled profiles; no claim of stall-free play is made.
The final loading-time warm-up arrangement is also verified by production Practice
smoke checks, rather than a controlled hardware benchmark. CPU throttling does
not emulate Chromebook CPU architecture, GPU, memory pressure, browser policy or
school Wi-Fi. No actual Chromebook or public server was tested.

## Optional diagnostics

Open the normal game with `?perf=1` (use `&perf=1` with existing query parameters).
In the browser console:

```js
__crossfire.resetPerformance();
// Play through the problem, then capture:
__crossfire.performance();
```

Frame sampling uses a 600-element typed ring. Percentiles/summaries are computed
only on inspection. The report contains average FPS, mean-worst-1% FPS, P50/P95/P99,
long-frame counts/duration, named render/simulation/shot/death/snapshot CPU costs,
Long Task API information where supported, and GPU frame time or null when
unavailable. It also includes transport RTT, arrival jitter, ACK latency, snapshot
age, pending/unsent/in-flight inputs, stale state count, correction sizes/replay
work and socket events. A render CPU spike with low GPU time suggests a CPU/main-
thread bottleneck; high RTT/jitter or old ACKs with otherwise healthy rendering
suggest a link/server problem. These indicators do not by themselves identify
whether a remote server stall or network queue caused a delayed message.

Long Task observation and GPU timing are disabled by default. Frame counters
reset for a new measurement and can be reset manually. Network counters describe
the transport. No production console logging is enabled automatically.

The existing adaptive resolution controller retains its bounds, sustained sample
windows, hysteresis and recovery delay. Graphics Settings now provides **Adaptive
Chromebook Resolution** to disable it while keeping fixed Chromebook resolution.
No additional automatic quality stages were justified by this CPU-heavy profile.
Saved non-Chromebook quality preferences remain intact.

## Verification commands

```powershell
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=2
npm.cmd run build
npm.cmd --prefix server run typecheck
npm.cmd --prefix server test
node --test server/tests/protocol.mjs
node --test server/tests/responsiveness.mjs
node tools/responsiveness-profile.mjs http://127.0.0.1:4221/crossfire/?perf=1 capture
node tools/responsiveness-browser-test.mjs
```

The browser tools expect a production preview under `/crossfire/` on port 4221;
the Chrome executable path is in each script. The profile deliberately exercises
the real remote-death **presentation** hook; it does not award a fake kill or
simulate a multiplayer connection. The four-map smoke test uses fully local
Practice, checks Pages asset URLs and rejects gameplay WebSocket creation.
The integration test uses two real frontend transports against local workerd,
shared map collision, 60/30/20 FPS input, bounded delayed/jittered downstream
messages, a 250 ms input-production stall, ACK convergence and mouse ownership.
Unit tests separately inject stale/out-of-order states. No network or shader
validation is weakened.

The integration fixture resolves the repository root from its own module URL,
so both the direct command and `npm --prefix server test` load the same frontend
modules regardless of the caller's working directory.

Local verification artifacts:

- Frontend suite: **993 passed**, one existing performance-test skip
  (`test-results/responsiveness-vitest.log`). Final diagnostics, transport,
  camera and lightweight-death rerun: **40 passed**
  (`test-results/responsiveness-final-validation.log`).
- Final frontend TypeScript + production build: passed
  (`test-results/responsiveness-final-build.log`). Worker typecheck and dry-run
  build passed (`test-results/responsiveness-server-types.log`,
  `test-results/responsiveness-worker-build.log`). Existing bundle-size notices
  remain.
- Real frontend/shared-parser/Worker compatibility: **1 passed**
  (`test-results/responsiveness-protocol.log`).
- Four-map production Chrome Practice check: passed
  (`test-results/responsiveness-browser.log`). This verifies loading-time effect
  readiness, diagnostics opt-in, adaptive opt-out, Pages paths and absence of
  gameplay sockets, asset failures and page errors.
- Complete backend suite: **100 passed**, zero failures
  (`test-results/responsiveness-backend-final.log`, 503.5 seconds). Both direct
  responsiveness integration commands also passed, including invocation from
  the backend directory.

## Changed files

- Transport/prediction: `src/network/MultiplayerClient.ts`,
  `src/network/NetworkTiming.ts`, `src/player/PlayerController.ts`,
  `src/practice/PracticeClient.ts`, `src/game/Game.ts`.
- Presentation/loading: `src/game/RemotePlayers.ts`, `src/weapons/Effects.ts`,
  `src/weapons/SnowBurst.ts`, `src/weapons/WeaponView.ts`,
  `src/physics/ImpactMark.ts`.
- Diagnostics/settings: `src/core/PerformanceDiagnostics.ts`,
  `src/config/settings.ts`, `src/rendering/RenderContext.ts`, `src/ui/UI.ts`.
- Regression coverage: `tests/cameraMotion.test.ts`,
  `tests/multiplayerTransport.test.ts`, `tests/performanceDiagnostics.test.ts`,
  `tests/lightweightDeath.test.ts`, `server/tests/responsiveness.mjs`,
  `server/package.json`.
- Browser tools/documentation: `tools/responsiveness-profile.mjs`,
  `tools/responsiveness-browser-test.mjs`, this document, `PROGRESS.md`.

## Release

Protocol remains **27**. There are no Worker gameplay/configuration changes and
no backend runtime redeployment is required by this request. Publish the frontend
when authorized, against an already matching protocol-27 backend. Server changes
are integration tests/the test command only. No commit, push or deployment was
performed. Actual Chromebook and public-network validation remain required before
making device-specific performance claims.
