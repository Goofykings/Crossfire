# Directional damage haze and health regeneration

Implemented 2026-10-30. Protocol remains v6; existing authoritative health
snapshots and confirmed hit rays already contain the required client information.
There are no new client health/damage commands or client regeneration timers.

## Directional HUD effect

`DamageFeedback` receives only validated, deduplicated server shot hits for the
local player's current life. The existing direction arrow and 500ms envelope are
retained. The haze now projects the actual incoming ray against current camera
yaw and pitch on every frame. Left/right attacks emphasize their corresponding
edge; frontal hits favor a subtle upper edge; rear hits tint the perimeter with
stronger bottom/rear emphasis. Turning after a hit changes the screen-relative
weights without tracking or revealing the attacker's subsequent position.

Four lightweight CSS gradients become fully transparent within the outer 18-20%
of the viewport. The central area receives no tint. Gradient alpha is limited to
0.42 before the existing bounded strength/fade is applied. Hits ramp up in 40ms,
fade completely by 500ms, and refresh from current opacity without unbounded
stacking. Existing navigation/new-life clearing and confirmed-event checks remain.

## Authoritative regeneration

The existing maximum is 100 HP. Every accepted damaging hit sets a private
server-session `regenAt` cursor to server time plus 5000ms. No healing occurs
during those five full seconds. Each complete additional 100ms earns 1 HP:
the first point arrives at damage time + 5100ms, and 30 points are earned by
damage time + 8000ms. Fractional weapon damage remains supported and health is
capped exactly at 100. New damage immediately resets the full wait.

`server/src/health.ts` calculates complete steps from elapsed server wall time,
not tick count, client time, frame rate or submitted input volume. The existing
room simulation handles hurt connected players until they finish healing. No
per-player interval is created. Health updates use the existing snapshots/HUD.
The room can return to its existing idle lifecycle when healing and other
simulation work finish.

Health and the cursor are stored together in Durable Object persistence and
WebSocket attachments. A valid resume applies only elapsed, unconsumed steps;
it neither resets the waiting deadline nor double-heals. Regeneration can catch
up during a brief disconnected period inside the existing session grace window.
An intentional Leave still discards that session. Dead/unspawned players cannot
heal; death, round transitions and new spawns clear the old cursor. Legacy
damaged sessions without a cursor start a conservative new five-second wait.
The existing death, weapon, scoring, team, round, movement and reconnect rules
are otherwise retained.

## Verification

```powershell
Set-Location C:\Users\Public\Crossfire
npm.cmd test -- --maxWorkers=2
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
$env:VITE_MULTIPLAYER_URL = 'ws://127.0.0.1:8787/ws'
npm.cmd run build
node tools/serve-dist.mjs --port 4198 --base /crossfire/
```

In another PowerShell terminal after both builds finish:

```powershell
Set-Location C:\Users\Public\Crossfire
node tools/damage-regeneration-test.mjs --url http://127.0.0.1:4198/crossfire/
```

The browser tool starts its own isolated real Worker and actual shooter socket;
the production browser is a real server-approved victim. Actual SMG shots from
four directions drive the HUD. Recorded real-hit styles are cloned over black
only for deterministic CSS pixel inspection; no synthetic hit event or health
assignment is injected. It checks directional pixels, an untouched center,
camera turning, half-second fading, repeated hits and HUD/peer healing snapshots.
Low test rendering cost does not change elapsed-time physics or transport timers.
Evidence and screenshots go to ignored `test-results/health-browser/`.

Unit tests cover exact 5-second/100ms boundaries, 10 HP/s, irregular tick cadence,
serialized cursor reuse, repeated damage, death, fractional-health cap, camera
projection and bounded effect refresh/fade. Real Worker tests exercise both FFA
and Teams: genuine shots, delay resets, active-healing interruption, authenticated
resume, synchronized peer health, maximum health, dead/unspawned exclusion,
respawn and round transitions. Existing security and runtime-restoration tests
remain required. Forced hibernation of an actively simulating wounded room is not
a production lifecycle requirement; the shared interval intentionally remains
active while healing. Exact cursor persistence arithmetic is tested separately.

Publish the rebuilt frontend for the directional CSS/HUD change and redeploy the
Worker for regeneration when authorized. Keep existing public-main storage,
allowed origins and the public `wss://.../ws` frontend setting. The private
additive cursor requires no destructive migration. Local verification does not
establish public Cloudflare operation. No commit or deployment is automatic.
