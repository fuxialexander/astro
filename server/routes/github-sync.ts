/**
 * GitHub repository sync, project linking/unlinking, and repo selection routes.
 */

import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { GitHubClient, resolveGitHubToken } from '../lib/github-client';
import { githubStore } from '../lib/github-store';
import { requireAuth, type AuthUser } from '../middleware/auth.js';
import { sanitizeGitHubName } from '@astro/core/prompt-templates';
import { db } from '../lib/db/index.js';
import { projects, planNodes, planEdges, githubSyncLog } from '../lib/db/schema.js';
import { eq, and, or, isNotNull, isNull, inArray, notInArray, gte, desc, count } from 'drizzle-orm';
import { marked } from 'marked';
import {
  getLinkedNodeIdsForProject,
  getRepoCacheSnapshot,
  getWorkspaceGitHubSummary,
  syncGitHubRepoCache,
} from '../lib/github-repo-cache.js';

/** Convert GitHub issue body (markdown) to HTML for the tiptap `content` field. */
function githubMarkdownToHtml(body: string | null | undefined): string | null {
  if (!body) return null;
  return marked.parse(body, { async: false, gfm: true, breaks: true }) as string;
}


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
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Unauthorized') || msg.includes('401')) {
      return c.json({ error: 'GitHub token expired. Please reconnect GitHub.' }, 401);
    }
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
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Unauthorized') || msg.includes('401')) {
      return c.json({ error: 'GitHub token expired. Please reconnect GitHub.' }, 401);
    }
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
  const owner = sanitizeGitHubName(c.req.param('owner'));
  const name = sanitizeGitHubName(c.req.param('name'));

  if (!owner || !name) {
    return c.json({ error: 'Invalid owner or repo name' }, 400);
  }

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
  const owner = sanitizeGitHubName(c.req.param('owner'));
  const name = sanitizeGitHubName(c.req.param('name'));

  if (!owner || !name) {
    return c.json({ error: 'Invalid owner or repo name' }, 400);
  }

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
): Promise<{ created: number; updated: number; total: number; cleared: number; clearedTitles: string[] }> {
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

        if (edgesToResurrect.length > 0) {
          console.log(`[github] Resurrecting ${edgesToResurrect.length} edges for node ${existing.id}`);
          await db.update(planEdges)
            .set({ deletedAt: null, deletionActionId: null })
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
        content: githubMarkdownToHtml(issue.body),
        status: issue.state === 'open' ? 'planned' : 'completed',
        githubIssueUrl: issue.html_url,
        links: mergedLinks,
        updatedAt: new Date(),
        deletedAt: null,
        deletionActionId: null,
      }).where(eq(planNodes.id, existing.id));
      updated++;
    } else {
      await db.insert(planNodes).values({
        projectId,
        clientId: `gh-issue-${issue.number}`,
        type: 'task',
        title: issue.title,
        description: issue.body || '',
        content: githubMarkdownToHtml(issue.body),
        status: issue.state === 'open' ? 'planned' : 'completed',
        verification: 'human',
        githubIssueNumber: issue.number,
        githubIssueUrl: issue.html_url,
        links: [linkEntry],
      });
      created++;
    }
  }

  // ── Reconcile closed issues: clear plan nodes whose issues are no longer open ──
  // Since we fetched ALL open issues above, any linked plan node NOT in that set
  // has a closed (or deleted) GitHub issue. Soft-delete those nodes.
  const openIssueNumbers = issues.map(i => i.number);
  let cleared = 0;
  const clearedTitles: string[] = [];

  // Only reconcile if we got a successful response (openIssueNumbers may be empty
  // if every issue is closed — that's valid and we should clear them all)
  const staleConditions = [
    eq(planNodes.projectId, projectId),
    isNotNull(planNodes.githubIssueNumber),
    isNull(planNodes.deletedAt),
    // Don't clear nodes that are actively being worked on
    inArray(planNodes.status, ['planned', 'completed', 'auto_verified', 'awaiting_judgment']),
  ];
  // If there are open issues, exclude their numbers from the stale query
  if (openIssueNumbers.length > 0) {
    staleConditions.push(notInArray(planNodes.githubIssueNumber, openIssueNumbers));
  }

  const staleNodes = await db.select({
    id: planNodes.id,
    title: planNodes.title,
    githubIssueNumber: planNodes.githubIssueNumber,
  })
    .from(planNodes)
    .where(and(...staleConditions));

  if (staleNodes.length > 0) {
    const deletionActionId = `sync-clear-${Date.now()}`;
    await db.update(planNodes).set({
      status: 'completed',
      completedAt: new Date(),
      deletedAt: new Date(),
      deletionActionId,
      updatedAt: new Date(),
    }).where(inArray(planNodes.id, staleNodes.map(n => n.id)));

    // Also soft-delete associated edges
    for (const node of staleNodes) {
      await db.update(planEdges).set({
        deletedAt: new Date(),
        deletionActionId,
      }).where(and(
        eq(planEdges.projectId, projectId),
        or(
          eq(planEdges.sourceClientId, `gh-issue-${node.githubIssueNumber}`),
          eq(planEdges.targetClientId, `gh-issue-${node.githubIssueNumber}`)
        ),
        isNull(planEdges.deletedAt),
      ));
    }

    cleared = staleNodes.length;
    clearedTitles.push(...staleNodes.map(n => `#${n.githubIssueNumber} ${n.title}`));
    console.log(`[github] Cleared ${cleared} closed-issue nodes for ${owner}/${repo}: ${clearedTitles.join(', ')}`);
  }

  return { created, updated, total: issues.length, cleared, clearedTitles };
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

  // Only one projectType='github' project per repo — this is the GitHub Command Center
  // that tracks PRs, issues, and webhooks. Regular plan projects can freely share the
  // same repo (they use git worktrees for isolation).
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
    name: `${owner}/${repo} [GitHub Repo]`,
    projectType: 'github',
    githubOwner: owner,
    githubRepo: repo,
    githubRepoId: repoId,
    icon: '🔗',
    workingDirectory: workingDirectory || undefined,
    description: `GitHub-linked project for ${owner}/${repo}`,
    teamId: user.teamId,
  }).returning();

  // Trigger initial issue sync — prefer installation token over user OAuth
  let syncStats = { created: 0, updated: 0, total: 0 };
  let cacheStats: { issueCount: number; prCount: number; syncedAt: string } | null = null;
  try {
    const tokenResult = await resolveGitHubToken(owner, repo, user.id, user.teamId ?? null);
    const syncToken = tokenResult?.token ?? connection.accessToken;
    if (tokenResult) {
      console.log(`[github] Issue sync using ${tokenResult.type} token (${tokenResult.source}) for ${owner}/${repo}`);
    }
    syncStats = await syncIssuesForProject(projectId, owner, repo, syncToken);
    cacheStats = await syncGitHubRepoCache(project, user.id, user.teamId ?? null);
  } catch (err) {
    console.error(`[github] Initial issue sync failed for ${owner}/${repo}:`, err);
  }

  return c.json({ project, sync: syncStats, repoCache: cacheStats }, 201);
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
      inArray(projects.teamId, user.teamIds)
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

  // Resolve GitHub token via the unified priority chain (installation → env → OAuth)
  const tokenResult = await resolveGitHubToken(
    project.githubOwner,
    project.githubRepo,
    user.id,
    user.teamId ?? null,
  );

  if (!tokenResult) {
    const connection = await githubStore.getConnection(user.id);
    if (!connection) {
      return c.json({ error: 'GitHub not connected. Connect your GitHub account or configure a GitHub App.' }, 401);
    }
    return c.json({ error: 'No GitHub token available for this repository' }, 401);
  }

  console.log(`[github] Issue sync using ${tokenResult.type} token (${tokenResult.source}) for ${project.githubOwner}/${project.githubRepo}`);

  try {
    const stats = await syncIssuesForProject(
      projectId,
      project.githubOwner,
      project.githubRepo,
      tokenResult.token,
    );
    const repoCache = await syncGitHubRepoCache(project, user.id, user.teamId ?? null);
    return c.json({ ...stats, repoCache });
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
      inArray(projects.teamId, user.teamIds)
    ))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (project.projectType !== 'github') {
    return c.json({ error: 'Project is not a GitHub-linked project' }, 400);
  }

  // Soft-delete the project (consistent with DELETE /api/projects/:id) so that
  // dashboard stats and earned achievements are preserved.  A hard DELETE would
  // cascade-delete task_executions, plan_nodes, and streaming_events, causing
  // lifetime stats (lines added, PRs merged, speed-demon flag, etc.) to drop and
  // preventing future achievement awards based on that historical work.
  await db.update(projects)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), inArray(projects.teamId, user.teamIds)));

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
      inArray(projects.teamId, user.teamIds)
    ));

  return c.json({ projects: rows });
});

