# Cosmetic asset contract for Claude Opus

Do not move or overwrite the original Default GLBs. Add artwork under:

```
public/assets/cosmetics/ar/<stable-id>/
public/assets/cosmetics/smg/<stable-id>/
public/assets/cosmetics/sniper/<stable-id>/
public/assets/cosmetics/shotgun/<stable-id>/
public/assets/cosmetics/crate/
```

Use GLB glTF 2.0. Prefer embedded PNG/WebP/JPEG textures; keep files lightweight.
Use shared geometry/materials where possible. Runtime paths start with `assets/`,
never `/public/`, `/assets/` or a hardcoded GitHub repository path. All loaders call
the existing Vite base-aware assetUrl helper.

## Source catalog and generated manifest

Add an explicit typed entry to `shared/cosmetics.ts`, then run
`node tools/export-cosmetics.mjs`. `catalog.json` is generated documentation/assets
manifest; editing it alone does not register an item. Verify with
`node tools/verify-cosmetics.mjs` (also included in `npm run assets:verify`).

Example of a FUTURE non-starter entry, not shipped or granted now:

```typescript
{
  id: 'rifle-example', name: 'Example', weapon: 'rifle', rarity: 'rare',
  ownership: 'grant', compatibleWith: ['rifle'],
  asset: {
    model: 'assets/cosmetics/ar/rifle-example/model.glb',
    binding: 'embedded'
  },
  preview: 'assets/cosmetics/ar/rifle-example/preview.webp'
}
```

IDs: stable lower-case letters/digits/hyphens, start with a letter or digit,
maximum 64 characters. Never rename IDs after granting them. Weapon IDs are
`rifle`, `smg`, `sniper`, `shotgun` (`ar` is only a folder/display convention).
Rarities: `common`, `uncommon`, `rare`, `epic`, `legendary`; use the shared colors,
never infer rarity from file names. Keep compatibleWith restricted to the matching
weapon category. Defaults retain `ownership:'starter'`; all other entries use
`'grant'` and require a future authoritative grant source. No HTTP grant exists.
The preview image is optional; without it the UI renders the actual GLB thumbnail.
If supplied, depict the same model/material, use a transparent image and generous
framing (approximately 960 x 460).

## Exact attachment convention

Start from the existing category GLB in `assets/models/shared/weapons/`. Export in
metres with right-handed axes: +X right, +Y up, muzzle toward -Z, stock toward +Z.
Use an identity root and applied transforms. Avoid negative/mirrored root scales.
Keep the original local coordinate frame, origin, overall bounds and stock/contact
surfaces. The adapter does not apply arbitrary per-skin offsets or change gameplay
clearance. A larger replacement needs fit review, not a longer gameplay hitbox.

Preserve the original category's named anchors and their full local translation,
quaternion and scale (the validator allows 0.003 tolerance):

- `grip_r`, `grip_l`: dominant/support contact frames.
- `muzzle`, `sight`, `eject`: muzzle effects, ADS and ejection frames.
- `mag_grip`, `port`, `bolt_grip` wherever the original category has them.

Keep anchor parents and hierarchy transforms equivalent, so world-space frames
also match. Do not insert a transformed parent around them. Preserve named animated
meshes `mag`, `pump`, `bolt`, `shell` where present, including pivots and rest
transforms. Names must remain unique. Keep `reticle_holo` semantics if present.
Existing first-person and character rigs own ADS, recoil, reload movement, muzzle
effects and hand IK. New assets must fit those rigs, not replace them. Test ready,
ADS, firing, reload, walking, home idle and remote animations for each category.

## Materials and texture variants

`binding:'embedded'` preserves Blender-exported PBR materials and their textures.
`binding:'shared'` resolves material names through the existing material library,
matching original Default behavior. Keep material assignments, normals and UVs
correct in Blender. Do not bake lighting into metal/roughness or make every surface
shiny. Export outward normals, avoid duplicate coplanar faces and inspect both sides.

For a material-only variant reference the original GLB and add named overrides:

```typescript
asset: {
  model: 'assets/models/shared/weapons/rifle.glb', binding: 'shared',
  materials: {
    /* replace with an EXACT material name from the referenced GLB */
    'existing-material-name': {
      color: '#6c8294', metallic: 0.7, roughness: 0.42,
      albedo: 'assets/cosmetics/ar/rifle-example/albedo.webp',
      normal: 'assets/cosmetics/ar/rifle-example/normal.png',
      orm: 'assets/cosmetics/ar/rifle-example/orm.png'
    }
  }
}
```

All override properties are optional. Hex RGB color, metallic/roughness finite
0..1. `tile` sets metres per texture repeat (weapon UVs are in metres); `emissive`,
`emissiveColor` and `scroll` add a (scrolling) emissive map; `clearcoat` 0..1 adds a
glossy top coat. A supplied ORM is read from green even outside Ultra (the library
otherwise reads roughness from alpha). Crate collections share textures under
`skins/<collection>/`; see docs/CRATE_REVEAL.md. Albedo is sRGB; normal and ORM are linear. ORM channels: occlusion R,
roughness G, metallic B. Match the GLB UV orientation (loader invertY=false).
Material overrides clone only affected materials; never modify a shared material
in place. Preserve non-overridden base-color/skin textures. Optional texture files
must exist and stay under public/assets. Start with at most 1K-2K textures and
moderate geometry; measure memory/draw calls before increasing budgets.

Asset validation checks structure, not artistic fit. The Foundry Collection is now
staged in foundry-collection.json with four original skins and a crate; it is not
registered in the live catalog or granted. See docs/FOUNDRY_COLLECTION.md for the
Blender sources, actual render/rig checks and handoff. New artwork still needs
context-specific inspection before release. See docs/COSMETICS.md for inventory authority,
guest persistence, future grants and the intentionally unavailable Shop.
