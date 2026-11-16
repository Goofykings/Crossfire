# Neon Backstreets (2026-11-14)

Fifth map, id `neon-backstreets`: a compact, rain-soaked city block at night, built for 1v1 and 2–4 player free-for-all
(small Teams and Zone Control matches work too). It is the smallest map (40 × 40 m play area; Modern City and
Industrial are 54 × 54, Farmstead 74 × 92). All art, signs and textures are original and generated in this repository.

![plan](neon-backstreets-plan.png)

*Plan (`python -B -I tools/layout_neon.py --plan docs/neon-backstreets-plan.png`): white = solids below head height,
blue outlines = upper-level solids, orange = stairs, cyan = glass, green = spawns, red = practice targets.*

## Layout

```
z -20  ===== north facades: Arcade, Hotel Neon, Pharmacy, Corner Bar ======================
       N sidewalk      NEON STREET (one-way road, van and car parked)        fence | vista
z -12.5 ------+---------------+---------+------------------------+--------------------
       WEST   |  24/7 MART    | NOODLE  | RAMEN SHOP (2 floors)  | EAST LANE
       LANE   |  (3 doors)    | ALLEY   | upper lounge, balcony  | (street, two sidewalks,
z -3.5        +---------------+---------+---balcony------stair---+  Karaoke, Bar 88)
       ...... west arm ....  CROSSING (kiosk, ad column) ..... east arm ........
z  4.5        +---------------+ MARKET  +------------------------+
              |  LAUNDROMAT   | COURT   | HOSTEL BLOCK: underpass,|
              |  (2 doors)    | (stalls)| roof terrace, stairwell |
z 15   -------+---------------+--stair--+------------------------+--------------------
       BACK ALLEY (dumpsters, skip, service doors, string lights)
z 20   ===== south back facades (gated gap behind the court) ===============================
```

* **Loops.** The outer ring (Neon Street → West Lane → Back Alley → East Lane) and the inner cross (Noodle Alley →
  Crossing → Market Court / Underpass → Back Alley) give at least two route loops everywhere. The walk-through shops add
  short-cuts: the Mart (street, Noodle Alley and West Lane doors), the Ramen shop (street and crossing doors plus a kitchen
  back door), the Laundromat (crossing and West Lane), and the hostel underpass. There are no dead ends: the
  integrity audit's dead-end check is clean, and every spawn reaches every other spawn.
* **Ranges.** Shops and alleys (3–8 m) suit shotguns and SMGs. The crossing and the side lanes (10–20 m) suit rifles.
  Neon Street, the lanes and the back alley are 26–39 m lanes for snipers and semi-autos. No straight eye-level line
  crosses the whole block (the shared sightline test requires < 40 m).
