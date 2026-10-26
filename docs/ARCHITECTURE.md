# Architecture

This document describes the local practice runtime. Stage 2 also implements a separate Worker/Durable Object backend and an explicit `?multiplayer` movement-test path: see [server/README.md](../server/README.md). The later public-match design is in [MULTIPLAYER_ARCHITECTURE.md](MULTIPLAYER_ARCHITECTURE.md); verified status is in [PROGRESS.md](../PROGRESS.md). No public backend is deployed.

## Runtime overview

```
main.ts ── Game (state machine, fixed-step loop)
            ├─ RenderContext (Engine, Scene [right-handed], FreeCamera)
            ├─ Input (keyboard/mouse, pointer lock)        ├─ UI (DOM menus + HUD)
            ├─ SettingsStore (localStorage, the *applied* settings)                ├─ AudioManager (Web Audio)
            ├─ MaterialLibrary (materials.json -> PBR)     ├─ PostFX (pipeline, SSAO)
            ├─ MapManager ── LoadedMap
            │     ├─ Environment (HDRI IBL, sky, sun, shadows, fog, tone mapping)
            │     ├─ GeometryBatcher output (static meshes)
            │     ├─ CollisionWorld (collision.json + prop boxes + target boxes)
            │     ├─ TargetSystem (steel silhouettes, head + body hit boxes), map lights
            │     └─ TacticalMapData (overhead map, derived from the layout)
            ├─ PlayerController (kinematic, Babylon-free) + PlayerCamera (incl. scope sway)
            ├─ Loadout ── Weapon x3 (Babylon-free state machines)
            ├─ WeaponView (weapon rigs, lowering animation) + Effects (holes, sparks, dust, cases)
            ├─ DamageSystem (headshot rule)
            └─ TeammateRegistry (for future team modes; free-for-all shows nobody)
```

### Game states

`menu` → (Play) → `loading` (only if the preloaded map is not ready) → `start` (click-to-play card) →
`playing` ⇄ `paused` (pointer lock lost, e.g. Esc) → `menu` (Main menu button).
The default practice map (or development `?map=<id>`) starts loading as soon as the menu appears, and is shown from a slowly orbiting camera. The home menu contains only CROSSFIRE, Play and Settings. `Game.requestMap` still serializes loads for development/testing and future server map snapshots. Play awaits any pending load. There is no server-selected map or public match yet; see [connectivity diagnosis](MULTIPLAYER_DIAGNOSIS.md).

### Frame loop (`Game.frame`)

1. Mouse look is applied every rendered frame (lowest latency).
2. Weapon switching (1/2/3, Q, wheel), then movement, weapon logic, targets and footsteps run in fixed 1/120 s ticks
   from an accumulator (max 0.25 s of catch-up), so behaviour does not depend on frame rate. Weapon events (shots, cues)
   are handled in the tick that produced them.
3. The camera interpolates between the last two physics states, then adds stair smoothing, head bob,
   landing dip, recoil, the ADS zoom and (sniper scope) a slow breathing sway.
