# Daily and weekly challenges

Current rotation update: five daily and five weekly objectives. No public deployment or public-server validation for this update.

## Rules and resets

`shared/challenges.ts` is the configurable definition library and hosting-independent
rule implementation. Exactly five objectives are saved for each category. A
stable pseudo-random selection uses the server-issued identity hash, category,
UTC period start and selection version. Each new rotation chooses three distinct
combat objectives from all five guns and melee, one difficulty-specific bot kill
objective and one Beginner/Intermediate bot win objective. Stored assignments are
reused, not regenerated on refresh. Existing three-card rotations retain progress
and rewards and gain the two bot objectives until the next reset.
Keep existing definition IDs when extending the library so active saved periods
remain readable.

Daily periods run midnight-to-midnight UTC and award 100 gems per objective
(500 maximum). Weekly periods start Monday 00:00 UTC and award 250 each
(1,250 maximum). Completing all ten can add 1,750 gems. Expiry creates
new objectives without removing the existing balance. Delayed previous-period
events cannot roll a current period backwards or credit its new daily tasks.
Gun targets are 5 or 8 daily and 20 or 32 weekly; melee is 3 or 5 daily and 12 or
20 weekly. Most weekly targets are four times daily targets. Absurd is one kill
daily and three or five weekly. Bot wins require one daily and three or four
weekly. Crates cost 250 gems, enforced by the shared catalog and server wallet.

Practice bot progress uses a separate optional account reporter. A connected
client obtains a server-issued run tied to its difficulty and bot count, then
reports cumulative human kills and the frozen match outcome. The server bounds
elapsed time and kill rates, rejects changed/decreasing totals and early wins,
and atomically stores receipts, challenge rewards and wallet changes. Retries
cannot repeat rewards. These are bounded client-reported practice claims, not
server-replayed combat. They can advance only bot objectives. Practice never adds
multiplayer kills, wins, points or games. Earned challenge gems update gem totals.
The simulation remains playable when the account backend is unavailable;
challenge rewards require connection. Zero-bot practice makes no reports.

Only the authoritative credited alive-to-dead transition advances weapon kills,
headshots, all eliminations and actual awarded points (including combo/headshot
bonuses). Grenade eliminations count for total kills/points, not a firearm type.
Nonlethal damage, practice combat, assists and client claims cannot advance these
online combat objectives.
The existing elimination guard and input validation protect duplicate kills.

Frozen server round results supply wins, MVP and completed-match progress.
Conservative eligibility: the guest must have spawned, still be connected at
round end, and not have disconnected/left during that round. Wins use the
actual FFA winner or Teams winner; draws do not win. MVP uses the actual frozen
MVP. Complete-match objectives additionally require the first spawn within the
first 30 seconds of the ten-minute round (initial loading grace). Late joins
can earn eligible wins/MVP, but do not count as a complete match. A reconnect
preserves earned kill/point progress, gems and completed objectives, but a
disconnection disqualifies that round's result objectives. A persisted abandoned
round marker prevents leaving/rejoining under a fresh session from bypassing it.
This is challenge eligibility only; existing match results/scoring are unchanged.

## Durable guest identity and currency

There were no authenticated accounts or existing gem balances. The editable
local guest UUID and username remain preferences and are never authentication.
No login, password, email or account database was introduced.

The allowlisted Worker exposes:

- `POST /profile`, empty body: mint a random 256-bit guest bearer credential and
  create a zero-balance profile. Returns the credential only at creation.
- `GET /profile`, `Authorization: Bearer <credential>`: fetch that private wallet
  and current objectives, using server time. Unknown credentials return 401 and
  are not silently replaced with a fresh guest.
- CORS preflight accepts only the configured existing browser origins, GET/POST,
  Authorization and Content-Type. Responses use no-store. Client-supplied
  balances/progress/profile IDs and nonempty creation bodies are refused.
  Creation has a bounded best-effort in-memory 20/minute/IP throttle.

