# Slow and unstable connections — 2026-11-17

This continues the existing networking repairs; it does not replace the transport,
prediction system or authoritative simulation. The preceding enlarged touch controls
are retained. No commit, push, deployment or endpoint switch is performed.

## Architecture inspected

- Gameplay backend source is `server/src/index.ts`: a Cloudflare Worker and SQLite
  Durable Objects, with one canonical `public-main` plus the existing room system.
  The Node dedicated-server directory remains an incomplete scaffold.
- `.env.local` points to the existing Cloudflare WSS URL. The current Pages workflow
  explicitly selects `custom` and a trycloudflare tunnel URL. Neither was changed.
  Local tests establish what this repository's Worker does, not what currently runs
  behind that public tunnel; no production load test was made.
- WebSocket/TCP carries validated protocol **28**. Server physics and prediction
  are 120 Hz; active snapshots and normal input packets are 20 Hz. Each input packet
  holds at most 12 frames. At most 48 unacknowledged inputs are admitted/retained.
  Idle updates are suppressed, with independent 2-second client heartbeats.
- Compact independent snapshots and input tuples already avoid many repeated field
  names and preserve exact simulation checkpoint precision. Snapshots do not depend
  on a delta chain. Broadcast encoding is shared per wire format. Environmental
  reactions already use event-based updates. These working paths were retained.
- Inputs have sequence numbers; acknowledgments retire them before authoritative
  restore/replay. Local yaw/pitch remain local. Identical replay preserves render
  endpoints; stale checkpoints are rejected. Existing safe small-correction handling,
  bounded simulation debt/work, input-hold expiry, respawn and map barriers remain.
- The client processes validation, ACKs and reliable events immediately. Game has
  one replaceable ordinary-living presentation snapshot. Remote histories have at
  most 30 samples. Deaths, spawns, round results and map changes are barriers;
  damage, shots, eliminations, chat, inventory and purchase events are not discarded.
- Remote poses use shortest-path yaw and linear position interpolation, at most
  100 ms of collision-constrained velocity extrapolation, then a bounded stop.
  Lives and large teleports reset history. No Hermite overshoot was introduced.

## Confirmed defects and engineering passes

**Pass one:** the interpolation target included variation between arrivals but not
the underlying one-way delay. A steady 350 ms RTT still needs about 175 ms before
its next state can arrive, even before jitter and a snapshot interval. The old
160 ms cap plus 100 ms extrapolation exhausted its data under the requested noisy
profile. In the deterministic six-history fixture, 21.12% of moving samples froze
at 60 FPS and 8.78% at 30 FPS, excluding the intentional outage.

`NetworkTiming` now approaches `clamp(RTT / 2 + 50 ms + arrival jitter, 65, 250)`.
The existing asymmetric adjustment and monotonic playhead avoid rewinding or
instantaneously changing speed when padding changes. This is remote presentation
only. The 100 ms extrapolation limit and authoritative hit-validation limits remain.

**Pass two:** remote extrapolation used the controller's raised step collision band
without performing the controller's step-up. A grounded body could therefore move
0.60 m into a 0.30 m riser at its old foot height. The regression now stops it at
0.26 m, outside the solid. Extrapolation and its visual correction sweep use the
actual foot band; an authoritative later snapshot supplies real step height.
Airborne collision and existing wall constraints remain covered.

The audit also reproduced unnecessary 120 Hz idle-look input. A settled standing
body with no movement, stance, ADS or combat now samples *only its networked look*
at the existing 20 Hz snapshot cadence. Real movement, releases, jump, ADS,
reload/fire, grenade and melee transitions bypass this branch; a new shot includes
the current local direction. The camera is never throttled. No tick rate, movement
speed, damage, cooldown, collision or hitbox rule changed.

## Controlled comparisons

Six timestamped remote histories, 30 simulated seconds per case, ordered delivery,
an 800 ms delivery stall, at 60/30/20 FPS. The stable sample excludes the deliberate
outage/recovery interval; it does not conceal it as a healthy network. These are
deterministic fixture results, not internet/hardware performance measurements.

