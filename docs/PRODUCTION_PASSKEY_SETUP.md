# Production Passkey Setup Guide

This guide covers configuring WebAuthn/passkey authentication for production deployment of Nexus (both web and iOS apps).

## Overview

Passkeys use the **WebAuthn standard** and sync across devices via **iCloud Keychain** (Apple) or **Google Password Manager** (Android). For cross-platform sync to work, both web and iOS apps must use the **same relying party identifier (RP ID)**.

## Requirements

### For Production Passkeys

✅ **HTTPS is required** — Passkeys only work on secure origins
- ✅ Localhost is exempt (works with `http://localhost` for development)
- ❌ HTTP on non-localhost domains will fail
- ✅ Use a reverse proxy (nginx, Cloudflare Tunnel) or deploy to HTTPS platform

### Domain Configuration

Both web and iOS apps must use the **same RP ID**:

| Environment | Domain | RP ID | Origin |
|-------------|--------|-------|--------|
| **Development** | `localhost:5173` | `localhost` | `http://localhost:5173` |
| **Production** | `nexus.app` | `nexus.app` | `https://nexus.app` |
| **Production (subdomain)** | `app.nexus.com` | `nexus.com` | `https://app.nexus.com` |

⚠️ **Important**: The RP ID must be a **domain suffix** of the origin URL. For example:
- ✅ Origin `https://app.nexus.com` can use RP ID `nexus.com` or `app.nexus.com`
- ❌ Origin `https://app.nexus.com` **cannot** use RP ID `nexus.com` (wrong!)
- ✅ Best practice: Use the **full domain** as RP ID (e.g., `app.nexus.com`)

## Server Configuration

### 1. Set Environment Variables

Create a production `.env` file:

```bash
# WebAuthn Configuration
WEBAUTHN_RP_NAME=Nexus
WEBAUTHN_RP_ID=nexus.app                    # Your production domain (no protocol/port)
WEBAUTHN_ORIGIN=https://nexus.app           # Full URL with protocol

# Supabase (production instance)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Frontend (Vite requires VITE_ prefix)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

### 2. Deploy to HTTPS

Choose one of these deployment options:

#### Option A: Cloudflare Pages + Cloudflare Tunnel (Recommended)

```bash
# Deploy frontend to Cloudflare Pages
npm run deploy

# Start backend with cloudflared tunnel
cloudflared tunnel --url localhost:3001
# Note the tunnel URL (e.g., https://abc123.trycloudflare.com)
```

Update `.env`:
```bash
WEBAUTHN_RP_ID=abc123.trycloudflare.com
WEBAUTHN_ORIGIN=https://abc123.trycloudflare.com
```

#### Option B: Fly.io (Backend + Frontend)

```bash
# Deploy both frontend and backend to Fly.io
fly deploy
```

Update `.env`:
```bash
WEBAUTHN_RP_ID=nexus.fly.dev
WEBAUTHN_ORIGIN=https://nexus.fly.dev
```

#### Option C: Custom Domain with Reverse Proxy

```nginx
# nginx configuration
server {
    listen 443 ssl http2;
    server_name nexus.app;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:5173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
    }
}
```

Update `.env`:
```bash
WEBAUTHN_RP_ID=nexus.app
WEBAUTHN_ORIGIN=https://nexus.app
```

## iOS App Configuration

The iOS app **automatically derives the RP ID** from the server URL configured in the app.

### How It Works

```swift
// PasskeyManager.swift
private var relyingPartyIdentifier: String {
    let serverURL = SessionManager.shared.serverURL
    guard let url = URL(string: serverURL),
          let host = url.host else {
        return "localhost" // Fallback
    }

    // For localhost/127.0.0.1, return "localhost"
    if host == "localhost" || host == "127.0.0.1" {
        return "localhost"
    }

    // For production, return the full host (e.g., "nexus.app")
    return host
}
```

### User Configuration

Users set the server URL in the iOS app settings:

1. **Development**: `http://localhost:5173` → RP ID: `localhost`
2. **Production**: `https://nexus.app` → RP ID: `nexus.app`

