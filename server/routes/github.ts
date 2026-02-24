/**
 * GitHub OAuth and repository management routes
 */

import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import { GitHubClient } from '../lib/github-client';
import { githubStore } from '../lib/github-store';

const app = new Hono();

// Initialize GitHub client
const githubClient = new GitHubClient(
  process.env.GITHUB_CLIENT_ID || '',
  process.env.GITHUB_CLIENT_SECRET || '',
  process.env.GITHUB_REDIRECT_URI || 'http://localhost:5173/settings/github/callback'
);

/**
 * GET /api/github/status
 * Check if user has GitHub connected
 */
app.get('/status', async (c) => {
  // TODO: Get userId from auth middleware
  const userId = 'default-user';

  const isConnected = githubStore.isConnected(userId);
  const connection = isConnected ? githubStore.getConnection(userId) : null;

  return c.json({
    connected: isConnected,
    user: connection?.user || null,
    connectedAt: connection?.connectedAt || null,
  });
});

/**
 * POST /api/github/connect
 * Initiate GitHub OAuth flow
 */
app.post('/connect', async (c) => {
  // Check if GitHub OAuth is configured
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return c.json({
      error: 'GitHub OAuth not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables.',
    }, 503);
  }

  // TODO: Get userId from auth middleware
  const userId = 'default-user';

  // Generate CSRF state token
  const state = randomBytes(32).toString('hex');
  githubStore.setOAuthState(state, userId);

  // Get authorization URL
  const authUrl = githubClient.getAuthorizationUrl(state);

  return c.json({ authUrl });
});

/**
 * GET /api/github/callback
 * Handle GitHub OAuth callback
 */
app.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return c.json({ error: 'Missing code or state' }, 400);
  }

  // Verify CSRF state
  const userId = githubStore.verifyOAuthState(state);
  if (!userId) {
    return c.json({ error: 'Invalid or expired state' }, 400);
  }

  try {
    // Exchange code for access token
    const tokenResponse = await githubClient.getAccessToken(code);

    // Get user info
    const user = await githubClient.getUser(tokenResponse.access_token);

    // Store connection
    githubStore.setConnection(userId, {
      userId,
      accessToken: tokenResponse.access_token,
      scope: tokenResponse.scope,
      connectedAt: new Date().toISOString(),
      user,
    });

    // Redirect to frontend settings page with success
    const frontendUrl = process.env.FRONTEND_URL || process.env.VITE_FRONTEND_URL || 'http://localhost:5173';
    return c.redirect(`${frontendUrl}/settings?github=connected`);
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || process.env.VITE_FRONTEND_URL || 'http://localhost:5173';
    return c.redirect(`${frontendUrl}/settings?github=error`);
  }
});

/**
 * POST /api/github/disconnect
 * Disconnect GitHub account
 */
app.post('/disconnect', async (c) => {
  // TODO: Get userId from auth middleware
  const userId = 'default-user';

  githubStore.disconnect(userId);

  return c.json({ success: true });
});

/**
 * GET /api/github/repos
 * Fetch all repositories
 */
app.get('/repos', async (c) => {
  // TODO: Get userId from auth middleware
  const userId = 'default-user';

  const connection = githubStore.getConnection(userId);
  if (!connection) {
    return c.json({ error: 'GitHub not connected' }, 401);
  }

  try {
    const repos = await githubClient.getRepositories(connection.accessToken, {
      sort: 'updated',
      direction: 'desc',
    });

    // Store repos in selection
    const selection = githubStore.getRepoSelection(userId);
    githubStore.setRepoSelection(userId, {
      userId,
      repos,
      selectedRepoIds: selection?.selectedRepoIds || [],
      lastSyncedAt: new Date().toISOString(),
    });

    return c.json({ repos });
  } catch (error) {
    console.error('GitHub repos fetch error:', error);
    return c.json({ error: 'Failed to fetch repositories' }, 500);
  }
});

/**
 * POST /api/github/repos/sync
 * Manually sync repositories
 */
app.post('/repos/sync', async (c) => {
  // TODO: Get userId from auth middleware
  const userId = 'default-user';

  const connection = githubStore.getConnection(userId);
  if (!connection) {
    return c.json({ error: 'GitHub not connected' }, 401);
  }

  try {
    const repos = await githubClient.getRepositories(connection.accessToken);

    // Update repos in selection
    const selection = githubStore.getRepoSelection(userId);
    githubStore.setRepoSelection(userId, {
      userId,
      repos,
      selectedRepoIds: selection?.selectedRepoIds || [],
      lastSyncedAt: new Date().toISOString(),
    });

    return c.json({ repos, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error('GitHub repos sync error:', error);
    return c.json({ error: 'Failed to sync repositories' }, 500);
  }
});

/**
 * GET /api/github/repos/selected
 * Get selected repository IDs
 */
app.get('/repos/selected', async (c) => {
  // TODO: Get userId from auth middleware
  const userId = 'default-user';

  const selection = githubStore.getRepoSelection(userId);

  return c.json({
    selectedRepoIds: selection?.selectedRepoIds || [],
    repos: selection?.repos.filter((r) =>
      selection.selectedRepoIds.includes(r.id)
    ) || [],
  });
});

/**
 * POST /api/github/repos/select
 * Update selected repositories
 */
app.post('/repos/select', async (c) => {
  // TODO: Get userId from auth middleware
  const userId = 'default-user';

  const body = await c.req.json();
  const { repoIds } = body as { repoIds: number[] };

  if (!Array.isArray(repoIds)) {
    return c.json({ error: 'repoIds must be an array' }, 400);
  }

  githubStore.updateSelectedRepos(userId, repoIds);

  return c.json({ success: true, selectedRepoIds: repoIds });
});

/**
 * GET /api/github/repo/:owner/:name
 * Get a specific repository by owner/name
 */
app.get('/repo/:owner/:name', async (c) => {
  // TODO: Get userId from auth middleware
  const userId = 'default-user';
  const owner = c.req.param('owner');
  const name = c.req.param('name');

  const connection = githubStore.getConnection(userId);
  if (!connection) {
    return c.json({ error: 'GitHub not connected' }, 401);
  }

  try {
    const repo = await githubClient.getRepository(
      connection.accessToken,
      owner,
      name
    );

    return c.json({ repo });
  } catch (error) {
    console.error('GitHub repo fetch error:', error);
    return c.json({ error: 'Failed to fetch repository' }, 500);
  }
});

/**
 * GET /api/github/branches/:owner/:name
 * List branches for a repository
 */
app.get('/branches/:owner/:name', async (c) => {
  // TODO: Get userId from auth middleware
  const userId = 'default-user';
  const owner = c.req.param('owner');
  const name = c.req.param('name');

  const connection = githubStore.getConnection(userId);
  if (!connection) {
    return c.json({ error: 'GitHub not connected' }, 401);
  }

  try {
    const branches = await githubClient.getBranches(
      connection.accessToken,
      owner,
      name
    );

    return c.json({
      branches: branches.map((b) => ({
        name: b.name,
        isRemote: true,
        isCurrent: false,
        isDefault: b.isDefault,
      })),
      defaultBranch: branches.find((b) => b.isDefault)?.name,
    });
  } catch (error) {
    console.error('GitHub branches fetch error:', error);
    return c.json({ error: 'Failed to fetch branches' }, 500);
  }
});

export default app;
