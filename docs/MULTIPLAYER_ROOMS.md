# Logical multiplayer rooms (Phase 2)

Implemented locally on 2026-11-04. Gameplay protocol **19**, statistics HTTP schema
**2**. No public deployment or live Cloudflare validation was performed.

## Architecture and persistence

The Worker URL, `ROOM` binding and `PublicRoom` Durable Object class are unchanged.
The existing `public-main` object remains the built-in rotating public match and
also owns room metadata, guest capabilities, challenge wallets, statistics and
the indexed global rankings. Each new logical game uses a separate existing
class instance named `room:<random UUID>`. No new hardware, namespace, migration,
account database, credentials or paid service is required by this change.
Never delete/recreate `public-main` or reset its storage to release this update.

Each game instance owns its simulation, players, collision, selected map/mode,
600-second clock, weapons, health, teams, chat, grenades, scoring, feed, results,
respawns and interactive props. Custom rounds keep the host-selected map/mode;
the built-in match retains its automatic rotation. All authority uses the same
existing gameplay rules. Room capacity is 2-10 (default 6); built-in capacity is
10. Briefly disconnected sessions reserve their places during the existing
15-second resume grace; the browser counts these reserved places as occupied.

Cross-room participation is authorized with the existing server-issued guest
capability, never the editable local guest UUID or player name. The canonical
object prevents one profile occupying two rooms at once. A resume uses its
existing session token and matching profile capability, keeps life/health/gun/
score/team state, and replaces the old socket. Explicit Leave waits for the
server to release membership before another room connects.

Custom game transactions save reward commands together with authoritative game
state. A durable retry outbox forwards ordered commands to `public-main`, which
applies real challenge/statistics rules and saves wallet/statistics/projection
journals plus the room's acknowledgment cursor atomically. Retries after a lost
acknowledgment or reconstruction do not award twice. Staging uses copies so a
failed central storage commit cannot increment in-memory challenges twice.
Canonical wallet views are sent on join and successful reward acknowledgment.
Round completion serials are global per profile; identifiers include the source
room so independent room counters cannot suppress a valid completion. Existing conservative
participation eligibility still applies: disconnecting abandons that round;
authenticated resume preserves combat state, not a new completion entitlement.
No client can submit rewards through HTTP or the WebSocket protocol.

## Discovery, admission and menus

- Home Play opens MODE SELECT without loading a map or opening a gameplay socket.
- `GET /rooms` returns actual joinable public rooms, their names and occupied
  counts/capacities. Refresh is explicit. Loading, None and friendly errors are
  represented without fabricated rows. Private rooms/codes are excluded.
- `POST /rooms` requires a bearer guest capability and protocol version, validates
  the sanitized 1-48 character name, public/private, three existing maps,
  FFA/Teams and integer 2-10 capacity. Setup defaults to `PlayerName's Server`,
  public, European Town, FFA and 6; existing base-aware map thumbnails are used.
- `POST /rooms/join` accepts exactly one public room ID or six-digit code. Codes
  stay strings, preserving leading zeros. Both creation and admission return a
  256-bit random ticket bound to room and guest capability, valid for 120 seconds.
- `/ws/rooms/<UUID>` routes to that game's object. The **actual WebSocket join**
  consumes the ticket and checks the profile, privacy and serialized capacity.
  Knowing a private UUID, stealing a different profile's ticket or replaying an
  expired ticket cannot authorize a join. Valid authenticated resumes use the
  original room membership instead. `/ws` still supports the built-in match.
- Only after welcome/protocol/revision validation does the existing loader prepare
  map, collision, textures, shaders, character and all four weapon previews.
  Selection appears after readiness; clicking a gun sends the existing approved
  spawn request. No player spawns during loading or selection. Back cancels pending
  HTTP/loading work, releases the socket and returns to Mode Select.
- The room details disclosure shows map/mode/count/host and private Copy Code.
  The home background, guest name/profile, character, settings and gameplay HUD
  remain intact. Setup and discovery scroll on small screens.
- Home presence includes connected players across logical rooms (private room
  details remain hidden). Custom totals cache for at most five seconds; the
  canonical count remains immediate. The UI accepts the bounded aggregate.

The directory holds at most 100 active custom rooms. A profile may own two active
rooms, create three per minute; an IP may create twenty per minute. Admission is
limited to twenty attempts per profile/minute; code lookups to eight/IP/minute
(including successful lookups). Unused admission tickets are bounded and expire.
Cryptographically random six-digit codes retry collisions, remain unique among
active rooms, and become invalid when their room closes. Closed codes have a
24-hour reuse quarantine. Incremental server housekeeping removes expired rate
buckets, tickets and code tombstones. Origin validation, bounded request bodies,
strict schemas, version checks and existing fire/movement validation remain.
Invalid admission errors are caught **inside** concurrency gates: a rejected
Cloudflare gate must not reset a populated room.

## Server-owned lifecycle and inactivity

A newly created room warns at 60 seconds and closes at 90 seconds unless a
*different profile* has joined. Another player joining permanently cancels that
solo deadline. The initial host is the creator on joining. When a host leaves,
ownership transfers to the earliest-connected remaining session (UUID tie-break).
The room continues. Empty rooms close after 15 seconds, leave discovery and
invalidate codes. Alarms enforce this independently of browser activity.
Closure flushes outstanding rewards, releases memberships, stops timers, clears
players and closes sockets with a `room_exit` explanation. Clients return to
Mode Select without retrying. Cleanup retries if the authority is unavailable.

