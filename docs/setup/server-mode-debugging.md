# Server Mode Debugging Guide

Troubleshooting guide for the deployed server mode stack: Fly.io backend + Cloudflare Pages frontend + Supabase + agent runners.

## Architecture Quick Reference

```
Browser (Cloudflare Pages)
  │
  │  HTTPS (REST + SSE)
  │  Cross-origin → requires CORS
  ▼
Fly.io VM (Hono :3001 + Relay :3002)
  │                    ▲
  │  Postgres          │  WebSocket (WSS)
  ▼                    │
Supabase Cloud     Agent Runner
(auth + DB)        (user's machine)
```

Key principle: the Fly.io VM is a **coordination layer**. It never calls AI directly. In server mode, every AI endpoint checks `isServerMode()` and dispatches through the relay to agent runners, which use the user's own Claude credentials.

---

## Diagnosing Registration / Login Issues

### Symptom: "Something went wrong" on email registration

**Step 1: Check the backend is reachable**

```bash
curl -s https://astro-backend-platform.fly.dev/api/health | python3 -m json.tool
```

If this fails with DNS errors, the backend has no IP allocation:

```bash
fly ips list --app astro-backend-platform
# If empty:
fly ips allocate-v4 --shared --app astro-backend-platform
fly ips allocate-v6 --app astro-backend-platform
```

**Step 2: Check CORS and WebAuthn origins**

The most common registration failure is a domain mismatch. Three secrets must match your **frontend** domain (where the browser runs):

```bash
fly secrets list --app astro-backend-platform
```

These must all point to the frontend URL (NOT the backend URL):
- `WEBAUTHN_RP_ID` = `astro-app-29q.pages.dev` (domain only, no `https://`)
- `WEBAUTHN_ORIGIN` = `https://astro-app-29q.pages.dev` (full URL with `https://`)
- `CORS_ORIGIN` = `https://astro-app-29q.pages.dev` (full URL with `https://`)

Fix:

```bash
fly secrets set \
  WEBAUTHN_RP_ID="astro-app-29q.pages.dev" \
  WEBAUTHN_ORIGIN="https://astro-app-29q.pages.dev" \
  CORS_ORIGIN="https://astro-app-29q.pages.dev" \
  FRONTEND_URL="https://astro-app-29q.pages.dev" \
  --app astro-backend-platform
```

Fly.io auto-restarts the VM when secrets change.

**Step 3: Check browser console**

Open DevTools → Console tab. Look for:
- `CORS policy` errors → fix CORS_ORIGIN
- `SecurityError` or `NotAllowedError` → WebAuthn RP_ID/ORIGIN mismatch
- `Failed to fetch` → backend unreachable (check DNS, IPs)

**Step 4: Check backend logs**

```bash
fly logs --app astro-backend-platform | grep -E "\[auth\]|\[webauthn\]|error"
```

### Symptom: User registers but profile is missing (auth desync)

Supabase has a trigger (`handle_new_user`) that creates a `user_profiles` row when a user signs up in `auth.users`. If this trigger fails (race condition, constraint violation), the user exists in auth but has no profile.

**Self-healing**: All auth endpoints now call `ensureUserProfile()` (`server/lib/ensure-user-profile.ts`) which detects and repairs the desync automatically. If a user logs in and their profile is missing, it's created on the fly from `auth.users` metadata.

**Manual check**:

```sql
-- Find users in auth.users without a matching profile
SELECT au.id, au.email, au.created_at
FROM auth.users au
LEFT JOIN public.user_profiles up ON au.id = up.id
WHERE up.id IS NULL;
```

**Manual fix** (run against Supabase):

```sql
-- Insert missing profile
INSERT INTO public.user_profiles (id, name, email)
SELECT id, coalesce(raw_user_meta_data->>'name', ''), coalesce(email, '')
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.user_profiles)
ON CONFLICT (id) DO NOTHING;
```

**Migration**: `supabase/migrations/20260222000000_auth_profile_sync.sql` hardens the trigger with `ON CONFLICT DO NOTHING` and adds the `find_auth_user_by_email` RPC.

---

## Diagnosing Relay / Agent Runner Issues

### Symptom: No agent runners visible

```bash
# Check from the API
curl -s https://astro-backend-platform.fly.dev/api/relay/machines | python3 -m json.tool

# Check relay logs
fly logs --app astro-backend-platform | grep "\[relay\]"
```

Expected when healthy: relay logs show `machine.register` events and heartbeats.

### Symptom: Agent runner can't connect

Agent runners connect to `wss://astro-backend-platform.fly.dev:3002`.

1. **Port 3002 must be exposed** in `fly.toml`:

