# Gameplay polish Phase 1

This update removes Powerups, preserves FFA/Teams, and adds authoritative assists
and cosmetic/audio improvements. Phase 2 mode selection is not implemented.

## Authority and migration

The single protocol source remains `shared/protocol.ts`, now **v18**. Removing
ability/motion fields and adding bounce/assist data is deliberately incompatible
with v17; validation remains enabled. FFA/Teams round duration, rotation schedule,
maps, ordinary weapon balance, ammo, physics, leaning and collision are preserved.
Old Powerups rounds/results become FFA. Old Giant HP is converted by its previous
1.5 factor; retired transient ability state disappears. Session IDs, capabilities,
life, scores, wallets, challenge progress and previous statistics remain intact.
Only the retired `powerups` KV key is deleted; the Durable Object is never reset.
No dedicated GLB/audio/texture assets belonged exclusively to this procedural mode.
Shared normal material/effect assets remain.

`shared/assists.ts` tracks actual accepted HP damage by victim life/round and
contributor life. `ASSIST_WINDOW_MS` in `server/wrangler.jsonc` defaults to 10000.
Each eligible contributor other than the killer/victim receives **50 points** and
one assist, once per death. Latest damage refreshes eligibility. Friendly-blocked,
missed, zero and invalid damage never contribute. Death consumes the victim entry;
respawn clears that player's victim/source history; round reset clears all. A
contributor who is dead but has not respawned can receive a posthumous assist.
An authenticated reconnect within grace keeps the same life/history; a removed
session cannot receive new awards. Environment/self deaths have no assist award.

Counts appear in live standings, frozen results and lifetime stats. Kill/headshot/
combo awards and team kill totals are unchanged. Assist points advance existing
point challenges and daily/weekly/all global points, never kill objectives.
Contribution capture, sessions, score, career/wallet and statistics journals share
the same atomic KV save. Existing elimination life guards and statistics event IDs
prevent double credit. HTTP statistics schema **v2** adds totals.assists; old
profiles initialize it to zero without inventing history. Indexed ranking metrics
remain KILLS/POINTS/WINS; no database service or new binding is required.

## Audio and shot presentation

The previous remote-shot path required a living shooter in the latest snapshot,
used a very quiet 0.2 gain cap and cut off at 70m. Valid events now use the current
visible weapon muzzle, with authoritative ray origin fallback if the avatar is
unavailable. Audio follows the camera's world position, forward and up, including
spectator rotation. The inverse-distance panner uses a 5m reference / 180m cutoff,
covering current maps. Master/SFX buses remain authoritative user volume controls.
Twelve spatial voices are bounded by fading old tails; an SFX compressor limits
summed bursts. All four weapons retain their WAVs; local shot playback stays single.
Browser autoplay permission and actual audio-device output still apply.

Grenade bounce cues come from actual server sphere sweeps, thresholded above
1.2m/s normal impact and throttled to 180ms per grenade. The existing shell-drop
asset supplies a quiet clink. Physics impulses, fuse, damage and radius do not
change. Old catch-up bounces are silent. Explosion audio uses the same world-space
bus at a stronger gain. Existing combat-ID deduplication suppresses repeats;
repeated snapshots and reconnect history do not replay already-seen events.
Recovered explosions older than 600ms are silent; expired flashes are not replayed.

Every confirmed pellet ray ends at its actual first wall/player/range bound.
A single pooled depth-tested batch holds up to 128 very thin gray-white streaks,
0.12 peak alpha, quadratic fade over 220ms. The first 0.8m is omitted to keep the
shooter's reticle clear. Chromebook budget is 32. No lights, raycasts or damage
are introduced by trails. Remote muzzle quads reuse glow.png, sit at the model's
muzzle anchor and inherit weapon recoil/lean/interpolation. They last 55ms and
reuse the existing remote firing timeline. They add no lights or shadow maps.

## Chromebook mode and UI

Settings -> Graphics -> CHROMEBOOK MODE defaults off, uses the existing draft /
Apply / Back flow and persists in the same settings record. Expensive controls
are disabled with an override explanation while enabled. Stored quality/shadow/
resolution/effect choices remain unchanged and restore on disabling.

Derived mode uses half display resolution (one quarter the pixels), no shadow
maps, MSAA 1 / FXAA off, no bloom/SSAO/sharpen, anisotropy 1, no PBR specular IBL,
normal maps, ORM maps or clear coat. A cheap hemisphere replaces diffuse IBL alongside existing sun/interior fixtures
to keep interiors readable while the environment-texture shader path is disabled. Shared non-atlas base textures use cached GPU-resized
copies capped at 256px on the longest edge; atlas/sign text retains readability.
Original maps are retained for restoration; copies are pruned with
unused sources. This reduces texture sampling cost, not initial downloads.
Existing embedded character textures are retained to preserve the selected skin.
Grenade smoke keeps its full gameplay volume with fewer particles; cosmetic
spark/dust/debris counts shrink, cases are skipped, explosion point lights are
suppressed and distant arm IK is throttled. Essential geometry, collision,
interactive props, player bodies, weapons, HUD and simulation are never removed.

The damage chevron is approximately 3x larger, responsively clamped, and rotates
continuously toward the confirmed attack direction using the current camera yaw:
front up, rear down, left/right accordingly. Existing vignette/healing envelopes
are preserved; no attacker tracking or positional information is invented.
Play now uses muted translucent blue with a 180ms darker hover. UI.onModeSelect
is an optional future navigation hook; without it the existing real join/weapon
selection flow is used.

## Validation and release

See the latest PROGRESS.md for executed checks and local Chrome artifacts.
Unit tests include real exported four-weapon rig/grip checks. Server tests use
actual TCP WebSockets and local workerd; test-only RPC sets explicit positions or
legacy storage preconditions, never injects successful combat messages.

PowerShell commands from the repository root:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
npm.cmd run test:protocol
npm.cmd run test:deployment
npm.cmd run build
```

Optional production-build browser check (separate terminal for the static server):

```powershell
node tools/serve-dist.mjs --port 4200 --base /crossfire/
node tools/gameplay-polish-browser-test.mjs
```

For ordinary local development, start `npm.cmd run dev --prefix server` and, in
another terminal, set `$env:VITE_MULTIPLAYER_URL='ws://127.0.0.1:8787/ws'` before
`npm.cmd run dev`. Preserve any existing .env.local. No new frontend credentials.

When deployment is authorized, the existing coordinated GitHub Actions workflow
must publish the matching Worker first, verify health protocol/release SHA, then
Pages. No URL, Durable Object name/state or ALLOWED_ORIGINS change. Existing
Cloudflare secrets are sufficient. Old open v17 clients must refresh after release.
Separate services cannot be deployed atomically. No public Cloudflare/GitHub Pages
connection or physical Chromebook performance is claimed by local checks.
