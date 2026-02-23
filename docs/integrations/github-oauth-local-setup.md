# GitHub OAuth Local Development Setup

## Overview

The GitHub OAuth integration allows users to connect their GitHub account to browse and select repositories. For local development, you need to create a separate GitHub OAuth App with local callback URLs.

## Quick Setup

### 1. Create a Local GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the details:
   - **Application name**: `Astro Local Dev` (or any name you prefer)
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:3001/api/github/callback`
   - **Description**: (optional) Local development OAuth app
4. Click "Register application"
5. Note your **Client ID** (shown immediately)
6. Click "Generate a new client secret" and note your **Client Secret**

### 2. Update Environment Variables

Update your `.env` file with the local OAuth credentials:

```bash
# GitHub OAuth (Local Development)
GITHUB_CLIENT_ID=your_local_client_id_here
GITHUB_CLIENT_SECRET=your_local_client_secret_here
GITHUB_REDIRECT_URI=http://localhost:3001/api/github/callback
VITE_FRONTEND_URL=http://localhost:5173
```

**For Production:**

```bash
# GitHub OAuth (Production)
GITHUB_CLIENT_ID=your_production_client_id_here
GITHUB_CLIENT_SECRET=your_production_client_secret_here
GITHUB_REDIRECT_URI=https://your-api-domain.example.com/api/github/callback
VITE_FRONTEND_URL=https://your-frontend-domain.example.com
```

### 3. Restart the Backend

After updating `.env`, restart your backend server:

```bash
npm run dev:backend
```

## Testing the Integration

1. Navigate to `/welcome` or `/settings`
2. Click "Connect GitHub"
3. A popup should open with GitHub's authorization page
4. Authorize the app
5. The popup should close and your connection status should update

## Common Issues

### Popup Blocked

If the OAuth popup is blocked:
- Allow popups for `localhost:5173` in your browser
- Try clicking the "Connect GitHub" button again

### Configuration Not Set Error

If you see "GitHub OAuth not configured":
- Verify `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set in `.env`
- Restart the backend server
- Check the backend console for any errors

### Callback URL Mismatch

If the callback fails:
- Verify `GITHUB_REDIRECT_URI` in `.env` matches exactly: `http://localhost:3001/api/github/callback`
- Verify your GitHub OAuth App callback URL is: `http://localhost:3001/api/github/callback`
- Both must match exactly (including protocol and port)

## Production vs Development

- **Production** uses: `https://astro-api.your-domain.com/api/github/callback`
- **Local Dev** uses: `http://localhost:3001/api/github/callback`

You need separate GitHub OAuth Apps for each environment.

## Security Notes

- Never commit `.env` with real credentials to version control
- Client secrets are confidential and should be kept secure
- Local OAuth apps should only be used in development
- Production OAuth apps should use HTTPS callback URLs
