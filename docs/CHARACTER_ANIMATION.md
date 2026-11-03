# Third-person weapon rig and animation

Two passes, both 2026-11-03, local only. No protocol, server, gameplay, collision, damage,
reload timing, movement, scoring, map or HUD change. No commit, push or deployment.

## Pass 2: shoulder-mounted ADS, clavicles, fingers, actions, recoil timing, performance

### Diagnosis of the "stock at the jaw" ADS

The third-person weapon GLBs are the first-person models at `WEAPON_SCALE` 0.85. Measured
from `blender/scripts/lib/weapon.py`, they are realistic. The overall lengths at 0.85 are
0.86 m (rifle), 0.90 m (shotgun), 1.08 m (sniper) and 0.56 m (SMG). The rifle's
trigger-to-butt length is 0.37 m (0.32 m scaled), within the M4's 0.27-0.36 m range. So
neither mesh geometry, scale nor stock length was the cause, and no weapon asset was
changed.

The cause was the IK target: ADS placed the *sight* at a fixed offset from the head joint.
With a 9.5 cm sight-over-butt height, that left the butt pad 10 cm above the shoulder joint,
beside the jaw. The trigger forearm then had to come up from below, giving the 41-47 degree
trigger wrists.

### What changed

- **ADS placement** (`WEAPON_HOLDS[*].ads`, `CharacterWeapon.solve`):
  - The measured butt pad (`measureButt`, the rear-most vertices of the body mesh) is placed
    in the shoulder pocket.
  - The pocket is a torso-frame landmark 9.5 cm inside, 10 cm in front of and 1.2-3.5 cm
    above the *lifted* right shoulder joint. The weapon points along the full look
    direction.
  - A bounded cheek weld (`cheekWeld`) turns the neck (40%) and the head (up to 0.6 rad in
    total) to bring the right eye toward the sight line. The head also tilts 0.12 rad toward
    the stock.
  - The support hand slides back along the fore-end if it cannot reach; any remaining
    overreach moves the weapon along its bore, never a hand off the gun.
  - ADS elbow hints are higher, so the trigger forearm is flatter.
- **Clavicles** (Blender + runtime):
  - `char_geometry.py` adds `clavicle_l/r` (sternoclavicular joint to shoulder joint) as the
    upper arms' parents.
  - The shoulder cap, trapezius and vest straps blend up to 85% onto the clavicle near the
    shoulder, fading toward the neck, sternum and ribs. Arms remain closed shells with ball
    joints inside the torso, so a shrug cannot open a gap.
  - At runtime the shoulders elevate and protract. The support shoulder reaches forward, and
    in ADS the firing shoulder lifts 0.13 rad into the stock. Recoil pushes the firing
    shoulder back, and reload keys add small shoulder movements.
- **Index fingers** (Blender + runtime):
  - The index finger of each glove now has three phalanx bones (`index_1..3_l/r`) with
    blended arc-length weights. Its tube gains mid-phalanx rings (+72 triangles in total).
  - The other fingers, the thumb, the glove material and the proportions are unchanged.
    Other joints are not articulated, which avoids seams or floating geometry.
  - `IndexFinger` curls each joint about the modelled grip axis, and spreads the knuckle
    toward the thumb in the palm plane.
  - **Trigger hand:** the finger lies straight along the frame when not shooting (trigger
    discipline) and rests on the blade while aiming or within 0.6 s of a shot. A 45 ms pull
    pulse plays per shot.
  - The trigger-pad curls were fitted against each model's trigger blade: 4-8 mm in ADS on
    all four weapons. The trigger hand also sits about 1 cm higher and further forward on
    the grip (a high grip) so the knuckle is at trigger height.
  - **Support hand:** the index points along the fore-end on the rifle and sniper, and wraps
    on the SMG and the shotgun pump. While handling a magazine or shell, it wraps whatever
    the hand holds. Working the bolt, the trigger index closes around the knob.
- **Weapon actions** (`src/game/CharacterActions.ts`):
  - Keyframes are indexed by the gameplay action's own progress and the existing cue
    fractions (`mag_out`, `mag_in`, `seatAt`, `bolt_*`, `insertAt`). They are purely
    cosmetic and cannot change timing.
  - **Rifle/SMG reload:** the well cants toward the support hand, which grips the magazine
    (`mag_grip`), presses and pulls it, stows it at the vest's front-left magazine pouch,
    brings a fresh one under the well and seats it at the gameplay seat fraction. An empty
    reload adds a bolt-release tap. The `mag` part travels with the hand.
  - **Sniper:** `cycle` and the bolt work of an empty reload move the trigger hand to the
    actual moving bolt knob. The `bolt` part rotates and travels exactly as in the
    first-person curve.
  - **Shotgun:** `cycle` strokes the `pump` part 8.5 cm with the support hand riding it.
    `shellStart`/`shell`/`shellEnd` roll the loading port toward the support hand, which
    shuttles between a belt shell pouch and the port with the loose `shell` part in hand.
    Every shell starts and ends at the pouch, so chained shells never snap.
  - Body pouches are torso-frame points relative to the chest joint, so they follow crouch,
    lean and twist.
  - ADS intent follows the presented action, so a remote player lowers the sights for a
    reload or a bolt cycle exactly as the gameplay gate does.
