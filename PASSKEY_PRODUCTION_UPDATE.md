# Passkey Production Update Summary

✅ **iOS and web apps are now configured for production passkey deployment with `nexus.app` domain!**

## Changes Made

### 1. iOS PasskeyManager — Dynamic RP ID ✅

Updated `ios/NexusApp/Auth/PasskeyManager.swift` to **automatically derive** the relying party ID from the server URL:

```swift
private var relyingPartyIdentifier: String {
    let serverURL = SessionManager.shared.serverURL
    guard let url = URL(string: serverURL), let host = url.host else {
        return "localhost"
    }

    // localhost/127.0.0.1 → "localhost"
    if host == "localhost" || host == "127.0.0.1" {
        return "localhost"
    }

    // Production → extract domain (e.g., "nexus.app")
    return host
}
```

**How it works:**
- User sets server URL in iOS app: `https://nexus.app` → RP ID: `nexus.app`
- User sets server URL in iOS app: `http://localhost:5173` → RP ID: `localhost`
- **No code changes needed** when switching environments!

### 2. iOS Associated Domains ✅

Updated `ios/NexusApp/NexusApp.entitlements` and `ios/project.yml`:

```xml
<key>com.apple.developer.associated-domains</key>
<array>
    <string>webcredentials:nexus.app</string>
    <string>webcredentials:localhost</string>
</array>
```

**Supports both:**
- ✅ Production: `nexus.app` for cross-device passkey sync
- ✅ Development: `localhost` for local testing

### 3. Environment Variables ✅

Updated `.env.example` with production defaults:

```bash
WEBAUTHN_RP_NAME=Nexus
WEBAUTHN_RP_ID=nexus.app
WEBAUTHN_ORIGIN=https://nexus.app
```

**For local development**, create `.env.local`:

```bash
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:5173
```

### 4. Apple App Site Association ✅

Created `public/.well-known/apple-app-site-association`:

```json
{
  "webcredentials": {
    "apps": ["TEAMID.com.nexus.app"]
  }
}
```

**To deploy:**
1. Replace `TEAMID` with your Apple Developer Team ID
2. Deploy to `https://nexus.app/.well-known/apple-app-site-association`

### 5. Documentation ✅

Created comprehensive guides:
- `docs/PRODUCTION_PASSKEY_SETUP.md` — Full deployment guide
- `PRODUCTION_PASSKEY_QUICK_START.md` — Quick reference
- `public/.well-known/README.md` — Apple-app-site-association setup

## How Passkey Sync Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     iCloud Keychain                         │
│                   (Passkey Storage)                          │
└─────────────────────────────────────────────────────────────┘
         ↑                                    ↑
         │                                    │
         │ Sync                          Sync │
         │                                    │
    ┌────────┐                          ┌─────────┐
    │  Mac   │                          │ iPhone  │
    │  Web   │                          │   iOS   │
    │  App   │                          │   App   │
    └────────┘                          └─────────┘
         │                                    │
         │ WebAuthn                  WebAuthn │
         │ RP ID: nexus.app      RP ID: nexus.app
         │                                    │
    ┌────────────────────────────────────────────┐
    │        Server (nexus.app)                  │
    │   /api/auth/webauthn/register-options      │
    │   /api/auth/webauthn/login-options         │
    └────────────────────────────────────────────┘
```

### Flow

1. **Register on Mac (web app)**
   - User goes to `https://nexus.app/login`
   - Clicks "Create Passkey"
   - Server returns WebAuthn challenge with `rpId: "nexus.app"`
   - Browser creates passkey using Touch ID
   - Passkey saved to iCloud Keychain with RP ID `nexus.app`

2. **iCloud Keychain Sync** (30 seconds)
   - Passkey syncs to all devices signed into the same iCloud account

