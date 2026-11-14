# Controller support

Crossfire polls the browser Gamepad API in its existing render loop. Standard-mapped Xbox and PlayStation layouts are supported; wired/Bluetooth availability depends on the browser and OS. Press a controller button if the browser has not exposed the device yet. Use HTTPS or localhost. Unmapped controllers get a compatibility message in Settings rather than an assumed layout. One selected controller supplies gameplay input; a lost device releases inputs and pauses, and another standard device/index can reconnect without restarting.

The adapter feeds the existing `Input` action edges/holds, analog movement intent and locally owned camera angles. The shared 120 Hz controller, collision, prediction/reconciliation, input batching, protocol v28 and authoritative combat remain unchanged. There is no controller-specific simulation, speed boost, aim assist, or network message. Keyboard/mouse and controller holds are tracked separately. Semi-auto uses distinct press edges; triggers engage at 55% and release below 35%. Menu/game/focus transitions require controls to return to neutral before gameplay resumes.

Analog steering retains full input precision and uses the existing 20 Hz packet batches. Movement starts/stops, discrete keyboard direction changes, stance transitions and combat presses still flush immediately. Small stick magnitude changes do not create extra urgent packets. There are no new wire messages or server-side controller exceptions.

## Defaults

| Control | Action |
|---|---|
| Left/right sticks | Analog move / look |
| RT/R2, LT/L2 | Fire / ADS |
| A/Cross | Jump (including existing double jump) |
| B/Circle | Hold crouch when stationary; slide when moving at press |
| X/Square | Reload |
| Y/Triangle, left stick click | Next / previous weapon |
| Right stick click | Toggle dual daggers; trigger attacks |
| LB/L1, RB/R1 | Hold left / right lean |
| D-pad up | Hold grenade charge, release to throw |
| D-pad down | Hold leaderboard |
| D-pad left/right | Scoped zoom out/in |
| Menu/Options | Pause |
| View/Share + A/B/X/Y | Weapons 1–4 |
| View/Share + RB/R1 | Weapon 5 |
| View/Share + LB/L1 | Last weapon |
| View/Share + D-pad up/down | Chat / FPS display |
| View/Share + D-pad left/right | Separate slide / crouch |

There is no sprint action in the current game; full stick travel uses existing normal speed. All actions, including move/look directions, can be rebound to buttons, triggers, stick directions or View/Share chords. View/Share is reserved as the chord modifier, and Menu/Options cancels capture. The registry in `src/config/controller.ts` is the source of truth. Unbound actions display explicitly. Switching weapons follows the existing loadout restrictions: a single-gun multiplayer life does not gain extra guns. The bolt-action sniper supports adjustable magnification; the current semi-auto sniper keeps its existing iron-sight ADS.

## Settings and navigation

Settings → Controller includes connection status, horizontal/vertical degrees per second, radial left/right deadzones, ADS multiplier, invert Y, optional outer-stick acceleration and opt-in supported vibration. Bindings/sensitivity use the same Settings draft, Apply, Back/discard and localStorage persistence as existing settings. Keyboard bindings, audio and graphics stay independent. Rebind waits for a new input; Menu/Options cancels capture. Escape or the Cancel binding button also cancels. A conflicting control offers **Swap bindings** or Cancel. Reset controller defaults affects only the controller draft. Apply saves it. Browser storage failures retain session settings.

Menu controls are fixed, independent of gameplay bindings: D-pad/left stick navigates visible controls in document order; A/Cross confirms; B/Circle goes Back; bumpers change tabs. Left/right adjusts ranges, magnetic sliders and dropdowns; up/down leaves a closed dropdown or selects inside an open one. Focus scrolls into view. Hold navigation repeats after 350 ms, at 130 ms intervals. Right stick orbits the Locker item preview. Text fields use browser text entry: focus the field and use the OS/browser keyboard. Desktop browsers do not universally provide a controller-operated on-screen keyboard. Fixed menu controls cannot be rebound away. Input capture suppresses ordinary navigation until complete/cancelled.

Prompts change after actual controller versus mouse/keyboard activity. Identifiable Xbox/Sony IDs use their labels; unknown standard controllers use button numbers. No extra aim correction is enabled. Optional short vibration uses confirmed firearm hits, respects the vibration setting and safely tolerates unsupported devices.