The server hashes the credential with SHA-256 and stores `career:<hash>` records
in the existing public room's Durable Object storage, separately from short-lived
match sessions. It does not persist the raw credential. The browser saves its
credential under `crossfire.career.v1:<backend origin>`; the wallet and authoritative
progress are never trusted from localStorage. Web Locks serialize bootstrap across
tabs where supported. Storage-blocked browsers get a working in-memory temporary
guest and an explanatory panel note.

Joining passes the credential privately. The server resolves its record and
binds the session itself; arbitrary IDs cannot choose another wallet. Only one
active session per persistent guest is allowed, and a resume credential cannot
be used with another profile's credential. Match resume storage is scoped by the
non-secret identity hash, preventing a newly created guest after cleared browser
data from accidentally using a different guest's old session. Pre-v14 unscoped
match credentials do not automatically migrate into a newly created wallet.

Progress/completion flags, gem increments and the room's authoritative session,
combat and result state are saved in the same atomic Durable Object batch put.
Rewards run only on completion transitions; a persisted last-result round prevents
repeat result processing. Private WebSocket views are sent after persistence;
only the owner receives them. Revision checks reject stale client views. Dirty
profile writes, versioned acknowledgments and a bounded inactive cache avoid
rewriting every historic wallet on each simulation save. Active guest records are
loaded again on actor restoration. No Durable Object is deleted or recreated.

**Guest limitations:** this is a persistent browser-held capability, not a
recoverable authenticated account. Clearing browser data or losing the credential
loses access; renaming does not. There is no supported cross-device login,
recovery, credential rotation or sharing UI. Anyone who obtains a credential can
use that guest. Do not paste credentials into logs, URLs or screenshots. Temporary
storage guests lose access on reload even though their server record remains.
Before gems become purchased/valuable account currency, add recoverable account
authentication, stronger abuse protection and a transactional spending service.
No shop, spending API or real-money feature is included.

## Frontend

`CareerClient` bootstraps/loads the guest over HTTP without opening a match socket,
coalesces requests, validates shared schemas and keeps server time anchored to
`performance.now()`. Browser wall-clock edits cannot reroll tasks or alter the
reset countdown. Home polling is every 30 seconds, with immediate refresh at a
reset, on return home and before joining. Optional private `career` frames update
progress during gameplay. A temporary API failure does not replace a stored
credential or fabricate a balance; existing match play can continue without
challenge credit if bootstrap is unavailable.

The home panel has Daily/Weekly keyboard-accessible tabs, exactly five server
objectives, white animated progress bars with precise totals, shared original SVG
gem icons, retained completion/check/received labels, and a server reset countdown.
Top-right shows the current local display name over the actual gem balance, with
short number/completion animations. Short screens scroll only the challenge list;
tabs, reset information and Play remain accessible. Mobile preview positioning
adapts alongside the panel; the character's rig, framing, fade and animations stay.
The existing town background is gently brighter, with a shorter smooth upper
shade transition. No map geometry is loaded on home. Reduced-motion preferences
are respected. Existing settings, loadout flow, maps and combat are preserved.

## Protocol and future hosting

Shared protocol **v25** requires five-card career views. The original v14 change added the optional guest credential to join and a validated
private `career` server frame. There is a real schema change; version validation
remains enabled. Existing shared gameplay fields and map revisions are unchanged.
No new Cloudflare binding, migration, secret or frontend environment variable is
needed. The existing origin list and coordinated Worker-then-Pages CI remain.
Both frontend and Worker need the matching release through that workflow after
an authorized commit/push. Existing tabs may need refreshing; releases are not
atomic. Nothing was deployed here.

The dedicated-server scaffold still does not implement gameplay or wallets.
A future port can reuse the shared challenge library/protocol; it must implement
/profile, the same credential hashing/identity rules, private updates and durable
atomic gameplay/currency storage. Copy profile records and preserve identities,
period assignments and balances during an actual migration. Do not switch the
provider to the scaffold expecting persistent multiplayer or gems to work.

