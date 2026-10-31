# Multiplayer combat and remote visibility

Phase 1 uses protocol v8 for shared slide-jump physics, weapon balance and room chat. The Worker derives the firing eye and upper-body hitboxes from validated, collision-limited motion. Earlier protocol descriptions below are historical.

Updated 2026-10-29. This extends the existing single Cloudflare Worker / Durable Object room; it does not replace the transport, movement prediction, guest identity, map rotation or Pages hosting. Protocol v6 adds authoritative incoming-ray/life metadata for directional deaths and damage feedback. See [combat visuals and home preview](COMBAT_VISUALS.md).

## Cause and authoritative combat

The previous frontend only fired rays into its local map/practice-target collision world. Remote bodies were visual objects, not damageable targets. The protocol carried no combat control or health, and the Worker had no weapon simulation, player-hit detection or PvP damage. Changing mesh pickability alone could not fix that missing server path.

Protocol **v6** adds bounded trigger/reload control alongside the existing sequenced movement frames. The Worker runs the existing pure Weapon state machines at the same fixed 120 Hz rate, with their unchanged RPM, magazines, infinite reserves, reloads, ADS/spread, pellets, range and falloff. It derives the muzzle ray from authoritative player position/eye height and validated look input. Head spheres and torso cylinders follow the authoritative lowered height. The closest real connected living player is hit only when map collision geometry does not block the ray. Client positions, damage, gun state, target IDs, cooldowns and score submissions are rejected.

Damage uses the existing shared DamageSystem and **1.5x** headshot rule. Health is clamped at zero; each elimination increments one death and one killer score once, emits an actual elimination notification and permits the existing server-approved respawn. Respawn refills health and the selected legal weapon; a live player cannot respawn or switch weapons. Server snapshots synchronize health and weapon state, including prediction/replay of unacknowledged control frames. Local muzzle/recoil/audio and environment impacts remain responsive; multiplayer hit markers require an actual accepted server hit.

FFA and Teams now have actual server-owned modes and relationships. Modes derive deterministically from the persisted server seed/round, and joining players receive balanced teams in Teams. Mode/team assignment cannot be selected in client join/input packets. `MATCH_MODE=ffa` or `MATCH_MODE=teams` may force a server mode for local diagnostics; otherwise the existing seeded rounds select modes. Friendly fire is disabled and there are no safe zones. Team totals persist with session state and reset with the round. Reconnect retains valid health, life, weapon state and identity within the existing grace period.

Hit validation currently uses server poses when processing the input; historical lag compensation/rewind is not implemented. High-latency moving-target shots can therefore be less forgiving than a full rewind-based shooter. This is not a claim of public deployment, load capacity or anti-cheat completeness.

## Character asset boundary

The actual Blender character is now generated/exported to `public/assets/characters/player.glb`, with an editable `blender/characters/player.blend`, one 18-joint rig and six in-place clips. The supplied reference is `references_images/Player.png`; existing analytic geometry is reused. The actual exported bytes are audited before the measured metadata enables the asset.

`src/game/CharacterAsset.ts` loads through existing cancellable Pages-compatible paths, shares geometry/materials and clones independent instances of the same rig. `PlayerAnimation.ts` selects and blends IDLE/RUN/JUMP_START/JUMP_LOOP/JUMP_LAND/SLIDE from interpolated server movement, without moving authoritative roots or squashing the humanoid. Actual animated bone positions drive marker anchors and visibility. A download failure retains the existing fallback with an explicit diagnostic state. See the [character pipeline and verification](CHARACTER_PIPELINE.md) and the newest PROGRESS.md entry for asset budgets, regeneration, runtime evidence and limits.

## Outlines and names

Outlines use one shared, depth-tested union mask for all skinned character parts and a 1.5 CSS-pixel inward screen contour. Opaque map geometry and foreground weapons occlude the mask. No internal clothing/material edges, expanded per-part hulls or bounding boxes are drawn. The pass is shared across the room; it does not rerender the map once per player. See [implementation and cost](COMBAT_VISUALS.md).

Relative opponents are red and teammates are blue, including Red Team players viewing Red Team teammates. Completely occluded pixels cannot contribute an outline. There is no local-player outline. A static triangle spatial index is built once per map for name visibility; short rays to animated head/torso/side/foot probes preserve openings without scanning the full scene each time. It is presentation data, not another physics or multiplayer system. Alpha-cutout sheets are conservatively treated as occluders; very small exposed portions can be missed by name probes without suppressing the actual visible silhouette.

Actual server names are bounded camera-projected DOM labels. Enemy labels require stable body visibility and hide immediately when all probes become occluded. Teammate labels remain visible through walls while the projected head is inside the camera view. Labels are 11-14 px, have bounded widths and shadows, use textContent, cannot intercept input, and disappear with dead/disconnected players. The existing interpolation drives both body and marker positions.

## Local verification and deployment boundary

Use two PowerShell terminals from the repository root:

```powershell
# Terminal 1
Set-Location C:\Users\Public\Crossfire
New-Item -ItemType Directory -Force test-results | Out-Null
$env:WRANGLER_SEND_METRICS = 'false'
$env:WRANGLER_LOG_PATH = "$PWD\test-results\local-worker.log"
$env:WRANGLER_REGISTRY_PATH = "$PWD\server\.wrangler\registry"
npm.cmd run dev --prefix server
```

```powershell
# Terminal 2
Set-Location C:\Users\Public\Crossfire
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Visit `http://127.0.0.1:5180/` in independent browser profiles. Tests use actual local Worker runtimes and real WebSockets; the test-only RPC only positions already-spawned real sessions on valid map sightlines. It never applies damage or assigns scores/teams. It is not in the production Wrangler entry.

The automated browser firing check dispatches mouse events through the game's actual canvas/window input handlers because native headless CDP mouse delivery was unreliable across isolated contexts. Hits, health, scores and rosters still come from real Worker connections; this does not verify physical mouse hardware.

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

**The Cloudflare Worker requires redeployment**, together with a matching protocol-v6 frontend build. The older public Worker cannot process these new combat controls or health snapshots. Deployment must retain the canonical public-main Durable Object binding, SQLite storage/migrations and exact allowed Pages origin. The public frontend URL must use `wss://<worker-host>/ws`; GitHub Pages still hosts only frontend files. The updated `/health` response reports `protocol: 6`. No commit, push, Worker deployment or Pages deployment is performed by this task. See PROGRESS.md for final verified results and limits.
