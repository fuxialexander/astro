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
import { commentsApp, reviewCommentsApp, commentsStreamApp } from './github-comments.js';
import { requireAuth, type AuthUser } from '../middleware/auth.js';
import { githubStore } from '../lib/github-store.js';
import { sanitizeGitHubName } from '@astro/core/prompt-templates';

const app = new Hono();

app.route('/', authApp);
app.route('/', syncApp);
app.route('/', prApp);
app.route('/comments', commentsApp);
app.route('/review-comments', reviewCommentsApp);
app.route('/comments-stream', commentsStreamApp);

// Apply auth middleware to all PR action routes defined below
app.use('/pr/*', requireAuth);

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
  const owner = sanitizeGitHubName(c.req.param('owner'));
  const repo = sanitizeGitHubName(c.req.param('repo'));
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
      console.error('[github] API error:', errorBody);
      return c.json({
        success: false,
        error: `GitHub API error: ${response.status}`,
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
  const owner = sanitizeGitHubName(c.req.param('owner'));
  const repo = sanitizeGitHubName(c.req.param('repo'));
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
      console.error('[github] PR details fetch error:', errorBody);
      return c.json({
        success: false,
        error: `Failed to fetch PR details: ${prResponse.status}`,
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
      console.error('[github] Merge error:', errorBody);
      return c.json({
        success: false,
        error: `GitHub merge error: ${mergeResponse.status}`,
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
  const owner = sanitizeGitHubName(c.req.param('owner'));
  const repo = sanitizeGitHubName(c.req.param('repo'));
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
      console.error('[github] API error:', errorBody);
      return c.json({
        success: false,
        error: `GitHub API error: ${response.status}`,
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
 * PUT /api/github/pr/:owner/:repo/:prNumber/ready
 * Mark a draft PR as ready for review using the GitHub GraphQL API.
 *
 * Uses the user's OAuth token.
 */
app.put('/pr/:owner/:repo/:prNumber/ready', async (c) => {
  const userId = (c.get('user') as AuthUser).id;
  const owner = sanitizeGitHubName(c.req.param('owner'));
  const repo = sanitizeGitHubName(c.req.param('repo'));
  const prNumber = parseInt(c.req.param('prNumber'), 10);

  if (!owner || !repo || !prNumber || isNaN(prNumber) || prNumber <= 0) {
    return c.json({ success: false, error: 'Invalid owner, repo, or prNumber' }, 400);
  }

  const tokenResult = await resolveUserToken(userId);
  if (!tokenResult.token) {
    return c.json({ success: false, error: tokenResult.error }, 401);
  }

  try {
    // First, get the PR's node_id (needed for GraphQL)
    const prResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
      { headers: githubApiHeaders(tokenResult.token) }
    );

    if (!prResponse.ok) {
      return c.json({ success: false, error: `Failed to fetch PR: ${prResponse.status}` });
    }

    const prData = await prResponse.json();

    if (!prData.draft) {
      return c.json({ success: false, error: 'PR is not a draft' }, 409);
    }

    // Use GraphQL to mark as ready (REST API doesn't support this)
    const graphqlResponse = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: githubApiHeaders(tokenResult.token),
      body: JSON.stringify({
        query: `mutation($pullRequestId: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
            pullRequest { id isDraft }
          }
        }`,
        variables: { pullRequestId: prData.node_id },
      }),
    });

    if (!graphqlResponse.ok) {
      const errorBody = await graphqlResponse.text();
      console.error('[github] GraphQL error:', errorBody);
      return c.json({ success: false, error: `GitHub GraphQL error: ${graphqlResponse.status}` });
    }

    const graphqlData = await graphqlResponse.json();
    if (graphqlData.errors?.length) {
      const errMsg = graphqlData.errors[0].message || 'GraphQL error';
      return c.json({ success: false, error: errMsg });
    }

    return c.json({ success: true, error: null });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[github] mark-ready error:', msg);
    return c.json({ success: false, error: msg }, 500);
  }
});

export default app;
