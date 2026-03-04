/**
 * GitHub repository sync, project linking/unlinking, and repo selection routes.
 */

import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { GitHubClient } from '../lib/github-client';
import { githubStore } from '../lib/github-store';
import { requireAuth, type AuthUser } from '../middleware/auth.js';
import { db } from '../lib/db/index.js';
import { projects, planNodes } from '../lib/db/schema.js';
import { eq, and } from 'drizzle-orm';

const app = new Hono();

app.use('/*', requireAuth);

const githubClient = new GitHubClient(
  process.env.GITHUB_CLIENT_ID || '',
  process.env.GITHUB_CLIENT_SECRET || '',
  process.env.GITHUB_REDIRECT_URI || 'http://localhost:5173/settings/github/callback'
);

// ── Repository endpoints ──────────────────────────────────────────────

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
    const [existing] = await db.select({ id: planNodes.id })
      .from(planNodes)
      .where(and(
        eq(planNodes.projectId, projectId),
        eq(planNodes.githubIssueNumber, issue.number)
      ))
      .limit(1);

    if (existing) {
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

export default app;
