# Browser-local Practice

Open **Play → Practice**, choose a map, FFA/Teams, 0–5 bots and a difficulty,
then Start Practice and choose a weapon. The ten-minute clock starts at the first
human spawn. Zero bots is solo exploration. Pause freezes the local simulation;
spectating and weapon selection after death keep it running. Results offer
Restart, Practice Settings and Return Home. Restart creates a fresh simulation,
scores and interactive props. Leaving discards the session.

Practice needs the hosted frontend files, models, textures and audio, but never
needs the multiplayer backend. This is not a service-worker/offline-download
feature: uncached frontend assets must still be available from localhost or Pages.

## Architecture and account isolation

- `src/practice/config.ts`: validated setup, difficulty tuning, seeded random
  source and frozen `PRACTICE_POLICY`. Rewards, statistics persistence and result
  upload are explicitly false.
- `PracticeSimulation.ts`: local authoritative actors, movement/combat ticks,
  grenades, regeneration, assists, scoring, team totals, respawns and results.
  There is no HTTP, WebSocket, storage, career, challenge, wallet or leaderboard
  adapter. Match scores exist only in memory.
- `PracticeClient.ts`: in-process presentation adapter implementing the methods
  Game already uses for snapshots, combat events and input reconciliation. It
  does not instantiate MultiplayerClient or fabricate a server handshake/session
  credential. Its inspect result identifies `transport: local`, with zero sockets.
- `Game.ts`: selects that adapter only after explicit Practice setup. Existing
  RemotePlayers, animated GLBs, WeaponView, spatial audio, trails, damage/healing
  feedback, kill feed, HUD, scoreboard, spectating and respawn UI consume its data.
  Actual local bots are named Bot 1, Bot 2, etc.
- `shared/hitscan.ts`: extracted production ray/pellet resolution, now shared with
  the Worker. Spread, falloff, body/head geometry, walls and target ordering are
  unchanged. Each pellet resamples live bodies. Teammates block rays but receive
  no damage. Other existing shared modules own movement/weapon state machines,
  damage, grenade physics/blasts, health, spawn validation, assists and scoring.

Simulation runs at 120 Hz, snapshots at 20 Hz, with bounded frame catch-up. The
local clock freezes with pause rather than catching up missed wall-clock time.
No per-bot timers or inference services run. Human input/prediction and local
authority use the same fixed timestep and equipped-weapon clearance.

The human is Blue in Teams. Bots alternate Red/Blue, starting Red, producing 3v3
with five bots. FFA treats everyone else as an opponent. The shared lethal
transition awards 100 base points, applicable combo/headshot points and assists;
grenades never receive a headshot bonus. Dead bots wait the existing three-second
respawn delay and choose a fresh valid spawn and random weapon.

Cold startup and Mode Select deliberately do not request online data. Select
**Public Servers/Refresh**, submit an online Create/Join action, or open an online
account page to opt into those services. Practice aborts pending room/account
requests and stops presence/profile polling. It never replays local events when
the user later joins multiplayer. Normal guest username, graphics, controls and
last-used weapon preferences still work. They are not account reward statistics.

## Navigation and AI

`Navigation.ts` rebuilds a layered 0.8 m graph from the selected map's current
CollisionWorld/layout, including upper floors and underground space. It samples
body/headroom, step-up and snap-down clearance along both directions of each
edge, identifies connected components and uses A* to reachable goals. This avoids
a separately maintained waypoint file becoming stale after a map revision.

`BotBrain.ts` perceives opponents using real geometry LOS, grenade smoke and a view cone, with
close-range awareness still blocked by walls. It remembers the last seen point,
not an unseen enemy's live position. States include exploring, patrolling,
searching, pursuing, attacking, seeking cover, retreating, healing and respawning.
Movement uses PlayerController, so walls, stairs, weapon clearance, jump and slide
cooldowns remain real. Stuck bots replan/choose nearby recovery goals; only a bot
still stuck after ten seconds is eliminated and respawned. No ordinary teleport
navigation is used.

| Difficulty | Reaction | AI aim error | Movement | Slide attempt interval |
|---|---:|---:|---:|---:|
| Beginner | 950 ms | ±5° | 62% normal | 8 s |
| Advanced | 320 ms | ±1.3° | normal | 3.5 s |
| Absurd | 65 ms | zero | normal | 150 ms, constrained by real cooldown |

