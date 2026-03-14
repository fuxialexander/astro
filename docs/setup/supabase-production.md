# Supabase Production Operations

How we run Supabase in production, what went wrong, and how we fixed it.

## Architecture

```
Browser (React app)
  |
  | Bearer JWT in Authorization header
  v
Fly.io Backend (Hono)
  |
  |-- Auth middleware verifies JWT locally (ES256, zero network calls)
  |-- Drizzle ORM queries Postgres via pooler (port 6543)
  |
  v
Supabase Cloud
  |-- PostgreSQL (data)
  |-- Auth (user sessions, JWT issuance)
  |-- Realtime (live subscriptions, optional)
```

The backend **never** calls `supabase.auth.getUser()` on every request. Instead, it verifies JWTs locally using the public key from Supabase's JWKS endpoint. This is the single most important optimization for egress.

## Supabase Plan & Billing

| Item | Value |
|------|-------|
| Plan | Pro ($25/month) |
| Spend cap | **Disabled** (required -- see below) |
| Region | US East (aws-0-us-east-1) |
| Egress included | 250 GB/month (Pro) |

### Why spend cap must be disabled

With spend cap **enabled**, Supabase throttles your project when you exceed included quotas. This means:
- Auth API calls start failing or timing out
- Database connections get rejected
- The entire app becomes unresponsive

With spend cap **disabled**, you pay for overages but the service stays up. Monitor usage closely (see [Monitoring](../guides/monitoring.md)).

### Upgrading / downgrading

- **Free -> Pro**: Supabase Dashboard -> Billing -> Upgrade. Takes effect immediately.
- **Spend cap toggle**: Billing -> Spend Cap -> Off. Requires Pro plan.
- **Pro -> Free**: Only do this if you're confident egress is under 2 GB/month. The free tier has 2 GB egress and 50,000 auth requests/month.

## The Egress Incident (March 2026)

### What happened

Supabase reported 14.8 GB egress in a billing period. The free tier includes 2 GB. The project was throttled and became unresponsive.

### Root causes

1. **Auth API calls on every request**: The auth middleware called `supabase.auth.getUser(token)` for every API request. With ~11,000+ requests/hour, this alone generated massive egress.

2. **SELECT * queries**: Data routes fetched entire rows (including large `messages` JSONB arrays, full `streamText` fields) when only metadata was needed.

3. **Session messages loaded eagerly**: The frontend fetched full session message arrays on every page load, even when only a title preview was needed.

### Fix (PR #978)

| Change | Egress reduction |
|--------|-----------------|
| Local JWT verification (ES256 JWKS) | Eliminates ~11,000 auth API calls/hour |
| Column-selective queries in data routes | Reduces per-query payload by 10-100x |
| `LEFT(content, 200)` for title previews | Caps unbounded first-message fetches |
| Lazy `ensureFullSession()` loading | Messages loaded only when user opens a session |

Expected steady-state egress: **~1-2 GB/month** (within free tier).

### Recovery steps taken

