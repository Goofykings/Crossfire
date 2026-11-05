> Phase 1 update (2026-11-04): statistics HTTP schema is now v2 and includes
> lifetime assists. A confirmed assist adds 50 to lifetime/daily/weekly points and
> increments assists, without incrementing kills. Existing records migrate assists
> to zero while preserving all prior totals and projection revisions. Gameplay is
> protocol v18; release matching frontend/Worker through backend-first CI.
> Earlier version/release descriptions below are historical.

# Global rankings and lifetime statistics

## Identity and storage

The canonical `public-main` Durable Object remains the authority. No accounts,
passwords, extra database service, credentials binding or Wrangler migration was
added. The existing server-issued 256-bit guest capability authorizes private
statistics; its SHA-256 identity keys `statistics:<identity>` records. The editable
local guest UUID and display name never authorize access. Browser storage holds
the existing capability only, not authoritative totals. Clearing it or using a
new device loses access; there is no account recovery or cross-device identity.
Blocked localStorage still permits the existing temporary profile for that page.
Sessions without a server guest credential retain gameplay but have no persistent
statistics identity. HTTP ranking reads do not join or reconnect a match.

Each record contains a separate random public UUID, last validated join name,
lifetime kills/deaths/points/wins/completed games/earned gems, current daily/weekly
counters, recent authoritative event IDs and a last-counted round. Only public
UUID/name/value/rank/local markers appear in rankings; neither the capability,
its private hash nor multiplayer session tokens are exposed.

Records and immutable `statistics-index:<identity>:<revision>` projection journal
entries are saved in the SAME atomic `storage.put` batch as sessions, score ledger,
challenge progress and wallet. Dirty generations prevent an older save completion
from clearing newer changes. Recent elimination IDs plus the existing alive/life
guard prevent duplicate kills/deaths/rewards. Monotonic round markers prevent
repeat result processing across reconnects or reconstruction.

SQLite tables/indexes live in the existing SQLite-backed Durable Object. They are
an indexed projection, not a second authority. Post-save background work drains
only pending journal entries, transactionally upserts the newest cumulative record,
then removes the exact immutable journal keys. A restart after the KV save or a
crash after SQL commit is replayable without incrementing totals. Old revisions
cannot overwrite newer projections. Pending work is also drained before ranking
reads. No permanent simulation timer or full-profile scan is needed. The cache of
loaded records is bounded apart from active/dirty profiles.

Top ten uses `(period, start, metric DESC, public UUID ASC)` indexes, filtering
zero totals. Own rank uses an indexed count of preceding positive totals. There
are at most three projection rows per profile; past period history is not retained.
The public top-ten query does not scan all KV profiles. Own-rank counting can grow
with the number of preceding rows; at much larger populations it may warrant a
cached rank service. No such additional service is required for this one-room game.

## Award timing and boundaries

- Common authoritative elimination handling records the credited killer's kill,
  exact scoring award (base, headshot and combo as applicable), and actual challenge
  gem delta, along with the victim's death. It covers guns, grenades, burns and
  environment deaths under existing combat rules. A nonlethal hit awards none.
- These counters are persisted during the elimination transaction, before match
  end. Leaving, expiring a session or refreshing cannot erase earned totals.
- Round awards use the existing finalized result and conservative challenge
  participation rules. Completed games require a spawn within the first 30 seconds,
  continued connection at finalization, and no abandoned-round marker. Wins require
  that completion AND the actual winning result; draws add no win. Spectators,
  late/incomplete participation and abandoned rounds add neither games nor wins.
  Existing challenge reward rules, including their late-join behavior, are unchanged.
- The existing disconnect path marks the round abandoned, even if the connection
  resumes. Kills/points/deaths/gems remain earned; reconnecting cannot create another
  completion. This intentionally preserves existing challenge eligibility policy.
