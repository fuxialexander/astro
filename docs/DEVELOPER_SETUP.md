# Astro Developer Setup Guide (Supabase Mode + Cloudflare Tunnel)

Everything a new developer needs to set up Astro from scratch, including all prerequisites.

---

## Phase 1: System Prerequisites

### 1.1 Install Docker

Docker is required to run local Supabase (PostgreSQL, Auth, Realtime, etc.).

**macOS:**

Download Docker Desktop from https://www.docker.com/products/docker-desktop/, install, and start it.

```bash
docker ps   # Verify Docker is running
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect
docker ps
```

### 1.2 Install Node.js 25.6.0

```bash
# Install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Restart your shell, then:
nvm install 25.6.0
nvm use 25.6.0
node --version   # Should print v25.6.0
```

### 1.3 Install Supabase CLI

**macOS:**
```bash
brew install supabase/tap/supabase
```

**Linux:**
```bash
curl -L https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz | tar -xz
sudo mv supabase /usr/local/bin/
supabase --version
```

### 1.4 Install Cloudflare Tunnel (`cloudflared`)

**macOS:**
```bash
brew install cloudflared
```

**Linux (Debian/Ubuntu):**
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
rm cloudflared.deb
```

### 1.5 Install Claude CLI (for Agent SDK auth)

```bash
npm install -g @anthropic-ai/claude-cli
claude login
# Follow the prompts — credentials are saved to ~/.claude/
```

### 1.6 Other tools

```bash
# jq is needed by the Supabase setup script
# macOS: brew install jq
# Linux: sudo apt-get install -y jq

# python3 is needed by the tunnel script to parse JSON
python3 --version   # Should already be installed on most systems
```

---

## Phase 2: Cloudflare Account & Domain Setup

You need a Cloudflare account with a domain you control. This enables HTTPS, WebAuthn (Touch ID/Face ID), and external access.

### 2.1 Sign up for Cloudflare

1. Go to https://dash.cloudflare.com/sign-up
2. Create a free account

### 2.2 Add your domain to Cloudflare

If you don't own a domain yet, you can register one through Cloudflare (~$10-15/year for a `.com`):

1. In Cloudflare dashboard, click **"Add a site"**
2. Enter your domain (e.g., `yourdomain.com`)
3. Select the **Free** plan
4. Cloudflare shows you nameserver records to update
5. Go to your domain registrar, change nameservers to the ones Cloudflare provides
6. Wait for DNS propagation (can take minutes to hours)
7. Cloudflare confirms the domain is active

### 2.3 Authenticate `cloudflared` locally

```bash
cloudflared tunnel login
```

This opens a browser. Select your domain and authorize. Credentials are saved to `~/.cloudflared/cert.pem`.

---

## Phase 3: Clone & Install the Project

```bash
git clone git@github.com:fuxialexander/astro.git
cd astro

# Use the pinned Node version
nvm use   # reads .nvmrc -> v25.6.0

# Install dependencies
npm install
```

---

## Phase 4: Configure Environment Variables

### 4.1 Create your `.env` file

Each developer needs their own `.env`. Create it:

```bash
cat > .env << 'EOF'
NODE_ENV=development
CLOUDFLARED_DOMAIN=yourdomain.com

# Generate unique JWT secrets (each must be different)
RELAY_JWT_SECRET=REPLACE_WITH_64_HEX_CHARS_1
DEVICE_AUTH_JWT_SECRET=REPLACE_WITH_64_HEX_CHARS_2
DEVICE_AUTH_REFRESH_SECRET=REPLACE_WITH_64_HEX_CHARS_3

# Supabase credentials (filled by setup script in Phase 5)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=

# WebAuthn (overridden by tunnel script in Phase 6)
WEBAUTHN_RP_NAME=Astro
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:5173

ALLOWED_HOSTS=localhost
EOF
```

### 4.2 Generate JWT secrets

```bash
# Generate 3 unique 256-bit secrets:
openssl rand -hex 32   # Use for RELAY_JWT_SECRET
openssl rand -hex 32   # Use for DEVICE_AUTH_JWT_SECRET
openssl rand -hex 32   # Use for DEVICE_AUTH_REFRESH_SECRET
```

Replace the `REPLACE_WITH_*` placeholders in `.env` with these values.

### 4.3 Set your Cloudflare domain

In `.env`, replace `yourdomain.com` with your actual domain.

---

## Phase 5: Start Local Supabase

Make sure Docker is running, then:

```bash
bash ./scripts/setup-supabase-local.sh
```

This script:
1. Installs Supabase CLI if missing
2. Checks Docker is running
3. Runs `supabase init` if needed (already done in this repo)
4. Starts Supabase containers (PostgreSQL, Auth, Studio, Realtime, etc.) — first run pulls ~2GB of Docker images
5. Extracts the anon key and service role key
6. Writes them to `.env.local` (auto-created, gitignored)
7. Runs `supabase db reset` to apply all migrations from `supabase/migrations/`

**Expected output:**

```
==================================================
  Supabase is running!
