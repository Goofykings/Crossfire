# Online movement and hit registration (protocol v24)

The previous renderer always played 100 ms behind its clock estimate and clamped to the newest available snapshot. Whenever Wi-Fi delivery exhausted that buffer, other players stopped until another packet arrived. Pongs also replaced the clock offset without filtering, which could move the playback timeline abruptly. Gun hits used current server hitboxes even though the shooter aimed at delayed bodies.

## Changes

- `NetworkTiming` uses recent low-RTT clock samples and limits later clock adjustments. Playback advances monotonically. Its buffer approaches 65 ms on a steady link and expands to at most 160 ms when arrivals become irregular.
- Remote bodies interpolate normally, then predict at most 100 ms from the last authoritative velocity when snapshots run out. Map cylinder sweeps constrain horizontal prediction; floor/ceiling checks constrain airborne prediction. Small prediction corrections settle quickly, and genuine teleports and respawns reset history.
- Each input carries the server-clock time of the world that was actually drawn when the action was sampled. The server keeps a short pose history and checks gun rays against the historical target body. Rewind is limited to the smaller of 300 ms and half the server-measured RTT plus 200 ms. Client timestamps do not determine damage, origin, fire rate or hitbox size. Current life, round, team rules and actual wall raycasts still apply. Grenades and melee retain their existing authoritative behavior.
- Server-issued nonce probes measure RTT independently of client latency claims. Client clock pings start immediately after welcome. The online FPS readout includes ping.
- Combat and jump edges schedule an immediate deferred input flush instead of waiting for the next 50 ms batch interval. Fixed 120 Hz simulation, sequence ordering, maximum packet size, input queue limits and reconnect ownership remain intact.
- Compact snapshots replace repeated motion, gun and melee field names with validated tuples. Motion precision is 0.0001 m. Compact input tuples preserve all axes, edges, sequence numbers and view timestamps. Each snapshot is independent; reconnecting or delayed delivery does not require a chain of deltas.
- Active-room heartbeats no longer broadcast an extra full roster to every player. Each regular broadcast is encoded once per wire format, rather than once per recipient. Compact negotiation survives Durable Object reconstruction through the existing socket attachment.

Pose history is intentionally transient and cleared across lives, rounds and large teleports. A restarted room falls back to current validated state until it has fresh history. Clock estimation, interpolation and server history follow the established approach described in [Gambetta's entity interpolation article](https://www.gabrielgambetta.com/entity-interpolation.html) and [Valve's lag-compensation implementation](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/server/player_lagcompensation.cpp).

## Verification

The real Worker test demonstrates that a shot can hit a recent displayed position after the current body has moved laterally, arbitrarily old claims cannot recover retired poses, and solid walls still block compensated shots. The existing backend suite passes all 91 tests, including movement, authenticated reconnects, object reconstruction, teams, assists and scoring. The real frontend/Worker protocol gate also exercises packed snapshots and packed inputs.

The browser regression uses two actual Chrome clients and a real local Worker. It delays native WebSocket deliveries in TCP order with varying downstream delays of 55–175 ms and upstream delays of 35–65 ms. It samples actual rendered movement and compares the previous fixed-buffer algorithm on that same received stream. The final run recorded 0 frozen moving frames versus 200 for the previous algorithm over 309 moving frames; both connections remained healthy and a shot aimed at a displayed moving player confirmed. These are local diagnostic results, not a guarantee for every school network.

Packing tests require a representative ten-player snapshot to use less than 70% of its original JSON size, and a representative six-frame input batch to use less than 40%. Both compact formats still pass the ordinary strict value validators after expansion; malformed tuples and forbidden state claims are rejected.

```sh
npm run build --prefix server
node --test server/tests/protocol.mjs server/tests/lag-compensation.mjs
npm test -- tests/networkSmoothing.test.ts tests/inputWire.test.ts tests/snapshotWire.test.ts tests/multiplayerTransport.test.ts
npm run dev -- --host 127.0.0.1 --port 5180
```

With the frontend server running, use another terminal:

```sh
node tools/network-jitter-browser-test.mjs http://127.0.0.1:5180/
```

The browser tool writes its report and screenshot under `test-results/network-jitter/`. Set `CHROME_PATH` if needed. Packet-delay injection tests delivery jitter and batching; it does not emulate radio behavior or all TCP retransmission patterns. A sustained outage beyond the prediction/history limits still requires real data to recover.

Frontend and Worker must deploy together because this changes the protocol to **v24**. Existing v23 tabs need a refresh after deployment. No live deployment is performed by these local checks.
