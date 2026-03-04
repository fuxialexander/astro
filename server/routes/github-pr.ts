/**
 * GitHub PR and branch management routes.
 * Phase 2 endpoints will be added here.
 */

import { Hono } from 'hono';
import { githubStore } from '../lib/github-store';
import { requireAuth, type AuthUser } from '../middleware/auth.js';

const app = new Hono();

app.use('/*', requireAuth);

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
