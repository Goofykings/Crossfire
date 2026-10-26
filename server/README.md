# Crossfire multiplayer foundation (Stage 2)

Separate TypeScript Cloudflare Worker, SQLite-backed Durable Object and WebSocket backend. No deployment or account is needed for local development. The existing Vite configuration and GitHub Pages workflow are unchanged.

Stage 2 provides real connections and movement only. It uses a fixed European Town scene in the canonical `public-main` object. There is no round timer, randomized map, Teams, player combat, scoring, leaderboard or map expansion. Remote capsules represent actual connected sessions; they are temporary character visuals, not fabricated players.

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

Open `http://127.0.0.1:5180/?multiplayer` and press Play. Use independent browser profiles/incognito contexts to create two independent sessions. For automated testing, `?multiplayer&autoplay` skips pointer lock and the click-to-play card. The URL without `?multiplayer` keeps existing local practice behavior. No failed multiplayer attempt silently falls back to practice.

Check the HTTP health endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

The response includes `ok: true`, `stage: 2`, and `room: public-main`. The game WebSocket endpoint is `/ws`. Room IDs and resume credentials are not accepted in query strings.

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
```

The server build is `wrangler deploy --dry-run --outdir dist`: it bundles locally and **does not deploy**. Typecheck generates `server/worker-configuration.d.ts` from the installed runtime and config; that file is ignored. The server test builds the bundle, runs actual local workerd/Miniflare with temporary SQLite storage under ignored `server/.wrangler`, and opens real TCP/WebSocket clients. The browser test requires the two local servers above and locally installed Chrome/Edge; set `CHROME_PATH` if needed. Browser/runtime processes may need to run outside an agent's filesystem sandbox.

## Protocol and authority

- `shared/protocol.ts` defines versioned messages and runtime validators. The server accepts join, input batches, ping and leave. It never accepts client-assigned positions, teams, health, hits or scores. Each movement frame contains a sequence number, bounded movement intent and finite yaw/pitch; no client time delta is trusted.
- `shared/world.ts` builds the same generated map and rotated prop collision boxes for the Worker and browser. A map revision fingerprint rejects mismatched assets. The network scene omits practice targets consistently on both sides.
- The existing `PlayerController` runs at 120 Hz on the server, bounded by elapsed server time. Input is batched at 20 Hz and queued within a bounded budget; floods and replays are rejected. The client predicts locally, restores authoritative controller snapshots and replays unacknowledged inputs. No network schedule is tied to rendering FPS.
- Remote bodies interpolate approximately 100 ms behind server time, including yaw and look pitch. Ordinary idle frames are not repeatedly transmitted. Physics timers stop when movement settles or the room empties; heartbeat/session deadlines use an alarm. A sleeping object's session attachments reconstruct its live state without resetting liveness deadlines.
- Server-issued player IDs and opaque resume credentials identify sessions. Only the joining player receives their credential, which is stored per browser tab in `sessionStorage`, scoped to the endpoint. A lost connection can resume for 15 seconds. Explicit leave invalidates it. Generation/socket checks prevent an old socket's delayed close from removing its replacement.
- Client retries are bounded with exponential backoff. Missing responses trigger reconnect. After retries fail, the game shows Retry/Back, clears stale remote bodies and stops local movement. Disconnected/expired players disappear from server snapshots and the renderer; there are no manufactured opponents.

Initial room/session capacity is 16 with a bounded pending-handshake limit. Only two concurrent clients have been validated; this is not a production load-capacity claim.

## Configuration and later deployment

`wrangler.jsonc` declares the `ROOM` binding and SQLite class export. `ALLOWED_ORIGINS` is an exact comma-separated browser-origin list; localhost ports 5173 and 5180 are included for development. If a different frontend port or origin is used, configure that exact origin. An origin contains no repository path. The Worker rejects missing/untrusted origins, incorrect routes/methods and missing WebSocket upgrades. There is no wildcard origin or private credential embedded in the frontend.

The public frontend variable is `VITE_MULTIPLAYER_URL` (see root `.env.example`). Local development uses loopback `ws://`; public use requires `wss://`. An unset/invalid endpoint produces a real configuration error on the explicit multiplayer entry path; it does not affect practice. Environment values must be present when Vite starts or builds.

For a later approved public deployment, configure the owner's Worker account and exact Pages origin, deploy this separate Worker with its SQLite class binding, set the frontend's public endpoint to `wss://<worker-host>/ws`, rebuild the frontend, and repeat two-client checks over the public network. Backend credentials remain in the owner's deployment environment. No public endpoint or cloud deployment has been created or claimed here.

Next stage: the persisted server-owned public round schedule and map/mode transitions described in [MULTIPLAYER_ARCHITECTURE.md](../docs/MULTIPLAYER_ARCHITECTURE.md).