* **Verticality (small).** Two decks at 3.55 m face each other across the crossing:
  * the **ramen balcony**, reached by the exterior stair in the crossing's east arm or through the upper staff lounge
    (whose interior stair comes up from the kitchen; the lounge's open windows overlook Neon Street);
  * the **hostel roof terrace**, reached by the steel stair in the market court or the stairwell from the underpass.
  Both have a drop-down gap in their railing, so neither is a one-entrance camping spot.
* **Cover.** A kiosk and a lit advertising column in the crossing, a jersey barrier, the balcony stair (a solid concrete
  flight), parked cars, a van, dumpsters, a skip, market stalls, vending machines, store aisles (1.45 m: standing players
  see over them, crouching ones hide), the washer island and the ramen counter (0.95 m, jumpable).
* **Spawns.** 13 spawns, picked with a line-of-sight search: no two see each other within 13 m, and all are 6 m apart, clear
  of the Zone Control squares, in every quadrant, each facing an open line. Two are inside shops (Ramen dining room,
  Laundromat). The shared spawn selector still prefers screened, distant spawns at runtime.
* **Zone Control** squares: A on Neon Street (-6.5, -16.4), B in the crossing (2.6, -0.6), C in the back alley (-10, 17.6).

## How it is built

| Part | Source | Output |
|---|---|---|
| Buildings (walls with openings, slabs, stairs, rails, posts, glass, sidewalks, fences) | `tools/neon_structures.py`, using the Farmstead element helpers | layout `farm.structures`; mesh and collision from `blender/scripts/lib/farmstead.py` (one spec, so the visuals and collision cannot disagree) |
| Zones, props, spawns, targets, lights, validation | `tools/layout_neon.py` | `src/maps/neon-backstreets/layout.json` |
| Neon dressing (signs, blades, tubes, lanterns, cables, graffiti, puddles, bake lights, room fill, rain areas, vistas) | `tools/neon_dressing.py` | layout `neon` |
| Dressing meshes, glow cards, windows, skyline, light bake | `blender/scripts/lib/neon.py` | merged into `terrain.glb` |
| Ground, paint, puddles, drains, assembly | `blender/scripts/lib/terrain_neon.py` (stage `neon` in `generate_all.py`) | `public/assets/models/neon-backstreets/` |
| New props (store shelf, drink fridge, washers, dryers, scooter, bicycle, ramen cart) | `blender/scripts/lib/props_neon.py`, `catalog.py` | `models/shared/props/` |
| Sign/panel/window/graffiti atlases, glow cards, skyline texture, night sky | `tools/make_neon_textures.py` (Pillow), cells in `blender/scripts/lib/neon_art.py` | `textures/neon-backstreets/`, `env/sky_neon_1k.hdr`, `sky_neon_2k.jpg` |
| Rain | `src/rendering/Rain.ts`, created by `MapManager` when the layout has `neon.rain` | runtime only |

Rebuild:

```
python -B -I tools/make_neon_textures.py         # only after changing the art
python -B -I tools/layout_neon.py --write
blender -b --factory-startup --python-expr "import sys; sys.dont_write_bytecode = True" -P blender/scripts/generate_all.py -- --only neon
#   (add materials,props when materials.py, catalog.py or props_neon.py change; then node tools/generate-bullet-surfaces.mjs)
git checkout -- blender/scripts/lib/__pycache__   # if Blender touched tracked bytecode
npm test --prefix server                          # rebuilds the Worker bundle with the new world
```

`farm.structures` is the shared container for element-authored buildings: `collision_gen`, the tactical map and
`movementSafety` already read it. The map has no `farm.perimeter`, so it keeps the four invisible boundary slabs
behind its facades and fences.

## Neon and lighting

Babylon gives each material four real lights, so almost all of the glow is built into the assets:

* **Self-lit (`unlit`) materials:** `neon_tube` (hue in vertex colours, tint 2.6 so tube cores tone-map toward white and
  feed bloom on Medium and up), `neon_signs` / `neon_panels` (sign and ad atlases), `neon_windows` (lit window cells) and
  `neon_skyline` (distant towers).
* **Additive glow cards (`additive`: no depth write, no fog, never occluders):** a halo in front of every sign, a wash
  of coloured light on the wall around it, a pool at its foot and a rippled wet-ground reflection streak (`neon_wet`) on
  the pavement in front; ribbons along every tube; crossed halos on lanterns, bulbs and aviation lights; floor, lower-wall
  and ceiling fill inside each lit room. `MaterialLibrary` supports both flags; `VisibilityWorld` and the map audit ignore
  blended materials.
* **Baked light pools:** `neon.bake()` subdivides lit surfaces near each of 33 sources into about 1 m cells and tints their
  vertex colours (ambient 0.7, contact darkening at wall feet, under ceilings, balconies and the underpass). Room lights
  reach only their own room.
* **Real lights:** the sun is a dim blue moon (0.75), the night HDR fills in colour, and two point lights (crossing pink, Neon
  Street cyan) plus the ramen pendant light the characters. That stays inside Babylon's four-light budget together with
  the sun.
* **Wet streets:** glossy asphalt and concrete (roughness 0.42 and 0.5) pick up the coloured sky domes; dark mirror-like
  puddle decals; neon reflection streaks; light rain.
* **Night sky:** procedural (no sun disc): navy zenith, violet city haze, clouds lit from below, four coloured glow domes, a
  few stars.

## Chromebook mode

Chromebook mode keeps every sign, tube, glow card, baked pool and window, so the map stays recognisably itself without
bloom, reflections or normal maps. `EnvironmentConfig.lowSpecAmbient` (new, optional) replaces the daytime hemisphere
fill with a dim violet night ambient (0.3) for this map, and rain drops to about a quarter of the particles. Geometry,
collision, props and visibility are identical in both modes.

## Performance (dev Intel Iris Xe, 1600 x 900, uncapped, `node tools/neon-perf.mjs`, after the overhaul, one run)

| preset | Neon Backstreets | Modern City | ratio |
|---|---|---|---|
| low | 56.0 fps (143 draws) | 64.1 (113) | 0.87 |
| medium | 46.9 (147) | 49.5 (117) | 0.95 |
| high | 41.9 (152) | 44.9 (122) | 0.93 |
| Chromebook | 141.7 (140) | 137.8 (112) | 1.03 |

After the prop clean-up the draw calls are 139 / 143 / 148 / 136. Two re-runs after the clean-up were made while other programs used the
GPU (Modern City read 32-47 fps on Low instead of 64) and are not comparable; in them Chromebook mode read 0.71-0.75 of Modern City, so that
ratio needs a clean re-measure. The iGPU was warm in the table's run (both maps read lower than on 2026-11-14: 65.0 / 57.4 / 47.7 / 200 against 76.9 / 64.4 / 54.1 /
163, ratios 0.85 / 0.89 / 0.88 / 1.23): only the same-run ratios mean anything. The overhaul added seven draw calls (five new
materials) and 0.5 MB of terrain (5.7 MB); the new ground is ordinary opaque geometry, the marks are alpha-tested, the drips
are 160 particles. Chromebook mode drops normal and ORM maps as on every map, keeps every sign, the plaza, the tiles and the
marks, and has no drips or splashes.

