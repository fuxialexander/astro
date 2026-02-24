# Fly.io Deployment

## Who Does What

There are two roles in this system:

- **You (the operator)** deploy the code. You run CLI commands (`fly deploy`, `wrangler pages deploy`) from your development machine. You never need to open a browser to deploy.
- **End users** use the service through their browser. They visit a URL, the React app loads, and it talks to your backend. They also optionally install the agent runner CLI on their own machines.

## How the Code Maps to Deployed Services

Astro is a monorepo with three independent components. Each is deployed separately and they communicate only over the network at runtime.

```
YOUR REPO
│
├── src/                        ──► FRONTEND
│   ├── pages/                      Built by: vite build (produces dist/)
│   ├── components/                 Deployed by: you run "wrangler pages deploy dist"
│   ├── stores/                     Hosted on: Cloudflare Pages (static CDN)
│   ├── lib/                        Runs on: end user's browser
│   │   ├── api-client.ts           The browser downloads the JS/CSS from the CDN,
│   │   ├── api-url.ts              then the React app makes API calls to the backend.
│   │   └── realtime-client.ts
│   └── types/
│
├── server/                     ──► BACKEND
│   ├── index.ts                    Built by: Docker (npm ci inside container)
│   ├── routes/                     Deployed by: you run "fly deploy"
│   ├── lib/                        Hosted on: Fly.io VM
│   │   ├── relay-server.ts         Runs on: Fly.io cloud (single Node.js process)
│   │   ├── dispatch/               Serves the API + WebSocket relay.
│   │   ├── providers/              Connects to Supabase for persistence.
│   │   ├── machine-registry.ts     Server does NOT run AI — all AI calls
│   │   ├── db/index.ts             route through the relay to agent runners.
│   │   └── events/
│   └── types/
│
└── packages/
    └── agent-runner/           ──► USER APP
        Separate npm package.       Built by: npm run build (in packages/agent-runner/)
        Own package.json.           Deployed by: you run "npm publish"
        Own build.                  Hosted on: npm registry
                                    Runs on: end user's machine (laptop, HPC, cloud VM)
                                    End users install it with "npm install -g @astroanywhere/agent"
                                    and connect to the relay.
```

| Component | Code | Deployed by you with | Hosted on | Runs on |
|-----------|------|---------------------|-----------|---------|
| Frontend | `src/` | `wrangler pages deploy dist` | Cloudflare Pages (CDN) | End user's browser |
| Backend + Relay | `server/` | `fly deploy` | Fly.io (cloud VM) | Fly.io |
| Agent Runner | `packages/agent-runner/` | `npm publish` | npm registry | End user's machine |

### How the deployed services connect at runtime

This diagram shows what happens **after deployment**, when end users are using the system:

```
┌─────────────────────────────────────────────────────────┐
│  END USER'S BROWSER                                     │
│                                                         │
│  The user visits https://astro-app.pages.dev (or your   │
│  custom domain). Cloudflare Pages serves the static     │
│  HTML/JS/CSS files built from src/.                     │
│                                                         │
│  The React app boots in the browser, renders the UI,    │
│  and makes API calls to the Fly.io backend via          │
│  fetch("https://<your-fly-app>.fly.dev/api/...").
│  This is a cross-origin request, so the backend must    │
│  allow it via CORS.                                     │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │ HTTPS (REST + SSE)
                       │ Cross-origin requests
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  FLY.IO VM  (your backend, one Node.js process)         │
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
│  In server mode, ALL AI endpoints (/agent/*, /dispatch  │
│  /task) detect isServerMode() and route through the     │
│  relay to agent runners. The Fly.io VM has no Claude    │
│  credentials — it is a pure web host + relay hub.       │
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
│  SUPABASE CLOUD      │   │  END USER'S MACHINE          │
│  (managed service)   │   │                              │
│                      │   │  The user installs            │
│  PostgreSQL          │   │  @astroanywhere/agent on their        │
│    All persistent    │   │  machine and runs it.         │
│    state.            │   │  It connects outbound to      │
│  Auth                │   │  the relay, receives tasks,   │
│    User sessions.    │   │  executes them locally        │
│  Realtime            │   │  (with THEIR Claude creds),   │
│    Multi-device      │   │  and streams output back.     │
│    sync.             │   │                              │
│                      │   │  Code: packages/agent-runner/ │
└──────────────────────┘   └──────────────────────────────┘
```

