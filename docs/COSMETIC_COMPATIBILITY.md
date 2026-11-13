# Cosmetic rendering across graphics settings

The current registry in `shared/cosmetics.ts` is the source of truth. The compatibility audit never registers staged Foundry assets or the removed Darkness collection, changes ownership, or contacts account/multiplayer services.

## Cause and fix

Chromebook Mode intentionally removes environment reflections and simplifies the shared `MaterialLibrary` materials. Cosmetic clones previously reapplied fully metallic shading, normal/ORM maps and clear coat over those simplified sources. Fully metallic PBR has no diffuse light response; without reflections Rich's gold became almost black. Existing clones also missed later library quality changes. Embedded dagger instances have separate libraries, making that inconsistency persist across cached swaps and new lives.

`CosmeticQuality.ts` applies the same policy to every patched cosmetic material. Chromebook uses diffuse albedo, roughness 1, no reflection/normal/ORM/clear coat, while retaining authored colors, albedo patterns, emission and the existing inexpensive flow/frost shader variants. Other settings restore the authored finish. Library notifications and the existing shared skin quality switch update material instances in place, including independent dagger/preview caches. Disposing a material/scene removes its listeners. There is no per-frame quality check or model reload.

Inherited texture wrappers are replaced with shared source textures; unused clone wrappers are released. Cosmetic-owned maps stay with their existing cache for a lossless quality change. Pruning preserves textures referenced by live cosmetic materials. Shared surface compaction also notifies cosmetic users when a smaller source texture becomes available.

## Repeatable checks

```powershell
npm test -- --maxWorkers=2
npm run typecheck
npm run build
node tools/cosmetic-compatibility-test.mjs
node tools/cosmetic-compatibility-test.mjs --contexts --reuse
node tools/cosmetic-compatibility-test.mjs --animations --reuse
```

The browser tool builds an isolated Vite page, starts its own localhost preview on port 4226, launches Chrome, writes reports/screenshots to `test-results/cosmetic-compatibility/`, and closes both processes. `--reuse` uses the previously built audit bundle; omit it after changing rendering/audit code. Set `$env:CHROME_PATH` if Chrome is not at the standard Windows or Linux location. A GPU-capable browser is required; this is separate from the GPU-free Vitest suite.

The main matrix checks every registered appearance (including defaults) in Chromebook, Low, Medium, High and Ultra. It checks actual GLB/texture loading, shader readiness, visible pixels, a different rendered signature from the weapon's default, attachment preservation, and live preset changes without replacing material instances. `--contexts` exercises actual `WeaponView`, `MeleeView` and `CharacterWeapon` rigs at High and Chromebook quality: hip, ADS, reload, recoil, cached new-life swaps and third-person holds where applicable. It does not perform a real online death or reconnect; those use the same appearance caches but require a separate multiplayer session to verify end to end.

`--animations` checks a changed pixel signature with unchanged geometry on every Hydro Dip and Rainbow Glow appearance in both High and Chromebook modes. Hydro uses a controlled animation clock; Rainbow uses its actual scrolling-texture observer.

The respawn regression test covers all current firearm collections and registered dagger collections, repeated default/equipped swaps, ADS/reload pose evaluation, quality changes, cache reuse and stale asynchronous requests. Material regression tests cover cold Chromebook creation, lossless in-place switches, independent embedded dagger libraries, texture ownership/pruning and observer cleanup.

## Release and limitations

This fix changes frontend rendering only. It needs a frontend release when authorized; no protocol, backend, combat, ownership or reward changes are required. The existing Pages workflow and backend URL configuration are preserved. Desktop Chrome WebGL results do not establish performance on physical Chromebook hardware. Automated visibility/signature checks support, but do not replace, human visual review. Local appearance-cache checks are not a claim of public multiplayer or reconnect validation.

## Files for this fix

- Rendering: `src/rendering/CosmeticQuality.ts` (new), `CosmeticAssets.ts`, `MaterialLibrary.ts`, `SkinFx.ts`.
- Regressions: `tests/cosmeticQuality.test.ts` (new), `tests/skinRespawn.test.ts`.
- New browser audit: `tools/cosmetic-compatibility-lab.html`, `tools/cosmetic-compatibility-lab.ts`, `tools/cosmetic-compatibility-test.mjs`, `tools/cosmetic-context-audit.ts`.
- Notes: this document and `PROGRESS.md`. Other existing working-tree edits are preserved.