## Overhaul (2026-11-15): paving, plaza, zone light, wall hardware

Third pass. References: five new screenshots in `references_images/` (a Tokyo-style arena map: tiled paving with dark joints,
a worn painted arrow up an underpass, stencilled wall numbers, a bin-and-bag corner on hatched bays, a circular plaza with a
warning ring, shoji-lit doors, a bike and a barrel against a roller shutter) plus web research on yokocho alleys (shop
lanterns, noren, hand-painted signs, low eaves, shuttered stalls), environment-art breakdowns of neon alleys (leak and crack
decals, puddles, cables, AC units, colour zones) and small-map level design (landmarks that are useful, loops). Nothing is
copied: all art is painted in this repository.

**Audit of the second version** (fresh screenshots against the references): the ground was a featureless dark surface with
light streaks (no joints, no markings, no plaza); every zone shared the same violet-pink light, so places were hard to tell
apart; walls had little at eye level; stairs and the court read as black silhouettes; the standard presets were darker than
Chromebook mode.

| Area | Change |
|---|---|
| Ground | Three painted texture sets with albedo, normal and ORM (`tools/neon_ground_art.py`): `neon_pave` (0.5 m concrete flags, the lanes, back alley and crossing arms), `neon_tile` (0.3 m warm tiles in running bond, Lantern Alley and the Market Court), `neon_walltile` (glazed 12.5 cm tiles). Each has low-roughness "standing water" hollows and wet joints, so the moon and the two point lights glint on it. Roads keep the scanned asphalt. |
| Plaza | The crossing's centre is now a **circular plaza**: one 9 x 9 m image (`neon_plaza`, `neon_art.PLAZA`) with concentric radial paving, a pale kerb line, a worn yellow-and-black hazard ring, dark setts and a cast medallion; its outside is the same flag grid, so the seam with the tiling paving falls on a joint. Zone B sits inside the ring. A festoon of bulbs crosses above it from the ramen wall to the hostel block. |
| Markings | A new alpha-tested atlas (`neon_marks`, 2048 x 2048): long road arrows, 止まれ / 徐行 kanji, a hatched keep-clear box, bay numbers 01-04, tyre marks, runoff stains at every downpipe, three litter clusters, a decorated cast cover (a lucky cat over waves, three of them), wall stencils (07, 12, 駐車禁止 NO PARKING, 搬入口 LOADING B1, 出口 EXIT), hazard / hydrant / block-number plates and strips of flyers. 60 placements in `neon_dressing.marks()`. |
| Zone light | One colour family per zone, by re-assigning blades and boards and adding soft fills to the bake: **Vending Lane / Laundry Lane** teal and blue (bathhouse, electronics and ramen blades, the mart's own cyan board over its side door), **Lantern Alley** warm (yakitori and oden blades, a third lantern row, shoji screens), **Loading Alley** dim sodium amber with green exits (gyoza blade, bulkhead lamps), **Karaoke Lane** magenta (izakaya and motel moved here), **Plaza** neutral white under the festoon, **Tiled Underpass** cyan and blue. Five new vertical sign cells (the sign atlas is 2048 x 4096). |
| Walls | Shoji screens (warm paper behind a timber lattice, two panel cells) on the ramen shop's alley wall and under the balcony; glazed tiles on both underpass walls; 26 pieces of wall hardware (`neon_dressing.fixtures()`: electricity meters with conduits, junction boxes with conduit runs, louvred vents, fire-hose cabinets, sheet-metal ducts); five more bulkhead lamps. |
| Stairs | A light strip runs up the flank of every stair (both flanks of the balcony stair, the court stair, a wall strip in each stairwell), so every vertical route can be read from across the map; flower pots at the two exterior stair feet. |
| Rain | Heavy drops fall from eight dripping edges (the balcony lip over the plaza, the kiosk roof, the court landing, the four awnings): a third small particle system in `Rain.ts` (`rain.drips`), off in Chromebook mode and with reduced motion. |
| Props | **Clean-up** (close-up review of all 56 prop types): the phone booth, the capsule-machine bank, the bamboo pots and the white vending machine are deleted from the catalogue (their lit panels blew out to white blocks or the model was crude); the wrapped pallet (a blank white block), the flat yellow skip, the pale grey bin and both newspaper boxes are gone from this map; three cones and two scooters fewer. In their place: a crate stack in the loading bay, a dumpster where the skip stood, flower pots by the ramen door. The vending machines keep their lit product window but the header is a brand band in the machine's accent colour with a slim light bar (`lamp_vend` emissive halved). New: a barrel by the shoji screen, a tyre stack in the Loading Alley, pots at the two exterior stair feet. 124 props (was 133). |
| Readability | `environmentIntensity` 1.15 -> 1.55, exposure 1.2, contrast 1.16: the court, the back alley and the plaza are readable in the standard presets; the neon and the dark sky keep the mood. |
| Callouts | `tactical.landmarks`: Neon Street, Karaoke Lane, Vending Lane, Laundry Lane, Lantern Alley, Loading Alley, Plaza, Balcony Arcade, Market Court, Tiled Underpass, 24/7 Mart, Ramen, Laundromat. |

The layout (routes, stairs, doorways, cover boxes that existed, spawns, zone squares) is unchanged: the second pass's audit and
tests already cover it, and this pass re-ran them. Collider changes: a barrel and a tyre stack against walls, a crate stack
for the wrapped pallet, a dumpster for the skip, and the phone booth, capsule bank, pale bin and two newspaper boxes removed.

Rules this pass added:
* Ground marks share the road paint's height (5 mm): never lay one over a painted line or another mark. Cast covers lie at 17 mm.
* Wall marks are 16 mm proud (tags 8 mm, grime 12 mm). Wall hardware is visual only and at most 19 cm proud; duct flanges start
  11 mm from the wall and the duct 20 mm (two boxes that share a back plane z-fight).
* A blade sign must not cross a window's AC unit, and a vent's edge must not lie on a light shaft's plane (the geometry test
  found both).