Menu/Options always pauses gameplay, including after the custom Pause binding is cleared or reassigned. It remains a fixed escape route, just as menu Confirm/Back do. Modifier changes cannot manufacture a second trigger pull while the physical trigger remains held. Disconnect events are handled immediately as well as through polling, including a device reconnecting between frames or a different standard device reusing an index.

## Verification and manual hardware checklist

Automated inputs are mocked, not physical controllers. `tests/controller.test.ts` covers adapter lifecycle, radial drift/diagonal behavior, sensitivity/frame rates, trigger hysteresis with the real semi-auto Weapon, utility-modifier changes while firing, hold/release actions, bindings/conflicts/persistence/reset, multiple devices, focus loss, context cleanup and input-method changes. `node tools/controller-browser-test.mjs http://127.0.0.1:4255/ --extended` exercises actual local Crossfire UI and WebGL with a simulated standard Gamepad API; start Vite on that port first. It also accepts a production-preview URL. The browser fixture blocks public requests; it does not fabricate inventory, rankings or multiplayer connections. See the newest PROGRESS entry for actual completed run results.

The first incomplete browser attempts exposed a real Back-navigation bug: an inline Cancel binding button was selected instead of the page's Back action, while the home background stayed visible underneath Settings. The fixture now checks the active screen, and navigation prioritizes page Back/Resume/Return actions. Later fixture assertions were updated to wait for the sniper bolt cycle before reloading, and to test zoom only on a weapon that actually has a scope. No weapon mechanics were changed to satisfy these tests.

The backend combat fixture also still searched for Town with a fixed four-transition limit. Five-map shuffled rotation can require eight transitions from the starting round. It now uses the shared map count, searches a bounded two-bag window, and asserts the intended map before placing its existing combat arena. A 100-seed/all-offset regression covers this bound. Combat, score and protocol assertions remain intact.

## Implementation files

- Configuration/persistence: `src/config/controller.ts`, `src/config/settings.ts`.
- Existing input/game integration: `src/core/Input.ts`, new `src/core/Controller.ts`, `src/game/Game.ts`, `src/network/MultiplayerClient.ts` (analog batching).
- Settings/navigation/focus: new `src/ui/ControllerSettings.ts`, new `src/ui/ControllerMenu.ts`, `src/ui/UI.ts`, `src/styles.css`.
- Existing Locker preview orbit: `src/ui/CosmeticPreview.ts`, `src/ui/CosmeticsPages.ts`.
- Verification: `tests/controller.test.ts`, `tests/multiplayerTransport.test.ts`, `tests/rotation.test.ts`, `server/tests/combat.mjs`, `tools/controller-browser-test.mjs`.
- Documentation: this file and `PROGRESS.md`. Existing Neon/map work is preserved separately.

Before a release, test a physical Xbox and PlayStation controller on Windows and a supported controller on ChromeOS, each wired and Bluetooth where available:

1. Press a button to expose the controller. Check status and labels; unplug/reconnect, including changing device index. Verify pause and no stuck fire/movement; release controls, then Resume.
2. At 60, 30 and 20 FPS, move slowly/diagonally, jump/double-jump onto platforms, crouch/slide and lean near walls. Compare speed/collision with keyboard. Test two real online clients and confirm authoritative movement stays synchronized.
3. Try each of the five guns: automatic hold versus distinct semi-auto presses, ADS, both sniper zoom directions, reload/cancellation, weapon switching, grenade hold/release and daggers. Confirm normal recoil and no aim drift after reconnect/snapshots.
4. Use every menu, including server browser, room creation/lobby, Shop, Locker orbit, leaderboards, results and respawn. Check text entry with the device's OS keyboard. Verify visible focus and scroll access at small resolutions.
5. Rebind button/trigger/stick/chord inputs; swap a conflict, cancel capture, reset and Apply. Reload the page and check persistence. Back must discard unapplied changes. Fixed navigation must remain usable.
6. Change sensitivities/deadzones/ADS/inversion, check drift and precise aiming; test optional vibration. Switch to mouse/keyboard, back to controller, and blur/refocus the tab while moving/firing/charging a grenade.

No backend/protocol migration is needed for this frontend feature. This work does not deploy anything. Physical hardware, OS virtual-keyboard behavior and public multiplayer controller play require manual validation.