- **Remote recoil timing** (`src/game/RemoteTimeline.ts`):
  - Remote poses render at server time minus 100 ms. The Worker publishes a tick's `shot`
    events immediately before that tick's snapshot (`runTick` then `broadcast`, or deferred
    events then `broadcast`).
  - `ShotTimeline` therefore stamps unstamped shots with the next snapshot's server time,
    spaced at the weapon's cadence inside the tick. It releases each one when the
    interpolated render time reaches it.
  - Late shots play at once but never closer than half the cadence, a backlog older than
    600 ms is dropped, and the queue is bounded. Each shot event is presented once, and the
    client still deduplicates event IDs.
  - Without a snapshot, the arrival estimate is used.
  - `presentedAction` puts reload/pump/bolt progress on the same delayed timeline, using
    each snapshot's elapsed action time.
  - Damage, hit markers, shot audio and spectator first-person effects are not delayed.
- **Performance:**
  - World matrices are recomputed once per joint, top-down, only where a later read depends
    on them. Babylon caches world matrices per render, and the earlier per-read recursion
    cost 2 ms per character.
  - Hot paths use reusable scratch vectors and quaternions, and the saved animation pose
    reuses its quaternions.
  - Distant players reuse their last solve on skipped frames: every 2nd frame beyond 16 m,
    every 3rd beyond 32 m (`solveInterval`). Low graphics quality halves those distances.
    IK is still skipped entirely outside the frustum.

### Weapon holds

| Weapon | Ready | ADS (butt pad from the lifted right shoulder joint, torso frame) | Trigger curl (on) | Support index |
|---|---|---|---|---|
| Rifle | Low ready | 9.5 cm in, 3 cm up, 10 cm forward | -0.9, 0.9, 0.6, spread 0.2 | Along the handguard |
| SMG | High compact ready | 9.5 cm in, 3.5 cm up, 10 cm forward | -1.2, 1.0, 0.8 | Wrapped |
| Shotgun | Low ready | 9.5 cm in, 1.8 cm up, 10 cm forward | -1.2, 1.0, 0.8 | Wrapped on the pump |
| Sniper | Low ready across the body | 9.5 cm in, 3 cm up, 10 cm forward | -1.1, 0.9, 0.6, spread 0.2 | Along the fore-end |

### Measured results (character-pose lab, all four weapons)

| | Before (pass 1) | After |
|---|---|---|
| ADS trigger wrist | 41-47 degrees | 27-31 degrees |
| Ready trigger wrist | 38-48 degrees | 18-34 degrees |
| ADS butt height vs shoulder joint | +8 to +10 cm (jaw) | +0.7 to +2.9 cm (shoulder pocket) |
| Eye to sight line | (sight pinned at head joint) | 2.8-5.0 cm after the weld |
| Trigger fingertip to blade, ADS | n/a (no finger bones) | 6-8 mm |
| Hand-to-handle gap | < 0.1 mm | < 0.1 mm (and < 1 cm on moving action targets) |

### Visual inspection performed

- `node tools/character-pose-lab.mjs` (home preview scene, real GLBs) rendered every weapon
  in ready, ADS, crouch, crouched ADS, reload or bolt and shell work, firing and walking,
  from front, side and three-quarter views. Grip close-ups covered both hands.
- Six refinement iterations were judged from the renders:
  1. The first shoulder-mounted pass showed 2 cm hand gaps, caused by stale shoulder world
     matrices after the shrug.
  2. A more medial, higher pocket.
  3. Higher elbows lowered the trigger wrist.
  4. Trigger finger fitting.
  5. The magazine pouch moved from a weapon-space point (it landed at the groin) to the
     vest.
  6. A higher ready elbow.
- Final sheets: `test-results/character-poses/improved/{rifle,smg,shotgun,sniper}.png`.
- Real two-client multiplayer screenshots, including `reload.png`:
  `test-results/character-animation-mp/`.

### Performance measurements

**Node CPU benchmark.** Command: `CHARACTER_PERF=1 npx vitest run tests/characterPerf.test.ts`.
Real GLBs, NullEngine, mixed states, Node 24 on this machine. Repeated runs vary by about
±0.03 ms (thermal).

| Characters | Rig per character per frame | Whole frame (animation + rig + render) |
|---|---|---|
| 1 | 0.16-0.19 ms (includes JIT warm-up) | 0.33-0.45 ms |
| 3 | 0.12-0.17 ms | 0.72-1.0 ms |
| 6 | 0.13-0.18 ms | 1.5-2.2 ms |
| 6, distant (every 3rd frame) | 0.055-0.059 ms | 1.07-1.16 ms |

- Rig allocations fell from 29 to 9 KB per character per frame (V8 sampling heap profile);
  the remainder is mostly inside Babylon's matrix and rotation calls.
- 18 skinned meshes with six characters (3 per character).

**Real Chrome.** Command: `node tools/character-perf-test.mjs`. Home preview scene, Intel
Iris Xe, ANGLE D3D11, vsync off.

