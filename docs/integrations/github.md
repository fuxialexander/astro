# GitHub Integration Setup

This guide explains how to set up GitHub OAuth integration in Astro to allow users to browse and select their repositories.

## Features

- **OAuth Authentication**: Secure GitHub login using OAuth 2.0
- **Repository Browsing**: Browse all accessible GitHub repositories
- **Smart Search**: Search repos by name, full name, or description
- **Selective Linking**: Choose specific repos to use in projects
- **Auto-sync**: Manually refresh repository list when needed

## Setup Steps

### 1. Create a GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Fill in the application details:
   - **Application name**: `Astro` (or your preferred name)
   - **Homepage URL**: `http://localhost:5173` (dev) or your production URL
   - **Authorization callback URL**: `http://localhost:3001/api/github/callback`
4. Click **"Register application"**
5. Copy the **Client ID**
6. Click **"Generate a new client secret"** and copy the **Client Secret**

⚠️ **Security Note**: Never commit your Client Secret to git. Keep it confidential.

### 2. Configure Environment Variables

Add the following to your `.env` file:

```bash
# GitHub OAuth Configuration
GITHUB_CLIENT_ID=your_github_oauth_client_id_here
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret_here
GITHUB_REDIRECT_URI=http://localhost:3001/api/github/callback
```

For production deployments, update the redirect URI:

```bash
GITHUB_REDIRECT_URI=https://your-domain.example.com/settings/github/callback
```

### 3. Restart the Server

After adding environment variables, restart the backend server:

```bash
npm run dev:backend
```

## Usage

### Connecting GitHub

1. Open **Settings** in Astro
2. Look for the **GitHub Integration** section
3. Click **"Connect GitHub"**
4. Authorize the application in the OAuth popup
5. You'll be redirected back to Settings

### Using GitHub Repos in Projects

1. Go to **Project Settings** → **Repository & Directory**
2. If GitHub is connected, you'll see two options:
   - **Browse Repos**: Select from your GitHub repositories
   - **Manual URL**: Enter a repository URL manually
3. Click **"Browse Repos"** to see your repositories
4. Use the search bar to filter repos
5. Click on a repository to select it
6. The repository URL will be auto-filled

### Managing Repository Selection

- **Sync Repos**: Click the refresh icon to manually sync your repository list
- **Disconnect**: Click "Disconnect" to remove GitHub integration

## API Endpoints

The following endpoints are available:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/github/status` | GET | Check connection status |
| `/api/github/connect` | POST | Initiate OAuth flow |
| `/api/github/callback` | GET | OAuth callback handler |
| `/api/github/disconnect` | POST | Disconnect GitHub |
| `/api/github/repos` | GET | Fetch all repositories |
| `/api/github/repos/sync` | POST | Manually sync repositories |
| `/api/github/repos/selected` | GET | Get selected repo IDs |
| `/api/github/repos/select` | POST | Update selected repos |
| `/api/github/repo/:owner/:name` | GET | Get specific repository |

## Architecture

### Backend Components

- **`server/routes/github.ts`**: OAuth flow and repository management
- **`server/lib/github-client.ts`**: GitHub API wrapper
- **`server/lib/github-store.ts`**: In-memory connection/selection store
- **`server/types/github.ts`**: TypeScript types

### Frontend Components

- **`src/stores/github-store.ts`**: Zustand store for GitHub state
- **`src/components/github-connect-button.tsx`**: Connection UI component
- **`src/components/repo-config-dialog.tsx`**: Enhanced repo selection dialog
- **`src/types/index.ts`**: Type exports

## OAuth Scopes

The integration requests the following GitHub OAuth scopes:

- **`repo`**: Full access to public and private repositories
  - Required to read repository metadata, branches, and content
  - Allows Astro to clone and sync repositories

## Security Considerations

1. **Token Storage**: Access tokens are stored in-memory on the server
   - For production, use encrypted database storage
   - Consider token rotation and expiration policies

2. **CSRF Protection**: OAuth state tokens prevent CSRF attacks
   - State tokens expire after 10 minutes
   - Each authorization request generates a unique state

3. **Scope Minimization**: Only request necessary permissions
   - `repo` scope for full repo access
   - Consider `public_repo` for public-only access

## Troubleshooting

### "GitHub not connected" Error

- Check that `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set
- Verify the redirect URI matches your OAuth App settings
- Ensure the backend server is running

### OAuth Callback Fails

- Verify the callback URL in GitHub OAuth App settings
- Check browser console for CORS errors
- Ensure `GITHUB_REDIRECT_URI` matches the callback URL

### Repositories Not Loading

- Check network tab for API errors
- Verify GitHub token has `repo` scope
- Try disconnecting and reconnecting GitHub

## Future Enhancements

- [ ] Database persistence for connections (replace in-memory store)
- [ ] Webhook integration for automatic repo sync
- [ ] GitHub App installation (instead of OAuth)
- [ ] Repository webhook listeners for push events
- [ ] Branch and commit browsing
- [ ] Pull request integration
