# Legendary elimination effects: Blossom flower burst and Frosted blizzard (2026-11-12)

Visual only. Damage, scoring, kill credit, rewards, statistics, respawn timing, collision, protocol (v28) and the Worker are untouched.

## What was already there (Codex)

- `KILL_EFFECTS = ['money','blossom-flower-burst','frosted-blizzard']` and `killEffect(cosmeticId)` in shared/cosmetics.ts; Blossom and Frosted are
  Legendary collections with `killEffect` set.
- `eliminationEffect(equipment, weapon, position)` (shared/eliminationCosmetics.ts) is called by the Worker and by PracticeSimulation only on a confirmed
  alive -> dead transition. It reads the killer's validated inventory for the weapon that scored the kill (not whatever is held afterwards, so fast
  weapon switching is correct) and returns `{effect, cosmeticId, position}`; `position` is the victim's feet. grenade kills and incompatible ids return nothing.
- protocol.ts validates `cosmeticEffect` (effect id must match the cosmetic id, weapon compatible, killer is not the victim). Clients never claim it.
- `LegendaryEffects` (src/game/LegendaryEffects.ts) delivers each confirmed elimination id once and ignores `money`.

## What this change adds

`src/weapons/KillBursts.ts` and the wiring in Game.ts (`legendaryEffects.onEffect` -> `playLegendary`). All viewers (killer, nearby players, spectators)
draw the same effect from the same confirmed event at the same world position; nothing is sent over the network.

Four thin-instanced meshes of procedural geometry (no textures to load, so nothing can be missing): flower (5 notched petals, warm centre, vertex-colour
gradient), petal (cupped, 12 triangles), snowflake (six arms with side branches, 30 triangles), sparkle (four-point glint). Instance colour tints them.
Unlit emissive material with `fogEnabled=false`, world rendering group, depth tested (walls hide it). One shared material per mesh.

### Blossom (`blossom-flower-burst`)
Full: 26 flowers + 44 petals per burst. Flowers/petals pop in over ~0.11 s (overshoot ease) on a tall ellipsoid shell around the body (0.25-0.72 m), staggered
by up to 0.12 s; hold 0.15-0.24 s; burst outward 1.8-4.6 m/s with strong drag; then drift down to a 0.4-1.05 m/s terminal fall with sideways sway; petals tumble
about a random axis, flowers spin about the view axis with a gentle squash. Life 1.5-2.05 s, fade over the last 0.4 s. Never sinks below the floor.
Colours: bright pink, light pink, deep pink (petals add a few near-white).

### Frosted (`frosted-blizzard`)
Full: 54 snowflakes + 10 sparkles per burst. Appear over 0.12 s; swirl 0.85-1.03 s on individual orbits (own radius 0.14-0.86 m, squash, tilt, speed 5-12 rad/s,
a fifth spin the other way, a slow rising spiral and two sine turbulences, so it is never a clean ring); then leave along the tangent with an outward kick
(2.4-4.6 m/s) and drag while fading over ~0.26 s. Total 1.1-1.35 s. Sparkles twinkle. White, pale blue and ice blue.

### Budgets and lifecycle
- Pools are preallocated: no allocation per emit or per frame; CPU integration only while something is alive (the mesh is disabled when idle: a thin-instance
  mesh with count 0 draws its template).
- `BURST_BUDGET`: High/Medium/Low = 3 concurrent bursts per effect (78 flowers, 132 petals, 162 flakes, 30 sparkles max). Chromebook mode = 2 bursts and
  11 flowers + 14 petals / 22 flakes + 4 sparkles per burst, opaque (they shrink instead of fading: no blending or sorting), so about a quarter of the particles.
  The mode only uses the first `bursts * perBurst` particles of a pool, so it sets the real ceiling.
- When a third burst of one effect arrives, the oldest fades out within 0.16 s instead of popping (no unlimited emitters).
- Reduced motion (`prefers-reduced-motion`): half the particles, slower swirl and spin, no snap.
- Distance: viewers further than 150 m draw nothing; particles scale up to 2.5x with distance so far bursts stay readable.
- `Game.prepareKillBursts` creates the pools with the match assets and compiles both shader variants (blended and opaque) up front, so the first kill does
  not hitch. `clear()` runs on leaving a match and when a new round loads. Effects last at most 2.1 s, shorter than the three-second respawn delay.
- Review/test hooks on `window.__crossfire` (the first is DEV only): `deliverElimination(event)`, `killBurstInfo()`, `emitKillBurst`, `clearKillBursts`,
  `freezeKillBursts`, `stepKillBursts`.

## Verification (2026-11-12)

- tests/killBursts.test.ts (8): nothing enabled when idle; Blossom draws only flowers/petals and Frosted only flakes/sparkles near the event position; every
  effect ends with zero particles and no enabled mesh; 40 stacked kills stay inside the budget; Chromebook lite budget and opaque pools; reduced motion is
  smaller; beyond 150 m and `clear()`; dispose removes meshes/materials; only the two Legendary ids reach the renderer and a repeated id plays once.
- `node tools/kill-effects-test.mjs <vite url> [--chromebook]` (real Chrome, offline Practice match on Town): confirmed eliminations go through the real
  Game path; plain and Rich kills draw nothing; a Blossom event delivered twice plays once; both effects are drawn from three viewpoints (first person, a
  nearby player 5 m down the lane, a distant player about 20 m away, found with the engine's own camera-overlap probe), with the effect clock frozen and stepped
  to exact ages (0.05 s .. 2.05 s) so the frames are reproducible (test-results/kill-effects/<mode>/); nothing remains afterwards; 20 stacked kills stay inside
  the pools; no page errors, console errors or asset failures. Both modes: 15 checks, all passing.
- Frame time on this PC (Intel Iris Xe, headless, 40-frame mean): High idle 39.4 ms, six bursts on screen 41.8 ms; Chromebook idle 9.1 ms, with effects 9.5 ms.

## Limits

- Frames were inspected by eye in the Town alley only: High first person (both effects), near view (both), far view (Frosted); Chromebook first person (both).
  The other captured frames (Blossom far, Chromebook near/far) were produced and error-checked but not looked at. No other map, and no real character body in the
  frames: Practice with 0 bots has no victim model, so "flowers surround the character" was judged against the 1.9 m shell height, not an actual victim.
- A real Blossom/Frosted kill was not played with an owned skin: Practice uses the local inventory and the dev profile owns neither. The dispatch is covered by
  the real Game path with fabricated confirmed events plus the existing eliminationEffect/protocol tests.
- A separate spectator view was not tested; spectators use the same world-space path (the free-camera frames are that path).
- Real Chromebook hardware was not measured; the numbers above are an iGPU with Chromebook mode on.
- Frame times are from headless Chrome and include the whole scene.
