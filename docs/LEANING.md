# Corner leaning

Hold Q or E to lean left or right. Both keys together, or releasing them, returns to neutral. Q no longer selects the last weapon; number keys and the mouse wheel still switch weapons. Leaning returns smoothly while jumping or sliding and resumes only after the player is grounded and no longer sliding.

The shared fixed-step controller eases lean over roughly 150 ms, moves the eye up to 0.28 m and rolls the camera up to 14 degrees. It sweeps the eye and upper torso against map collision. The weapon is attached to the camera and is pulled back or hidden if the rendered muzzle would enter geometry. Existing world raycasts still stop authoritative shots at walls.

The current protocol v8 sends bounded held input and bounded aim angles, never a client-selected eye position. The Worker independently simulates and validates movement, derives the firing eye, and moves the head and upper-torso hitboxes with the lean. Lower-body collision remains at the player's position. The frontend interpolates snapshots and poses the existing remote character rig. Persisted pre-v7 motion is initialized to neutral.

Run frontend checks with `npm.cmd test` and `npm.cmd run build`; run Worker checks with `cd server`, `npm.cmd run typecheck`, and `npm.cmd test`. The local two-browser test, after building the frontend for a local Worker and serving `dist` at `/crossfire/`, is `node tools/lean-browser-test.mjs`. It uses real browsers and a local isolated Worker with real WebSockets; fixture placement is restricted to the test runtime.

Both the GitHub Pages frontend and Cloudflare Worker must be updated together when deployment is authorized. This repository change does not deploy either service or verify the public Cloudflare deployment.
