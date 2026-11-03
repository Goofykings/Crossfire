# Explosion, loading and server chat update

The grenade's damage, projectile physics and seven-second smoke volume are
unchanged. Smoke stays dense for five seconds, then fades for two.

## Explosion presentation

`ExplosionBurst` adds a separate alpha-blended orange/red lobe batch and additive
white/yellow flash/sparks, with four expanding torus shockwaves and two pooled
orange point lights. Lights never cast shadows, target nearby meshes during the brief burst,
and yield to permanent map lighting again when inactive. Existing depth tests keep effects behind solid geometry. There is no
screen-wide flash overlay. Fire finishes at 450ms; sparks finish at 550ms; flash
finishes at 60ms. All curves use the authoritative explosion timestamp, including
late delivery and history restoration.

The pool holds at most four bursts: 32 fire billboards, 48 additive billboards,
four low-poly rings and two lights. Low/reduced-effects mode uses four lobes and
four sparks per burst instead of eight/ten, plus dimmer rings/lights. Resources
are reused, precompiled during loading and disposed with the grenade renderer.
The original bounded smoke/trail batches remain separate.

`tools/explosion-lab.html` is an isolated render fixture, not a game mode or live
multiplayer demonstration. Run `node tools/explosion-fixture-server.mjs`, then in another terminal
`node tools/explosion-render-test.mjs` to capture normal/reduced renders at
0/40/120/250/450/1500/5500/7000ms in `test-results/explosion-renders`.
This bundled fixture uses the installed esbuild dependency in server-dedicated.
Alternatively serve the source HTML with Vite and pass its full URL to the render
runner. Screenshots are not a device performance benchmark.

## Readiness and spawning

The connected client now stays on Loading until the serialized map load,
authoritative snapshot/map revision, all four weapons, character library,
collision world, required textures and material/shader variants are ready.
Weapon preview rendering explicitly awaits materials and shaders, then the UI
awaits image decoding with cancellation/timeout before installing each preview.
The weapon selector opens only after these gates. Selection makes the existing
authoritative spawn request without a second loading screen or map rebuild.
Movement/fire still require actual server spawn approval. Existing dead-player
spectating and respawn selection are preserved.

Interrupted loading keeps the opaque loading screen and existing single-socket
retry manager. A resumed connection reuses the serialized asset/map promises;
round changes recheck the latest map. Critical failures still use Error with
Retry/Back, and cancellation prevents stale preview callbacks from modifying UI.

## Trusted join chat

Protocol **v15** adds the server-only `system` frame with exact fields
`{v, type:'system', kind:'player_joined', id:'join:<session UUID>', name}`.
The Worker generates this after successfully persisting a new session and sending
Welcome. It uses the sanitized authoritative name and broadcasts to connected
players, including the new entrant. The persisted session/resume credential is
the once-only marker: socket replacement, automatic retries, browser refresh
with the existing resume token, hibernation and round snapshots don't announce.
An intentional Leave followed by a genuinely new session does announce.

Clients reject malformed server frames, maintain a bounded 256-event dedupe set
across reconnects, and cannot send `system` frames. Player chat continues to use
its own schema, 200-character limit and 750ms server rate limit. A player named
Server is labeled `Server (player)` in authored chat to distinguish the trusted
label. Text is inserted with DOM text nodes. System rows use neutral gray and
the ordinary chat fade; initial loading queues up to five feed rows until HUD
entry so they don't expire invisibly during asset loading. Chat history remains
bounded at 30 rows.

If browser session storage is unavailable or deliberately cleared, the server
cannot identify an anonymous new connection as a previous session by name alone.
It is then a genuine new session, not a deduplication/authentication identity.

## Validation and release

Run frontend tests/typecheck/build, the full backend suite/typecheck/dry-run build,
`npm run test:protocol`, `npm run test:deployment`, and the dedicated scaffold
tests. `tools/grenade-loading-colors-test.mjs` tests two real Chrome contexts
against local workerd, delayed gun/texture/map readiness, a genuine transport
drop during loading, all decoded previews before selection, no second loading
screen, authoritative grenade damage/rewards/smoke, gray join chat and no
reannouncement on resume. Use `--asset-failure` for required-texture failure/retry.
`tools/gameplay-phase1-test.mjs` covers ordinary selection/spawn with all four
weapons and the prepared selector's Back action.

Both frontend and Cloudflare backend must be deployed together for v15 using the
existing coordinated GitHub Actions workflow: checks/build, Worker deployment,
health protocol/revision verification, then Pages. No Worker URL, Durable Object
binding/migration, origins, map hash or deployment credential configuration has
changed. Separate services still cannot be deployed atomically; an already-open
v14 client must refresh after the release. No deployment is performed by these
local checks.

## Changed files

Runtime: `shared/protocol.ts`, `server/src/index.ts`,
`src/network/MultiplayerClient.ts`, `src/game/Game.ts`, `src/ui/UI.ts`,
`src/ui/WeaponPreviews.ts`, `src/styles.css`, `src/weapons/GrenadeView.ts`,
`src/weapons/ExplosionBurst.ts`, `src/weapons/burstEnvelope.ts`.

Tests/tools: `tests/explosionJoin.test.ts`, `tests/grenadePresentation.test.ts`,
`server/tests/protocol.mjs`, `tools/grenade-loading-colors-test.mjs`,
`tools/gameplay-phase1-test.mjs`, `tools/explosion-lab.html`,
`tools/explosion-render-test.mjs`, `tools/explosion-fixture-server.mjs`.

Notes: this document, `PROGRESS.md`, `CLAUDE.md`. No game assets, map revisions,
weapon balance, environment configuration or CI workflow were changed.

## Local results (2026-11-03)

Plain frontend suite: 481 passing. Backend suite: 59 passing on full rerun.
Frontend/Worker typechecks and production/dry-run builds pass. Real protocol gate:
1 passing; deployment tests: 7; dedicated scaffold checks: 7.

Production `/crossfire/` browser runs passed 18 delayed-load/reconnect/refresh/chat
checks, 16 deliberate-texture-failure/Retry checks, 28 normal UI/four-weapon spawn
checks, and 38 extended grenade checks with first-frame capture. All completed
runs reported zero browser/asset errors. Render fixture: 16 captures; actual
fixture and production-game renders were inspected. The first-frame capture
pauses presentation RAF after the real event's first rendered frame; sockets,
server simulation and heartbeat timers continue. It is a screenshot tool, not a
performance benchmark.

An initial unpaused extended browser run timed out awaiting the local grenade
hit statistic under roughly 2 FPS, while authoritative damage, death and the
100-point award were correct. The same statistic/score assertions passed on the
capture rerun. Initial host-contention frontend/backend timing failures also
passed final reruns, including plain npm test. No health/scoring behavior or
assertion was weakened. See newest PROGRESS.md for the complete validation record.

Public Cloudflare connectivity and physical low-end-device performance remain
unverified. No commit, push or deployment was performed.
