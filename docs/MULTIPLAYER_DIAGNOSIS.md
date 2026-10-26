# Multiplayer connectivity diagnosis

**Historical diagnosis, superseded by Stage 2 implementation.** The findings below describe the pre-backend cleanup. A real Worker/Durable Object backend and frontend client now exist and have been tested locally with independent browser sessions. See [server/README.md](../server/README.md) for current startup commands, configuration and limitations, and [PROGRESS.md](../PROGRESS.md) for results. No public backend is deployed; the 10-minute match system remains Stage 3 work.

Inspected 2026-10-25 during the focused menu/reload cleanup. This is the observed implementation status, separate from the proposed [multiplayer architecture](MULTIPLAYER_ARCHITECTURE.md).

| Question | Finding |
| --- | --- |
| Is a real multiplayer backend implemented? | No server entry point, room implementation, shared network protocol or game WebSocket client exists in this checkout. `TeammateRegistry` is an unused data interface, not a connection. |
| Which technology is in use? | The game uses Babylon.js/TypeScript/Vite. Wrangler and `@cloudflare/vite-plugin` were already added to development dependencies before this cleanup, but there is no Worker configuration or use of that plugin in `vite.config.ts`. Installed tools do not constitute a backend. Cloudflare Workers/Durable Objects are a proposal only. |
| Can the backend run locally? | No. There is no server script, Worker entry point or Wrangler configuration to start. The existing `npm.cmd run dev` starts the frontend only. |
| Is there a public deployment? | No backend endpoint or deployment record is configured in the repository. The existing GitHub Actions workflow builds and deploys only the static frontend to GitHub Pages. External hosting accounts were not inspected, so an unrelated server elsewhere cannot be verified. |
| Which server URL does the frontend use? | None. The frontend does not read `VITE_MULTIPLAYER_URL` or any equivalent multiplayer endpoint. The variable appears in the architecture document as a future configuration choice, not executable code. |
| Is a WebSocket connection failing? | No game WebSocket is attempted. The removed "Multiplayer not connected" label was static HTML, not a connection result. Production-browser observation of page load and Play recorded zero WebSocket URLs. Vite's development hot-reload socket, if seen during development, is unrelated to multiplayer. |
| Are environment/deployment settings missing? | There is no `.env*` or `.dev.vars*` file in the project root and no game endpoint or backend binding configured. Adding an environment variable alone would not help: there is no code consuming it or backend accepting a connection. |
| Are one public match and synchronized 10-minute rounds supported? | No. There is no canonical room, server epoch, round selection, shared timer, player synchronization, authoritative combat, scoring or transitions. Local practice does not supply these behaviors. |

The new home screen has only the title, Play and Settings. It contains no connection status panel. **Play still opens the existing local practice flow**, whose briefing identifies practice targets; it does not claim to join a public server. Map-selection controls were removed; no client-side random map/match was substituted. The three maps remain available through the development URL/debug API so existing map tests and assets continue to work.

There is no connection attempt to report as successful or failed. Do not add a fabricated failure or success. When a real client is implemented, show a compact error only after a failed attempt, with Retry/Back, and never silently substitute practice for a failed public join.

## Commands that work now (PowerShell)

From `C:\Users\Public\Crossfire`, start the existing frontend:

```powershell
Set-Location C:\Users\Public\Crossfire
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

Open the Vite URL printed in the terminal. For map verification only, use `?autoplay&map=industrial-complex` or `?autoplay&map=modern-city`. There are no player-facing map controls.

To build and serve the production frontend under a Pages-style path:

```powershell
Set-Location C:\Users\Public\Crossfire
npm.cmd run typecheck
npm.cmd test
npm.cmd run assets:verify
npm.cmd run build
node tools/serve-dist.mjs --port 4176
```

Open `http://localhost:4176/crossfire/`. The local verification in this cleanup used this server/path. There is **no backend-start command** and no two-client multiplayer test command yet; supplying one as operational would be misleading.

## Smallest reliable implementation to add later

1. Add a separate TypeScript Worker and one SQLite-backed Durable Object addressed as `public-main`. Route all normal game connections to that same object using real WebSockets. Keep Pages and the existing renderer/assets untouched. Use the [Cloudflare WebSocket API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), not a Node HTTP server on Pages.
2. Centralize validated messages. Add server-issued sessions, join/leave/resume, heartbeat timeouts, authoritative movement using the existing pure controller/collision code and interpolated remote characters. Validate actions on the server; clients cannot award kills or report trusted hits.
3. Persist an epoch and random seed, deriving each round/map/mode from server time even after the room sleeps or empties. Keep 600 seconds of active play and define the transition interval explicitly. No per-join clocks or always-running empty-room simulation.
4. Add the actual client transport and public Play integration. Read a public `VITE_MULTIPLAYER_URL`; use `wss://` publicly and explicit local `ws://` during development. Validate exact allowed browser origins on the server. Add the real failure-only UI and authoritative snapshots/HUD.
5. Verify the Worker bundle in its actual local runtime, then two independent browser sessions, join/leave/reconnect, empty-room clock catch-up and a real transition before claiming operation. A single local practice tab is not multiplayer verification.

For public deployment, implement and test that project first, then configure the owner's Cloudflare account and Durable Object binding/storage, exact frontend origin allowlist and public Worker endpoint. After explicit deployment approval, deploy the reviewed backend, set the public frontend URL, rebuild Pages, and repeat two-client checks over `wss://`. Keep deployment credentials out of the frontend. No cloud resource was created or deployed during this cleanup.