==================================================

Studio (Dashboard): http://localhost:54323
API URL: http://127.0.0.1:54321

Anon Key (public):
eyJhbGciOiJIUzI1NiIs...

Service Role Key (secret, backend only):
eyJhbGciOiJIUzI1NiIs...

✓ Environment variables updated in .env.local
✓ Setup Complete!
```

### Verify Supabase is running

```bash
supabase status
```

Open Studio (database admin UI) at http://localhost:54323.

**Key ports after setup:**

| Service | Port |
|---------|------|
| API (REST + GraphQL) | 54321 |
| PostgreSQL | 54322 |
| Studio (web UI) | 54323 |
| Inbucket (email testing) | 54324 |

---

## Phase 6: Start the Dev Server

### 6.1 Local-only (no tunnel)

```bash
npm run dev
```

This starts concurrently:
- **Vite** frontend on `http://localhost:5173`
- **Hono** backend API on `http://localhost:3001`
- **WebSocket relay** on `http://localhost:3002`

Open http://localhost:5173 in your browser.

### 6.2 With Cloudflare Tunnel (recommended for WebAuthn)

```bash
npm run dev:tunnel
```

This:
1. Starts `npm run dev` in background
2. Waits for both Vite (`:5173`) and backend (`:3001`) to be ready
3. Pre-warms critical routes for faster first load
4. Runs `scripts/start-tunnel.sh` which:
   - Creates a Cloudflare tunnel named `astro` (reuses if exists)
   - Creates DNS CNAME records for all subdomains
   - Writes `~/.cloudflared/config.yml` with route mappings
   - Updates `.env.local` with WebAuthn config for your domain
   - Starts the tunnel

**Result — your URLs:**

| Service | URL |
|---------|-----|
| Frontend | `https://astro.yourdomain.com` |
| Backend API | `https://astro-api.yourdomain.com` |
| WebSocket Relay | `https://astro-relay.yourdomain.com` |
| Supabase (if running) | `https://astro-supabase.yourdomain.com` |

---

## Phase 7: First Login (WebAuthn/Passkeys)

1. Navigate to `https://astro.yourdomain.com` (or `http://localhost:5173`)
2. You'll be redirected to `/login`
3. Click **"Sign Up"**
4. Enter your email
5. Your browser prompts for Touch ID / Face ID / Security Key
6. Authorize it
7. You're logged in and redirected to the welcome page

**Important:** Passkeys are bound to the domain. If you register on `localhost`, those passkeys won't work via the tunnel URL (and vice versa). Use the tunnel URL from the start if you plan to use it.

---

## Phase 8: Verify Everything Works

```bash
npm run verify
```

This checks Node version, npm, git, project files, directories, TypeScript, ESLint, and port availability.

Also verify the backend health:

```bash
curl http://localhost:3001/api/health
```

---

## IndexedDB Mode (Alternative to Supabase)

If you want to skip Supabase entirely and use browser-only storage:

```bash
npm run dev:indexeddb
# Or: USE_INDEXEDDB_ONLY=true VITE_USE_INDEXEDDB_ONLY=true npm run dev
```

No authentication required, single-user, all data in browser IndexedDB.

**Mode detection priority:**
1. `USE_INDEXEDDB_ONLY=true` -> IndexedDB (explicit override)
2. No Supabase env vars -> IndexedDB (auto-detected)
3. Supabase env vars set -> Supabase mode

**Visual indicator:** Sidebar shows "IndexedDB Mode (Local Only)" badge.

---

## GitHub OAuth (Optional)

To enable GitHub repo browsing in the UI:

1. Go to https://github.com/settings/developers
2. Click **"New OAuth App"**
3. Fill in:
   - **Application name:** `Astro Local Dev`
   - **Homepage URL:** `http://localhost:5173`
   - **Authorization callback URL:** `http://localhost:3001/api/github/callback`
