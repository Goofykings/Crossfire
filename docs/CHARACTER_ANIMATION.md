# Third-person weapon rig and animation blending

Completed locally 2026-11-03. No protocol, server, gameplay, collision or damage change.
No commit, push or deployment.

## Root cause of the old hand problems

There was no sphere-hand replacement in the source or export: the gloves were always
lofted palm, finger and thumb meshes (`char_geometry.py`). What looked like blobs came from
three real defects:

1. **Remote players** used Babylon `BoneIKController` aimed at the grip node. It planted the
   *wrist* inside the grip, left the hand bone at its A-pose roll (palms toward the thighs,
   fingers through the weapon) and used fixed poles that ignored crouch and slide.
2. **The home preview** used a separate analytic solver and pose table. Its back-of-hand
   vector was a hard-coded constant (`HAND_BACK_X/Z`), and its own test measured with the
   same constant, so a wrong orientation could not fail. Swing-only rotations also left the
   upper-arm/forearm twist uncontrolled.
3. **The glove itself** had a relaxed 65-degree finger curl, so nothing wrapped a handle.
   The weapons' `grip_r`/`grip_l` anchors are palm *contact points on the surface* (the rifle
   `grip_l` is 8 mm below its fore-end), not handle centres, which the old offsets ignored.

## What changed

- `blender/characters/char_geometry.py`: gripping finger curl (0.86/0.98/0.72 rad per joint)
  and an opposed thumb. The loop encloses a ~3 cm handle 8 cm along the hand and 4.2 cm
  toward the palm. Same vertex/triangle counts; regenerated with `npm.cmd run assets:player`.
- `src/game/CharacterWeapon.ts` is the single rig for remote players and the home preview:
  - `ArmChain`: hinged two-bone IK. Rest axes are derived from the exported bind pose
    (`Bone.getRestMatrix()` chain) and the A-pose definition, verified at runtime to equal
    each bone's local +Y. The upper arm and forearm share the elbow flexion axis, so the
    forearm never rolls through the elbow. Wrist placed from the measured glove loop.
  - Hands turn about their handle axis (up to 0.9 rad, eased) toward the forearm so the
    wrist stays straight while the fingers keep wrapping the grip.
  - `WEAPON_HOLDS`: per-weapon ready and ADS placements, measured handle offsets and palm
    depths, elbow pole hints, torso blade twist and recoil strength.
  - Ready pivots around the shoulders; ADS is anchored to the head joint and follows the
    full look pitch, so the sight stays at the eye (cheek weld) when crouched, leaning or
    aiming up/down. The torso distributes pitch (spine 0.18, chest 0.2, head 0.62).
  - Overreach safety pulls the weapon toward the shoulders instead of detaching a hand.
  - Layers blended by elapsed time: locomotion clip, look pitch, ADS (third-order follower,
    95% in ~150 ms with a gentle start), recoil (`DampedSpring` per weapon), landing dip and
    breathing sway (reduced in ADS).
- `src/game/PlayerAnimation.ts`: crossfades last a per-clip duration (`CLIP_FADE`, crouch
  0.19 s) by elapsed time, with smoothstep-eased, normalised weights (no velocity jump at
  the start or end of a stance change, never blended toward the rest pose).
- `src/game/RemotePlayers.ts`: ADS intent mirrors `Weapon.update`'s gate from synchronized
  `aimHeld` + action (`aimIntent`), airborne from motion, recoil from each server-confirmed
  `ShotResult` (`RemotePlayers.fire`). IK is skipped for avatars outside the frustum; their
  blend state still advances.
- `src/ui/HomeCharacter.ts`: drops its private pose table and drives the shared rig.
  `__crossfire.characterLab(options)` poses the isolated preview deterministically for
  visual inspection (weapon, ADS, pitch, motion, fire, orbit camera, grip focus).

## Weapon holds

| Weapon | Ready | ADS | Recoil (kick m / rise rad) |
|---|---|---|---|
| Rifle | Low ready, muzzle forward-left and slightly down | Stock at cheek, support hand 7 cm back on the fore-end | 0.035 / 0.06 |
| SMG | High compact ready, muzzle slightly up (pose reference) | Held out at the eye, short stock | 0.025 / 0.045 |
| Shotgun | Low ready like the rifle | Support hand on the rear of the pump | 0.06 / 0.13 |
| Sniper | Low ready across the body (pose reference) | Scope at eye, support hand 12 cm back | 0.07 / 0.15 |

The AR/shotgun lobby references show a one-handed, muzzle-up shoulder carry. The brief
requires two-handed support with one shared pose system, so the home preview uses each
weapon's two-handed ready hold instead.

## Verification

- `tests/characterWeapon.test.ts` (real GLBs, NullEngine, real animation evaluation): bind
  axes; every weapon in ready, ADS, crouch, crouch+ADS, look up/down, run, slide and
  airborne keeps both handles enclosed (< 1 cm), wrists < 55 deg, elbows < 140 deg, outside and
  below the shoulders; ADS sight at the eye line; twelve chained transitions with hand gap
  < 0.1 mm and bounded per-frame displacement change (no pops); ADS 95% within 0.1-0.19 s;
  recoil kicks and settles; ADS intent matches the weapon gate.
- `tests/playerAnimation.test.ts`: crouch crossfade 0.17-0.22 s, eased and normalised.
- `node tools/character-pose-lab.mjs [url]`: contact sheets (front/side/quarter/rear and
  grip close-ups) in `test-results/character-poses/`; used for three refinement passes.
- `node tools/home-hold-poses-test.mjs`: home preview for all weapons, name, framing,
  mouse-follow, 60 fps.
- `node tools/character-animation-mp-test.mjs` (after `npm.cmd run build --prefix server`):
  two Chrome clients and a local Durable Object; remote weapon both ways, ADS, crouch,
  crouch+ADS, ten shots giving ten recoil impulses (magazine 30 to 20), pitch, run, slide,
  jump; observer screenshots in `test-results/character-animation-mp/`.

## Limitations

- Fingers are baked into the hand mesh; there are no finger bones, so the trigger finger
  does not move and both hands share one grip curl.
- No clavicle bone: shoulders do not shrug; a bladed torso twist supplies support reach.
- The third-person stocks are short at 0.85 scale, so the trigger wrist keeps ~45 deg of
  ulnar deviation in ADS and the stock rests at the jaw (cheek weld) rather than low on the
  shoulder pocket.
- The left hand is not regripped for reloads or pump/bolt cycling in third person.
- Remote recoil is driven by shot events, which can arrive up to the 100 ms interpolation
  delay ahead of the rendered pose.
- Local Chrome/workerd validation only; low-end device performance not measured
  (about 0.14 ms CPU per visible avatar per frame in Node).
