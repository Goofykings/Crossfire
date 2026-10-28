# Crossfire multiplayer backend

Separate TypeScript Cloudflare Worker, SQLite-backed Durable Object and WebSocket backend. No deployment or account is needed for local development. The existing Vite configuration and GitHub Pages workflow are unchanged.

The 2026-10-27 combat update uses **protocol v5**. The Worker now simulates existing weapons from control input, validates player hits against its map world, synchronizes health and owns eliminations, kills/deaths, team totals and respawn eligibility. Actual FFA/Teams modes derive from the persisted server schedule, with balanced team assignment and no friendly fire. Health/gun state survive valid resumes. `GET /health` reports `protocol: 5`. **Redeploy the Worker and publish a matching frontend when authorized; neither is automatically deployed by this task.** See [combat/visibility implementation, tests, limits and commands](../docs/MULTIPLAYER_COMBAT.md). Character animation integration remains pending its real GLB.

The previous Stage A (2026-10-27) used protocol v4; this paragraph is migration history. Rebuild the frontend and Worker together: old v3 movement packets are intentionally rejected. Input supplies held slide intent, never speed, position, direction overrides or cooldown timers. The shared 120 Hz controller owns slide duration/speed/steering/cooldown and snapshots carry all replay/press state. Missing input preserves the held Shift latch, so network gaps cannot manufacture presses. The frontend sends idle releases and preserves quick release/repress events across fixed ticks. Legacy stored movement records return to pre-spawn rather than restoring an incompatible controller state. Four bench placement adjustments also change the affected map revisions. No deployment was performed.

The existing Worker/Durable Object/WebSocket transport now integrates **all three existing maps** into the canonical `public-main` room. The backend previously imported only European Town collision/layout and published a Town-only snapshot; the frontend registry/assets were already complete. `server/src/world.ts` now supplies matching collision/revisions/spawns for Town, Industrial and City.

A persisted epoch and server-generated seed define 600-second map rounds. Every randomized three-map bag includes all three maps. The room derives its current round/deadline from wall-clock time on requests, movement ticks and alarms, so hibernation/restarts and empty-room time do not reset it. There is no busy empty-room clock loop. Connected players receive the same round/map, return to pre-spawn at transitions and load the selected map before requesting a spawn. Existing alive/loadout/session/resume behavior is retained. The SMG is now an implemented fourth legal loadout.

Player combat and Teams are now implemented locally as described above. The character model/animation export and public deployment verification remain pending. The older stage descriptions below are historical where they describe missing combat.

## Start locally in two PowerShell terminals

Install the root and separate server dependencies once:

```powershell
Set-Location C:\Users\Public\Crossfire
npm.cmd ci
npm.cmd ci --prefix server
```

Terminal 1 - Worker on port 8787:

```powershell
Set-Location C:\Users\Public\Crossfire
$env:WRANGLER_SEND_METRICS = 'false'
npm.cmd run dev --prefix server
```

Terminal 2 - existing Vite frontend on port 5180:

```powershell
Set-Location C:\Users\Public\Crossfire
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Open `http://127.0.0.1:5180/` and press Play. This connects and loads the current server-selected map, then stops at the pre-spawn menu. Select a weapon and press Spawn. Escape opens the pause/Leave Match menu, including before spawning. Use independent browser profiles/incognito contexts for independent players. `?multiplayer` remains compatible; `?autoplay` explicitly requests a spawn for automation. Use `?practice&autoplay` for the original local weapon/map regression tools. Failed multiplayer never falls back to practice.

Check the HTTP health endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

The response includes `ok: true`, `stage: 2`, and `room: public-main`. The game WebSocket endpoint is `/ws`; read-only `GET /presence` returns `{ room: "public-main", online: <actual connected session count> }`. It creates no WebSocket/session and returns no identities or credentials. The home polls every five seconds while visible, with a three-second timeout and Offline fallback. Both presence CORS and WebSocket upgrades use the exact Origin allowlist. Local production-subpath checks use port 4176, which is explicitly allowlisted alongside 5173/5180. Room IDs and resume credentials are not accepted in query strings.

## Checks

```powershell
Set-Location C:\Users\Public\Crossfire
$env:WRANGLER_SEND_METRICS = 'false'
npm.cmd run typecheck --prefix server
npm.cmd run build --prefix server
npm.cmd test --prefix server
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node tools/multiplayer-test.mjs --url http://127.0.0.1:5180/
node tools/prespawn-test.mjs --url http://127.0.0.1:5180/
node tools/prespawn-test.mjs --lifecycle-fixture --url http://127.0.0.1:5180/
```

The server build is `wrangler deploy --dry-run --outdir dist`: it bundles locally and **does not deploy**. Typecheck generates `server/worker-configuration.d.ts` from the installed runtime and config; that file is ignored. The server test builds the bundle, runs actual local workerd/Miniflare with temporary SQLite storage under ignored `server/.wrangler`, and opens real TCP/WebSocket clients. The browser tests require the two local servers above and locally installed Chrome/Edge; set `CHROME_PATH` if needed. `--lifecycle-fixture` starts an isolated actual Worker and redirects test-browser requests to its real endpoint. A test-only subclass RPC seeds a real session below the world; production never bundles that entry. It verifies server fall elimination and approved respawn without inventing combat. Runtime hibernation tests run before this RPC, whose test stub can retain an active runtime reference. Browser/runtime processes may need to run outside an agent's filesystem sandbox.