1. Upgraded to Supabase Pro plan
2. Disabled spend cap
3. Flushed local DNS cache (`sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`) -- Supabase throttling had poisoned DNS resolvers
4. Deployed the fix (PR #978)
5. Deployed ES256 JWT verification (see below)

## JWT Verification: ES256 with JWKS

### Background

Supabase signs JWTs with **ES256** (ECDSA P-256), not HS256. There is no shared "JWT secret" for symmetric verification. Instead, Supabase publishes its public key at a JWKS endpoint.

### How it works

```
Server startup:
  1. Fetch JWKS from ${SUPABASE_URL}/auth/v1/.well-known/jwks.json
  2. Extract ES256 public key(s), convert JWK -> crypto.KeyObject
  3. Cache keys in memory, keyed by kid (key ID)

Per request:
  1. Extract JWT from Authorization header (or ?token query param for SSE)
  2. Decode JWT header to get kid
  3. Look up cached public key by kid
  4. jwt.verify(token, publicKey, { algorithms: ['ES256'], audience: 'authenticated' })
  5. Extract user ID from sub claim
  6. Resolve team membership from DB (one query)
```

### Key file: `server/middleware/auth.ts`

The auth middleware has this verification chain:

```
1. ES256 JWKS verification (zero network calls after startup)
   |-- If SUPABASE_URL is set and JWKS loaded successfully
   |
2. Device auth JWT (CLI tokens, separate signing key)
   |-- For agent runners authenticated via device code flow
   |
3. Supabase API fallback (supabase.auth.getUser())
   |-- Only if JWKS keys failed to load (cachedKeys.size === 0)
   |-- This is the expensive path we're trying to avoid
```

### Key rotation

Supabase may rotate signing keys. The middleware handles this:
- JWKS is re-fetched every hour (background refresh)
- On verification failure, JWKS is re-fetched once and retried
- If the new key differs from the old one, verification is attempted with the new key

### No SUPABASE_JWT_SECRET needed

The old code required a `SUPABASE_JWT_SECRET` env var for HS256 verification. This is **no longer needed**. The middleware uses `SUPABASE_URL` (already required for other purposes) to derive the JWKS endpoint. Remove `SUPABASE_JWT_SECRET` from any env files or Fly.io secrets if present.

### Environment variables for auth

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Used to construct JWKS endpoint URL |
| `SUPABASE_ANON_KEY` | Yes | Fallback Supabase client (only used if JWKS fails) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Backend admin operations (bypasses RLS) |
| `DEVICE_AUTH_JWT_SECRET` | Yes (prod) | Signs CLI device auth tokens |
| `DEVICE_AUTH_REFRESH_SECRET` | Yes (prod) | Signs CLI refresh tokens |

`SUPABASE_JWT_SECRET` is **deprecated and unused**. Do not set it.

### Testing the JWT flow

```bash
# 1. Verify JWKS endpoint is accessible
curl -s https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json | python3 -m json.tool

# Expected: {"keys":[{"alg":"ES256","crv":"P-256","kty":"EC",...}]}

# 2. Check server logs after deploy for JWKS loading
fly logs --app <your-fly-app> | grep "\[auth\] JWKS"

# Expected: [auth] JWKS loaded: 1 ES256 key(s)

# 3. If you see "[auth] JWKS fetch failed" or "[auth] JWKS fetch error":
#    - Check that SUPABASE_URL is set correctly in Fly.io secrets
#    - Check that the Supabase project is not paused/throttled
#    - The middleware will fall back to Supabase API verification (works but adds egress)
```

## Egress Monitoring

### Where to check

- **Supabase Dashboard** -> Reports -> Usage: Shows egress, auth requests, DB size
- **Fly.io Dashboard** -> Metrics: Shows backend request volume, memory, CPU

### Warning thresholds

| Metric | Free tier limit | Pro tier included | Action threshold |
|--------|----------------|-------------------|-----------------|
| Egress | 2 GB/month | 250 GB/month | Alert at 50% of limit |
| Auth requests | 50,000/month | 100,000/month | Alert at 50% of limit |
| Database size | 500 MB | 8 GB | Alert at 70% |

### If egress spikes again

1. Check `fly logs` for `[auth] JWKS` messages -- if JWKS loading failed, every auth request falls back to Supabase API calls
2. Check for new routes that do `SELECT *` or fetch large columns unnecessarily
3. Check frontend for components that eagerly load full session messages
4. Check Supabase Dashboard -> Reports -> API to see which endpoints are most called

## RLS (Row Level Security)

All tables should have RLS enabled. Known issue: `github_app_installations` table has RLS disabled (tracked in issue #980). This is a security concern for multi-tenant data.

To check RLS status:
```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

## Related Documentation

- [Fly Deployment](./fly-deployment.md) -- Full deployment guide
- [Environment Variables](./environment-variables.md) -- All env vars
- [Authentication](../backend/authentication.md) -- WebAuthn, OAuth flows
- [Security Checklist](./security-checklist.md) -- Pre-deployment security
- [Monitoring](../guides/monitoring.md) -- Health checks, alerts, Telegram bot
