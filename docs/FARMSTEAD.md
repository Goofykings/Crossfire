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

- Eight rooms: Shelter Hall (hub, 6 piers, bunks, shelves), Dry Store, Cold Store (casks, racks), Generator
  Room, Pump Room (a stone cistern block), Bunk Room, Junction Room (6 piers), Tool Cellar and the Barn Root
  Cellar, joined by ten short tunnels that are offset so no corridor is a long straight lane; every room has two
  or more exits and the rooms form a loop.
- Five surface entrances: the house hall and the barn's first stall (open straight stairs inside the buildings),
  and three fieldstone storm-cellar portals under tin roofs (north meadow, east yard, south-west yard).
- 59 floor props (shelves, bunks, barrels, crates, drums, tank, benches).

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

- Interiors are dim (two point lights, as on every map); the shelter is deliberately darker than the yard.
- The aerial thumbnail is a game screenshot (no Blender preview render for this map).
- Public Cloudflare behaviour was not validated; the frontend assets and the Worker need a matching release
  (maps and revisions changed). Old tabs need a refresh.
