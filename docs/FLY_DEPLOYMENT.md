# Fly.io Deployment

## How the Code Maps to Deployed Services

Astro is a monorepo with three independent components that communicate only over the network:

```
YOUR REPO
│
├── src/                        ──► FRONTEND  (user's browser)
│   ├── pages/                      Vite builds src/ into dist/ (static HTML/JS/CSS).
│   ├── components/                 Deployed to Cloudflare Pages.
│   ├── stores/                     Runs entirely in the browser.
│   ├── lib/
│   │   ├── api-client.ts           Calls backend via fetch().
│   │   ├── api-url.ts              Resolves backend URL from VITE_API_BASE_URL.
│   │   └── realtime-client.ts      SSE connection to backend /api/events/stream.
│   └── types/
│
├── server/                     ──► BACKEND  (Fly.io VM)
│   ├── index.ts                    Single Node.js process. Runs via tsx.
│   ├── routes/                     Hono HTTP API on port 3001.
│   ├── lib/
│   │   ├── relay-server.ts         WebSocket relay on port 3002.
│   │   ├── dispatch/               Task dispatch engine.
│   │   ├── providers/              Claude Code / Codex / SLURM adapters.
│   │   ├── machine-registry.ts     In-memory connected machine tracking.
│   │   ├── db/index.ts             Postgres connection (Supabase).
│   │   └── events/                 SSE event transport.
│   └── types/
│
└── packages/
    └── agent-runner/           ──► USER APP  (user's machine)
        Separate npm package.       Installed via: npm install -g @astro/agent
        Own package.json.           Runs on laptops, HPC nodes, cloud VMs.
        Own build.                  Connects outbound to the relay via WebSocket.
```

| Component | Code | Runs on | Deployed to | How |
|-----------|------|---------|-------------|-----|
| Frontend | `src/` | User's browser | Cloudflare Pages | `vite build` → `wrangler pages deploy dist` |
| Backend + Relay | `server/` | Fly.io VM | Fly.io | Docker image → `fly deploy` |
| Agent Runner | `packages/agent-runner/` | User's machine | npm registry | `npm publish` → user runs `npm install -g @astro/agent` |

### How they connect

```
┌─────────────────────────────────────────────────────────┐
│  USER'S BROWSER                                         │
│                                                         │
│  Cloudflare Pages serves dist/index.html + JS/CSS.      │
│  React app boots, renders the UI.                       │
│  Calls backend via fetch("https://astro-backend.fly.dev │
│  /api/...") — cross-origin, needs CORS.                 │
│                                                         │
│  Code: src/                                             │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │ HTTPS (REST + SSE)
                       │ Cross-origin requests (CORS)
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  FLY.IO VM  (one Node.js process, two ports)            │
│                                                         │
│  Port 3001 — Hono HTTP API                              │
│  Exposed externally on :443 (HTTPS, Fly.io terminates   │
│  TLS automatically).                                    │
│    /api/health        health check                      │
│    /api/agent/*       plan generation + chat (SSE)      │
│    /api/dispatch/*    task execution                    │
│    /api/events/*      SSE event stream to browser       │
│    /api/data/*        CRUD for projects, plans, etc.    │
│    /api/auth/*        WebAuthn passkey login            │
│    /api/device/*      device code auth for agent runner │
│    /api/relay/*       machine management HTTP API       │
│                                                         │
│  Port 3002 — WebSocket Relay                            │
│  Exposed externally on :3002 (TLS).                     │
│    Agent runners connect here via WSS.                  │
│    Routes tasks to machines, streams output back.       │
│    Shares machineRegistry + dispatchEngine with API.    │
│                                                         │
│  Code: server/                                          │
└──────────┬─────────────────────────────┬────────────────┘
           │                             │
           │ Postgres (TCP)              │ WebSocket (WSS)
           ▼                             ▼
┌──────────────────────┐   ┌──────────────────────────────┐
│  SUPABASE CLOUD      │   │  USER'S MACHINE              │
│                      │   │                              │
│  PostgreSQL          │   │  @astro/agent (agent runner) │
│    All persistent    │   │  Connects outbound to relay. │
│    state.            │   │  Receives tasks, executes    │
│  Auth                │   │  them locally, streams       │
│    User sessions.    │   │  output back to the relay.   │
│  Realtime            │   │                              │
│    Multi-device      │   │  Code: packages/agent-runner/ │
│    sync.             │   │                              │
└──────────────────────┘   └──────────────────────────────┘
```

### Why this architecture

