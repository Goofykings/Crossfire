# Backend integration-test RPC lifecycle

The game protocol and production Worker are unchanged. These controls exist only
in `server/tests/runtime-fixture.mjs`; Wrangler's production entry is still
`server/src/index.ts`. Real clients continue using TCP WebSockets and the actual
authoritative game systems.

## Confirmed Miniflare failure mechanism

In the pinned Miniflare `5.20261019.2-beta`, the Node `ProxyStubHandler`:

- Returns `undefined` for symbol properties, including `Symbol.dispose`. Calling
  `stub[Symbol.dispose]?.()` on that proxy does nothing. Returned JSON-like RPC
  objects also lose their native disposer at the Node boundary.
- Requires `MF-Op-Result-Type: Promise` when parsing an asynchronous RPC response.
  In its core entry worker, `rpcAwaited` is set only after `await func(...args)`
  succeeds. A rejected RPC takes the catch path without setting that flag. The
  response lacks the header and the Node parser throws the reported assertion,
  masking the actual RPC exception.

This was reproduced on Windows before changing the fixture by calling the real
`placeForCombatTest` with a nonexistent player. The expected server-spawned-session
error became `AssertionError: (typeHeader === "Promise")`. No package files were
modified. Inspection also confirmed `typeof nodeStub[Symbol.dispose]` and the
returned snapshot's Node disposer were both `undefined`.

That proves the masking and lifecycle defects, but does not prove which exception
or runtime cancellation initiated the reported Ubuntu failure. CI's original
underlying exception was hidden by the parser. A leaked RPC-result lifetime or a
rejected fixture precondition is the strongest remaining hypothesis; do not claim
an observed Linux root exception without the new CI output.

## Test control transport

`testRoom(mf, roomName)` uses Miniflare's fetch transport to a test-only control
handler. That handler invokes the real Durable Object RPC **inside workerd**,
awaits it, serializes its data, and disposes the native object result in `finally`.
Only plain JSON data/errors reach Node, rather than Miniflare native RPC proxies.
Errors retain their original name/message plus room and method context and fail
the test normally. There are no retries or swallowed failures.

The Node handle's disposer invalidates it locally. Tests dispose these handles
before runtime replacement and acquire new handles for the new Miniflare instance.
The native result is already disposed per call; shutdown does not depend on Node
garbage collection or an optional symbol lookup on a Miniflare proxy.

The control handler accepts only test fixture methods and the existing read-only
`roomStatus`. Normal routes delegate to the production Worker. It is not bundled
or deployed by Wrangler. No combat/scoring, timeout, concurrency, protocol or
production configuration changes are required.

This follows Cloudflare's [RPC lifecycle rules](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/):
object-valued results have disposers in the Workers runtime and should be disposed
even if no nested stub is expected.

## Validation and CI comparison

Run from the repository root in PowerShell:

```powershell
npm.cmd run build --prefix server
node --test server/tests/rpc-lifecycle.mjs
node --test server/tests/combat.mjs
npm.cmd test --prefix server
npm.cmd test -- --maxWorkers=2
npm.cmd run test:protocol
```

The lifecycle regression uses warnings-enabled logging, asserts the native result
has a disposer, runs 100 real snapshot RPCs, checks a rejected real placement call,
rejects non-test methods, and checks invalidated handles plus persisted round state
after restarting workerd. Disposal warnings fail the regression; logging is not
suppressed. It runs in the existing backend CI command.

GitHub Actions uses Ubuntu, Node 24, `npm ci` at the root and in `server`, and
`--test-concurrency=1` for backend files. Local Node is 24.20.0/npm 11.19.0, with
Miniflare 5.20261019.2-beta, workerd 1.20261019.1 and Wrangler 4.152.0 matching the
committed locks. The precise CI Node patch cannot be confirmed from local files.
No dependency or workflow versions were changed.

Docker is unavailable locally and WSL reports it is not installed. The Ubuntu
workflow must therefore verify the fix after an authorized push. If it still
fails, the control transport now reports `Test RPC <room>.<method>: <real error>`
instead of masking that error with Miniflare's header assertion. Preserve this
diagnostic and investigate the reported precondition; do not add arbitrary sleeps.
