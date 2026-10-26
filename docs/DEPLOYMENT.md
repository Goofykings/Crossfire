# Deploying to GitHub Pages

The frontend remains a static site: `npm run build` writes it to `dist/`, and GitHub Pages hosts it. Stage 2 adds a separate Worker/Durable Object backend that runs locally; it has not been publicly deployed. See [server startup/configuration](../server/README.md) and [current progress](../PROGRESS.md).

The [connectivity diagnosis](MULTIPLAYER_DIAGNOSIS.md) records the historical pre-backend findings. Current exact PowerShell commands for both processes and the explicit multiplayer test URL are in the server README.

The separate deployment boundary and later match migration are described in the [multiplayer architecture and migration plan](MULTIPLAYER_ARCHITECTURE.md). The existing Pages workflow still deploys no server. Public backend deployment remains a separate approval step; the server build uses Wrangler's local dry-run mode.

## First-time setup

1. Create a new, empty repository on GitHub. Any name works.
2. Commit and push this project:
   ```bash
   git add -A
   git commit -m "Crossfire milestone 1"
   git branch -M main
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```
3. In the repository on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The push triggers `.github/workflows/deploy.yml`: install, unit tests, asset verification, build, upload and deploy.
   Watch it under the **Actions** tab. When it finishes, the site is at `https://<user>.github.io/<repo>/`.

Later pushes to `main` redeploy automatically; the workflow can also be started by hand (**Run workflow**).

## Base path

GitHub serves project sites from `/<repo>/`. Vite's `base` is `./` by default (see `vite.config.ts`), so every
asset URL in the build is relative and the site works under any repository name, and also from a user/organisation
site root or a custom domain.

All runtime asset URLs go through `src/core/assets.ts` (`assetUrl()`), which prefixes `import.meta.env.BASE_URL`.
Use it for any new runtime fetch.

To force an absolute base, set `BASE_PATH`:

```bash
BASE_PATH=/crossfire/ npm run build      # or set it in the workflow's Build step
```

Check a build locally under a sub-path exactly like Pages:

```bash
npm run build
node tools/serve-dist.mjs           # http://localhost:4174/crossfire/
node tools/browser-test.mjs --url http://localhost:4174/crossfire/
```

(In Git Bash on Windows, prefix commands that take `/path/` arguments with `MSYS_NO_PATHCONV=1`.)

## Size

The deployed site is about 46 MB; a player downloads roughly 35 MB (textures 17 MB, town models 14 MB, sky 2 MB,
JavaScript 1.3 MB gzipped, props and audio). The building catalogue and kit GLBs are published but not loaded.
GitHub Pages has a 1 GB site limit and recommends staying well below it.

## Large files

The largest committed files are ~2 MB GLBs, ~2.6 MB `.blend` files and 2K JPG textures. Git LFS is not required.
`.cache/` (texture downloads) and `*.blend1` backups are git-ignored.
