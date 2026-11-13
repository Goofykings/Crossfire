# Cosmetics, sales, rewards and identity polish — 2026-11-12

This update preserves the working weapon rendering fixes, recent Farmstead
perimeter/foliage work, combat balance, persistent balances, challenge policies,
Cloudflare Worker name, origins, GitHub Pages configuration and `.env.local`.
No commit, push or deployment is part of this work.

## Cosmetics

The existing IDs remain: Blossom is Legendary; Hydro Dip Abyss and Nebula are
Uncommon; Inferno is Rare; `rainbow-glow` (Rainbow Glow, the existing Rainbow
family) is Epic. Frosted remains Legendary. Blossom and Frosted join the crate;
Carbon Fiber retains its existing grant-only availability. The pool contains 61
items; rarity probabilities remain **50% Uncommon / 37% Rare / 10% Epic / 3%
Legendary**, with the existing renormalization after a tier is fully owned.
Shop, Locker and reveals use the same registry as the backend.

Darkness definitions, dagger/gun equip support and exclusive shader mode are
removed. The existing inventory normalization removes retired IDs and restores
Default only in affected slots. Other ownership, equipment, revision, wallet,
statistics and challenge data survive. There is no refund or reward reroll.
Stored session equipment also normalizes on reconstruction. A retry of a historical
crate receipt for a retired item returns an explicit conflict without charging
again; it does not reroll the completed purchase.

## Hourly sales

Only `public-main` creates schedules, using `crypto.getRandomValues`. It persists
the current and next UTC-hour windows in one bounded Durable Object storage
record before publishing them. Each start is uniformly chosen in milliseconds
between minute 0 and minute 50 inclusive; each window lasts exactly 600,000 ms.
Price is `100 + round(100 * sqrt(U))`, inclusive 100–200, expected about 167.
All players, private rooms, reconnects and restarted Workers read this same
canonical shop. No browser randomization or per-player sale exists.

`GET /cosmetics/offer` publishes server time and two windows, with existing
origin restrictions/no-store CORS. Shop uses a monotonic clock offset for its
countdown and 250 ms display updates while open; pricing refreshes every 30 s.
Display timers and requests stop when leaving Shop. The normal price keeps its
layout space when hidden, avoiding price-row jumps. The SALE sticker is bottom-right.

At checkout the backend rechecks current server time after reading the schedule,
before its atomic wallet/inventory/receipt write. Start is inclusive and expiry
exclusive. An optional `expectedPrice` is an equality guard, never an authority:
a stale quote is rejected with no deduction. The UI always supplies its quote.
New purchase results report `chargedPrice`. The existing durable request ID
survives lost responses/5xx, and retries return the original item and charged
price even after the sale ends. Concurrent duplicate IDs spend only once.

## Match gems

New eligible completed online matches pay:

```
max(0, 10 * kills - 3 * deaths + applicable_team_bonus)
```

Every eligible participant can earn the base amount, not only the top three.
There is no old placement amount, performance cap or 4× multiplier in new awards.
The final amount is clamped after adding a qualifying bonus; existing gems are
never deducted by a match reward.

Teams and Zone Control give the winning team's first player +25. Compare winning
second with losing first: only the higher individual point score earns +15. An
equal score earns neither +15. A missing candidate does not manufacture a +15
comparison. Within a team, score descending then immutable participant ID
ascending breaks ties. FFA and drawn team games have no team bonuses.

Existing completed-competitive-round, 60-second participation, deliberate Leave,
solo/noncompetitive exclusions and durable per-room once-only receipts remain.
Eligibility is checked after ranking: an excluded leader is not replaced with a
new bonus winner. Ordinary transport drops retain eligibility. Practice retains
its separate challenge policy and never earns online match rewards.

Internal reward commands carry version 3. Persisted unversioned and version-2
outbox commands retain their original historical formulas. Already paid receipts
and old frozen results are never recalculated. Results show only the actual
durably confirmed award.

## Developer designation and administrator setup

The empty-by-default Worker variable `DEVELOPER_ACCOUNT_IDS` is a comma-separated
allowlist of 64-character lowercase SHA-256 account identities. These identify
verified server-issued guest capabilities, not display names, browser guest UUIDs
or public leaderboard row IDs. Invalid entries fail closed.

1. Load your existing guest profile normally. Hover the home account name to see
   its `Account ID`, or inspect the authenticated `/profile` response's
   `profile.accountId` in browser developer tools.
2. Put that account ID in `server/wrangler.jsonc` under `vars`:

   ```json
   "DEVELOPER_ACCOUNT_IDS": "<your-64-character-account-id>"
   ```

   For a second authorized account, append its verified ID after a comma.