// ── Repo Cache & Workspace Endpoints ─────────────────────────────────

/**
 * POST /api/github/projects/:projectId/repo-cache/sync
 * Refresh the repo explorer cache (issues + PRs) for a GitHub-linked project.
 */
app.post('/projects/:projectId/repo-cache/sync', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('projectId');

  const [project] = await db.select()
    .from(projects)
    .where(and(eq(projects.id, projectId), inArray(projects.teamId, user.teamIds)))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (project.projectType !== 'github') {
    return c.json({ error: 'Project is not a GitHub-linked project' }, 400);
  }

  try {
    const repoCache = await syncGitHubRepoCache(project, user.id, user.teamId ?? null);
    return c.json({ success: true, repoCache });
  } catch (error) {
    console.error(`[github] Repo cache sync failed for ${project.githubOwner}/${project.githubRepo}:`, error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to sync repo cache' }, 500);
  }
});

/**
 * GET /api/github/projects/:projectId/repo-cache
 * Return cached issues + PRs for the repo explorer tab.
 */
app.get('/projects/:projectId/repo-cache', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('projectId');

  const [project] = await db.select()
    .from(projects)
    .where(and(eq(projects.id, projectId), inArray(projects.teamId, user.teamIds)))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (project.projectType !== 'github') {
    return c.json({ error: 'Project is not a GitHub-linked project' }, 400);
  }

  const [snapshot, linkedNodeIds] = await Promise.all([
    getRepoCacheSnapshot(projectId),
    getLinkedNodeIdsForProject(projectId),
  ]);

  return c.json({
    ...snapshot,
    repo: `${project.githubOwner}/${project.githubRepo}`,
    linkedNodeIds,
  });
});

