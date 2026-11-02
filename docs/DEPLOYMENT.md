# Coordinated Cloudflare and GitHub Pages releases

Updated 2026-11-02. `.github/workflows/deploy.yml` releases both services from
the same `main` commit. This replaces independent frontend-only deployment.
The existing Worker is `crossfire-multiplayer` at
`wss://crossfire-multiplayer.maxwellmaahs.workers.dev/ws`.

## One-time setup

In the GitHub repository, open **Settings > Secrets and variables > Actions >
Repository secrets** and add:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare token authorized to edit Workers in the existing account. |
| `CLOUDFLARE_ACCOUNT_ID` | The account ID that owns the existing Worker and Durable Object namespace. |

Use Cloudflare's **Edit Cloudflare Workers** token template, scoped to the
existing account and only the resources it needs. See the
[official authentication/action instructions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
Use repository secrets: the backend deployment occurs in the build job, before
the separate `github-pages` environment job. Missing/blank secrets block
production changes, with their names and setup instructions.
The credential check runs after tests/builds but before production changes;
missing-secret failures appear as explicit errors on the Actions summary.
Values are never printed by the preflight or written into frontend artifacts.
Never put tokens, passwords or administration credentials into `VITE_*` values.

Keep **Settings > Pages > Build and deployment > Source: GitHub Actions**.
Retain the existing Pages environment and its access rules. If approval is
required there, backend deployment precedes that approval; consider that when
scheduling an incompatible release.

Existing public repository variables remain supported:

- `VITE_MULTIPLAYER_PROVIDER`: blank or `cloudflare` for this production workflow.
- `VITE_MULTIPLAYER_URL`: blank uses the existing Worker; otherwise the public
  WSS endpoint must route to that same Worker. Its HTTPS `/health` is verified.
- `VITE_CUSTOM_MULTIPLAYER_URL`: preserved for future custom-host support.

The release preflight uses Vite's production env loading and the frontend's
existing resolver, so defaults, `.env` precedence and process overrides agree.
Explicit `custom` selection fails this Cloudflare release with instructions to
provide a custom deployment/verification job. It does not silently substitute
Cloudflare. Local custom-provider support is unchanged. `.env.local` is untouched
and ignored by Git; localhost URLs cannot be published by this release gate.
The Pages build keeps `BASE_PATH: ./` and the existing Vite configuration.

Runtime model/texture/audio URLs continue through `src/core/assets.ts`
(`assetUrl()`), so project paths and repository names remain supported. To
inspect the production build locally under a Pages-like subpath:

```powershell
npm.cmd run build
node tools/serve-dist.mjs --port 4174 --base /crossfire/
```

Generated assets are committed; CI needs neither Blender nor an asset rebuild.
Existing ignored texture caches and Blender backups remain local.

## Automatic sequence

1. On a push to `main`, or **Actions > Deploy Crossfire > Run workflow > main**,
   check the branch. Install locked root/server dependencies
   with `npm ci`; use Node 24 and Python 3.13 for the existing map-source checks.
2. Run frontend tests, release-gate tests, backend typecheck and actual
   workerd/TCP integration tests, then the protocol compatibility test.
3. Verify assets and build the frontend. Stage its Pages artifact, including
   public `release.json` containing the protocol, full Git SHA and health URL.
   Staging an artifact does not change the live site.
4. Check required Cloudflare secrets, then reject an obsolete commit if `main`
   has advanced before production changes. Missing credentials do not skip tests;
   they still prevent Worker and Pages deployment.
5. Use **`cloudflare/wrangler-action@v4`**, in `server/`, with the exact Wrangler
   version already pinned in `server/package.json`. Deploy the existing Worker
   with `RELEASE_SHA` set to this commit. Wrangler config, Worker name/URL,
   Durable Object class/storage binding, origin allowlist and timers are retained.
   There are no namespace deletion/recreation or data-clearing operations.
6. Poll `/health` until `ok`, service, canonical room, shared protocol version
   and **this exact commit SHA** match. HTTP errors, malformed responses,
   timeouts, old protocols and old releases fail after bounded retries.
   Health replies have `Cache-Control: no-store`; probes also bypass caches.
7. Only a successful build/backend job enables Pages publication. Recheck the
   Worker immediately before `actions/deploy-pages`; publish the staged artifact.

The original permissions (`contents: read`, `pages: write`, `id-token: write`)
are unchanged. One workflow-wide concurrency group covers both jobs, with
`cancel-in-progress: false`. A newer push cannot cancel an active release halfway
through the backend/frontend pair. GitHub keeps the latest pending run by
default; superseded pending pushes may be skipped. The stale-commit check blocks
an old rerun from replacing a newer deployment. Once backend publication starts,
the current pair finishes before another run can start. Do not manually cancel
an active run between backend deployment and Pages publication.

## Protocol compatibility

`shared/protocol.ts` remains the single version/schema source, currently v12.
No second version constant was added. The optional health `release` field does
not change the WebSocket protocol.

`npm run test:protocol` runs the **actual frontend `MultiplayerClient`** against
the built production Worker in local workerd. Two real TCP clients join/spawn,
exchange authoritative movement/orientation and chat, validate both wire
directions through the shared parsers, and resume a session. It checks health
version/release and rejects incompatible versions and illegal same-version
payloads. This checks real messages rather than comparing two numbers. Existing
integration tests additionally exercise combat, scoring, regeneration, grenades,
props, map transitions and persistence.

Keep changes backward compatible when both existing parsers permit it. For
breaking schema/semantic changes, update the shared contract, review migration
and saved-state compatibility, and extend the real compatibility checks. Do not
disable validation or accept arbitrary old packets to conceal mismatches.
Browser errors distinguish an update/version mismatch from an invalid message
and suggest refresh/reporting versions without creating a retry loop.

## Local checks

PowerShell from `C:\Users\Public\Crossfire`:

```powershell
npm.cmd ci
npm.cmd ci --prefix server
npm.cmd test
npm.cmd run test:deployment
npm.cmd run typecheck --prefix server
npm.cmd test --prefix server
npm.cmd run test:protocol
npm.cmd run assets:verify
npm.cmd run build
```

These commands do not publish. Worker builds use `wrangler deploy --dry-run`.
`npm run test:protocol` requires both dependency sets. Deployment tests use local
HTTP fixtures to check stale/wrong health responses and bounded retries. No
Cloudflare/GitHub credentials are needed for local tests.

## Manual recovery/deployment

Prefer **Run workflow on main**: it runs the same complete sequence and avoids
publishing just one side. Fix a missing secret or transient Cloudflare failure,
then rerun the latest `main` workflow. Do not rerun a historical commit after
`main` advances; the stale-release check intentionally rejects it.

For an authorized emergency CLI backend deployment, first stop conflicting
releases and use a clean checkout of the intended `main` commit. Run the checks
above, then (these commands actually publish; do not run for local validation):

```powershell
$env:RELEASE_SHA=(git rev-parse HEAD).Trim()
$env:VITE_MULTIPLAYER_PROVIDER='cloudflare'
$env:VITE_MULTIPLAYER_URL='wss://crossfire-multiplayer.maxwellmaahs.workers.dev/ws'
node tools/prepare-release.mjs
npm.cmd run build
node tools/prepare-release.mjs manifest
Push-Location server
npx.cmd wrangler login
npx.cmd wrangler deploy --var "RELEASE_SHA:$env:RELEASE_SHA"
Pop-Location
$expected=Get-Content .release/expected.json -Raw | ConvertFrom-Json
$env:MULTIPLAYER_HEALTH_URL=$expected.healthUrl
$env:EXPECTED_PROTOCOL=[string]$expected.protocol
$env:EXPECTED_RELEASE=$expected.release
node tools/verify-release.mjs
```

Use the owning account during login; set `CLOUDFLARE_ACCOUNT_ID` locally when
necessary to select it. CI uses its secrets instead of interactive login. Do
not export credentials into Vite variables. Run the coordinated workflow for
this same latest commit to publish Pages; redeploying that Worker is harmless.
Do not publish an unrelated or historical frontend artifact alongside it.

## Troubleshooting and rollback

Check the first failed step in **Actions > Deploy Crossfire**:

- **Credentials:** add the named repository secret; a token must cover the
  account owning the existing Worker. Do not print tokens to diagnose scopes.
- **Tests/typecheck/compatibility:** fix the failing contract or code. These
  failures happen before production changes; they cannot be bypassed by Pages.
- **Stale release:** run the latest `main` commit.
- **Wrangler:** inspect token/account permissions and the action output. Keep
  `PublicRoom`, its binding and existing state. Never clear state to fix a release.
- **Health:** inspect public `/health` for `protocol` and `release`; compare to
  the workflow commit and frontend `/release.json`. Confirm the configured WSS
  host actually routes to this Worker. A stale edge, failed deploy or unrelated
  URL must block publication. The poll has 12 attempts, 5-second request timeouts
  and 5-second gaps (up to about two minutes with request timeouts).
- **Pages/environment approval:** the old site stays published. The backend
  may already be updated; promptly finish the run or roll back the backend to
  a version compatible with the still-published site. A manual deployment that
  changes the Worker between jobs is detected by the second health gate.

The safest rollback is a reviewed **revert commit on main**, followed by the
coordinated pipeline. That republishes both sides with a fresh, matching release
SHA. Do not rerun an old pipeline or restore only the frontend after a breaking
backend change. If immediate backend rollback is necessary while the old Pages
site remains live, pause/cancel conflicting automation and restore the matching
previous Worker version through Cloudflare > Worker > Deployments > Rollback,
or `npx.cmd wrangler rollback <VERSION_ID>` from `server/`. Verify the old site
and backend agree, then follow with the reviewed coordinated recovery release.

Worker rollback does not roll back persistent game data. Review saved-state
compatibility first; Cloudflare may prohibit rollback across Durable Object
class lifecycle changes. This update makes none. See
[official rollback behavior and limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Limits

Two independent services cannot provide an atomic release. There is a short
backend-first window, and already-open/cached older clients can remain
incompatible after a breaking release until refreshed. Prefer compatible
changes, prepare artifacts before touching production and avoid external/manual
deployment races. A failure after Worker publication can leave the old Pages
site with a newer Worker; the rollback procedure above addresses that case.
The gate protects Pages publication; it does not automatically undo a published
Worker or make live old tabs compatible. GitHub runner outages and provider
availability still require retry/recovery. No real deployment was performed
while implementing these changes.