3. Release the Worker when authorized. The normal profile refresh supplies the
   designation; it cannot be granted through settings, names or join messages.

The account ID is not the credential. **Never publish the guest credential,
Authorization header or profile token**, and never put administration secrets in
`VITE_*`. No account ID has been invented or enabled here. Clearing browser data
creates another guest identity and does not transfer the designation.

One text-only username helper produces the light-blue name, soft glow and DEV
bubble without duplicate badges. It is used by the account header, home character,
nametags, scoreboard, results/winner/MVP, global rankings, chat/join messages,
kill feed and spectator names. Existing room listings contain room names rather
than player lists; no invented lobby roster was added. Health-bar relationship
colors and visibility checks remain unchanged.

## Results, timer and logo fixes

The duplicate-results cause was a retired room session being removed while its
round-ledger row remained. A new connection with the same verified account then
created another participant ID. Re-entry now restores the canonical participant's
score/kills/deaths/assists, team, participation and life counter, issuing a fresh
connection credential. The next spawn advances life normally. A lost/expired
resume token does not become valid again. Historical disjoint ledger rows with
verified identity metadata merge once; unrelated players with identical names
stay separate. Ranking and rewards use the same authoritative ledger. Older
already-frozen results lacking account mappings cannot safely be name-deduplicated
and are left intact rather than guessing.

The match HUD is a sibling of screen panels, so hiding the gameplay panel did
not immediately hide its clock. It previously waited for another game frame.
`UI.show` now clears/hides it synchronously outside HUD/spectating, including home
tabs; `MatchHud` clears its hidden countdown state. No overlay masks it.

The existing crossed-gun SVG sits in an accessible logo button. Hover/focus uses
the existing visual theme; activation reuses two tiny flashes/two trails, a brief
recoil and a quiet existing audio cue through master/SFX gains. A 300 ms gate and
animation cancellation prevent overlaps. Reduced motion retains only a short
flash. Keyboard, pointer and touch activate the same handler. No game shot,
ammo, navigation or multiplayer message is generated.

## Roof collision and navigation

All nine Farmstead roof elements derive movement solids and exact bullet prisms
from the same authored profiles as the visible mesh, including gables' two slopes,
shed slopes and ridge caps. Movement uses narrow static strips (at most about
2.7 cm top approximation at the steepest pitch), retaining the existing cylinder
controller and stair/slide/jump tuning. Shots/decals use exact centered triangle
surfaces through the existing bullet BVH; they never hit the staircase approximation.
Client, Practice and Worker all build the same world/revision. No decorative
foliage became a movement collider. The collision debug GLB and asset metadata
are regenerated separately without rebuilding unrelated artwork or Blender scenes.

Practice navigation samples these narrow roof supports. A seeded traversal
regression exposed a bot's long firearm getting caught beneath a landing after
jumping onto a guard. The bot now uses the ordinary dagger-equip input to recover
clearance, and restores the gun after movement is free. No teleport, collision
exception, artificial attack or player-physics change is used.

High roofs could clear the existing low stone perimeter. Per the user's choice,
four affected boundary runs now have visible metal fence extensions mounted on
the wall (the unaffected stone sections stay low). A conservative roof/jump/slide
envelope selects their spans and heights. The same generated bars, posts and rails
are exported to the terrain and shared static collision; there are no filled
invisible fence panels. Players cannot fit through the bar gaps, while bullets
can pass through their actual openings. Ground approaches still stop at stone.
The existing shared out-of-bounds elimination/respawn check is a secondary fallback
for invalid positions, granting no kill/score. Strict controller tests require
roof approaches to remain physically inside, without relying on that fallback.
The roof-placement validator also found an upstairs crate touching an eave; it
was moved 35 cm farther into the room, preserving the routes.

Reproduce the targeted Farmstead exports (from the repository root):
`python -B -I tools/layout_farm.py --write`, then run Blender
with `-b --factory-startup --python-exit-code 1 -P tools/export-farm-collision-debug.py -- --terrain`.
This updates only Farmstead's terrain/debug GLBs and manifest entries, preserving
the existing weapon, prop and other-map assets.

## Legendary kill-effect handoff

Confirmed eliminations now capture `cosmeticEffect` with `effect`, `cosmeticId`
and a copied victim world `position`. The server chooses it from validated equipped
inventory for the weapon responsible at the time of the kill. Grenades and
environment/self deaths do not inherit a gun skin. New identifiers are
`blossom-flower-burst` and `frosted-blizzard`; existing Rich `money` also uses
confirmed metadata, avoiding a later weapon switch changing the effect.

