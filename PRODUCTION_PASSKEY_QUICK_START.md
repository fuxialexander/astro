# Production Passkey Configuration - Quick Start

✅ **iOS app has been updated for production passkey support!**

## What Changed

### 1. iOS PasskeyManager (Dynamic RP ID)

The iOS app now **automatically derives** the relying party ID from the server URL:

- **Development**: `http://localhost:5173` → RP ID: `localhost`
- **Production**: `https://nexus.app` → RP ID: `nexus.app`

**No code changes needed** — the RP ID updates when users change the server URL in app settings!

### 2. iOS Associated Domains

Enabled for passkey sync across web and iOS:

```xml
<!-- ios/NexusApp/NexusApp.entitlements -->
<key>com.apple.developer.associated-domains</key>
<array>
    <string>webcredentials:localhost</string>
    <!-- Add production domain when deploying -->
</array>
```

### 3. Apple App Site Association

Created template at `public/.well-known/apple-app-site-association`:

```json
{
  "webcredentials": {
    "apps": ["TEAMID.com.nexus.app"]
  }
}
```

## How to Deploy to Production

### Option 1: Quick Deploy (Cloudflare Tunnel)

```bash
# 1. Start backend with cloudflared tunnel
cloudflared tunnel --url localhost:3001
# Note the tunnel URL: https://abc123.trycloudflare.com

# 2. Update .env with tunnel URL
WEBAUTHN_RP_ID=abc123.trycloudflare.com
WEBAUTHN_ORIGIN=https://abc123.trycloudflare.com

# 3. Update iOS entitlements
# ios/NexusApp/NexusApp.entitlements:
<string>webcredentials:abc123.trycloudflare.com</string>

# 4. Update apple-app-site-association
# Replace TEAMID with your Apple Developer Team ID
# Deploy to https://abc123.trycloudflare.com/.well-known/apple-app-site-association

# 5. Configure iOS app to use tunnel URL
# In iOS app: Settings → Server URL → https://abc123.trycloudflare.com
```

### Option 2: Custom Domain

```bash
# 1. Deploy web app to https://nexus.app

# 2. Update .env
WEBAUTHN_RP_ID=nexus.app
WEBAUTHN_ORIGIN=https://nexus.app

# 3. Update iOS entitlements
# ios/NexusApp/NexusApp.entitlements:
<string>webcredentials:nexus.app</string>

# 4. Update apple-app-site-association
# Replace TEAMID with your Apple Developer Team ID
# Deploy to https://nexus.app/.well-known/apple-app-site-association

# 5. Configure iOS app to use production URL
# In iOS app: Settings → Server URL → https://nexus.app
```

## Verification Checklist

After deploying:

- [ ] Web app accessible via HTTPS
- [ ] `WEBAUTHN_RP_ID` matches production domain (no protocol/port)
- [ ] `WEBAUTHN_ORIGIN` is full HTTPS URL
- [ ] Apple-app-site-association file accessible at `/.well-known/`
- [ ] iOS entitlements include production domain
- [ ] iOS app configured with production server URL
- [ ] Register passkey on web (Mac/PC with Touch ID/Face ID)
- [ ] Login with same passkey on iOS app (should sync via iCloud)

## Testing Cross-Device Sync

1. **Register passkey on Mac** (web app, Touch ID)
   - Go to `https://nexus.app/login`
   - Click "Create Passkey"
   - Enter email and complete Touch ID

2. **Wait 30 seconds** for iCloud Keychain sync

3. **Login on iPhone** (iOS app, Face ID)
   - Open Nexus iOS app
   - Tap "Sign In with Passkey"
   - Complete Face ID

4. **Verify success** ✅
   - Same passkey should authenticate on both devices
   - No need to register again on iPhone

## Troubleshooting

### Passkey not syncing

- ✅ Both devices signed into same iCloud account?
- ✅ iCloud Keychain enabled? (Settings → Apple ID → iCloud → Passwords)
- ✅ Both devices iOS 16+/macOS Ventura+?
- ✅ RP ID matches between web and iOS?

### "Security Error" on web

- ❌ Using HTTP on non-localhost domain
- ✅ Deploy to HTTPS or use localhost

### Different passkeys on web vs iOS

- ❌ RP ID mismatch
- ✅ Verify `WEBAUTHN_RP_ID` matches iOS server URL domain

## Full Documentation

See `docs/PRODUCTION_PASSKEY_SETUP.md` for complete deployment guide with:
- Detailed environment variable configuration
- Multiple deployment options (Cloudflare, Fly.io, custom)
- Apple-app-site-association setup
- Security best practices
- Advanced troubleshooting

## Summary

✅ **iOS PasskeyManager**: Automatically derives RP ID from server URL
✅ **Associated Domains**: Configured for localhost (add production domain when deploying)
✅ **Apple-app-site-association**: Template ready (replace TEAMID with yours)
✅ **Environment Variables**: Updated with production examples in `.env.example`
✅ **Cross-Device Sync**: Works via iCloud Keychain (same RP ID on web + iOS)

**Ready to deploy!** Just follow the steps above for your chosen deployment method.
