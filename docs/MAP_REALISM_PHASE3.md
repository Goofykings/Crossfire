# Gameplay Phase 3: map architecture and circulation

The existing compact maps, landmarks, texture library, exterior route loops,
Industrial ladders and upper galleries remain. One existing building on each
map now contains a closed two-storey interior:

| Map | Building | Circulation |
|---|---|---|
| European Town | B25, provisions shop/apartment | East/west ground aisle, internal return stair, west upper exit and garden egress stair |
| Industrial Complex | I37, dispatch warehouse/office | Four ground doorways, storage along walls, internal return stair, west upper exit to loading lane |
| Modern City | C28, commercial service building | North/south and arcade ground connections, internal return stair, east upper exit to service alley |

Each interior has 30 cm masonry, a ground floor, a 22 cm upper slab, a ceiling,
2.1 m ground doorways, a glazed window and two eight-riser flights with a turning
landing. The upper floor is 3.22 m high. The stairwell opening and landing allow
the existing standing player and longest weapon to pass in both directions.
The independent upper exit has a supported landing, guards and sixteen descending
steps. Storage, counters, shelves and wall lights use the existing Blender mesh
and material pipeline. Shelves attach to solid masonry above the work area;
the stairwell and window stay clear.

Affected benches, storage pallets, a planter and utility cabinet were moved to
supported positions away from circulation. The Town garden wall ends before
the external stair foot. The Industrial canopy is above the upper doorway.
The City arcade aligns with the ground aisle, and opposing attached service
enclosures offset the long north street while retaining wide alternate routes.
Original shorter-range loops and screened spawn placement are preserved.

## Geometry and authoritative collision

`blender/scripts/lib/circulation.py` supplies the closed solid parts for both
GLB export and `collision_gen.py`. It does not substitute a solid building-sized
collider for a hollow interior. `realism_layout.py` adds the targeted edits to
the three existing deterministic layout authors before spawn placement.

Ground route annotations, door approaches and tactical-map obstacles are derived
from those parts. The tactical overlay can show the hollow building footprint
while retaining the actual walls, stairs and furniture blockers. It continues
to be a ground-level map, rather than a separate upstairs navigation system.

The Worker imports the same generated collision, layouts, prop catalog and
environment definitions as the client. Existing map-version hashing detects the
revision. Protocol v12 is unchanged. Publishing this phase eventually requires
matching frontend/assets and Worker builds; no hosting settings changed.

## Reproduction and inspection

From the repository root in PowerShell:

```powershell
python -I -B tools/layout_design.py --write
python -I -B tools/layout_industrial.py --write
python -I -B tools/layout_city.py --write
$env:PYTHONDONTWRITEBYTECODE = '1'
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' -b --factory-startup --python-exit-code 1 -P blender/scripts/generate_all.py -- --only town,industrial,city
python -I -B tools/map-realism-plan.py
npm.cmd test
npm.cmd run build
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
npm.cmd run test:protocol
npm.cmd run assets:verify
```

Top-down exported-collision diagnostics (north up):

- [European Town](map-realism/european-town.png)
- [Industrial Complex](map-realism/industrial-complex.png)
- [Modern City](map-realism/modern-city.png)

Left panels show the ground collision slice and spawn positions. Right panels
show the new building at upper-body height upstairs. Cyan/orange paths show the
tested ground/stair circulation. These are collision plans, not artistic renders.

`tests/mapRealism.test.ts` drives the actual shared controller through each
interior in both directions, with no weapon, a rifle and the sniper; checks body
clearance, stair heights, ground support, wall depth, real fixtures, usable
longer-range rays and backend map revisions. Existing tests retain whole-map
ground flood fill, spawn reachability, loop connectivity, all doorway/arcade
approaches, external galleries, bench clearance, mesh overlap and source/export
determinism checks.

`server/tests/traversal.mjs` uses two real WebSocket connections to local workerd.
It seeds only the initial position, then sends validated movement inputs through
all three interior loops with the sniper. It verifies peer positions, upper-floor
reconnection, one roster entry and unchanged health, life, weapon and kills.
Existing Industrial ladder tests remain.

For rendered inspection, serve the built GitHub Pages path and run the Chrome
harness in another terminal:

```powershell
node tools/serve-dist.mjs --port 4200 --base /crossfire/
node tools/map-realism-test.mjs http://127.0.0.1:4200/crossfire/
```

The harness captures ground entrances, stairwells, turns, upper exits, street
views and wall-mounted work-area storage under the optional Ultra preset. It checks asset/material loading and
browser errors. Screenshots and timing samples stay in ignored
`test-results/map-realism/`. Camera positioning in this visual harness is not a
movement test; physical traversal is verified separately as described above.

Validation is local. No public Cloudflare deployment or public multiplayer test
was performed. Local screenshots are not a representative hardware benchmark,
and competitive balance for six human players still benefits from playtesting.
