# Update Phase 4: interactive environment (2026-11-01)

Existing weapons, movement, grenades, combat and map layouts are preserved. The
user set the separate gun-model import request aside; current guns remain.

## Assets

`blender/scripts/lib/interactive_environment.py` authors meshes, pivots,
placements and collision refinements. Town's existing market stall retains its
position/style: two open wooden bins hold three interactive apples each; a third
bin holds three static yellow fruits. Repeated apples share geometry/materials.
Two small loose crates/barrels per map avoid spawns and structural cover.

Two actual Town sign panels were separated from building meshes; original mounts
stay fixed. Their top-edge hinges rotate at most 0.30 radians. Rotation preserves
wall-normal clearance. Other signs remain static.

Created `blender/source/environment.blend`, 11 shared GLBs (apple, crate, barrel,
eight sign-atlas variants) in `public/assets/models/shared/environment/` and each
map's `environment.json`/index reference. Updated the stall GLB/props source,
Town building chunks/source, material table and manifests. Selected generator
stages also regenerated map artifacts. No project reorganization occurred.

The stall had a solid collider enclosing empty space/produce. Shared collision
now follows its counter, posts, roof, bins and rear props. Frontend and Worker
both include these refinements and environment data in world revision hashing.

## Physics and networking

`shared/environment.ts` reuses the spatial collision grid with swept primitives,
bounded 60 Hz substeps, damping, low restitution, mass-weighted pair contacts,
a 3.2 m/s speed cap and sleeping. Signs have damped spring hinges returning to
zero. The grenade sweep's optional half-height preserves grenade defaults.
No external physics engine or expensive mesh-mesh solver was added.

Maximum budget: 12 bodies + 2 signs. Actual: **Town 8 bodies + 2 signs;
Industrial and City 2 bodies each**. Sleeping props do no substeps or transform
networking; settled rendering transforms are not rewritten per frame. Babylon
instances share repeated geometry/materials.

Props are decorative shootable targets, never player blockers or moving cover.
Bullets continue through them; props cannot shield players or grant points.
Only an actual server weapon ray before its nearest solid/player hit applies
an impulse. Clients send no prop IDs, hit claims, forces or positions. Grenade
blast impulses were not added. Practice runs the same rules locally.

**Protocol v12** adds strictly validated environment frames. Welcome/spawn sends
full poses; active updates contain changed props at 10 Hz plus a final sleep
update. Clients merge deltas, reject stale/foreign-round frames and interpolate
with a 100 ms buffer. Cached poses handle loading/resume. Round changes reset
authored props. State persists with room/session data, approximately once a
second while active and on settlement/disconnect. Abrupt process failure may
rewind cosmetic motion by that cadence; competitive state does not depend on
prop collision. Restored active props resume with bounded steps.

## Validation commands

PowerShell, from `C:\Users\Public\Crossfire`:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run assets:verify
npm.cmd --prefix server run typecheck
npm.cmd --prefix server test
npm.cmd --prefix server-dedicated test
python -B tools/check-update-phase2.py
```

Start backend and frontend in separate terminals:

```powershell
Set-Location C:\Users\Public\Crossfire
npm.cmd --prefix server run dev
```

```powershell
Set-Location C:\Users\Public\Crossfire
$env:VITE_MULTIPLAYER_URL='ws://127.0.0.1:8787/ws'
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

The process-only override preserves `.env.local`. Browser tests start their own
local workerd fixture, redirecting only the test pages:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 4199
# Another terminal:
node tools/update-phase4-test.mjs http://127.0.0.1:4199/
# Production base-path check after npm run build:
node tools/serve-dist.mjs --port 4200 --base /crossfire/
# Another terminal:
$env:CROSSFIRE_TEST_OUTPUT='test-results/update-phase4-production'
node tools/update-phase4-test.mjs http://127.0.0.1:4200/crossfire/
```

The test-only RPC fixture places real spawned players beside actual geometry;
it never injects a prop hit/force. Tests send real held fire input over real
WebSockets. Focused tests cover four weapon impulses, picking/occlusion,
bounce/speed/sleep, neighbour contacts, frame-rate independence, hinge bounds,
placements, strict protocol rejection, delta recovery, resume and round resets.
Existing suites exercise previous phases. PROGRESS.md records final results.
The dedicated-server transport scaffold remains explicitly incomplete.

## Limits and release requirements

Crates/barrels approximate upright primitives with yaw; arbitrary tumbling and
stacking are not implemented. Only two Town signs are interactive. No physical
Chromebook test or public Cloudflare validation was performed. Local headless
timings are observations, not guarantees for other hardware.

Matching **frontend/assets and Cloudflare Worker v12** releases are required
when authorized. Endpoint, origin allowlist, GitHub Pages base path and provider
default remain unchanged. Older protocol clients are rejected. No commit, push
or deployment was performed.
