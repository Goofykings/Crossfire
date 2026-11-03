# Grenade rewards, smoke, loading and perspective colors

Implemented locally on 2026-11-03. No commit, push or deployment was performed.

## Authoritative grenade rewards

`PublicRoom.eliminate()` adds one grenade alongside its existing credited kill
and scoring transaction. Its existing alive guard prevents duplicate rewards.
Firearm and grenade kills count, including posthumous grenade kills; nonlethal
hits, assists and environmental/self eliminations do not. There is no new
inventory cap. Existing respawn and round resets remain unchanged.

Protocol **v13** deliberately expands the validated `PlayerState.grenades`
domain from 0..1 to a nonnegative safe integer. This is a real wire-contract
change: a v12 frontend rejects snapshots containing earned inventories above
one. No message fields, room IDs, map revisions or authentication rules changed.
Frontend and Worker must be released together through the existing coordinated
GitHub Actions workflow. Tests and QA socket clients now read the shared version
instead of maintaining their own version literals.

Only a live, deduplicated, credited local elimination triggers the HUD `+1`.
Snapshots and resume inventory updates never trigger it. The animation rises
26 pixels over 800 ms. Four separated lanes bound and arrange rapid rewards.

## Smoke presentation

- Shared existing GLB/projectile physics; unchanged 2-second fuse, throw velocity,
  100 maximum damage and 1.8 m damage radius.
- Larger short flash/debris burst and longer, expanding/rising projectile trail.
- Deterministic world-space smoke, approximately 4.2 m radius after expansion.
  Dense through five seconds, then a smooth two-second fade. Authoritative
  explosion position and timestamp define the same cloud across peers.
- Worker retains up to 64 explosion events for seven seconds, including durable
  restoration. Late join/map readiness/resume restore the current smoke age;
  expired flashes, sounds and hit feedback are not replayed.
- Two fixed particle batches: 128 transient slots and 384 persistent slots;
  at most 12 clouds, oldest displaced first. No per-cloud mesh/material creation.
- Inside a cloud, depth-dependent fog sharply reduces distant visibility and
  blends across its boundary. Near objects remain visible. Map fog is restored
  after rendering and on cleanup. No opaque fullscreen HUD layer is used.
- Smoke-obscured name tags and outlines are hidden so they cannot reveal bodies
  through the effect. This only changes presentation, not authoritative damage.
- Graphics > Reduced smoke particles persists with the existing settings.
  Low also automatically uses reduced effects: 16 larger sprites/cloud instead
  of 32, and fewer trail emissions. Cloud lifetime and inside visibility stay
  the same; reducing effects does not remove smoke concealment.

Limitations: this is bounded billboard smoke plus local depth fog, not fluid
simulation or a physically integrated volumetric ray marcher. The cloud volume
is approximate and does not model airflow through individual rooms. More than
12 simultaneous clouds culls the oldest. Low-end Chromebook/mobile performance
and public Cloudflare behavior have not been measured.

## Critical readiness

`assetReadiness.ts` explicitly waits for required textures, detects failed
textures, supports cancellation and a 60-second readiness timeout, and warms
material shader variants for hidden weapons and off-scene character assets.
Map loading also waits for map textures before its existing scene readiness
check; collision construction remains part of the map loader. Required remote
weapon failures are propagated rather than silently swallowed. Retry rebinds
cached remote weapons if a failed join pruned their shared materials.

A connected unspawned player can still choose their gun immediately. Choosing
while loading shows the existing spinner and a real stage label, while waiting
for map geometry, textures, collision, all four weapon assets/materials,
character assets and required shaders. Connection, initial snapshot and map
revision checks remain prerequisites for authoritative spawn/gameplay. Assets
already cached are reused. Loading/selection/error surfaces cover the unfinished
world; an asset error identifies the asset and offers Retry/Back. No percentage
is fabricated and controls remain disabled during readiness.

Future first-use shader variants introduced by drivers or runtime quality changes
can still compile later; this is not a guarantee that every possible GPU pipeline
will be precompiled. Existing build size warnings remain.

## Perspective colors

`src/ui/teamColors.ts` owns the client-only mapping. Actual team IDs and score
keys are preserved. The local team is presented first, blue; the other is red.
The HUD, leaderboard, results, winner/MVP, kill feed, tags and outlines use that
mapping. FFA colors only the local identity blue. Feed colors refresh with live
team context; historical results use the player's team from that completed round.

## Validation and reproduction

