# Org Deployment Guide

How multiple members of an organization can deploy Astro independently from their own machines, sharing the same production infrastructure.

## Overview

In an org deployment, everyone shares:
- **One Fly.io app** (backend + relay)
- **One Cloudflare Pages project** (frontend)
- **One Supabase project** (database)

But each person deploys from their own machine using their own CLI credentials. There is no CI/CD requirement — any authorized member can run `npm run deploy` and it pushes to the shared infrastructure.

## Prerequisites per Member

Each team member needs the following on their machine:

| Requirement | How to get it |
|-------------|---------------|
| **Node.js 25.6+** | `nvm use` (reads `.nvmrc`) |
| **Fly.io CLI** | `brew install flyctl` then `fly auth login` |
| **Fly.io org access** | Org admin adds you via `fly orgs invite <email>` or the Fly.io dashboard |
| **Cloudflare access** | Either: (a) team member on the Cloudflare account, or (b) a shared `CLOUDFLARE_API_TOKEN` |
| **Supabase credentials** | Shared project URL, anon key, service role key, database URL |
| **Claude CLI** | `claude login` (for agent runner, not needed for deploy) |
| **Repo clone** | `git clone --recurse-submodules` |

## Fly.io Setup

### Org-level app ownership

The Fly.io app should be owned by an **organization**, not a personal account. This lets multiple people deploy to it.

```bash
# Create org (one-time, by the admin)
fly orgs create my-org

# Create app under the org (one-time)
fly apps create <your-fly-app> --org my-org

# Invite team members
fly orgs invite my-org member@example.com
```

### Per-member authentication

Each member runs:

```bash
fly auth login
```

This opens a browser for Fly.io login. Once authenticated, anyone in the org can deploy to the shared app.

### Verify access

```bash
fly apps list --org my-org
# Should show <your-fly-app>

fly status --app <your-fly-app>
# Should show current deployment status
```

## Cloudflare Pages Setup

There are two approaches for Cloudflare access:

### Option A: Shared API token (simpler)

The admin creates a scoped API token and shares it with the team:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) > My Profile > API Tokens
2. Create a token with **Cloudflare Pages: Edit** permission
3. Share the token securely with team members

Each member sets in their `.env.prod`:
```bash
CLOUDFLARE_API_TOKEN=<shared-token>
CLOUDFLARE_ACCOUNT_ID=<account-id>
```

The deploy script passes `CLOUDFLARE_ACCOUNT_ID` to Wrangler automatically, which prevents the "multiple accounts" interactive prompt.

### Option B: Team member access

Add each person to the Cloudflare account:
1. Cloudflare Dashboard > Manage Account > Members
2. Invite by email with appropriate permissions

Each member then authenticates Wrangler themselves:
```bash
npx wrangler login
```

They still need `CLOUDFLARE_ACCOUNT_ID` in `.env.prod` if they belong to multiple Cloudflare accounts.

## Supabase Setup

Supabase credentials are project-level, not per-user. The admin shares these values with the team:

| Value | Where to find it |
|-------|-----------------|
| `SUPABASE_URL` | Settings > API > Project URL |
| `SUPABASE_ANON_KEY` | Settings > API > `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings > API > `service_role` key (click Reveal) |
| `DATABASE_URL` | Settings > Database > Connection string (Transaction mode, port 6543) |

Everyone uses the same values. These go in each person's `.env.prod`.

## Per-Member `.env.prod` Template

Each team member creates their own `.env.prod` (git-ignored) with these values:

```bash
# ── Shared across the team (same for everyone) ──────────────

# Fly.io app name (must match fly.toml)
FLY_APP=<your-fly-app>

# Supabase credentials
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres

# Frontend build vars (baked into JS bundle)
VITE_API_BASE_URL=https://<your-fly-app>.fly.dev
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# JWT secrets (shared — all team members use the same ones)
RELAY_JWT_SECRET=<shared-secret>
DEVICE_AUTH_JWT_SECRET=<shared-secret>
DEVICE_AUTH_REFRESH_SECRET=<shared-secret>

# Cloudflare Pages project
CLOUDFLARE_PAGES_PROJECT=astro-app

# WebAuthn / CORS (derived from your frontend domain)
FRONTEND_URL=https://your-frontend-domain.com
CORS_ORIGIN=https://your-frontend-domain.com
WEBAUTHN_RP_ID=your-frontend-domain.com
WEBAUTHN_ORIGIN=https://your-frontend-domain.com
ASTRO_BASE_URL=https://your-frontend-domain.com

# ── Per-member (may differ) ─────────────────────────────────

# Cloudflare API token (if using shared token approach)
CLOUDFLARE_API_TOKEN=<your-token-or-shared-token>
CLOUDFLARE_ACCOUNT_ID=<account-id>
```

> **Tip:** The admin can create a `env.prod.template` file (git-ignored) with all shared values filled in, and share it via a secure channel (1Password, Vault, etc.). Each member copies it to `.env.prod` and fills in their personal tokens.

## Deploy Workflow

### Switch to prod mode (once per session)

```bash
npm run env:prod    # Symlinks .env.local -> .env.prod
```

### Deploy frontend only

```bash
npm run deploy:frontend
```

This runs `npm run build` (with `VITE_*` vars from `.env.local`) then `wrangler pages deploy`.

### Deploy backend only

```bash
npm run deploy:backend
```

This pushes CORS/WebAuthn secrets to Fly.io and runs `fly deploy`.

### Deploy everything

```bash
npm run deploy
```

### Check status

```bash
npm run deploy -- --status
# or: fly status --app <your-fly-app>
```

## Gotchas

### Wrangler multi-account prompt

If a team member belongs to multiple Cloudflare accounts, Wrangler will interactively ask which account to use — which breaks in scripts. Set `CLOUDFLARE_ACCOUNT_ID` in `.env.prod` to avoid this. The deploy script passes it to Wrangler automatically.

### Fly.io app name must match fly.toml

The `app` field in `fly.toml` and the `FLY_APP` value in `.env.prod` must be identical. If they don't match, `fly deploy` will target the wrong app or fail. Fly.io app names are globally unique.

### VITE_* vars are baked into the frontend bundle

`VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` are embedded in the JavaScript at build time. If you change them, you must rebuild and redeploy the frontend. They are NOT read at runtime.

### Branch deploys change the frontend URL

When deploying from a non-main branch, Cloudflare Pages creates a preview URL like `https://<branch>.<project>.pages.dev`. The deploy script auto-updates Fly.io secrets (CORS, WebAuthn) for non-main branches. When switching back to main, re-deploy the backend to restore production secrets.

### JWT secrets must be shared

All three JWT secrets (`RELAY_JWT_SECRET`, `DEVICE_AUTH_JWT_SECRET`, `DEVICE_AUTH_REFRESH_SECRET`) must be the same for every team member. They are pushed to Fly.io as secrets and used by the server at runtime. If members use different values, the last deployer's secrets win and everyone else's agent runners will fail to authenticate.

### Concurrent deploys

Fly.io and Cloudflare Pages handle concurrent deploys gracefully — the last deploy wins. Coordinate with your team to avoid deploying conflicting code simultaneously.