- **Frontend on CDN**: Cloudflare Pages is free, globally distributed, scales infinitely. No backend CPU spent serving static files.
- **Single backend process**: The Hono API and WebSocket relay share in-memory state (`machineRegistry`, `dispatchEngine`, `astroEventTransport`). Splitting them into two processes would require Redis for all shared state — complexity for zero gain at our scale.
- **Relay on port 3002**: Fly.io exposes it with TLS directly. Agent runners connect to `wss://astro-backend.fly.dev:3002`. Some corporate firewalls block non-443 ports; this is a known limitation for beta.
- **Monorepo is fine**: The three components share no runtime code. The only coupling is one git repo and one root `package.json`. The Docker image for the backend carries frontend npm dependencies (React, Radix, etc.) in `node_modules/` — needed at build time but dead weight at runtime. This makes the image ~200MB larger than it could be, but not worth restructuring for beta.

---

## Deployment Files

```
docker/
├── Dockerfile              # Backend + relay production image
├── docker-compose.yml      # Local self-hosted: app + redis
└── .dockerignore
fly.toml                    # Fly.io app config (must be at repo root)
.dockerignore               # Root-level Docker build context filter
scripts/deploy-fly.sh       # Manual deploy script
.github/workflows/fly-deploy.yml  # Auto-deploy on push to main
```

---

## Prerequisites

1. **Fly.io CLI** installed and authenticated
2. **Supabase project** with schema migrations applied
3. **Anthropic API key** for plan generation
4. **Wrangler CLI** (for Cloudflare Pages frontend deploy)

```bash
# Install Fly CLI
brew install flyctl            # macOS
# or: curl -L https://fly.io/install.sh | sh

fly auth login
```

---

## Step-by-Step Deployment

### Step 1: Create the Fly.io app

```bash
# Only needed once. Skip if app already exists.
fly apps create astro-backend --org personal
```

Verify: `fly apps list` should show `astro-backend`.

### Step 2: Set secrets

Every env var below is injected at runtime by Fly.io. They never appear in code, config files, or Docker images.

```bash
# ─── JWT secrets (all three MUST be unique, 256-bit) ───
fly secrets set \
  RELAY_JWT_SECRET="$(openssl rand -hex 32)" \
  DEVICE_AUTH_JWT_SECRET="$(openssl rand -hex 32)" \
  DEVICE_AUTH_REFRESH_SECRET="$(openssl rand -hex 32)" \
  --app astro-backend

# ─── Supabase ───
# DATABASE_URL:     Supabase Dashboard → Settings → Database → Connection string → URI (use "Transaction" / pooler mode, port 6543)
# SUPABASE_URL:     Supabase Dashboard → Settings → API → Project URL
# SUPABASE_ANON_KEY / SERVICE_ROLE_KEY: same page → Project API Keys
fly secrets set \
  DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres" \
  SUPABASE_URL="https://<project-ref>.supabase.co" \
  SUPABASE_ANON_KEY="eyJ..." \
  SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
  --app astro-backend

# ─── Anthropic (console.anthropic.com → API Keys) ───
fly secrets set ANTHROPIC_API_KEY="sk-ant-..." --app astro-backend

# ─── WebAuthn (passkey login) ───
# For beta, use the fly.dev domain. Change to custom domain later.
fly secrets set \
  WEBAUTHN_RP_ID="astro-backend.fly.dev" \
  WEBAUTHN_ORIGIN="https://astro-backend.fly.dev" \
  --app astro-backend

# ─── CORS (allow frontend to call backend cross-origin) ───
# Set these to whatever URL(s) your frontend is served from.
fly secrets set \
  CORS_ORIGIN="https://astro-app.pages.dev" \
  FRONTEND_URL="https://astro.fuxialexander.work" \
  --app astro-backend
```

Verify secrets are set (shows names only, not values):

```bash
fly secrets list --app astro-backend
```

### Step 3: Deploy backend

```bash
fly deploy --app astro-backend
```

What happens:
1. Fly reads `fly.toml` → finds `docker/Dockerfile`
2. Sends the repo to Fly's remote builder
3. Builder runs the multi-stage Docker build: `npm ci` → `npm run build` (`tsc -b && vite build`) → copies artifacts into a slim production image
4. Pushes the image to Fly's internal registry
5. Starts a VM in the `sjc` (San Jose) region
6. Runs health checks against `GET /api/health`

**Expected build output** (key lines):

```
==> Building image with Docker
[stage builder] npm ci
[stage builder] npm run build
  tsc -b && vite build
  ✓ 2613 modules transformed
  ✓ built in 4s
[stage production] COPY --from=builder ...
==> Pushing image
==> Creating release
==> Monitoring deployment
  1 desired, 1 placed, 1 healthy, 0 unhealthy
--> v1 deployed successfully
```

