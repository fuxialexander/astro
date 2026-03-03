/**
 * GitHub OAuth routes: connect, disconnect, callback, status check.
 */

import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import { GitHubClient } from '../lib/github-client';
import { githubStore } from '../lib/github-store';
import { requireAuth, type AuthUser } from '../middleware/auth.js';

const app = new Hono();

// Require auth on all routes EXCEPT /callback (OAuth redirect has no auth token)
app.use('/*', async (c, next) => {
  if (c.req.path.endsWith('/callback')) return next();
  return requireAuth(c, next);
});

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
  const userId = (c.get('user') as AuthUser).id;

  const isConnected = await githubStore.isConnected(userId);
  const connection = isConnected ? await githubStore.getConnection(userId) : null;

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

  const userId = (c.get('user') as AuthUser).id;

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
    await githubStore.setConnection(userId, {
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
  const userId = (c.get('user') as AuthUser).id;

  await githubStore.disconnect(userId);

  return c.json({ success: true });
});

export default app;
