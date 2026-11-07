# Unified menu header and magnetic bot slider

The existing `.home-header` in `UI` remains one mounted element shared by Play,
Shop, Locker, home Settings and Leaderboard. The real `ChallengesPanel.account`
node now lives inside it; the career client still owns its username and gem data.
There is no second balance, request loop or replacement account store.

The header has a shorter logo row, reduced spacing, unchanged 15.4 px navigation
text, borderless selection backgrounds, and one translucent fading gradient.
Upward Play glows are removed. Existing scale overshoot, compression and keyboard
focus remain, with the same interaction applied to Locker categories.

On narrow windows the five tabs stay in a horizontal scrollable row with full-size
text. Selecting a tab scrolls it into view. Account information stays above that
row at the right. Header dimensions and nodes do not change between pages.
Leaderboard no longer has its own inset dark header layer. Shop, Locker and
Leaderboard use navigation rather than redundant Back buttons; the item preview,
Settings, Practice and other contextual Back actions remain.

`src/ui/menu.css` owns these focused layout overrides and the themed scrollbars.
Real scroll panels retain `overflow:auto`. Padding around animated controls keeps
their scale/focus effects inside scroll bounds; no blanket overflow suppression
is added. Practice uses a constrained grid so long option labels cannot force the
slider or action buttons outside a narrow viewport.

## Magnetic slider

`MagneticSlider.ts` combines a native integer range input (keyboard semantics and
accessible value) with a custom track, visual thumb, 0–5 labels and visible count.
The native input is visually transparent, not disabled or removed from tab order.
Mouse/touch use Pointer Events and capture on the wrapper.

`MagneticStops` is the pure presentation model. Pointer position and velocity
drive a resistant attraction to the selected integer. A 0.6-step hysteresis
threshold avoids adjacent-selection flicker. Fast drags blend toward the raw
pointer and can skip magnets. Release chooses the nearest integer. A bounded,
substepped damped spring settles the visible thumb with mild overshoot.
Only the integer selection reaches `PracticeSetup.bots`; presentation coordinates
are never used as game counts.

Animation frames run only while the thumb is moving and stop when settled. Reduced
motion uses direct snapping. Pointer cancel, lost capture, focus/window blur and
page navigation release capture and stop animation. `dispose` also removes the
media/blur listeners. Scrollbars use ordinary scrolling, never the magnetic model.

## Verification

```powershell
npm.cmd test -- --maxWorkers=2
npm.cmd run typecheck
npm.cmd run build
node tools/serve-dist.mjs --port 4200 --base /crossfire/
# In another terminal (local Chrome required):
node tools/menu-header-browser-test.mjs http://127.0.0.1:4200/crossfire/
node tools/ui-motion-browser-test.mjs http://127.0.0.1:4200/crossfire/
node tools/home-locker-browser-test.mjs http://127.0.0.1:4200/crossfire/
node tools/cosmetics-browser-test.mjs http://127.0.0.1:4200/crossfire/
```

The browser scripts use the real local Worker and account/inventory APIs. They do
not inject fake player balances. Isolated local QA ranking fixtures populate ten
rows so wheel scrolling is tested against actual API results, not an empty table;
these records never reach public services or shipped data. The new menu script checks six viewports from
1920×1080 to 390×700, header identity/geometry, account visibility, selection,
content clearance, overshoot, scroll bounds and real mouse/keyboard/touch slider
input. Existing UI scripts retain navigation, Settings, inventory, Practice and
focus coverage. Assertions expecting the former glow/Back button and four starter
items were updated to the requested design and the existing fifth melee starter.

Screenshots/reports are under `test-results/menu-header-browser/`,
`test-results/ui-motion-browser-production/` and
`test-results/home-locker-production/`, plus `test-results/cosmetics-browser/`.
See the newest `PROGRESS.md` entry for the
actual final test results. Chrome emulation checks layout and touch input; it is
not a physical Chromebook/touch-device or Firefox performance certification.

This update changes no combat, protocol, backend configuration or purchases. The
existing melee protocol v20 requirements still apply to that earlier work. No
commit, push or deployment is part of this UI task.
