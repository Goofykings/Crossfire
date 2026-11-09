# Visual polish — 2026-11-09

The loadout cards now show only the weapon name and image. The semi-auto sniper's extra description and its unused style were removed.

## Missing gun surfaces

The shared [weapon generator](../blender/scripts/lib/weapon.py) inferred polygon direction from its first three vertices. Concave grip and stock outlines can begin with a reflex corner, so that triangle points opposite the complete polygon. The resulting inside-out side caps disappeared with normal back-face culling. A two-sided GPU comparison confirmed this on the shotgun stock.

The generator now uses the whole boundary's Newell normal. All five default GLBs and affected Foundry cosmetic models were regenerated, together with editable sources. The repair retains ordinary single-sided materials, original geometry, sights, moving parts and gameplay timing. Shipping-mesh tests check exposed left and right surfaces and allow legitimate interior faces in optic hoods and decorative inserts.

Hip placement moves the guns 14 cm forward to give grips more room and reduce extreme perspective at the rear. ADS sight placement and the fixed horizontal viewmodel FOV are preserved. A soft camera-relative hemisphere lights held meshes only; it adds no shadow map or world render pass. Dark metal, walnut, receivers and grips remain readable in shade.

## Chromebook surfaces

The previous GPU resize used a render-target copy and temporarily changed source wrap modes. Cold-start captures reproduced a paving surface rendering as broad gray strips, even when switching to Chromebook mode after normal loading looked correct.

[SurfaceTexture](../src/rendering/SurfaceTexture.ts) now downsizes color images once during loading and uploads a regular mipmapped texture. It explicitly preserves UV transforms, both repeat modes, alpha and color space, without changing the source sampler. The browser response cache supplies the image bytes. Failed image optimization retains the visible original. Loading waits for pending compaction, and original GPU textures are released after the handover.

The texture limit remains 256 pixels, with 2× filtering to improve low-angle floor readability. The adaptive resolution and pixel budget are unchanged. Chromebook mode still skips normal/ORM images, HDR reflections, shadows and expensive postprocessing; signs keep their atlas resolution. This preserves the existing performance strategy while repairing surface appearance.

## Additional review

[Valve's Counter-Strike 2 presentation](https://www.counter-strike.net/cs2) emphasizes coherent materials, lighting and reflections. The practical comparison here focused on readable weapon materials, stable floor detail, clear aiming and unobtrusive HUD contrast. It led to the weapon framing/fill changes, crisp dark crosshair edges, and local gradient backing beneath health and ammunition. No additional fullscreen effect was added.

Reviewed views include all five guns at the hip, ADS and reload poses in standard and Chromebook modes; four maps from a cold Chromebook start; and sniper scope visibility across quality presets. The before/after paving capture uses the same camera. Its automated detail measurement stays above the flat-strip threshold, while checks enforce repeated UVs, mipmaps, ordinary texture type and the 256-pixel limit.

## Validation

- TypeScript and production build.
- 74 focused unit tests covering actual weapon surfaces, projection/ADS, motion, materials, resize failure, cosmetics, assets, adaptive resolution, silhouettes and idle effects.
- `npm run assets:verify`: 240 manifest entries, map/material references and 42 cosmetic catalog items.
- `node tools/texture-render-browser-test.mjs http://127.0.0.1:5181/`: four cold-start maps, texture assertions and a real rendered paving-detail check.
- `node tools/visual-polish-browser-test.mjs http://127.0.0.1:5181/`: gun poses, description removal, standard/Chromebook transitions, and scope quality checks.

Local captures are stored under `test-results/texture-final/` and `test-results/visual-polish-final/`. These are local Chrome GPU checks, not measurements on a physical Chromebook. A guaranteed 60 FPS result is not inferred from them.