Advanced/Absurd use cover when reloading and retreat at low health; they wait for
regeneration before re-engaging. Higher difficulties sometimes prefer reachable
elevated patrol goals. Decision/LOS cadence is 90–220 ms with staggered updates;
paths replan on changes or at most roughly every 850 ms, not every render frame.
Bots share assets and choose all four guns randomly on spawn. A bot can switch to
a different weapon after 22–47 seconds outside an immediate encounter; it uses
the real equip, burst/semi-auto, magazine, reload and pump/bolt rules.

Absurd aims at the current head hitbox, including crouch/lean, with zero AI angular
error. Body turning remains bounded. Weapon spread, movement accuracy, pellets,
LOS and actual damage remain unchanged, so a perfect target angle is not a
guaranteed headshot.

Development only: **F4** toggles a top-down navigation/path/visible-target overlay,
bot states, stuck/recovery counters, map revision, invalid-solid count and FPS.
**F2** is the existing collision overlay and **F3** the existing FPS toggle. All
are off by default; Practice diagnostics are not enabled in production. The normal
debug API exposes `practice()` inspect data and a DEV-only `practiceFinish()`
action for result-screen testing; production ignores the finish action.

## Tests and local operation

```powershell
Set-Location C:\Users\Public\Crossfire
npm.cmd run dev
# Open the displayed localhost URL. No server command or backend config is needed.

npm.cmd test -- --maxWorkers=2 tests/practice.test.ts tests/careerClient.test.ts tests/rooms.test.ts
npm.cmd test -- --maxWorkers=2
npm.cmd run typecheck
npm.cmd run build
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
npm.cmd run test:protocol
npm.cmd run assets:verify
```

`tools/practice-browser-test.mjs [frontend-url]` runs actual Chrome gameplay while
rejecting every cross-origin backend fetch/gameplay socket. It tests cold entry,
all three real maps, bots moving/fighting/scoring, reload, grenade, solo exploration,
six-player team presentation, results/restart/settings (development), account-data
isolation and entering Practice after a failed online request. With `--production`
it also checks the built Pages subpath (no DEV finish or navigation action).
Vite's development HMR socket is distinguished from gameplay; production has no
HMR. Browser screenshots/reports are written to `test-results/practice-browser*`.

Headless tests cover all 0–5 bot counts, team balancing/friendly fire, actual rays,
grenade double-kill scoring/deduplication, regeneration, respawns, natural 600-second
results, difficulty behavior, perfect leaned-head target angles, retreat/heal/
re-engage, seeded replay and local input/pause/leave lifecycle. Five armed bots
also traverse every actual map for two simulated minutes, with repeated solid/
movement-safety checks, observed upper-floor climbs/slides/weapon switches and no
irrecoverable-stuck respawns in the tested seed. This is representative coverage,
not an exhaustive proof of every route or seed.

`tools/rooms-browser-test.mjs [production-url]` uses two real Chrome clients and
the actual local Worker, including Practice → online, public/private admission,
movement, map changes, leave, host transfer and AFK behavior. Online inventory
regression coverage remains in `tools/cosmetics-browser-test.mjs`.

## Limits and release

AI is a lightweight rule-based opponent, not human tactics: no coordinated team
strategy, ladder-specific planning, bot grenade throws, dynamic navmesh avoidance
of other actors or advance knowledge of hidden enemies. Narrow corners can cause
replanning. Navigation construction is synchronous and bounded by these compact
maps; future larger maps may need background generation/spatial A* optimization.
Performance was tested on this desktop, not a physical Chromebook. Existing
Chromebook rendering settings remain available.

The production five-bot Modern City smoke run at Low/0.5 resolution sampled
approximately 19–52 FPS including an initial entry/shader recovery sample;
subsequent samples were 44–52 FPS. Scene CPU render samples were 13–18 ms.
This short headless run is not a sustained performance guarantee. See the report
for raw samples and use Chromebook Mode/fewer bots on constrained hardware.
The separate final DEV run sampled 58–60 FPS / 6–10 ms scene CPU with five bots;
both sets of raw observations are retained because results vary by run/scene.

Production backend availability was deliberately not required or claimed. Online
regressions use local Cloudflare runtime and real sockets/browsers. Protocol stays
v19; backend URL, bindings, persistent state, credentials and deployment workflow
are unchanged. Publish the frontend assets for users to see Practice; the shared
hitscan extraction also belongs in the next matching authorized Worker/Pages CI
release. No new secrets, bindings, API endpoints or deployment are needed to run
Practice locally. Nothing was committed, pushed or deployed automatically.
