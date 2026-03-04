/**
 * GitHub Comments API Routes
 *
 * Proxy endpoints for fetching and posting comments on GitHub issues/PRs,
 * plus PR review comment threads. Also provides an SSE stream for real-time
 * comment updates via the githubCommentBus.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { githubStore } from '../lib/github-store.js'
import { githubCommentBus, type GitHubCommentEvent } from '../lib/github-comment-bus.js'
import { githubPrBus, type GitHubPrEvent } from '../lib/github-pr-bus.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { sanitizeGitHubName } from '@astro/core/prompt-templates'
import { fetchWithRateLimit } from '../lib/github-rate-limit.js'

const GITHUB_API = 'https://api.github.com'

/**
 * Build GitHub API headers from user's stored access token.
 */
async function getGitHubHeaders(userId: string): Promise<{ headers: Record<string, string> } | { error: string }> {
  const connection = await githubStore.getConnection(userId)
  if (!connection) {
    return { error: 'GitHub not connected' }
  }
  return {
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
  }
}

// ── Issue/PR Comments ──────────────────────────────────────────────────

const commentsApp = new Hono()
commentsApp.use('/*', requireAuth)

/**
 * GET /api/github/comments/:owner/:repo/:number
 * Fetch issue/PR comments from GitHub API.
 */
commentsApp.get('/:owner/:repo/:number', async (c) => {
  const userId = (c.get('user') as AuthUser).id
  const owner = sanitizeGitHubName(c.req.param('owner'))
  const repo = sanitizeGitHubName(c.req.param('repo'))
  const number = parseInt(c.req.param('number'), 10)

  if (!owner || !repo || isNaN(number) || number <= 0) {
    return c.json({ error: 'Invalid owner, repo, or number' }, 400)
  }

  const result = await getGitHubHeaders(userId)
  if ('error' in result) {
    return c.json({ error: result.error }, 401)
  }

  try {
    const page = parseInt(c.req.query('page') || '1', 10)
    const perPage = Math.min(parseInt(c.req.query('per_page') || '100', 10), 100)

    const response = await fetchWithRateLimit(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/${number}/comments?per_page=${perPage}&page=${page}`,
      { headers: result.headers }
    )

    if (!response.ok) {
      const errorText = await response.text()
      return c.json({ error: `GitHub API error ${response.status}: ${errorText}` }, response.status as 400)
    }

    const comments = await response.json()

    // Parse Link header for pagination info
    const linkHeader = response.headers.get('Link')
    const hasNextPage = linkHeader?.includes('rel="next"') ?? false

    return c.json({ comments, hasNextPage, page })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[github-comments] Error fetching comments:`, msg)
    return c.json({ error: `Failed to fetch comments: ${msg}` }, 500)
  }
})

/**
 * POST /api/github/comments/:owner/:repo/:number
 * Post a new comment on an issue/PR.
 */
commentsApp.post('/:owner/:repo/:number', async (c) => {
  const userId = (c.get('user') as AuthUser).id
  const owner = sanitizeGitHubName(c.req.param('owner'))
  const repo = sanitizeGitHubName(c.req.param('repo'))
  const number = parseInt(c.req.param('number'), 10)

  if (!owner || !repo || isNaN(number) || number <= 0) {
    return c.json({ error: 'Invalid owner, repo, or number' }, 400)
  }

  const body = await c.req.json()
  const { body: commentBody } = body as { body: string }

  if (!commentBody || typeof commentBody !== 'string' || !commentBody.trim()) {
    return c.json({ error: 'Comment body is required' }, 400)
  }

  const result = await getGitHubHeaders(userId)
  if ('error' in result) {
    return c.json({ error: result.error }, 401)
  }

  try {
    const response = await fetchWithRateLimit(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/${number}/comments`,
      {
        method: 'POST',
        headers: result.headers,
        body: JSON.stringify({ body: commentBody.trim() }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      return c.json({ error: `GitHub API error ${response.status}: ${errorText}` }, response.status as 400)
    }

    const comment = await response.json()
    return c.json({ comment })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[github-comments] Error posting comment:`, msg)
    return c.json({ error: `Failed to post comment: ${msg}` }, 500)
  }
})

/**
 * PATCH /api/github/comments/:owner/:repo/:commentId
 * Edit an existing issue/PR comment.
 */