```toml
[[services]]
  internal_port = 3002
  protocol = "tcp"
  [[services.ports]]
    port = 3002
    handlers = ["tls"]
```

2. **Corporate firewalls** may block non-443 ports. Test from the runner's machine:

```bash
wscat -c wss://astro-backend-platform.fly.dev:3002
```

3. **JWT authentication**: In production, agent runners need a valid JWT token obtained via the device auth flow. In dev mode (`RELAY_JWT_SECRET` not set or `NODE_ENV !== production`), auth is relaxed.

### Symptom: AI operations time out or fail

Since the Fly.io VM doesn't run AI directly, AI failures mean:

1. **No agent runner connected** → the relay has nowhere to dispatch the task. Check `/api/relay/machines`.
2. **Agent runner has no Claude credentials** → the runner needs `ANTHROPIC_API_KEY` or Claude OAuth configured on the user's machine.
3. **Relay dispatch timeout** → check relay logs for `task.dispatch` and `task.timeout` events.

```bash
fly logs --app astro-backend-platform | grep -E "\[dispatch\]|\[relay\].*task"
```

---

## Diagnosing Database Issues

### Symptom: "password authentication failed"

The `DATABASE_URL` password may be wrong or not URL-encoded.

```bash
# Test from your machine
PGPASSWORD='your-password' psql \
  -h aws-0-us-east-1.pooler.supabase.com -p 6543 \
  -U postgres.your-project-ref -d postgres -c "SELECT 1"
```

If your password contains `@`, URL-encode it as `%40` in the DATABASE_URL:
```
postgresql://postgres.ref:password%40with%40ats@host:6543/postgres?pgbouncer=true
```

Reset the password via Supabase Dashboard → Settings → Database → Database password.

### Symptom: "relation does not exist"

Migrations haven't been run. Run all migrations:

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

for f in supabase/migrations/*.sql; do
  echo "=== Running: $(basename $f) ==="
  PGPASSWORD='your-password' psql \
    -h aws-0-us-east-1.pooler.supabase.com -p 6543 \
    -U postgres.your-project-ref -d postgres -f "$f"
done
```

NOTICEs about "already exists" are fine — migrations are idempotent.

### Symptom: "too many connections"

Using the wrong port. Supabase pooler (port **6543**, pgbouncer mode) supports many connections. Direct connections (port **5432**) are limited to ~20.

Ensure `DATABASE_URL` uses port 6543 and has `?pgbouncer=true`.

---

## Diagnosing Frontend Issues

### Symptom: Blank page after deploy

The frontend needs `VITE_API_BASE_URL` baked in at build time:

```bash
VITE_API_BASE_URL=https://astro-backend-platform.fly.dev \
VITE_SUPABASE_URL=https://your-ref.supabase.co \
VITE_SUPABASE_ANON_KEY=eyJ... \
npm run build

wrangler pages deploy dist --project-name=astro-app
```

Without `VITE_API_BASE_URL`, the React app calls `/api/...` on the same origin (Cloudflare Pages), which has no API.

### Symptom: API calls fail after frontend deploy

Check that the build env vars match production:

```bash
# In the browser console, check what the app thinks the API URL is:
# Look for fetch() calls in the Network tab — they should go to your Fly.io backend, not to the Cloudflare Pages domain.
```

---

## Multi-Backend Setup

For parallel development/testing, each developer can run their own Fly.io backend:

```bash
# Developer B creates their own app
fly apps create astro-backend-dev-b --org personal

# Copy fly.toml, change app name
# Set their own secrets (can share Supabase or use separate projects)
fly deploy --app astro-backend-dev-b

# Build frontend pointing to their backend
VITE_API_BASE_URL=https://astro-backend-dev-b.fly.dev npm run build
wrangler pages deploy dist --project-name=astro-app-dev-b
```

Agent runners are backend-agnostic — just point them to the right relay URL:

```bash
astro-agent setup --relay wss://astro-backend-dev-b.fly.dev:3002
```

---

## Health Check Cheat Sheet

```bash
# Backend alive?
curl -s https://astro-backend-platform.fly.dev/api/health | python3 -m json.tool

# Backend mode?
# "mode": "supabase" = server mode (good)
# "mode": "indexeddb" = missing Supabase env vars (bad for production)

# Relay machines?
curl -s https://astro-backend-platform.fly.dev/api/relay/machines | python3 -m json.tool

# Fly.io VM status?
fly status --app astro-backend-platform
fly machines list --app astro-backend-platform

# Fly.io IPs?
fly ips list --app astro-backend-platform

# Fly.io secrets (names only)?
fly secrets list --app astro-backend-platform

# Live logs?
fly logs --app astro-backend-platform

# SSH into container?
fly ssh console --app astro-backend-platform
```
