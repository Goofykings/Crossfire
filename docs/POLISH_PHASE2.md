# Polish Phase 2: scoring and match results

The Worker awards points only inside its guarded alive-to-dead transition:
100 base, 50 for a headshot on the final lethal hit, and
`20 * (comboCount - 1)` for the current combo. Nonlethal headshots and replayed
eliminations award nothing. Team match totals remain opponent eliminations;
individual bonus points do not change the team win condition.

The server-only `COMBO_WINDOW_MS` binding defaults to 4000. A kill must arrive
before the preceding deadline; exactly at the deadline starts a new combo.
Each kill renews the deadline. Death and round changes reset it. Valid resumes
retain the original deadline, including time spent disconnected. The existing
15-second resume grace is unchanged. Expired credentials create a new identity;
no client can restore scores, timestamps or an old identity by reporting them.

For a local override, in PowerShell from the project root:

```powershell
$env:XDG_CONFIG_HOME = $env:TEMP
npm.cmd --prefix server run dev -- --var "COMBO_WINDOW_MS:4000"
```

Use the same nonsecret Worker binding for a future authorized deployment.
Do not put it in a VITE variable or accept it from browser messages.

`round-ledger`, `round-result`, sessions and team totals are saved together.
The ledger retains real spawned participants after they leave so their earned
points still count for the winner and MVP. At the existing ten-minute boundary,
the Worker freezes the result before resetting current stats and reassigning
teams. Repeated callbacks cannot finalize the same round again. Reconstructing
after an elapsed boundary also finalizes the persisted ledger before replacing
it. Empty rooms still derive the current round from the unchanged schedule.

FFA uses highest numeric points; equal highest scores produce DRAW. Teams uses
the existing blue/red elimination totals, with a tied total producing DRAW.
MVP uses individual points across both teams; equal MVP scores use immutable
server IDs in lexical order. MVP can therefore belong to the losing team.

The client displays the frozen result to participants before loading their next
match. Next Match acknowledges it and resumes the existing load/spawn flow;
the server's next round is already running and never waits for the screen.
The latest completed result remains in snapshots/storage across reconnects.
Refresh closes transport without sending Leave or erasing the resume token.
Explicit Leave still invalidates it and cancels reconnection. A reconnect during
a map load cannot leave Next Match stuck owning an interrupted load promise.

The leaderboard sorts full integer points, using immutable IDs for tied ranks.
It formats scores by truncating to hundreds (`2450 -> 2.4k`) for display only.
The centered timer uses the server deadline and the existing synchronized clock;
refresh or reconnect never creates a new countdown. Per-player ping was not
part of the existing snapshots and no invented ping values were added.

Protocol is now **v10**: score/combo and previous-participation fields, an
elimination award breakdown, and the frozen result are validated together on
both sides. The dedicated transport scaffold reuses this schema and remains
incomplete; it does not host gameplay. Existing v9 sessions migrate with zero
new points and no combo, preserving their kills/deaths; historical headshot or
combo points cannot be reconstructed and are not fabricated.

The public Cloudflare `/health` endpoint was read on 2026-10-31 and reported
**v9**. New local frontend/Worker sources use v10 and intentionally reject v9
wire traffic. Cloudflare remains the default URL/provider. Matching frontend
and Worker releases are required when publication is authorized. No deployment
was performed and the new scoring was not tested on the public Worker.

Checks: frontend scoring/formatting/protocol/transport tests, real Worker combat
and persistence tests, and `tools/polish-phase2-test.mjs <frontend-url> ffa|teams`.
That browser check uses two real Chrome sessions and real WebSocket opponents,
actual server-confirmed kills, refresh/reconnect, results and Next Match.