commentsApp.patch('/:owner/:repo/:commentId', async (c) => {
  const userId = (c.get('user') as AuthUser).id
  const owner = sanitizeGitHubName(c.req.param('owner'))
  const repo = sanitizeGitHubName(c.req.param('repo'))
  const commentId = parseInt(c.req.param('commentId'), 10)

  if (!owner || !repo || isNaN(commentId) || commentId <= 0) {
    return c.json({ error: 'Invalid owner, repo, or commentId' }, 400)
  }

  const body = await c.req.json()
  const { body: commentBody } = body as { body: string }

  if (!commentBody || typeof commentBody !== 'string' || !commentBody.trim()) {
    return c.json({ error: 'Comment body is required' }, 400)
  }

  const result = await getGitHubHeaders(userId)
  if ('error' in result) {
    return c.json({ error: result.error }, 401)
  }

  try {
    const response = await fetchWithRateLimit(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${commentId}`,
      {
        method: 'PATCH',
        headers: result.headers,
        body: JSON.stringify({ body: commentBody.trim() }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      return c.json({ error: `GitHub API error ${response.status}: ${errorText}` }, response.status as 400)
    }

    const comment = await response.json()
    return c.json({ comment })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[github-comments] Error editing comment:`, msg)
    return c.json({ error: `Failed to edit comment: ${msg}` }, 500)
  }
})

/**
 * DELETE /api/github/comments/:owner/:repo/:commentId
 * Delete an issue/PR comment.
 */
commentsApp.delete('/:owner/:repo/:commentId', async (c) => {
  const userId = (c.get('user') as AuthUser).id
  const owner = sanitizeGitHubName(c.req.param('owner'))
  const repo = sanitizeGitHubName(c.req.param('repo'))
  const commentId = parseInt(c.req.param('commentId'), 10)

  if (!owner || !repo || isNaN(commentId) || commentId <= 0) {
    return c.json({ error: 'Invalid owner, repo, or commentId' }, 400)
  }

  const result = await getGitHubHeaders(userId)
  if ('error' in result) {
    return c.json({ error: result.error }, 401)
  }

  try {
    const response = await fetchWithRateLimit(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${commentId}`,
      {
        method: 'DELETE',
        headers: result.headers,
      }
    )

    if (!response.ok && response.status !== 204) {
      const errorText = await response.text()
      return c.json({ error: `GitHub API error ${response.status}: ${errorText}` }, response.status as 400)
    }

    return c.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[github-comments] Error deleting comment:`, msg)
    return c.json({ error: `Failed to delete comment: ${msg}` }, 500)
  }
})

// ── PR Review Comments ─────────────────────────────────────────────────

const reviewCommentsApp = new Hono()
reviewCommentsApp.use('/*', requireAuth)

/**
 * GET /api/github/review-comments/:owner/:repo/:number
 * Fetch PR review comments (inline code comments).
 */
reviewCommentsApp.get('/:owner/:repo/:number', async (c) => {
  const userId = (c.get('user') as AuthUser).id
  const owner = sanitizeGitHubName(c.req.param('owner'))
  const repo = sanitizeGitHubName(c.req.param('repo'))
  const number = parseInt(c.req.param('number'), 10)

  if (!owner || !repo || isNaN(number) || number <= 0) {
    return c.json({ error: 'Invalid owner, repo, or number' }, 400)
  }

  const result = await getGitHubHeaders(userId)
  if ('error' in result) {
    return c.json({ error: result.error }, 401)
  }

  try {
    const page = parseInt(c.req.query('page') || '1', 10)
    const perPage = Math.min(parseInt(c.req.query('per_page') || '100', 10), 100)

    const response = await fetchWithRateLimit(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}/comments?per_page=${perPage}&page=${page}`,
      { headers: result.headers }
    )

    if (!response.ok) {
      const errorText = await response.text()
      return c.json({ error: `GitHub API error ${response.status}: ${errorText}` }, response.status as 400)
    }

    const comments = await response.json()
    const linkHeader = response.headers.get('Link')
    const hasNextPage = linkHeader?.includes('rel="next"') ?? false

    return c.json({ comments, hasNextPage, page })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[github-comments] Error fetching review comments:`, msg)
    return c.json({ error: `Failed to fetch review comments: ${msg}` }, 500)
  }
})

/**
 * POST /api/github/review-comments/:owner/:repo/:number
 * Reply to a review comment thread.
 */
