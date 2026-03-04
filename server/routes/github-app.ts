/**
 * GitHub App installation management routes
 *
 * Supports the full GitHub App installation flow:
 *   1. GET /install-url  — generate installation URL (requires auth + state)
 *   2. GET /callback     — handle post-install redirect from GitHub (stateless: uses state param)
 *   3. GET /installations — list installations for the current user / team
 *   4. POST /installations/:id/link — link an installation to a team
 *   5. DELETE /installations/:id    — unlink / remove an installation
 */

import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import { requireAuth, type AuthUser } from '../middleware/auth.js';
import { db } from '../lib/db/index.js';
import { githubAppInstallations, teamMembers } from '../lib/db/schema.js';
import { eq, and, or, inArray } from 'drizzle-orm';
import { getFrontendUrl } from '../lib/environment.js';

const app = new Hono();

// In-memory state store for CSRF protection (ephemeral, 10-min TTL).
const installStates = new Map<string, { userId: string; expiresAt: number }>();

function setInstallState(state: string, userId: string): void {
  installStates.set(state, { userId, expiresAt: Date.now() + 600_000 });
}

function verifyInstallState(state: string): string | null {
  const entry = installStates.get(state);
  installStates.delete(state); // consume once
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.userId;
}

// Auth on all routes except the callback (which comes from GitHub redirect).
app.use('/*', async (c, next) => {
  if (c.req.path.endsWith('/callback')) return next();
  return requireAuth(c, next);
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function getAppSlug(): string {
  return process.env.GITHUB_APP_SLUG || '';
}

function isConfigured(): boolean {
  return Boolean(getAppSlug());
}

/** Shared GitHub API request headers for App JWT calls. */
function ghAppHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Optionally fetch installation details from GitHub using the App JWT.
 * Returns null if GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY are not set.
 */
async function fetchInstallationDetails(installationId: number): Promise<{
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string | null;
  appId: number;
  repositorySelection: string;
  repos: { id: number; name: string; full_name: string; private: boolean }[];
  permissions: Record<string, string>;
} | null> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!appId || !privateKey) return null;

  try {
    // Build a GitHub App JWT
    const { default: jwt } = await import('jsonwebtoken');
    const now = Math.floor(Date.now() / 1000);
    const appJwt = jwt.sign(
      { iat: now - 60, exp: now + 540, iss: appId },
      privateKey,
      { algorithm: 'RS256' }
    );

    // Fetch installation info and create an installation access token in parallel
    const [installRes, tokenRes] = await Promise.all([
      fetch(
        `https://api.github.com/app/installations/${installationId}`,
        { headers: ghAppHeaders(appJwt) }
      ),
      fetch(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        { method: 'POST', headers: ghAppHeaders(appJwt) }
      ),
    ]);

    if (!installRes.ok) return null;
    const install = await installRes.json() as {
      account: { login: string; type: string; avatar_url: string };
      app_id: number;
      repository_selection: string;
      permissions: Record<string, string>;
    };

    let repos: { id: number; name: string; full_name: string; private: boolean }[] = [];
    if (tokenRes.ok) {
      const { token } = await tokenRes.json() as { token: string };
      const reposRes = await fetch(
        'https://api.github.com/installation/repositories?per_page=100',
        { headers: ghAppHeaders(token) }
      );
      if (reposRes.ok) {
        const reposData = await reposRes.json() as {
          repositories: { id: number; name: string; full_name: string; private: boolean }[]
        };
        repos = (reposData.repositories ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          full_name: r.full_name,
          private: r.private,
        }));
      }
    }

    return {
      accountLogin: install.account.login,
      accountType: install.account.type,
      accountAvatarUrl: install.account.avatar_url || null,
      appId: install.app_id,
      repositorySelection: install.repository_selection,
      repos,
      permissions: install.permissions ?? {},
    };
  } catch (err) {
    console.error('[github-app] Failed to fetch installation details:', err);
    return null;
  }
}

/**
 * Save a GitHub App installation to the database.
 * Exported so the OAuth callback can also save installations
 * when "Request user authorization during installation" is enabled.
 */
