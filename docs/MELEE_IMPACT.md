# Confirmed dagger impact feedback

This builds on Claude's 250/250/400 ms clips and existing limp-joint death pass.
Damage (35), range, cone, contact/chain windows, combo reset, scoring and weapon
switching are unchanged. No new wire fields or protocol version change.

## Authority and collision

`shared/melee.ts` exposes `MELEE_IMPACT` and `meleeKnockback`. Only successful
positive-damage contacts in the Worker and local Practice simulation call it.
Horizontal attack direction is normalized; first/second contacts add 1.4 m/s,
third adds 3.1 m/s, with total horizontal speed capped at 8 m/s. A grounded target
receives a small 0.8 m/s lift so ordinary ground deceleration does not immediately
erase the impulse. Sliding cancels through the existing cooldown. Controller
substeps, walls, floors, gravity, authoritative snapshots and reconciliation handle
motion; there is no position teleport or client-provided impulse field.

## Camera, timing and audio

`MeleeImpact` adds only finite optical roll to PlayerCamera. Configurable stages
last 100/100/180 ms, alternate left/right, and use a stronger two-direction third
response. Recovery is exactly zero after the duration. New hits replace rather
than add impulses. Mouse/controller yaw, pitch, aim angles and the forward shot
axis never change. Existing reduced-motion handling suppresses the roll, and
camera reset clears it.

Per-session `MeleeFeedback` deduplicates event IDs with a bounded 256-entry set.
Wrong-round/unready events are ignored; feedback arriving after the attack's
remaining animation duration is discarded. Positive authoritative hit amounts
gate impact sound, hit marker and attacker camera feedback. Misses retain only
the swoosh. Local swings remain driven by authoritative/predicted stage timing,
with the existing contact-minus-50-ms cue and a new clip-end guard. Remote
contacts use the existing spatial source path. Idle flourishes keep their separate
quiet twirl cue and cannot trigger impacts, attacks or damage.

`tools/generate-melee-impact-audio.py` deterministically generates original,
non-graphic sounds: similar 110/115 ms swooshes for stages 1/2, a deeper layered
170 ms finisher and a dry 65 ms impact. Normal master/SFX settings, shared limiter,
spatial attenuation and spatial voice budgets apply. No external samples.

## Third-hit elimination

The existing confirmed stage-3 event identifies the killed victim/life.
RemotePlayers correlates it with elimination, in either arrival order, without
changing the protocol. It gives DeathMotion a once-only +1.8 m/s horizontal and
+0.3 m/s vertical visual boost within the first 200 ms. The existing three-sphere
sweep, wall-aware fall direction and floor collision still control the root.
Claude's captureDeath/poseDeath/LimpBody joint relaxation is preserved. Late or
duplicate events cannot kick a settled corpse; the correlation cache is bounded
and cleared with remote players. Practice uses exactly the same presentation.

## Checks and release

Files for this follow-up: `shared/melee.ts`, `server/src/index.ts`,
`src/practice/PracticeSimulation.ts`, `src/player/PlayerCamera.ts`, new
`src/player/MeleeImpact.ts`, new `src/game/melee/MeleeFeedback.ts`,
`src/game/Game.ts`, `src/game/RemotePlayers.ts`, `src/game/DeathMotion.ts`,
`src/audio/AudioManager.ts`, three existing swing WAVs and new `melee_impact.wav`.
Regression coverage is in new `tests/meleeImpact.test.ts`, camera tests, Worker
melee tests/fixture and the existing two-client melee browser tool. The audio
generator, this guide, MELEE_GAMEPLAY.md, CLAUDE.md and PROGRESS.md document it.
Earlier animation/model/LimpBody changes in the working tree are preserved.

```powershell
npx.cmd vitest run tests/meleeImpact.test.ts tests/meleeCombat.test.ts tests/cameraMotion.test.ts tests/deathMotion.test.ts tests/limpBody.test.ts
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run typecheck --prefix server
npm.cmd run build --prefix server
node --test --test-concurrency=1 server/tests/melee.mjs server/tests/combat.mjs server/tests/grenades.mjs server/tests/protocol.mjs
# Separate terminal after build:
node tools/serve-dist.mjs --port 4200 --base /crossfire/
node tools/melee-gameplay-browser-test.mjs http://127.0.0.1:4200/crossfire/
```

The backend motion regression asks the real-map fixture for explicit free space
behind the victim. A valid melee position can otherwise have a wall immediately
behind it, where correctly blocked knockback produces no displacement.

Both frontend/assets and Worker need an authorized release to deliver all of this
update. Protocol remains v20; no migration or deployment configuration changes.
Local workerd/Chrome results do not validate the public Cloudflare service or
Internet latency. Expired contacts intentionally produce no delayed cosmetic
impact, and a newly connected spectator cannot recover a finisher stage from an
old elimination alone. Existing limp limbs still have no individual floor
colliders; the collision-safe root approximation is unchanged. Speaker/device
sound quality has not been subjectively certified.