/**
 * GET /api/github/projects/:projectId/pr/:prNumber/files
 * Fetch the changed files (with patch diffs) for a pull request.
 */
app.get('/projects/:projectId/pr/:prNumber/files', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('projectId');
  const prNumber = Number(c.req.param('prNumber'));

  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    return c.json({ error: 'Invalid PR number' }, 400);
  }

  const [project] = await db.select()
    .from(projects)
    .where(and(eq(projects.id, projectId), inArray(projects.teamId, user.teamIds)))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (project.projectType !== 'github' || !project.githubOwner || !project.githubRepo) {
    return c.json({ error: 'Project is not a GitHub-linked project' }, 400);
  }

  const tokenResult = await resolveGitHubToken(
    project.githubOwner,
    project.githubRepo,
    user.id,
    user.teamId ?? null,
  );

  if (!tokenResult) {
    return c.json({ error: 'No GitHub token available' }, 401);
  }

  try {
    const { getPrFiles } = await import('../lib/github-repo-cache.js');
    const files = await getPrFiles(tokenResult.token, project.githubOwner, project.githubRepo, prNumber);
    return c.json({ files });
  } catch (err) {
    console.error(`[github] PR files fetch failed for ${project.githubOwner}/${project.githubRepo}#${prNumber}:`, err);
    return c.json({ error: 'Failed to fetch PR files' }, 500);
  }
});