Spawned players receive an authoritative activity deadline: warn after 30 seconds
and remove after 45. Looking, changed movement/crouch/lean/aim, an actual jump,
fired shot, started valid reload, actual grenade action or accepted chat count.
Heartbeats, identical input messages, full-mag reload requests and a constant
held movement key cannot continually reset it. Activity is derived from existing
validated messages/simulation, not a client-reported timestamp or new heartbeat.
Loading, weapon selection, mandatory death delay, results and unspawned lobby
states use a separate five-minute idle deadline. Custom solo/empty deadlines
still apply. Kicked players can authorize a fresh join; no automatic reconnect
loop starts after server removal or deliberate Leave.

## Local PowerShell

Use two terminals from `C:\Users\Public\Crossfire`. Existing `.env.local` is
preserved. These process-only settings select the local backend without editing
production configuration.

Terminal 1:

```powershell
cd C:\Users\Public\Crossfire
npm.cmd ci --prefix server
npm.cmd run dev --prefix server
```

Terminal 2:

```powershell
cd C:\Users\Public\Crossfire
npm.cmd ci
$env:VITE_MULTIPLAYER_PROVIDER = 'cloudflare'
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173` in independent browser profiles or a normal/private
window to create distinct guests. Two ordinary tabs share a guest capability and
intentionally cannot impersonate two simultaneous players. Create a room, join
it from the other profile, select weapons and compare movement/health/score.
Restore the usual frontend URL by closing that terminal or removing its process
variable with `Remove-Item Env:VITE_MULTIPLAYER_URL` before restarting Vite.

## Verification and limits

Commands:

```powershell
npm.cmd test
npm.cmd run typecheck --prefix server
npm.cmd run build --prefix server
node --test server/tests/rooms.mjs
node --test server/tests/grenades.mjs
npm.cmd test --prefix server
npm.cmd run test:protocol
npm.cmd run test:deployment
npm.cmd test --prefix server-dedicated
npm.cmd run assets:verify
npm.cmd run build
```

`server/tests/rooms.mjs` uses real local Workers/Durable Objects and TCP sockets,
not simulated multiplayer: concurrent creation/joins, capacity race, private-code
secrecy/authorization/rates/expiry, all map configuration, FFA/Teams, isolated chat/
grenade events/timers, real kills, global points/gems/challenges, lost reward ACK,
complete runtime reconstruction, resume, dedup, room switching, independent round
completions, global rankings, host transfer, actual deadline enforcement, AFK/no-op
resistance/rejoining, empty cleanup and simultaneous 6/10-client rooms. Test-only
RPC seeds positions or ages authoritative deadlines; it does not fabricate hit,
kill, score or connected player events. Default 60/90 and 30/45-second boundaries
are tested by aging stored timestamps, not waiting real minutes in every CI run.

`tools/rooms-browser-test.mjs` runs two actual Chrome contexts against the
production `/crossfire/` sub-path and local Worker. It exercises the real guest,
menu, private code, loading, weapon selection/spawn, movement, host transfer,
cancellation and AFK UI, and captures screenshots in ignored `test-results/`.
`tools/rooms-menu-browser-test.mjs` additionally fills the built-in match with ten
real sockets, verifies None/free-slot Refresh and small-screen scrolling.
Run either browser tool after `node tools/serve-dist.mjs --port 4200 --base /crossfire/` in another
terminal. Browser-specific QA uses locally installed Chrome; CI's protocol test
still exercises the actual frontend transport with the production Worker.

Ten-player checks are brief local TCP load/synchronization checks. They do not
establish WAN latency, Cloudflare CPU/billing behavior, sustained production
capacity, or ten simultaneous rendering browsers/Chromebooks. Snapshot fan-out
remains bounded at ten players per room; no room-wide continuous prop transform
broadcasts were introduced. The canonical authority is a deliberate single
serialization point for directory and persistent rewards; large-scale traffic,
extended authority/storage outages and maximum registry load need separate
production monitoring/load tests. The future Node transport scaffold remains
incomplete and does not implement these rooms or authoritative gameplay.

## Deployment

Both Worker and frontend need a matching authorized release for protocol 19.
Keep the existing backend-first GitHub Actions workflow: tests, shared-protocol
compatibility, frontend build, Wrangler deploy, health protocol/Git SHA check,
then Pages. Existing secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`),
`ALLOWED_ORIGINS`, Worker URL, Durable Object binding/storage and GitHub Pages
base remain unchanged; no new secret or configuration is required for rooms.
The code includes production defaults for deadlines; optional `ROOM_SOLO_MS`,
`ROOM_EMPTY_MS`, `AFK_WARN_MS`, `AFK_KICK_MS` are available to local/test bindings.
Leave them unset in production to retain 60/90 and 30/45-second behavior.

The two services cannot deploy atomically; old tabs must refresh across the
protocol upgrade. See [deployment](DEPLOYMENT.md) for existing manual release,
health verification, troubleshooting and rollback procedures. Do not reset
Durable Objects to resolve an upgrade. No commit, push or deployment was made.