Claude can assign `game.legendaryEffects.onEffect = (effect, event) => ...` to
render the forthcoming particles. The hook dispatches each confirmed Legendary
event once with bounded history and reuses existing transport/life/round
deduplication. Practice supplies the same presentation metadata locally, while
remaining offline. No elaborate flower/blizzard animation is implemented here.

## Release and checks

Shared WebSocket protocol is **28** because new rewards can exceed v27's 128-gem
receipt limit and events carry new authoritative metadata. Both frontend and
Worker require a matching release, including the new Farmstead collision assets.
The current `.github/workflows/deploy.yml` deploys Pages only and explicitly uses
a custom tunnel URL; it does not publish the Worker. Preserve that configuration,
but do not assume a push updates the gameplay backend. When release is authorized,
release/restart the actual backend serving the configured URL with these same
sources, verify `/health` reports protocol 28, then publish the matching frontend.
For Cloudflare hosting the existing manual command is
`npx.cmd wrangler deploy` from `server/`. The active
tunnel/local backend instead needs its existing process restarted from updated
sources. No Durable Object deletion, migration reset, hosting switch or origin
change is needed. No release is performed by this task.

Verification commands and final totals are recorded in `PROGRESS.md`. Browser
component review uses real local Worker profiles, offers, snapshots and frozen
results; it is not public-server validation. Screenshots/logs are ignored under
`test-results/economy-*`. Actual GitHub Actions/public Cloudflare deployment and
Chromebook hardware testing are not performed by this task.

Final isolated runs: **1,080 frontend tests passed, one existing skip; 103 backend
tests passed; real transport/protocol check passed**. Frontend TypeScript/build,
Worker typecheck/dry-run build, focused geometry tests, asset validators and both
local Chrome reviews passed. The Chrome screenshots establish appearance and
asset loading, not a stable hardware performance benchmark.

## Files changed for this request

- Shared/server: `shared/cosmetics.ts`, `shared/crateSales.ts`,
  `shared/matchRewards.ts`, `shared/scoring.ts`, `shared/challenges.ts`,
  `shared/statistics.ts`, `shared/protocol.ts`, `shared/eliminationCosmetics.ts`,
  `shared/world.ts`, `shared/movementSafety.ts`; `server/src/index.ts`,
  `server/src/crateSales.ts`, `server/src/developers.ts`, `server/src/careers.ts`,
  `server/src/statistics.ts`, `server/src/matchRewards.ts`, `server/wrangler.jsonc`,
  `server/package.json`.
- Frontend: `src/network/CosmeticsClient.ts`, `src/rendering/SkinFx.ts`,
  `src/rendering/CosmeticAssets.ts`, `src/game/Game.ts`,
  `src/game/LegendaryEffects.ts`, `src/game/RemotePlayers.ts`,
  `src/practice/PracticeSimulation.ts`, `src/practice/Navigation.ts`,
  `src/practice/BotBrain.ts`, `src/maps/types.ts`, `src/styles.css`;
  `src/ui/Username.ts`, `LogoEasterEgg.ts`, `CosmeticsPages.ts`, `UI.ts`,
  `MatchHud.ts`, `ChallengesPanel.ts`, `HomeCharacter.ts`, `LeaderboardPage.ts`,
  `RoundResults.ts`, `Scoreboard.ts`, `CombatFeed.ts`.
- Generation/assets: `blender/scripts/lib/farmstead.py`, `collision_gen.py`,
  `perimeter.py`, `tools/layout_farm.py`, `src/maps/farmstead/layout.json`;
  `public/assets/models/farmstead/collision.json`, `collision_debug.glb`,
  `terrain.glb`,
  `public/assets/asset-manifest.json`, `public/assets/cosmetics/catalog.json`;
  `tools/export-cosmetics.mjs`, `verify-cosmetics.mjs`,
  `export-farm-collision-debug.py`, `economy-browser-test.mjs`,
  `economy-fence-browser.mjs`.
- Tests: `tests/economyUpdates.test.ts`, `farmRoofs.test.ts`,
  `matchRewards.test.ts`, `newSkins.test.ts`, `crateReveal.test.ts`,
  `skinRespawn.test.ts`, `practice.test.ts`, `meleeCombat.test.ts`,
  `zoneControl.test.ts`, `farmstead.test.ts`, `farmPerimeter.test.ts`;
  `server/tests/economy-updates.mjs`, `room-harness.mjs`, `runtime-fixture.mjs`,
  `rooms.mjs`, `cosmetics.mjs`, `melee.mjs`, `match-rewards.mjs`, `grenades.mjs`.
- Documentation: this file and `PROGRESS.md`. Other changes present at task start
  are preserved; the full working-tree diff also includes that earlier work.
