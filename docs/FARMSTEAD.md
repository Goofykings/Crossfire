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

## Perimeter wall, ivy and foliage rebuild (2026-11-12)

The invisible boundary is gone: a visible, overgrown fieldstone wall surrounds the whole yard and **is** the boundary. Gameplay
(buildings, shelter entrances, paths, spawns, Zone Control squares, weapons, movement) is unchanged. Everything is generated:

| Part | Source | Output |
|---|---|---|
| Wall spec (inner face, 32 piers, 4 corner piers, 36 sections) | `blender/scripts/lib/perimeter.py` `build_spec`, called by `tools/layout_farm.py` | `layout.json` `farm.perimeter` |
| Stonework mesh (11.7k triangles) and collision boxes (108) | `perimeter.mesh` / `perimeter.boxes` via `farmstead.generate` / `farmstead.collision_boxes` | `terrain.glb`, `collision.json` |
| Vines, ivy, weeds, moss tufts (6.9k cards, lite set 3.0k) | `blender/scripts/lib/perimeter_ivy.py` | `terrain.glb` (`leaf_ivy`, `leaf_ivy_lite`) |
| Leaf-card foliage (hedges, bushes, oaks, pines) | `blender/scripts/lib/foliage.py`, `props_farm.py` | `shared/props/*.glb` |
| Stone texture set | `blender/scripts/make_stone_textures.py` (Blender's Python) | `textures/farmstead/stone_wall_{albedo,normal,orm}.jpg` |
| Ivy atlas | `python -B -I tools/make_farm_textures.py ivy` | `textures/farmstead/ivy_leaves.png` |

### Wall

- Inner face at the play area plus half a metre (x -37.5..37.5, z -47.5..45.5): exactly where the old invisible slabs stood, so the
  playable area is unchanged. 0.9 m thick, sunk 2 m into the ground in the collision.
- Section tops 3.10 to 3.42 m (the house, cabin and barn ground walls are 3.4 m): five heights, never two equal neighbours.
  Separate coping stones, 55% flat and the rest chipped up to 14 cm low, overhanging the outer face only. A plinth 0.55 m high
  and 0.1 m proud, fallen stones against the foot (inside the plinth's 0.28 m, where nobody can stand).
- Piers 1.3 m wide, 0.4 m proud on both faces, 3.62 m high with a cap and finial, every 9 to 12 m and never within 1.3 m of a
  hedge or tree; corner piers are 2.1 m squares. Corners are real corners: the sections meet the corner piers' faces.
- Stone: irregular courses of irregular blocks (about 49 x 30 cm), dark recessed mortar, chipped corners, cracks, lichen, moss in the
  joints. One 2.4 m repeat; per-section UV offsets and vertex colours (damp and moss near the ground, rain streaks, blotches) break
  the repetition. Wall faces are 1.2 x 0.85 m quad grids with a 2.5 cm inward relief; their UVs come from the ideal face plane,
  because the tilt of relief quads would shift the texture by metres.
- Terrain: the yard is flat (y = 0), so the wall has no steps to follow; it continues 25 cm below ground, so no seam shows.

### Collision and bullets

- One box per section (top = the section's height, so the stones are the only thing that can be hit), per pier and per plinth.
  Sections and piers overlap by 2 cm. Bodies, plinths and pier shafts are the faces players see; the coping and pier caps never
  reach past the inner face, and the 2.5 cm relief is inward only, so a bullet mark is at most 2.5 cm off the stone.
- `collision_gen.map_collision` adds no `boundary` slabs when `farm.perimeter` exists (other maps keep theirs): nothing invisible
  remains, and a ray rising 30 degrees over the wall hits nothing.
- `farm.solids` carries the footprints (tactical map, Practice navigation); navigation stays inside the play area.
- `tests/farmPerimeter.test.ts`: closed ring (probed every 5 cm), no overlap with props, spawns, targets or zone squares; walking,
  jump-spamming and slide-spamming into every side and corner from 2.5 m; jump-running off every deck, balcony, loft and even railing
  top within 16 m of the wall (none of them clears the wall); bullets hit a stone face at every height; the
  margin strips stay closed by their hedges.

### Foliage

Every tree, bush and hedge is now a **volume of alpha-cut leaf cards** around a small dark opaque core (`leaf_core`, which stops
bullets). The cards are rooted on the volume's surface and lie along it like shingles, tilted 20 to 50 degrees outward and
biased up the surface; a quarter of them roll up to 80 degrees and stick out as fuzz at edges and corners. They are double sided
and use the existing leaf atlas. Hedges are built section by section (about 0.95 m long), each with its own height, thickness
and density; cards never bridge a lower neighbour, so the steps in the top show.

- Eight hedge shapes (`HEDGE_VARIANTS`): long 3.8 x 2.9 x 0.95, tall 3.4 x 3.7 x 1.05, low 3.9 x 2.35 x 0.9, wide 4.2 x 2.8 x 1.5,
  thin 3.2 x 2.7 x 0.7, short 2.6 x 2.6 x 0.95, block 4.2 x 3.1 x 1.9, run 4.7 x 2.6 x 1.0 (the colliders). Each has an uneven
  top (a clearly lower section, small swells), rounded or squared ends, thinner stretches and a few gaps in the leaf cover (the core
  stays: no see-through or walkable gaps). The 20 hedgerows use all eight, a few turned a few degrees; the margin-strip hedges
  (4.2 m or longer, 4.7 m in the 5 m south strip) still close the strips to 0.1 m of the fence and the wall. Sightline lanes are
  unchanged (`tests/mapOverhaul.test.ts` limit 76.5 m).
- `tests/farmFoliage.test.ts` reads the shipped GLBs: no edge-on view (weakest of 26 view directions at least 45% of the mean),
  the silhouette is filled from the front, sides, back and above, shapes stay inside the catalogue size plus 35 cm, both card
  sides render, each hedge has a non-flat top, ivy stays within 2.1 m of the stone and is patchy (bare and heavy stretches on
  every side).
- Oaks: 8 lobes, about 340 cards (lite 140); pines: five tiers of drooping boughs plus tier bodies, about 170 cards (lite 55);
  bushes 110 cards; hedges 430 to 800 cards.

### Ivy and vines

A vine is a path in (distance along the wall, height). It climbs with a wandering heading, branches, and wraps around pier corners
and the corners of the yard because the loop it lives on follows the actual wall faces (runs, three faces of every pier, two faces of
every corner pier). Cover is patchy by a noise field: long bare stretches, heavier growth at corners and piers; some vines go over the
coping and hang down both faces; weeds grow from cracks, the plinth and the ground at the foot, moss and grass on the coping. Cards stay
3 to 9 cm off the stone in layers a few millimetres apart; planes within about 25 degrees of the wall. The ivy atlas has four cells:
vine strand, dense patch, weed tuft with small flowers, moss tuft. The ivy neither casts nor receives shadows (it flickered with the
wall's own shadow and would add thousands of casters).

### Performance

- Detailed and lite sets are baked side by side (`leaf_bush`/`leaf_ivy` and the `_lite` twins: 40% of the cards, 50% larger); the
  twins differ in alpha cutoff and roughness so the batcher keeps them apart. `src/maps/FoliageLod.ts` draws the lite set everywhere
  in Chromebook mode and beyond 42 m otherwise (hysteresis 4 m), per 40 m map cell; `window.__crossfire.foliage()` reports it.
- Chromebook mode keeps the wall and its collision; stone drops to 256 px albedo with no normal map; foliage is the lite set; ivy
  never has shadows and shadows are off anyway. Wall draw calls are one batch per cell and material.
- `terrain.glb` grew from 2.5 to 5.0 MB (the stone grids, coping and both ivy sets).

### Review tools

`node tools/farm-perimeter-shots.mjs <url> [wall corners hedges trees entrances chromebook]` (contact sheets in
`test-results/farm-perimeter/`), `node tools/farm-wall-impacts.mjs <url>` (bullet marks on the wall, High and Chromebook),
`python -B -I tools/foliage_stats.py` (extents and triangle counts of every foliage prop).
