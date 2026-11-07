# Grenade buffs and voluntary aim assistance

Implemented and tested locally November 6, 2026. No commit, push or deployment.
Both frontend and Worker need a matching release through the existing CI when
authorized. Gameplay protocol stays v19: no client hit/strength/position claims,
new message types or movement fields. Existing schemas remain strict; blast hit
amounts still cannot exceed the victim's maximum 100 HP even though raw damage is
now 200. Existing weapon statistics, grenade inventory/kill rewards, scoring,
maps, account data, public/private rooms and unrelated settings are preserved.

## Authoritative grenade rules

`shared/grenades.ts` centralizes the shared `GRENADE` balance table. The Worker
and offline Practice simulation both use it.

| Parameter | Value |
| --- | --- |
| Peak raw damage | 200 HP (was 100) |
| Blast radius | 5.2 m (was 4.2) |
| Full-damage inner plateau | 0.65 m |
| Falloff exponent | 1.15 |
| Fuse / projectile collision radius | unchanged: 2,000 ms / 0.065 m |
| Full charge | 1,100 ms (was 1,500) |
| Tap / maximum throw speed | unchanged: 3.2 / 24.5 m/s |

Distance measures the nearest height of the actual standing/crouched player body.
For `t = clamp((distance - .65) / (5.2 - .65), 0, 1)`, raw damage is
`200 * (1 - t*t*(3 - 2*t))^1.15`, then capped by actual remaining health.
It reaches zero smoothly at the boundary. Solid-world ray occlusion is unchanged.

| Unoccluded distance | Raw HP |
| --- | --- |
| 0–0.65 m | 200 |
| 2 m | 152.10 |
| 3 m | 85.02 |
| 3.4 m | 58.95 |
| 4 m | 26.41 |
| 4.2 m | 18.08 |
| 5 m | 0.52 |
| 5.2 m | 0 |

This is at least twice the old raw curve at every previously damaging distance.
The grenade owner is excluded by authoritative session ID, even across lives;
no self damage or impulse is generated. Teams retain their no-friendly-fire rule.
There are no grenade damage-over-time/secondary damage systems to exempt.

After a surviving opponent receives actual damage, let `s = min(1, damage/100)`.
The server adds an outward horizontal impulse of `8*s` m/s and an upward impulse
of `3*s` m/s. Combined horizontal speed is capped at 12 m/s; upward speed is
capped at the existing 6.6 m/s jump speed. A blast interrupts an active slide and
applies its existing one-second cooldown; it does not alter global slide tuning.
Normal controller substeps, weapon clearance, wall sliding, floor/ceiling
collision and map perimeters constrain the motion. There is no teleport or
client-supplied impulse. Existing velocity snapshots/reconciliation and durable
movement restoration carry it, including reconnects. Eliminated characters keep
the existing cosmetic falling animation rather than moving an authoritative corpse.

## Charging, smoke, debris and camera

The old UI deliberately hid the ring until charge exceeded 6.5%, adding about
98 ms of visible delay. It now displays as soon as a charge becomes active, with
a 2.2 px white stroke, dark full track and shadow. `presentationProgress()`
interpolates between simulation ticks for the HUD only. The server still credits
both held simulation ticks and elapsed authority time, cancels stale holds, and
accepts no client duration/power. Release immediately launches using credited
charge; no presentation animation gates the throw. A tap remains a minimum-power
throw. Local browser release-to-authoritative-throw measurements were below 200 ms
(including normal render/network batching), not an added throw delay.

`GRENADE_FX` centralizes 25% lower smoke volume and 25% lower density. Radius and
sprite dimensions scale by cube-root(.75); opacity/fog and LOS use the new density.
The existing rising cloud, five-second dense period and two-second fade remain.

| Cosmetic burst | Normal | Reduced effects | Chromebook |
| --- | --- | --- | --- |
| Dirt/dust puffs (was 18) | 54 | 27 | 12 |
| Colliding tiny rocks (was 12) | 36 | 5 | 5 |
| Outward sparks (was 10) | 30 | 4 | 4 |

Dirt has randomized strong outward motion, gravity, spin and a 0.35–0.75 s fade;
rocks use the existing swept cosmetic collision and expire by 1.2 s. Pools remain
bounded: 256 dirt/trail sprites, 144 rocks, four fire/spark slots, two shadowless
lights and the existing 12-cloud budget. Chromebook mode disables burst lights.
No gameplay prop bodies or object-transform broadcasts were added.

