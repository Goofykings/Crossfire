# Phase 1 controls, sliding, weapons and HUD

Gameplay settings include a Controls section. Click a binding, then press a keyboard key or mouse button; Escape cancels. Conflicts are rejected with the conflicting action named. Reset controls or individual bindings in the draft and press Apply to save; Back discards edits. Existing WASD/arrow keys, mouse fire/aim, Shift slide, Tab leaderboard, Q/E lean and Escape pause remain defaults. T opens room chat. Number keys and the mouse wheel switch weapons. Bind aim to a keyboard key for a Chromebook. Chat and input ignore gameplay keys while text fields have focus. The game has no interact action.

The room chat sends real bounded text through the Worker. It derives the sender identity from the joined session, limits messages to 200 characters and rate-limits sends. It does not persist chat history. In practice mode there is no room chat. Text is inserted as text, never HTML.

Slide jump-cancellation is implemented in the shared 120 Hz movement controller. It clears the slide and starts its usual cooldown, preserves the current horizontal velocity, and uses the existing capped air-control rules. The slide's one jump remains available after going over an edge, but cannot be repeated in the same airtime. The HUD uses a lightweight masked edge effect while sliding. The health bar is slightly larger and has a faded decorative line.

The shared shotgun configuration has a two-shell capacity, fourteen pellets, wider spread, 14 close-range damage per hit pellet, and stronger falloff. The server still tests every pellet against world and player collision. SMG rate is 1030 RPM; the original synthesized shot is 55 ms and normalized to a 0.8 peak. Existing weapon, reload and sound-event paths remain in use.

The protocol is v8 because the Worker and client must agree on movement, weapon balance and chat messages. Deploy a matching Worker and Pages frontend together only when authorized. Public Cloudflare has not been validated by these local tests.
