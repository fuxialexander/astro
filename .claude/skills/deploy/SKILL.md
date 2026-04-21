---
name: deploy
description: >-
  Deploy the Astro platform to production (Fly.io backend + Cloudflare Pages frontend)
  and/or release the Electron desktop app to GitHub Releases. Handles pre-flight checks:
  dirty working tree detection, switching to main, pulling latest, building, and deploying.
  Use this skill when the user says "deploy", "push to prod", "ship it to production",
  "deploy backend", "deploy frontend", "release to prod", "go live", "release electron",
  "release desktop app", "publish desktop", or wants to deploy the Astro app. Also
  triggers for "deploy status" or "check deploy".
---

# Deploy Skill

Deploys the Astro platform to production. Three independent deployment targets:

| Component | Platform | URL / Repo | Command |
|-----------|----------|-----------|---------|
| Backend | Fly.io | `https://astro-backend-deploy.fly.dev` | `npm run deploy:backend` |
| Frontend | Cloudflare Pages | `https://astro-app.pages.dev` | `npm run deploy:frontend` |
| Both web | Fly.io + Cloudflare | — | `npm run deploy` |
| Desktop app | GitHub Releases (`astro-anywhere/astro-desktop`) | — | `npm run electron:publish` |

The desktop release is independent of the web deploy — you can do either or both.

---

## Pre-flight (all targets)

### Step 1: Check for dirty working tree

```bash
git status --porcelain
```

If there are uncommitted changes, **stop and ask the user** how they want to proceed:

1. **Stash** — `git stash` (restore later with `git stash pop`)
2. **Commit** — stage and commit before deploying
3. **Discard** — `git checkout .` (destructive — confirm first)
4. **Abort** — cancel the deployment

Do NOT silently stash or discard. The user must choose.

If `packages/agent-runner` shows as modified (submodule pointer or dirty
`package-lock.json`), note this separately — it is usually safe to stash.

### Step 2: Switch to main and pull latest

```bash
git checkout main
git pull --rebase origin main
```

If the rebase fails, stop and tell the user. Do not force-pull.

### Step 3: Switch to prod environment

```bash
npm run env:prod
```

Symlinks `.env.local → .env.prod` (Supabase, Fly.io, Cloudflare, signing creds).
If `.env.prod` doesn't exist, tell the user to run `npm run env:init` first.

---

## Web deploy (backend + frontend)

### Step 4a: Build web

```bash
npm run build
```

Runs `tsc -b && vite build`. Stop on any errors — do not deploy broken builds.

### Step 5a: Deploy web

| User says | Command | What it does |
|-----------|---------|-------------|
| "deploy" / "deploy all" | `npm run deploy` | Fly.io + Cloudflare Pages |
| "deploy backend" | `npm run deploy:backend` | Fly.io only |
| "deploy frontend" | `npm run deploy:frontend` | Cloudflare Pages only |

`scripts/deploy.sh` validates env vars, pushes secrets to Fly.io, runs
`fly deploy --remote-only`, runs `wrangler pages deploy dist`, and health-checks
the backend.

### Step 6a: Verify web

```bash
curl -s https://astro-backend-deploy.fly.dev/api/health
fly status --app astro-backend-deploy
```

Report backend health and frontend URL.

---

## Electron desktop release

### Step 4b: Prerequisites check

Verify these before building:

```bash
# GitHub CLI authenticated (used to get GITHUB_TOKEN)
gh auth status

# electron-forge publish needs a GitHub token — check it resolves
gh auth token
```