3. **Login on iPhone (iOS app)**
   - User opens iOS app
   - App configured with server URL: `https://nexus.app`
   - PasskeyManager derives RP ID: `nexus.app`
   - Taps "Sign In with Passkey"
   - iOS searches iCloud Keychain for RP ID `nexus.app`
   - Finds the passkey created on Mac ✅
   - User authenticates with Face ID
   - Same passkey, different biometric! 🎉

## What You Need to Do

### For Production Deployment

1. **Get your Apple Developer Team ID**
   - Go to [developer.apple.com/account](https://developer.apple.com/account)
   - Team ID is shown in top right (e.g., `A1B2C3D4E5`)

2. **Update `apple-app-site-association`**
   ```bash
   # Edit public/.well-known/apple-app-site-association
   # Replace TEAMID with your actual Team ID
   {
     "webcredentials": {
       "apps": ["A1B2C3D4E5.com.nexus.app"]
     }
   }
   ```

3. **Deploy to HTTPS**

   Choose your deployment method:

   **Option A: Cloudflare Pages (frontend) + Fly.io (backend)**
   ```bash
   # Frontend
   npm run deploy  # Deploys to Cloudflare Pages

   # Backend
   fly deploy     # Deploys to Fly.io
   ```

   **Option B: Cloudflare Tunnel (quick test)**
   ```bash
   cloudflared tunnel --url localhost:3001
   # Use the tunnel URL as your domain
   ```

   **Option C: Custom server with nginx/Apache**
   ```nginx
   server {
       listen 443 ssl http2;
       server_name nexus.app;
       # ... SSL configuration
   }
   ```

4. **Set environment variables**
   ```bash
   # Production .env
   WEBAUTHN_RP_ID=nexus.app
   WEBAUTHN_ORIGIN=https://nexus.app
   WEBAUTHN_RP_NAME=Nexus
   ```

5. **Verify deployment**
   ```bash
   # Test apple-app-site-association is accessible
   curl https://nexus.app/.well-known/apple-app-site-association

   # Should return JSON with your Team ID
   ```

6. **Configure iOS app**
   - Open iOS app
   - Tap logo on login screen to show server settings
   - Enter: `https://nexus.app`
   - Save

7. **Test passkey flow**
   - Register passkey on web (Mac)
   - Wait 30 seconds
   - Login on iOS app
   - Should use same passkey ✅

### For Local Development

No changes needed! Both environments are supported:

```bash
# .env.local (for development)
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:5173

# iOS app server URL
http://localhost:5173

# Passkeys work with localhost (no HTTPS required)
```

## Verification Checklist

After deploying to production:

- [ ] Web app accessible at `https://nexus.app`
- [ ] `WEBAUTHN_RP_ID=nexus.app` in production `.env`
- [ ] `WEBAUTHN_ORIGIN=https://nexus.app` in production `.env`
- [ ] `apple-app-site-association` accessible at `/.well-known/`
- [ ] Team ID updated in `apple-app-site-association`
- [ ] iOS app entitlements include `webcredentials:nexus.app`
- [ ] iOS app configured with `https://nexus.app` server URL
- [ ] Register passkey on web (Mac/PC)
- [ ] Login with same passkey on iOS app
- [ ] Verify cross-device sync works ✅

## Key Features

✅ **Automatic RP ID detection** — iOS app derives RP ID from server URL
✅ **Multi-environment support** — Works with localhost AND production
✅ **Cross-device sync** — Same passkey on Mac web app and iPhone iOS app
✅ **Zero config switching** — Just change server URL in iOS app settings
✅ **HTTPS enforcement** — Production requires HTTPS (localhost exempt)
✅ **iCloud Keychain** — Passkeys sync automatically across Apple devices

## Next Steps

1. **Get Apple Developer Team ID** from [developer.apple.com](https://developer.apple.com/account)
2. **Update `apple-app-site-association`** with your Team ID
3. **Deploy to HTTPS** using your preferred method
4. **Test the flow** end-to-end
5. **Deploy to App Store** (when ready)

See `docs/PRODUCTION_PASSKEY_SETUP.md` for detailed deployment instructions!