## Checks

The five-card update adds `tests/challengeRotations.test.ts`,
`tests/practiceChallenges.test.ts`, the real Worker
`server/tests/practice-challenges.mjs`, and the responsive UI check
`node tools/challenge-rotation-browser-test.mjs <frontend-url>`.
The latter uses a real local Worker and checks both tabs, two bot objectives,
three distinct combat objectives, fifth-card access at five viewport sizes and
the 250-gem shop price. Deploy frontend and Worker together for protocol v25.

From the repository root in PowerShell:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
$env:WRANGLER_LOG_PATH = "$PWD/test-results/challenges-worker.log"
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
npm.cmd run test:protocol
npm.cmd run test:deployment
npm.cmd test --prefix server-dedicated
```

Browser verification (Chrome at the path used by existing local QA tools):

```powershell
# Terminal 1, after frontend/server builds:
node tools/serve-dist.mjs --port 4200 --base /crossfire/
# Terminal 2:
node tools/challenges-browser-test.mjs http://127.0.0.1:4200/crossfire/
```

This uses actual independent Chrome contexts and real local Worker WebSockets.
Near-complete objective records are explicit test preconditions; only the real
server-confirmed elimination completes them. It is not evidence of earning six
full objectives from zero in one kill. Screenshots and check results are under
`test-results/challenges/`. Pure tests cover every definition and UTC/reset rules;
Worker tests cover nonlethal damage, real headshots, simultaneous rewards,
duplicate elimination, repeated result wakeups, late/abandoned eligibility,
privacy, rejected credentials/claims and complete runtime reconstruction.
Public Cloudflare operation, cross-device recovery and lower-end device performance
were not tested. Run browser and timed backend suites separately on this iGPU;
concurrent Chrome load can overflow a test input producer or miss the existing
apple-impulse test's timing window.

### Original implementation results (before the five-card update)

- Frontend: 475 tests / 45 files, TypeScript and production build passed.
- Worker: generated types/TypeScript, dry-run build and clean full suite 59/59.
- Production frontend/Worker protocol integration passed.
- Deployment checks 7/7; dedicated scaffold typecheck/build/tests 7/7.
- Browser: all 37 checks passed, zero browser/HTTP/asset failures. Inspected
  desktop, mobile, and completed-state screenshots at the production Pages subpath.
- No public Cloudflare test or deployment. Existing bundle-size warning remains.

## Changed files

- `CLAUDE.md`
- `PROGRESS.md`
- `docs/CHALLENGES.md`
- `server/package.json`
- `server/src/careers.ts`
- `server/src/index.ts`
- `server/tests/challenges.mjs`
- `server/tests/runtime-fixture.mjs`
- `shared/challenges.ts`
- `shared/protocol.ts`
- `src/game/Game.ts`
- `src/network/CareerClient.ts`
- `src/network/MultiplayerClient.ts`
- `src/styles.css`
- `src/ui/ChallengesPanel.ts`
- `src/ui/UI.ts`
- `tests/careerClient.test.ts`
- `tests/challenges.test.ts`
- `tools/challenges-browser-test.mjs`
- `tools/character-animation-mp-test.mjs`
- `tools/combat-visibility-test.mjs`
- `tools/damage-regeneration-test.mjs`
- `tools/gameplay-phase1-test.mjs`
- `tools/grenade-loading-colors-test.mjs`
- `tools/lean-browser-test.mjs`
- `tools/phase1-browser-test.mjs`
- `tools/phase3-browser-test.mjs`
- `tools/phase4-browser-test.mjs`
- `tools/polish-multiplayer-test.mjs`
- `tools/polish-phase2-test.mjs`
- `tools/reconnection-test.mjs`
- `tools/stage-a-test.mjs`
- `tools/update-phase1-test.mjs`
- `tools/update-phase2-test.mjs`
- `tools/update-phase3-test.mjs`
- `tools/update-phase4-test.mjs`
