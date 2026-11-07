# UI animation and interaction polish

For the current compact shared header, borderless navigation, Locker category
overshoot, themed scrollbars and Practice magnetic slider, see
[MENU_HEADER_SLIDER.md](MENU_HEADER_SLIDER.md). The shared motion system described
below remains in use; the newer menu stylesheet loads after it.

Implemented locally 2026-11-06. No commit, push or deployment.

## Shared behavior

`src/ui/motion.css` loads after the established theme in `src/main.ts`.
It defines shared hover (160 ms), press (90 ms), selection (190 ms), panel-open
(250 ms), close (180 ms) and page (260 ms) timings and a restrained ease-out curve.
Buttons scale to 1.02 on hover and .98 while pressed; disabled controls cancel
interactive transitions. Existing primary-blue, leave-red, gray secondary and
rarity colors remain in their existing styles. Selected states and keyboard focus
remain distinct from hover. Transforms do not change grid dimensions.

Screens fade both ways with CSS `display` discrete transitions and
`@starting-style`. Small content movement leaves backgrounds, the character and
persistent home navigation in place. `screenVisibility()` in `motion.ts` changes
the real screen state, `inert` and `aria-hidden` immediately. No timers, cloned
screens, delayed click callbacks or animation-end navigation can race a later
navigation request. Intentional background screens (home behind Settings, HUD
behind Pause) remain visually present but inert. Focus moves off outgoing screens.

The shared layer covers Home, modes/public rooms, private join and guest dialogs,
Create Server, Practice, Shop, Locker, cosmetic preview, Settings and its tabs,
leaderboards/My Stats, weapons, loading, Pause, spectating, results and errors.
It also covers dropdowns, inputs, sliders, switches, checkbox feedback, card grids,
keybinding controls, notifications and scoreboard/chat panels. Settings content
crossfades in one grid cell without moving its footer; the category list scrolls
independently on short screens. Native dialogs retain native modal focus behavior.
The existing crate overlay now wraps Tab/Shift+Tab within its enabled controls,
restores its opener, inerts closing controls and guards its opening RAF from
running after cancellation. Its established reward animation remains intact.

Settings confirmation and successful room-code copy have understated feedback.
Ammo and weapon-name changes use bounded, restartable opacity feedback on the
updated text; values are never interpolated or delayed. The health bar follows
the new HP over 120 ms, with the numeric HP immediately accurate. Existing kill,
assist, countdown and gem animations remain. The combat HUD itself appears
immediately, rather than fading essential combat information in.

Chromebook Mode follows the saved setting live: shorter transitions, no page
travel, smaller hover scaling, no button brightness filters or home-image breathing.
Reduced motion removes movement/decorative animations while retaining screen and
popup fades and clear selected/focus states. No additional WebGL effects or JS
animation loops were introduced.

## Verification

```powershell
npm.cmd test -- --maxWorkers=2
npm.cmd run build
node --test server/tests/protocol.mjs
```

Frontend: **674 passed, 1 existing skip**. Build includes `tsc --noEmit` and passed.
Protocol: **1 passed**, exercising the actual frontend transport and local Worker.
This UI task did not modify gameplay, protocol schemas or backend deployment.

Browser checks use installed Chrome and the real local Durable Object harness;
the harness starts its own temporary backend. For development:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 4201 --strictPort
# Another PowerShell terminal:
node tools/ui-motion-browser-test.mjs http://127.0.0.1:4201/
```

Production GitHub Pages subpath:

```powershell
npm.cmd run build
node tools/serve-dist.mjs --port 4200 --base /crossfire/
# Another PowerShell terminal:
node tools/ui-motion-browser-test.mjs http://127.0.0.1:4200/crossfire/
node tools/crate-browser-test.mjs http://127.0.0.1:4200/crossfire/ --only reveal
```

UI browser runs passed **29 development checks** and **28 production checks**.
The UI tool checks actual hover/press scales, CSS close interpolation, inertness,
header stability, grid measurements, persistent selection, dropdown keyboard input,
Apply, live Chromebook switching, 640x480 Controls/category access, My Stats focus,
24 rapid page changes, reduced motion, a real public-room listing, native modal
focus/Escape, all four weapon cards, local Practice spawn, Pause/Settings and
immediate HUD visibility. Development additionally finishes the actual local
Practice simulation and verifies its unsaved results. The crate suite passed
**25 checks**, including its real grant, exact 300-gem charge, equip, drag/spring,
small-screen layout and added keyboard wrap/restore checks.

Logs/screenshots/reports: `test-results/ui-motion-*`,
`test-results/ui-motion-browser-{dev,production}/`, and `test-results/crate-browser/`.
Screenshots of major menus were actually inspected, including short-screen
Controls, Locker, the private dialog, weapons and the crate hero view.

## Limits and release

Browsers without CSS discrete display-transition support hide closing panels
immediately; their controls and navigation still function. Native OS/browser popup
and checkbox internals retain platform behavior. No physical Chromebook performance
benchmark, other-browser visual run or public Cloudflare test was performed.
Chromebook/reduced-motion behavior was verified in Chrome. Only the frontend needs
publishing for this UI change; no Worker redeployment or protocol bump is required.
Existing unrelated uncommitted work remains in place. Nothing was deployed.