| Characters | Frame interval median / p95 | Render CPU median | Draw calls | Rig per extra character |
|---|---|---|---|---|
| 1 | 1.0 / 1.4 ms | 0.7 ms | 13 | |
| 3 | 2.4 / 4.7 ms | 1.9 ms | 35 | 0.2 ms |
| 6 | 3.9 / 7.1 ms | 3.4 ms | 72 | 0.21 ms |

**With DevTools 4x CPU throttling** (`--throttle 4`, an approximation, not a device). Six
characters: 26 ms median / 48 ms p95 frame interval and 5.7 ms of rig time, about 1.1 ms per
extra character. Most of that frame time is Babylon's render submission. These characters
stand within 16 m, so the distance reduction does not apply.

No Chromebook or other low-end device was available. Reproduce on one with:

1. Run `npm run dev`.
2. Run `node tools/character-perf-test.mjs http://<host>:5173/`, or call
   `__crossfire.characterPerf(6)` in the browser console on the home screen.

### Remaining limitations

- Only the index fingers articulate; the middle, ring and little fingers and the thumb keep
  the modelled grip, so both hands still share that curl. The SMG trigger is modelled 6.5 cm
  ahead of its grip, so its trigger pad fits only after the hand moves forward on the grip.
- The cheek weld reaches its 0.6 rad limit. The eye stays 2.8-5 cm from the sight line
  (mostly sideways, because the stock sits right of the head) rather than exactly on it.
- The shotgun's comb is only 2 cm under its sight line, so the jaw can just touch the stock.
- Reload hand paths are authored keyframes, not physically planned; the support wrist bends
  up to about 75 degrees at the vest pouch.
- The rifle and SMG empty-reload bolt-release tap is approximate, and there is no charging
  handle work.
- Recoil is quantized to the 20 Hz server tick (several shots in one tick are spaced back
  from its timestamp). Shot audio intentionally stays on arrival time, so it can lead the
  visible recoil by about the interpolation delay.
- Distant players beyond 16/32 m (8/16 m on low quality) update their arm pose every 2nd or
  3rd frame. Their body and root still animate every frame.
- No real low-end device was measured; the throttled numbers are an emulation.

## Pass 1: shared rig, hand orientation and blending

There was no sphere-hand replacement in the source or export: the gloves were always lofted
palm, finger and thumb meshes. The old problems were:

1. Remote players used `BoneIKController`, which planted the wrist in the grip with A-pose
   hand roll and fixed poles.
2. The home preview used a separate solver with a hard-coded back-of-hand constant.
3. The glove had a relaxed curl.
4. Grip anchors are palm surface points, not handle centres.

Pass 1 introduced:

- `CharacterWeapon` as the single rig for remote players and the home preview.
- Hinged two-bone `ArmChain` IK with rest axes derived from the bind pose.
- A hand turn about the handle axis.
- The gripping glove curl.
- Time-based ADS, recoil, landing and breathing layers.
- Eased per-clip crossfades in `PlayerAnimation.ts`.
- `aimIntent`, and recoil driven by `ShotResult`.
- Frustum IK culling.
- `__crossfire.characterLab`.

## Tests

- `tests/characterWeapon.test.ts` (real GLBs, NullEngine, real animation evaluation):
  - every weapon in nine stances: hand gaps, wrists, elbows, elbow side and clearance;
  - ADS checks: butt in the shoulder pocket and below the jaw, cheek weld bounded, eye near
    the sight line, trigger finger on and off, clavicle lift, ADS wrists under 35 degrees;
  - actions: each case played at real duration (reloads, sniper cycle and empty reload,
    shotgun pump, chained shells while walking or crouched), with hands on their moving
    targets, no hand jerk above 3 cm per frame squared, parts travelling, and hands back
    on their grips;
  - chained stance transitions without snapping;
  - ADS timing and recoil settle;
  - `aimIntent` with the presented action, and `solveInterval`;
  - solve reuse on skipped frames.
- `tests/remoteTimeline.test.ts`:
  - action interpolation, a newer action beginning between samples, and restarted shells;
  - shots playing at their snapshot, not on arrival;
  - cadence within a tick and across a 700 rpm burst;
  - jitter or late snapshots without stacking or replay;
  - stall drop, arrival fallback and the queue bound.
- `tests/playerAnimation.test.ts`: crouch crossfade timing, easing and normalisation.
- `node tools/character-animation-mp-test.mjs` (needs `npm.cmd run build --prefix server`).
  Two Chrome clients and a local Durable Object check:
  - remote weapons both ways;
  - ready, ADS (stock in the shoulder, eye near the sight), crouch, crouch plus ADS;
  - ten shots giving ten recoil impulses, each 3-15 ms after the rendered pose reached its
    tick and about 80-107 ms after the event arrived;
  - a remote reload with the magazine travelling and the hands rejoining their grips;
  - a remote shotgun pump stroke of 8.5 cm;
  - look pitch, run, slide, jump, and no exceptions.
- `node tools/home-hold-poses-test.mjs`: home preview, all weapons, 60 fps.
