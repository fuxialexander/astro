/**
 * GitHub OAuth and repository management routes
 */

import { Hono } from 'hono';
import { randomBytes, randomUUID } from 'crypto';
import { GitHubClient } from '../lib/github-client';
import { githubStore } from '../lib/github-store';
import { requireAuth, type AuthUser } from '../middleware/auth.js';
import { db } from '../lib/db/index.js';
import { projects, planNodes, planEdges } from '../lib/db/schema.js';
import { eq, and, or, isNotNull, inArray } from 'drizzle-orm';

const app = new Hono();

// Require auth on all routes EXCEPT /callback (OAuth redirect has no auth token)
app.use('/*', async (c, next) => {
  if (c.req.path.endsWith('/callback')) return next();
  return requireAuth(c, next);
});

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

/**
 * GET /api/github/repos
 * Fetch all repositories
 */
app.get('/repos', async (c) => {
  const userId = (c.get('user') as AuthUser).id;

  const connection = await githubStore.getConnection(userId);
  if (!connection) {
    return c.json({ error: 'GitHub not connected' }, 401);
  }

  try {
    const repos = await githubClient.getRepositories(connection.accessToken, {
      sort: 'updated',
      direction: 'desc',
    });

    // Store repos in selection
    const selection = await githubStore.getRepoSelection(userId);
    await githubStore.setRepoSelection(userId, {
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
  const userId = (c.get('user') as AuthUser).id;

  const connection = await githubStore.getConnection(userId);
  if (!connection) {
    return c.json({ error: 'GitHub not connected' }, 401);
  }

  try {
    const repos = await githubClient.getRepositories(connection.accessToken);

    // Update repos in selection
    const selection = await githubStore.getRepoSelection(userId);
    await githubStore.setRepoSelection(userId, {
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
  const userId = (c.get('user') as AuthUser).id;

  const selection = await githubStore.getRepoSelection(userId);

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
  const userId = (c.get('user') as AuthUser).id;

  const body = await c.req.json();
  const { repoIds } = body as { repoIds: number[] };

  if (!Array.isArray(repoIds)) {
    return c.json({ error: 'repoIds must be an array' }, 400);
  }

  await githubStore.updateSelectedRepos(userId, repoIds);

  return c.json({ success: true, selectedRepoIds: repoIds });
});

/**
 * GET /api/github/repo/:owner/:name
 * Get a specific repository by owner/name
 */
app.get('/repo/:owner/:name', async (c) => {
  const userId = (c.get('user') as AuthUser).id;
  const owner = c.req.param('owner');
  const name = c.req.param('name');

  const connection = await githubStore.getConnection(userId);
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
  const userId = (c.get('user') as AuthUser).id;
  const owner = c.req.param('owner');
  const name = c.req.param('name');

  const connection = await githubStore.getConnection(userId);
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

// ── GitHub-linked project endpoints ──────────────────────────────────

/**
 * Sync GitHub issues into plan nodes for a project.
 */
async function syncIssuesForProject(
  projectId: string,
  owner: string,
  repo: string,
  accessToken: string
): Promise<{ created: number; updated: number; total: number }> {
  const issues = await githubClient.listIssues(accessToken, owner, repo, { state: 'open' });
  let created = 0;
  let updated = 0;

  for (const issue of issues) {
    const linkEntry = {
      id: `gh-${issue.number}`,
      type: 'github_issue',
      url: issue.html_url,
      title: issue.title,
      state: issue.state,
      number: issue.number,
    };

    // Check if a node with this github_issue_number already exists
    const [existing] = await db.select({
      id: planNodes.id,
      clientId: planNodes.clientId,
      deletedAt: planNodes.deletedAt,
      deletionActionId: planNodes.deletionActionId
    })
      .from(planNodes)
      .where(and(
        eq(planNodes.projectId, projectId),
        eq(planNodes.githubIssueNumber, issue.number)
      ))
      .limit(1);

    if (existing) {
      // Resurrect edges if the node was soft-deleted
      if (existing.deletedAt && existing.deletionActionId) {
        console.log(`[github] Resurrecting soft-deleted node ${existing.id} for issue #${issue.number}`);

        // Find edges that were deleted alongside this node
        const edgesToResurrect = await db.select()
          .from(planEdges)
          .where(and(
            eq(planEdges.projectId, projectId),
            or(
              eq(planEdges.sourceClientId, existing.clientId),
              eq(planEdges.targetClientId, existing.clientId)
            ),
            isNotNull(planEdges.deletionActionId),
            eq(planEdges.deletionActionId, existing.deletionActionId)
          ));

        // Resurrect the edges
        if (edgesToResurrect.length > 0) {
          console.log(`[github] Resurrecting ${edgesToResurrect.length} edges for node ${existing.id}`);
          await db.update(planEdges)
            .set({ deletedAt: null, deletionActionId: null, updatedAt: new Date() })
            .where(and(
              eq(planEdges.projectId, projectId),
              inArray(planEdges.id, edgesToResurrect.map(e => e.id))
            ));
        }
      }

      // Fetch existing links to merge (preserve user-added links)
      const [existingNode] = await db.select({ links: planNodes.links })
        .from(planNodes)
        .where(eq(planNodes.id, existing.id))
        .limit(1);
      const existingLinks = (existingNode?.links ?? []) as Array<{ id: string; type: string; url: string; title: string; state?: string; number?: number; targetId?: string }>;
      const mergedLinks = [
        ...existingLinks.filter((l) => l.id !== linkEntry.id),
        linkEntry,
      ];

      await db.update(planNodes).set({
        title: issue.title,
        description: issue.body || '',
        status: issue.state === 'open' ? 'planned' : 'completed',
        githubIssueUrl: issue.html_url,
        links: mergedLinks,
        updatedAt: new Date(),
        deletedAt: null, // Resurrect soft-deleted nodes
        deletionActionId: null, // Clear deletion tracking on resurrection
      }).where(eq(planNodes.id, existing.id));
      updated++;
    } else {
      await db.insert(planNodes).values({
        projectId,
        clientId: `gh-issue-${issue.number}`,
        type: 'task',
        title: issue.title,
        description: issue.body || '',
        status: issue.state === 'open' ? 'planned' : 'completed',
        verification: 'human',
        githubIssueNumber: issue.number,
        githubIssueUrl: issue.html_url,
        links: [linkEntry],
      });
      created++;
    }
  }

  return { created, updated, total: issues.length };
}

/**
 * POST /api/github/projects
 * Create a GitHub-linked project
 */
app.post('/projects', async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json();
  const { repoId, owner, repo, workingDirectory } = body as {
    repoId: number;
    owner: string;
    repo: string;
    workingDirectory?: string;
  };

  if (!repoId || !owner || !repo) {
    return c.json({ error: 'repoId, owner, and repo are required' }, 400);
  }

  // Validate GitHub is connected
  const connection = await githubStore.getConnection(user.id);
  if (!connection) {
    return c.json({ error: 'GitHub not connected' }, 401);
  }

  // Check for duplicate (global — matches the DB unique index on github_owner, github_repo)
  const [existing] = await db.select({ id: projects.id })
    .from(projects)
    .where(and(
      eq(projects.githubOwner, owner),
      eq(projects.githubRepo, repo),
      eq(projects.projectType, 'github')
    ))
    .limit(1);

  if (existing) {
    return c.json({ error: `A GitHub-linked project for ${owner}/${repo} already exists` }, 409);
  }

  // Create project
  const projectId = randomUUID();
  const [project] = await db.insert(projects).values({
    id: projectId,
    ownerId: user.id,
    name: `${owner}/${repo} (GitHub)`,
    projectType: 'github',
    githubOwner: owner,
    githubRepo: repo,
    githubRepoId: repoId,
    icon: '🔗',
    workingDirectory: workingDirectory || undefined,
    description: `GitHub-linked project for ${owner}/${repo}`,
    teamId: user.teamId,
  }).returning();

  // Trigger initial issue sync
  let syncStats = { created: 0, updated: 0, total: 0 };
  try {
    syncStats = await syncIssuesForProject(projectId, owner, repo, connection.accessToken);
  } catch (err) {
    console.error(`[github] Initial issue sync failed for ${owner}/${repo}:`, err);
  }

  return c.json({ project, sync: syncStats }, 201);
});

/**
 * POST /api/github/projects/:projectId/sync-issues
 * Sync issues from GitHub into plan nodes
 */
app.post('/projects/:projectId/sync-issues', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('projectId');

  // Look up project scoped to user's team
  const [project] = await db.select()
    .from(projects)
    .where(and(
      eq(projects.id, projectId),
      eq(projects.teamId, user.teamId)
    ))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (project.projectType !== 'github') {
    return c.json({ error: 'Project is not a GitHub-linked project' }, 400);
  }

  if (!project.githubOwner || !project.githubRepo) {
    return c.json({ error: 'Project is missing GitHub owner/repo configuration' }, 400);
  }

  // Get GitHub connection
  const connection = await githubStore.getConnection(user.id);
  if (!connection) {
    return c.json({ error: 'GitHub not connected' }, 401);
  }

  try {
    const stats = await syncIssuesForProject(
      projectId,
      project.githubOwner,
      project.githubRepo,
      connection.accessToken
    );
    return c.json(stats);
  } catch (err) {
    console.error(`[github] Issue sync failed for ${project.githubOwner}/${project.githubRepo}:`, err);
    return c.json({ error: 'Failed to sync issues' }, 500);
  }
});

/**
 * DELETE /api/github/projects/:projectId
 * Unlink (delete) a GitHub-linked project
 */
app.delete('/projects/:projectId', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('projectId');

  // Look up project scoped to user's team
  const [project] = await db.select({ id: projects.id, projectType: projects.projectType })
    .from(projects)
    .where(and(
      eq(projects.id, projectId),
      eq(projects.teamId, user.teamId)
    ))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (project.projectType !== 'github') {
    return c.json({ error: 'Project is not a GitHub-linked project' }, 400);
  }

  // Delete project (CASCADE removes plan nodes) — team-scoped for safety
  await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.teamId, user.teamId)));

  return c.body(null, 204);
});

/**
 * GET /api/github/projects
 * List GitHub-linked projects for the user's team
 */
app.get('/projects', async (c) => {
  const user = c.get('user') as AuthUser;

  const rows = await db.select()
    .from(projects)
    .where(and(
      eq(projects.projectType, 'github'),
      eq(projects.teamId, user.teamId)
    ));

  return c.json({ projects: rows });
});

// ── PR and branch management endpoints ──────────────────────────────

/**
 * POST /api/github/close-pr
 * Close a pull request via GitHub API
 */
app.post('/close-pr', async (c) => {
  const userId = (c.get('user') as AuthUser).id;

  const body = await c.req.json();
  const { owner, repo, prNumber } = body as {
    owner: string;
    repo: string;
    prNumber: number;
  };

  if (typeof owner !== 'string' || !owner.trim() ||
      typeof repo !== 'string' || !repo.trim() ||
      typeof prNumber !== 'number' || prNumber <= 0) {
    return c.json({ success: false, error: 'owner, repo, and a positive prNumber are required' }, 400);
  }

  const connection = await githubStore.getConnection(userId);
  if (!connection) {
    return c.json({ success: false, error: 'GitHub not connected' }, 401);
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state: 'closed' }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return c.json({
        success: false,
        error: `GitHub API error ${response.status}: ${errorBody}`,
      });
    }

    return c.json({ success: true, error: null });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[github] close-pr error:', msg);
    return c.json({ success: false, error: msg }, 500);
  }
});