/**
 * GET /api/github/workspace/summary
 * Aggregate repo explorer health across all GitHub-linked projects in the team.
 */
app.get('/workspace/summary', async (c) => {
  const user = c.get('user') as AuthUser;

  const githubProjects = await db.select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.projectType, 'github'), inArray(projects.teamId, user.teamIds)));

  const summary = await getWorkspaceGitHubSummary(githubProjects.map((project) => project.id));
  return c.json(summary);
});

// ── Issue creation, linking, and search endpoints ─────────────────────

/** Map Astro priority to GitHub labels */
function priorityToGitHubLabel(priority?: string): string | null {
  switch (priority) {
    case 'urgent': return 'P0';
    case 'high': return 'P1';
    case 'medium': return 'P2';
    case 'low': return 'P3';
    default: return null;
  }
}

/**
 * POST /api/github/issues
 * Create a GitHub issue from an Astro task node
 */
app.post('/issues', async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json();
  const { nodeId, projectId } = body as { nodeId: string; projectId: string };

  if (!nodeId || !projectId) {
    return c.json({ error: 'nodeId and projectId are required' }, 400);
  }

  // Look up project (must be github-linked, team-scoped)
  const [project] = await db.select()
    .from(projects)
    .where(and(
      eq(projects.id, projectId),
      inArray(projects.teamId, user.teamIds)
    ))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (project.projectType !== 'github' || !project.githubOwner || !project.githubRepo) {
    return c.json({ error: 'Project is not a GitHub-linked project' }, 400);
  }

  // Look up node
  const [node] = await db.select()
    .from(planNodes)
    .where(and(
      eq(planNodes.id, nodeId),
      eq(planNodes.projectId, projectId)
    ))
    .limit(1);

  if (!node) {
    return c.json({ error: 'Task node not found' }, 404);
  }

  if (node.githubIssueNumber) {
    return c.json({ error: `Task already linked to GitHub issue #${node.githubIssueNumber}` }, 409);
  }

  // Resolve token
  const tokenResult = await resolveGitHubToken(
    project.githubOwner,
    project.githubRepo,
    user.id,
    user.teamId ?? null,
  );

  if (!tokenResult) {
    return c.json({ error: 'No GitHub token available for this repository' }, 401);
  }

  // Build labels (include priority label if applicable)
  const labels: string[] = [];
  const priorityLabel = priorityToGitHubLabel(node.priority ?? undefined);
  if (priorityLabel) labels.push(priorityLabel);

  try {
    const issue = await githubClient.createIssue(
      tokenResult.token,
      project.githubOwner,
      project.githubRepo,
      {
        title: node.title,
        body: node.description || '',
        labels,
      }
    );

    // Build link entry
    const linkEntry = {
      id: `gh-${issue.number}`,
      type: 'github_issue',
      url: issue.html_url,
      title: issue.title,
      state: issue.state,
      number: issue.number,
    };

    // Merge into existing links
    const existingLinks = (node.links ?? []) as Array<{ id: string; type: string; url: string; title: string; state?: string; number?: number; targetId?: string }>;
    const mergedLinks = [
      ...existingLinks.filter((l) => l.id !== linkEntry.id),
      linkEntry,
    ];

    // Update node with GitHub issue data + sync tracking
    await db.update(planNodes).set({
      githubIssueNumber: issue.number,
      githubIssueUrl: issue.html_url,
      links: mergedLinks,
      githubSyncedAt: new Date(),
      githubSyncVersion: (node.githubSyncVersion ?? 0) + 1,
      syncSource: 'user',
      updatedAt: new Date(),
    }).where(eq(planNodes.id, nodeId));

    return c.json({
      issue: {
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        state: issue.state,
      },
    }, 201);
  } catch (err) {
    console.error(`[github] Failed to create issue for node ${nodeId}:`, err);
    return c.json({ error: 'Failed to create GitHub issue' }, 500);
  }
});

/**
 * POST /api/github/issues/link
 * Link an existing GitHub issue to an Astro task node
 */
