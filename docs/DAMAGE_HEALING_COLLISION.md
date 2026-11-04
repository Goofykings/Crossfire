# Damage/healing feedback and collision safety

## Confirmed collision defect

The shared controller previously moved to a horizontal endpoint, then pushed the
body out of each overlapping OBB (up to four iterations). Its collision band
always omitted the bottom 0.42 m, including in flight. Its ground probe used only
70% of the collision radius. Falling beside a raised wall could therefore lose
landing support while the full body still overlapped the wall; when the feet
passed the step-height threshold, a large lateral push-out suddenly activated.
Corrections were not bounded by attempted movement and could enter neighboring
solids. Weapon probe corrections also were not rechecked against the body path.

A seeded real-map diagnostic reproduced this on Industrial Complex wall W11
with the Giant radius 0.51 m. From (-22.640758, 2.618385, 20.417348), the original
controller first descends into the edge and on the following tick moves 0.207845 m
sideways despite requesting approximately 0.05875 m. The new controller catches
the 3 m top using consistent support, blocks inward airborne movement, and makes
no outward push. A separate controlled thin-wall seam (two 2 cm walls, angle 0.02 radians)
reproduces a full escape: repeated slides accumulate penetration until the old
solver moves 0.700759 m in one tick and crosses the wall. The new solver stops
without overlap at the legal wedge width, with at most 0.065 m per tick.

The exact complete reported slide-to-outside route was not
available/reproduced; this is the confirmed penetration/correction defect rather
than a claim to have recorded that entire user sequence.

## Movement changes

- Shared `CollisionWorld.moveCylinder` sweeps the circular cylinder footprint
  against OBB faces AND rounded corners, retaining the unused tangential motion.
  It finds the first contact on the entire path, including thin walls; up to five
  contact iterations are bounded and cannot add outward displacement. Existing
  overlap permits escape but never causes a shortest-exit teleport.
- Existing high-speed substeps and 120 Hz fixed simulation remain. Only grounded
  descending bodies receive the legal step-height allowance. Airborne feet collide.
- Landing uses full body radius. Vertical contact queries span old-to-new height
  instead of querying only an already-crossed floor/ceiling endpoint. Standing
  headroom also uses the full radius.
- Existing weapon envelopes sweep their attempted movement rather than pushing
  out of endpoint overlap. Their final movement is swept against the body again.
  Weapon position, animations, wall-fire checks, clearance lengths and lean rules
  remain intact. Stair lift and low barrel envelopes are preserved.
- `unsafeMovement` is a secondary server check for non-finite state, positions
  outside the existing perimeter, or more than 1 m below the lowest ground.
  It invokes the existing no-attacker elimination and validated respawn flow,
  with the normal cooldown; it awards no kill/points and runs once per alive life.
  Invalid grounded state also wakes the simulation. Practice uses its existing
  respawn flow. Debug-only `movement_recovery` logs include map, life and position.

All three collision inventories were audited: finite transforms, positive solid
extents, four existing thick perimeter boxes, and continuous ground over a 1 m
sample grid throughout each play area. No missing floor or perimeter geometry was
identified, so no invisible barriers or Blender/GLB changes were added. This audit
is not a claim that every rendered triangle/normal has been manually inspected.

## Feedback

Red uses eight irregular blurred radial patches, a central transparency mask,
a damage-scaled bounded peak, 75 ms attack and 550 ms release. Repeated hits start
from current opacity; the existing directional arrow/camera-basis calculation is
preserved. Confirmed non-ray HP loss (for example burn) has no invented direction.
Hit events precede snapshots, so the paired health loss does not duplicate a flash.

Green uses the same edge style at lower intensity with a 90 ms attack and short
release when confirmed gains cease. A snapshot observer rejects duplicate/stale
frames and treats spawn/life/round/maximum-health changes as baselines, not healing.
It does not predict the five-second regen timer or alter authoritative HP rules.
Damage immediately clears green and its symbols. Maximum HP clears them too.

Six reusable, input-transparent plus nodes supply approximately two symbols per
second, with randomized edge-only placement, 20-40 px rise and 500-900 ms lifetime.
Expired nodes are hidden/reused. Background tabs never catch up with particle
bursts; no extra interval, renderer, texture, physics object or network message is
created by the presentation code.

## Validation and release

Focused Vitest coverage is in `tests/collisionSafety.test.ts`,
`tests/healthFeedback.test.ts`, and the updated `tests/damageFeedback.test.ts`.
Existing movement, stairs, leaning, powerup and grenade coverage remains enabled.
`server/tests/traversal.mjs` adds two real workerd/WebSocket peers on all three
maps, all four weapons across those maps, slide/ADS wall approaches, equal peer
positions, resume identity/state, and once-only out-of-bounds/below-map recovery.

`tools/damage-regeneration-test.mjs` uses an actual local Worker shooter and a
Chrome gameplay client. It records server-confirmed directional hits and actual
regeneration, checks the HUD, interrupt/restart/max-health behavior and symbol
pool, and inspects real gradient CSS pixels at 800x600, 1280x720 and 640x480.
Black-background CSS probes only freeze recorded confirmed-event styles for
pixel inspection; they do not manufacture health, damage or gameplay events.

See the latest PROGRESS.md entry for executed checks and results. Local testing
cannot validate the public Cloudflare deployment or every possible map trajectory.

Protocol remains v17; no message validation is relaxed. The movement revision is
included in the existing map hash, so mismatched frontend/Worker physics reject
joining instead of silently predicting different collisions. Both frontend and
Worker require a matching release through the existing backend-first CI workflow.
No map assets need exporting. No commit, push or deployment is part of this task.