Verify:

```bash
curl -s https://astro-backend.fly.dev/api/health | python3 -m json.tool
```

Expected response:
```json
{
  "status": "ok",
  "mode": "supabase",
  "authenticated": true,
  "providers": { "total": 3, "available": 0, "authenticated": 0 },
  "defaultProvider": null
}
```

- `"mode": "supabase"` confirms Supabase connection is working.
- `"defaultProvider": null` is normal — the Fly.io VM doesn't have Claude Code installed locally. Task execution happens on user machines via the relay.
- `"authenticated": true` means the server itself is healthy. Provider auth is separate (for local exec, not plan generation).

### Step 4: Deploy frontend

```bash
# Build with the backend URL baked into the JS bundle
VITE_API_BASE_URL=https://astro-backend.fly.dev npm run build

# Deploy static files to Cloudflare Pages
wrangler pages deploy dist --project-name=astro-app
```

Verify: open `https://astro-app.pages.dev` (or your custom domain) in a browser. The dashboard should load and the backend health indicator (Settings page) should show connected.

### Step 5: Connect an agent runner

From a user machine (your laptop, an HPC node, etc.):

```bash
npm install -g @astro/agent
astro-agent setup --relay wss://astro-backend.fly.dev:3002
astro-agent start
```

Verify: the machine should appear in the web UI under Environments.

---

## Subsequent Deploys

```bash
# Backend — auto-deploys on push to main (via GitHub Actions)
git push origin main

# Backend — manual deploy
fly deploy --app astro-backend
# or: bash scripts/deploy-fly.sh

# Frontend
VITE_API_BASE_URL=https://astro-backend.fly.dev npm run deploy:frontend
```

---

## Debugging

### Logs

```bash
# Live streaming logs (most useful for watching boot + requests)
fly logs --app astro-backend

# Last 100 lines
fly logs --app astro-backend -n 100

# Filter for specific component
fly logs --app astro-backend | grep "\[relay\]"
fly logs --app astro-backend | grep "\[dispatch\]"
fly logs --app astro-backend | grep "\[db\]"
fly logs --app astro-backend | grep "\[env\]"
```

### Successful server boot sequence

When the server starts correctly, you'll see these log lines in order:

```
[env] Environment: production
[env] JWT secrets validated
[env] Supabase config validated                    ← Supabase env vars found
[env] WebAuthn config validated (RP: ...)
[env] Redis not configured (single-instance mode)  ← expected without Redis
[env] Environment validation complete
[db] Using Supabase migrations (managed via npx supabase db)
[backend] initializing provider registry...
[backend] provider registry initialized            ← may show timeout warning (OK)
[backend] loaded N skills
[event-transport] Registering hooks...
[event-transport] Registered hooks: sse-notification, audit-log, ...
[relay] Reset all machine connection statuses
[relay] WebSocket server listening on port 3002    ← relay is up
[dispatch] Dispatch engine started
[cleanup] Cleanup scheduler started
[backend] listening on http://localhost:3001       ← API is up, health checks pass
```

If you don't see `listening on http://localhost:3001`, the server crashed during startup. Check the lines above it for the error.

### Common failure modes

#### 1. App won't start / health check fails

```bash
# Is the VM running?
fly status --app astro-backend

# Machine events (OOM, crash loops, restarts)
fly machines list --app astro-backend

# SSH into the running container to inspect
fly ssh console --app astro-backend

# Inside the container:
ps aux                                    # is the node process alive?
cat /proc/1/status | grep VmRSS          # memory usage
curl -s http://localhost:3001/api/health  # health check from inside
```

#### 2. "Environment validation failed" on startup

Missing or invalid secrets. The server exits immediately.

```bash
fly secrets list --app astro-backend
```

Common causes:
- JWT secrets not 64+ hex chars → `openssl rand -hex 32` generates the right length
- JWT secrets not all unique → the server enforces uniqueness in production
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` not set → server falls back to IndexedDB mode and logs `[env] IndexedDB mode: Supabase config skipped` (it won't crash, but it won't connect to your database either)

#### 3. Database connection errors

```
[db] error: connection refused
[db] error: password authentication failed
[db] error: no pg_hba.conf entry
```

Check `DATABASE_URL`:
- Must use the **pooler** connection string (port **6543**), not the direct connection (port 5432). Supabase Dashboard → Settings → Database → Connection string → select "Transaction" mode.
- Format: `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
- The password is URL-encoded if it contains special characters.
- Test from your local machine first: `psql "$DATABASE_URL" -c "SELECT 1"`