* `shared texture set` materials may now live in the map's texture folder via `tex_dir` (`neon_pave`, `neon_tile`, `neon_plaza`,
  `neon_walltile`); the plaza passes explicit UVs in metres from its north-west corner and `tile` = its size.
* The baked pools only modulate albedo: brightness in the standard presets comes from `environmentIntensity`. Raise that, not
  the bake, when a zone is unreadable.

## Polish and upgrade pass (2026-11-14)

Reference images added for this pass: `references_images/neon with vending machines.jpg`, `more neon.jpg` and three saved
image-search pages (rainy ramen alleys, vending machine rows, fire escapes over wet streets). The audit against them, and what
changed:

| Weak point found | Change |
|---|---|
| Flat, dim facades: only a handful of signs, few colours, little vertical rhythm | 10 more vertical yokocho-style blades (izakaya, ramen, sake, bar, motel, udon, club, mahjong, cafe, pachinko) in pink / cyan / yellow / green / orange / red / purple, three more boards (izakaya, udon, motel), a big double-sided arch sign "NEON BACKSTREETS / ネオン裏通り" hung over the crossing (the focal point of the long west and east views), 9 more tubes (door outlines, wall strips inside the mart, laundromat and underpass), stronger halos (+30 %) and washes (+25 %) |
| Wet ground read only as dull streaks | every sign pool now has a second, longer reflection streak; puddles carry two glints in the colours of the nearest signs; stronger pools; cracked asphalt cards; short splash sprays where rain lands (55 % of them on puddles) |
| No atmosphere between the viewer and the signs | tinted fog (`fogColor` [0.10, 0.085, 0.20], density 0.0115) that fades alleys into a glowing haze, soft light shafts under every tall blade sign and sodium cones under the two streetlights, steam from seven vents (ramen hatch, manholes, dryer, kitchen exhaust) |
| Few believable lit props | `vend_red/blue/yellow/white` (dense, colourful, self-lit cans on a dim lit panel; each throws a pool and a halo), `phone_booth`, `gacha_bank`, `sandwich_board` (chalk specials), `bamboo_pot`; lit-prop glows derive from the props (`layout_neon.derived_light`), so moving a prop moves its light |
| Plain storefronts and walls | four canvas awnings (solid, 3.05 m up, never over a deck, stair or spawn), red noren curtains with brushed glyphs on the ramen doors (double-sided), four visual-only fire escapes, rain streaks / rust / stickers (alpha-cut decals 12 mm off the wall), more overhead cables, lantern strings inside the ramen shop and over the east lane, rooftop clutter (tanks, vents, AC boxes, antennas with aviation lights) |
| Bland interiors | strip lights along the mart, laundromat and underpass walls, lantern strings in the dining room |
| Gameplay: the east lane was a 35 m run with one parked car; the crossing and the back alley had long open stretches | two dumpsters and a barrier in the east lane, a phone booth and a planter in the crossing, a wrapped pallet load and pallets in the back alley, a vending bank by the west lane. Spawns, zone squares, stair feet and doorways are unchanged (all tests that guard them pass) |

