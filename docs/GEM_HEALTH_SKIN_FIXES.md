# Match gems, low-health grading, and respawn cosmetics

## Rewards

Only newly completed authoritative multiplayer match payouts change. The final
placement + capped performance + team-victory sum is multiplied by four. Shared
rules/receipt limits live in `shared/matchRewards.ts`; payout eligibility,
wallet writes and durable source-qualified duplicate protection stay on the server.
The maximum new receipt is 128 gems. Challenges, Practice challenge events,
crate prices, previous receipts and existing balances are unchanged.

New internal reward commands carry `rewardVersion: 2`. Persisted commands from
before this update have no version and retain their original payout even if they
are delivered/retried after the update. No historical wallet migration runs.
Results render the confirmed amount directly; there is no browser multiplier.

Protocol 27 is necessary: protocol 26 clients reject valid receipts over 32 gems.
Publish matching frontend and authoritative backend when deployment is authorized.
Do not deploy the incomplete Node transport scaffold as a replacement game server.
No endpoints, credentials, environment configuration or hosting settings were changed.

## Scene grading

`HealthSaturation` interpolates the specified health anchors and eases toward the
result with frame-rate-independent exponential damping. Life/session/round changes
reset it; menu, loading, pre-spawn, results, death and spectating use normal colors.
Healing eases back to full color. Health comes from the existing authoritative
snapshot (or the explicit local Practice simulation), not a second health system.

The existing last silhouette postprocess grades scene RGB before adding colored
team contours. HTML HUD, nametags, crosshair and Zone Control markers remain
untouched. When contours are disabled, a low-health frame uses only the cheap
color branch, without the silhouette world-mask pass. Full health with no contours
detaches the pass entirely. Quality rebuilds preserve ordering. Chromebook uses
the same grading math without enabling bloom, AO or reflections.

## Skin lifecycle causes and fixes

Practice previously published default human cosmetics on every spawn/weapon swap,
which overwrote the equipped appearance. It now reads the already-loaded local
inventory for the human only; bot defaults and server ownership checks are unchanged.

Spectating also reused the local WeaponView's desired cosmetic map and a shared
weapon/skin-only cache key. A new life could therefore retain spectator appearance
state or skip reapplication. The local appearance key now includes context, round,
session and life. A new authoritative life restores the whole local loadout and
active server-confirmed cosmetic, clears stale spectator presentation immediately,
and restores the synchronized daggers. An alive local snapshot cannot render an
old spectator frame. Inventory refreshes invalidate the presentation key.

Firearm rigs, textures, SkinFx plugins, icicles and the singleton snow emitter keep
their existing caches. Dagger material variants now have their own per-pair cache;
variants are prepared off-mesh and only the latest request can install them.
Returning from a spectator's skin reuses materials instead of disposing/reloading
textures. Pair disposal releases every cached variant; failed loads can retry.

## Reproduction

- `npm test -- --maxWorkers=2`
- `npm run typecheck`
- `npm run build`
- `npm --prefix server run typecheck`
- `npm --prefix server test`
- `npm run test:protocol`
- `npm --prefix server-dedicated test`
- `node tools/health-skin-browser-test.mjs` (local Chrome executable path in script)

The browser review builds an isolated fixture, serves real public assets, and
checks all five graphics configurations, scene pixels, colored HUD/contours,
healing/reset, exact result-label amounts and cached firearm restoration. It
never creates a gameplay connection or grants production inventory. Screenshots
and JSON go under ignored `test-results/health-skins-browser/`.

The backend cosmetic regression uses real local Worker WebSockets, authenticated
inventory/equip endpoints, five lethal shots, five successive lives and session resumes.
Test-only owned-item fixtures are absent from the production bundle. Another
client observes each authoritative skin. This is local integration evidence,
not validation of a publicly deployed server or a broad device performance study.
