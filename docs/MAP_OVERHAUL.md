# Map overhaul (2026-11)

All three maps were redesigned, rebuilt from their procedural sources and reviewed
in the browser: European Town, Industrial Complex and Modern City. Footprints stay
52 x 52 m (Town) and 54 x 54 m (Industrial, City). Protocol, round length and
rotation are unchanged; layouts, collision and map revisions changed, so the
frontend assets and the Worker must be released together when authorized. Nothing
was committed, pushed or deployed.

## Root causes found (phase 1)

| Defect | Cause | Fix at the source |
|---|---|---|
| Same-looking maps with 47.5-49.5 m clear eye-level sightlines | All three compact layouts were one ring-road topology | New authored networks per map in `tools/compact_layouts.py` |
| City railings acted as solid 2 m slabs | Railing "walls" collided as full boxes | `collision_gen.py`: railings collide on a 0.12 m centre-line strip |
| Town retaining walls invisible from the street | Terrace faces wound inward | `terrain.py` emits them with `face_toward` outward |
| See-through stair sides (dock, terraces) | Partial stair runs had no side faces | Side faces from the ground to each tread height |
| Inside-out cart wheels | Reversed tyre/rim winding | `props.py` cart wheel faces reversed |
| Freestanding 3.6 m walls in lanes | Thin leftover lots became walls | Layout adjustments; `layoutkit` lot claims |
| Empty interiors | No dressing inside halls | Racks, machinery, counters; circulation fit-outs |
| Street decals floating over stairwells | `terrain_industrial.details` ignored openings | Decals, manholes and storm drains skip stairwell footprints |
| White blotches on streets | Oil-stain decal roughness 0.35, no AO map | Roughness 0.92; stains only where vehicles stand |
| Hand-placed props silently dropped | Authored spots conflicted with doors or each other | Relocated; clearance diagnosed per prop |
| Props at circulation exits | Clearance ran before the exit stairs existed | `realism_layout` keeps entry approach, exit stair and landing clear |
| Spawns facing an exterior stair | Facing search saw only ground classes and props | `spawn_points` stops facing rays at authored ground obstacles |
| Utility pole through a canopy | Pole spacing ignored arches | City alley poles slide clear of arch/canopy footprints |
| Lantern on stair treads, pot at a stair head | A small footprint fits on one tread, so the flatness check passes | Moved; a test keeps solid props off flights |
| Isolated regions undetectable | The audit's crouched flood is seeded from every spawn | Spawn-to-spawn walking test using the controller's body rule |

## Shared systems

> **2026-11-07:** the passages were rebuilt deeper and much larger (metro floor -3.8 m with
> 3.5 m clear, cellar -3.5 m with 3.2 m clear, per-style stair counts, piers, blocks, decor and
> props); the dimensions below (-2.6 m / 2.3 m, 16 risers) are historical. See
> docs/UNDERGROUND_POSTERS.md.

`blender/scripts/lib/underground.py` (pure Python) owns underground passages: one
set of solids feeds the visible mesh, `collision_gen.py`, navigation obstacles,
spawn/dressing exclusion and the server's lowest legal floor
(`shared/movementSafety.ts`). Dimensions: floor -2.6 m, ceiling -0.3 m (2.3 m
clear), 0.3 m walls and slab, 16 risers of 0.1625 m on 0.3 m treads. Entrances are
`dogleg` (two flights of 8 with a 1.8 m turning landing, roofed portal) or
`straight` (16 steps, 1.2 m bottom landing, guard rails and wall handrails). The
street ground box is cut by `ground_holes` (passages below the slab, full depth over
each stairwell, the throat at each foot); the terrain base plane is cut by
`ground_openings`. Babylon's four-lights-per-material limit rules out more point
lights, so underground lamp pools are baked into vertex colours and the lamps are
emissive meshes.

Dressing: `compact_dressing.finish_layout` reserves stair footprints with a 0.6 m
landing, ladders, upper routes, doorways and facade doors; `realism_layout` then
removes props in a circulation building or on its approach, exterior stair and foot
landing (it prints anything it drops). `layoutkit.relocate_doors` slides facade doors
so authored furniture can stay. Spawns (`spawn_points.py`) avoid stairwells and
navigation obstacles and face their longest line that props and structures leave clear.

## European Town (52 x 52 m)

- **Landmark:** Piazza del Pozzo, an irregular square (three plaza areas plus a
  north opening) around the roofed well, with a produce stall, benches, carts,
  bollards and street lanterns.
- **Elevation:** Borgo Alto, a 1.26 m piazzetta reached by the grand steps, Via Alta
  and the east lane (three stairs); the loggia, a 2.8 m covered deck along the south
  edge with stairs at both ends; B37's upper floor at 3.22 m.
- **Lanes and courts:** winding lanes with jogs, arches (`via_alta_arch`,
  `east_lane_arch`) and covered passages (market gate, west arch, garden gate, baker
  arch) joining the market court, west yard, garden, cistern court and baker court.
