# Multiplayer responsiveness repair — 2026-11-13

This work changes networking/movement timing, not graphics presets, damage, hitboxes,
weapon balance, scoring, rewards or map geometry. Nothing was committed or deployed.

## What is actually hosted

- The current Pages workflow builds with `VITE_MULTIPLAYER_PROVIDER=custom` and
  `wss://relate-hundred-block-smile.trycloudflare.com/ws`. The downloaded public
  Pages bundle confirms that configuration and **client protocol 28**.
- One read-only request to that tunnel's `/health` returned service
  `crossfire-multiplayer`, protocol **28**, release
  `31e8426aa6c27312b04dd5e9826e09ead07b5cee`.
- One request to `https://crossfire-multiplayer.maxwellmaahs.workers.dev/health`
  returned protocol **25**, release `d7f77de3134f1eba1bb5fffc2803fda159e82d88`.
  The current `.env.local` still points there. It was preserved. A local v28
  frontend cannot play against that old v25 Worker; that is a configuration/version
  error, not a measurement of connection quality. There is no silent provider fallback.
- The full authoritative backend available in this repository is still
  `server/src/index.ts`: Workers, Durable Objects, one public room plus custom rooms,
  and WebSockets. `server-dedicated/` is still an explicitly incomplete Node scaffold
  that rejects gameplay joins. The tunnel health response identifies a compatible
  service; it does **not** establish the remote machine's implementation or location.
- Physics is shared at **120 Hz**; active room callbacks/snapshots are **20 Hz**.
  Both host adapters continue using the single protocol/schema source. No protocol
  version bump: compact tuple shapes are unchanged and pong timing fields are optional.

The public checks above did not create players, perform combat, verify the deployed
map revision, or load-test production. They are observations at the time of inspection,
not a guarantee that a temporary tunnel will remain available.

## Two diagnosis/repair cycles

### Cycle 1: deterministic replay and delayed input edges

The compact snapshot encoder rounded **simulation checkpoints**, including gravity
state, slide/coyote timers and gun cooldowns, to four decimals. This changes branching
decisions, not just visual precision. A regression walks the real controller off a
ledge: twelve 120 Hz ticks leave `airTime=0.09999999999999999`. Rounding produces
`0.1`. With the same jump input, the server jumps and the restored client falls.

Checkpoint motion and gun values now retain their original JSON number precision.
Array packing still removes repeated field names and passes the existing packet-size
reduction test. The ordinary strict validator checks every expanded value.

Movement starts/stops, crouch, aim and lean changes also waited for the next 50 ms
batch timer. They now request one deferred flush per render frame, like jump/combat
edges already did. Steady held input still batches; the existing 48-input prediction
and server queue limits remain in place. The regression measures a 1 ms fixture
delivery instead of waiting as much as 50 ms.
The idle optimization also sends a key release when a wall has already stopped
the body; zero velocity is not proof that the previously held key was released.

Three new regressions failed against the original code and all passed after repair.
The wire/transport cycle passed **36/36**, then **42/42** including timing/performance
checks. Logs: `test-results/network-cycle1-baseline.log`, `network-cycle1-after.log`,
`network-cycle1-verified.log`.

### Cycle 2: camera, catch-up, remote collision and real input gaps

- Even a replay that changed nothing reset the previous render position. The
  regression measured a **2.1 cm camera-position nudge** with zero authoritative
  position correction. Exact replay now keeps the already validated interpolation
  endpoints, crouch and lean presentation. Changed authoritative state still applies.
  Identical checkpoints are not replayed twice; older round/life/time/ack checkpoints
  are rejected. Live local yaw/pitch remain owned by mouse input.
