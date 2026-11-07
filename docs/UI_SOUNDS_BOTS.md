# UI sounds, magnetic ranges and Practice bots

`UISounds` delegates body-level button/option/summary entry and activation,
including dynamically created screens and the crate overlay. Nested children
do not retrigger entry; disabled/inert/hidden controls stay quiet. Dropdowns
emit `ui-activate` for their non-click mouse/keyboard choices. UI's old per-button
sound call is removed, so navigation plays one click. Audio unlocks only on a
trusted user gesture; pre-unlock hover is silent.

`AudioManager.playUI` creates and caches warm 45 ms hover/tick and 55 ms deeper
click buffers, through the existing SFX/compressor/master chain. No download is
needed for the first click. Hover uses five gentle ascending pitch steps with
tiny variation, resetting after 500 ms. A 25 ms hover/tick guard and maximum three
voices prevent buildup. Existing WAV assets and world/combat audio are retained.

`MagneticSlider` takes `{min,max,step,value,label,ariaLabel,onChange}`. Its spring
works in stop indices, then converts to actual values, preserving velocity and
hysteresis at any configured range. Native range semantics handle keyboard input;
pointer capture handles mouse/touch. `magnetic-snap` bubbles only when the selected
stop changes, never from visual animation. Initialization and `setValue` are silent.
Practice uses 0–5; Create Server uses shared `ROOM_LIMITS` (2–10, default 6).

Intermediate joins the existing AI state machine: 600 ms reaction, ±2.8 degree
aim error, 82% movement speed, 5.5 s slide attempt interval, limited cover and
low-health retreat. Its pursuit memory and firing pauses sit between Beginner
and Advanced. Advanced/Absurd combat parameter values are unchanged. The optional
`crossfire.practice-difficulty` preference survives refresh, tolerates unavailable
storage and falls back to Advanced. It stores no statistics or rewards.

Bot grenade opportunities are checked at most once per second when eligible:

| Difficulty | Chance | Minimum interval between own attempts |
|---|---:|---:|
| Beginner | 2.5% | 24 s |
| Intermediate | 7% | 18 s |
| Advanced | 14% | 14 s |
| Absurd | 24% | 11 s |

These are configurable in `BOT_GRENADES`. The local simulation reserves starts
at least 3.5 s apart across all bots. A visible, living opponent 6–20 m away,
inventory, an idle gun, grounded/non-sliding posture and hidden daggers are required.
The planner rejects solid-wall LOS and checks a low ballistic arc with the real
swept-sphere collision primitive. Bots hold/release normal grenade input, pause
gun fire/movement while charging and cancel if the target/path becomes invalid.
Actual charge, inventory consumption, launch, inheritance, bounces, fuse, damage,
team rules, owner immunity, legitimate elimination inventory rewards, audio and
VFX remain in the existing local Practice pipeline. No new repeating timers or
network messages are introduced. No online profile/reward adapter is added.

Validation commands (PowerShell):

```powershell
npx.cmd vitest run tests/uiSounds.test.ts tests/magneticSlider.test.ts tests/practice.test.ts
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
# Separate terminal, after building:
node tools/serve-dist.mjs --port 4200 --base /crossfire/
node tools/ui-sounds-bots-browser-test.mjs http://127.0.0.1:4200/crossfire/
node tools/practice-browser-test.mjs --production http://127.0.0.1:4200/crossfire/
node tools/practice-browser-test.mjs --production --chromebook http://127.0.0.1:4200/crossfire/
```

Browser reports/screenshots are under ignored `test-results/`. Chrome Web Audio
was exercised, but subjective sound quality still benefits from listening on
different speakers. Chromebook mode was tested on this Windows Chrome machine,
not physical Chromebook hardware. Public multiplayer was not exercised or
deployed; this task changes neither Worker code nor the shared wire protocol.
