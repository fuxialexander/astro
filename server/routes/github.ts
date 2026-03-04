/**
 * GitHub routes — composed from focused sub-modules.
 * All endpoints remain at /api/github/* with identical behavior.
 *
 * Sub-modules:
 *   github-auth.ts  — OAuth connect/disconnect/callback, status check
 *   github-sync.ts  — Repo sync, project linking/unlinking, issue sync
 *   github-pr.ts    — PR and branch management
 */

import { Hono } from 'hono';
import authApp from './github-auth.js';
import syncApp from './github-sync.js';
import prApp from './github-pr.js';

const app = new Hono();

app.route('/', authApp);
app.route('/', syncApp);
app.route('/', prApp);

// ── PR action endpoints (review, merge, comment) ─────────────────────

/**
 * Helper: Build GitHub API headers from an access token.
 */
function githubApiHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
}

/**
 * Helper: Resolve a GitHub token for the current user.
 * Returns the user's OAuth token or null if not connected.
 */
async function resolveUserToken(userId: string): Promise<{ token: string } | { token: null; error: string }> {
  const connection = await githubStore.getConnection(userId);
  if (!connection) {
    return { token: null, error: 'GitHub account not connected. Connect your GitHub account in Settings to perform this action.' };
  }
  return { token: connection.accessToken };
}

/**
 * Helper: Resolve a token for merge operations.
 * Prefers GITHUB_TOKEN env var (bot/installation token with higher perms),
 * falls back to user's OAuth token.
 */
async function resolveMergeToken(userId: string): Promise<{ token: string; isBot: boolean } | { token: null; error: string }> {
  // Prefer GITHUB_TOKEN (installation token / CI token) for merge operations
  if (process.env.GITHUB_TOKEN) {
    return { token: process.env.GITHUB_TOKEN, isBot: true };
  }
  const connection = await githubStore.getConnection(userId);
  if (!connection) {
    return { token: null, error: 'GitHub account not connected. Connect your GitHub account in Settings to perform this action.' };
  }
  return { token: connection.accessToken, isBot: false };
}

/**
 * POST /api/github/pr/:owner/:repo/:prNumber/review
 * Submit a PR review (approve, request_changes, comment)
 *
 * Uses the user's OAuth token so the review is posted as the user.
 */
