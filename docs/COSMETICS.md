# Shop, Locker and cosmetic inventory

The catalog's single source is `shared/cosmetics.ts`. It contains exactly four
Common items named Default (one per weapon), all owned and equipped initially.
Weapon statistics, hitboxes, animation timing and collision clearance are not
cosmetic data. Existing weapon GLBs remain in their original locations.

The five home tabs are Play, Shop, Locker, Settings and Leaderboard. Locker filters
owned items, renders thumbnails from their actual models and opens one isolated
3D preview at a time. Back disposes the preview renderer. The equipped panel
always includes all four weapons. The home character still uses the last weapon
used in a match. First-person, character, remote and spectator views use the same
cosmetic asset adapter and the existing category-specific rig placement.

## Authority and persistence

Inventory uses separate `inventory:<career identity hash>` records in the existing
canonical public-main Durable Object. It never replaces career/wallet/statistics
records. Missing starter items and invalid equipment are repaired server-side.
The existing server-issued guest capability authenticates these endpoints:

- `GET /cosmetics`: `{version:1, serverTime, revision, owned, equipped}`.
- `POST /cosmetics/equip`: exactly `{version:1, id:"cosmetic-id"}`. Reject unknown,
  unowned or incompatible items. Re-equipping an equipped item is idempotent.

Requests use `Authorization: Bearer <existing career capability>`, the configured
multiplayer origin, existing permitted browser origins and bounded request sizes.
No token is placed in a URL. Clients cannot submit ownership, gems or statistics.
Equipment changes are serialized, persisted, then propagated to an active room
outside the canonical object's gate. Revision guards discard older notifications.
Joining or resuming obtains canonical equipment; gameplay session IDs remain
server-assigned. Invalid HTTP requests must not reject blockConcurrencyWhile and
reset live connections.

Gameplay protocol remains **19**. `PlayerState.cosmeticId` is optional visual
metadata on existing snapshots: older decoders already accept additional fields,
new decoders accept omission and fall back for well-formed unknown future IDs.
Known cross-category references remain invalid. HTTP inventory schema version is
independent (**1**). Ownership checks always use the server catalog, never the
permissive visual fallback. No extra per-frame message was introduced.

Persistence follows existing guest identity limitations: refresh/reconnect retains
inventory while the career capability is retained. Clearing browser storage loses
access to that guest's inventory; localStorage failures allow a temporary profile,
without a cross-refresh recovery guarantee. This is not an account recovery system.

## Shop deliberately unavailable

The crate is an original lightweight SVG preview. The native disabled
`300 GEMS - OPEN` button has no purchase handler. The proposed future distribution
is Uncommon 50%, Rare 37%, Epic 10%, Legendary 3%. There is no draw, grant, purchase,
crate-opening endpoint or gem deduction. Shop reads the actual existing career
balance. There is no fifth starter cosmetic or hidden test item.

## Adding assets later (Claude Opus handoff)

See `public/assets/cosmetics/README.md` for exact GLB, material, manifest and
attachment conventions. The current adapter supports compatible replacement GLBs
and isolated material overrides, but new artwork must be inspected in all four
view contexts before release. There are no alternate assets in this delivery.
New non-starter items also require a separately designed trusted server-side grant
source; adding a catalog entry with `ownership:'grant'` never grants ownership.
Keep all four original Default entries unchanged.

After editing the source catalog:

```powershell
node tools/export-cosmetics.mjs
npm.cmd run assets:verify
npm.cmd test -- --maxWorkers=2
npm.cmd run build
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
npm.cmd run test:protocol
npm.cmd run test:deployment
```

`tools/verify-cosmetics.mjs` verifies manifest coherence, public paths, GLB format,
required anchor transforms, animated parts, material names and texture files.
Static checks cannot guarantee that new geometry avoids clipping or fits the
existing clearance envelope. Compare every new model with its category's original
in first person, ADS, reload, home and remote views.

`node tools/cosmetics-browser-test.mjs` uses an already running production preview
(`node tools/serve-dist.mjs --port 4200 --base /crossfire/`), a real local Worker
runtime and Chrome. Its origin rewrite only substitutes the local backend address;
inventory, wallet, room and combat responses are real.

## Release and limits

Both frontend and Worker must be released through the existing backend-first
CI when authorized. No new credentials, bindings, Worker URL, origin settings or
GitHub Pages base changes are required. A frontend deployed without the updated
Worker shows an inventory error rather than pretending local ownership succeeded.
Nothing was committed, pushed or deployed by this task.

The current four default items are already equipped, so preview correctly displays
disabled EQUIPPED. Equipping a future alternative uses the same validated endpoint;
full artwork/grant/equip-switch testing awaits actual alternate assets and a grant
feature. Cached rigs are limited by the current four-item catalog; a large future
catalog should add a bounded eviction policy and be profiled on target devices.
