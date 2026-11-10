# Farmstead (2026-11-07)

A fourth playable map: an open rural yard (about 74 x 92 m play area, a 66 x 83.5 m fence line) with a
farmhouse, barn, cabin, garage and four open shacks, linked by dirt paths, with a close-quarters storm
shelter (about 920 m2 of rooms and tunnels) below. Source plan: `references_images/Newoutdoormap.png`
(0.125 m per pixel, origin at pixel (290, 370), north up); positions, openings and the fence gaps were read
from the image, not mirrored or rearranged. Gameplay, protocol (WebSocket v21, HTTP schemas) and Cloudflare
configuration are unchanged. Nine small posters from the shared `posters_fun` atlas hang on the exterior walls. Map schedule: `MAP_IDS` has a fourth entry and `mapRound` now reshuffles once per
full pass over the maps (with three maps it was identical).

## Layout

| | Plan | Built |
|---|---|---|
| Fence | dashed rectangle, gaps on every side | post-and-rail, 1.2 m, x -33..33, z -43..40.5; gaps: north 6.5 m, south gate 4.25 m, west 6.65 m, east 6.5 m and 6.5 m |
| Main house | living, hall, kitchen, dining, pantry, stairs, "balcony above" | 26 x 16.5 m; ground floor with all nine plan rooms/openings, east wing has an upper floor (3 bedrooms, landing, stairs) and a 11.5 x 6 m balcony over the dining porch, supported by posts, with a drop-down gap in its south rail |
| Barn | bay, two stalls, stairs, "balcony above" | 18.5 x 14.5 m; double-height bay (5.2 m), two stalls under a hayloft reached by a stair from the bay, forebay deck over the south yard on heavy posts (railing gap to drop down) |
| Cabin | two floors, balcony W/S/E | 13 x 10 m log cabin, stair in the east room, balcony wrapping west, south and east (posts and beams), **gap in the south railing** (x 21.2..22.8) |
| Garage | one floor, wide bay | 14 x 10 m; 5.9 m wide south bay opening, car, workbenches, drums; a workshop side room |
| Shacks | four, open on all sides | four 4.6 m pavilions: corner posts, raised plank floor, ceiling slab and a shed roof (market, wood shed, tool shack, hay shack) |
| Paths | south gate, house, garage, barn, cabin | dirt zones with ragged edges: `south_gate_path`, `house_apron`, `garage_path`, `barn_path`/`barn_link`, `cabin_link`/`cabin_path` |
| Trees / crates | 39 trees, 23 crates | the plan's positions (31 oaks inside, 9 pines on the boundary; 45 crates incl. extras under all three balconies), plus 20 hedgerows (cover and lane breakers) |

There are **no doors anywhere**: every gap of the plan is an open entry (a hole in the wall with a frame).
Windows are real openings too (sill 0.9-1.3 m), so lines of sight pass through them but a walker cannot.

Sightlines: the cabin balcony (5.0 m eye), the house balcony and the barn forebay overlook the yard and the
paths. Trees, hedgerows, the shacks and the buildings cut the lanes: the longest eye-level axis lane is 76 m
(the map is 84 m long); `tests/mapOverhaul.test.ts` keeps it under 76.5 m.

## Storm shelter (underground)

Style `farm` in `blender/scripts/lib/underground.py`: floor -3.5 m, 3.2 m clear, poured concrete walls, timber
joists, concrete piers (0.72 m), caged bulb lamps baked into vertex colours (no extra lights). Authored in
`tools/underground_layouts.py` `farm_underground()`:

- Nine rooms: Shelter Hall (hub, 6 piers, bunks, shelves), Dry Store, Cold Store (casks, racks), Generator
  Room, Pump Room (a stone cistern block), Bunk Room, Junction Room (6 piers), Tool Cellar and the Barn Root
  Cellar, joined by eleven short tunnels that are offset so no corridor is a long straight lane; every room has two
  or more exits and the rooms form a loop. About 800 m2 of rooms and tunnels (see "Polish 2026-11-10").
- Five surface entrances: the house hall and the barn's south stall (open straight stairs inside the buildings, each
  opening from a free landing), and three fieldstone storm-cellar portals under tin roofs (north meadow, east yard,
  south-west yard).
- 59 floor props (shelves, bunks, barrels, crates, drums, tank, benches).

## Polish 2026-11-10 (bushes, doorways, a smaller and darker shelter, chain lamps, puddles)

