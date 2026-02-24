# CLI Auth DNS Fix — 2026-02-24

## Problem

Running `npx @astroanywhere/agent@latest launch --force-setup` failed at device authentication:

```
✖ Failed to request device code
  Cannot reach API server at https://api.astroanywhere.com: fetch failed
```

This caused a cascade failure: device auth failed → no access token stored → remote SSH installation failed for every host with "No auth tokens available. Authenticate locally first."

## Root Cause

The Fly.io app is `astro-backend-deploy` (hostname `astro-backend-deploy.fly.dev`), and Cloudflare DNS had A records pointing `api.astroanywhere.com` and `relay.astroanywhere.com` to the Fly shared IP (`66.241.124.93`). However, **no TLS certificates were configured on Fly** for these custom domains. Fly only had a cert for its default `*.fly.dev` hostname, so the TLS handshake failed on the custom domains.

## Fix Applied

Added custom domain certificates on Fly:

```bash
fly certs add api.astroanywhere.com -a astro-backend-deploy
fly certs add relay.astroanywhere.com -a astro-backend-deploy
```

Both certs were issued by Let's Encrypt within ~30 seconds. Verified working:

- `https://api.astroanywhere.com/api/health` → 200 OK
- `https://relay.astroanywhere.com:3002/` → reachable (400 expected without WS handshake)

## Remaining UX Issues

The auth flow still has usability gaps that should be addressed:

### 1. Silent device auth failure doesn't prevent remote install

In `packages/agent-runner/src/commands/setup.ts`, if device auth fails (line 443-456), the error is printed but setup continues. Remote installation (step 8) then fails per-host because `config.getAccessToken()` is undefined.

**Fix:** If device auth failed, skip the remote installation step entirely with a clear message: "Skipping remote installation (requires successful device authentication)."

### 2. Confusing dual-auth UX

Setup has two sequential auth steps:
- **Step 5:** Device Authentication (Astro platform — registers machine with backend)
- **Step 6:** Claude SDK Authentication (Anthropic API — runs AI agents)

Users see one succeed and one fail, with no clear explanation that these serve different purposes.

**Fix:** Add brief explanations before each auth step, e.g.:
- "Authenticating with Astro platform (for machine management and task dispatch)..."
- "Authenticating with Claude API (for running AI agents)..."

### 3. Default URL assumes production backend exists

`packages/agent-runner/src/lib/config.ts` defaults to `https://api.astroanywhere.com` when no env vars are set. This is correct now that DNS/TLS works, but there's no fallback or helpful error if the production backend goes down.

**Consider:** A `--local` flag or auto-detection that falls back to `http://localhost:3001` when the production URL is unreachable.

## DNS/Cert Configuration Reference

| Domain | DNS Record | Points To | Fly Cert |
|--------|-----------|-----------|----------|
| `api.astroanywhere.com` | A | `66.241.124.93` (Fly shared IP) | Let's Encrypt (auto-renew) |
| `relay.astroanywhere.com` | A | `66.241.124.93` (Fly shared IP) | Let's Encrypt (auto-renew) |
| `astro-backend-deploy.fly.dev` | (Fly default) | — | Fly managed |

Fly app: `astro-backend-deploy` in `sjc` region, org `zhuoran-yang`.