Also verify `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are set in `.env.prod`
for macOS code signing and notarization. Without them, the build succeeds but produces
an unsigned app that will be quarantined by Gatekeeper.

```bash
grep -E "APPLE_ID|APPLE_PASSWORD|APPLE_TEAM_ID" .env.prod
```

If any are missing, warn the user — they can still proceed but the app will be unsigned.

### Step 5b: Build and publish the Electron app

```bash
npm run electron:publish
```

This single command does everything:
1. **`build:binaries`** (npm mode) — installs `@astroanywhere/agent@latest` and
   `@astroanywhere/cli@latest` from npm, esbuild-bundles them into
   `electron/resources/binaries/astro-agent.mjs` and `astro-cli.mjs`
2. **`electron-forge make`** — Vite-builds the renderer, compiles the main process,
   packages the app with `afterCopy` native modules, runs macOS code signing +
   notarization (if Apple creds present), and produces installers:
   - `astro-X.Y.Z.dmg` (macOS)
   - `astro-X.Y.Z-arm64.zip` + `astro-X.Y.Z-x64.zip` (macOS universal zips)
   - `AstroSetup.exe` (Windows Squirrel)
   - `.deb` + `.rpm` (Linux)
3. **`electron-forge publish`** — uploads all installers to a new GitHub Release
   on `github.com/astro-anywhere/astro-desktop` (draft: false, prerelease: false)

The script sources `.env.prod` and resolves `GITHUB_TOKEN` via `gh auth token` if
not already set.

**This command takes 5–15 minutes** due to native module rebuild, Vite build,
code signing, and upload.

### Step 6b: Verify desktop release

```bash
# Check the release was created
gh release list --repo astro-anywhere/astro-desktop --limit 5

# View the latest release assets
gh release view --repo astro-anywhere/astro-desktop
```

Report the release tag, asset list, and GitHub Releases URL.

---

## Doing both web + desktop in one shot

When the user says "release everything" or "full release":

```bash
# 1. Pre-flight (Steps 1–3 above)
git checkout main && git pull --rebase origin main
npm run env:prod

# 2. Web build + deploy
npm run build
npm run deploy

# 3. Desktop build + publish
npm run electron:publish
```

Run steps 2 and 3 sequentially (desktop publish is independent but both need
the repo on main with a clean tree).

---

## Quick Reference

```bash
# Web only
git checkout main && git pull --rebase origin main
npm run env:prod && npm run build && npm run deploy

# Desktop only
git checkout main && git pull --rebase origin main
npm run env:prod && npm run electron:publish

# Both
git checkout main && git pull --rebase origin main
npm run env:prod
npm run build && npm run deploy
npm run electron:publish
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Missing `VITE_API_BASE_URL` | `.env.prod` not configured | Run `npm run env:init`, edit `.env.prod` |
| `fly` not found | Fly CLI not installed | `brew install flyctl` |
| `wrangler` not found | Cloudflare CLI not installed | `npm install -g wrangler` |
| Build fails (TypeScript) | Type errors | Fix before deploying |
| Fly deploy fails | Docker / health check | `fly logs --app astro-backend-deploy` |
| Rebase conflicts | Main diverged | Resolve conflicts, retry |
| `electron-forge publish` fails — no GitHub token | `GITHUB_TOKEN` unset and `gh` not authenticated | Run `gh auth login` |
| `electron-forge publish` fails — signing error | Apple creds missing or expired | Check `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` in `.env.prod` |
| Notarization timeout | Apple notary slow | Wait and retry; check Apple developer portal |
| `build:binaries` fails — npm registry error | Network issue or package not published | Check npm status; use `--local` flag temporarily: `npm run build:binaries:local` |
| Native module rebuild fails (`node-pty`) | Electron ABI mismatch | Run `npx electron-rebuild -f -w node-pty` |

---

## Important Rules

- Always deploy from `main`. Never deploy from a feature branch to production.
- Always build before deploying. The initial `npm run build` catches TypeScript errors early.
- Never skip the dirty-tree check. Deploying uncommitted changes makes rollbacks unreliable.
- The desktop publish always pulls `@astroanywhere/agent@latest` and
  `@astroanywhere/cli@latest` from npm — make sure those packages have been
  published before running `electron:publish` if you want the latest agent changes included.
- If the user only wants to deploy one target (backend / frontend / desktop), respect that.
  Do not deploy the others unless asked.