Run from the repository root in PowerShell:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
$env:WRANGLER_LOG_PATH = "$PWD/test-results/worker-checks.log"
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
npm.cmd run test:protocol
npm.cmd run test:deployment
npm.cmd test --prefix server-dedicated
```

Browser tests use the production GitHub Pages subpath build and two independent
Chrome contexts with real WebSockets to local Miniflare/workerd. Fixture RPCs only
place real joined/spawned players or advance a real round; damage, kills, rewards,
inventory, explosions and result state come from the production backend.

In one PowerShell terminal:

```powershell
node tools/serve-dist.mjs --port 4200 --base /crossfire/
```

In another (Chrome installed at the path used by the existing QA tools):

```powershell
$env:CROSSFIRE_TEST_OUTPUT = 'test-results/grenade-loading-colors-final'
node tools/grenade-loading-colors-test.mjs http://127.0.0.1:4200/crossfire/
$env:CROSSFIRE_TEST_OUTPUT = 'test-results/grenade-loading-colors-multikill'
node tools/grenade-loading-colors-test.mjs http://127.0.0.1:4200/crossfire/ --multikill
$env:CROSSFIRE_TEST_OUTPUT = 'test-results/grenade-loading-colors-teams'
node tools/grenade-loading-colors-test.mjs http://127.0.0.1:4200/crossfire/ --teams --asset-failure
```

Coverage includes deliberately delayed gun GLB, weapon texture and map GLBs;
no spawn before readiness; deliberate HTTP 503 weapon texture failure, opaque
error and successful retry; actual grenade kill/+1; two-client smoke timing,
inside/outside visibility, fade/expiry, resume without duplicate popup, real
scoreboard/feed and red-team HUD/results/MVP. A three-browser FFA run also
verifies two kills from one explosion, inventory two, combo score 220 and two
simultaneous HUD rewards in separate lanes. Screenshots are saved under the
chosen output folder and were inspected locally. Final builds were not changed
while browsers were loading their chunks.

Local check results:

- Frontend: 416 tests / 43 files, TypeScript and production build passed.
- Cloudflare: generated types/TypeScript, dry-run build and all 55 backend checks passed.
- Production frontend/Worker protocol integration: passed with real local sockets.
- Deployment gates: all 7 tests passed; existing workflow unchanged.
- Dedicated scaffold: TypeScript, build and all 7 tests passed; remains explicitly incomplete for gameplay.
- Browser FFA: 29 checks; Teams plus failure/retry: 33 checks; three-client FFA
  multi-kill: 31 checks. All passed with zero unexpected browser/asset errors.
  Smoke/screenshots were checked at the production GitHub Pages subpath.

The existing traversal test compared a moving pre-disconnect snapshot with a
later resumed state, intermittently failing as held movement continued. It now
sends normal neutral input and waits for authoritative rest before asserting
exact resume position. Movement rules and the position assertion are unchanged.

## Deployment

Both the frontend and Cloudflare Worker require deployment because of protocol
v13 and the authoritative reward/history changes. Use the existing main-branch
workflow after reviewing and authorizing a commit/push; it deploys/verifies the
Worker before Pages. Existing Cloudflare credentials, origins, Durable Object,
URL, GitHub Pages base path and provider configuration are unchanged. No new
secret or server setting is required. Existing browser tabs must refresh into
the matching frontend after release. Two services cannot be deployed atomically.
No public deployment or live public-server validation was attempted here.

## Changed files

Runtime and shared rules:

- `server/src/index.ts`
- `shared/grenades.ts`
- `shared/protocol.ts`
- `src/config/settings.ts`
- `src/core/assetReadiness.ts`
- `src/core/loadContainer.ts`
- `src/game/CharacterAsset.ts`
- `src/game/CharacterWeapon.ts`
- `src/game/Game.ts`
- `src/game/RemotePlayers.ts`
- `src/maps/MapManager.ts`
- `src/rendering/MaterialLibrary.ts`
- `src/styles.css`
- `src/ui/CombatFeed.ts`
- `src/ui/MatchHud.ts`
- `src/ui/RoundResults.ts`
- `src/ui/Scoreboard.ts`
- `src/ui/UI.ts`
- `src/ui/teamColors.ts`
- `src/weapons/GrenadeView.ts`
- `src/weapons/grenadeSmoke.ts`

Tests and local QA (most existing fixtures only replace duplicated protocol literals):

- `server/tests/combat.mjs`
- `server/tests/environment.mjs`
- `server/tests/grenades.mjs`
- `server/tests/integration.mjs`
- `server/tests/runtime-fixture.mjs`
- `server/tests/traversal.mjs`
- `tests/combat.test.ts`
- `tests/combatPresentation.test.ts`
- `tests/grenadeLoadingColors.test.ts`
- `tests/guestProfile.test.ts`
- `tests/keybindings.test.ts`
- `tests/lean.test.ts`
- `tests/multiplayerTransport.test.ts`
- `tests/network.test.ts`
- `tests/prespawn.test.ts`
- `tests/scoring.test.ts`
- `tools/combat-visibility-test.mjs`
- `tools/damage-regeneration-test.mjs`
- `tools/grenade-loading-colors-test.mjs`
- `tools/polish-phase2-test.mjs`
- `tools/protocol-version.mjs`
- `tools/update-phase1-test.mjs`
- `tools/update-phase3-test.mjs`

Documentation:

- `PROGRESS.md`
- `docs/GRENADE_LOADING_TEAM_COLORS.md`