reviewCommentsApp.post('/:owner/:repo/:number', async (c) => {
  const userId = (c.get('user') as AuthUser).id
  const owner = sanitizeGitHubName(c.req.param('owner'))
  const repo = sanitizeGitHubName(c.req.param('repo'))
  const number = parseInt(c.req.param('number'), 10)

  if (!owner || !repo || isNaN(number) || number <= 0) {
    return c.json({ error: 'Invalid owner, repo, or number' }, 400)
  }

  const body = await c.req.json()
  const { body: commentBody, in_reply_to: inReplyTo } = body as { body: string; in_reply_to: number }

  if (!commentBody || typeof commentBody !== 'string' || !commentBody.trim()) {
    return c.json({ error: 'Comment body is required' }, 400)
  }

  if (!inReplyTo || typeof inReplyTo !== 'number') {
    return c.json({ error: 'in_reply_to comment ID is required' }, 400)
  }

  const result = await getGitHubHeaders(userId)
  if ('error' in result) {
    return c.json({ error: result.error }, 401)
  }

  try {
    const response = await fetchWithRateLimit(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}/comments/${inReplyTo}/replies`,
      {
        method: 'POST',
        headers: result.headers,
        body: JSON.stringify({ body: commentBody.trim() }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      return c.json({ error: `GitHub API error ${response.status}: ${errorText}` }, response.status as 400)
    }

    const comment = await response.json()
    return c.json({ comment })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[github-comments] Error posting review reply:`, msg)
    return c.json({ error: `Failed to post review reply: ${msg}` }, 500)
  }
})

// ── SSE Comment Stream ─────────────────────────────────────────────────

const commentsStreamApp = new Hono()
commentsStreamApp.use('/*', requireAuth)

/**
 * GET /api/github/comments-stream/:owner/:repo/:number
 * SSE stream for real-time comment updates.
 */
commentsStreamApp.get('/:owner/:repo/:number', async (c) => {
  const userId = (c.get('user') as AuthUser).id
  const owner = sanitizeGitHubName(c.req.param('owner'))
  const repo = sanitizeGitHubName(c.req.param('repo'))
  const number = parseInt(c.req.param('number'), 10)

  if (!owner || !repo || isNaN(number) || number <= 0) {
    return c.json({ error: 'Invalid owner, repo, or number' }, 400)
  }

  // Verify the user has GitHub access to this repo before opening the stream
  const headerResult = await getGitHubHeaders(userId)
  if ('error' in headerResult) {
    return c.json({ error: headerResult.error }, 401)
  }

  // Disable proxy buffering so SSE chunks flush immediately
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    let alive = true

    const handler = (event: GitHubCommentEvent) => {
      if (!alive) return
      if (event.owner !== owner || event.repo !== repo || event.number !== number) return

      stream.writeSSE({
        event: 'comment',
        data: JSON.stringify(event.comment),
      }).catch(() => {
        alive = false
      })
    }

    githubCommentBus.onComment(handler)

    // 30s heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      if (!alive) {
        clearInterval(heartbeat)
        return
      }
      stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
        alive = false
        clearInterval(heartbeat)
      })
    }, 30_000)

    stream.onAbort(() => {
      alive = false
      clearInterval(heartbeat)
      githubCommentBus.offComment(handler)
    })

    // Keep the stream open
    while (alive) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    clearInterval(heartbeat)
    githubCommentBus.offComment(handler)
  })
})

// ── SSE PR Status Stream ─────────────────────────────────────────────

const prStreamApp = new Hono()
prStreamApp.use('/*', requireAuth)

/**
 * GET /api/github/pr-stream/:owner/:repo/:prNumber
 * SSE stream for real-time PR state changes (CI status, reviews, merges).
 */
prStreamApp.get('/:owner/:repo/:prNumber', async (c) => {
  const userId = (c.get('user') as AuthUser).id
  const owner = sanitizeGitHubName(c.req.param('owner'))
  const repo = sanitizeGitHubName(c.req.param('repo'))
  const prNumber = parseInt(c.req.param('prNumber'), 10)

  if (!owner || !repo || isNaN(prNumber) || prNumber <= 0) {
    return c.json({ error: 'Invalid owner, repo, or prNumber' }, 400)
  }

  // Verify the user has GitHub access
  const headerResult = await getGitHubHeaders(userId)
  if ('error' in headerResult) {
    return c.json({ error: headerResult.error }, 401)
  }

  // Disable proxy buffering so SSE chunks flush immediately
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    let alive = true

    const handler = (event: GitHubPrEvent) => {
      if (!alive) return
      if (event.owner !== owner || event.repo !== repo || event.prNumber !== prNumber) return

      stream.writeSSE({
        event: 'pr_change',
        data: JSON.stringify({ changeType: event.changeType, ...event.data }),
      }).catch(() => {
        alive = false
      })
    }

    githubPrBus.onPrChange(handler)

    // 30s heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      if (!alive) {
        clearInterval(heartbeat)
        return
      }
      stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
        alive = false
        clearInterval(heartbeat)
      })
    }, 30_000)

    stream.onAbort(() => {
      alive = false
      clearInterval(heartbeat)
      githubPrBus.offPrChange(handler)
    })

    // Keep the stream open
    while (alive) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    clearInterval(heartbeat)
    githubPrBus.offPrChange(handler)
  })
})

export { commentsApp, reviewCommentsApp, commentsStreamApp, prStreamApp }
