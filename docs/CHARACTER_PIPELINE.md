# Multiplayer character

The player is an original stylized humanoid inspired by the supplied `references_images/Player.png`: dark cap, short beard, charcoal shirt/trousers, tactical vest, gloves and boots. The existing analytic `char_geometry.py` geometry was reused and finished through Blender; map geometry, weapons, menus and the multiplayer protocol are unchanged.

## Generate and inspect

```powershell
Set-Location C:\Users\Public\Crossfire
npm.cmd run assets:player
node tools/inspect-character.mjs
npm.cmd run assets:verify
```

The existing runner finds Blender using `BLENDER_PATH` or installed locations. Tested with Blender 5.2.3 LTS. The character command runs only `blender/characters/generate_player.py`, with Python failures producing a nonzero process exit code. It does not regenerate maps, audio, weapon models or shared map materials. No image-generation service or external downloads are needed.

Outputs:

| File | Purpose |
|---|---|
| `blender/characters/player.blend` | Editable mesh, weights, 18-joint armature and all six actions |
| `public/assets/characters/player.glb` | Actual skinned mesh, three materials, embedded atlas textures and animations |
| `public/assets/characters/player.json` | Measured scale/ground, actual clip names/durations and union of posed bounds |
| `public/assets/characters/player-{albedo,orm}.png` | Original shared 256 px atlas pair, also embedded in the GLB |

The generator registers its outputs in the existing asset manifest without rebuilding other assets. The verifier understands explicitly self-contained materials; map GLBs still require the global material table. The GLB byte audit checks normalized vertex weights, valid joint indices, real changing animation channels, no root translation, embedded textures, all six clip names, and a budget below 12,000 triangles / 800 KB. Current export: 9,248 triangles, 4,931 exported vertices, 456,152 bytes, one 18-joint skin and three primitives/materials.

## Coordinate and animation contract

Blender uses metres, Z up and +Y forward. The actual GLB has Y up and faces -Z, matching the existing right-handed game. Exported rest height is 1.798 m; the presentation root normalizes it to the existing 1.8 m character height with no yaw correction. Feet are authored around ground zero. Inspect the actual export again before changing the metadata or substituting another rig.

| Clip | Seconds | Behavior |
|---|---:|---|
| IDLE | 2.4 | Looping breathing and relaxed arm motion |
| RUN | 0.8 | Looping opposite arm/leg swing, articulated knees and feet |
| JUMP_START | 0.2 | Jump preparation/extension |
| JUMP_LOOP | 0.8 | Looping airborne leg tuck |
| JUMP_LAND | 0.3 | Landing compression/recovery |
| SLIDE | 1.0 | Low seated slide with an extended leg and a folded leg |

Every action uses the same mesh/rig and remains in place. The root bone never travels. Grounded poses are sampled in Blender and aligned using their actual skinned sole vertices. Slide height measures 1.1431 m before the small height-normalization factor; it fits the existing 1.15 m lowered collider. Skin weights blend elbows/knees; accessories follow their assigned bone. Source actions are available in Blender's Action Editor/NLA, initially muted so the file opens in its editable rest pose.

`CharacterAssetLibrary` loads once through the existing cancellable GLB loader and Pages asset paths. Geometry, materials and textures are shared; each remote gets cloned bone transforms and animation groups for independent poses. No local first-person humanoid is instantiated. Normal operation uses the GLB; a corrupt/missing download retains the existing fallback and exposes an error in `characterAsset()` diagnostics.

`PlayerAnimationState` consumes server grounded, slide and crouch state, with horizontal speed derived from the same authoritative position interpolation used to render the actor. This also handles sparse batches that move during a snapshot interval but end with zero instantaneous velocity. It selects all six clips, handles joining midair without inventing a launch, uses run-speed hysteresis, and retains a low pose if standing clearance is blocked. `PlayerAnimator` crossfades groups over about 100 ms, varies running playback with speed, holds completed short poses as needed, and does not restart an unchanged clip every frame. It never edits controller state, server positions, collider sizes or weapon state. Animated characters are not vertically squashed during a slide.

Slow startup exposed an existing UI recovery edge: a spawn acknowledgement can arrive after the request times out. Retry now enters an already-approved live server session with its existing locked weapon, rather than asking the server to spawn again. The browser regression deliberately drops one actual acknowledgement and verifies recovery using the real authoritative snapshots and Spawn button.

Transport regression tests also found that new-life/reset paths shared the same pending and unsent array, duplicating control frames. Those buffers are now independent. Input flushing leaves at most 24 frames unacknowledged, below the unchanged server queue budget, so rendering/network stalls do not upload an unrestricted backlog. The original prediction/replay, finite pending limit, reconnect behavior and server simulation authority remain in place.

## Visibility and lifetime

Existing relative-team colors remain: all other FFA players red, teammates blue and opponents red in Teams. The native depth-tested outline pass uses the skinned geometry, with a thinner hull suitable for cuffs, fingers and cap details. Static union bounds measured over all poses keep moving limbs in the frustum without per-frame CPU reskinning.

After Babylon evaluates animations, LOS probes use actual head/chest/pelvis/shoulder/hand/foot bone positions against the existing map triangle index. Enemy names require visibility; teammate names may remain through walls inside the camera view. Name anchors follow the actual animated head. Meshes, rigs, groups and labels are disposed when their real player leaves or dies; the shared source asset remains available for respawn/reconnect/map transitions.

## Verify in the game

Build frontend and backend, serve the production frontend under its Pages base, and run:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run typecheck --prefix server
npm.cmd run build --prefix server
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run build
# Separate terminal:
node tools/serve-dist.mjs --port 4176 --base /crossfire/
# Test terminal:
node tools/combat-visibility-test.mjs --out test-results/character --url http://127.0.0.1:4176/crossfire/
```

The browser tool uses independent actual browsers and actual Worker WebSocket clients, not fabricated remote players. Bounded input frames from a real WebSocket client drive the authoritative controller while browsers observe real animation groups and bone positions. It also preserves the existing FFA/Teams combat, wall visibility, health, elimination, respawn and disconnect checks. Fixture RPC only positions already spawned sessions on clear map sightlines. Final results and remaining limits are recorded at the top of PROGRESS.md.

This character feature changes frontend presentation/assets and needs a frontend rebuild/publication when authorized. It adds no Worker/protocol change; the baseline backend must still support protocol v5. No commit, push or deployment is automatic. Local GPU measurements are not a claim of performance on every Chromebook or of public-server load capacity.