| Configured RTT / jitter | Old median buffer | New median buffer | Frozen moving samples at 60 FPS, old → new |
| --- | ---: | ---: | ---: |
| 20 / 5 ms | 74 ms | 69 ms | 0 → 0% |
| 60 / 15 ms | 92 ms | 107 ms | 0 → 0% |
| 120 / 30 ms | 119 ms | 164 ms | 0 → 0% |
| 200 / 60 ms | 138 ms | 223 ms | 0 → 0% |
| 350 / 100 ms | 154 ms | 250 ms | 21.12 → 0% |

All 15 cases have zero frozen moving samples after repair. The 20 FPS baseline was
0.59% at the worst profile; the 30 FPS baseline was 8.78%. More buffering costs
remote presentation latency: about +15/+45/+85/+96 ms in the four slower cases,
and -5 ms in the fastest fixture. It adds no intentional local input latency.
The existing 15-case movement matrix and 15 new requested RTT/jitter/FPS cases all
land on the Industrial dock and converge; pending inputs and new work remain bounded
at 48 and 12 respectively. Exact peaks are in the JSON reports.

One-second, otherwise identical, protocol-validated idle-look fixture:
**120 → 20 input frames, 8,635 → 2,779 application bytes (67.8% less)**. The reference
mode restores only the previous unthrottled sampler inside the test. Local yaw is
identical; movement and fire edges still send immediately. This is a specific idle-
looking workload, not a claim of a 68% reduction for moving/combat players.

Real six-peer TCP/workerd tests cover all five profiles, two peers each at 60/30/20
FPS, over a minute of movement, jumps/slides, an ordered 800 ms stall, actual damage,
100-point elimination scoring, duplicate protection, respawn, authenticated resume,
one remote identity, reliable chat and two map transitions. Reports contain actual
application byte rates, ACK latency, RTT/jitter, snapshot gaps/bytes/age, corrections,
bounded queue sizes and CPU timing. Final results and run-specific values are in
PROGRESS.md; do not substitute configured RTT for measured application RTT.

## Diagnostics and interruption behavior

Use `?netDiagnostics=1` to open the existing report panel. Numeric telemetry is
disabled by default. Histories are bounded (128 samples per metric, 512 byte-rate
events per direction). Text refreshes at most twice per second. Payloads,
credentials and player names are not retained in exported telemetry.

Added actual incoming/outgoing UTF-8 application byte rates/totals, reconnect retry
and obsolete-snapshot counters, one-pending-presentation queue count, and measured
quality classification (unknown until a probe, then excellent/good/unstable/poor).
Worsening needs one second of sustained evidence; recovery needs eight. Quality
does not change gameplay rules. RTT median/P95 and variation, ACK delay, processing
time, corrections and frame stalls remain separate measurements.

The normal HUD shows a small warning only when an outstanding input is more than
1.5 seconds old or no server traffic has arrived for 4.5 seconds. Quiet snapshots
alone do not cause it; normal 2-second heartbeats suffice. The warning clears on
recovery. Genuine 8-second receive failures still close the socket and use the
existing bounded exponential retries/jitter. Leave stops retries. Reconnect clears
obsolete prediction state and restores server-owned identity/state.

`bufferedAmount` is outgoing bytes, not an incoming backlog. Browser receive-side
TCP queues are not observable. Application RTT includes scheduling; Worker timing
excludes dispatch wait and may use a frozen platform clock. No claim here isolates
pure radio/network latency or proves zero server CPU time from a zero measurement.

## Reproduction