### How you deploy each piece

```
YOU (operator, on your dev machine)
│
├── fly deploy                          → pushes Docker image to Fly.io
│                                         Fly.io runs it as a VM
│                                         Backend is live at https://<your-fly-app>.fly.dev
│
├── VITE_API_BASE_URL=... \
│   VITE_SUPABASE_URL=... \
│   VITE_SUPABASE_ANON_KEY=... \
│   npm run build                       → builds src/ into dist/ (static files)
│   wrangler pages deploy dist          → uploads dist/ to Cloudflare Pages
│                                         Frontend is live at https://astro-app.pages.dev
│
└── (cd packages/agent-runner && npm publish)
                                        → publishes @astroanywhere/agent to npm
                                          End users install with: npm install -g @astroanywhere/agent
```

The frontend build step bakes in three `VITE_*` env vars. `VITE_API_BASE_URL` tells the React app where the backend is (without it, the app calls `/api/...` on the same domain — works in local dev via Vite proxy, not in production). `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` enable auth mode — without them, the app detects "local mode" and skips authentication entirely (no login page).

### Why this architecture

- **Frontend on CDN**: Cloudflare Pages is free, globally distributed, scales infinitely. No backend CPU spent serving static files. End users get fast page loads regardless of location.
- **Single backend process**: The Hono API and WebSocket relay share in-memory state (`machineRegistry`, `dispatchEngine`, `astroEventTransport`). Splitting them into two processes would require Redis for all shared state — complexity for zero gain at our scale.
- **No AI on server**: In server mode, every AI endpoint checks `isServerMode()` and dispatches through the relay to agent runners on user machines. The Fly.io VM never calls Claude directly — it has no API keys, no providers. This keeps the server lightweight and means users bring their own AI credentials.
- **Relay on port 3002**: Fly.io exposes it with TLS directly. Agent runners connect to `wss://<your-fly-app>.fly.dev:3002`. Some corporate firewalls block non-443 ports; this is a known limitation for beta.
- **Monorepo is fine**: The three components share no runtime code. The only coupling is one git repo and one root `package.json`. The Docker image for the backend carries frontend npm dependencies (React, Radix, etc.) in `node_modules/` — needed at build time but dead weight at runtime. This makes the image ~200MB larger than it could be, but not worth restructuring for beta.

---

## Deployment Files

```
docker/
├── Dockerfile              # Backend + relay production image
└── .dockerignore
fly.toml                    # Fly.io app config (must be at repo root)
.dockerignore               # Root-level Docker build context filter
scripts/deploy.sh           # Deploy script (backend + frontend)
.github/workflows/fly-deploy.yml  # Auto-deploy on push to main
```

---

## Prerequisites

1. **Fly.io CLI** installed and authenticated
2. **Supabase project** (cloud-hosted) with database password known
3. **Wrangler CLI** (for Cloudflare Pages frontend deploy, optional)

No Anthropic API key is needed on the server — in server mode, all AI execution routes through the relay to agent runners on user machines, which use their own Claude credentials.

```bash
# Install Fly CLI
brew install flyctl            # macOS
# or: curl -L https://fly.io/install.sh | sh

fly auth login

# Install psql (for testing DB connection and running migrations)
brew install libpq
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
```

---

## Step-by-Step Deployment

### Step 1: Create the Fly.io app

```bash
# Only needed once. Skip if app already exists.
fly apps create <your-fly-app> --org personal
```

Verify: `fly apps list` should show `<your-fly-app>`.

### Step 2: Set up Supabase

