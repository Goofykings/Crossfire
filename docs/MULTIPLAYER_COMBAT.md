# Multiplayer combat and remote visibility

Updated 2026-10-27. This extends the existing single Cloudflare Worker / Durable Object room; it does not replace the transport, movement prediction, guest identity, map rotation or Pages hosting.

## Cause and authoritative combat

The previous frontend only fired rays into its local map/practice-target collision world. Remote bodies were visual objects, not damageable targets. The protocol carried no combat control or health, and the Worker had no weapon simulation, player-hit detection or PvP damage. Changing mesh pickability alone could not fix that missing server path.

Protocol **v5** adds bounded trigger/reload control alongside the existing sequenced movement frames. The Worker runs the existing pure Weapon state machines at the same fixed 120 Hz rate, with their unchanged RPM, magazines, infinite reserves, reloads, ADS/spread, pellets, range and falloff. It derives the muzzle ray from authoritative player position/eye height and validated look input. Head spheres and torso cylinders follow the authoritative lowered height. The closest real connected living player is hit only when map collision geometry does not block the ray. Client positions, damage, gun state, target IDs, cooldowns and score submissions are rejected.

Damage uses the existing shared DamageSystem and **1.5x** headshot rule. Health is clamped at zero; each elimination increments one death and one killer score once, emits an actual elimination notification and permits the existing server-approved respawn. Respawn refills health and the selected legal weapon; a live player cannot respawn or switch weapons. Server snapshots synchronize health and weapon state, including prediction/replay of unacknowledged control frames. Local muzzle/recoil/audio and environment impacts remain responsive; multiplayer hit markers require an actual accepted server hit.

FFA and Teams now have actual server-owned modes and relationships. Modes derive deterministically from the persisted server seed/round, and joining players receive balanced teams in Teams. Mode/team assignment cannot be selected in client join/input packets. `MATCH_MODE=ffa` or `MATCH_MODE=teams` may force a server mode for local diagnostics; otherwise the existing seeded rounds select modes. Friendly fire is disabled and there are no safe zones. Team totals persist with session state and reset with the round. Reconnect retains valid health, life, weapon state and identity within the existing grace period.

Hit validation currently uses server poses when processing the input; historical lag compensation/rewind is not implemented. High-latency moving-target shots can therefore be less forgiving than a full rewind-based shooter. This is not a claim of public deployment, load capacity or anti-cheat completeness.

## Character asset boundary

The supplied workspace currently has `blender/characters/char_geometry.py` but **no exported character GLB**, skeleton or animation clips. The existing capsule bodies remain explicitly identifiable as placeholders; no model, skeleton or clips were fabricated.

`src/game/CharacterAsset.ts` provides the reusable shared loader/instancer interface. `CHARACTER_ASSET` stays null until the actual export is inspected. It loads with Pages-compatible asset paths and cancellation, validates that configured clips actually exist and that one exported rig drives the meshes, shares geometry/materials and clones the same rig layout for independent player poses. Failure leaves working multiplayer intact. The debug `characterAsset()` result reports missing/error/ready and actual exported clip names/bone counts, never invented clips.

Remaining character integration:

1. Finish and export the GLB to a public asset path; inspect its actual animation names, joints/skin, metres, ground height and forward direction.
2. Fill the explicit CharacterAssetDefinition with verified measurements/correction and actual clip mappings. Do not guess them from expected names.
3. Bind IDLE/RUN/JUMP_START/JUMP_LOOP/JUMP_LAND/SLIDE state transitions to those actual animation groups, blend on changes and retain independent instances of the same rig. Playback/state integration is pending the asset.
4. Verify feet, heading, slide/jump poses, blending, disposal and outlined skinned geometry with several real clients. Animation must never move the authoritative collider/root.

## Outlines and names

Outlines use Babylon's mesh outline pass, with its normal depth test and bone binding; they follow rendered body geometry rather than a bounding box. One engine component handles the shared scene, without a separate whole-scene render per player. The actual model's animated outline still needs verification once its GLB exists. The implementation was checked against the installed engine's [outline renderer source](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Rendering/outlineRenderer.ts).

Relative opponents are red and teammates are blue, including Red Team players viewing Red Team teammates. Outlines are disabled for completely occluded bodies and depth-tested for visible body portions. There is no local-player outline. A static triangle spatial index is built once per map from existing opaque rendered batches; short rays to interior head/torso/side/foot probes preserve openings without repeatedly scanning the full scene. It is presentation data, not another physics or multiplayer system. Alpha-cutout sheets are conservatively treated as occluders; very small exposed body portions can be missed by the visibility probes.

Actual server names are bounded camera-projected DOM labels. Enemy labels require stable body visibility and hide immediately when all probes become occluded. Teammate labels remain visible through walls while the projected head is inside the camera view. Labels are 11-14 px, have bounded widths and shadows, use textContent, cannot intercept input, and disappear with dead/disconnected players. The existing interpolation drives both body and marker positions.

## Local verification and deployment boundary

Use two PowerShell terminals from the repository root:

```powershell
# Terminal 1
Set-Location C:\Users\Public\Crossfire
$env:WRANGLER_SEND_METRICS = 'false'
$env:WRANGLER_LOG_PATH = "$PWD\test-results\local-worker.log"
npm.cmd run dev --prefix server
```

```powershell
# Terminal 2
Set-Location C:\Users\Public\Crossfire
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Visit `http://127.0.0.1:5180/` in independent browser profiles. Tests use actual local Worker runtimes and real WebSockets; the test-only RPC only positions already-spawned real sessions on valid map sightlines. It never applies damage or assigns scores/teams. It is not in the production Wrangler entry.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run build
# Keep this production server running in a separate terminal:
node tools/serve-dist.mjs --port 4176 --base /crossfire/
# Then:
node tools/combat-visibility-test.mjs --url http://127.0.0.1:4176/crossfire/
```

**The Cloudflare Worker requires redeployment**, together with a matching protocol-v5 frontend build. The older public Worker cannot process these new combat controls or health snapshots. Deployment must retain the canonical public-main Durable Object binding, SQLite storage/migrations and exact allowed Pages origin. The public frontend URL must use `wss://<worker-host>/ws`; GitHub Pages still hosts only frontend files. The updated `/health` response reports `protocol: 5`. No commit, push, Worker deployment or Pages deployment is performed by this task. See PROGRESS.md for final verified results and limits.
