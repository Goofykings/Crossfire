# Automatic discovery, Industrial slide passages and controlled peeking

Mode Select now requests `/rooms` on entry, without joining a room or opening a
gameplay WebSocket. It displays loading, success/empty, and connection-error states
separately. Refresh remains available. Concurrent discovery clicks are coalesced;
navigation cancels the request and retry delay. Only discovery GETs retry transient
network/timeouts and HTTP 429/500/502/503/504 failures: three attempts with exponential
backoff and jitter. Admission and room creation are never automatically replayed.
Malformed/incompatible directory data and other HTTP failures fail immediately.

The existing configured provider/URL is used, including custom endpoints; there is
no Cloudflare fallback when custom is selected. The dedicated Node project is
still an incomplete scaffold, not a working game/directory backend. Its unsupported
directory requests display a connection/service error. Existing gameplay sockets
already coalesce `connect()`, reject overlapping opens, preserve resume tokens,
and bound reconnect attempts to five; those mechanisms are unchanged.

## Slide-only clearance

Two low maintenance plinths are authored only in Industrial:

| ID | Centre X,Z | Clear width | Clear height | Depth |
|---|---|---|---|---|
| loading_service | 2,2 | 1.8 m | 0.96 m | 0.8 m |
| storage_service | -18,15 | 1.8 m | 0.96 m | 0.8 m |

Grey steel supports/plinths and yellow lower-edge strips give each opening visible
boundaries. The shared Blender `industrial_roofs.parts()` supplies both the visible
terrain mesh and authoritative collision boxes. The layout author owns metadata;
map revisions automatically change through the existing collision/layout hash.
One nearby pallet is omitted by the existing dressing clearance pass. Original
spawns remain in place; the loading plinth was moved away from S06 after the map
audit caught an overlap. Other maps and unrelated building GLBs are unchanged.

Standing remains 1.8 m, ordinary crouch 1.15 m. An actual valid slide approaching an authored low passage earns a
0.78 m cylinder with a 0.66 m eye, using the existing crouch transition.
Open-air and stair slides retain their original 1.15 m stance and 1.02 m eye.
Other maps do not acquire new mandatory low-clearance links. A held
slide key alone cannot grant that shape. The trusted snapshot's `lowClearance`
state is replayed by the same controller in frontend, Worker and Practice. If a
slide expires under a low roof, the shape remains low at ordinary crouch movement
speed until crouching fits; it cannot grow through a ceiling. Radius, slide
duration/cooldown, speeds, steering and jump rules are unchanged.

Hitscan, melee and grenade body tests use the same low height; firing still starts
at the authoritative eye. Remote meshes and spectating respect the lowered stance.
The Practice navigation graph remains standing-clearance based, excluding these
mandatory-slide links because its planner does not execute guaranteed slide
crossings. Bots keep alternate walking routes and their existing optional slides.

## Peeking

Camera optical roll is 3 degrees, down from 14. Collision-limited lateral eye
offset, aim angles and the shared lean envelope remain unchanged. Weapon motion
adds approximately 11 degrees of cant and a 2.5 cm hip offset, smoothly easing
back on release. At ADS the lateral decoration disappears and the pivot is
compensated around the actual sight anchor, keeping it on the shot axis.

The shared character rig uses 4 degrees at the spine, 3 at the chest, and another
4 at the head. Lower-body bones stay planted. A small lateral upper-body translation
keeps the head inside the existing authoritative envelope. Guns follow the shoulder
frame with an additional small cant; existing IK solves both hands after posing.
No lean hitbox dimensions, spread, damage or recoil rules change.

## Build, tests and release

Regenerate Industrial with `python -B -I tools/layout_industrial.py --write`, then
`node tools/run-blender.mjs --only industrial`. Restore unrelated tracked Python
bytecode/building re-export noise when reviewing outputs; preserve user changes.

Focused coverage:

- `tests/rooms.test.ts`: bounded directory retries and cancellation.
- `tests/slidePassages.test.ts`: both real openings, every gun and direction;
  blocked stand/crouch, expiry recovery, trusted restore and bot-route exclusion.
- `tests/characterWeapon.test.ts`: planted feet and real grip contact while leaning.
- `tests/weaponMotion.test.ts`, `tests/weaponProjection.test.ts`: cant, recovery,
  and actual ADS sight centering for every gun.
- `server/tests/slide-passages.mjs`: real Worker, room admission, two WebSocket
  clients, blocked stand/crouch, both directions and replicated authoritative poses.
- `tools/discovery-slide-peek-browser-test.mjs`: production directory UI fixtures
  (no simulated gameplay sockets), real Practice, character/peek/passage renders.

WebSocket protocol is **v22** because old v21 clients cannot predict the new slide
collider. Old saved motion without `lowClearance` still restores safely. Release
frontend/assets and Worker together through the existing backend-first workflow
when authorized. No Durable Object migration, URL/origin changes or deployment
credentials are required. Public-server validation is separate from local tests.

Actual verification results and remaining limitations are recorded in PROGRESS.md.
