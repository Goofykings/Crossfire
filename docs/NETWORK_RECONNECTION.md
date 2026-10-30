# Multiplayer reconnection diagnosis (2026-10-30)

The reproduced root cause was the frontend input watchdog, not a periodic Worker
disconnect. `fixedInput()` generated up to 120 frames/second but the transport
allowed only 24 unacknowledged frames. That window includes network propagation
and snapshot acknowledgment time, not just the server queue. At 250 ms ACK delay
it could sustain only about 96 frames/second. The prediction queue reached 120,
called `reconnect()`, closed an otherwise healthy WebSocket with code 4000 and
reason `reconnect`, and changed the UI. Welcomes reset the retry budget, allowing
the loop indefinitely. The regression against the original implementation first
showed `reconnecting` at 3,799 ms while receiving valid snapshots.

## Fix

- Keep the existing 20 Hz transport and maximum 12-frame batches. Measure real
  batch-to-snapshot ACK latency and adapt outstanding input from 24 to at most
  48 frames. Outstanding input always fits the Worker's unchanged 48-frame queue,
  even if packets arrive together. Catch-up batches can drain a rendering backlog.
- Keep the prediction queue bounded at 120. A full queue applies backpressure;
  it does not close a live socket or change connection status. Authoritative
  snapshots still reconcile motion and weapon state. No new simulation time,
  damage, position authority or weaker packet validation is introduced.
- Only an actual close schedules a reconnect/UI warning. Deduplicate state
  notifications and guard against overlapping opens and obsolete socket callbacks.
  Stop all transport/handshake/retry timers and visibility listeners on teardown.
- Retry genuine failures at most five times, with exponential delays starting at
  300 ms, 20% jitter and a 3-second maximum. A welcome alone no longer resets the
  failure budget; a connection must last 30 seconds. Intentional Leave cancels
  retries and invalidates the saved resume credential. Replaced sessions and
  incompatible protocol messages remain explicit fatal errors.
- Every valid server message updates receive liveness. Pings remain every 2
  seconds, the client receive timeout remains 8 seconds, the Worker inactivity
  timeout remains 10 seconds, and session grace remains 15 seconds. On visibility
  resume, send a fresh probe and allow queued traffic to arrive before timing out.
  A temporarily delayed pong does not override fresh snapshots. A truly silent
  open connection still times out and reconnects.

Protocol remains **v6**. There is no gameplay, map, storage or Vite/Pages change.
The existing Durable Object hibernation API, socket attachments, last-seen updates
and authoritative resume lifecycle were retained. Runtime tests exercise object
eviction and complete local runtime reconstruction separately.

## Diagnostics (off by default)

Open the game with `?networkDebug` (or append `&networkDebug`) for timestamped
`[crossfire network]` console events. Without this option there is no network
console logging. A bounded, token-free in-memory diagnostic record is available:

```javascript
window.__crossfire.network().diagnostics
```

It includes actual opens/closes, close code/reason, state changes, retry reason,
attempt/delay, handshake/receive timeouts, ping/pong timestamps and RTT, latest
valid message/ACK times, ACK latency, queue sizes and outstanding-window size.
`input_backpressure` with fresh traffic and an open socket means congestion, not
disconnection. `receive_timeout` means no valid traffic; `protocol_rejected`
means malformed/incompatible data. `session_replaced` means another connection
used the same resume credential. Tokens, guest IDs and raw packets are not logged.

For optional Worker console diagnostics, set `NETWORK_DEBUG` to the string
`true` in the Worker environment (leave unset normally). It logs accepted sockets,
restoration counts, joins/replacements, heartbeat sent/received/last-seen times,
protocol rejection codes, timeout source, disconnects and actual close codes and
reasons. No credentials or raw packets are logged. Local one-off command:

```powershell
Set-Location C:\Users\Public\Crossfire\server
npx.cmd wrangler dev --ip 127.0.0.1 --port 8787 --var NETWORK_DEBUG:true
```

For public diagnosis, capture the actual client close event and matching Worker
logs before attributing an interruption to Cloudflare. A healthy hibernating
Durable Object retains its accepted WebSockets; hibernation is not itself a
reason to reconnect. See Cloudflare's
[WebSocket lifecycle documentation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

## Local verification commands

Run the server tests, builds and browser suite sequentially on constrained machines.

```powershell
Set-Location C:\Users\Public\Crossfire
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=2
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run build
node tools/serve-dist.mjs --port 4198 --base /crossfire/
```

In a second PowerShell terminal, after the build and static server are ready:

```powershell
Set-Location C:\Users\Public\Crossfire
node tools/reconnection-test.mjs --url http://127.0.0.1:4198/crossfire/
```

The browser tool starts its own isolated local Worker and redirects actual
WebSockets to it. Two independent Chrome contexts use the production frontend and
real server-approved players. Low quality, half render resolution and a test-only
animation-frame delay bound GPU/CPU contention; elapsed-time physics and all
production network/heartbeat timers remain unchanged. This is not an FPS benchmark.
It delays real incoming messages by 250 ms, keeps
both clients active for over 60 seconds, verifies continuous ACK progress,
movement/orientation, then closes actual server sockets and checks authenticated
resume, one active connection, no duplicate actors and unchanged health,
ammunition, life, team, scores, map, mode and round deadline. It also checks Leave
cleanup and default-silent logging. Test-only RPC can place actual players and
close their sockets; it never fabricates a roster, damage or successful connection.
The server suite separately checks earned nonzero kills/deaths/team scores and
weapon state across resume, plus validation, heartbeat expiry and DO restoration.
Browser evidence is written to ignored `test-results/reconnection/results.json`.
Use `--out <directory>` to keep separate runs; the final recorded run uses
`test-results/reconnection-final/results.json`.

For ordinary interactive local development, use the two PowerShell terminals in
[server/README.md](../server/README.md#start-locally-in-two-powershell-terminals).

## Deployment boundary

The loop fix requires publishing a rebuilt **frontend**. Keep the GitHub Actions
`VITE_MULTIPLAYER_URL` repository variable pointing to the existing public
`wss://<worker-host>/ws`, not the local test URL. The Worker changes in this task
only add opt-in diagnostics; redeployment is needed to obtain those diagnostics,
not for the client fix against an already matching v6 Worker. Earlier unshipped
protocol-v6 changes in this working tree still require a matching Worker/frontend
release together when authorized. Preserve the existing room and SQLite data.

Local tests establish local behavior only. No public Cloudflare deployment or
live public two-browser session was performed, and no commit, push or deployment
is authorized by this task. Recheck the public endpoint and two real public
clients after an authorized release; retain the diagnostics if the symptom recurs.
