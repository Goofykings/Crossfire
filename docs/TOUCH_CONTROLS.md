# Mobile and touch controls

Touch is an input adapter to the existing `Input`, player simulation, weapon actions and multiplayer input frames. It does not add physics, combat rules, sockets or a protocol version. Keyboard/mouse and standard gamepads remain available.

## Controls

- Bottom left: enlarged analog movement joystick with bounded elastic stretch and a smooth return on release. Presentation never changes the capped movement input; releasing stops movement immediately. Reduced-motion preferences disable animation. Drag the empty right gameplay area to look. These use independent pointer IDs.
- Bottom right: enlarged Fire; held Slide immediately beside it; Aim and Jump above. Tap Aim to toggle ADS. Semi-automatic guns require a new press for another shot.
- Top right: Pause and More. More contains Reload, Next weapon, held Crouch, held/released Grenade, dagger toggle, held left/right Lean, held Scores, Chat and scope zoom. Secondary buttons have 48px targets.
- Online loadouts still follow server rules. Next weapon does not grant weapons the current match does not allow. Chat still requires a connected multiplayer match.

Settings → Touch offers Automatic/Enabled/Disabled, look sensitivity, ADS multiplier, joystick size/deadzone and button size/opacity. Apply uses the normal settings draft and localStorage persistence; Back discards changes. Changes do not require a restart. Saved graphics, audio, keyboard and controller settings are preserved. Graphics are not forcibly changed on mobile; lower graphics or Chromebook mode remain optional.

## Input switching and cleanup

Automatic defaults to touch only when the browser reports touch points and a primary coarse pointer. A touchscreen laptop with a primary fine pointer stays on desktop until the game is touched. Physical keys (excluding modifier-only and browser shortcut combinations), physical mouse Pointer Events, or gamepad activity select their input method. Untrusted mouse events and browser touch-compatibility mouse events do not select the mouse method. There is no timing delay that blocks a real mouse immediately after touch.

Touch gameplay does not require pointer lock. Noninteractive HUD surfaces count as gameplay for touch activation and look. Buttons do not initiate camera drags. Pointer capture, pointerup/cancel/lost capture, blur, visibility, resize/orientation, pause/chat, life changes and leaving clear virtual actions. Weapon/dagger changes reset toggle ADS. The overlay is mounted once; no listeners are added on respawn. It has native touch actions disabled only on gameplay controls/canvas, leaving menu scroll containers usable.

Gameplay gesture ownership survives a screen transition until finger-up, suppressing its compatibility click. In particular, releasing Fire after being eliminated cannot click a spectating-menu button that appeared under the finger. The next fresh menu tap works normally. Joystick and primary button sizes are bounded by viewport dimensions so large saved sizes fit small screens.

## Local verification

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 4262 --strictPort
# In a second PowerShell window:
node tools/touch-browser-test.mjs http://127.0.0.1:4262/ --extended
node tools/touch-browser-test.mjs http://127.0.0.1:4262/ --input-only --hybrid
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Chrome must be installed at the default Windows path, or set `$env:CHROME_PATH`. `--hybrid` emulates a fine-primary-pointer touchscreen laptop through capability overrides; this is not a physical Chromebook test. The extended run uses real local bot combat for elimination/respawn and the existing development-only Practice finish command to check results. The regular run also works against `npm.cmd run preview`; it skips development-only Practice results. Public HTTP requests are blocked by the browser fixture. No backend responses, player lists, inventory, purchases or rewards are fabricated.

The audit covers 390×844, 844×390, 1024×768 and 1366×768 layouts and writes ignored screenshots/reports under `test-results/touch-browser/`. It is browser emulation; real WebGL gameplay runs, but it cannot establish physical device performance or browser-specific gesture behavior on iOS.

## Physical-device checklist

On Android phone/tablet, iPhone/iPad, touchscreen Chromebook, desktop keyboard/mouse and a connected gamepad:

1. Check the full title, five navigation items, mode/browser/create/lobby pages, all five weapon cards, Shop/Locker/reveal, Settings and results. Scroll inner panels to their last rows; Apply/Back remain reachable. Check portrait/landscape, cutouts and browser address-bar changes. Verify soft-keyboard text entry/chat.
2. Move diagonally, drag camera and hold Fire with three fingers. Release each separately. Test automatic and semi-auto fire, ADS, partial reload, jump/double-jump, crouch/slide, grenade charge/release, daggers, lean, scope zoom and scoreboard.
3. Switch touch → physical key/mouse → touch → gamepad. Check mouse aiming with pointer lock and the first touch after unlocking. Repeated touches must not create duplicate ADS toggles or semi-auto shots.
4. Cancel touches, rotate/resize, background/foreground, pause, disconnect/reconnect, change weapons and die/respawn while actions are held. Nothing should remain held or move unexpectedly afterward.
5. Try a real two-client public match and verify movement, health, ammo and respawn authority. This is separate from local browser testing. Verify real purchases/rewards only with an authorized account and live backend.

Frontend deployment is sufficient for this feature. The Cloudflare Worker, shared protocol and map data are unchanged. No deployment is performed by the tests.
