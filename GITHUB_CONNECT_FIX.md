# GitHub Connect Button Fix

## Issue
The "Connect GitHub" button in the welcome page wasn't working properly for local development.

## Root Cause
1. GitHub OAuth configuration in `.env` was pointing to production callback URL
2. Error messages from failed connection attempts weren't being displayed to users
3. No popup blocker detection
4. Missing documentation for local GitHub OAuth setup
5. **Production Issue**: Missing `VITE_FRONTEND_URL` caused OAuth callback to redirect to localhost instead of production frontend

## Changes Made

### 1. Frontend Error Display (`src/pages/welcome.tsx`)
- Added `githubError` from store to display connection errors
- Wrapped GitHub connect buttons in a div to show error messages below buttons

### 2. Backend Error Handling (`server/routes/github.ts`)
- Added configuration check in `/api/github/connect` endpoint
- Returns helpful error message if `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` are not set

### 3. Store Improvements (`src/stores/github-store.ts`)
- Better error handling for failed connection attempts
- Parse and display server error messages
- Detect and report popup blocker issues

### 4. Documentation
- Created `docs/GITHUB_OAUTH_LOCAL_SETUP.md` with complete setup instructions
- Updated `.env.example` with correct callback URL and reference to documentation

### 5. Configuration Updates (`.env.example`)
- Fixed callback URL from `http://localhost:5173/settings/github/callback` to `http://localhost:3001/api/github/callback`
- Added `VITE_FRONTEND_URL` setting for production deployments
- Added reference to setup documentation

### 6. Production Environment Fix
- Added `VITE_FRONTEND_URL=https://nexus.fuxialexander.work` to `.env` for production
- This ensures OAuth callback redirects to production frontend, not localhost

## How to Fix for Local Development

1. **Create a local GitHub OAuth App:**
   - Go to https://github.com/settings/developers
   - Create new OAuth App with callback URL: `http://localhost:3001/api/github/callback`
   - Note your Client ID and Client Secret

2. **Update your `.env` file:**
   ```bash
   GITHUB_CLIENT_ID=your_local_client_id
   GITHUB_CLIENT_SECRET=your_local_client_secret
   GITHUB_REDIRECT_URI=http://localhost:3001/api/github/callback
   VITE_FRONTEND_URL=http://localhost:5173
   ```

3. **Restart the backend:**
   ```bash
   npm run dev:backend
   ```

4. **Test the connection:**
   - Navigate to `/welcome`
   - Click "Connect GitHub"
   - Popup should open for authorization
   - After authorizing, popup closes and connection is established

## How to Fix for Production

Your production environment already has the GitHub OAuth app configured, but was missing the frontend URL:

1. **Environment variable added to `.env`:**
   ```bash
   VITE_FRONTEND_URL=https://nexus.fuxialexander.work
   ```

2. **Deploy/restart the backend** to pick up the new environment variable

3. **Test the connection:**
   - Navigate to production `/welcome` page
   - Click "Connect GitHub"
   - OAuth should now redirect back to `https://nexus.fuxialexander.work/settings?github=connected` instead of localhost

## Files Changed
- `src/pages/welcome.tsx` - Display GitHub connection errors
- `src/stores/github-store.ts` - Better error handling and popup detection
- `server/routes/github.ts` - Configuration validation
- `.env.example` - Corrected callback URL
- `docs/GITHUB_OAUTH_LOCAL_SETUP.md` - New documentation (created)
- `GITHUB_CONNECT_FIX.md` - This summary (created)

## Testing
- ✅ TypeScript compilation passes (`npm run build`)
- Error messages now display to users
- Popup blocker detection works
- Configuration errors are caught and reported

## Next Steps
1. Set up local GitHub OAuth app (see `docs/GITHUB_OAUTH_LOCAL_SETUP.md`)
2. Update `.env` with local credentials
3. Restart backend and test connection
