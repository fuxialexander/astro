# Deployment & Testing Guide

This document covers how to test Astro in both Local Mode and Server Mode, and how to deploy the server-side to the internet.

---

## Part 1: Testing Local Mode (No Cloud Services Needed)

Local mode is the simplest — everything runs on your machine, no accounts needed.

```bash
# Start in local mode (PGlite)
npm run dev:local
# or equivalently:
ASTRO_LOCAL_MODE=true npm run dev
```

**What to verify:**
- Open http://localhost:5173 — should load with "Local Mode" badge in sidebar
- No login screen — you go straight to the app
- Create a project, add tasks, verify they persist across page refresh
- Create a project, add tasks, verify they persist across page refresh
- Activities should appear in the activity dialog
- Settings changes (model, default provider) should persist across refresh

**What won't work in local mode:**
- No authentication (expected)
- No multi-device sync
- No realtime collaboration
- Clearing browser data = losing everything

---

## Part 2: Testing Server Mode Locally (With Local Supabase)

Before deploying to the internet, test server mode locally using Supabase's local dev stack. This uses Docker to run Postgres, Auth, and Realtime locally.

### Prerequisites

1. **Docker Desktop** — install from https://docker.com/products/docker-desktop
2. **Supabase CLI** — install with `npm install -g supabase`

### Setup

```bash
# Start local Supabase (Postgres + Auth + Realtime + Studio)
npx supabase start

# This prints out URLs and keys. Note:
#   API URL:      http://127.0.0.1:54321
#   anon key:     eyJ...  (long JWT)
#   service_role: eyJ...  (long JWT)
```

Create `.env.local` with the output:
```bash
# Supabase (local)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<anon key from above>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from above>
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key from above>

# JWT secrets (generate with: openssl rand -hex 32)
RELAY_JWT_SECRET=<random hex>
DEVICE_AUTH_JWT_SECRET=<random hex>
```

```bash
# Apply database migrations
npx supabase db push

# Start in server mode
npm run dev:supabase
# or just:
npm run dev
```

### What to verify

- Login screen appears (WebAuthn/passkey authentication)
- **First user registration**: Since there's no initial user, you need to create one:
  - Visit Supabase Studio at http://127.0.0.1:54323
  - Go to Authentication > Users
  - Create a user manually (email + password for testing)
  - Or use the passkey registration flow in the app
- After login: create projects, tasks, activities
- Open Supabase Studio > Table Editor — verify data appears in Postgres tables
- Refresh the page — data should reload from API
- Settings changes should persist in `user_profiles.settings`
- Sidebar config should persist in `user_profiles.sidebar_config`

---

## Part 3: Deploying to the Internet

### What You Need (Accounts & Services)

| Service | Purpose | Cost | Account needed |
|---------|---------|------|----------------|
| **Supabase** (cloud) | Postgres + Auth + Realtime | Free tier: 500MB DB, 50k MAU | Yes — https://supabase.com |
| **Fly.io** | Backend API + WebSocket relay | Free tier: 3 shared VMs | Yes — https://fly.io |
| **Cloudflare** | Frontend hosting (Pages) + DNS | Free tier: unlimited | Yes — https://cloudflare.com |
| **Domain** | Custom domain (optional) | ~$10/yr | Via any registrar |

**You do NOT need to register a domain to test.** Both Fly.io and Cloudflare Pages give you free subdomains:
- Fly.io: `astro-backend-platform.fly.dev`
- Cloudflare Pages: `astro-app.pages.dev`

### Step-by-Step Deployment

#### Step 1: Supabase Cloud Project

1. Sign up at https://supabase.com
2. Create a new project (name: "astro", region: pick nearest)
3. Wait for it to provision (~2 min)
4. Go to Project Settings > API — copy:
   - **Project URL** (e.g., `https://abcdef.supabase.co`)
   - **anon/public key**
   - **service_role key** (keep this secret!)
5. Apply migrations:
   ```bash
   # Link local CLI to cloud project
   npx supabase link --project-ref <your-project-ref>

   # Push all migrations (schema + RLS policies)
   npx supabase db push
   ```
6. Verify in Supabase Dashboard > Table Editor that tables exist

#### Step 2: Fly.io Backend