#### 4. CORS errors in browser console

```
Access to fetch at 'https://astro-backend.fly.dev/api/...' from origin
'https://astro-app.pages.dev' has been blocked by CORS policy
```

The backend allows these origins:
- `http://localhost:5173` (always, for local dev)
- `https://astro.fuxialexander.work` (hardcoded)
- `https://astro.pages.dev` (hardcoded)
- Whatever is in `CORS_ORIGIN` env var
- Whatever is in `FRONTEND_URL` env var

If your frontend URL isn't in that list, add it:

```bash
fly secrets set CORS_ORIGIN="https://your-frontend-url.com" --app astro-backend
# Fly.io restarts the VM automatically when secrets change.
```

The relevant code is in `server/index.ts` — the `ALLOWED_ORIGINS` array.

#### 5. SSE connections dropping / timeout

Fly.io has a 60-second idle timeout for HTTP connections. The Astro backend sends heartbeat events on the SSE stream to keep connections alive. If SSE drops:

- Check `fly logs --app astro-backend | grep -i timeout`
- Check `fly logs --app astro-backend | grep heartbeat`
- The SSE endpoint is `/api/events/stream` — make sure it's sending heartbeat events at least every 30s

#### 6. WebSocket relay not reachable

Agent runners connect to `wss://astro-backend.fly.dev:3002`. If connection fails:

```bash
# Verify port 3002 is exposed
fly services list --app astro-backend

# Check relay logs
fly logs --app astro-backend | grep "\[relay\]"

# Test WebSocket connectivity (from your machine)
# Should connect and receive a response, or timeout if blocked
wscat -c wss://astro-backend.fly.dev:3002
```

Common causes:
- Port 3002 not in `fly.toml` `[[services]]` block
- Corporate firewall blocking port 3002 (try from a different network)
- Relay server crashed (check logs for `[relay]` errors)

#### 7. OOM (Out of Memory) kills

The VM has 1GB RAM. If the server crashes under load:

```bash
# Check for OOM events
fly machines list --app astro-backend --json | python3 -c "
import json, sys
for m in json.load(sys.stdin):
    print(m.get('id'), m.get('state'), m.get('events', [{}])[-1].get('type', ''))
"

# Scale up
fly scale memory 2048 --app astro-backend
```

#### 8. Build fails on Fly.io remote builder

```bash
# Reproduce locally
docker build -f docker/Dockerfile -t astro-test .

# Common issue: native module compilation (better-sqlite3)
# The Dockerfile installs python3/make/g++ in the builder stage for this.
# If npm ci fails, check the error — it's usually a missing system library.
```

### Inspecting the running container

```bash
# SSH into the VM
fly ssh console --app astro-backend

# Check environment (secrets are injected at runtime, values masked here)
env | grep -E "^(SUPABASE|DATABASE|RELAY|DEVICE|ANTHROPIC|WEBAUTHN|CORS|FRONTEND|NODE_ENV)" | sed 's/=.*/=***/'

# Check filesystem
ls -la /app/
ls -la /app/server/
ls -la /app/dist/          # frontend build output (present but not served by default)
ls -la /app/node_modules/.bin/tsx

# Check process
ps aux
node -e "console.log(process.version)"    # should be v22.x

# Manual health check from inside
curl -s http://localhost:3001/api/health | python3 -m json.tool
```

### Restarting

```bash
# Restart the app (Fly.io recreates the machine)
fly apps restart astro-backend

# If that doesn't help — destroy and redeploy (nuclear option)
fly machines list --app astro-backend
fly machines destroy <machine-id> --app astro-backend
fly deploy --app astro-backend
```

---

## Custom Domain

```bash
# 1. Allocate a dedicated IP (needed for custom domains)
fly ips allocate-v4 --app astro-backend
fly ips allocate-v6 --app astro-backend

# 2. Add certificate (Fly.io auto-provisions via Let's Encrypt)
fly certs create api.yourdomain.com --app astro-backend

# 3. Get the IPs
fly ips list --app astro-backend

# 4. Add DNS records at your registrar:
#   A    api.yourdomain.com → <fly-ipv4>
#   AAAA api.yourdomain.com → <fly-ipv6>

# 5. Wait for certificate provisioning (usually < 5 minutes)
fly certs show api.yourdomain.com --app astro-backend
```

Then update secrets to use the new domain:

```bash
fly secrets set \
  WEBAUTHN_RP_ID="yourdomain.com" \
  WEBAUTHN_ORIGIN="https://api.yourdomain.com" \
  CORS_ORIGIN="https://yourdomain.com" \
  --app astro-backend
```

---

## Environment Variables Reference

### Required

| Variable | Description | Where to find |
|----------|-------------|---------------|
| `RELAY_JWT_SECRET` | Relay auth, 256-bit hex | `openssl rand -hex 32` |
| `DEVICE_AUTH_JWT_SECRET` | Device auth tokens, 256-bit hex, must differ from above | `openssl rand -hex 32` |
| `DEVICE_AUTH_REFRESH_SECRET` | Refresh tokens, 256-bit hex, must differ from above | `openssl rand -hex 32` |
| `DATABASE_URL` | Postgres pooler connection string | Supabase → Settings → Database → Connection string (Transaction mode, port 6543) |
| `SUPABASE_URL` | Supabase project URL | Supabase → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key | Supabase → Settings → API → Project API Keys → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Supabase → Settings → API → Project API Keys → `service_role` |
| `ANTHROPIC_API_KEY` | Claude API key | console.anthropic.com → API Keys |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBAUTHN_RP_ID` | `localhost` | Domain for passkey auth (e.g., `astro-backend.fly.dev`) |
| `WEBAUTHN_ORIGIN` | `http://localhost:5173` | Full URL for passkey auth (e.g., `https://astro-backend.fly.dev`) |
| `CORS_ORIGIN` | — | Additional allowed CORS origin for frontend |
| `FRONTEND_URL` | — | Additional allowed CORS origin for frontend |
| `REDIS_URL` | — | Redis connection URL for horizontal scaling (multi-instance relay) |
| `RELAY_PORT` | `3002` | WebSocket relay port |
| `CLAUDE_CODE_USE_BEDROCK` | — | Set to `1` to use AWS Bedrock instead of Anthropic API |

### Set by fly.toml (don't override manually)

| Variable | Value | Why |
|----------|-------|-----|
| `NODE_ENV` | `production` | Enables production CORS, rate limiting, JWT validation |
| `RELAY_PORT` | `3002` | Matches the `[[services]]` port mapping |

---

## VM Resources

Current `fly.toml` config:

| Resource | Value |
|----------|-------|
| CPU | shared-cpu-1x (1 vCPU) |
| Memory | 1024 MB |
| Region | sjc (San Jose) |
| Auto-stop | disabled (persistent WebSocket connections need always-on) |

Scaling commands:

```bash
fly scale memory 2048 --app astro-backend         # 2 GB RAM
fly scale vm shared-cpu-2x --app astro-backend     # 2 vCPU
fly scale count 2 --app astro-backend              # 2 instances (requires REDIS_URL for relay state sharing)
```

## Cost

| Resource | Monthly |
|----------|---------|
| Fly.io VM (shared-cpu-1x, 1GB, always-on) | ~$5-10 |
| Cloudflare Pages (frontend) | $0 |
| Supabase (Free or Pro) | $0-25 |
| Anthropic API | Usage-based |

---

## Docker Internals

The Dockerfile (`docker/Dockerfile`) is a two-stage build:

**Builder stage** (`node:22-alpine`):
- Installs native module build tools (`python3`, `make`, `g++`, `git`) — needed for `better-sqlite3` compilation
- `npm ci` installs ALL dependencies (including devDependencies, because `typescript` and `vite` are needed for the build step)
- `npm run build` runs `tsc -b && vite build` — type-checks everything, then bundles the frontend into `dist/`

**Production stage** (`node:22-alpine`):
- Copies from builder: `node_modules/`, `server/` (TypeScript source), `dist/` (frontend build), `supabase/` (migrations), landing page HTML files
- The server runs TypeScript directly via `tsx` (TypeScript execution engine) — the server code is NOT compiled to JavaScript. `tsx` transpiles on the fly at startup.
- `dumb-init` wraps the process for proper signal forwarding (Fly.io sends `SIGTERM` on stop/deploy)
- `curl` is installed for the `HEALTHCHECK` command
- Runs as non-root user `astro` (uid 1001)
- The `CMD` is `./node_modules/.bin/tsx server/index.ts`

Note: `tsx` is a devDependency in `package.json` but gets installed in the builder stage via `npm ci` (all deps) and copied into the production stage via `node_modules/`. This makes the image larger than necessary (~200MB of unused dev deps), but avoids needing a separate server build pipeline. Acceptable for beta; can be optimized later by bundling the server to JS with `tsup` or `esbuild`.