```powershell
npm.cmd test -- tests/poorNetwork.test.ts tests/networkMatrix.test.ts tests/networkSmoothing.test.ts tests/networkDiagnostics.test.ts tests/multiplayerTransport.test.ts tests/idleLook.test.ts
npm.cmd --prefix server run build
node --test server/tests/poor-network.mjs
npm.cmd --prefix server test
npm.cmd run typecheck
npm.cmd --prefix server run typecheck
npm.cmd test -- --maxWorkers=1
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 4263 --strictPort
# In another terminal, against that local frontend and an isolated real Worker:
node tools/network-jitter-browser-test.mjs http://127.0.0.1:4263/
```

Files under ignored `test-results/`: `poor-network-baseline/pass1/pass2.json`,
`poor-network-movement.json`, `idle-look-comparable-baseline.json`,
`idle-look-after.json`, `poor-network-real-peers.json` and corresponding logs.
The browser tool records real rendered poses versus its explicitly historical
fixed-buffer comparator, not versus this task's immediate pre-change renderer.
Desktop Chrome WebGL/Chromebook preset is not physical Chromebook validation.
Its lifetime correction totals include deliberate test placements; the 17.8 m
placement in this run is not a network-induced correction. The first browser
attempt's fixed one-off aim missed a moving body. Continuous rendered-target
tracking on a bounded real route then confirmed actual damage without changing
server validation. The completed run recorded 308 moving frames, zero freezes
versus 179 for its historical comparator, zero page errors, and warning/recovery
through a 2.3-second ordered delivery pause with no reconnect or yaw drift.

## Limits and release

TCP ordering/head-of-line blocking remains. An ordered delivery stall cannot be
removed by discarding messages after receipt. At 350 ms RTT plus jitter, input ACKs
can exhaust the unchanged 48-frame prediction window; after an outage authority
can still require a large positional correction. Those corrections are measured,
not hidden. Camera input stays local; remote extrapolation stops after 100 ms.
The server's 300 ms maximum hit rewind was not expanded, so very delayed rendered
moving targets may be outside compensation. No slow-network gameplay advantage
is granted.

Full independent six-player snapshots remain a material downstream cost (the first
real runs measured roughly 70–78 kB/s per receiving player while all six moved).
No reduction of that moving/combat downstream workload is claimed. Removing that
cost needs a separately designed compatible metadata/delta or transport-compression
change, including fresh-join/reconnect and authoritative checkpoint testing. This
task preserves the current wire format, independent checkpoints and protocol 28.

Production changes are frontend-only; no Worker redeployment or persistent-state
migration is required. The expanded backend test is a test fixture, not a public
endpoint. Pages/frontend must be rebuilt/released when authorized. Existing origins,
URLs, Vite base, room configuration, rewards and authentication remain unchanged.
Public/WAN school-Wi-Fi behavior and physical Chromebook performance still require
real device testing. No perfect-playability guarantee is made for unusable links.

## File manifest

- `src/network/NetworkTiming.ts`: RTT-aware padding, measured quality/hysteresis.
- `src/network/remoteMotion.ts`, `src/game/RemotePlayers.ts`: full-foot visual sweeps.
- `src/network/MultiplayerClient.ts`: idle-look sampler, warning, byte/retry/stale telemetry.
- `src/network/NetworkDiagnostics.ts`: bounded application bandwidth counters/rates.
- `src/ui/NetworkDiagnosticsOverlay.ts`: quality, bandwidth, queues and reconnect display.
- `src/game/Game.ts`, `src/ui/UI.ts`, `src/styles.css`: warning and report integration.
- `tests/poorNetwork.test.ts`, `tests/idleLook.test.ts`: new controlled comparisons.
- `tests/networkMatrix.test.ts`, `tests/networkSmoothing.test.ts`,
  `tests/networkDiagnostics.test.ts`, `tests/multiplayerTransport.test.ts`: regressions.
- `server/tests/poor-network.mjs`, `server/package.json`: new real TCP integration gate.
- `tools/network-jitter-browser-test.mjs`: rendered check, actual warning/recovery,
  private telemetry and bounded cleanup of its own browser process.
- This document and `PROGRESS.md`: evidence, commands, tradeoffs and release limits.
