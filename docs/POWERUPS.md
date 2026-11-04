# Powerups mode

Implemented with the existing canonical Cloudflare room and shared authoritative
simulation. FFA, Teams, ten-minute rounds, map rotation, score awards, respawns,
wallet/challenges and the coordinated Worker/Pages release workflow remain.
Powerups uses FFA relationships, standings, winner and MVP selection. A running
round retains its persisted mode when new server code is released; subsequent
rounds can select any of the three modes.

## Rules and balance

`shared/powerups.ts` is the hosting-independent source for ability types,
durations, damage absorption, burn cursors, pickup field state and spawn tuning.

| Ability | Duration | Server rule |
| --- | --- | --- |
| GIANT | 15 s | 1.5x size, movement speeds, firearm damage and maximum HP; current health preserves its percentage on activation, replacement and expiration |
| DOUBLE JUMP | 15 s | One extra airborne Jump press; launch velocity is sqrt(2) times normal, giving twice normal jump height from that point |
| FIRE | 15 s | Confirmed firearm hits apply one five-second burn at 10 HP/s; another hit refreshes duration and assigns ownership to the latest applier |
| SHIELD | 15 s | 75 absorption points, consumed before health by every damage source; overflow damages health |

Shield absorption also counts as damage for the regeneration delay. Burn uses
elapsed server wall time with a persisted cursor, never a player timer. It blocks
regeneration and restarts the usual five-second delay after its latest damage.
Sparse ticks are split at shield/Giant expiry boundaries to preserve damage and
health percentages. Burn kills use the existing exactly-once elimination path,
100 base points, applicable combos, grenade reward and challenges, without a
headshot or a firearm-specific challenge increment. Posthumous burn ownership
is retained, without giving a dead applier a live combo timer.

Only one ability is active. Replacement does not reset the movement controller's
airborne extra-jump consumption. Death, respawn and new rounds clear abilities
and burning; reconnect/reconstruction preserve absolute expiry times, remaining
shield, burn ownership, jump usage, life, ammo and score. Burning victims continue
to take elapsed damage while temporarily disconnected. Already-applied burns
can finish after the applier's FIRE ability ends or the applier dies/leaves.

Giant activation requires room for the full standing enlarged cylinder and gun
path. If blocked, the cube remains available; there is no teleport or forced
positional correction. Growth reserves the full collider immediately. Camera
height follows a shared 250 ms transition used by both firing and prediction.
Shrinking retains collision clearance for the returning head until the
transition completes. Weapon clearance, leaning, hit detection and grenade
occlusion use the appropriate enlarged dimensions. Normal jump strength,
grenade damage/radius, inventory, weapon ammunition and fire rates are unchanged.

## Pickup locations and scheduling

Each map builds a pool from its authored ground navigation and authoritative
collision world. A normal-player flood fill starts at approved spawn points,
checks every connecting edge, and excludes disconnected sealed areas. Candidates
need a flat, two-metre-wide clear patch, floor support, standing/Giant headroom
and playable bounds. Stairs, narrow routes and prop intersections are excluded.
Locations are ground-level deliberately; no inaccessible roof pickups.

Random selection favors positions separated from existing cubes, with no shared
position. Collection checks an alive connected player's region and an
unobstructed path. A claimed cube is removed before another player can claim it.

| Alive connected players | Maximum cubes | Spawn interval |
| --- | --- | --- |
| 1–2 | 2 | 20 s |
| 3–4 | 3 | 15 s |
| 5–6 | 4 | 10 s |
| 7–16 | 5 | 10 s |

Spectators and disconnected sessions do not increase these rates. Room alarms
schedule spawning and expiry while idle; movement, burns, growth and existing
active simulations use the room tick. There is no repeating timer per player
and no permanent idle tick that prevents WebSocket hibernation. Reconstructed
sockets have a bounded grace period to process queued heartbeats, then the
ordinary watchdog applies. Debug logging remains off by default.

## Protocol, presentation and hosting

Shared protocol **v17** adds Powerups mode, optional ability/status/pickup fields,
validated pickup/second-jump events, authoritative fire trace endpoints, burn
elimination cause and the movement state needed for size and extra jumps.
Production snapshots always send the new ability/status fields; omission in
normal legacy-shaped fixtures means no ability. Unknown client commands, force,
damage, camera positions, ability assignments and arbitrary size are rejected.
Normal-mode snapshots cannot carry active powerups. New health/hit bounds account
for Giant and shield, with the one-ability restriction preserved.

`PowerupView` uses shared cube geometry/materials, a small ground ring, bounded
short-lived traces/jump sparks and at most five small flames per burning remote
player. Shields use a translucent depth-tested shell with a brief hit pulse.
Particles/transforms are never streamed. The existing character/weapon rig is
scaled at its feet; no second pose system or full scene is introduced.
`PowerupHud` uses the multiplayer clock for its duration bar/countdown; the
leaderboard gets a compact ability label and clears expired labels.

The future dedicated-server scaffold continues to validate the shared protocol
but is still intentionally not a gameplay server. These pure rules and field
state can be reused by its eventual room implementation. Cloudflare remains the
default; no URL, origin allowlist, Durable Object binding, Vite base or credentials
were changed.

## Validation and release

Focused tests are `tests/powerups.test.ts`, `server/tests/powerups.mjs` and
`tools/powerups-browser-test.mjs`. The Worker test uses actual TCP WebSockets,
workerd, strict shared parsers and the production simulation. Its test-only RPC
places real spawned players, creates cubes only in the validated pool and
accelerates specific clock boundaries; it never fabricates damage, scores or
successful connections. The browser tool uses two real Chrome contexts and the
production build served under a GitHub Pages-style base path.

Run standard checks from the repository root:

```powershell
npm test
npm run build
npm run typecheck --prefix server
npm test --prefix server
npm run test:protocol
npm run test:deployment
npm test --prefix server-dedicated
```

For the optional local browser check, build first and use separate terminals:

```powershell
node tools/serve-dist.mjs --port 4200 --base /crossfire/
```

```powershell
node tools/powerups-browser-test.mjs
```

The browser tool starts an isolated local Worker automatically. Ordinary local
play still uses `npm run dev --prefix server` and `npm run dev` with the existing
local multiplayer URL configuration. No new account, secret or asset export is
needed. Both frontend and Worker must be released together for v17 using the
existing checked CI pipeline. No commit, push or deployment is part of this task;
local testing does not establish public Cloudflare compatibility or performance
on physical Chromebooks. Final test results are recorded in PROGRESS.md.
