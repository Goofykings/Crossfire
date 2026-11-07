# Underground expansion and decorative posters (2026-11-07)

Covers the rebuilt Civic Central metro station (Modern City), the cistern and wine cellar
(European Town) and the playful poster set on all three maps. Authoritative gameplay,
protocol (WebSocket v21, HTTP schemas) and Cloudflare configuration are unchanged; layouts,
collision and map revisions changed, so the frontend assets and the Worker need a matching
release when one is authorized. Nothing was committed, pushed or deployed.

## What changed

| | Before | After |
|---|---|---|
| Metro floor / clear height | -2.6 m / 2.3 m | **-3.8 m / 3.5 m** (22 risers of 0.173 m on 0.28 m treads) |
| Metro floor area | 62 m2 (7.4 x 6 concourse + two 3.4 m arms) | **375 m2**: 34 x 8 m hall, two stair lobbies, four side rooms |
| Cellar floor / clear height | -2.6 m / 2.3 m | **-3.5 m / 3.2 m** (2 x 10 risers of 0.175 m on 0.24 m treads) |
| Cellar floor area | 62 m2 | **181 m2**: 11.6 x 8 m cistern hall, wine vault, two stores |
| Piers | 2 metro (0.6 m), 2 cellar | **14 metro (0.8 m square), 6 cellar (0.72 m)**, floor to ceiling, tiled base and capital |
| Furnishing | lamps only | gate line, ticket machine bank, ticket counter, cistern tank, 29 + 22 floor props, 66 + 22 wall items |

Both spaces keep the original surface entrances (the two metro stairs, the two cellar
portals) at the same footprints; the stairs are longer/deeper but still leave the street
waypoint 1.6 m clear of the nearest building so a long gun can climb out (the civic stair
may not start north of z = -12.2, which fixes the hall's north edge; the cellar portals
reuse the old 5.4 m lengths).

### Civic Central (blender/scripts/lib/underground.py, tools/underground_layouts.py)

* Hall `[-12, -3.2, 22, 4.8]` under the avenue; civic lobby `[2.6, -4.24, 6, -3.2]`, south
  lobby `[2.6, 4.8, 6, 6.44]`. The original piers at (2.2, 0) and (6.4, 0) are kept, now
  0.8 m square, flanking a 0.8 x 2.0 m ticket machine bank (1.3 m aisles each side).
* A gate line at x = 9.0 splits the unpaid ticket hall from the platform zone: four gate
  blocks (1.1 m high, real collision) leave three lanes of 1.5-1.7 m.
* Two pillar-row platform zones (3 x 2 piers each) west and east: three 2.1 m aisles.
* Four rooms behind 1 m deep door connectors: waiting room (benches), ticket office
  (counter, planter), vending alcove (three machines), utility room (cabinets, bags).
* Props: benches (under posters and the route maps), bins, seven vending machines, wet-floor
  signs, planter, electrical cabinets. Wall art: station name banners, platform, exit,
  ticket, restroom, staff-only and caution signs, two route maps, utility doors with push
  bars, column adverts. Ceiling: LED fixtures on a ~4 m grid under beams every ~4.2 m.
* Material/lighting: tiled walls with a blue accent stripe, granite pier bases, concrete
  cornice; lamp pools are baked into vertex colours (the light budget is full).

### Cistern and wine cellar

* Brick walls, flagged floor, timber joists, wall lanterns, stone piers; a raised stone
  cistern tank (real collision, stone rim around a water surface) at the heart of the hall.
* Wine vault (6 x 4.8 m): four wine racks (576 faces each), two casks, barrels; north store
  (crates, barrels), south-west store (a tasting table and stools).
* Old enamel signs (WEINKELLER, AUSGANG, ZISTERNE, KEIN FEUER, FASSLAGER, ANNO 1742,
  VORSICHT, MARKT), wooden doors and eleven vintage posters. It deliberately shares nothing
  with the metro's tiles, LEDs or signage.

### Generator contract

`underground.prepare(p)` copies the style's depth onto the passage and every entrance:
`STYLES[style]` owns `floor_y`, `risers`, `run` and pier size. Passage data (`segments`,
`piers`, `blocks`, `decor`, `walks`, `entrances`, `route`) is authored in
`tools/underground_layouts.py`; rooms stay a short distance from the hall and join it
through a door connector rect because a wall is built on every exposed edge of the union
of rects (touching rects would fuse). Collision comes from `passage_parts` (tags
`underground:<id>:{floor,wall,pier,block,partition,entrance-*}`) exactly as the visible
mesh does. `tools/check_underground.py` (also run by `tests/posters.test.ts`) validates every
decor item against the real wall/pier/block faces, overlap, props inside the floor and
clear of solids, and 0.42 m wide corridors along every authored walk.

## Posters

Twelve original, invented designs in one 4 x 3 atlas (`urban/posters_fun.jpg`, 384 x 576 per
sheet, drawn by `tools/make_underground_art.py`): Petunia's Flower Shop, a missing cat
(Sir Purrcival), The Velvet Pickles concert, Luigina's Trattoria, a "Hydrate or Diedrate"
PSA, a Plumberia travel poster, Dr. Sprocket's Tonic, a lost left sock, a pie marathon, a
robot repair shop, a pigeon PSA and a bubble tea opening. One shared material
(`posters_fun`, atlas, no per-sheet textures) so batching adds one draw call per cell.

* **Facades** (`BuildingGenerator.poster_pass`): about three in five buildings get up to three
  pasted sheets (two framed boards on the modern/industrial generators), chosen from the
  building id and never from the generator's shared random stream. A spot must clear every
  opening and trim recorded for the run (margins for shutters and surrounds), sit 0.8 m from
  run ends, stand on level ground, avoid material seams (`base_h`) and trim bands, and hang
  12 mm proud. Framed boards may also use the band between ground-floor openings and the
  first floor (top at most 4.3 m).
* **Interiors** (`interior_posters`): up to two sheets on the longest door-free stretches of
  walk-in rooms and halls (town rooms, industrial and storefront interiors).
* **Underground**: walls, piers and the counter fascia, validated as above.
* The exporter writes the placement registry to `docs/map-posters/<map>.json` (building,
  design, size, position, wall normal); `tests/posters.test.ts` checks solid wall behind,
  air in front, reading height, variety and repetition.

## Navigation and collision

* Layout JSON now carries `walks` (floor polylines into every aisle, gate lane and room) and
  `blocks`; `tests/mapOverhaul.test.ts` walks them with the real controller for no gun, rifle
  and sniper, forward and reverse, checks pillar dimensions/spans, passage area/height, and
  builds `PracticeNavigation` to prove bots reach every walk end through the stairs.
* The street slab stays solid above each passage (`ground_holes`); the lowest legal floor for
  the server's safety net reads the per-passage `floor` field.
* `tactical.ts` ignores props standing on an underground floor.
* No invisible walls were added: every solid is a visible pier, block, wall, rail or prop.

## Verification

`tests/mapOverhaul.test.ts`, `tests/mapIntegrity.test.ts`, `tests/collisionSafety.test.ts`,
`tests/map.test.ts`, `tests/posters.test.ts`, `tests/tactical.test.ts`; `python -B -I
tools/check_underground.py`; `node tools/underground-shots.mjs` and `node tools/poster-shots.mjs`
(real Chrome screenshots to `test-results/underground/` and `test-results/posters/`).
Rebuild: `python -B -I tools/layout_city.py --write`, `tools/layout_design.py --write`,
`node tools/run-blender.mjs --only materials,props,town,industrial,city`, then restore the
tracked `__pycache__` files Blender rewrites.
