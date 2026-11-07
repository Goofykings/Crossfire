# Dual-dagger gameplay and cosmetics

The gameplay integration uses the original Blender daggers, character arms, grip
anchors and six clips documented in [DUAL_DAGGERS.md](DUAL_DAGGERS.md). It does not
replace those assets or introduce a second character pose system.

## Controls and rules

- **V** toggles the separate melee equipment. Settings > Controls can rebind it.
  Existing custom V bindings are preserved; migration assigns an unused key instead.
  Presses wait for the next physics tick at high frame rates and clear on input reset.
- The normal attack input advances Cross, Forward, Finisher. Each hit deals **35 HP**,
  without headshots. Damage is capped by the victim's remaining health.
- Each press produces one swing, with one buffered next press. Holding attack does
  not repeatedly swing. After an attack finishes, a 350 ms pause resets the combo.
- Equip, unequip, attack contacts and chain windows match `daggers.json`; the unit
  compatibility test catches accidental timing drift. `shared/melee.ts` owns the
  combat settings and state machine. Animation frames are not network messages.
- Server hit detection selects one nearest capsule in a 55-degree forward cone,
  within 1.85 m of its surface and 2.15 m of its body center. Solid geometry must not
  obstruct the target. Teammates cannot be damaged or attacked through.
- Gun firing, ADS, reload, grenade charging and gun selection are gated while melee
  is active. The selected gun, ammunition and existing cooldowns are retained.
  Short melee clearance replaces gun-length clearance; body collision still applies.
- Death, respawn and round changes clear melee. Reconnecting resumes the existing
  authoritative state. Missed contact windows do not cause damage after a long pause.

## Authority and presentation

The Cloudflare Durable Object and browser-local `PracticeSimulation` use the same
`stepMelee` and `traceMelee` rules. The Worker accepts only the existing validated
input frame plus a boolean toggle; clients cannot supply melee damage or targets.
Existing elimination, assist, score, challenge, statistics and match-reward paths
receive the melee weapon tag. Practice has no persistent reward adapter.

The simulation stays awake for finite melee transitions even when stationary, and
sleeps again in hidden/ready states. It uses the existing room simulation timer.
The client predicts inputs, replays unacknowledged input timestamps, and reconciles
the authoritative state. Remote avatars use interpolated server timing and the
existing skeleton/IK and clip blending. Spectating uses the observed player's melee
state and skin. Equip and distinct swing audio use the existing audio settings;
confirmed hits provide the existing non-graphic hit marker and damage feedback.

## Inventory and crates

The Locker has ALL / SMG / AR / SNIPER / SHOTGUN / MELEE filters and five equipped
slots. Inventory migration grants **Default Daggers**, a Common starter, without
changing existing gun ownership or equipment. Both real GLBs appear in the existing
full-screen preview and crate reveal.

Each of the six existing skin collections has a paired material variant using valid
existing textures. Materials are cloned per pair; embedded defaults and shared
geometry remain intact. Skins affect appearance only. Rarity colors, crate price,
availability and 55/40/5 rarity distribution are unchanged. The catalog now has
five starters and thirty crate rewards.

Crate requests carry an opaque `requestId`. The canonical authority persists its
receipt in the same batch as the inventory grant and gem deduction. Retries return
the original item and current wallet/inventory, including after a Worker restart.
The client reuses the request ID after an ambiguous response failure. No client
reward selection or ownership claim is accepted. Older version-only HTTP requests
remain accepted; receipt-based retry safety requires a request ID.

## Validation commands

From the project directory in PowerShell:

```powershell
npm.cmd test -- --maxWorkers=2
npm.cmd run build
$env:WRANGLER_LOG_PATH = Join-Path $PWD 'test-results/wrangler-checks.log'
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
node --test server/tests/protocol.mjs
npm.cmd run assets:verify
```

`server/tests/melee.mjs` tests real local Worker WebSockets, FFA/Teams damage,
mid-combo resume, gun/ammunition preservation, friendly-fire immunity, actual map
occlusion, assists/statistics, ownership and atomic retry-safe crate awards.
`tests/meleeCombat.test.ts` tests timing, buffering, expired contacts, protocol
validation, keybinding migration, shared Practice combat and bot melee decisions.
The existing real-GLB rig/animation tests remain in the frontend suite.

For browser verification, start Vite or serve the production build:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 4201
# Or, after building, in a separate terminal:
node tools/serve-dist.mjs --port 4200 --base /crossfire/
# In another terminal (requires Chrome at the script's configured path):
node tools/melee-gameplay-browser-test.mjs http://127.0.0.1:4200/crossfire/
```

The browser test starts its own real local Worker, creates authenticated test
clients, exercises physical V input, Controls rebinding, all three authoritative
combo stages, remote animation, spectating, paired previews, grant/equip and a duplicate-request receipt. Test-only
fixtures stage positions and eligible inventory; gameplay damage and reward
requests go through real authority. Results/screenshots are in
`test-results/melee-gameplay-browser/` and are not deployed assets.

For ordinary local play, use two PowerShell terminals from the project directory.
These process environment variables leave `.env.local` unchanged:

```powershell
# Terminal 1
npm.cmd run dev --prefix server
```

```powershell
# Terminal 2
$env:VITE_MULTIPLAYER_PROVIDER = 'cloudflare'
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run dev -- --host 127.0.0.1
```

No Cloudflare account or public deployment is needed for the local Worker.

## Release and limits

The WebSocket protocol is now **v20**, shared by frontend and Worker. Both require a
matching deployment through the existing guarded release workflow when authorized.
The cosmetics HTTP version stays 1. No Worker URL, Durable Object migration,
credentials, room schedule or GitHub Pages base-path change is required.

Local automated checks do not verify the public Cloudflare service, real Internet
latency or physical laptop/Chromebook performance. Existing melee hit detection is
a short-range cone/capsule test with solid occlusion, not per-finger blade mesh
collision. Public deployment and public multi-client validation remain separate.

## Confirmed impact follow-up

See [MELEE_IMPACT.md](MELEE_IMPACT.md) for shared authoritative knockback, finite
camera roll, dedicated impact/spatial audio, third-stage death emphasis and checks.
Claude's newer clip timings and joint relaxation remain the current baseline.