/**
 * Helper: Resolve the SHA of a source branch with main/master fallback.
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param sourceBranch - Optional explicit source branch name
 * @param headers - GitHub API headers with auth token
 * @returns The SHA of the resolved branch, or null if not found
 */
async function resolveBranchSha(
  owner: string,
  repo: string,
  sourceBranch: string | undefined,
  headers: Record<string, string>
): Promise<{ sha: string | null; error?: string }> {
  const source = sourceBranch || 'main';

  const sourceRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(source)}`,
    { headers }
  );

  if (sourceRes.ok) {
    const data = await sourceRes.json();
    // Validate GitHub API response structure
    if (!data?.commit?.sha || typeof data.commit.sha !== 'string') {
      console.error('[github] Invalid API response structure:', JSON.stringify(data).slice(0, 500));
      return { sha: null, error: 'Invalid GitHub API response structure' };
    }
    return { sha: data.commit.sha };
  }

  // Try 'master' fallback only if no explicit source was given
  if (!sourceBranch) {
    const masterRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/master`,
      { headers }
    );
    if (masterRes.ok) {
      const data = await masterRes.json();
      // Validate GitHub API response structure
      if (!data?.commit?.sha || typeof data.commit.sha !== 'string') {
        console.error('[github] Invalid API response structure:', JSON.stringify(data).slice(0, 500));
        return { sha: null, error: 'Invalid GitHub API response structure' };
      }
      return { sha: data.commit.sha };
    }
    return { sha: null, error: `Could not find branch 'main' or 'master'` };
  }

  return { sha: null, error: `Source branch '${source}' not found` };
}