- A 300 ms frame was clamped to 250 ms, losing six physics ticks, and could still run
  30 costly fixed steps in one dispatch. Backpressure also cleared accumulated time.
  Shared `simulationBudget.ts` limits a simulation pass to **12 new fixed steps**, retains its
  remaining debt, and caps render interpolation at one (never through-wall
  extrapolation). The client, Practice authority and Worker use this budget. Loading,
  pause and pre-spawn time are excluded from a newly controllable life. Hidden-tab
  time is excluded at the visibility boundary, including Practice spectating; input
  is already cleared on hide. Multiplayer authority keeps running. Active
  100–300 ms stalls retain their elapsed physics time. Press edges stay pending
  while no input slot is available. Physics/anti-cheat still advance from elapsed
  time, never from packet volume.
- Remote airborne extrapolation used the grounded 42 cm step band and could step
  upward into a ledge. It now uses the controller's airborne foot band and no
  airborne upward ground reach; correction paths use the same stance distinction.
- The harsher input-gap matrix found the large platform snap's remaining mechanism:
  an empty input queue meant neutral movement. At a jump's apex, after the side
  collision had removed forward velocity, the server therefore had no forward air
  control during the short window when the feet cleared the dock. The client replay
  did have forward input and showed a landing; authority later rejected that pose.
  `MovementHold` now continues only the last **validated continuous** movement for
  up to **350 ms**. It never repeats jump/attack/reload edges. A neutral input replaces
  it immediately. Stale movement expires, gravity/collision remain authoritative,
  and lifecycle changes clear it. Crouch/slide-held stance is preserved appropriately
  on reconnect, without retaining movement. Practice uses the same rule. Test-only
  placement RPCs clear the previous hold, just like a fresh position/life transition.

The existing Game-level living-snapshot coalescer was retained, not replaced with a
second queue. Protocol parsing, acknowledgment bookkeeping and reliable events remain
immediate. Death/spawn/result/map transitions remain barriers; reliable shots,
eliminations, purchases, profiles, chat and environmental events are not discarded.
There is one replaceable pending presentation snapshot, bounded remote history,
bounded input history, and no new unbounded receive queue.

## Measurements and what they mean

`tests/networkMatrix.test.ts` uses a labelled deterministic transport fixture and the
real client/controller/codec, not fake operational multiplayer. It covers **15**
combinations: 60/40/30/20 FPS and variable frames, 40/80/120 ms configured RTT, jitter,
burst-delivered snapshots, delayed acknowledgments and 100/200/300 ms stalls. The
historical comparison restores the old lossy checkpoint and neutral-on-gap behavior
inside the fixture only; it is not a production-code benchmark or a complete copy
of the old game.

| Fixture result | Historical model | Repaired model |
| --- | ---: | ---: |
| Industrial landings | 10/15 | 15/15 |
| Worst position correction | 1.806 m | 0.392 m |
| Mean of each scenario's maximum correction | 0.670 m | 0.239 m |
| Mean nonzero corrections per scenario | 7.33 | 7.33 |
| Peak retained pending inputs | 48 | 48 |
| Maximum new fixed ticks per scheduling pass | 12 | 12 |

The historical comparison intentionally shares the new work budget; its main purpose
is to expose the input-gap/precision defects. Corrections have become smaller, **not
eliminated**. Real stalls and late input can still require substantial authoritative
corrections. No larger smoothing window or relaxed collision validation hides them.
Reconciliation is separate from this new-tick budget: it can replay up to the existing
**48** retained inputs before a scheduling pass (at most **60** controller steps
combined). Its cost and replay count are reported separately. It is bounded, not
claimed to fit twelve total steps or any guaranteed CPU-time budget on every device.
Detailed results: `test-results/network-matrix.json`; baseline failing traces and
cycle logs are retained separately.

The full-suite stress run also exposed two outdated direct-socket drivers. Room
load generation now observes the production 48-input admission window and fails
immediately on protocol errors. The staircase driver explicitly releases its
four-tick steering bursts; an empty queue is no longer an implicit release. No
movement, collision, waypoint or acknowledgment assertions were relaxed. Both
complete test files passed **8/8** after these fixture corrections.
Another existing test compared slide speed across separated snapshots rather than
at the jump: it counted normal deceleration during a delayed command as lost jump
momentum. A test-only one-shot observer now records the actual transition without
changing it. The original 0.2 m/s tolerance is retained: measured snapshot difference
**0.620 m/s**, actual jump difference **0.02583 m/s**. The test explicitly waits for
authoritative slide progression, and its temporary player always leaves in `finally`.
The complete public-room integration file then passed **22/22**, including the
reconnect/eviction/leave cases previously polluted by the failed test's leaked player.