Cost control: the can colours are one `can_lit` material with the hue in vertex colours (6 materials -> 1); steam is three
tint groups (three systems, picking a random vent per puff; Chromebook keeps two at half rate and no splashes); the arch,
beams, awnings and fire escapes are a few dozen quads and tubes. The terrain GLB grew from 4.2 to 5.2 MB; draw calls from 124
to 136 on Low. The sign atlas is now 2048 x 3328 (the new cells sit below the old ones; old cells keep their pixels).

Rules this pass added (the geometry z-fight test enforces them):
* Ground cards use fixed heights above the floor so no two share a plane within 2 mm: oil .002, paint .005, crack .0075, puddle
  .009, puddle glint .0205, reflection streak 2 .0235, spill .026, streak 1 .03, room fill .035/.04, streetlight pool .041, arch pool .045.
* Visual-only fire escapes stand 8 cm off the facade (frames, sills and ACs are proud by up to 7 cm); anything with a back face
  against a wall plane z-fights.
* A single-sided card seen from behind is a `seeThrough` audit error: the noren has a mirrored back quad 1 cm behind the
  front; the phone booth's back panel faces the door; the sandwich board has end caps.
* A prop collider must cover everything visible of it (`walkThrough` audit): the bamboo's collider is the full 2 m column.

