# Phase 2: map layout improvements

Completed 2026-10-31, using the existing layout/Blender/collision pipeline.
The compact layouts already existed when this phase began. They were audited
and extended, rather than replaced or scaled down a second time.

## Footprints

| Map | Earlier large layout | At start of this phase | Final |
| --- | --- | --- | --- |
| European Town | 66 × 66 m | 52 × 52 m | 52 × 52 m |
| Industrial Complex | 68 × 68 m | 54 × 54 m | 54 × 54 m |
| Modern City | 68 × 68 m | 54 × 54 m | 54 × 54 m |

The earlier reduction removed 37.9% of Town's area and 36.9% of the other
maps' area. That earlier change used percentages per dimension; this phase's
brief specifies a 20–25% **area** starting target. No further blanket reduction
was made. New connections increase useful route density within the existing
compact footprints. Buildings, doors and stairs retain metre-scale dimensions.
Automated checks confirm distributed, screened spawn choices against 1–5
opponents; human 2–6-player sessions are still needed to judge final balance.

## Routes and dressing

Completed in Town / Industrial / City order, with a progress entry after each.

- **Town:** new market-shop through-room connects the north approach to the
  market court. Two 1.6 m doorways, 3 m interior clearance, and a 3 m-wide
  authored room. Preserved the central well/fountain plaza, garden hall, market
  courts, perimeter loops, and existing 2.8 m covered gallery with two stairs.
  Added a produce-table GLB; 46 checked props plus the landmark well remain.
- **Industrial:** new three-door goods office connects the west gallery lane,
  goods link and loading area. The alley meets the office at its threshold,
  without duplicate coplanar yard/interior floors. Preserved the warehouses,
  loading/container landmarks and existing two-ended 2.8 m metal catwalk.
  Added a valve-manifold GLB in the utility yard; 21 checked props remain.
  Existing chain-link dividers separate usable yard space, with clear gaps
  and player clearance on both sides, rather than sitting against solid walls.
- **City:** new diner-service interior connects the diner alley and north plaza
  approach. Opened the existing west shop passage into the shop: its fourth
  door was previously missing. Preserved the plaza, varied roads, curbs, lobbies
  and existing two-ended 2.8 m upper-floor passage. Added an A-frame cafe board;
  35 checked props remain. The bike rack moves to the south sidewalk to keep
  the courtyard shop entrance clear.

The upper routes are retained features from the prior compact update. Each has
two 16-step approaches (0.175 m rise, 0.32 m tread), a suspended floor and an
open ground-level underpass. Gallery/passages retain 2.5 m upper headroom and
2.58 m underpass clearance. The new ground routes provide further loops around
the exposed central approaches; no map is globally mirrored or scaled.

## Root causes fixed

- Town's room generator cut a doorway at every coincident lot edge, even when
  another solid building stood directly outside. The garden hall had such a
  blocked south doorway. Explicit `doorSides` now follow walkable approaches;
  the same data drives visible architecture, collision and tactical queries.
- The shared dressing pass reserved decorative facade doors but omitted real
  room/interior doorways. It now protects their approach/landing rectangles,
  preventing barrels and other dressing from obstructing the openings.
  Narrow Town halls no longer receive tables/stools in their walking lanes.
- Industrial/City doorway generation accepted only open streets as approaches.
  Covered approaches now qualify too. This repairs City's dead-end west shop
  passage; Industrial regeneration was checked against the same rule.

## Sources and generated outputs

Authored route rectangles remain in `tools/compact_layouts.py`. The existing
`layout_design.py`, `layout_industrial.py` and `layout_city.py` produce the layouts.
Blender's `building_spec.py` and `compact_dressing.py` share door and clearance
rules. The three new props extend `props_compact.py` / `catalog.py`, use existing
PBR materials, and export through the existing material-batched GLB pipeline.
Textures, sound, lighting, weapons, UI and networking behavior are unchanged.

Regenerated layouts, building blocks, terrain, collision/debug GLBs, prop
catalog/GLBs, editable `.blend` files and asset manifests are included. Worker
and frontend still consume the same layouts, collision and prop catalog through
`createMapWorld` / `mapVersion`. No protocol or match-rotation change was needed.
Publish frontend assets **and** rebuild/redeploy the Worker together when
deployment is authorized; the changed map revisions must match.

Top-down authoring diagnostics include actual prop footprints, real doorway
gaps, new flank routes, upper paths and spawns:

- [Town](european-town-compact-plan.png)
- [Industrial](industrial-complex-compact-plan.png)
- [City](modern-city-compact-plan.png)

## Verification

Final results: **250 frontend tests and 49 Worker tests passed**, as did frontend
and Worker typechecks, the production frontend build, Worker dry-run build and
181-entry asset verification. Procedural regeneration was compared with all
three checked-in layouts/collision files and the prop catalog. Local Chrome
passed the development and production `/crossfire/` map checks; screenshots of
the new props, passages and upper approaches were inspected. City was repeated
after the final bike-rack relocation. No public server was used for these checks.
One timing-sensitive Worker run failed during concurrent heavy browser checks;
the final complete Worker run without that browser load passed.

`tests/phase2Maps.test.ts` runs the actual shared controller through every real
interior door and both ends of every covered street arcade. It walks, slides
and jumps through each new flank in both directions and exercises jumping and
sliding on both upper stair approaches. Existing map tests now check both
standing and crouched connectivity; route-graph checks include courts, yards,
plazas and covered paths, check overall connectivity, and require alternate
returns. An arcade inside one road is treated as a covered section of that
road, with its actual openings independently traversed.

Checks also cover screened/accessible spawns, physical headroom, ground
support, fence clearance, frontend/Worker map revisions, tactical/collision
parity, GLB coplanar overlaps and material/asset references. The Worker
integration test now allows up to five consecutive rounds to cover one full
three-map shuffle bag from any starting offset; server rotation is unchanged.

Commands, from the repository root:

```powershell
python -IB tools/layout_design.py --write
python -IB tools/layout_industrial.py --write
python -IB tools/layout_city.py --write
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' -b --factory-startup --python-exit-code 1 -P blender/scripts/generate_all.py -- --only props,town,industrial,city
python -IB tools/compact_diagnostics.py
npm.cmd test
npm.cmd run typecheck
npm.cmd run assets:verify
npm.cmd run build
$env:XDG_CONFIG_HOME = $env:TEMP
npm.cmd --prefix server run typecheck
npm.cmd --prefix server test
node tools/serve-dist.mjs --port 4198 --base /crossfire/
```

In another PowerShell terminal:

```powershell
node tools/compact-maps-test.mjs --url http://127.0.0.1:4198/crossfire/
```

The browser test loads all three production maps under a Pages-style base path,
traverses both stairs and all new flank routes with walking/sliding/jumping,
checks materials/settings/errors, and captures ground, upper-route, new-prop
and overhead screenshots in `test-results/compact-browser/`. `--map <id>` can
restrict it to one map during authoring. Local development uses the existing
`npm.cmd run dev` and `npm.cmd --prefix server run dev` commands.

Blender completes the exports but still emits its existing thumbnail-cache and
deprecated `World.use_nodes` warnings. The production bundle retains its
existing size warning. No public Cloudflare or live GitHub Pages deployment was
validated, and no commit, push or deployment was performed.