4. The view-model pose for this frame (from the weapon's action and progress), the scope overlay, the tactical map
   (only while Tab is held), HUD, effects and `scene.render()`.

## Physics

`physics/CollisionWorld.ts` stores oriented boxes (yaw only) in a 4 m spatial hash.

- `resolveCylinder`: pushes a vertical cylinder out of boxes horizontally (circle-vs-rectangle in box space).
- `groundHeight`: highest box top under a circle, below a height limit (the step-up reach).
- `ceilingHeight`: lowest box underside above a height (jump head-bump, crouch stand-up check).
- `raycast`: slab test in box space, returns point and normal (hitscan).

`player/PlayerController.ts`: the body collides only above `stepHeight` (0.42 m); a ground probe snaps the feet onto
stairs (0.18 m risers), curbs and box tops within reach, and snaps down by up to 0.45 m while walking. Movement is
integrated in sub-steps of at most 0.1 m so thin walls cannot be tunnelled. Jumping uses coyote time and an input
buffer and needs a fresh key press after landing (no double jump, no auto-hop).

## Damage, targets and spawns (free-for-all)

There are no safe zones or teams. `game/Damage.ts` is the single entry point for damage: weapons pass the body damage
of a hit (after their distance falloff) and its zone, and `DamageSystem.tryApply` applies the headshot rule
(`HEADSHOT_MULTIPLIER` = 1.5 for `'head'`) and refuses damage to dead targets. Practice targets (`game/Targets.ts`)
are steel silhouettes with two shootable colliders, head and body, whose `userData` names the zone; the raycast's
collider decides the zone. Their heights match `props.TARGET_HEAD` / `TARGET_BODY` in the Blender script (head centre
at 1.645 m, eye height). They implement `Damageable`; future players will too.

Spawn points come from `blender/scripts/lib/spawn_points.py` (all three layout tools call it): candidates on open, flat
ground with 1 m clearance, away from props, targets, doors and stairs, picked by farthest-point sampling in rotated
pairs (the layouts are 180° symmetric; both points of a pair must be valid), each facing its longest open line.
`Game.spawn` picks one at random, never the same one twice in a row.

## Weapons

`weapons/Weapon.ts` is Babylon-free and unit-tested (`tests/weapon.test.ts`, `tests/damage.test.ts`):

- `WeaponStats` per weapon (`RIFLE`, `SHOTGUN`, `SNIPER`): fire mode (`auto`, `pump`, `bolt`), rate, magazine, pellets
  and pellet cone, damage with linear falloff (`damageAt`), spread (hip, ADS, movement, bloom), recoil, ADS time and
  zoom, scope flag, equip/holster times, and a reload description: `magazine` (tactical and from-empty times, the
  moment the magazine seats, cues) or `shells` (start, per shell, end, insert moment).
- `Weapon` is a state machine over `action` (`idle`, `equip`, `holster`, `holstered`, `cycle`, `reload`, `reloadEmpty`,
  `shellStart`, `shell`, `shellEnd`) with `progress` 0..1. Reserve ammunition is infinite (`reserve = Infinity`); the
  magazine is not, and the last round or a dry trigger pull starts the reload. Pump and bolt guns enter `cycle` after
  every shot; a bolt cycle takes the eye off the scope. Shell reloads stop after the current shell when the trigger is
  pulled; from empty the pump is worked at the end.
- Timed `cue` events inside actions (`mag_out`, `mag_in`, `bolt_release`, `pump_back`, `pump_fwd`, `bolt_up`/`back`/
  `fwd`/`down`, `eject`) drive the sounds (`CUE_SOUNDS` in `Game.ts`) and the ejected cases; the view-model uses the
  same progress values, so sound and picture stay in sync.
- `Loadout` holds the three weapons: `select(i)` holsters the current one (abandoning a reload) and equips the next,
  `cycle(step)` for the wheel, `selectPrevious()` for Q. Each weapon keeps its magazine.

`Game.fireShot` casts one ray per pellet from the camera through the aim cone (plus the pellet cone for the shotgun),
applies damage per pellet through the `DamageSystem`, and reports one hit marker per shot (headshot if any pellet
hit a head). Self-loading guns eject a case per shot; pump and bolt guns eject on their `eject` cue.

### View-model (`weapons/WeaponView.ts`)

- One **rig** per existing weapon GLB. No `hands.glb` is requested and no hand/forearm meshes or spare magazine clones are created. Generated source assets remain preserved.
- **Reload animation**: a smooth 180 ms downward dip, hold, then smooth return. Magazine reloads follow their existing duration; shotgun start/shell/end phases stay lowered across each inserted shell and return at the end. Weapon/ammo state machines and timed audio cues are unchanged. Pump and sniper bolt movement after firing remain.
- **Optics**: ADS puts the sight point on the view axis at `eye` metres. The rifle's holographic reticle is a quad
  with an additive emissive material (`reticle_holo.png`, drawn after the window glass). The sniper's scope is a DOM
  SVG overlay (`UI.setScope`), faded in over the last part of the aim while the weapon is hidden; zoom is the
  weapon's `adsFovScale`, mouse sensitivity scales with it.
- Muzzle flash: a front star and two side plumes (additive), plus a warm point light for one frame. Cases are world
  objects in `Effects` (pooled instances from `casings.glb`) that tumble, bounce once with a sound and fade.
- Placement lives in `RIG_CONFIGS`. To tune: `__crossfire.tuneView(id, patch)` changes a config live,
  `viewPose(action, progress, ads)` freezes the animation at a phase, `inspectView(alpha, beta, radius)` looks at the
  rig from outside.

## Maps

`maps/types.ts` describes `MapDefinition` (id, name, asset path, layout, asset index, dimensions, environment,
collision config) and the layout schema. `maps/registry.ts` lists the maps; `maps/MapManager.ts` loads one:

1. Fetch `map-assets.json` and `collision.json`; create the `Environment`.
2. Load all GLBs in parallel into asset containers.
3. Feed every mesh (building shells, terrain, kit instances) and every prop placement into the `GeometryBatcher`,
   which writes one mesh per canonical material per 40 m cell, then dispose the source containers.
4. Build the collision world (static boxes + prop colliders), targets (GPU instances) and map lights.
5. Derive the tactical map (or load the exported file the index names, see below).
6. Register shadow casters/receivers, compile shaders (`scene.whenReadyAsync`).
7. `MaterialLibrary.prune(inUse)`: dispose the materials and textures that no mesh in the scene uses any more
   (the previous map's), keeping the shared ones.

`unload()` disposes everything the map created, so another map can be loaded. `tools/maps-test.mjs` switches through
all maps twice and checks that the scene's mesh, material, texture, geometry, light and node counts and the material
library's counts come back to the same values (`__crossfire.memory()`).

The three maps: `european-town`, `industrial-complex`, `modern-city`. Only their folders in `src/maps/`, their layout
tools (`tools/layout_design.py`, `tools/layout_industrial.py`, `tools/layout_city.py`) and their entries in
`MAP_STAGES` (`blender/scripts/generate_all.py`) are map-specific.

### Adding a map

1. Create `src/maps/<id>/layout.json` (same schema). The new maps are written with `tools/layoutkit.py`: walkable areas
   for one half, rotated 180° for the other, mass decomposed into building lots; see docs/LEVEL_DESIGN.md.
2. Add a `MAP_STAGES` entry in `generate_all.py` (id, style `european`/`industrial`/`modern`, sky, sun, preview views) and run
   `npm run assets -- --only <key>`: buildings, terrain, collision and `map-assets.json` all come from the layout.
3. Add `src/maps/<id>/index.ts` exporting a `MapDefinition` (environment settings, `hdriSunHeading` for its sky,
   `thumbnail`, `tactical.landmarks`), and a thumbnail (`tools/make_thumbnails.py`).
4. Append it to `MAPS` in `src/maps/registry.ts`. The unit tests (`map`, `assets`, `geometry`, `tactical`) and
   `tools/maps-test.mjs` pick it up automatically.

Nothing in the player, weapon or physics code knows which map is loaded.

## Tactical map (hold Tab)

- `maps/tactical.ts` (no Babylon, no DOM) turns a layout into `TacticalMapData`: building footprints (with chamfers),
  free-standing walls minus their gates, open ground by kind and height, roofed routes (passages, rooms and
  interiors, with their real door gaps), ledges and stairs of raised areas, props whose collider is large enough to
  block movement or sight (≥ 1 m² and ≥ 0.8 m tall) and named landmarks (`MapDefinition.tactical`).
  The rule is the collision world's: the play area is walkable unless something stands on it.
  `tests/tactical.test.ts` checks a grid of points against the real `collision.json` of every map.
- `TacticalProjection` is a uniform scale plus offset (north up, +x right, +z down, never mirrored);
  `markerRotation(yaw) = -yaw` turns the player's arrow the way the camera looks.
- `ui/TacticalMapView` paints the level once per map and canvas size into an offscreen canvas and, while visible,
  draws that image plus the markers each frame. It skips drawing while its canvas has no size (`?nohud`).
- `Input` maps Tab to the `map` action; `Game` shows the overlay only while it is held during play, prevents Tab's
  default (focus moves) and never pauses or consumes input, so you can keep moving and shooting.
- `game/Teammates.ts`: `TeammateRegistry.friendlies(team, selfId)` hands out only fresh (3 s), living players of the
  same team, never yourself. Nothing feeds it in single player, so no teammate markers appear; a future network
  layer calls `update()`. Enemies are never drawn, and the view filters by team again as a second guard.
- Exported 2D representation: `node tools/export-tactical.mjs` writes `docs/tactical/<id>.json` (the exact data the
  overlay draws) and `.svg`. A map can ship such a file instead of being derived by naming it in `map-assets.json`
  (`"tactical": "tactical.json"`), e.g. a map whose layout is not data-driven.

## Rendering

- Right-handed scene so glTF loads untouched. ACES tone mapping in materials.
- `MaterialLibrary`: PBR materials from `materials.json`; albedo/normal/ORM textures shared by URL; UVs in metres,
  `tile` = metres per repeat; tint variants share a canonical material (tint baked into vertex colours). Materials
  flagged `atlas` (sign and poster atlases, blinds) load their textures with `invertY = false`, so explicit atlas UVs
  pick the right cell the right way up (before this, European Town's shop signs rendered upside down).
  `"albedo": null` keeps a texture set's normal and ORM maps and paints the surface with the tint (painted steel).
- `Environment`: 256 px prefiltered HDR cube for lighting and reflections, 1024 px cube from the 4K tonemapped sky
  for the background (excluded from tone mapping), sun direction from the map definition, fog.
- Shadows: see quality presets below.
- `PostFX`: MSAA or FXAA, bloom, sharpen, SSAO (High).
- Weapon: separate rendering group with depth clear (never clips into walls), not lit by the sun.
- Depth: 24-bit buffer, camera `minZ` 0.1 (depth error is about d² / (minZ · 2²⁴), roughly 1 mm at 40 m; the player's body
  radius of 0.34 m keeps geometry outside the near plane). No surface may share a plane with another visible surface:
  the generators keep that true (see "Z-fighting" in docs/ASSET_PIPELINE.md). The only polygon offset in the map is on
  `decal` materials: thin ground inlays (gutter strips, plaza ring, team strips) that sit a few millimetres above the ground.
- Transparency: the maps have no alpha-blended geometry (glass is opaque, foliage is alpha-tested). Blended: the sight
  windows, the holographic reticle and the muzzle flash (view-model group), none of which write depth.

### Quality presets (`rendering/quality.ts`)

| Setting | Low | Medium | High |
|---|---|---|---|
| Anti-aliasing | FXAA | MSAA 2× + FXAA | MSAA 4× |
| Bloom / sharpen / SSAO | – / – / – | ✓ / – / – | ✓ / ✓ / ✓ |
| Anisotropic filtering | 2× | 4× | 8× |

| Shadows | Off | Low | Medium | High |
|---|---|---|---|---|
| Mode | none | static, 2048² | static, 4096² | cascaded, 3 × 2048² |
| Includes moving targets | – | no | no | yes |

Resolution scale multiplies the device-pixel resolution (capped at 2× DPR).

## Known limitations

- Stage 2 multiplayer supports validated movement through the explicit test URL; normal Play remains practice. No public rounds, bots or player damage sources yet (health is displayed but nothing can hurt the player). The maps
  are free-for-all; the tactical map's teammate markers have an interface (`TeammateRegistry`) for future team modes.
- The view-model shares the world camera's field of view (no separate view-model FOV), so it is placed and scaled
  for the default 90°; at very wide FOV settings it looks stretched toward the screen edge.
- Practice starts on European Town; development `?map=<id>` overrides. The home screen has no map selection controls.
- Pointer lock: browsers refuse to re-lock for about a second after Esc; clicking the game view re-captures the mouse.
- Ctrl+W can close the tab; the game asks before closing during a match, and C is an alternative crouch key.
- GLBs carry material names but no textures (by design); in external glTF viewers they look untextured.
- The JavaScript bundle imports Babylon from the package root (≈1.3 MB gzipped); deep imports would shrink it.
- Meshes are uncompressed (≈12 MB for the town, 5 MB for Industrial Complex, 6 MB for Modern City); Draco/meshopt and
  KTX2 textures would cut download size.
- Performance has been measured only on an Intel Iris Xe laptop GPU (see docs/TESTING.md).