app.post('/pr/:owner/:repo/:prNumber/review', async (c) => {
  const userId = (c.get('user') as AuthUser).id;
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const prNumber = parseInt(c.req.param('prNumber'), 10);

  if (!owner || !repo || !prNumber || isNaN(prNumber) || prNumber <= 0) {
    return c.json({ success: false, error: 'Invalid owner, repo, or prNumber' }, 400);
  }

  const body = await c.req.json();
  const { event, body: reviewBody } = body as {
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
    body?: string;
  };

  // Validate review event type
  const validEvents = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];
  if (!event || !validEvents.includes(event)) {
    return c.json({ success: false, error: `event must be one of: ${validEvents.join(', ')}` }, 400);
  }

  // REQUEST_CHANGES requires a body
  if (event === 'REQUEST_CHANGES' && (!reviewBody || !reviewBody.trim())) {
    return c.json({ success: false, error: 'A review body is required when requesting changes' }, 400);
  }

  // Use user's OAuth token for reviews (posted as the user)
  const tokenResult = await resolveUserToken(userId);
  if (!tokenResult.token) {
    return c.json({ success: false, error: tokenResult.error }, 401);
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      {
        method: 'POST',
        headers: githubApiHeaders(tokenResult.token),
        body: JSON.stringify({
          event,
          body: reviewBody || '',
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return c.json({
        success: false,
        error: `GitHub API error ${response.status}: ${errorBody}`,
      });
    }

    const data = await response.json();
    return c.json({
      success: true,
      error: null,
      review: {
        id: data.id,
        state: data.state,
        htmlUrl: data.html_url,
        submittedAt: data.submitted_at,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[github] pr-review error:', msg);
    return c.json({ success: false, error: msg }, 500);
  }
});

/**
 * POST /api/github/pr/:owner/:repo/:prNumber/merge
 * Merge a PR via GitHub API
 *
 * Uses GITHUB_TOKEN (installation token with higher permissions) if available,
 * falls back to user's OAuth token.
 * Supports squash, merge, and rebase methods.
 */
app.post('/pr/:owner/:repo/:prNumber/merge', async (c) => {
  const userId = (c.get('user') as AuthUser).id;
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const prNumber = parseInt(c.req.param('prNumber'), 10);

  if (!owner || !repo || !prNumber || isNaN(prNumber) || prNumber <= 0) {
    return c.json({ success: false, error: 'Invalid owner, repo, or prNumber' }, 400);
  }

  const body = await c.req.json();
  const { mergeMethod, commitTitle, commitMessage } = body as {
    mergeMethod?: 'squash' | 'merge' | 'rebase';
    commitTitle?: string;
    commitMessage?: string;
  };

  // Validate merge method
  const method = mergeMethod || 'squash';
  const validMethods = ['squash', 'merge', 'rebase'];
  if (!validMethods.includes(method)) {
    return c.json({ success: false, error: `mergeMethod must be one of: ${validMethods.join(', ')}` }, 400);
  }

  // Use installation token for merge (higher permissions)
  const tokenResult = await resolveMergeToken(userId);
  if (!tokenResult.token) {
    return c.json({ success: false, error: tokenResult.error }, 401);
  }

  try {
    // First check if PR is mergeable
    const prResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
      { headers: githubApiHeaders(tokenResult.token) }
    );

    if (!prResponse.ok) {
      const errorBody = await prResponse.text();
      return c.json({
        success: false,
        error: `Failed to fetch PR details: ${errorBody}`,
      });
    }

    const prData = await prResponse.json();

    // Check PR state
    if (prData.state !== 'open') {
      return c.json({
        success: false,
        error: `PR is ${prData.state}, cannot merge`,
      }, 409);
    }

    if (prData.mergeable === false) {
      return c.json({
        success: false,
        error: 'PR has merge conflicts and cannot be merged',
      }, 409);
    }

    // Perform the merge
    const mergeBody: Record<string, string> = {
      merge_method: method,
    };
    if (commitTitle) mergeBody.commit_title = commitTitle;
    if (commitMessage) mergeBody.commit_message = commitMessage;

    const mergeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
      {
        method: 'PUT',
        headers: githubApiHeaders(tokenResult.token),
        body: JSON.stringify(mergeBody),
      }
    );

    if (!mergeResponse.ok) {
      const errorBody = await mergeResponse.text();
      return c.json({
        success: false,
        error: `GitHub merge error ${mergeResponse.status}: ${errorBody}`,
      });
    }

    const mergeData = await mergeResponse.json();
    return c.json({
      success: true,
      error: null,
      merge: {
        sha: mergeData.sha,
        message: mergeData.message,
        merged: mergeData.merged,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[github] pr-merge error:', msg);
    return c.json({ success: false, error: msg }, 500);
  }
});

/**
 * POST /api/github/pr/:owner/:repo/:prNumber/comment
 * Post a general comment on a PR
 *
 * Uses the user's OAuth token so the comment is posted as the user.
 */
app.post('/pr/:owner/:repo/:prNumber/comment', async (c) => {
  const userId = (c.get('user') as AuthUser).id;
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const prNumber = parseInt(c.req.param('prNumber'), 10);

  if (!owner || !repo || !prNumber || isNaN(prNumber) || prNumber <= 0) {
    return c.json({ success: false, error: 'Invalid owner, repo, or prNumber' }, 400);
  }

  const body = await c.req.json();
  const { body: commentBody } = body as { body: string };

  if (!commentBody || typeof commentBody !== 'string' || !commentBody.trim()) {
    return c.json({ success: false, error: 'Comment body is required' }, 400);
  }

  // Use user's OAuth token for comments (posted as the user)
  const tokenResult = await resolveUserToken(userId);
  if (!tokenResult.token) {
    return c.json({ success: false, error: tokenResult.error }, 401);
  }

  try {
    // PR comments use the issues API (GitHub treats PRs as issues for comments)
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: githubApiHeaders(tokenResult.token),
        body: JSON.stringify({ body: commentBody.trim() }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return c.json({
        success: false,
        error: `GitHub API error ${response.status}: ${errorBody}`,
      });
    }

    const data = await response.json();
    return c.json({
      success: true,
      error: null,
      comment: {
        id: data.id,
        htmlUrl: data.html_url,
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[github] pr-comment error:', msg);
    return c.json({ success: false, error: msg }, 500);
  }
});

/**
 * GET /api/github/pr/:owner/:repo/:prNumber
 * Fetch PR details including status, checks, and review state
 */
app.get('/pr/:owner/:repo/:prNumber', async (c) => {
  const userId = (c.get('user') as AuthUser).id;
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const prNumber = parseInt(c.req.param('prNumber'), 10);

  if (!owner || !repo || !prNumber || isNaN(prNumber) || prNumber <= 0) {
    return c.json({ error: 'Invalid owner, repo, or prNumber' }, 400);
  }

  const tokenResult = await resolveUserToken(userId);
  if (!tokenResult.token) {
    return c.json({ error: tokenResult.error }, 401);
  }

  try {
    const headers = githubApiHeaders(tokenResult.token);

    // Fetch PR details, reviews, and check runs in parallel
    const [prResponse, reviewsResponse, checksResponse] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(`refs/pull/${prNumber}/head`)}/check-runs`, { headers }),
    ]);

    if (!prResponse.ok) {
      const errorBody = await prResponse.text();
      return c.json({ error: `Failed to fetch PR: ${errorBody}` }, prResponse.status as 404 | 500);
    }

    const prData = await prResponse.json();

    // Parse reviews
    let reviews: Array<{ id: number; user: string; state: string; submittedAt: string }> = [];
    if (reviewsResponse.ok) {
      const reviewsData = await reviewsResponse.json();
      reviews = reviewsData.map((r: Record<string, unknown>) => ({
        id: r.id as number,
        user: (r.user as Record<string, unknown>)?.login as string || 'unknown',
        state: r.state as string,
        submittedAt: r.submitted_at as string,
      }));
    }

    // Parse check runs
    let checks: Array<{ id: number; name: string; status: string; conclusion: string | null }> = [];
    if (checksResponse.ok) {
      const checksData = await checksResponse.json();
      checks = (checksData.check_runs || []).map((cr: Record<string, unknown>) => ({
        id: cr.id as number,
        name: cr.name as string,
        status: cr.status as string,
        conclusion: (cr.conclusion as string | null) ?? null,
      }));
    }

    return c.json({
      pr: {
        number: prData.number,
        title: prData.title,
        state: prData.state,
        merged: prData.merged,
        mergeable: prData.mergeable,
        mergeableState: prData.mergeable_state,
        draft: prData.draft,
        additions: prData.additions,
        deletions: prData.deletions,
        changedFiles: prData.changed_files,
        headBranch: prData.head?.ref,
        baseBranch: prData.base?.ref,
        htmlUrl: prData.html_url,
        user: prData.user?.login,
        createdAt: prData.created_at,
        updatedAt: prData.updated_at,
      },
      reviews,
      checks,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[github] pr-details error:', msg);
    return c.json({ error: msg }, 500);
  }
});

export default app;