### Associated Domains Entitlement

For production iOS apps, you need to configure **Associated Domains** to enable passkey sync:

1. **Add entitlement** to `ios/NexusApp/NexusApp.entitlements`:

```xml
<key>com.apple.developer.associated-domains</key>
<array>
    <string>webcredentials:nexus.app</string>
</array>
```

2. **Host the `apple-app-site-association` file** at `https://nexus.app/.well-known/apple-app-site-association`:

```json
{
  "webcredentials": {
    "apps": [
      "TEAMID.com.yourcompany.nexus"
    ]
  }
}
```

Replace `TEAMID` with your Apple Developer Team ID and `com.yourcompany.nexus` with your app's bundle ID.

## Database Setup

Ensure the `passkey_credentials` table exists in Supabase:

```sql
-- Already included in supabase/migrations/00000000000000_initial_schema.sql
CREATE TABLE passkey_credentials (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[],
  device_name TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Testing Production Passkeys

### 1. Register a Passkey (Web)

1. Navigate to `https://nexus.app/login`
2. Click "Create Passkey"
3. Enter your email
4. System passkey prompt appears (Touch ID/Face ID)
5. Confirm passkey creation

### 2. Verify Cross-Device Sync

1. **Register on Mac** (web app, Touch ID)
2. **Wait 30 seconds** for iCloud Keychain sync
3. **Login on iPhone** (iOS app, Face ID)
4. The same passkey should be available ✅

### 3. Troubleshooting

#### Passkey not syncing across devices

- ✅ Both devices must be signed into the same iCloud account
- ✅ iCloud Keychain must be enabled (Settings → Apple ID → iCloud → Passwords & Keychain)
- ✅ Both devices must have iOS 16+/macOS Ventura+ (for passkey sync)
- ✅ The RP ID must match between web and iOS app

#### "Security Error" in console

```
SecurityError: The operation is insecure
```

- ❌ You're using HTTP on a non-localhost domain
- ✅ Deploy to HTTPS or use localhost for development

#### "NotAllowedError: The operation was cancelled"

- ⚠️ User cancelled the passkey prompt (expected behavior)
- ⚠️ Or passkey prompt didn't appear (check browser compatibility)

#### Different passkeys on web vs. iOS

- ❌ The RP ID doesn't match between web and iOS
- ✅ Verify `WEBAUTHN_RP_ID` matches the domain in iOS app settings
- ✅ Check the server URL in iOS app (tap logo on login screen)

## Deployment Checklist

Before deploying to production:

- [ ] HTTPS enabled (required for passkeys)
- [ ] `WEBAUTHN_RP_ID` set to production domain (no protocol/port)
- [ ] `WEBAUTHN_ORIGIN` set to full production URL (with `https://`)
- [ ] `WEBAUTHN_RP_NAME` set to your app name (displayed in passkey prompt)
- [ ] Supabase production instance configured
- [ ] `passkey_credentials` table exists in Supabase
- [ ] iOS app associated domains entitlement added (for production)
- [ ] `apple-app-site-association` file hosted at `/.well-known/`
- [ ] Test passkey registration on web
- [ ] Test passkey login on web
- [ ] Test passkey login on iOS
- [ ] Verify cross-device sync (Mac → iPhone or vice versa)

## Security Best Practices

1. **Always use HTTPS** in production (required for passkeys)
2. **Validate RP ID** matches your domain exactly
3. **Don't expose service role keys** to frontend (use anon key only)
4. **Rotate secrets regularly** (JWT secrets, Supabase keys)
5. **Monitor failed authentication attempts** (rate limiting recommended)
6. **Use attestation** for high-security scenarios (set `attestationType: 'direct'`)

## References

- [WebAuthn Specification](https://www.w3.org/TR/webauthn-2/)
- [Apple Passkeys Documentation](https://developer.apple.com/documentation/authenticationservices/public-private_key_authentication/supporting_passkeys)
- [Supabase Auth Guide](https://supabase.com/docs/guides/auth)
- [@simplewebauthn/server Documentation](https://simplewebauthn.dev/docs/packages/server)