The real TCP/workerd responsiveness test now connects **six actual clients**, moves
five of them at 60/40/30/20 render FPS with jitter and 100–300 ms render stalls,
checks input bounds/live aim/convergence, reconnects the same session without health,
score/life/weapon resets, and verifies intentional Leave does not retry. Its focused
run passed, with an observed smoothed application RTT of about **54–60 ms**,
snapshot-arrival jitter **12–19 ms**, and maximum correction **0.20 m**. These are
local scheduling/link results, not WAN or Chromebook hardware measurements. The raw
credential-free telemetry is in `test-results/network-real-peers.json`.
In that focused run, the six peers' raw RTT medians ranged from **47–69 ms**;
RTT-variation medians were **1–15 ms** (four RTT samples per peer, a short sample).
The deterministic matrix reports application RTT **40–121 ms**, with at most 1 ms
variation between its sparse heartbeat samples. Snapshot jitter/bursts are tested
separately; these fixture values are not measurements of the public endpoint.
The subsequent full-suite run encountered strong local scheduling pressure
(~650 MB free of 16 GB RAM observed). Its six-peer responsiveness case still passed,
with smoothed app RTT **226–343 ms** and maximum correction **0.36 m**. The same
report path is overwritten by the newest run; use the associated log when comparing
runs. Memory pressure and timing variation were observed, but do not establish the
cause of every intermittent test failure.

The targeted protocol/responsiveness/traversal run passed **6/6**, including all five
guns crossing a genuine 250 ms command gap on the Industrial dock, interior stairs,
ladders, wall safety, respawn and reconnection. The expanded cycle-2 frontend run
passed **127/127** across eight files. Final timing/transport/matrix/Practice checks
passed **90/90**, the full frontend run passed **1167 with one existing skip**, and
the final backend run passed **104/104** (597 s). Earlier failed runs and their
fixture fixes are recorded in PROGRESS.md. Frontend/Worker typechecks and builds,
the real protocol gate and the seven dedicated-scaffold checks passed.

In the final six-peer run, raw RTT medians were **49.6–79.7 ms**, per-peer P95
**87.5–170.0 ms**, RTT-variation medians **8.5–25.4 ms** and peak position correction
**0.256 m**. They are short local samples, including injected jitter and scheduling.
Actual Chrome connected two isolated profiles and verified the standard client's
250 ms stall landing/reconnect, but the complete rendered two-client review did not
finish (scene-readiness timeout in the later rerun). The actual panel's independent
Chrome click/download check passed with saved real-peer data. Physical Chromebook
hardware and WAN gameplay remain unverified.

## Developer diagnostics

Open the game with `?netDiagnostics=1` (append `&netDiagnostics=1` when a query already
exists). This opt-in enables the panel and bounded frame/network sampling. It is
absent from normal UI/DOM. `?networkDebug` separately enables console lifecycle logs;
console debugging remains off by default.

The panel/report includes application RTT min/median/P95/max, RTT variation, server
handler and tick execution, server simulation debt/input queue, client handler and
event-dispatch age where observable, outgoing buffered bytes, recent one-second
snapshot/input rates, snapshot bytes, received/applied snapshot age, acknowledgment
age, pending input, correction magnitudes/frequency, camera corrections, frame stalls,
and connection/retry counters. Histories are bounded to **128 numeric samples per
metric**, **256 rate events per stream**, **128 lifecycle events**, and the existing
600-frame performance window. Sorting and DOM work occur only on report/panel refresh,
not each packet or fixed tick. Panel refresh is at most twice per second.