app.post('/issues/link', async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json();
  const { nodeId, projectId, issueNumber, issueUrl, issueTitle } = body as {
    nodeId: string;
    projectId: string;
    issueNumber: number;
    issueUrl: string;
    issueTitle: string;
  };

  if (!nodeId || !projectId || !issueNumber || !issueUrl) {
    return c.json({ error: 'nodeId, projectId, issueNumber, and issueUrl are required' }, 400);
  }

  // Look up project (team-scoped)
  const [project] = await db.select()
    .from(projects)
    .where(and(
      eq(projects.id, projectId),
      inArray(projects.teamId, user.teamIds)
    ))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  // Look up node
  const [node] = await db.select()
    .from(planNodes)
    .where(and(
      eq(planNodes.id, nodeId),
      eq(planNodes.projectId, projectId)
    ))
    .limit(1);

  if (!node) {
    return c.json({ error: 'Task node not found' }, 404);
  }

  // Build link entry
  const linkEntry = {
    id: `gh-${issueNumber}`,
    type: 'github_issue',
    url: issueUrl,
    title: issueTitle || `Issue #${issueNumber}`,
    state: 'open',
    number: issueNumber,
  };

  // Merge into existing links
  const existingLinks = (node.links ?? []) as Array<{ id: string; type: string; url: string; title: string; state?: string; number?: number; targetId?: string }>;
  const mergedLinks = [
    ...existingLinks.filter((l) => l.id !== linkEntry.id),
    linkEntry,
  ];

  await db.update(planNodes).set({
    githubIssueNumber: issueNumber,
    githubIssueUrl: issueUrl,
    links: mergedLinks,
    githubSyncedAt: new Date(),
    githubSyncVersion: (node.githubSyncVersion ?? 0) + 1,
    syncSource: 'user',
    updatedAt: new Date(),
  }).where(eq(planNodes.id, nodeId));

  return c.json({ success: true });
});

/**
 * POST /api/github/issues/unlink
 * Unlink a GitHub issue from an Astro task node
 */
app.post('/issues/unlink', async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json();
  const { nodeId, projectId } = body as { nodeId: string; projectId: string };

  if (!nodeId || !projectId) {
    return c.json({ error: 'nodeId and projectId are required' }, 400);
  }

  // Look up project (team-scoped)
  const [project] = await db.select({ id: projects.id })
    .from(projects)
    .where(and(
      eq(projects.id, projectId),
      inArray(projects.teamId, user.teamIds)
    ))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  // Look up node
  const [node] = await db.select()
    .from(planNodes)
    .where(and(
      eq(planNodes.id, nodeId),
      eq(planNodes.projectId, projectId)
    ))
    .limit(1);

  if (!node) {
    return c.json({ error: 'Task node not found' }, 404);
  }

  // Remove GitHub issue links from links array
  const existingLinks = (node.links ?? []) as Array<{ id: string; type: string; url: string; title: string; state?: string; number?: number; targetId?: string }>;
  const filteredLinks = existingLinks.filter(
    (l) => !(l.type === 'github_issue' && l.id === `gh-${node.githubIssueNumber}`)
  );

  await db.update(planNodes).set({
    githubIssueNumber: null,
    githubIssueUrl: null,
    links: filteredLinks,
    githubSyncedAt: new Date(),
    githubSyncVersion: (node.githubSyncVersion ?? 0) + 1,
    syncSource: 'user',
    updatedAt: new Date(),
  }).where(eq(planNodes.id, nodeId));

  return c.json({ success: true });
});

/**
 * GET /api/github/issues/search
 * Search issues in the linked GitHub repo for a project
 */
