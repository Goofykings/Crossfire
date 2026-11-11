# Zone Control

Create Server now offers **Zone Control** for public or private online rooms,
with the existing 2–10 capacity, balancing, admission, AFK, respawn and lifecycle
rules. The canonical `public-main` rotation remains FFA/Teams. Practice does not
offer objectives: its bots have no objective strategy. Custom rooms retain their
selected map across rounds, as before; there is no map-voting system to extend.

## Authored objectives

`shared/zoneControl.ts` is the only objective definition. Coordinates are metres
in the existing +X east, +Y up, +Z south world. Each square is **3.6 × 3.6 m**;
feet must be within 0.3 m of the configured floor, so floors above/below it never
capture. Borders/fills add no collision or ray-pickable obstacle.

| Map | A | B | C |
| --- | --- | --- | --- |
| European Town | Unavailable | Unavailable | Unavailable |
| Industrial Complex | (-13, 0, -15) | (-15, 0, 19) | (17, 0, 11) |
| Modern City | (-15, 0, -15) | (5, 0, 19) | (21, 0, -9) |
| Farmstead | (-33, 0, 1) | (25, 0, -39) | (29, 0, 31) |

Industrial, City and Farmstead qualify. Geometry tests sample the whole square against the
actual shared world (including props), check flat ground, no overhead solid or
overlap with building footprints, at least two clear
approaches, the same traversable navigation component, >18 m separation, and
at least 5 m from authored spawns. Town's visual review showed its collision-clear
candidates using small building areas and tight lanes. Its remaining outdoor
candidates cannot make three suitably separated objectives; it is excluded
rather than changing existing map geometry. All four remain in other modes.
The offline `node tools/zone-candidates.mjs` diagnostic evaluates candidates; it
does not alter maps or independently choose runtime positions. Future unsuitable
maps use an empty list: both room validation and menu filtering exclude them.

## Capture and scoring

The Worker samples only connected, alive, assigned players at their authoritative
controller positions. Input cannot supply occupancy, progress, ownership or score.
Previously sampled occupants are integrated up to the current server timestamp,
then replaced, preventing a newly joined body from claiming elapsed time.

- Capture work is integer player-milliseconds: 10,000 for one player, 5,000 ms
  for two, 3,334 ms for three (rounded up to the next server millisecond).
- Both teams present: freeze capture and decay; keep the owner and its income.
- Attackers leave/die/disconnect: drain 1,000 work units per second (10%/s).
- Returning attackers resume remaining work. An opposing solo team first drains
  the old pending work at that same fixed rate, then starts its own capture.
- At completion, switch owner once and clear pending work. Scoring splits at the
  exact computed completion timestamp, including a takeover within a tick.
- Each owned zone accumulates one owned millisecond per elapsed millisecond for
  its team. Display `floor(totalOwnedMilliseconds / 1000)` for each team. This
  aggregate zone-time cadence has no floating-point point accumulation, and an
  unchanged/replayed timestamp grants nothing. Empty and contested owned zones
  still score. Progress and income stop at the round deadline.

Objective points do not enter individual score, combat stats, assists or combo
awards. Existing result finalization uses objective totals to choose the winning
team or draw; combat points still rank players/MVP. Team grouping, participation,
combat-activity requirements, gem receipt idempotency and abandonment safeguards
remain in effect. There are no capture gems, capture leaderboard uploads or new
reward claims.

## Synchronization and recovery

Protocol **v26** adds the mode and validated objective snapshot state. Welcome,
spawn, ordinary 20 Hz gameplay snapshots, late join and reconnect all carry the
same authoritative state. No new per-render-frame packets or client capture
commands exist. The ordinary independent snapshot stream updates objectives
without requiring an ordered delta chain. Compact transport retains this state.

Persist objective work/cursor/owned milliseconds with the existing room ledger
and totals. Completed ownership changes request a persistence checkpoint; partial
progress uses the existing one-second checkpoint. Recovery integrates owner
income to the deadline but clears stored occupancy before advancing time: absent
connections cannot complete a capture. Pending capture decays until living
connections are sampled again. As with existing movement, an abrupt runtime loss
can restore partial work from the last checkpoint. Normal disconnects persist
the updated counts. Round changes clear all owners, work, counts and scores;
existing frozen results remain available. Empty rooms retain existing closure
rules, rather than gaining a permanent objective timer.

Both world markers and the top HUD use one smoothed progress value. World
projection uses the actual world camera, independent of viewmodel FOV. Markers
ignore geometry occlusion, clamp to screen edges, and yield the crosshair centre.
The owner's ground border changes only on completion. Capture colour fills from
the bottom over the old owner/neutral fill; contested objectives add a small `!`.
Objective labels/totals use actual Blue/Red identities, while existing relative
player-friendly/opponent colours remain intact.

## Local verification and release

```powershell
$env:WRANGLER_LOG_PATH = "$PWD/test-results/zone-wrangler.log"
npm --prefix server run typecheck
npm --prefix server run build
node --test server/tests/zone-control.mjs
npm test -- --maxWorkers=2 tests/zoneControl.test.ts
node tools/zone-control-browser-test.mjs
node tools/zone-control-browser-test.mjs --dev
npm --prefix server test
npm run test:protocol
npm test -- --maxWorkers=2
npm run build
```

The browser tool starts an isolated local Miniflare Worker and serves the built
frontend at `/crossfire/`; it routes real browser connections to that Worker
without modifying `.env.local`. It requires installed Chrome at the existing
Windows test path. `--dev` uses the existing development scene inspector to
ray-pick rendered ground and choose review cameras against actual triangles;
it still uses the same real Worker and gameplay rules. Both paths wait for
rendered frames before capture. Captured overviews, all nine eligible-map close-ups and the real
contested takeover/HUD are in `test-results/zone-control/`. The JSON report lists
completed checks. Current exact results and inspection limits are in PROGRESS.md.

When authorized, release **both Worker and frontend** through the existing
backend-first GitHub Actions workflow (v26 must match). No Worker name, URL,
Durable Object binding, origins, secrets or Pages base configuration changed.
Local checks do not establish public Cloudflare/GitHub Pages operation.

Implementation files: shared rules/configuration and validation in
`shared/{zoneControl,combat,rooms,protocol,scoring}.ts`; Worker lifecycle/rewards
in `server/src/{index,matchRewards}.ts`; presentation in
`src/game/{Game,ZoneControlView}.ts`, `src/game/zoneControl.css` and
`src/ui/{RoomMenus,MatchHud,Scoreboard,RoundResults}.ts`. Practice's setup type
explicitly excludes objectives. Unit/integration coverage lives in
`tests/zoneControl.test.ts`, `server/tests/zone-control.mjs`, the existing test RPC
fixture and server test script. The two `tools/zone-*.mjs` files are local review
utilities, not production endpoints or gameplay cheats.
