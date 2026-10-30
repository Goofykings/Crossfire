# Character silhouettes, elimination and damage feedback

This update preserves the humanoid GLB and six movement clips, server damage/hit detection, maps, weapons, menus, guest profiles and Pages/Vite configuration. PROGRESS.md records final results and limits.

## Visible silhouette

`src/rendering/PlayerSilhouettes.ts` replaces per-mesh expanded hulls. One shared render-resolution target draws flat colors for all skinned parts: red opponents and blue teammates relative to the viewer. Opaque canonical map meshes write black/depth; first-person weapons write black in their existing foreground render group. Normal rig deformation is retained; no bounding boxes are drawn.

A nine-tap fullscreen pass finds a 1.5 CSS-pixel **inward** contour of the visible union. Clothing/skin/gear/submesh boundaries cannot introduce internal edges. Hidden character pixels never enter the mask, and the contour cannot expand a concealed body around an obstacle. No blur, bloom or glow. One mask serves the room and stops rendering when not needed; targets resize with render resolution. Existing bone-based enemy LOS and blue teammate through-wall name rules remain separate.

The flat mask explicitly opts out of the main camera's SSAO prepass. Contour ordering is repaired after default/SSAO pipeline rebuilds so quality changes keep bloom, sharpening and antialiasing before the contour.

The cost is one unlit geometry pass and one fullscreen composite when remote characters are presented, rather than whole-map passes per player. Local measurements do not establish school hardware or full-room capacity. See Babylon's [postprocessing API](https://doc.babylonjs.com/features/featuresDeepDive/postProcesses/usePostProcesses/) and installed render-target/material source for the underlying engine contract.

## Confirmed deaths and damage

**Protocol v6 requires matching frontend and Worker builds.** `/health` reports `protocol: 6`. The Worker supplies the normalized world-space ray it actually used for an accepted hit. Hit entries carry victim life; eliminations carry a unique ID, victim life and lethal ray (null for environmental falls). Clients cannot submit damage directions, hits or eliminations. Damage values, spread, hit volumes, scores, respawn rules and persisted session schema remain unchanged.

The client validates unit vectors, deduplicates event IDs and ignores eliminations for stale rounds/lives. It delivers elimination presentation before applying the dead snapshot. The remote character tips around its feet along the incoming world ray and smoothly fades to zero over 500ms of wall-clock time. A small lift limits foot clipping. Labels/outlines stop immediately; the instance, rig, groups and temporary fade materials/texture clones are disposed. A depth prepass limits transparency overlap. Surviving players retain original shared materials. A new authoritative life replaces an unfinished effect immediately. A dead snapshot without an event removes the actor without inventing a direction.

`src/ui/DamageFeedback.ts` consumes actual hit entries for the local player's current life. CSS draws red edges with a transparent center, a 40ms attack, brief hold and smooth release ending at 500ms. Repeated hits refresh from current opacity and cap brightness. The off-crosshair chevron indicates the shortest horizontal turn toward the attacker, recalculated against current camera yaw. Attacks within 20 degrees of front omit it; near-exact rear ambiguity chooses right. Other rear attacks use their actual side; vertical rays omit an uninformative horizontal arrow. Home/loading/error navigation clears effects. Prediction and local practice rays never manufacture multiplayer damage feedback.

## Home character

`src/ui/HomeCharacter.ts` loads the **same** GLB/atlas into an isolated transparent scene over the existing blurred image. The project has one skin; this uses it without inventing a selection system. Its actual IDLE clip plays with key/fill/rim lighting. A responsive camera frames the head through upper thighs, while a canvas mask fades the character out above the knees. The procedural platform remains available but is hidden. Cursor movement smoothly turns the body by up to 15 degrees and adds a slightly larger horizontal and vertical look to the animated head. Reduced motion freezes idle/cursor movement.

Only the character and procedural preview geometry/lights load. No map, environment texture, weapon, gameplay controller or player connection is created for the preview. Settings/match navigation aborts loading, stops the loop, removes listeners and disposes the instance, source container, scene, engine and canvas. Returning home recreates it through browser-cached assets; the existing loader disposes late cancelled loads. No new text or controls clutter the menu.

## Local PowerShell commands

Use separate terminals from `C:\Users\Public\Crossfire`:

```powershell
# Backend: local workerd, no Cloudflare deployment
npm.cmd run dev --prefix server
```

```powershell
# Frontend
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run dev -- --host 127.0.0.1
```

Production verification:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run build
# Separate terminal:
node tools/serve-dist.mjs --port 4176 --base /crossfire/
# Test terminal (isolated real Workers are started by the combat tool):
node tools/combat-visibility-test.mjs --out test-results/polish --url http://127.0.0.1:4176/crossfire/
node tools/home-test.mjs --appearance-only --url http://127.0.0.1:4176/crossfire/
# Focused graphics-quality regression (one browser, actual peer sockets):
node tools/combat-visibility-test.mjs --quality-only --out test-results/polish --url http://127.0.0.1:4176/crossfire/
```

Cloudflare needs redeployment alongside a matching protocol-v6 frontend. Retain public-main, SQLite bindings/storage and allowed Pages origin; use `wss://<worker-host>/ws` in production. No commit, push or deployment is automatic.
