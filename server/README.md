# Crossfire multiplayer backend

Separate TypeScript Cloudflare Worker, SQLite-backed Durable Object and WebSocket backend. No deployment or account is needed for local development. The existing Vite configuration and GitHub Pages workflow are unchanged.

The multiplayer foundation now supports the latest gameplay/UI **Stage 1**: HTTP presence, connected pre-spawn sessions, server-approved spawns, per-life weapon locking, real kills/deaths fields, and a held-Tab leaderboard. Normal Play connects to `public-main`; explicit `?practice` retains local development gameplay and all three maps.

The existing backend still runs a fixed European Town scene. **Rounds, randomized maps, Teams assignments and player-vs-player combat are not implemented.** Match mode/deadline are explicitly null; the scoreboard displays `Mode unavailable · --:--`. Kills start at zero and no local target hits award multiplayer points. Server-detected falls increment deaths and return the player to pre-spawn. This is not a complete public match. The fourth SMG slot is disabled pending the user's next stage.

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

Open `http://127.0.0.1:5180/` and press Play. This connects and loads the server map, then stops at the pre-spawn menu. Select a weapon and press Spawn. Escape opens the pause/Leave Match menu, including before spawning. Use independent browser profiles/incognito contexts for independent players. `?multiplayer` remains compatible; `?autoplay` explicitly requests a spawn for automation. Use `?practice&autoplay` for the original local weapon/map regression tools. Failed multiplayer never falls back to practice.

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

- `shared/protocol.ts` defines versioned messages and runtime validators. Protocol v2 accepts join, spawn (legal weapon + matching map revision + request ID), input batches, ping and leave. Client and server must be updated together. Joining creates a connected menu session with `alive=false`, no weapon and no avatar. Only approved Spawn increments the life and fixes the weapon; repeated spawn/loadout changes while alive are rejected. Snapshots carry server-owned life, weapon, kills/deaths and match metadata. Movement input before spawn is rejected. It never accepts client-assigned positions, teams, health, hits or scores. Each movement frame contains a sequence number, bounded movement intent and finite yaw/pitch; no client time delta is trusted.
- `shared/world.ts` builds the same generated map and rotated prop collision boxes for the Worker and browser. A map revision fingerprint rejects mismatched assets. The network scene omits practice targets consistently on both sides.
- The existing `PlayerController` runs at 120 Hz on the server, bounded by elapsed server time. Input is batched at 20 Hz and queued within a bounded budget; floods and replays are rejected. The client predicts locally, restores authoritative controller snapshots and replays unacknowledged inputs. No network schedule is tied to rendering FPS.
- Only spawned players get remote bodies; connected menu players remain in presence/scoreboard. Remote bodies interpolate approximately 100 ms behind server time, including yaw and look pitch. Ordinary idle frames are not repeatedly transmitted. Physics timers stop when movement settles or the room empties; heartbeat/session deadlines use an alarm. A sleeping object's session attachments reconstruct its live state without resetting liveness deadlines.
- Server-issued player IDs and opaque resume credentials identify sessions. Only the joining player receives their credential, which is stored per browser tab in `sessionStorage`, scoped to the endpoint. A lost connection can resume for 15 seconds. Explicit leave invalidates it. Generation/socket checks prevent an old socket's delayed close from removing its replacement.
- Client retries are bounded with exponential backoff. Missing responses trigger reconnect. After retries fail, the game shows Retry/Back, clears stale remote bodies and stops local movement. Disconnected/expired players disappear from server snapshots and the renderer; there are no manufactured opponents.

Initial room/session capacity is 16 with a bounded pending-handshake limit. Only two concurrent clients have been validated; this is not a production load-capacity claim.

## Configuration

`wrangler.jsonc` declares the `ROOM` binding and SQLite class export. `ALLOWED_ORIGINS` is an exact comma-separated origin list. Development ports 5173/5180 and production-subpath test port 4176 are included. Configure any other frontend origin explicitly, without a repository path; no wildcard is used. `/ws` requires an allowed Origin and a WebSocket upgrade. `/presence` allows read-only non-browser HTTP requests and sends CORS headers only for allowed browser origins.

The public frontend variable is `VITE_MULTIPLAYER_URL` (root `.env.example`). Set it before Vite starts or builds: local loopback `ws://`, public `wss://`. A missing URL shows Offline on home and a configuration error on Play. Explicit practice remains available.

The next stage in the latest user brief is Stage 2: sliding, SMG and weapon models. It requires a new instruction. The original architecture's public round schedule/Teams/combat are still prerequisites for a complete match, not features claimed by this UI stage.

## Public configuration (no deployment performed)

Keep GitHub Pages serving only `dist/`. Before a separately approved backend deployment, set the Worker `ALLOWED_ORIGINS` to the exact Pages origin (no repository path), retain only intended development origins, deploy the existing Worker/SQLite Durable Object configuration, and verify `/health`, `/presence` and two real browsers against `/ws`. Set the repository Actions variable `VITE_MULTIPLAYER_URL` to the deployed `wss://<worker-host>/ws` and rebuild the Pages frontend; the existing workflow already reads it. Never put Cloudflare credentials in frontend configuration. No public endpoint has been established or tested here. A missing URL yields Offline on home and a real configuration error on Play.