Only a fresh, confirmed local damage entry from another player's grenade triggers
`BlastShake`. It adds damped lateral/vertical camera translation and optical-axis
roll, scaled by damage/100, capped under repeated hits, and ends at exactly neutral
after 0.5 s. The viewpoint uses the existing safe eye/lean collision limits. Player
yaw/pitch and shot aim angles are untouched. Recoil and mouse input retain their
existing behavior. `prefers-reduced-motion: reduce` suppresses the shake entirely.
An undamaging/occluded/self explosion no longer shakes the camera just for proximity.

## Aim assist

Settings → Gameplay → **Aim assist (subtle, manual input only)** is explicitly
opt-in and saved in the existing settings record. Default is Off. The central
`AIM_ASSIST` parameters in `src/player/AimAssist.ts` include:

- 2.5° activation cone; target distance 2–35 m.
- Meaningful voluntary input: at least 0.4°/s and no more than 180°/s.
- At most 12% of voluntary input, weighted toward the center of the cone;
  exponential response 6/s, capped at 1°/s and 0.25° per gesture.
- Only a 180 ms initial-correction window. A new gesture requires a 100 ms
  manual-input gap; no automatic selection of another opponent mid gesture.
- Target speed above 0.35 m/s or angular motion above 4°/s requires manual
  tracking in the same direction, at least 60% of target angular speed.
- Jumping/sliding targets, lost LOS, smoke, aim moving away, no mouse input,
  weapon cooldown, active recoil or firing cause no correction. Firing also
  suppresses assistance for at least 350 ms; active recoil can extend that period.

It chooses a body point on an already visible opponent and verifies that exact
point against existing mesh visibility and smoke. Teammates/dead players are
excluded. The cone is well inside every supported FOV. Only voluntary local
player look receives a correction: recoil state, bloom, spread, trajectories,
damage and server validation are not modified. No aim-assist wire messages exist.
Disabled mode performs no target gathering or assist LOS casts.

## Verification and limits

- Frontend: 674 tests passed, one pre-existing skipped. Frontend typecheck and
  production build pass. Worker typecheck/dry-run build pass.
- Full backend integration: 79/79 passed, including four-client FFA/Teams owner
  immunity, lethal/medium damage, direction/capped movement, no duplicate scores,
  durable reconnect, existing grenades/crouch, assists, health, rooms and maps.
- Actual frontend transport / Worker protocol compatibility: 1/1 passed.
- Unit regressions compare the full old/new falloff curves, smoke reduction,
  bounded particle pools, exact shake recovery/optical axis, 1.1 s charge,
  collision/replay at 30/60/144 FPS, opt-in persistence, narrow cone, LOS, target
  motion/reversal, input override, recoil suppression, no switching and frame-rate
  consistency. The old posthumous-kill integration fixture needed its unrelated
  third peer moved outside the new blast; exact scoring assertions were retained.
- Chrome + actual local Worker: 19/19 in Vite, 19/19 in production `/crossfire/`
  with Chromebook mode, 20/20 in production with reduced motion. Verified live
  manual correction/stop/wall blocking, early ring visibility, ~1.1 s full charge,
  immediate release, actual particle counts, cleanup, smoke opacity, damage-only
  shake, accessibility and authoritative client knockback. No page errors/404s.
- Fully offline Practice browser regression: 25/25, with bot combat, all maps,
  reload/grenades, results/restarts, unchanged account data and zero backend
  requests/sockets throughout Practice.
- Screenshots were inspected under ignored `test-results/grenade-assist-browser*`.
  Browser test tools redirect gameplay only to a separate local Worker; test
  fixtures place actual clients, never invent hit/explosion messages.

No public Cloudflare/Pages deployment was tested. Headless Chrome on this machine
is not a physical Chromebook performance benchmark. The small aim-assist values
are initial tuning and may need playtesting; they do not implement controller aim
assist or continuous enemy tracking. Explosion particles are cosmetic and do not
participate in authoritative gameplay physics.

Repeat checks with `npm.cmd test -- --maxWorkers=2`, `npm.cmd run build`,
`npm.cmd run typecheck --prefix server`, `npm.cmd test --prefix server`, and
`npm.cmd run test:protocol`. Browser checks:

```powershell
# Separate terminals:
npm.cmd run dev -- --host 127.0.0.1 --port 4201 --strictPort
node tools/grenade-assist-browser-test.mjs http://127.0.0.1:4201/
node tools/practice-browser-test.mjs http://127.0.0.1:4201/

node tools/serve-dist.mjs --port 4200 --base /crossfire/
node tools/grenade-assist-browser-test.mjs http://127.0.0.1:4200/crossfire/ --chromebook
node tools/grenade-assist-browser-test.mjs http://127.0.0.1:4200/crossfire/ --reduced-motion
```