- **Interiors:** the market room (B20) and B37 (garden provisions shop and
  apartment): internal turning stair, upper floor, independent exterior exit stair.
- **Underground:** `cistern_passage`, an old cistern and wine cellar under the
  square's west wing between the market and the cistern court. Two dogleg entrances,
  three segments (about 18.5 m), brick walls, stone floor, timber joists, stone piers in
  the cistern hall, warm lamp pools.
- 59 buildings (43 before), 57 props, 16 practice targets, 16 spawns, 862 collision boxes.

## Industrial Complex (54 x 54 m)

- **North band:** the stores hall (walk-in shelving), the fenced utility yard
  (chain-link divider between the electrical compound and the pump and cable store),
  the machine hall, and service lanes; the loading gate passes through workshop I14.
- **Middle band:** the west yard, dispatch hall I21 (warehouse dispatch and elevated
  office: internal stair, 3.22 m upper floor, exterior exit stair to the west yard),
  the loading yard (container stack, forklift, pallets), the 1.1 m loading dock with
  its stair, the dock lane and the workshop yard.
- **Roofs:** service roofs at 4.5 m with HVAC units, fans, vents and boxes, reached by
  three ladders (dock lane, workshop yard, service lane).
- **South band:** the 2.8 m steel loading catwalk over the south lane (stairs at both
  ends), the storage yard, goods office, warehouse B (racks), and the container link,
  yard and south service street.
- 42 buildings, 44 props, 9 practice targets, 16 spawns, 295 collision boxes.

## Modern City (54 x 54 m)

- **Streets:** the avenue and Main Street meet at a T; no road crosses the district.
- **Landmark:** the civic plaza at the junction with the metro stair, planters,
  benches, cafe tables and bollards; a smaller south plaza holds the second stair.
- **Underground:** `metro_underpass`, a pedestrian underpass beneath the avenue between
  the two plazas: two straight entrances, three segments (about 14.2 m), tiled walls,
  granite floor, piers and LED panels.
- **Elevated route:** the avenue skywalk, a 2.8 m deck along the east side between the
  north-east court and the east court, with stairs at both ends.
- **Multilevel building:** commerce hall C27 (commercial service building and upper
  office): north/south doors and west/east doorways, internal stair, 3.22 m upper
  floor, exterior exit stair to the east court.
- **West and south:** the west arcade from the avenue to the west square, the
  north-west court and links, the parking lot with two cars, the back alley and the
  canopied north-east alley.
- 38 buildings, 34 props, 12 practice targets, 16 spawns, 315 collision boxes.

## Measurements (2026-11-05)

| | Town | Industrial | City |
|---|---|---|---|
| Longest eye-level axis sightline, HEAD -> now | 47.5 -> 36.5 m | 49.5 -> 35.5 m | 49.5 -> 36.5 m |
| Median per-point longest sightline | 23.5 -> 18.5 m | 26.5 -> 14.5 m | 29.5 -> 22.5 m |
| Spawn pairs with 3+ distinct walking routes (of 120) | 89 | 105 | 92 |
| Draw calls median/max, high preset | 109/182 | 94/145 | 110/162 |

Rays start at stand-eye height from every metre of walkable ground; props and
structures block them. A route counts as distinct only if it avoids a 2.5 m corridor
around the routes already found, outside 4 m of either spawn. HEAD's ring roads
scored higher on routes because their wide parallel lanes count as several. Frame
and load figures are in PROGRESS.md.

## Validation tools

| Tool | Purpose |
|---|---|
| `tests/mapAudit.ts`, `tests/mapIntegrity.test.ts` | Whole-map audit (see-through walls, escapes, floating props/lights, reachability, intersections, thin walls, normals, dead ends); stairwells visibly open. `MAP_AUDIT=1` writes `test-results/map-audit/<map>.json` |
| `tests/mapOverhaul.test.ts` | Underground walked both ways with no gun, rifle and sniper; headroom, walls, floor and slab; guarded stairwells; spawns on the street; every spawn walks to every other; solid props off stair flights; no axis sightline >= 40 m |
| `tools/map-review.mjs` | Layout-derived and authored views (`tools/map-review-views.json`), with draw calls, frame time and load time. `--quality`, `--settings '{"chromebookMode":true}'`, `--views`, `--only` |
| `tools/map-audit-shots.mjs` | Screenshots of audit findings |
| `tools/dev-map-load.mjs` | Map load timing |

## Known limits

- Gable roofs above the eaves, downpipes, forklift tyres and the dock end rail are
  visual-only (yaw-only box collision); the audit reports them as warnings.
- Prop models were reused from the existing catalogue; only the cart wheel was
  fixed. No new prop models were authored.
- `tools/maps-test.mjs` reports bounded texture retention after map switches (see
  PROGRESS.md); `MaterialLibrary` was not changed.