## Tests and review tools

* `tests/neonBackstreets.test.ts`: every doorway walked both ways with no gun, a rifle and a sniper; every staircase up and down;
  both deck loops (up one route, down the other); drop-down gaps and railings; glass stops walkers and bullets while the
  ramen hatch stays open; spawn screening; rifle lanes; Practice navigation reaches every spawn and both decks.
* Shared suites run on it as on every map: `map`, `mapOverhaul` (spawn connectivity, sightlines < 40 m), `mapIntegrity`
  (no see-through walls, escapes, floating props or lights), `collisionSafety`, `geometry` (no z-fighting), `assets`,
  `tactical`, `posters`, `stageAProps`, `zoneControl`, `practice` (real armed bots traverse it: decks reached, nobody stuck).
  The street-block-only suites (`compactMaps`, `mapRealism`, `phase2Maps`, `stairSliding`) skip it, as they skip the Farmstead.
* Backend: map rotation over all five maps; authoritative prop bullet surfaces on this map.
* Browser: `node tools/neon-shots.mjs <url> [group] [--chromebook] [--quality=...]` (contact sheets in `test-results/neon*`),
  `node tools/neon-practice-test.mjs <url>` (real UI, 5 bots, 40 s), `node tools/neon-perf.mjs <url> [maps]`,
  `node tools/neon-thumb.mjs <url>` (menu thumbnail). `tools/perf-test.mjs` now knows this map's views, but that tool's
  `?autoplay` path waits for a network join and times out on every map.

## Known limitations

* The first version had no reference images (written brief only); the 2026-11-14 pass used the added references. Nothing is copied from them: all art, signs and textures are original.
* The wet-ground reflections are static streaks plus glossy hollows in the paving's roughness map, not a planar mirror (it would not fit the budget). The rain ignores
  small overhangs (it is kept out of roofed footprints and lands on decks); splashes are short sprays, not ring ripples.
* The fire escapes, rooftop clutter and the arch sign have no collision: they are out of reach and bullets pass them.
* Wall hardware (meters, junction boxes, vents, hose cabinets, ducts) has no collision either: it is at most 19 cm proud, a
  player's shoulder can pass through it and a bullet's mark lands on the wall behind it.
* The layout was not restructured in the overhaul; ideas not done: a third, lower connection between the balcony and the
  terrace, capture-the-flag bases (the game has no such mode), view-dependent puddle reflections.
* Standard presets run about 10–20 % below Modern City on the dev iGPU. Physical Chromebook hardware was not measured.
* Two parked props (the car, the van) and the skip can be jumped onto (audit `climb` warnings, as on other maps). The
  market-stall canopies are reachable from the stall counters.
* A matching frontend and Worker release is needed when authorised: `MAP_IDS` gains a fifth id, so the public schedule's
  shuffle bags change and an old client would reject a `neon-backstreets` snapshot. The protocol version is unchanged
  (as when the Farmstead was added). `server-dedicated/dist` is a stale incomplete scaffold and was not rebuilt.
