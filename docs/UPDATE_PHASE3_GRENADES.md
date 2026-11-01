# Update Phase 3: grenades and held crouch

Implemented locally on 2026-10-31. Existing Phase 1/2 changes were retained.
No commit, push, deployment, endpoint or hosting change was made.

## Controls and balance

- New profiles: **R** throws, **F** reloads, **Left Control** holds crouch.
  All three actions appear in the existing Controls settings. Mouse buttons can
  be bound, and the grenade HUD indicator is also a labeled, clickable button.
- Old factory bindings migrate R reload to F. Customized bindings are retained;
  new actions take unused keys. Conflicts remain explicit in Controls. Sound
  effects have a separate volume slider; existing master/graphics/settings remain.
- `shared/grenades.ts` owns balance in metres/seconds/HP: one grenade per life,
  no replenishment until respawn, 2-second fuse, 100 maximum damage, linear
  falloff to zero at 1.8 m. The collision sphere is 6.5 cm in radius.
- A throw briefly lowers/returns the equipped weapon without introducing arms.
  The original grenade uses five existing PBR materials, 892 triangles and a
  78,492-byte GLB. Editable source: `blender/source/grenade.blend`.

## Authority, synchronization and durability

The Worker accepts a held throw input, not a position, velocity, target, damage
amount or inventory value. It validates a living spawned life, remaining stock,
idle weapon action, no active slide, projectile capacity and collision-safe
body/lean eye and launch position. The authoritative controller supplies aim and
inherited velocity. Continuous sphere sweeps against the existing OBB grid run
at bounded 120 Hz substeps; gravity, restitution and friction provide bounces and
settling without thin-wall tunneling. The fuse uses elapsed server time.

The existing room simulation sends projectile state in its 20 Hz snapshots, not
per-render-frame messages. Throw/explosion events provide presentation cues.
Clients may advance the same physics briefly between corrections; they never
decide an explosion, damage, inventory or score. Event IDs deduplicate immediate
events and the bounded recent explosion history in snapshots, including resume.
Old-round events and previous-life damage feedback are rejected.

Grenade-active simulation ticks persist projectile removal, inventory, damage,
regeneration timestamps, deaths, scores and recent explosions together before
publishing their events/snapshot. Session revisions prevent an older WebSocket
attachment from replacing a newer grenade commit during reconstruction. A
disconnected thrower's grenade still resolves; an intentional leaver's old resume
token is invalidated while a short retained record preserves kill attribution.
Round changes clear old projectiles and inventory. Dead/unspawned lives cannot
throw. Posthumous kills score without retaining an invalid live combo timer.

Damage uses actual authoritative body positions/heights at detonation, shared
linear falloff and solid-environment line-of-sight. Self damage is enabled;
Teams retains existing friendly-fire protection. Grenade deaths use the normal
elimination/combo/team-score/result ledger, with no headshot bonus. Grenade hit
statistics do not inflate firearm accuracy. Normal damage resets regeneration.

## Presentation and crouch

`GrenadeView` loads one shared GLB and uses one 128-quad billboard batch for
short smoke trails, flashes, expanding smoke and cosmetic debris. Effects have
bounded monotonic lifetimes and clear on leave/map changes/results; no physical debris or
new dynamic lights are created. The original synthesized explosion WAV uses
existing camera-relative distance attenuation and the bounded spatial voice pool.
Master and SFX gain apply to players and spectators; duplicate events cannot
play duplicate explosion sounds. No position diagnostics are retained by default. Each cosmetic particle tracks
its own monotonic creation time: a newly received event must not be aged by the
whole preceding render frame, which could otherwise skip a short flash on a slow
machine. A real NullEngine regression test covers a 200 ms preceding frame.
The optional `--capture-fx` browser flag pauses presentation after its first real
explosion frame for visual inspection, then resumes normal cleanup; server timing
and damage are unchanged.

Manual crouch reuses `PlayerController` in frontend prediction/replay and Worker
simulation. It lowers the body from 1.8 m to 1.15 m and eye from 1.64 m to 1.02 m,
reduces walking speed to 2.4 m/s, and checks headroom before standing. Existing
quiet footsteps and hip-only outward weapon posture now apply to held crouch;
full ADS cancels that posture. Shooting, reloading, slides and jumps retain their
existing rules. A real exported `CROUCH` clip is distinct from `SLIDE`; its
measured maximum height is 1.1492 m. It uses a simple low planted stance/shuffle,
not a separate motion-captured crouch-walk animation.

## Protocol and release requirement

Local protocol is **v11**. It adds optional `intent.crouch` and `combat.grenade`
controls, authoritative grenade inventory/held state, projectile/recent explosion
snapshots/events, and the `grenade` elimination weapon. Strict validators and
version rejection remain enabled. Existing tools/fixtures use the matching
version. The future dedicated-server scaffold still explicitly refuses gameplay.

**Both frontend (including character/grenade/audio assets) and Cloudflare Worker
need matching releases when deployment is authorized.** Public Cloudflare was
not deployed or tested for this update. Earlier v9/v10 notes describe historical
states, not successful public v11 validation. GitHub Pages configuration and
`.env.local` are unchanged.

## Local commands

From the project directory, in separate PowerShell terminals:

```powershell
$env:XDG_CONFIG_HOME = $env:TEMP
npm.cmd --prefix server run dev
```

```powershell
$env:VITE_MULTIPLAYER_PROVIDER = 'cloudflare'
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run dev -- --host 127.0.0.1
```

These environment overrides affect that terminal only and preserve `.env.local`.

Checks:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run assets:verify
$env:XDG_CONFIG_HOME = $env:TEMP
npm.cmd --prefix server run typecheck
npm.cmd --prefix server test
npm.cmd --prefix server-dedicated test
```

`tools/update-phase3-test.mjs <frontend URL>` starts its own local Worker fixture
and opens two actual Chrome contexts; test-only RPC places real joined players,
and all throws, damage, awards, audio and reconnection use the real application.
Screenshots/results are written under `test-results/update-phase3*` (ignored).

## Verification and limits

Final results: **352 frontend/shared tests in 37 files**, **53 Worker checks**,
**7 dedicated-scaffold checks**, frontend/Worker typechecks, frontend production
build, Worker dry-run build and **183 asset / 213 material checks** passed. Two
actual Chrome clients passed local dev checks and final production `/crossfire/`
checks, including mouse HUD throw/respawn and intentional-leave cleanup. Final
screenshots were visually inspected. A pre-existing bundle-size advisory remains.


Shared tests cover launch clearance, thin/rotated walls, floor bounce/settling,
elapsed fuse integration, falloff/cap/vertical distance/occlusion, strict messages,
binding migration, hold/release/headroom/speed, exact crouch ADS restoration and
explosion deduplication across snapshot recovery/reconnect.

Real workerd/TCP tests cover inventory, synchronized crouch, resume during fuse,
one-time explosions/damage/scoring, FFA grenade multikill combos, Teams protection,
posthumous credit, respawn inventory and old-round cleanup. Existing combat,
regeneration, movement, ladder, chat, session, map rotation and result tests remain.
Browser verification exercises dev and production `/crossfire/` assets, Ctrl/R
controls, the exported remote crouch, throw motion, inventory, actual elimination,
feed/spectating, single positional audio cues and complete visual cleanup.

No physical Chromebook benchmark or public Cloudflare validation was performed.
Collision uses conservative sphere/box sweeps and simple bounces rather than
rigid-body spin/contact simulation. Smoke/debris are cosmetic and bounded.