/**
 * POST /api/github/ensure-branch
 * Create a branch if it doesn't exist
 */
app.post('/ensure-branch', async (c) => {
  const userId = (c.get('user') as AuthUser).id;

  const body = await c.req.json();
  const { owner, repo, branchName, sourceBranch } = body as {
    owner: string;
    repo: string;
    branchName: string;
    sourceBranch?: string;
  };

  if (typeof owner !== 'string' || !owner.trim() ||
      typeof repo !== 'string' || !repo.trim() ||
      typeof branchName !== 'string' || !branchName.trim()) {
    return c.json({ success: false, error: 'owner, repo, and branchName are required' }, 400);
  }

  // Validate branch name contains only safe characters
  if (!/^[a-zA-Z0-9._\-/]+$/.test(branchName) || branchName.startsWith('-')) {
    return c.json({ success: false, error: 'Invalid branch name' }, 400);
  }

  const connection = await githubStore.getConnection(userId);
  if (!connection) {
    return c.json({ success: false, error: 'GitHub not connected' }, 401);
  }

  const headers = {
    Authorization: `Bearer ${connection.accessToken}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  try {
    // Check if branch already exists
    const checkRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}`,
      { headers }
    );

    if (checkRes.ok) {
      return c.json({ success: true, created: false, error: null });
    }

    // Resolve the SHA of the source branch
    const { sha, error: resolveError } = await resolveBranchSha(owner, repo, sourceBranch, headers);
    if (!sha) {
      return c.json({ success: false, error: resolveError || 'Failed to resolve source branch' });
    }

    // Create the branch
    const createRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha,
        }),
      }
    );

    if (!createRes.ok) {
      const errorBody = await createRes.text();
      return c.json({
        success: false,
        error: `Failed to create branch: ${errorBody}`,
      });
    }

    return c.json({ success: true, created: true, error: null });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[github] ensure-branch error:', msg);
    return c.json({ success: false, error: msg }, 500);
  }
});

export default app;
