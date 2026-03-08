---
name: deploy
description: >-
  Deploy the Astro platform to production (Fly.io backend + Cloudflare Pages frontend).
  Handles pre-flight checks: dirty working tree detection, switching to main, pulling
  latest, building, and deploying. Use this skill when the user says "deploy", "push to
  prod", "ship it to production", "deploy backend", "deploy frontend", "release to prod",
  "go live", or wants to deploy the Astro app. Also triggers for "deploy status" or
  "check deploy".
---

# Deploy Skill

Deploys the Astro platform to production: backend on Fly.io, frontend on Cloudflare
Pages. This skill ensures the working tree is clean, the code is on the latest `main`,
and the build passes before deploying.

## Deployment Targets

| Component | Platform | URL | Command |
|-----------|----------|-----|---------|
| Backend | Fly.io | `https://astro-backend-deploy.fly.dev` | `npm run deploy:backend` |
| Frontend | Cloudflare Pages | `https://astro-app.pages.dev` | `npm run deploy:frontend` |
| Both | Fly.io + Cloudflare | — | `npm run deploy` |

## Workflow

### Step 1: Check for dirty working tree

```bash
git status --porcelain
```

If there are uncommitted changes, **stop and ask the user** how they want to proceed.
Present these options:

1. **Stash changes** — `git stash` (can restore later with `git stash pop`)
2. **Commit changes** — stage and commit before deploying
3. **Discard changes** — `git checkout .` (destructive — confirm first)
4. **Abort** — cancel the deployment

Do NOT silently stash or discard. The user must choose.

If the submodule `packages/agent-runner` shows as modified (dirty `package-lock.json`
or pointer change), note this separately — submodule pointer changes are common and
usually safe to stash.

### Step 2: Switch to main and pull latest

```bash
git checkout main
git pull --rebase origin main
```

If the rebase fails due to conflicts, stop and tell the user. Do not force-pull.

### Step 3: Switch to prod environment

```bash
npm run env:prod
```

This symlinks `.env.local` to `.env.prod`, which contains production credentials
(Supabase URL, API base URL, Cloudflare config, Fly.io app name).

If `.env.prod` doesn't exist, tell the user to run `npm run env:init` first and
fill in their production credentials.

### Step 4: Build

```bash
npm run build
```

This runs `tsc -b && vite build`. If the build fails, stop and show the errors.
Do not deploy broken builds.

### Step 5: Deploy

Run the deployment based on what the user requested:

| User says | Command | What it does |
|-----------|---------|-------------|
| "deploy" / "deploy all" | `npm run deploy` | Backend (Fly.io) + Frontend (Cloudflare) |
| "deploy backend" | `npm run deploy:backend` | Fly.io only |
| "deploy frontend" | `npm run deploy:frontend` | Cloudflare Pages only |
| "deploy status" | `npm run deploy -- --status` | Show Fly.io app status |

The deploy script (`scripts/deploy.sh`) handles:
- Sourcing `.env` + `.env.local` for credentials
- Validating required env vars (`VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, etc.)
- Pushing CORS/WebAuthn secrets to Fly.io
- Running `fly deploy --remote-only` for backend
- Running `wrangler pages deploy dist` for frontend
- Health check after backend deploy

### Step 6: Verify

After deployment completes:

```bash
# Check backend health
curl -s https://astro-backend-deploy.fly.dev/api/health

# Check Fly.io status
fly status --app astro-backend-deploy
```

Report the deployment result to the user, including:
- Backend URL and health status
- Frontend URL (production or branch preview)
- Any warnings from the deploy output

## Quick Reference

Full deploy from clean state:

```bash
git checkout main
git pull --rebase origin main
npm run env:prod
npm run build
npm run deploy
```

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Missing `VITE_API_BASE_URL` | `.env.prod` not configured | Run `npm run env:init`, edit `.env.prod` |
| `fly` command not found | Fly CLI not installed | `brew install flyctl` or `curl -L https://fly.io/install.sh \| sh` |
| `wrangler` not found | Cloudflare CLI not installed | `npm install -g wrangler` |
| Build fails (TypeScript) | Type errors in code | Fix errors before deploying |
| Fly deploy fails | Docker build or health check failure | Check `fly logs --app astro-backend-deploy` |
| Rebase conflicts | Main has diverged | Resolve conflicts manually, then retry |

## Important Rules

- Always deploy from `main`. Never deploy from a feature branch to production.
- Always build before deploying. The deploy script builds frontend again for
  Cloudflare, but the initial `npm run build` catches TypeScript errors early.
- Never skip the dirty-tree check. Deploying with uncommitted changes means the
  deployed code doesn't match any git commit, making rollbacks unreliable.
- If the user only wants to deploy backend or frontend (not both), respect that.
  Don't deploy the other component unless asked.
