# Polish Phase 3: results and interface finish

The existing Phase 1 weapon/camera motion and Phase 2 scoring remain intact.
Phase 3 adds the final results presentation without changing combat, movement,
team win conditions, round rotation, guest credentials or the default host.

`RoundResults.ts` renders once per completed result. Victory is blue, defeat
red, and draw neutral, with identical proportions, symmetric fading bars and
timings. The banner enters over 380 ms; standings follow at 340 ms, MVP at
400 ms and actions at 440 ms. Reduced motion shows everything immediately.
The existing result backdrop uses a smaller CSS blur, with no new game-render
post-processing. Both team panels remain visible at desktop/Chromebook sizes;
rows scroll within each panel. Names use textContent, full points determine
sorting, compact formatting only affects display, and weapon SVGs use known
weapon IDs. There is no fabricated ping column.

The Worker now freezes **every real spawned participant**, including those
who left, plus their last server-approved weapon. It copies the round ledger
before resetting current stats. Team totals are the original elimination
totals; MVP is still highest individual points and can be on the losing team.
Runtime validation checks roster types, unique IDs, MVP/participant agreement
and FFA winner/draw consistency. Results survive resume and durable restart.

Protocol remains **v10**. The optional `RoundResult.players` and optional
`RoundStanding.weapon` fields are additive: older v10 readers ignore them,
older persisted summaries remain valid, and their missing standings are
explicitly reported as unavailable. Missing historical weapons show a dash.
No new messages, polling, authentication fields or recurring timers were added.
Phase 2 already changed the wire protocol from the public v9 to local v10;
matching Worker/frontend releases are still required when authorized.

PLAY AGAIN acknowledges the frozen result through the existing Game callback
and uses the already-running canonical room's loadout/spawn flow. RETURN TO
LOBBY intentionally leaves and forgets the resume credential. Both buttons
share a one-shot guard and disable together, preventing duplicate actions.

Other small presentation changes: fading kill-feed backgrounds, bounded
spectator names, consistent loading/spectating entry fades, and an opacity-only
elimination notice for reduced motion. Home, settings, loadout, character,
health/ammo, timer, live scoreboard, chat, respawn and gameplay animations were
reviewed; their working layouts and behavior were retained.

## Reproduce checks

From the project root in PowerShell:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
$env:XDG_CONFIG_HOME = $env:TEMP
npm.cmd --prefix server run typecheck
npm.cmd --prefix server test
npm.cmd --prefix server-dedicated test
```

For UI checks, use the real local presence endpoint as well. In one terminal:

```powershell
$env:XDG_CONFIG_HOME = $env:TEMP
npm.cmd --prefix server run dev -- --var ALLOWED_ORIGINS:http://127.0.0.1:4199
```

In another terminal (these process overrides do not modify `.env.local`):

```powershell
$env:VITE_MULTIPLAYER_PROVIDER = 'cloudflare'
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run dev -- --host 127.0.0.1 --port 4199 --strictPort
```

With Vite running, in a third terminal:

```powershell
node tools/polish-phase2-test.mjs http://127.0.0.1:4199/ teams --phase3
node tools/polish-phase1-test.mjs http://127.0.0.1:4199/
node tools/settings-test.mjs --url http://127.0.0.1:4199/
```

The multiplayer script starts its own isolated local Worker and uses two real
Chrome contexts plus real WebSocket opponents. It does not connect fabricated
players to production. Only its fixture advances the server clock and places
real players; actual weapon input and server-confirmed damage earn all scores.
The `--phase3` option adds at least 60 seconds of stable two-client connection,
movement synchronization, full departed-player standings, three viewport sizes,
reduced motion, real draw rotation, lobby cleanup and no unwanted reconnects.

For the GitHub Pages base-path check, stop any previous preview first:

```powershell
Remove-Item Env:VITE_MULTIPLAYER_URL -ErrorAction SilentlyContinue
Remove-Item Env:VITE_MULTIPLAYER_PROVIDER -ErrorAction SilentlyContinue
$env:BASE_PATH = '/crossfire/'
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 4200 --strictPort --base /crossfire/
```

Then in another terminal:

```powershell
node tools/polish-phase2-test.mjs http://127.0.0.1:4200/crossfire/ ffa --phase3
```

Screenshots and traces are written to ignored `test-results/` directories.
See the latest PROGRESS.md entry for checks actually performed and outcomes.

## Files in this phase

- `src/ui/RoundResults.ts` (new), `src/ui/UI.ts`, `src/styles.css`:
  immutable results UI, action guard and scoped interface polish.
- `shared/scoring.ts`, `shared/protocol.ts`, `server/src/index.ts`:
  complete frozen standings/weapon metadata and compatible validation.
- `tests/scoring.test.ts`, `server/tests/combat.mjs`,
  `tools/polish-phase2-test.mjs`: unit, real Worker persistence, and extended
  Phase 3 browser checks. Earlier Phase 1/2 files remain in the working tree.
- `docs/POLISH_PHASE3.md` (new), `PROGRESS.md`, `CLAUDE.md`: handoff and results.

## Limits

Public Cloudflare gameplay was not tested with this update. The last observed
public health response reported v9; these local sources intentionally use v10.
The Node dedicated transport scaffold remains incomplete. No deployment,
commit or push is part of this work. No physical Chromebook performance test
was performed; desktop Chrome checks use Chromebook-sized viewports.

The previously documented weapon-clearance edge case remains: in-place turns,
leans, swaps or close spawns can overlap geometry. This update does not alter
physics to address it. The existing large Babylon bundle warning remains.