## Protocol and authority

- `shared/protocol.ts` defines versioned messages and runtime validators. Protocol v5 accepts join, spawn (legal weapon + matching map revision + round ID + request ID), input batches, ping and leave. Client and server must be updated together; older frontends cannot consume the slide-state schema. Joining creates a connected menu session with `alive=false`, no weapon and no avatar. Only approved Spawn increments the life and fixes the weapon; repeated spawn/loadout changes while alive are rejected. Snapshots carry map ID/revision, round ID/deadline, server-owned life/weapon and kills/deaths. Old-round movement/spawn requests are rejected without dropping the connection; clients wait for the current map before spawning. Movement input before spawn is rejected. It never accepts client-assigned positions, teams, health, hits or scores. Each movement frame contains a sequence number, bounded movement intent and finite yaw/pitch; no client time delta is trusted.
- `shared/world.ts` builds the same generated map and rotated prop collision boxes for the Worker and browser. A map revision fingerprint rejects mismatched assets. The network scene omits practice targets consistently on both sides.
- The existing `PlayerController` runs at 120 Hz on the server, bounded by elapsed server time. Input is batched at 20 Hz and queued within a bounded budget; floods and replays are rejected. The client predicts locally, restores authoritative controller snapshots and replays unacknowledged inputs. No network schedule is tied to rendering FPS.
- Only spawned players get remote bodies; connected menu players remain in presence/scoreboard. Remote bodies interpolate approximately 100 ms behind server time, including yaw and look pitch. Ordinary idle frames are not repeatedly transmitted. Physics timers stop when movement settles or the room empties; heartbeat/session deadlines use an alarm. A sleeping object's session attachments reconstruct its live state without resetting liveness deadlines.
- Server-issued player IDs and opaque resume credentials identify sessions. Only the joining player receives their credential, which is stored per browser tab in `sessionStorage`, scoped to the endpoint. A lost connection can resume for 15 seconds. Explicit leave invalidates it. Generation/socket checks prevent an old socket's delayed close from removing its replacement.
- Client retries are bounded with exponential backoff. Missing responses trigger reconnect. After retries fail, the game shows Retry/Back, clears stale remote bodies and stops local movement. Disconnected/expired players disappear from server snapshots and the renderer; there are no manufactured opponents.

Initial room/session capacity is 16 with a bounded pending-handshake limit. Two independent player clients plus a read-only home observer have been validated; this is not a production load-capacity claim.

## Configuration

`wrangler.jsonc` declares the `ROOM` binding and SQLite class export. `ALLOWED_ORIGINS` is an exact comma-separated origin list. Development ports 5173/5180 and production-subpath test port 4176 are included. Configure any other frontend origin explicitly, without a repository path; no wildcard is used. `/ws` requires an allowed Origin and a WebSocket upgrade. `/presence` allows read-only non-browser HTTP requests and sends CORS headers only for allowed browser origins.

The public frontend variable is `VITE_MULTIPLAYER_URL` (root `.env.example`). Set it before Vite starts or builds: local loopback `ws://`, public `wss://`. A missing URL shows Offline on home and a configuration error on Play. Explicit practice remains available.

This focused task does not authorize sliding, changes to the existing rifle/shotgun/sniper models, map expansion, target removal or Extreme/FPS work. Teams, combat and results require separate work.

## Public configuration (no deployment performed)

Keep GitHub Pages serving only `dist/`. Before a separately approved backend deployment, set the Worker `ALLOWED_ORIGINS` to the exact Pages origin (no repository path), retain only intended development origins, deploy the existing Worker/SQLite Durable Object configuration, and verify `/health`, `/presence` and two real browsers against `/ws`. Set the repository Actions variable `VITE_MULTIPLAYER_URL` to the deployed `wss://<worker-host>/ws` and rebuild the Pages frontend; the existing workflow already reads it. Never put Cloudflare credentials in frontend configuration. No public endpoint has been established or tested here. A missing URL yields Offline on home and a real configuration error on Play.

## Rotation validation and runtime references

`tests/rotation.test.ts` covers complete random bags, deadline boundaries, reproducibility, empty-room catch-up and collision-clear grounded spawns on every map. The Worker integration suite runs two actual WebSocket clients through all maps, all four approved weapons, stale-round input and runtime restart. The production browser fixture uses real sockets and server snapshots, advancing only the isolated test room's persisted epoch through a test-only RPC; it verifies both browsers load each map and that reconnecting during map loading recovers. No test controls are bundled by `server/wrangler.jsonc`.

Clock reconciliation is idempotent because Cloudflare [alarms can execute more than once](https://developers.cloudflare.com/durable-objects/api/alarms/). Session reconstruction continues to use the existing [hibernatable WebSocket attachments](https://developers.cloudflare.com/durable-objects/best-practices/websockets/). No Cron Trigger or additional backend service was added.

### Guest display names

Guest profiles are browser preferences, not authentication. The frontend sends the applied username in the versioned `join` message; no local guest ID is transmitted. `shared/username.ts` normalizes NFKC, strips controls/angle brackets, trims and limits names to 24 Unicode characters. The Worker reruns that policy, falling back to Player for an empty sanitized name, and assigns its own random session UUID and resume credential. Only a valid existing resume credential can resume a session; a changed display name on that join preserves its authoritative ID/state. Profile edits take effect on the next join/reconnect. No account/profile database or new protocol message is added. Public deployment was not performed; the updated Worker is needed for renames during resumed joins.