Create a Supabase project at [supabase.com](https://supabase.com). You need 4 values from the dashboard:

| Value | Where to find it |
|-------|-----------------|
| **Project URL** | Settings → API → Project URL (e.g., `https://abcdefgh.supabase.co`) |
| **Anon key** | Settings → API → Project API Keys → `anon` `public` (starts with `eyJ...`) |
| **Service role key** | Settings → API → Project API Keys → `service_role` (click "Reveal" to see it) |
| **Database password** | The password you set when creating the project. Reset via Settings → Database → Database password if forgotten. |

Build the `DATABASE_URL` from the connection string in Settings → Database → Connection string (select **Transaction** / pooler mode, port **6543**):

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true
```

If your password contains special characters (like `@`), URL-encode them (e.g., `@` → `%40`).

Test the connection:

```bash
PGPASSWORD='your-password' psql -h aws-0-<region>.pooler.supabase.com -p 6543 \
  -U postgres.<project-ref> -d postgres -c "SELECT 1"
```

### Step 3: Configure .env and push secrets

All configuration lives in one file: `.env`. Copy the template and fill in values.

```bash
cp .env.example .env
```

Fill in your `.env`:

```bash
# --- JWT Secrets (generate each with: openssl rand -hex 32) ---
RELAY_JWT_SECRET=<generate>
DEVICE_AUTH_JWT_SECRET=<generate>
DEVICE_AUTH_REFRESH_SECRET=<generate>

# --- Supabase (from Step 2) ---
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true

# --- WebAuthn (passkey login) ---
WEBAUTHN_RP_ID=<your-fly-app>.fly.dev
WEBAUTHN_ORIGIN=https://<your-fly-app>.fly.dev

# --- Frontend URLs (set to your actual frontend domain) ---
ASTRO_BASE_URL=https://your-frontend-domain.com
CORS_ORIGIN=https://your-frontend-domain.com
FRONTEND_URL=https://your-frontend-domain.com
```

Push secrets to Fly.io:

```bash
fly secrets import --app <your-fly-app> < .env

# Verify (shows names only, not values)
fly secrets list --app <your-fly-app>
```

Fly.io encrypts secrets at rest and injects them as environment variables at runtime. They never appear in your Docker image or git history.

#### Using env profiles (recommended)

Instead of manually setting `VITE_*` vars every time you deploy, use the env profile system:

```bash
# One-time: generate .env.prod profile
npm run env:init

# Edit .env.prod with your remote Supabase credentials + deployment config:
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
#   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL
#   FLY_APP (must match fly.toml, default: astro-backend-deploy)

# Switch to prod profile (symlinks .env.local → .env.prod)
npm run env:prod
```

Once activated, `scripts/deploy.sh` sources `.env` + `.env.local` automatically — no need to pass `VITE_*` vars on the command line.

### Step 4: Run database migrations

The Supabase database starts empty. Run migrations to create all required tables:

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

for f in supabase/migrations/*.sql; do
  echo "=== Running: $(basename $f) ==="
  PGPASSWORD='your-password' psql \
    -h aws-0-<region>.pooler.supabase.com -p 6543 \
    -U postgres.<project-ref> -d postgres -f "$f"
done
```

All migrations should complete without errors (NOTICEs about "already exists" are fine).

### Step 5: Deploy backend

```bash
# Recommended: uses env profiles, sets CORS/WebAuthn secrets automatically
npm run deploy:backend

# Or manual:
fly deploy --app <your-fly-app>
```

What happens:
1. Fly reads `fly.toml` → finds `docker/Dockerfile`
2. Sends the repo to Fly's remote builder
3. Builder runs the multi-stage Docker build: `npm ci` → `npm rebuild` → copies server source into a slim production image
4. Pushes the image to Fly's internal registry
5. Starts VMs in the `sjc` (San Jose) region
6. Runs health checks against `GET /api/health`

The Dockerfile does NOT run `tsc` or `vite build` — the server uses `tsx` (runtime TypeScript transpilation), and the frontend is deployed separately to Cloudflare Pages.

Verify:

```bash
curl -s https://<your-fly-app>.fly.dev/api/health | python3 -m json.tool
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

- `"mode": "supabase"` — server mode is active (Supabase env vars detected).
- `"providers": { "available": 0 }` — normal. The Fly.io VM has no AI providers. All AI calls route through the relay.
- `"defaultProvider": null` — normal for the same reason.

### Step 6: Deploy frontend

The frontend build requires three `VITE_*` env vars baked in at build time:

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | Backend API URL (where `fetch('/api/...')` calls go) |
| `VITE_SUPABASE_URL` | Supabase project URL (enables auth mode — without it, the app runs in local/no-auth mode) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (used by the Supabase JS client for session management) |

```bash
# Recommended: reads VITE_* vars from env profiles, builds + deploys
npm run deploy:frontend

# Or manual (pass VITE_* vars explicitly):
VITE_API_BASE_URL=https://<your-fly-app>.fly.dev \
VITE_SUPABASE_URL=https://<ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=eyJ... \
npm run build

# Deploy static files to Cloudflare Pages
wrangler pages deploy dist --project-name=astro-app
```

**Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`**, the frontend detects "local mode" (`shouldUseSupabase()` returns false), `AuthGuard` passes through without checking auth, and users see the app directly — no login page, no registration.

Verify: open `https://astro-app.pages.dev` (or your custom domain) in a browser. You should see the login page. The dashboard should load after authentication and the backend health indicator (Settings page) should show connected.

#### Branch deploys

When you deploy from a non-main branch, Cloudflare Pages creates a **branch-specific URL** instead of updating the production URL:

```
Production (main):  https://astro-app-29q.pages.dev
Branch deploy:      https://<branch-name>.astro-app-29q.pages.dev
```

The branch URL is a different origin, so **the backend must be updated to allow it**. Four Fly.io secrets need to match the frontend URL:

| Secret | What it controls | Example value for branch deploy |
|--------|------------------|---------------------------------|
| `CORS_ORIGIN` | Which origins can make cross-origin API requests | `https://<branch>.astro-app-29q.pages.dev` |
| `FRONTEND_URL` | Second allowed CORS origin | `https://<branch>.astro-app-29q.pages.dev` |
| `WEBAUTHN_ORIGIN` | Expected origin for passkey verification | `https://<branch>.astro-app-29q.pages.dev` |
| `WEBAUTHN_RP_ID` | Relying Party ID (registrable domain, not the full subdomain) | `astro-app-29q.pages.dev` |

```bash
# Update backend secrets for a branch deploy
BRANCH_URL=https://<branch-name>.astro-app-29q.pages.dev
fly secrets set \
  CORS_ORIGIN="$BRANCH_URL" \
  FRONTEND_URL="$BRANCH_URL" \
  WEBAUTHN_ORIGIN="$BRANCH_URL" \
  WEBAUTHN_RP_ID="astro-app-29q.pages.dev" \
  --app <your-fly-app>
```

Fly.io restarts both machines automatically when secrets change (rolling deploy, no downtime).

**If you skip this step**, users will see "Something went wrong. Please try again." on the login page because:
1. The browser's `fetch()` to the backend is blocked by CORS (origin not in allowed list)
2. Even if CORS passed, WebAuthn verification would reject the credential because `expectedOrigin` doesn't match

**When switching back to production**, restore the production values:

```bash
fly secrets set \
  ASTRO_BASE_URL="https://your-production-domain.com" \
  CORS_ORIGIN="https://your-production-domain.com" \
  FRONTEND_URL="https://your-production-domain.com" \
  WEBAUTHN_ORIGIN="https://your-production-domain.com" \
  WEBAUTHN_RP_ID="your-production-domain.com" \
  --app <your-fly-app>
```

### Step 7: Connect an agent runner

From a user machine (your laptop, an HPC node, etc.):

```bash
npm install -g @astroanywhere/agent
astro-agent setup --relay wss://<your-fly-app>.fly.dev:3002
astro-agent start
```

Verify: the machine should appear in the web UI under Environments.

---

## VM Resources & Scaling

### Default configuration

The VM configuration is in `fly.toml` at the repo root, in the `[vm]` section:

```toml
[vm]
  cpu_kind = "shared"    # "shared" (cheap) or "performance" (dedicated)
  cpus = 1               # Number of vCPUs: 1, 2, 4, or 8
  memory_mb = 1024       # RAM in MB: 256, 512, 1024, 2048, 4096, etc.
```

Current defaults:

| Resource | Value | Notes |
|----------|-------|-------|
| CPU | 1x shared vCPU | Sufficient for alpha/beta with <50 concurrent users |
| Memory | 1024 MB | Node.js process + in-memory machine registry + event buffers |
| Region | `sjc` (San Jose) | Set via `primary_region` in fly.toml |
| Instances | 2 | Fly.io creates 2 machines for high availability by default |
| Auto-stop | Disabled | Persistent WebSocket connections need always-on machines |

### Changing VM resources

**Option A: Edit `fly.toml` and redeploy** (persistent, version-controlled):

```toml
[vm]
  cpu_kind = "performance"   # Dedicated CPU (no noisy neighbors)
  cpus = 2                   # 2 vCPUs
  memory_mb = 2048           # 2 GB RAM
```

Then `fly deploy` to apply.

**Option B: CLI commands** (immediate, overrides fly.toml):

```bash
fly scale memory 2048 --app <your-fly-app>         # 2 GB RAM
fly scale vm shared-cpu-2x --app <your-fly-app>     # 2 shared vCPUs
fly scale vm performance-1x --app <your-fly-app>    # 1 dedicated vCPU
```

### Scaling to multiple instances

```bash
fly scale count 2 --app <your-fly-app>
```

Multiple instances require `REDIS_URL` for relay state sharing (machine registry, task routing). Without Redis, each instance has its own in-memory state and agent runners may connect to a different instance than the one handling their task.

### Reducing to 1 instance

Fly.io creates 2 machines by default for zero-downtime deploys. To use only 1:

In `fly.toml`, change the services blocks:

```toml
[[services]]
  min_machines_running = 1   # already set to 1
```

Or destroy the extra machine:

```bash
fly machines list --app <your-fly-app>
fly machines destroy <second-machine-id> --app <your-fly-app>
```

---

## Cost

| Resource | Monthly (approx) |
|----------|---------|
| Fly.io VM (1x shared CPU, 1GB, always-on, 2 instances) | ~$10-15 |
| Fly.io VM (1x shared CPU, 1GB, always-on, 1 instance) | ~$5-7 |
| Cloudflare Pages (frontend) | $0 |
| Supabase (Free tier) | $0 |
| Supabase (Pro tier) | $25 |

No Anthropic API costs on the server — users bring their own Claude credentials via their agent runners.

---

## Subsequent Deploys

```bash
# Deploy everything (backend + frontend)
npm run deploy

# Deploy individually
npm run deploy:backend       # Backend only (Fly.io)
npm run deploy:frontend      # Frontend only (Cloudflare Pages)
```

These commands read config from your env profile (`.env` + `.env.local`), handle CORS/WebAuthn secrets, and pass `VITE_*` vars to the frontend build automatically.

**Alternative: manual commands**

```bash
# Backend — auto-deploys on push to main (via GitHub Actions)
git push origin main

# Backend — manual deploy
fly deploy --app <your-fly-app>
# or: bash scripts/deploy.sh backend

# Frontend (production) — requires all three VITE_* env vars
VITE_API_BASE_URL=https://<your-fly-app>.fly.dev \
VITE_SUPABASE_URL=https://<ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=eyJ... \
npm run build && wrangler pages deploy dist --project-name=astro-app

# Frontend (branch deploy) — same build, Cloudflare auto-creates branch URL
# IMPORTANT: After deploying, update Fly.io secrets to allow the branch URL
# (see "Branch deploys" in Step 6 above)

# Re-run migrations after adding new .sql files
for f in supabase/migrations/*.sql; do
  PGPASSWORD='...' psql -h ... -p 6543 -U postgres.... -d postgres -f "$f" 2>&1
done
```

---

## Debugging

### Logs

```bash
# Live streaming logs (most useful for watching boot + requests)
fly logs --app <your-fly-app>

# Last 100 lines
fly logs --app <your-fly-app> -n 100

# Filter for specific component
fly logs --app <your-fly-app> | grep "\[relay\]"
fly logs --app <your-fly-app> | grep "\[dispatch\]"
fly logs --app <your-fly-app> | grep "\[db\]"
fly logs --app <your-fly-app> | grep "\[env\]"
fly logs --app <your-fly-app> | grep "\[cleanup\]"
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
[cleanup] Cleanup completed in Nms. Total records cleaned: 0
```

If you don't see `listening on http://localhost:3001`, the server crashed during startup. Check the lines above it for the error.

### Common failure modes

#### 1. App won't start / health check fails

```bash
# Is the VM running?
fly status --app <your-fly-app>

# Machine events (OOM, crash loops, restarts)
fly machines list --app <your-fly-app>

# SSH into the running container to inspect
fly ssh console --app <your-fly-app>

# Inside the container:
ps aux                                    # is the node process alive?
cat /proc/1/status | grep VmRSS          # memory usage
curl -s http://localhost:3001/api/health  # health check from inside
```

#### 2. "Environment validation failed" on startup

Missing or invalid secrets. The server exits immediately.

```bash
fly secrets list --app <your-fly-app>
```

Common causes:
- JWT secrets not 64+ hex chars → `openssl rand -hex 32` generates the right length
- JWT secrets not all unique → the server enforces uniqueness in production
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` not set → server falls back to IndexedDB mode and logs `[env] IndexedDB mode: Supabase config skipped` (it won't crash, but it won't connect to your database either)

#### 3. Database connection errors

```
[db] error: connection refused
[db] error: password authentication failed
[db] error: relation "xxx" does not exist
```

Check `DATABASE_URL`:
- Must use the **pooler** connection string (port **6543**), not the direct connection (port 5432). Supabase Dashboard → Settings → Database → Connection string → select "Transaction" mode.
- Format: `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
- The password is URL-encoded if it contains special characters (`@` → `%40`).
- Test from your local machine first: `PGPASSWORD='...' psql -h <host> -p 6543 -U postgres.<ref> -d postgres -c "SELECT 1"`
- "relation does not exist" means migrations haven't been run — see Step 4.

#### 4. CORS errors in browser console

```
Access to fetch at 'https://<your-fly-app>.fly.dev/api/...' from origin
'https://astro-app.pages.dev' has been blocked by CORS policy
```

The backend allows these origins:
- `http://localhost:5173` (always, for local dev)
- Whatever is in `CORS_ORIGIN` env var
- Whatever is in `FRONTEND_URL` env var

There are **no hardcoded production domains** in the source code — all production origins must be configured via environment variables. If your frontend URL isn't in that list, add it:

```bash
fly secrets set CORS_ORIGIN="https://your-frontend-url.com" --app <your-fly-app>
# Fly.io restarts the VM automatically when secrets change.
```

The relevant code is in `server/index.ts` — the `ALLOWED_ORIGINS` array.

#### 5. SSE connections dropping / timeout

Fly.io has a 60-second idle timeout for HTTP connections. The Astro backend sends heartbeat events on the SSE stream to keep connections alive. If SSE drops:

- Check `fly logs --app <your-fly-app> | grep -i timeout`
- Check `fly logs --app <your-fly-app> | grep heartbeat`
- The SSE endpoint is `/api/events/stream` — make sure it's sending heartbeat events at least every 30s

#### 6. WebSocket relay not reachable

Agent runners connect to `wss://<your-fly-app>.fly.dev:3002`. If connection fails:

```bash
# Verify port 3002 is exposed
fly services list --app <your-fly-app>

# Check relay logs
fly logs --app <your-fly-app> | grep "\[relay\]"

# Test WebSocket connectivity (from your machine)
# Should connect and receive a response, or timeout if blocked
wscat -c wss://<your-fly-app>.fly.dev:3002
```

Common causes:
- Port 3002 not in `fly.toml` `[[services]]` block
- Corporate firewall blocking port 3002 (try from a different network)
- Relay server crashed (check logs for `[relay]` errors)

#### 7. OOM (Out of Memory) kills

The VM has 1GB RAM by default. If the server crashes under load:

```bash
# Check for OOM events
fly machines list --app <your-fly-app> --json | python3 -c "
import json, sys
for m in json.load(sys.stdin):
    print(m.get('id'), m.get('state'), m.get('events', [{}])[-1].get('type', ''))
"

# Scale up memory (immediate)
fly scale memory 2048 --app <your-fly-app>

# Or edit fly.toml for a persistent change:
# [vm]
#   memory_mb = 2048
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
fly ssh console --app <your-fly-app>

# Check environment (secrets are injected at runtime, values masked here)
env | grep -E "^(SUPABASE|DATABASE|RELAY|DEVICE|ANTHROPIC|WEBAUTHN|CORS|FRONTEND|NODE_ENV)" | sed 's/=.*/=***/'

# Check filesystem
ls -la /app/
ls -la /app/server/
ls -la /app/src/types/     # frontend types imported by server
ls -la /app/node_modules/.bin/tsx

# Check process
ps aux
node -e "console.log(process.version)"    # should be v22.x

# Manual health check from inside
curl -s http://localhost:3001/api/health | python3 -m json.tool
```

### Restarting

```bash
# Restart individual machines
fly machines list --app <your-fly-app>
fly machines restart <machine-id> --app <your-fly-app>

# If that doesn't help — destroy and redeploy (nuclear option)
fly machines destroy <machine-id> --app <your-fly-app>
fly deploy --app <your-fly-app>
```

---

## Custom Domain

```bash
# 1. Allocate a dedicated IP (needed for custom domains)
fly ips allocate-v4 --app <your-fly-app>
fly ips allocate-v6 --app <your-fly-app>

# 2. Add certificate (Fly.io auto-provisions via Let's Encrypt)
fly certs create api.yourdomain.com --app <your-fly-app>

# 3. Get the IPs
fly ips list --app <your-fly-app>

# 4. Add DNS records at your registrar:
#   A    api.yourdomain.com → <fly-ipv4>
#   AAAA api.yourdomain.com → <fly-ipv6>

# 5. Wait for certificate provisioning (usually < 5 minutes)
fly certs show api.yourdomain.com --app <your-fly-app>
```

Then update secrets to use the new domain:

```bash
fly secrets set \
  WEBAUTHN_RP_ID="yourdomain.com" \
  WEBAUTHN_ORIGIN="https://api.yourdomain.com" \
  CORS_ORIGIN="https://yourdomain.com" \
  --app <your-fly-app>
```

---

## Domain Configuration for Release

All production URLs are configured entirely via environment variables — **no hardcoded domains in source code**. This means switching from a staging domain to a final `.com` domain requires only updating Fly.io secrets and rebuilding the frontend.

### URL-related environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `ASTRO_BASE_URL` | Device auth, email notifications, channel notifications | Frontend URL in user-facing links (verification pages, emails) |
| `FRONTEND_URL` | CORS, invite links | CORS allowed origin + team invitation URLs |
| `CORS_ORIGIN` | CORS | Additional allowed CORS origin (if frontend has multiple URLs) |
| `WEBAUTHN_RP_ID` | Passkey auth | Registrable domain for WebAuthn (e.g., `yourdomain.com`) |
| `WEBAUTHN_ORIGIN` | Passkey auth | Full origin URL for WebAuthn verification |
| `ASTRO_NOREPLY_EMAIL` | Email service | Sender address for invitation emails (default: `noreply@astro.app`) |

### Switching to a new domain

When moving from staging (e.g., `*.pages.dev`) to a final domain (e.g., `https://astro.com`):

```bash
# 1. Update all Fly.io secrets at once
fly secrets set \
  ASTRO_BASE_URL="https://astro.com" \
  FRONTEND_URL="https://astro.com" \
  CORS_ORIGIN="https://astro.com" \
  WEBAUTHN_ORIGIN="https://astro.com" \
  WEBAUTHN_RP_ID="astro.com" \
  ASTRO_NOREPLY_EMAIL="noreply@astro.com" \
  --app <your-fly-app>

# 2. Rebuild and deploy frontend with the new API URL
VITE_API_BASE_URL=https://api.astro.com \
VITE_SUPABASE_URL=https://<ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=eyJ... \
npm run build && wrangler pages deploy dist --project-name=astro-app

# 3. Update Supabase config (if using self-hosted Supabase)
# Edit supabase/config.toml: site_url, jwt_issuer
```

### Files with localhost fallbacks (dev only)

These files use `localhost` as defaults when env vars are unset. This is correct — they only apply during local development:

| File | Default | Env var override |
|------|---------|-----------------|
| `server/routes/device-auth.ts` | `http://localhost:5173` | `ASTRO_BASE_URL` |
| `server/lib/events/hooks/channel-notification-hook.ts` | `http://localhost:5173` | `ASTRO_BASE_URL` |
| `server/lib/email-service.ts` | `http://localhost:5173` | `ASTRO_BASE_URL` |
| `server/routes/teams.ts` | `http://localhost:5173` | `FRONTEND_URL` |
| `packages/agent-runner/src/lib/config.ts` | `http://localhost:3001` | CLI `--api` flag |

### Supabase config (local dev only)

`supabase/config.toml` contains domain references for local Supabase development (Cloudflare Tunnel URLs). These are **not used in production** — production Supabase is a managed cloud instance with its own configuration. If you're setting up a new local dev environment, update the `site_url` and `jwt_issuer` values to match your tunnel domain.

---

## Environment Variables Reference

### Required

| Variable | Description | Where to find |
|----------|-------------|---------------|
| `RELAY_JWT_SECRET` | Signs tokens for agent runner ↔ relay auth. 256-bit hex. | `openssl rand -hex 32` |
| `DEVICE_AUTH_JWT_SECRET` | Signs access tokens for device auth flow. 256-bit hex. Must differ from above. | `openssl rand -hex 32` |
| `DEVICE_AUTH_REFRESH_SECRET` | Signs refresh tokens for device auth flow. 256-bit hex. Must differ from above. | `openssl rand -hex 32` |
| `DATABASE_URL` | Postgres connection string (pooler mode, port 6543). | Supabase → Settings → Database → Connection string (Transaction mode) |
| `SUPABASE_URL` | Supabase HTTP API endpoint. | Supabase → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Public key for frontend auth flows. | Supabase → Settings → API → Project API Keys → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged key that bypasses RLS. Backend only. | Supabase → Settings → API → Project API Keys → `service_role` (click Reveal) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `ASTRO_BASE_URL` | `http://localhost:5173` | Frontend URL used in device auth links, emails, notifications |
| `FRONTEND_URL` | — | Frontend URL for CORS + invite links |
| `CORS_ORIGIN` | — | Additional CORS origin (if frontend has multiple URLs) |
| `WEBAUTHN_RP_ID` | `localhost` | Domain for passkey auth (e.g., `yourdomain.com`) |
| `WEBAUTHN_ORIGIN` | `http://localhost:5173` | Full URL for passkey auth (e.g., `https://yourdomain.com`) |
| `ASTRO_NOREPLY_EMAIL` | `noreply@astro.app` | Sender address for invitation emails |
| `REDIS_URL` | — | Redis for horizontal scaling (multiple backend instances) |
| `RELAY_PORT` | `3002` | WebSocket relay port |

### Set by fly.toml (don't override manually)

| Variable | Value | Why |
|----------|-------|-----|
| `NODE_ENV` | `production` | Enables production CORS, rate limiting, JWT validation |
| `RELAY_PORT` | `3002` | Matches the `[[services]]` port mapping |

---

## Docker Internals

The Dockerfile (`docker/Dockerfile`) is a two-stage build:

**Builder stage** (`node:22-alpine`):
- Installs native module build tools (`python3`, `make`, `g++`, `git`) — needed for `better-sqlite3` compilation
- `npm ci` installs ALL dependencies (including devDependencies, because `tsx` is a devDependency)
- `npm rebuild` ensures native modules are compiled for the target architecture
- No `tsc` or `vite build` — the server uses `tsx` for runtime transpilation, and the frontend is deployed separately

**Production stage** (`node:22-alpine`):
- Copies from builder: `node_modules/`, `server/` (TypeScript source), `src/types/` (shared types imported by server), `tsconfig*.json` (needed by tsx for path resolution), `supabase/` (migrations), landing page HTML files
- The server runs TypeScript directly via `tsx` (TypeScript execution engine) — the server code is NOT compiled to JavaScript. `tsx` transpiles on the fly at startup.
- `dumb-init` wraps the process for proper signal forwarding (Fly.io sends `SIGTERM` on stop/deploy)
- `curl` is installed for the `HEALTHCHECK` command
- Runs as non-root user `astro` (uid 1001)
- The `CMD` is `./node_modules/.bin/tsx server/index.ts`

Note: `tsx` is a devDependency in `package.json` but gets installed in the builder stage via `npm ci` (all deps) and copied into the production stage via `node_modules/`. This makes the image larger than necessary (~200MB of unused dev deps), but avoids needing a separate server build pipeline. Acceptable for beta; can be optimized later by bundling the server to JS with `tsup` or `esbuild`.
