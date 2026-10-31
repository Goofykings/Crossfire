# Preparing a dedicated multiplayer server

The Cloudflare Worker remains the current gameplay server. The separate
`server-dedicated/` project is a Node.js transport scaffold: it validates real
WebSocket messages with the shared protocol but **cannot run a match**. It does
not create players, issue session credentials, simulate movement or combat,
produce presence counts, or send fabricated snapshots. Valid messages receive
the fatal `server_incomplete` error; `/health` returns `ready: false`.

## Configuration in the frontend

Vite embeds these public values at build time. Restart Vite after changes; a
production or GitHub Pages build must be rebuilt after changing them.

| Variable | Purpose |
| --- | --- |
| `VITE_MULTIPLAYER_PROVIDER` | `cloudflare` (default) or `custom`; other values produce a configuration error on Play. |
| `VITE_MULTIPLAYER_URL` | Existing Cloudflare override; if empty, the default is `wss://crossfire-multiplayer.maxwellmaahs.workers.dev/ws`. Existing `.env.local` overrides continue to work. |
| `VITE_CUSTOM_MULTIPLAYER_URL` | Required only for `custom`; explicitly set it to the future dedicated server's WebSocket URL. |

The separate custom URL prevents an existing Cloudflare override from being
mistaken for the custom host. A missing or invalid custom URL produces a clear
error when Play is pressed and never silently connects to Cloudflare. Presence
polling uses the selected host's root `/presence` endpoint. No provider setting
creates a player on the home screen. Resume credentials are scoped to the
WebSocket URL, so sessions do not transfer automatically between hosts.

`wss://` is required for a public endpoint. `ws://` is accepted only for
`localhost`, `127.0.0.1`, or `[::1]`; local HTTP Pages-style testing also works.
The URL must contain no username, password, query string or fragment. Never put
passwords, API keys, Cloudflare tokens, or server administration credentials in
any `VITE_` variable: they are visible in the browser bundle.

## Local scaffold

From the project root in PowerShell, with Node.js 24 and npm installed:

```powershell
npm.cmd --prefix server-dedicated ci
npm.cmd --prefix server-dedicated test
$env:DEDICATED_HOST = '127.0.0.1'
$env:DEDICATED_PORT = '8788'
$env:ALLOWED_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173'
npm.cmd --prefix server-dedicated start
```

In a second PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8788/health
$env:VITE_MULTIPLAYER_PROVIDER = 'custom'
$env:VITE_CUSTOM_MULTIPLAYER_URL = 'ws://127.0.0.1:8788/ws'
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/` and press Play. The expected result today is the
explicit incomplete-server error, with Retry and Back. A 503 from `/presence`
is also expected. This is a transport and protocol check, not a playable match.
The WebSocket route rejects missing or unlisted browser Origins, malformed
messages, oversized payloads and incompatible versions. `ALLOWED_ORIGINS` is
a comma-separated list of exact HTTP(S) origins, without paths or wildcards.
The scaffold binds only to loopback by default; host and port are configurable
with `DEDICATED_HOST` and `DEDICATED_PORT` (1–65535).

## Future deployment and switching

Do not switch the published frontend until the authoritative room has been
ported and tested. Once it is ready, the server administrator should:

1. Choose a public hostname such as `game.example.com`, point its DNS record to
   the dedicated server, and provide valid TLS for that hostname. The current
   Node scaffold serves plain HTTP locally; it does **not** implement TLS.
   Terminate HTTPS/WSS at a reverse proxy that forwards WebSocket upgrades and
   `/health`, `/presence`, and `/ws` to the Node service. For example, a Caddy
   site can use `reverse_proxy 127.0.0.1:8788` once DNS and certificates are set.
2. Permit inbound TCP 443 for HTTPS/WSS and, if needed for certificate issuance
   or HTTP redirects, TCP 80. Keep port 8788 bound to loopback or otherwise
   restricted to the reverse proxy. The administrator must configure both the
   host firewall and any network/router or cloud firewall.
3. Run the built Node service under a supervisor, set its host/port and
   `ALLOWED_ORIGINS` to the exact frontend origins (for example,
   `https://goofykings.github.io`, without `/crossfire/`), and set up persistent
   server state. The future implementation must preserve the existing protocol
   and map revisions or deliberately coordinate a versioned frontend change.
4. Check `https://game.example.com/health`, origin rejection, protocol and
   revision compatibility, then test at least two real independent browsers
   through WSS. Verify movement, combat, health, respawn, scores, chat, rounds,
   reconnects, persistence, and empty-room time progression before switching.

For a **future local build** after the game server is implemented:

```powershell
$env:VITE_MULTIPLAYER_PROVIDER = 'custom'
$env:VITE_CUSTOM_MULTIPLAYER_URL = 'wss://game.example.com/ws'
npm.cmd run build
```

For GitHub Pages, set the repository Actions variables
`VITE_MULTIPLAYER_PROVIDER=custom` and
`VITE_CUSTOM_MULTIPLAYER_URL=wss://game.example.com/ws`, then run the existing
Pages workflow. `VITE_MULTIPLAYER_URL` may retain the Cloudflare address. The
workflow passes all three values to the frontend build; it does not deploy the
dedicated service. To switch back, set `VITE_MULTIPLAYER_PROVIDER=cloudflare`
(or remove it), keep `VITE_MULTIPLAYER_URL` set to the Worker URL or leave it
empty for the default, and rebuild/redeploy the Pages frontend. These values are
repository **variables**, not secrets or administrative credentials.

## What still needs porting

The runtime-neutral pieces already include `shared/protocol.ts`, `shared/maps.ts`,
`shared/combat.ts`, `shared/spawns.ts`, `shared/health.ts`, the fixed-step player
controller, collision world, weapon simulation and shared map revision logic.
The current authoritative room in `server/src/index.ts` still combines those
rules with Cloudflare Durable Object storage, hibernatable WebSocket attachments,
alarms, connection lifecycle and reconstruction. Its entrypoint and platform
APIs cannot simply be imported into Node.

Before a real migration, extract or adapt that room's authoritative state
machine and supply a Node transport, secure random server-assigned sessions and
resume credentials, bounded queues/rate limits, heartbeat and reconnect handling,
durable persistence and timers. Port round scheduling/rotation including empty
rooms, spawn and map revision agreement, movement and hit validation, health
regeneration, elimination/respawn, team assignment, scores, chat and snapshots.
Match authentication is server-issued session/resume identity, not the local
guest ID. Test restart, reconnect, concurrent clients and abuse cases before any
traffic is switched. The Worker and its Durable Object remain unchanged apart
from importing the same now-shared pure health rule through their existing path.
