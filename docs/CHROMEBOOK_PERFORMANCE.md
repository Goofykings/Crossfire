# Chromebook performance

Chromebook mode targets a 60 Hz display while preserving map geometry, player visibility, combat timing, smoke coverage and the full-resolution HUD.

- Empty grenade, smoke, fire and debris batches sleep: no billboard rebuilds, buffer uploads or draws until an effect starts. Their existing pools and combat appearance are retained.
- Normal/ORM textures and HDR reflection prefilters are not loaded for a cold Chromebook session. Resized color textures replace their originals after loading and shader readiness; full textures reload when the player disables the mode. Signs retain their atlas resolution.
- The [visual polish follow-up](./VISUAL_POLISH.md) replaces GPU render-target resizing with a regular mipmapped texture upload, preserves repeated UVs and uses 2× filtering to keep floors readable at low angles. The 256-pixel texture limit and adaptive render budget are retained.
- Player contours retain depth-tested occlusion. Their mask culls off-camera geometry, and the entire contour pass detaches when no players need it. Static map batches also use their frozen bounding boxes for tighter culling. See [Babylon's scene optimization guide](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene/).
- Unchanged HUD text is not recreated every frame, and damage effects sleep after fading out.
- Adaptive resolution starts at 50% of CSS dimensions, increases by 5 percentage points after six seconds near 60 FPS, and backs off by 10 points after a sustained slow window. It stays between 50% and 80%, with an additional 921,600-pixel budget. Device pixel ratio does not multiply Chromebook render cost. Loading, paused and background frames do not drive the controller. Desktop resolution preferences are preserved.

## Local comparison (2026-11-09)

One Chrome run at 1366×768, device pixel ratio 1, with CDP CPU slowdown set to 4. Both versions used the same three map viewpoints and existing 50% Chromebook resolution. This is a local comparison, **not Chromebook hardware emulation or a 60 FPS certification**. Browser timing, driver behavior, memory collection and other running programs introduce variance.

| View | Previous FPS | Updated FPS | Previous p95 frame interval | Updated p95 |
| --- | ---: | ---: | ---: | ---: |
| Plaza | 15.99 | 19.67 | 116.7 ms | 83.3 ms |
| Lane | 15.07 | 17.95 | 100.0 ms | 83.4 ms |
| Long view | 19.42 | 19.76 | 100.0 ms | 83.4 ms |

Asset responses in that run fell from 190 / 34.71 MiB to 157 / 26.83 MiB. This includes startup assets and previews, not gameplay WebSocket traffic. Before/after plaza screenshots retain the same scenery and appearance. No claim about actual Chromebook RAM consumption is inferred from JavaScript heap samples.

## Repeat the checks

Start the development server, then run:

```sh
node tools/chromebook-perf-test.mjs http://127.0.0.1:5173/ comparison 4
node tools/chromebook-browser-test.mjs http://127.0.0.1:5173/
npm test -- tests/adaptiveResolution.test.ts tests/idleEffects.test.ts tests/silhouetteCulling.test.ts tests/materialQuality.test.ts
```

Set `CHROME_PATH` if Chrome/Edge is not at a standard path. Reports, screenshots and CPU profiles go under `test-results/` (ignored by Git). The browser regression covers all four maps with five actual practice bots at device pixel ratio 2, live mode changes, restored preferences and missing-texture checks.

For acceptance on school hardware, measure a real 4 GB Chromebook after several minutes in a populated online match, including explosions and indoor/outdoor movement. CPU throttling does not emulate its integrated GPU, shared memory, thermal limits or Wi-Fi. Rendering improvements cannot remove network latency or packet loss.