4. Note the **Client ID** and generate a **Client Secret**
5. Add to `.env`:
   ```
   GITHUB_CLIENT_ID=your_client_id
   GITHUB_CLIENT_SECRET=your_client_secret
   GITHUB_REDIRECT_URI=http://localhost:3001/api/github/callback
   VITE_FRONTEND_URL=http://localhost:5173
   ```

See `docs/GITHUB_OAUTH_LOCAL_SETUP.md` for full details.

---

## Agent Runner Setup (Optional)

Connect your machine as an execution environment for running tasks:

```bash
bash scripts/agent-setup.sh yourdomain.com
```

This builds the agent runner, detects providers (Claude Code, Codex), runs the device auth flow (approve in browser), and starts the runner. The machine appears in the Environments page.

See `docs/setup/hpc-ssh-setup.md` for remote machine and HPC/Slurm setup.

---

## Database Management

```bash
supabase db reset          # Drop and recreate all tables + auth users
npm run clear-data         # Clear user data only (preserves schema)
npm run clear-data:force   # Clear without confirmation
npm run db:reset           # Full reset (all modes)
npm run db:reset:supabase  # Supabase only
npm run db:reset:indexeddb  # Shows IndexedDB reset instructions
```

---

## Command Reference

| Command | Description |
|---------|-------------|
| `npm run dev` | Full stack: Vite (5173) + Hono (3001) + Relay (3002) |
| `npm run dev:tunnel` | Full stack + Cloudflare tunnel |
| `npm run dev:frontend` | Vite only |
| `npm run dev:backend` | Hono + Relay only |
| `npm run dev:indexeddb` | IndexedDB mode (no Supabase needed) |
| `npm run dev:supabase` | Setup Supabase + start dev |
| `npm run build` | TypeScript check + production build |
| `npm run lint` | ESLint |
| `npm run verify` | Verify setup |
| `supabase status` | Check Supabase containers |
| `supabase stop` | Stop Supabase |

---

## Troubleshooting

### Docker containers won't start

```bash
docker ps -a                    # Check for stuck containers
supabase stop                   # Clean stop
docker system prune -f          # Clean up dangling resources
supabase start                  # Retry
```

### Port already in use

```bash
lsof -ti:5173 | xargs kill -9  # Kill Vite
lsof -ti:3001 | xargs kill -9  # Kill Backend
lsof -ti:3002 | xargs kill -9  # Kill Relay
```

### Tunnel DNS not resolving

DNS propagation can take a few minutes after first `cloudflared tunnel route dns`. Verify in Cloudflare dashboard: DNS > check for CNAME records pointing to `<tunnel-id>.cfargotunnel.com`.

### WebAuthn fails on localhost

Touch ID only works over HTTPS (use the tunnel). On plain `http://localhost`, you get a security key prompt instead. Use `npm run dev:tunnel` to get HTTPS.

### Backend not responding through tunnel

The tunnel script warns if `:3001` isn't listening. Make sure `npm run dev` is running before the tunnel starts. Check `curl http://localhost:3001/api/health` directly.

### Supabase first-run is slow

First `supabase start` downloads ~2GB of Docker images. Subsequent starts are fast (seconds).

### Stale `.env.local`

Delete it and re-run setup:

```bash
rm .env.local
bash scripts/setup-supabase-local.sh
bash scripts/start-tunnel.sh
```

### Full clean start

```bash
bash scripts/clean-start.sh
# Reinstalls deps, rebuilds, resets DB
```

---

## Production Deployment

**Architecture:**

```
Frontend:  Cloudflare Pages (static, free)
Backend:   Fly.io (Hono API + SSE + WebSocket relay)
Database:  Supabase Cloud (PostgreSQL + Auth)
```

**Deploy:**

```bash
npm run deploy           # Deploy both backend + frontend
npm run deploy:backend   # Fly.io only
npm run deploy:frontend  # Cloudflare Pages only
```

**Key production env vars:**

| Variable | Value | Purpose |
|----------|-------|---------|
| `VITE_API_BASE_URL` | `https://astro-backend.fly.dev` | SSE goes direct to Fly.io (bypasses Cloudflare) |
| `WEBAUTHN_RP_ID` | `astro.yourdomain.com` | Passkey domain binding |
| `WEBAUTHN_ORIGIN` | `https://astro.yourdomain.com` | WebAuthn origin check |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Backend Supabase access |
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | Frontend Supabase access |

SSE goes direct to Fly.io because Cloudflare's proxy buffers SSE responses, causing timeouts.