export async function saveInstallation(installationId: number, userId: string): Promise<void> {
  const details = await fetchInstallationDetails(installationId);

  if (!details) {
    throw new Error('Cannot verify installation — GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY not configured');
  }

  const installData = {
    installationId,
    userId,
    accountLogin: details.accountLogin,
    accountType: details.accountType,
    accountAvatarUrl: details.accountAvatarUrl ?? null,
    appId: details.appId ?? null,
    repositorySelection: details.repositorySelection,
    repos: details.repos,
    permissions: details.permissions,
  };

  await db
    .insert(githubAppInstallations)
    .values(installData)
    .onConflictDoUpdate({
      target: githubAppInstallations.installationId,
      set: { ...installData, updatedAt: new Date() },
    });
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/github-app/install-url
 * Returns the GitHub App installation URL (with CSRF state).
 */
app.get('/install-url', async (c) => {
  if (!isConfigured()) {
    return c.json(
      { error: 'GitHub App not configured. Set GITHUB_APP_SLUG environment variable.' },
      503
    );
  }

  const userId = (c.get('user') as AuthUser).id;
  const state = randomBytes(32).toString('hex');
  setInstallState(state, userId);

  const installUrl = `https://github.com/apps/${getAppSlug()}/installations/new?state=${state}`;
  return c.json({ installUrl });
});

/**
 * GET /api/github-app/callback
 * GitHub redirects here after the user installs (or updates) the app.
 * Query params: installation_id, setup_action, state
 */
app.get('/callback', async (c) => {
  const installationId = c.req.query('installation_id');
  const setupAction = c.req.query('setup_action'); // 'install' | 'update' | 'delete'
  const state = c.req.query('state');

  const frontendUrl = getFrontendUrl();

  if (!installationId || !state) {
    return c.redirect(`${frontendUrl}/settings?github-app=error&reason=missing_params`);
  }

  const userId = verifyInstallState(state);
  if (!userId) {
    return c.redirect(`${frontendUrl}/settings?github-app=error&reason=invalid_state`);
  }

  if (setupAction === 'delete') {
    // App was uninstalled from GitHub directly — remove from DB
    await db
      .delete(githubAppInstallations)
      .where(
        and(
          eq(githubAppInstallations.installationId, Number(installationId)),
          eq(githubAppInstallations.userId, userId)
        )
      );
    return c.redirect(`${frontendUrl}/settings?github-app=uninstalled`);
  }

  try {
    await saveInstallation(Number(installationId), userId);
  } catch (err) {
    console.error('[github-app] Installation save failed:', err);
    return c.redirect(`${frontendUrl}/settings?github-app=error&reason=app_not_configured`);
  }

  return c.redirect(`${frontendUrl}/settings?github-app=installed&installation_id=${installationId}`);
});

/**
 * GET /api/github-app/installations
 * List GitHub App installations for the current user (and their teams).
 */
app.get('/installations', async (c) => {
  const userId = (c.get('user') as AuthUser).id;

  // Fetch team IDs the user belongs to
  const memberRows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));

  const teamIds = memberRows.map((r) => r.teamId);

  const rows = await db
    .select()
    .from(githubAppInstallations)
    .where(
      teamIds.length > 0
        ? or(
            eq(githubAppInstallations.userId, userId),
            inArray(githubAppInstallations.teamId, teamIds)
          )
        : eq(githubAppInstallations.userId, userId)
    );

  return c.json({ installations: rows });
});

/**
 * POST /api/github-app/installations/:id/link
 * Link a GitHub App installation to the current team.
 * Body: { teamId: string | null }  — null unlinks from any team.
 */
app.post('/installations/:id/link', async (c) => {
  const userId = (c.get('user') as AuthUser).id;
  const installationId = Number(c.req.param('id'));

  if (!Number.isInteger(installationId) || installationId <= 0) {
    return c.json({ error: 'Invalid installation ID' }, 400);
  }

  const body = await c.req.json<{ teamId?: string | null }>();
  const teamId = body.teamId ?? null;

  // Verify installation ownership and team membership in parallel
  const [installRows, membershipRows] = await Promise.all([
    db
      .select()
      .from(githubAppInstallations)
      .where(
        and(
          eq(githubAppInstallations.installationId, installationId),
          eq(githubAppInstallations.userId, userId)
        )
      )
      .limit(1),
    teamId !== null
      ? db
          .select({ userId: teamMembers.userId })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const [row] = installRows;
  if (!row) {
    return c.json({ error: 'Installation not found or not owned by you' }, 404);
  }

  if (teamId !== null && membershipRows.length === 0) {
    return c.json({ error: 'You are not a member of that team' }, 403);
  }

  await db
    .update(githubAppInstallations)
    .set({ teamId, updatedAt: new Date() })
    .where(eq(githubAppInstallations.id, row.id));

  return c.json({ success: true });
});

/**
 * DELETE /api/github-app/installations/:id
 * Remove a GitHub App installation record (unlink from Astro).
 */
app.delete('/installations/:id', async (c) => {
  const userId = (c.get('user') as AuthUser).id;
  const installationId = Number(c.req.param('id'));

  if (!Number.isInteger(installationId) || installationId <= 0) {
    return c.json({ error: 'Invalid installation ID' }, 400);
  }

  const result = await db
    .delete(githubAppInstallations)
    .where(
      and(
        eq(githubAppInstallations.installationId, installationId),
        eq(githubAppInstallations.userId, userId)
      )
    );

  if ((result as { rowCount?: number }).rowCount === 0) {
    return c.json({ error: 'Installation not found or not owned by you' }, 404);
  }

  return c.json({ success: true });
});

export default app;
