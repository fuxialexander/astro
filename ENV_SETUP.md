# Environment Setup Guide

This guide explains how to configure environment variables for Nexus.

## Quick Start

```bash
# 1. Copy example file
cp .env.example .env

# 2. Generate unique secrets
openssl rand -hex 32  # Run this 3 times for each JWT secret

# 3. Edit .env and replace placeholder values
# Replace GENERATE_WITH_openssl_rand_hex_32_REPLACE_THIS_VALUE_XXXX
# with the generated secrets

# 4. Fix file permissions (optional but recommended)
npm run env:fix-permissions
```

## Environment Files

| File | Purpose | Commit to Git? |
|------|---------|----------------|
| `.env.example` | Template with placeholders | ✅ Yes |
| `.env` | Local development config | ❌ No |
| `.env.local` | Local overrides | ❌ No |
| `.env.test` | Test environment config | ❌ No |
| `.env.production` | Production config | ❌ No |

## Required Variables

### JWT Secrets (CRITICAL)

Generate three unique 256-bit secrets:

```bash
openssl rand -hex 32  # For RELAY_JWT_SECRET
openssl rand -hex 32  # For DEVICE_AUTH_JWT_SECRET
openssl rand -hex 32  # For DEVICE_AUTH_REFRESH_SECRET
```

**Security requirements:**
- Each secret MUST be different
- Each secret MUST be 256-bit (64 hex characters)
- Rotate every 90 days
- Never reuse across environments

### Supabase Configuration

For **local development**:
```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

For **production** (with cloudflared tunnel):
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### WebAuthn/Passkeys

For **local development**:
```bash
WEBAUTHN_RP_NAME=Nexus
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:5173
```

For **production**:
```bash
WEBAUTHN_RP_NAME=Nexus
WEBAUTHN_RP_ID=your-domain.com
WEBAUTHN_ORIGIN=https://your-domain.com
```

## Optional Variables

### Redis (Horizontal Scaling)

Only needed for multi-instance relay server deployments:

```bash
REDIS_URL=redis://localhost:6379
```

Single-instance local dev works without Redis.

### Relay Server Port

Default is 3002:

```bash
RELAY_PORT=3002
```

### IndexedDB-Only Mode

Force IndexedDB mode (skip Supabase/auth):

```bash
USE_INDEXEDDB_ONLY=true
```

## Database Modes

Nexus supports two database modes:

### IndexedDB Mode (Default for Local Dev)

- No authentication required
- All data stored in browser
- Single-user only
- Perfect for rapid iteration

**Auto-enabled when:**
- `USE_INDEXEDDB_ONLY=true`, OR
- Supabase env vars not set

### Supabase Mode (Multi-User Production)

- WebAuthn/passkey authentication
- PostgreSQL database with RLS
- Multi-user with data isolation
- Real-time collaboration

**Auto-enabled when:**
- Supabase env vars are set
- `USE_INDEXEDDB_ONLY` is not `true`

## Security Checklist

Before deploying to production:

- [ ] All JWT secrets are unique 256-bit values
- [ ] JWT secrets are different from development
- [ ] `.env` file permissions are 600 (owner read/write only)
- [ ] `.env` files are not committed to git
- [ ] Supabase service role key is confidential
- [ ] WebAuthn RP_ID matches your domain
- [ ] WebAuthn ORIGIN is HTTPS in production
- [ ] Secrets rotation schedule is documented

## File Permissions

Protect your secrets by setting proper permissions:

```bash
# Automatic fix
npm run env:fix-permissions

# Manual fix
chmod 600 .env
chmod 600 .env.local
chmod 600 .env.production
```

Permissions should be:
- `600` - Owner can read/write, no one else can access
- `.env.example` can stay `644` (it has no real secrets)

## Secret Rotation

Rotate JWT secrets every 90 days:

1. Generate new secrets:
   ```bash
   openssl rand -hex 32  # Run 3 times
   ```

2. Update `.env` file with new values

3. Add rotation date comment:
   ```bash
   # Last rotation: 2026-02-15
   # Next rotation: 2026-05-15 (90 days)
   ```

4. Restart all services:
   ```bash
   npm run dev
   ```

5. Invalidate old tokens (if applicable)

## Troubleshooting

### "Missing required environment variable"

Make sure you've copied `.env.example` to `.env` and replaced all placeholder values.

### "JWT secrets must be unique in production"

Each of the three JWT secrets must be different. Generate new ones:

```bash
openssl rand -hex 32
```

### "Permission denied" when reading .env

Fix file permissions:

```bash
npm run env:fix-permissions
```

### IndexedDB mode not working

Check that either:
- `USE_INDEXEDDB_ONLY=true`, OR
- Supabase env vars are not set

### Passkeys not working

For production:
- WebAuthn requires HTTPS
- `WEBAUTHN_RP_ID` must match your domain (no protocol, no port)
- `WEBAUTHN_ORIGIN` must be full HTTPS URL
- Use cloudflared tunnel for local passkey testing

## Environment Validation

The server validates environment variables on startup. Check console output:

```
[env] Environment: production
[env] JWT secrets validated
[env] Supabase config validated
[env] WebAuthn config validated (RP: your-domain.com)
[env] Redis not configured (single-instance mode)
[env] Environment validation complete
```

If validation fails, fix the issues before proceeding.

## References

- [WebAuthn Guide](https://webauthn.guide/)
- [Supabase Local Development](https://supabase.com/docs/guides/cli/local-development)
- [OAuth2 Device Authorization Grant (RFC 8628)](https://datatracker.ietf.org/doc/html/rfc8628)