app.get('/issues/search', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.query('projectId');
  const query = c.req.query('q') || '';

  if (!projectId) {
    return c.json({ error: 'projectId query param is required' }, 400);
  }

  // Look up project
  const [project] = await db.select()
    .from(projects)
    .where(and(
      eq(projects.id, projectId),
      inArray(projects.teamId, user.teamIds)
    ))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (project.projectType !== 'github' || !project.githubOwner || !project.githubRepo) {
    return c.json({ error: 'Project is not a GitHub-linked project' }, 400);
  }

  // Resolve token
  const tokenResult = await resolveGitHubToken(
    project.githubOwner,
    project.githubRepo,
    user.id,
    user.teamId ?? null,
  );

  if (!tokenResult) {
    return c.json({ error: 'No GitHub token available for this repository' }, 401);
  }

  try {
    const issues = await githubClient.searchIssues(
      tokenResult.token,
      project.githubOwner,
      project.githubRepo,
      { query, state: 'open', perPage: 20 }
    );
    return c.json({ issues });
  } catch (err) {
    console.error(`[github] Issue search failed:`, err);
    return c.json({ error: 'Failed to search issues' }, 500);
  }
});

// ── Sync Settings Endpoints ─────────────────────────────────────────

/**
 * GET /api/github/projects/:projectId/sync-settings
 * Fetch per-project GitHub sync settings.
 */
app.get('/projects/:projectId/sync-settings', async (c) => {
  const user = c.get('user') as AuthUser;
  const { projectId } = c.req.param();

  const [project] = await db.select({
    githubSyncSettings: projects.githubSyncSettings,
    projectType: projects.projectType,
  }).from(projects).where(and(eq(projects.id, projectId), inArray(projects.teamId, user.teamIds))).limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json({ settings: project.githubSyncSettings ?? null });
});

// ── Save Sync Settings Endpoint ─────────────────────────────────────

/**
 * PUT /api/github/projects/:projectId/sync-settings
 * Save per-project GitHub sync settings.
 *
 * Body: { settings: GitHubSyncSettings }
 */
app.put('/projects/:projectId/sync-settings', async (c) => {
  const { projectId } = c.req.param();
  const body = await c.req.json() as {
    settings: {
      enabled: boolean
      direction: string
      enabledFields: string[]
      autoCreateDirection: string
      labelMapping: Record<string, string>
    }
  };

  if (!body.settings) {
    return c.json({ error: 'settings object is required' }, 400);
  }

  const { settings } = body;

  // Validate direction
  const validDirections = ['github_to_astro', 'astro_to_github', 'bidirectional'];
  if (!validDirections.includes(settings.direction)) {
    return c.json({ error: `Invalid direction: ${settings.direction}` }, 400);
  }

  // Validate autoCreateDirection
  const validAutoCreate = ['astro_to_github', 'github_to_astro', 'bidirectional', 'none'];
  if (!validAutoCreate.includes(settings.autoCreateDirection)) {
    return c.json({ error: `Invalid autoCreateDirection: ${settings.autoCreateDirection}` }, 400);
  }

  // Validate enabledFields
  const validFields = ['title', 'description', 'status', 'priority', 'estimate', 'assignee', 'labels'];
  for (const field of settings.enabledFields) {
    if (!validFields.includes(field)) {
      return c.json({ error: `Invalid field: ${field}` }, 400);
    }
  }

  // Verify the project exists, belongs to the team, and is a GitHub project
  const user = c.get('user') as AuthUser;
  const [project] = await db.select({
    id: projects.id,
    projectType: projects.projectType,
  }).from(projects).where(and(eq(projects.id, projectId), inArray(projects.teamId, user.teamIds))).limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (project.projectType !== 'github') {
    return c.json({ error: 'Project is not a GitHub-linked project' }, 400);
  }

  // Save settings
  await db.update(projects).set({
    githubSyncSettings: settings,
    updatedAt: new Date(),
  }).where(eq(projects.id, projectId));

  return c.json({ success: true });
});

// ── Field Sync Endpoint ──────────────────────────────────────────────

/**
 * POST /api/github/issues/sync-fields
 * Manually trigger Astro→GitHub field sync for a specific plan node.
 *
 * Body: { nodeId: string, changedFields?: string[] }
 *
 * Used when users update fields in the Astro UI (title, status, priority, etc.)
 * and the change needs to be pushed to the linked GitHub issue.
 */
