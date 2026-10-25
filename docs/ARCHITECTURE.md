# Architecture

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
            │     ├─ SafeZoneSystem, TargetSystem, team lights
            ├─ PlayerController (kinematic, Babylon-free) + PlayerCamera
            ├─ Weapon (logic) + WeaponView (model) + Effects
            └─ DamageSystem (safe-zone rules)
```

### Game states

`menu` → (Play) → `loading` (only if the preloaded map is not ready) → `start` (click-to-play card) →
`playing` ⇄ `paused` (pointer lock lost, e.g. Esc) → `menu` (Main menu button).
The default map starts loading as soon as the menu appears; once loaded, the menu shows the town
from a slowly orbiting camera.

### Frame loop (`Game.frame`)

1. Mouse look is applied every rendered frame (lowest latency).
2. Movement, weapon logic, targets and footsteps run in fixed 1/120 s ticks from an accumulator
   (max 0.25 s of catch-up), so behaviour does not depend on frame rate.
3. The camera interpolates between the last two physics states, then adds stair smoothing, head bob,
   landing dip, recoil and the ADS zoom.
4. HUD, effects and `scene.render()`.

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

## Safe zones and damage

`game/SafeZones.ts` defines axis-aligned volumes from the map layout. `game/Damage.ts` is the single entry point for
damage: `tryApply(attacker, target, info)` blocks the hit when the attacker's body (centre + radius) overlaps any
safe zone or the target's body does. Practice targets implement `Damageable`; future players will too.

The zones' look is separate from their rules: `rendering/ZoneBarriers.ts` builds a translucent veil (small GLSL shader,
no textures) across each entrance listed in the layout's `safeZones[].entrances`, with a Y-billboarded "BLUE/RED ZONE"
label (canvas text on a plane, so it can never be mirrored or seen from behind). The veils stand one body radius outside the
zone edge, i.e. exactly where `SafeZoneSystem.zoneAt(p, radius)` starts returning the zone. They have no collision and
are not part of any raycast. `tools/layout_design.py` (`zone_entrances`) derives the entrances from the walkable map.

## Maps

`maps/types.ts` describes `MapDefinition` (id, name, asset path, layout, asset index, dimensions, environment,
collision config) and the layout schema. `maps/registry.ts` lists the maps; `maps/MapManager.ts` loads one:

1. Fetch `map-assets.json` and `collision.json`; create the `Environment`.
2. Load all GLBs in parallel into asset containers.
3. Feed every mesh (building shells, terrain, kit instances) and every prop placement into the `GeometryBatcher`,
   which writes one mesh per canonical material per 40 m cell, then dispose the source containers.
4. Build the collision world (static boxes + prop colliders), safe zones, targets (GPU instances) and lights.
5. Register shadow casters/receivers, compile shaders (`scene.whenReadyAsync`).

`unload()` disposes everything the map created, so another map can be loaded.

### Adding a map

1. Create `src/maps/<id>/layout.json` (same schema; write a generator like `tools/layout_design.py` or author it).
2. Generate assets into `public/assets/models/<id>/` including `map-assets.json` and `collision.json`
   (the Blender `town` stage is the template: buildings, terrain, collision all come from the layout).
3. Add `src/maps/<id>/index.ts` exporting a `MapDefinition` (environment settings, `hdriSunHeading` for its sky).
4. Append it to `MAPS` in `src/maps/registry.ts`.

Nothing in the player, weapon or physics code knows which map is loaded.

## Rendering

- Right-handed scene so glTF loads untouched. ACES tone mapping in materials.
- `MaterialLibrary`: PBR materials from `materials.json`; albedo/normal/ORM textures shared by URL; UVs in metres,
  `tile` = metres per repeat; tint variants share a canonical material (tint baked into vertex colours).
- `Environment`: 256 px prefiltered HDR cube for lighting and reflections, 1024 px cube from the 4K tonemapped sky
  for the background (excluded from tone mapping), sun direction from the map definition, fog.
- Shadows: see quality presets below.
- `PostFX`: MSAA or FXAA, bloom, sharpen, SSAO (High).
- Weapon: separate rendering group with depth clear (never clips into walls), not lit by the sun.
- Depth: 24-bit buffer, camera `minZ` 0.1 (depth error is about d² / (minZ · 2²⁴), roughly 1 mm at 40 m; the player's body
  radius of 0.34 m keeps geometry outside the near plane). No surface may share a plane with another visible surface:
  the generators keep that true (see "Z-fighting" in docs/ASSET_PIPELINE.md). The only polygon offset in the map is on
  `decal` materials: thin ground inlays (gutter strips, plaza ring, team strips) that sit a few millimetres above the ground.
- Transparency: the town has no alpha-blended geometry (glass is opaque, foliage is alpha-tested). Blended: the weapon
  lens and the safe-zone barriers/labels, none of which write depth.

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

- No multiplayer, bots or player damage sources yet (health is displayed but nothing can hurt the player).
- Pointer lock: browsers refuse to re-lock for about a second after Esc; clicking the game view re-captures the mouse.
- Ctrl+W can close the tab; the game asks before closing during a match, and C is an alternative crouch key.
- GLBs carry material names but no textures (by design); in external glTF viewers they look untextured.
- The JavaScript bundle imports Babylon from the package root (≈1.3 MB gzipped); deep imports would shrink it.
- Meshes are uncompressed (≈14 MB for the town); Draco/meshopt and KTX2 textures would cut download size.
- Performance has been measured only on an Intel Iris Xe laptop GPU (see docs/TESTING.md).
