# GitHub Integration - Quick Start

Get GitHub integration running in 5 minutes.

## Step 1: Create GitHub OAuth App (2 min)

1. Go to https://github.com/settings/developers
2. Click **"New OAuth App"**
3. Fill in:
   - **Application name**: `Nexus Local Dev`
   - **Homepage URL**: `http://localhost:5173`
   - **Callback URL**: `http://localhost:5173/settings/github/callback`
4. Click **"Register application"**
5. Copy your **Client ID**
6. Click **"Generate a new client secret"** and copy it

## Step 2: Add to .env (1 min)

Add these lines to your `.env` file:

```bash
GITHUB_CLIENT_ID=paste_your_client_id_here
GITHUB_CLIENT_SECRET=paste_your_client_secret_here
GITHUB_REDIRECT_URI=http://localhost:5173/settings/github/callback
```

## Step 3: Restart Server (1 min)

```bash
# Stop the server (Ctrl+C)
# Restart
npm run dev
```

## Step 4: Test (1 min)

1. Open http://localhost:5173
2. Go to any project
3. Click **"Repository & Directory"** settings
4. Click **"Connect GitHub"**
5. Authorize in the popup
6. Click **"Browse Repos"**
7. Search and select a repository!

---

**That's it!** 🎉

For detailed documentation, see [`GITHUB_INTEGRATION.md`](./GITHUB_INTEGRATION.md)

## Troubleshooting

**"Failed to connect to GitHub"**
- Check your Client ID and Client Secret are correct
- Make sure callback URL matches exactly
- Restart the server after adding env vars

**"No repositories found"**
- Make sure you have repos in your GitHub account
- Try clicking the refresh icon to sync
- Check browser console for errors

**OAuth popup doesn't open**
- Check for popup blockers
- Try a different browser
- Make sure server is running on port 3001
