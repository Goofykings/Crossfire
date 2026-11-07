# Weapon balance and adjustable sniper zoom

The existing `src/weapons/Weapon.ts` remains the shared source imported by the
frontend, Worker and local Practice authority. No models, skin assets, ownership
rules, difficulty tuning or hosting settings are replaced.

| Weapon | Magazine | RPM / minimum trigger interval | Close body damage | Other final tuning |
|---|---:|---:|---|---|
| AR | 30 | 630 / 95.238 ms | Authority rolls 20, 21 or 22 per bullet hit | Exactly 0.90 × previous 700 RPM; existing recoil, range and 35–90 m / 0.75 falloff retained |
| SMG | 64 | 1122.7 / 53.443 ms | 11 | Exactly 1.09 × previous 1030 RPM; original recoil, 140 m range and 15–55 m / 0.55 falloff retained |
| Shotgun | 2 | 240 / 250 ms | 14 per pellet, 14 pellets | 220 ms between-shot pump; hip pellet cone 7°, ADS cone 3.85°; falloff 12–44 m to 0.18; range 80 m |
| Sniper | 4 | 50 / 1200 ms | 75 | Existing 1050 ms bolt; camera kick 5.2° tuning input, view kick 26; ADS duration 224 ms |

Actual cooldowns carry the fractional fixed-tick overshoot into a shot instead
of rounding every interval upward to the next physics tick. Public state remains
nonnegative and replayable. No extra catch-up shots are generated.

AR rolls happen in shared authoritative hitscan only after an unobstructed player
intersection. Worker randomness is server-controlled; Practice supplies its seeded
generator. `DamageSystem` still applies the existing 1.5× head multiplier after
range falloff. Applied amounts, health, elimination and scoring use that same roll.
SMG explicitly clears the inherited AR roll setting. Displayed base AR damage is
the average 21; actual confirmed amounts may differ by roll, falloff and hit zone.

Shotgun ADS interpolates its pellet cone from 7° to 3.85° (55% of hip). The center
aim cone stays 0.7° hip / 0.55° ADS, so total stationary aimed spread is about 57%
of hip. Worker and Practice pass the simulated gun ADS blend into the resolver;
clients cannot submit ADS state, spread, damage or a hit target. Hip spread and
pellet damage are unchanged. Falloff distances double; distant pellet registration
still becomes unreliable. Shotgun ADS FOV scale changes 0.88 → 0.82, and the real
sight anchor moves 4 cm closer to the eye for a larger picture. Existing pump
cue fractions follow the shortened between-shot cycle. Shell reload timing
(450 ms start, 500 ms per shell, 400 ms end) and the 600 ms empty-reload chambering
stroke are explicitly preserved through `emptyReloadCycleTime`.

## Sniper camera and wheel routing

Default magnification is 18% lower than the old 1/0.22 FOV-ratio magnification:
approximately **3.73×**, with FOV scale `0.22 / 0.82`. The range is approximately
**2.95×–4.55×**, keeping the previous upper limit. `SNIPER_ZOOM` configures limits,
0.25× wheel steps and smoothing. A small scope indicator shows current zoom.
Zoom is local presentation and does not change accuracy, damage, ray direction or
server hit detection. It resets with the existing camera/spawn reset.

Input offers a wheel-consumption hook before ordinary weapon cycling. While the
sniper scope is active, up increases zoom and down reduces it; other weapon keys
remain independent. Inactive/menu input does not consume wheel events. Magnification
and FOV interpolate smoothly; the existing scope rendering stays centered.

Sniper camera recoil uses the existing recovering spring and yaw decay, with no
permanent controller aim contribution. Its kick is not reduced by the old scoped
recoil damping. The real gun model also receives a stronger WeaponMotion impulse.
Other weapon recoil behavior is retained. ADS entry/exit blend time is 20% shorter
than 280 ms. Practice bots use the same ammo, action, rate, ADS and damage state
machines; their Beginner/Intermediate/Advanced/Absurd tuning is unchanged.

## Protocol and release

Protocol is **v21**, advanced because v20's decoder rejects magazines above 32.
Gun snapshot validation derives the maximum from the shared weapon configuration;
it does not weaken client input validation or accept a client-supplied gun state.
The actual frontend/Worker integration gate includes an SMG spawn with 64 rounds.
Both frontend/assets and Worker need a matching authorized release through the
existing backend-first workflow. No URL, env file, credentials, Durable Object
migration or Pages base-path changes. Nothing is committed, pushed or deployed.

## Checks

```powershell
npm.cmd test -- --maxWorkers=2
npx.cmd vitest run tests/weaponBalance.test.ts tests/weapon.test.ts tests/damage.test.ts tests/combat.test.ts tests/cameraMotion.test.ts
npm.cmd run typecheck
npm.cmd run build
npm.cmd run typecheck --prefix server
npm.cmd run build --prefix server
node --test --test-concurrency=1 server/tests/weapon-balance.mjs server/tests/combat.mjs server/tests/assists.mjs server/tests/melee.mjs server/tests/protocol.mjs server/tests/match-rewards.mjs
npm.cmd run test:deployment
# Separate terminal after building:
node tools/serve-dist.mjs --port 4200 --base /crossfire/
node tools/weapon-balance-browser-test.mjs http://127.0.0.1:4200/crossfire/
```

Tests retain fixed damage/rate assertions for fixed weapons, accept only legal
AR rolls and correlate health/scoring with each confirmed amount. Assist fixtures
use two real AR bullets where one old 25-damage bullet plus a 75-damage sniper
body hit previously eliminated; the second waits for acknowledged cooldown state.
The resume combo test allows either legal continuation or expiry rather than
predicting a 350 ms server gate from a potentially stale snapshot.

Browser results are real local Practice gameplay; Worker tests use real workerd
and WebSockets. Public Cloudflare, Internet latency and physical-device performance
are not validated by these checks. Scope zoom is intentionally not transmitted to
spectators; spectator view retains the weapon's new default magnification.