Press Escape to unlock the pointer, then use **Download report**. The JSON whitelist
never exports profile/session/room tokens, passwords, usernames, raw messages, player
snapshots or browser storage. It also omits free-form server/close text that could
contain sensitive data. `__crossfire.networkReport()` returns the same safe report
for local tooling. Optional server pong timings remain absent/unknown when talking
to an older compatible deployment; missing measurements are not fabricated as zero.

Application RTT includes scheduling at both ends. Server handler timing starts at
handler dispatch, so it cannot reveal time waiting before dispatch. Browser
`MessageEvent.timeStamp` can expose dispatch age on some implementations, but the
native incoming WebSocket queue's depth/arrival times are not exposed. Outgoing
`bufferedAmount` is **not** incoming backpressure. The report labels these limitations
instead of describing a late browser callback as slow internet.
Quiet rooms can stop their simulation/snapshot timer. A low snapshot rate or an old
applied snapshot while everyone is idle therefore does not by itself prove a backlog.
Server execution timings are runtime-clock samples, not guaranteed CPU profiles.
On deployed Cloudflare, clocks advance on I/O and can report zero during CPU work;
local workerd timers advance normally. The panel/report warns about this: zero does
not prove free processing. For deployed CPU cost, use the platform's profiler.
[Cloudflare's timer documentation](https://developers.cloudflare.com/workers/runtime-apis/performance/)
explains that difference; the custom tunnel's actual runtime remains unconfirmed.

## Local commands (PowerShell)

Backend terminal, from the repository root:

```powershell
$env:WRANGLER_LOG_PATH="$PWD\test-results\network-wrangler.log"
npm.cmd --prefix server run dev
```

Frontend terminal, from the repository root (process overrides; does not edit `.env.local`):

```powershell
$env:VITE_MULTIPLAYER_PROVIDER='cloudflare'
$env:VITE_MULTIPLAYER_URL='ws://127.0.0.1:8787/ws'
npm.cmd run dev
```

Open `http://localhost:5173/?netDiagnostics=1` in separate browser profiles. Identical
profile/session storage is deliberately not used for two independent players.

Useful checks:

```powershell
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=2
npm.cmd --prefix server run typecheck
npm.cmd --prefix server test
node --test server/tests/protocol.mjs
npm.cmd run build
node tools/network-browser-test.mjs
```

The browser tool builds an isolated production-mode frontend with a local endpoint,
blocks non-local HTTP requests, uses two isolated Chrome profiles and real Worker
sockets, and writes only to `.cache/` and `test-results/`. It never deploys or touches
the saved endpoint settings. Run heavy browser, frontend and backend suites serially
to avoid local CPU/memory contention producing misleading timeouts.

## Remaining limits / release

Release the frontend **and the actual active backend** to benefit from lossless
snapshots and movement continuation. The older optional v25 Cloudflare endpoint
needs a matching full release before it can serve current clients. Do not switch
Pages to that old endpoint as a workaround. No credential, origin policy, provider,
tunnel address, persistent Durable Object or deployment workflow was changed here.

The repo's Node dedicated scaffold still is not a gameplay backend. Updating that
scaffold alone would not update the currently hosted service. The administrator
must identify how the tunnel's backend process is built/restarted. Public gameplay,
WAN routing, a physical Chromebook, and unrelated server implementations have not
been verified. Sustained overload or long suspensions can still exhaust prediction
credit or incur correction; the diagnostics make the resulting debt/ack age visible.

References used for the investigation: [Gambetta's prediction/reconciliation](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html),
[Fiedler's fixed-timestep analysis](https://github.com/mas-bandwidth/gafferongames/blob/main/content/post/fix_your_timestep.md),
and [Chrome's explanation of WebSocket backpressure](https://developer.chrome.com/docs/capabilities/web-apis/websocketstream).
The implementation keeps the broadly supported WebSocket API; it does not depend
on WebSocketStream availability.
