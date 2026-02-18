# Nexus Setup Guide

## Prerequisites

- **Node.js** 25.6.0+ (use [nvm](https://github.com/nvm-sh/nvm) with included `.nvmrc`)
- **npm** 11.8.0+
- **Git**
- **Claude CLI** authenticated via `claude login` (credentials in `~/.claude/`)

### Optional

- **Supabase CLI + Docker**: For multi-user mode with authentication
- **cloudflared**: For Cloudflare Tunnel (external access / Touch ID on custom domain)

## Quick Start

```bash
git clone git@github.com:fuxialexander/nexus.git
cd nexus
nvm use
npm install
cp .env.example .env
npm run dev
```

Visit http://localhost:5173. Backend runs on http://localhost:3001, relay on ws://localhost:3002.

## Database Modes

### IndexedDB Mode (Default)

No auth, no setup, all data in browser. Perfect for local dev.

```bash
npm run dev              # Auto-detected if no Supabase env vars
npm run dev:indexeddb    # Explicit override
```

### Supabase Mode (Multi-user)

WebAuthn passkey auth, PostgreSQL, user isolation via RLS.

```bash
supabase start                        # Start local Supabase (Docker)
bash ./scripts/setup-supabase-local.sh  # Write env vars to .env.local
npm run dev                            # Auto-detects Supabase
```

Or: `npm run dev:supabase` (runs both steps).

**Mode detection priority:**
1. `USE_INDEXEDDB_ONLY=true` -> IndexedDB (explicit override)
2. No Supabase env vars -> IndexedDB (auto-detected)
3. Supabase env vars set -> Supabase mode

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Full stack: Vite (5173) + Hono (3001) + Relay (3002) |
| `npm run dev:frontend` | Vite only |
| `npm run dev:backend` | Hono + Relay only |
| `npm run dev:tunnel` | Full stack + Cloudflare Tunnel |
| `npm run build` | TypeScript check + Vite production build |
| `npm run lint` | ESLint |

## Cloudflare Tunnel (External Access)

The tunnel provides HTTPS for your local dev server, enabling Touch ID/Face ID on a custom domain and external access.

### Architecture

```
Browser --> Cloudflare Tunnel (HTTPS) --> Vite (HTTP :5173) --> proxy /api --> Backend (HTTP :3001)
```

- Vite serves HTTP locally; the tunnel provides HTTPS externally
- SSE goes through Vite's proxy (no Cloudflare buffering issues)
- HMR works via WebSocket through the tunnel

### Setup

1. Install cloudflared: `brew install cloudflared`
2. Login: `cloudflared tunnel login`
3. Set domain in `.env`:
   ```
   CLOUDFLARED_DOMAIN=yourdomain.com
   ```
4. Start everything:
   ```bash
   npm run dev:tunnel
   ```

This starts the dev servers, waits for readiness, pre-warms Vite, then starts the tunnel. Your app is available at `https://nexus.yourdomain.com`.

### What the tunnel script does

- Creates/reuses a tunnel named `nexus`
- Sets up DNS routes: `nexus.`, `nexus-api.`, `nexus-relay.`, `nexus-supabase.` subdomains
- Writes tunnel-compatible env vars to `.env.local` (ALLOWED_HOSTS, HMR config, WebAuthn RP ID)
- Auto-detects whether Supabase is running and includes/skips that route

### Scripts

| Script | Use case |
|--------|----------|
| `npm run dev:tunnel` | Start full stack + tunnel (recommended) |
| `bash scripts/start-tunnel.sh` | Start tunnel only (servers already running) |
| `bash scripts/start-tunnel-with-supabase.sh` | Tunnel only, requires Supabase running |

## Agent Runner Setup

Connect your machine (or remote machines) as execution environments.

```bash
bash scripts/agent-setup.sh yourdomain.com
```

This:
1. Builds the agent runner
2. Detects providers (Claude Code, Codex)
3. Runs device auth flow (approve in browser)
4. Configures MCP bridge for Claude Code
5. Starts the agent runner

### Remote Machines

SSH into the remote machine, install the agent runner, and run:

```bash
~/.local/bin/nexus-agent start --foreground
```

Approve the device in the browser. The machine appears in the Environments page.

## Production Deployment

### Architecture

```
Frontend:  Cloudflare Pages (static, free)
Backend:   Fly.io (Hono API + SSE + WebSocket relay)
Database:  Supabase Cloud (PostgreSQL + Auth)
```

### Key Environment Variables (Production)

| Variable | Value | Purpose |
|----------|-------|---------|
| `VITE_API_BASE_URL` | `https://nexus-backend.fly.dev` | SSE goes direct to Fly.io (bypasses Cloudflare) |
| `WEBAUTHN_RP_ID` | `nexus.yourdomain.com` | Passkey domain binding |
| `WEBAUTHN_ORIGIN` | `https://nexus.yourdomain.com` | WebAuthn origin check |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Backend Supabase access |
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | Frontend Supabase access |

### Why SSE goes direct to Fly.io

Cloudflare's proxy buffers SSE responses, causing timeouts. The frontend connects to the Fly.io backend directly for SSE (`VITE_API_BASE_URL`). Regular page loads still go through Cloudflare Pages.

### Deploy

```bash
npm run deploy           # Deploy both backend + frontend
npm run deploy:backend   # Fly.io only
npm run deploy:frontend  # Cloudflare Pages only
```

### Cost Estimate

| Service | Tier | Monthly |
|---------|------|---------|
| Cloudflare Pages | Free | $0 |
| Fly.io Backend | 1x shared-cpu, 256MB | ~$5 |
| Supabase | Free tier (500MB) | $0 |
| **Total** | | **~$5** |

## Database Management

```bash
supabase db reset          # Drop and recreate all tables (including auth users)
npm run clear-data         # Clear user data only (preserves schema)
npm run clear-data:force   # Clear without confirmation
npm run db:reset           # Reset everything
```

## Troubleshooting

### Port in use

```bash
lsof -ti:5173 | xargs kill -9
lsof -ti:3001 | xargs kill -9
```

### Stale tokens after DB reset

```bash
node ./packages/agent-runner/dist/cli.js config --reset
bash scripts/agent-setup.sh yourdomain.com
```

### Touch ID shows QR code instead

Passkeys are bound to the RP ID (domain). If you registered on `localhost`, those passkeys won't work on `nexus.yourdomain.com`. Reset the database (`supabase db reset`) and re-register on the correct domain.

### Full clean start

```bash
bash scripts/clean-start.sh  # Nuclear: reinstall deps, rebuild, reset DB
```