- Periods use shared challenge boundaries: daily 00:00 UTC; weekly Monday 00:00 UTC.
  Each award's server timestamp chooses its bucket. Reads filter the current server
  period, so inactive players' old daily/weekly counters disappear automatically.
  Lifetime counters never reset; historical events cannot enter a newer bucket.
- Lifetime earned gems are independent of `CareerProfile.gems`. Future wallet
  spending must never decrement the statistics counter. On first migration, known
  existing wallet gems seed earned gems: no shop/spending exists in this version.
  Earlier kills, deaths, points, wins and completions were not recorded and cannot
  be reconstructed or fabricated. Those statistics begin with this release.

## HTTP API and browser UI

Existing endpoint/CORS/provider configuration is reused. No WebSocket message or
protocol version changes: gameplay remains v17. The separately validated statistics
HTTP schema has `version: 1` from `shared/statistics.ts`.

- `GET /leaderboard?period=daily|weekly|all&stat=kills|points|wins` returns server
  time, period start, selection, up to ten rows and an optional owner row/rank.
  Authorization is optional for public results; only valid capabilities get an
  owner marker. Ties use stable public UUID ascending, with sequential ranks.
- `GET /stats` requires `Authorization: Bearer <guest capability>` and returns
  private lifetime totals. Credentials belong in headers, never URLs or logs.
- Unknown/duplicate parameters, unsupported selections, write methods, invalid
  credentials and disallowed browser origins are rejected. Responses use no-store.
  No endpoint accepts client-submitted statistics or rewards.

The new home LEADERBOARD option opens a full-page view with the same blurred asset
and typography; no game map is loaded. Independent 180 ms opacity highlights replace
the moving indicator. ALL/KILLS is initially selected. Both selection groups use
native keyboard-focusable buttons with exclusive aria-pressed state and white
rounded selected outlines. A request change cancels older work; closing the page
stops polling and pending requests. Refreshes happen every five seconds while open
and keep existing rows visible until a validated replacement arrives.

MY STATS toggles a compact panel, closes outside or with Escape, and keeps the
rankings behind it. Win ratio is wins/completed games, one decimal percent (0.0%
with no completions). K/D uses two decimals, 0.00 when both counts are zero, and an
em dash for kills with zero deaths. Zero deaths do not produce Infinity or NaN.
Public rankings can still be viewed if profile bootstrap is unavailable; personal
statistics honestly remain unavailable. Errors offer Refresh, never invented rows.

## Deployment and development

No deployment was performed. When authorized, release the Worker first and then
GitHub Pages using the existing coordinated CI pipeline and credentials. Keep the
same Worker, SQLite Durable Object binding/name, allowed origins and frontend base
path. CREATE TABLE/INDEX IF NOT EXISTS initializes rankings in-place; do not delete,
recreate or reset the Durable Object. Existing old frontends retain v17 gameplay
compatibility. A new frontend against an old Worker shows a statistics availability
error until its endpoints are deployed. The existing CI health/release gate remains.

Local PowerShell (separate terminals, repository root):

```powershell
npm.cmd run dev --prefix server
```

```powershell
# Existing .env.local is preserved; it should point at ws://127.0.0.1:8787/ws
npm.cmd run dev
```

Validation commands:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
npm.cmd run test:protocol
npm.cmd run test:deployment
```

Browser QA (after a frontend/Worker dry build; serves the GitHub Pages base):

```powershell
node tools/serve-dist.mjs --port 4200 --base /crossfire/
# Separate terminal:
node tools/challenges-browser-test.mjs http://127.0.0.1:4200/crossfire/
```

`shared/statistics.ts` is independent of Cloudflare and reusable by a future Node
server. That server must provide durable atomic saves, event deduplication and an
indexed ranking repository equivalent to this adapter. The existing dedicated
server scaffold remains incomplete; this update does not migrate hosting.

Tests and limitations actually observed are recorded in the latest PROGRESS.md.
Local workerd/Chrome results do not validate public Cloudflare or massive populations.