1. Sign up at https://fly.io
2. Install flyctl: `brew install flyctl` (or see https://fly.io/docs/flyctl/install/)
3. Login: `fly auth login`
4. Create the app (the fly.toml already names it `astro-backend-platform`):
   ```bash
   fly apps create astro-backend-platform
   ```
5. Set secrets (production env vars):
   ```bash
   fly secrets set \
     SUPABASE_URL="https://abcdef.supabase.co" \
     SUPABASE_ANON_KEY="eyJ..." \
     SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
     RELAY_JWT_SECRET="$(openssl rand -hex 32)" \
     DEVICE_AUTH_JWT_SECRET="$(openssl rand -hex 32)" \
     ANTHROPIC_API_KEY="sk-ant-..."
   ```
6. Deploy:
   ```bash
   fly deploy
   ```
7. Verify: `curl https://astro-backend-platform.fly.dev/api/health`

#### Step 3: Cloudflare Pages Frontend

1. Sign up at https://cloudflare.com
2. Install wrangler: `npm install -g wrangler`
3. Login: `wrangler login`
4. Build the frontend with production API URL:
   ```bash
   # Set the backend URL for the frontend build
   VITE_SUPABASE_URL="https://abcdef.supabase.co" \
   VITE_SUPABASE_ANON_KEY="eyJ..." \
   VITE_API_BASE_URL="https://astro-backend-platform.fly.dev" \
   npm run build
   ```
5. Deploy:
   ```bash
   wrangler pages deploy dist --project-name astro-app
   ```
6. Visit: `https://astro-app.pages.dev`

#### Step 4: (Optional) Custom Domain

If you have `your-domain.com` or want a custom domain:

1. Add domain to Cloudflare (change nameservers at registrar)
2. In Cloudflare Pages > Custom domains > Add `astro.your-domain.com`
3. In Fly.io: `fly certs add astro-api.your-domain.com`
4. Add DNS records in Cloudflare:
   - `astro` → CNAME to `astro-app.pages.dev`
   - `astro-api` → CNAME to `astro-backend-platform.fly.dev`

---

## Part 4: Post-Deployment Verification

### Server Mode Smoke Tests

```
1. Open the frontend URL
2. You should see the login page
3. Register a new passkey (WebAuthn)
4. Create a project with a description
5. Add tasks to the plan
6. Verify activities appear in activity dialog
7. Change a setting (model or default provider)
8. Refresh the page — everything should persist
9. Open an incognito window — login again
   → Projects, settings, sidebar config should all sync
10. Hard refresh in original window
    → Data reloads from API
```

### Multi-User Test

```
1. Register User A (passkey on device/browser A)
2. Register User B (passkey on device/browser B)
3. User A creates a project
4. User B should NOT see User A's project (RLS isolation)
5. Both users can independently create/manage their own data
```

### API Health Check

```bash
# Check backend is running
curl https://astro-backend-platform.fly.dev/api/health

# Expected response:
# { "status": "ok", "mode": "server", "authenticated": false }

# Check with auth (if you have a token):
curl -H "Authorization: Bearer <token>" \
  https://astro-backend.fly.dev/api/health
```

---

## Part 5: Debugging Common Issues

### Backend won't start on Fly.io

```bash
# Check logs
fly logs

# SSH into the machine
fly ssh console

# Common issues:
# - Missing secrets: fly secrets list
# - Port conflict: check fly.toml ports match server/index.ts
# - Build failure: check Dockerfile copies all needed files
```

### Frontend can't reach backend (CORS)

The Hono server has CORS configured in `server/index.ts`. If you see CORS errors:
1. Check that the frontend origin is allowed
2. Verify `VITE_API_BASE_URL` points to the correct Fly.io URL
3. In dev, Vite proxies `/api` automatically — in production, the frontend needs the full backend URL

### Supabase connection fails

```bash
# Test from Fly.io machine
fly ssh console
node -e "
  const { createClient } = require('@supabase/supabase-js');
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  c.from('projects').select('count').then(console.log);
"
```

### Auth/passkey not working

WebAuthn requires HTTPS. It will NOT work on plain HTTP (except localhost).
- Local dev: works on `localhost:5173`
- Cloudflare tunnel: works (HTTPS)
- Cloudflare Pages: works (HTTPS)
- Fly.io direct: works (HTTPS on `*.fly.dev`)

### Migrations not applied

```bash
# Check what migrations have been applied
npx supabase migration list

# Push pending migrations
npx supabase db push

# If things are out of sync, reset (DESTRUCTIVE):
npx supabase db reset
```

### Data not syncing between devices

1. Check Supabase Realtime is enabled (Dashboard > Database > Replication)
2. Enable replication for tables: `projects`, `plan_nodes`, `plan_edges`, `user_profiles`, `display_settings`
3. Check browser console for `[realtime-sync]` logs

---

## Part 6: Architecture for Hosted Multi-User Service

Your vision of offering Astro as a hosted service makes sense. The architecture already supports it:

### What's already in place
- **RLS (Row Level Security)**: Every table has `user_id`-based policies — users can only see their own data
- **WebAuthn authentication**: Passwordless, phishing-resistant auth
- **Multi-device sync**: Supabase Realtime propagates changes across devices
- **Data export**: GDPR-compliant export endpoint (`GET /api/data/export`)

### What you'd need to add for teams
- **Team/organization model**: A `teams` table + `team_members` join table
- **Shared project access**: Update RLS policies to allow team members to access shared projects
- **Role-based access**: Owner/editor/viewer roles (the `project_members` table already exists as a skeleton)
- **Billing**: Stripe integration for paid tiers
- **Rate limiting**: Already has basic rate limiting; would need per-user quotas

### Recommended deployment for production multi-user
- **Supabase Pro** ($25/mo): 8GB DB, 100k MAU, daily backups
- **Fly.io** ($5-15/mo): Scale to 2+ machines for redundancy
- **Cloudflare Pages** (free): Unlimited bandwidth
- **Upstash Redis** ($0-10/mo): For relay horizontal scaling

Total estimated cost: ~$30-50/month to start, scales with users.

---

## Quick Reference: Environment Variables

### Frontend (Vite, prefix with VITE_)
| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Server mode | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Server mode | Supabase anon/public key |
| `VITE_ASTRO_LOCAL_MODE` | Optional | Set to "true" to force local mode |
| `VITE_API_BASE_URL` | Production | Backend URL (not needed in dev, Vite proxies) |

### Backend (Node.js)
| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Server mode | Supabase project URL |
| `SUPABASE_ANON_KEY` | Server mode | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server mode | Supabase service role key (SECRET) |
| `ASTRO_LOCAL_MODE` | Optional | Set to "true" to force local mode |
| `RELAY_JWT_SECRET` | Production | JWT secret for machine auth |
| `DEVICE_AUTH_JWT_SECRET` | Production | JWT secret for device auth |
| `ANTHROPIC_API_KEY` | AI features | Claude API key |
| `REDIS_URL` | Optional | Redis for relay horizontal scaling |