app.post('/issues/sync-fields', async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json() as {
    nodeId: string;
    changedFields?: string[];
  };

  if (!body.nodeId) {
    return c.json({ error: 'nodeId is required' }, 400);
  }

  // Verify the node belongs to a project owned by the user's team
  const [node] = await db.select({
    clientId: planNodes.clientId,
    projectId: planNodes.projectId,
  }).from(planNodes)
    .innerJoin(projects, eq(projects.id, planNodes.projectId))
    .where(and(
      eq(planNodes.clientId, body.nodeId),
      inArray(projects.teamId, user.teamIds),
    )).limit(1);

  if (!node) {
    return c.json({ error: 'Node not found or access denied' }, 404);
  }

  // Dynamic import to avoid circular dependency at module load time
  const { syncNodeToGitHub } = await import('../lib/events/hooks/github-field-sync-hook.js');

  const result = await syncNodeToGitHub(body.nodeId, {
    changedFields: body.changedFields,
  });

  if (result.success) {
    return c.json({ success: true });
  } else {
    return c.json({ error: result.error || 'Sync failed' }, 500);
  }
});

// ── Sync Health Dashboard ─────────────────────────────────────────

/**
 * GET /api/github/sync-health?projectId=X
 * Returns aggregated sync health stats for a project.
 */
app.get('/sync-health', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.query('projectId');
  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400);
  }

  // Verify project belongs to user's team
  const [project] = await db.select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), inArray(projects.teamId, user.teamIds)))
    .limit(1);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    // Total syncs in last 24h with success/error breakdown
    const statsRows = await db
      .select({
        status: githubSyncLog.status,
        total: count(),
      })
      .from(githubSyncLog)
      .where(and(
        eq(githubSyncLog.projectId, projectId),
        gte(githubSyncLog.createdAt, twentyFourHoursAgo)
      ))
      .groupBy(githubSyncLog.status);

    let successCount = 0;
    let errorCount = 0;
    for (const row of statsRows) {
      if (row.status === 'success') successCount = Number(row.total);
      if (row.status === 'error') errorCount = Number(row.total);
    }

    // Last successful sync
    const [lastSuccess] = await db
      .select({ createdAt: githubSyncLog.createdAt })
      .from(githubSyncLog)
      .where(and(
        eq(githubSyncLog.projectId, projectId),
        eq(githubSyncLog.status, 'success')
      ))
      .orderBy(desc(githubSyncLog.createdAt))
      .limit(1);

    // Recent errors (last 10)
    const recentErrors = await db
      .select({
        id: githubSyncLog.id,
        nodeId: githubSyncLog.nodeId,
        direction: githubSyncLog.direction,
        action: githubSyncLog.action,
        errorMessage: githubSyncLog.errorMessage,
        metadata: githubSyncLog.metadata,
        createdAt: githubSyncLog.createdAt,
      })
      .from(githubSyncLog)
      .where(and(
        eq(githubSyncLog.projectId, projectId),
        eq(githubSyncLog.status, 'error')
      ))
      .orderBy(desc(githubSyncLog.createdAt))
      .limit(10);

    // Compute health status
    const totalRecent = successCount + errorCount;
    let health: 'healthy' | 'degraded' | 'failing' | 'unknown' = 'unknown';
    if (totalRecent === 0) {
      health = 'unknown';
    } else if (errorCount === 0) {
      health = 'healthy';
    } else if (errorCount < totalRecent) {
      health = 'degraded';
    } else {
      health = 'failing';
    }

    return c.json({
      health,
      lastSuccessAt: lastSuccess?.createdAt?.toISOString() ?? null,
      stats24h: {
        total: totalRecent,
        success: successCount,
        errors: errorCount,
      },
      recentErrors,
    });
  } catch (err) {
    console.error('[github-sync] sync-health query failed:', err);
    return c.json({ error: 'Failed to fetch sync health' }, 500);
  }
});

export default app;
