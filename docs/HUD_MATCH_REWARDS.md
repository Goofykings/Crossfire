# HUD, animation and match-placement gems

Implemented locally November 6, 2026. Requires matching frontend and Worker
releases through the existing deployment workflow when authorized. No deployment
or protocol-version bump: the optional `RoundResult.gemRewards` is additive to v19.
Older results without that field remain valid. Existing accounts and balances are
preserved; no storage reset or new client reward endpoint exists.

## Placement rewards

`server/src/matchRewards.ts` owns the server-only `MATCH_GEM_RULES` table:

| Component | Gems |
| --- | --- |
| First / second / third | 10 / 6 / 3 |
| Performance | `min(20, floor(finalScore / 500))` |
| Eligible winning-team player | +2 |

FFA rewards the actual first three overall. Teams rewards the actual first three
on each team, including the losing team. Teams ties/draws have no winning bonus;
FFA never has one. Scores include existing authoritative bonuses. The existing
points-order comparator breaks ties deterministically. Short rosters receive only
their actual placements; forfeited placements are not reassigned to lower ranks.

A qualifying round must run its full 600 seconds, include two distinct persistent
identities and at least one real elimination (and both teams in Teams). Each
payee must have spawned at least 60 seconds before the end and have an actual
kill, death or assist. A zero-score defeated opponent can qualify. Explicit Leave
and AFK removal forfeit that player's placement award. Transport interruptions
do not forfeit it: the persistent identity can receive gems without a connected
browser. Practice has no network/wallet adapter and cannot award placement gems.
Missing old eligibility metadata and canceled/incomplete/empty/solo rounds do
not qualify. These checks discourage trivial empty-match farming; they are not a
complete anti-collusion system.

Challenges retain their existing independent rules/rewards. The new banner shows
the placement reward only, not every wallet change during the round. In
particular, randomized existing MVP/win challenges can still award their own gems
in situations where placement rewards are zero; this update does not rebalance
those challenges.

## Persistence and confirmation

- Match ID: `<room-id>:round:<authoritative-round-id>`.
- The round ledger persists identity, first-spawn time and explicit abandonment.
  Restores load participant profiles even when their transient session expired.
- Server-private `CareerProfile.matchRewards[source]` stores the latest paid round,
  unique match ID and exact gems. It is a high-water receipt for each room's
  monotonically ordered rounds, so older/duplicate rounds cannot pay again.
  `CareerView` deliberately excludes these private fields.
- Public-main commits receipt, wallet, statistics and result metadata in its
  existing storage batch. Custom rooms use the existing durable, ordered outbox;
  canonical public-main atomically commits the profile/statistics/cursor, then
  acknowledges the room. A lost acknowledgment/replayed batch cannot repay.
- A result receives `gemRewards` only after the canonical commit. A child room
  waits for its canonical receipts. The UI can update an already open results
  panel when confirmation arrives; pending amounts are never advertised.
- Spending gems does not reduce lifetime-earned statistics. Shop crate spending,
  challenges, inventory and room authentication retain their existing behavior.
- Reopening results, reconnecting and restoring the Durable Object preserve the
  receipt. Round ledgers are not retroactively rewarded from earlier releases.

## Presentation

Nametag children contain the name and a thin blue health track/fill. Both inherit
the existing label visibility, including geometry LOS for opponents, through-wall
teammate markers and smoke occlusion. The fill interpolates toward authoritative
health / 100 using elapsed frame time; there are no additional visibility rays.

FFA score/result names and local-row accents are gray; Teams keeps team colors.
Global leaderboard navigation remains visible above a scrolling panel, with
aligned DAILY/WEEKLY/ALL and KILLS/WINS rows. Points remain stored server-side.
Home navigation has a persistent active tab and an independent hover treatment.

Home idle adds a slow 1.8 cm vertical breathing cycle and gentle torso sway, with
independently moving held-weapon/arm IK and the existing shoulder animation.
Selected cosmetics, hand contacts, framing and reduced-motion support remain.

Deaths reuse the existing rig. A client-only three-sphere body proxy receives a
bounded impact impulse, gravity, tilt and damped limb reactions, using swept map
collision at bounded substeps. Near a wall, it selects a clear landing direction.
The body stays opaque initially, then fades from 1.55 to 2.2 seconds, before the
unchanged three-second respawn. Transparent material variants compile before
being assigned to avoid a cold-shader black silhouette. This is a procedural
approximation, not per-limb rigid-body simulation: fine limb/weapon contact in
every possible corner is not guaranteed. It sends no extra network transforms.

## SMG investigation

The current checkout already contains the preview fix in `WeaponPreviews`:
wait for `scene.whenReadyAsync()`, warm up rendering, then capture the real GLB.
No missing SMG or asset 404 reproduced. Its model is
`public/assets/models/shared/weapons/smg.glb`, loaded by the shared cosmetic asset
pipeline using the Vite base-aware URL. Fresh Chrome contexts verified visible
pixels for all four thumbnails in development and production `/crossfire/`.
No placeholder or weapon balance change was needed. Public deployed assets/cache
were not validated or modified.

## Repeatable checks

```powershell
npm.cmd test -- --maxWorkers=2
npm.cmd run build
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
npm.cmd run test:protocol

# In separate terminals for browser checks:
node tools/serve-dist.mjs --port 4200 --base /crossfire/
node tools/hud-browser-test.mjs http://127.0.0.1:4200/crossfire/

npm.cmd run dev -- --host 127.0.0.1 --port 4201 --strictPort
node tools/hud-browser-test.mjs http://127.0.0.1:4201/
node tools/practice-browser-test.mjs http://127.0.0.1:4201/
```

Browser tools launch installed Chrome and a separate local Worker (HUD tool), or
forbid all backend traffic (Practice tool). They do not contact the production
Worker. Test-only fixtures advance eligibility clocks and place real clients;
damage, scores, authoritative messages, payouts, wallets and rendering remain
the real implementation. Screenshots/reports go under ignored `test-results/`.
The UI checks use one actual browser plus two real WebSocket peers; reward
integration tests use three real peers, TCP and persistent local Durable Objects.
They are local integration evidence, not a claim of public Cloudflare validation.
