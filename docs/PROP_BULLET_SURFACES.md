# Prop bullet surfaces

Player movement retains the existing authored OBBs. Bullets use separate static
surfaces extracted from the shipped prop GLBs; neither the browser nor a player
can submit authoritative hit positions.

`tools/generate-bullet-surfaces.mjs` reads each colliding catalog prop's actual
triangle primitives and complete scene-node transforms. It deduplicates vertices,
retains curved/angled surfaces and gaps, and records SHA-256 source hashes in
`public/assets/models/shared/props/bullet-surfaces.json`. Opaque foliage remains
solid geometry; alpha-masked/blended foliage cards are excluded. Signs and wire
meshes use generated full-resolution opacity masks, UV interpolation and the
material's texture orientation/tiling, so transparent texels never block bullets.
Masked surfaces receive sparks only, preventing a mark from spanning cutout
holes. Cosmetic alpha-cut paint overlays retain their actual backing surfaces. Noncolliding
visual-only decorations remain noncolliding. The original GLBs are untouched.

Both `server/src/world.ts` and `MapManager` supply this same catalog to
`createMapWorld`. Movement boxes remain intact, including the existing special
stall/bin/canopy treatment. Bullet proxies replace their ray surfaces with the
rendered prop mesh and live in a separate grid, so movement queries do not visit
these proxies. Proxies are never movement solids or render meshes.

`raycastBullet` keeps ordinary architectural box surfaces and target colliders,
but resolves props against reusable per-asset triangle BVHs. The existing grid
provides the broad phase, and the BVH prunes triangles within each candidate.
The nearest surface wins, including an exit surface for a ray inside a prop.
The production Worker and local Practice authority both call `traceWeaponShot`,
which uses this path. Movement, weapon clearance, lean, grenade sweeps, melee,
and the existing cosmetic-only moving-prop policy retain their prior rules.

Map revisions include the generated bullet data. **Release matching frontend
assets and backend code together when authorized.** The WebSocket protocol
version/schema, origins, URLs, room state, damage and ammunition are unchanged.
A stale frontend/backend pair is rejected by the existing map-version check.

Prop marks clip the original triangles into a small projection volume rather
than placing a flat quad on a bounding box. They retain the actual surface
normals and sit 1 mm above the triangles. Mesh edges and gaps clip the mark;
curved surfaces retain their shape. `ImpactMark` queries the same BVH. Effects
uses a single additional pooled draw mesh (128 slots, at most 192 vertices per
mark) across all graphics settings, with a 20-second lifetime. Ordinary wall
marks retain the existing instanced-quad pool. Neither mode adds per-frame
collision queries. The extra mesh is disabled whenever its pool is empty. All
marks clear on leaving/changing maps.

After changing a prop GLB:

```powershell
npm.cmd run assets:bullets
node tools/generate-bullet-surfaces.mjs --check
npm.cmd test -- --maxWorkers=2 tests/propBulletSurfaces.test.ts
```

The Blender asset runner regenerates the bullet file after a successful export.
The regression suite verifies the source hashes and deterministic extraction,
so stale generated surfaces fail tests rather than silently falling back to
inaccurate boxes. Runtime asset fetching uses the existing base-aware asset URL
helper, including GitHub Pages.

Verification tools:

```powershell
node tools/prop-impact-browser-test.mjs
npm.cmd --prefix server run build
node --test server/tests/prop-bullets.mjs
```

The browser tool builds an isolated graphics lab, serves the real GLBs and bullet
catalog locally, and compares Babylon picks against shared raycasts. It captures
close-ups of barrels, pipes, crates, benches, angled dumpsters and cabinets, plus
a reduced-effects view. This is a geometry/decal review, not a full-device FPS
benchmark. Artifacts are in `test-results/prop-bullet-browser/`. The backend tool
uses actual local Durable Object rooms on all four maps, with test-only RPC
probes; there is no new production diagnostic endpoint.

Production smoke review (after `npm run build`):

```powershell
# Terminal 1: serve dist with a Pages-style base
node --input-type=module -e "import {preview} from 'vite';await preview({configFile:false,base:'/crossfire/',preview:{host:'127.0.0.1',port:4219,strictPort:true}});"
# Terminal 2
node tools/prop-practice-browser-test.mjs
```

This opens the actual production game, chooses each of the four Practice maps
in Chromebook mode, and checks the frontend's loaded map revision against the
current shared source data. It verifies the base-prefixed catalog request is
cached across maps, with no gameplay WebSocket, missing assets or browser errors.
