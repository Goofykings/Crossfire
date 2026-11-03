# Gameplay Phase 4: interactive props and physics polish

This extends the existing authoritative decorative simulation. It does not add
Babylon/Havok physics, player blockers, competitive cover or a second networking
system. Previous phases and Cloudflare configuration remain intact.

## Assets and behavior

The Town market has nine individual fruits: six apples and three pears, across
three bins with different densities. One cluster has three separated bottom
apples supporting a fourth; the other fruit rests directly on the bin floor.
The starting positions are analytically supported, with non-overlapping spherical
colliders and varied model orientations. All visible market fruit is interactive.

`blender/scripts/lib/produce.py` shares bin dimensions and cluster positions
between the stall mesh and interactive definitions. Closed tapered boards sit on
the counter instead of floating above it. Static player/bullet collision retains
a conservative wooden shell; small bodies use continuous contacts against the
sloped inside/outside surfaces, floor and rim. Sloped contacts can rebound fruit
upward. Existing material textures and the market's canvas/wood appearance stay.

Confirmed firearm impulses are multiplied by five before the 8 m/s speed cap.
Free-floor displacement is checked against the former impulse under otherwise
identical conditions. Collisions and the cap naturally limit displacement in
crowded containers. Fixed 120 Hz substeps, swept static collision, mass-weighted
pair contacts, spin, energy loss and supported-body sleeping bound the simulation.
Fruit can transfer motion to neighbours; contact corrections cannot push bodies
through solid world geometry. Crates/barrels retain simple ellipsoid proxies.

The two existing shop panels retain their original top-edge pivots and static
brackets. The diagonal brace now sits above the projecting arm; previously it
occupied the board plane and crossed the lettering. Stronger angular impulses and less damping make their swing visible
for longer, with a spring returning them to rest. Maximum rotation stays 0.30
radians. No board-centre pivot or uncontrolled rotations were introduced.

One selected hanging lamp in each new enclosed interior swings from a fixed
ceiling suspension. The plate stays in the Blender building mesh; the chain and
cage share the authoritative hinge pose. A short-range point light follows the
cage through parenting, with no dynamic shadow generator. Other fixtures remain
static. Light impulses use the stronger horizontal projection so tiny weapon
spread does not suppress front-facing reactions.

## Synchronization and limits

The Worker still derives all impulses from actual validated firearm rays before
the closest world/player hit. Clients cannot submit prop positions or impulses.
Damage, ammunition, scoring, grenades and movement rules are unchanged.

- Town: 11 bodies, two signs, one hanging lamp: **14 states total**.
- Industrial/City: two bodies and one hanging lamp each.
- Hard limits remain 12 bodies/two signs, plus one selected lamp subject to the
  original **14-state global packet limit**. Over-budget definitions are rejected.
- Existing 10 Hz changed-pose updates run only during activity and include final
  sleep poses. Sleeping objects produce no continuing transform traffic.
- Full welcome/resume state preserves moved props. Map replacement resets the
  authored set and disposes meshes, lights and containers.
- Persisted poses include the map revision. Matching revisions restore after
  eviction; legacy/revised-map poses reset only decorations to supported starts,
  preserving player/combat state and the monotonic environment sequence. This
  prevents the former higher basket-floor poses floating after an asset update.

Protocol **v12 and all wire-state fields remain unchanged**. Trusted map
definitions add optional basin, fruit-orientation and lamp metadata; existing
map-revision hashing includes it. No protocol validation was weakened.

## Local verification

See the newest PROGRESS.md entry for final counts. The focused suite checks
fivefold force/displacement, thin-wall collision at bounded velocity, tapered
inside/outside contacts, upward rebounds, support without initial overlaps,
neighbour transfer, settling, wire budgets, light clearance and near-axial hits.

The real workerd test sends firearm inputs from two WebSocket peers and verifies
apple/pear reactions, sign/lamp swing, identical settled poses, quiet traffic,
resume, round cleanup and rejection of forged environmental messages. Test RPC
positions only actual joined players; it never applies fabricated prop forces.

The production `/crossfire/` Chrome harness checks two real browser clients,
render convergence, reconnection, all map replacements, shadows-free moving light
sources and practice-mode parity. Close fruit views and rest/swing views were
inspected. Additional browser regression tools cover the earlier controls/weapon
selection, grenades/crouch and Ultra graphics. Shared-controller map tests retain
stair loops, wall thickness, spawn access and tactical/collision consistency.

PowerShell from the repository root:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
npm.cmd run test:protocol
npm.cmd run assets:verify
# Serve the production path; run browser commands in another terminal.
node tools/serve-dist.mjs --port 4200 --base /crossfire/
node tools/update-phase4-test.mjs http://127.0.0.1:4200/crossfire/
node tools/gameplay-phase1-test.mjs http://127.0.0.1:4200/crossfire/
node tools/update-phase3-test.mjs http://127.0.0.1:4200/crossfire/ --capture-fx
node tools/ultra-graphics-test.mjs http://127.0.0.1:4200/crossfire/
```

Regenerate the assets with the existing Blender pipeline:

```powershell
$env:PYTHONDONTWRITEBYTECODE = '1'
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' -b --factory-startup --python-exit-code 1 -P blender/scripts/generate_all.py -- --only props,environment,town,industrial,city
```

Screenshots and runtime logs stay in ignored `test-results/`. These checks are
local, not public Cloudflare validation or a benchmark for low-end hardware.
The physics uses bounded simple proxies, not a general rigid-body engine.

## Deployment when authorized

Both **frontend/assets and the Cloudflare Worker need matching releases** because
the map definitions and simulation changed. The frontend default URL, `.env.local`,
Worker name, Durable Object state, origin allowlist and GitHub Pages base are
unchanged. No new credential or configuration is needed for this feature.

Follow [DEPLOYMENT.md](DEPLOYMENT.md): when publishing is authorized, the existing
main workflow tests both packages, verifies real protocol compatibility, builds
Pages, deploys the Worker, verifies its `/health` protocol/release SHA, and only
then publishes Pages. Repository secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` must already be configured by the owner. Manual release
and rollback commands are documented there. Do not delete/recreate the Durable
Object. Two-service releases are not atomic; existing tabs may need a refresh
for the new map revision. No commit, push or deployment was performed here.
