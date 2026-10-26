# Update in progress: tactical map + Industrial Complex + Modern City

> Historical notes: the stage table below predates the current code. See `../PROGRESS.md` for the inspected status and the current multiplayer update stages.

Working notes for the "two new maps + Tab tactical map" update, kept so another session can resume safely.
Delete this file when the update is complete (its content moves into README / ARCHITECTURE / ASSET_PIPELINE / TESTING).

## Status

| Stage | State |
|---|---|
| 1. Inspect project | done |
| 2. Tab tactical map (all maps) | done, tested (unit + browser) |
| 3. Industrial Complex | asset vocabulary done (textures, materials, props, building + terrain generators); **layout blocked on the reference image** |
| 4. Modern City | textures, materials, props done; building + terrain generators next; **layout blocked on the reference image** |
| 5. Map selection / switching | not started |
| 6. Tests, perf, Pages build | not started |

**Reference images**: the brief names `references/industrial-complex/layout.png` and `references/modern-city/layout.png`.
They never arrived; after the generators were done the user chose **"design from the brief"**: both street networks
are designed in `tools/layout_industrial.py` / `tools/layout_city.py` (AREAS lists) to match the written brief, with
European Town's metrics as the bar. If reference images turn up later, only the AREAS lists need re-authoring.

## Done so far

- **Tactical map**: `src/maps/tactical.ts` (derivation from layout.json + projection, Babylon/DOM free),
  `src/ui/TacticalMap.ts` (canvas overlay), `src/game/Teammates.ts` (registry; empty without a data source),
  Input `Tab` -> `map` action, Game wiring + debug API (`tactical()`, `remotePlayer()`, `clearRemotePlayers()`).
  Tests: `tests/tactical.test.ts` (projection, marker vs real movement, map vs collision.json, teammates);
  `tools/browser-test.mjs` (real Tab key, focus, marker position/rotation, walking with map open, teammate filter).
- **Textures**: `tools/fetch_textures.py` now fetches 21 more Poly Haven sets and two skies (`sky_industrial_*`,
  `sky_city_*`) and keeps existing outputs (European Town files are byte-identical).
  `tools/make_procedural_textures.py` adds `textures/urban/` (paint wear, hazard stripes, chain-link, blinds, oil
  stains, street signs), `industrial-complex/signs_industrial.jpg`, `modern-city/shop_signs_city.jpg`, `posters.jpg`.
- **Materials** (`blender/scripts/lib/materials.py`): ~115 new entries; tint families collapse into one runtime
  material each. `"albedo": None` = keep a set's normal/ORM, paint with the tint (painted steel).
- **Props**: `props_industrial.py` (30) and `props_city.py` (28), registered in `props.PROP_BUILDERS` and
  `catalog.PROPS`. Exported (`--only props`); the 22 European Town prop GLBs are byte-identical.
- **Spec/collision**: `building_spec.eave_height` honours `height`; `interior_openings` (explicit cavity + door
  rects); `passage_profile` style `portal`; `collision_gen` handles `interiors` and terrace `railings`.
  European Town `collision.json` regenerates identically.
- **Industrial generators**: `kit_industrial.py`, `building_industrial.py` (warehouse, workshop, office, shed,
  chimney, tank; gable/shed/flat roofs; interiors; passages), `terrain_industrial.py` (docks, stairs + handrails,
  railings, fences, concrete walls, canopies, pipe bridges, road paint, stains, manholes).

## Next steps

1. `building_modern.py`, `kit_modern.py`, `terrain_modern.py` (sidewalks/curbs, crosswalks, fire escapes...).
2. `generate_all.py`: generic per-map stage (`--only town|industrial|city`) dispatching on `layout["style"]`.
3. Layout tools per map from the reference images (`tools/layout_industrial.py`, `tools/layout_city.py`), sharing
   a parameterised copy of the European Town algorithms; zones must tile all walkable ground (unassigned play-area
   ground counts as building mass for the facade generator).
4. Map definitions + registry, menu thumbnails, map switching/unload, material/texture disposal.
5. Generalise `tests/map.test.ts` / `geometry.test.ts` / `assets.test.ts` to all maps; browser/perf tests per map.

## Conventions learned the hard way

- The Bash tool mangles heredocs containing an odd number of apostrophes: write patch scripts to files instead.
- Never use `hash()` for generator variation (randomised per process); use a stable FNV hash.
- Explicit UVs are metres like world UVs: the runtime divides them by the material's `tile`.