Gameplay, movement, weapons and the protocol are untouched. Layout, collision and map revision changed (the
shelter's rooms and two stairs moved), so frontend assets and Worker need a matching release when authorized.

**Bushes and hedges.** `bush` and `hedge_long` (props_farm.py) are now leaf sprays: alpha-cut cards (material
`leaf_bush`, atlas `public/assets/textures/farmstead/bush_leaves.png` from `tools/make_farm_textures.py`: four
512 px sprays, long leaf, bushy fan, broadleaf, fine twig, with midribs, veins and light/dark leaves) around a small
opaque core (`leaf_core`) and woody stems. Cards are shaded dark at the base and light at the tip with vertex colours,
bases sit at the core surface, and tips stay inside the unchanged catalogue sizes and colliders (bush 1.4 x 0.95 m,
hedge 3.8 x 2.9 m x 0.85 m collider), so no sightline, lane or Zone Control square moved. Each prop is built twice:
66 / 270 cards (`leaf_bush`) and 22 / 135 larger cards (`leaf_bush_lite`, a different cutoff so the batcher keeps it as a
separate material). `src/maps/FoliageLod.ts` draws one set per map cell: Chromebook mode draws lite everywhere, other
presets draw detail within 42 m of a cell and lite beyond (4 m hysteresis). Both sets share the batch cells, so draw
calls grow by about one batch per cell (8). The oak and pine canopies are unchanged.

**Doorways.** `tests/farmsteadDoorways.test.ts` audits every door of every wall on both sides: 1.4 m of floor with no
wall, stair, slab or stairwell drop in front of it, and at least one clear lane past furniture. It found exactly two
defects, both the shelter stairs: in the house hall the stair's top landing sat 0.3 m from the living-room door with
solid guard walls across part of it, and the barn stall door opened straight onto its stair, splitting the stall. The
house stair now starts 1.6 m into the hall (`[-4.2, 0.95, -2.2, 7.55]`, Shelter Hall's north edge moved to 7.55) and the
barn stair starts in the south stall with 4.6 m of floor before its mouth and runs north through the partition (cut to
the stair's width, opening `kind: 'stairwell'`) to a short tunnel into the root cellar. Indoor guards are timber
(`guard` on an entrance), the three outdoor portals keep fieldstone. A solid-overlap scan of the 514 structural boxes
found only intended joins (posts into beams, rail corners, fence corners), so no other building needed geometry changes.

**Smaller shelter.** Rooms and tunnels went from 922 to 802 m2 (-13.0%, -11.8% with the stairs): the Shelter Hall,
Cold Store, Bunk Room, Root Cellar, Pump Room, Dry Store and Tool Cellar lost margins that held nothing; no route
was removed (still a loop, five entrances, every room two or more exits). `tests/farmstead.test.ts` caps the area at
830 m2. Props, piers, blocks and the Practice walk lanes were re-placed with the layout validators.

**Atmosphere.** `blender/scripts/lib/underground.py` (style `farm`): floors, walls and ceilings are cut into 0.5 /
0.7 / 1.5 m cells so the baked vertex lighting has detail, with broad uneven darkening, mottling, water streaks
running down the walls and damp bands at the floor; the base light is low (0.19) and the lamp pools carry the rest.
`Environment.configureUnderground` (layout `ambient: {sky, ambient, sun}`) scales the sky reflection, the Chromebook
hemisphere light and the sun to 72% / 78% / 8% below the slab, fading in over the first 2 m of a stair, so the sky does
not light the shelter. The exported colours are bytes: 1.0 is the ceiling, which is why the sky is not dimmed further.

**Chain lamps.** 37 lamps (`farm_lamps`): rooms get a loose grid about 5.4 m apart, tunnels a lamp every 4.6 m, each snapped to a
joist and 0.8 m from any pier; six are dead (no light), nine are cold (blue-white), the rest warm, brightness
varies +-18%. Each is a ceiling plate, 5-8 alternating chain links (36-50 cm), a cap, a cone shade, a bulb
(`bulb_warm` / `bulb_cold` / `bulb_dead`, modest emissive) and a guard ring, with its lowest point at least 2.3 m above the floor;
visual only, no collider, no scene light (the four-light budget is unchanged). The pools are baked, so every preset
including Chromebook mode shows them.

**Puddles.** 31 irregular polygons, 16 puddles and 15 small satellites (`farm_puddles`: 3 harmonics of radius, stretched and rotated, 18-24 vertices, some
with satellites), never under a pier, block or prop, in a stair's foot or on a tunnel join, inside a darker `concrete_wet`
halo (plus the floor vertices near them darkened), 3 and 6 mm above the floor, no collision. Material `puddle` is managed
by `src/rendering/PuddleReflections.ts`: Medium, High and Ultra own ONE planar MirrorTexture for the whole floor plane
(256 / 384 / 512 px), listing only the materials that exist below ground, rendering every second frame and only while the
camera is under the slab (idle and cheap outdoors); Low and Chromebook mode own no render target and show a dark,
slightly glossy puddle. `Game.applySettings` re-applies the preset on any graphics or Chromebook change, so the setting
takes effect at once without a reload (`tools/atmosphere-test.mjs` checks this in Chrome; `__crossfire.atmosphere()` reports
the state). `MaterialLibrary.MANAGED` keeps the quality passes from overwriting it.

Rebuild: `python -B -I tools/make_farm_textures.py` (only if the leaf atlas changed), `python -B -I tools/layout_farm.py --write`,
`node tools/run-blender.mjs --only materials,props,farm`, restore the tracked `__pycache__` files and delete the new
untracked ones, then `npm test --prefix server`. Review shots: `node tools/farm-extra-shots.mjs <url> [outDir] [quality=...] [bush|arch|shelter] [chromebook]`.

## Pipeline

- `tools/farm_structures.py` authors the buildings as *elements* (walls with openings, slabs, stairs, rails,
  posts, roofs). `blender/scripts/lib/farmstead.py` derives the mesh **and** the collision from the same elements
  (every solid is tagged `farm:<id>:<kind>`), so walls, openings, stairs and rails cannot disagree. Roofs are
  visual only; each building has a solid ceiling slab at its eave so bullets and players stay out of the roof.
- `tools/layout_farm.py --write` assembles `src/maps/farmstead/layout.json` (ground zones, paths, props, spawns,
  targets, lights, `farm.structures`, `farm.fences`, `farm.solids`, `farm.entranceWalks`) and validates every
  prop against the real solids and stairwells.
- `blender/scripts/lib/terrain_farm.py` builds the ground (meadow, ragged dirt, exact interior floors) and merges
  the structures; `generate_all.py` stage `farm`; new props in `props_farm.py` (trees, hay, furniture, tractor,
  shelter storage); new materials in `materials.py` (grass, dirt, siding, logs, bark, leaves, hay...) and new
  Poly Haven textures in `tools/fetch_textures.py` (grass, dirt, siding, logs, bark) plus the procedural
  leaf and hay textures from `tools/make_farm_textures.py`.
- Collision: `collision_gen.map_collision` adds the farm boxes and now reads the play-area limits per axis
  (the map is not square; square maps get the same boundary boxes as before).
- Runtime: `src/maps/farmstead/index.ts`, `registry.ts`, `shared/maps.ts`, `server/src/world.ts`; the tactical
  map draws the exact wall/post/stair footprints (`tactical.ts` reads `farm.solids` and `farm.fences`).

Rebuild: `python -B -I tools/layout_farm.py --write`, `node tools/run-blender.mjs --only props,farm`, restore
the tracked `__pycache__` files Blender rewrites (`git checkout -- blender/scripts/lib/__pycache__ tools/__pycache__`
and delete the new untracked `.pyc`), then `npm test --prefix server` (it rebuilds the Worker bundle).

## Verification

`tests/farmstead.test.ts` (real shared controller, rifle and sniper rifle where it matters): every open entry of
every wall both ways, ground windows shut to walkers, every staircase up and down, the cabin balcony (railing
blocks, the gap drops to the ground, all three sides reachable from the upper rooms), the fence gaps, the shacks'
open sides, all five shelter entrances walked down and up, and Practice navigation from every spawn to every
room. The map also runs through the shared `MAP_IDS` suites (integrity audit, collision safety, tactical,
practice bots, overhaul walks, posters, geometry/z-fight). `tools/farm-shots.mjs` takes the review screenshots
(aerials, every building inside and out, balconies, loft, shacks, fence gaps, every shelter room).

## Limits

- Interiors are dim (two point lights, as on every map); the shelter is deliberately much darker than the yard, and its
  floor props (white IBC tank, crates) are not baked-lit, so they read a little brighter than the walls around them.
- The aerial thumbnail is a game screenshot (no Blender preview render for this map).
- Public Cloudflare behaviour was not validated; the frontend assets and the Worker need a matching release
  (maps and revisions changed). Old tabs need a refresh.
