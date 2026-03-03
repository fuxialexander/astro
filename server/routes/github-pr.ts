/**
 * GitHub PR Data API Routes
 *
 * Fetch PR details, CI check statuses, and review decisions from GitHub.
 * These endpoints proxy requests through the user's stored GitHub access token.
 */

import { Hono } from 'hono'
import { githubStore } from '../lib/github-store'
import { requireAuth, type AuthUser } from '../middleware/auth.js'

const GITHUB_API = 'https://api.github.com'

const app = new Hono()

// Require auth on all routes
app.use('/*', requireAuth)

/**
 * Helper: Build GitHub API headers from user's stored access token.
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
    },
  }
}

// ── Types ──────────────────────────────────────────────────────────────

export interface GitHubPrDetails {
  number: number
  title: string
  body: string | null
  state: string
  branch: string
  baseBranch: string
  htmlUrl: string
  merged: boolean
  mergeable: boolean | null
  mergedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  user: { login: string; avatarUrl: string }
  diffStats: { additions: number; deletions: number; changedFiles: number }
  reviewStatus: string
  requestedReviewers: Array<{ login: string; avatarUrl: string }>
  labels: Array<{ name: string; color: string }>
  draft: boolean
}

export interface GitHubCheckRun {
  id: number
  name: string
  status: string // 'queued' | 'in_progress' | 'completed'
  conclusion: string | null // 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required'
  startedAt: string | null
  completedAt: string | null
  htmlUrl: string
  app: { name: string; slug: string } | null
}

export interface GitHubReview {
  id: number
  user: { login: string; avatarUrl: string }
  state: string // 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  body: string | null
  submittedAt: string | null
  htmlUrl: string
}

// ── Endpoints ──────────────────────────────────────────────────────────

/**
 * GET /api/github/pr/:owner/:repo/:prNumber
 * Fetch full PR details including diff stats, merge status, and reviewers.
 */
app.get('/:owner/:repo/:prNumber', async (c) => {
  const userId = (c.get('user') as AuthUser).id
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const prNumber = parseInt(c.req.param('prNumber'), 10)

  if (isNaN(prNumber) || prNumber <= 0) {
    return c.json({ error: 'Invalid PR number' }, 400)
  }

  const result = await getGitHubHeaders(userId)
  if ('error' in result) {
    return c.json({ error: result.error }, 401)
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`,
      { headers: result.headers }
    )

    if (!response.ok) {
      if (response.status === 404) {
        return c.json({ error: `PR #${prNumber} not found in ${owner}/${repo}` }, 404)
      }
      const errorText = await response.text()
      return c.json({ error: `GitHub API error ${response.status}: ${errorText}` }, response.status as 400)
    }

    const pr = await response.json() as Record<string, unknown>
    const head = pr.head as Record<string, unknown>
    const base = pr.base as Record<string, unknown>
    const user = pr.user as Record<string, unknown>
    const requestedReviewers = (pr.requested_reviewers as Array<Record<string, unknown>>) || []
    const labels = (pr.labels as Array<Record<string, unknown>>) || []

    // Derive review status from the PR's merged/draft state and review requests
    let reviewStatus = 'pending'
    if (pr.merged) {
      reviewStatus = 'merged'
    } else if (pr.state === 'closed') {
      reviewStatus = 'closed'
    } else if (pr.draft) {
      reviewStatus = 'draft'
    }

    const details: GitHubPrDetails = {
      number: pr.number as number,
      title: pr.title as string,
      body: (pr.body as string | null) ?? null,
      state: pr.state as string,
      branch: (head?.ref as string) || '',
      baseBranch: (base?.ref as string) || '',
      htmlUrl: pr.html_url as string,
      merged: (pr.merged as boolean) || false,
      mergeable: (pr.mergeable as boolean | null) ?? null,
      mergedAt: (pr.merged_at as string | null) ?? null,
      closedAt: (pr.closed_at as string | null) ?? null,
      createdAt: pr.created_at as string,
      updatedAt: pr.updated_at as string,
      user: {
        login: (user?.login as string) || '',
        avatarUrl: (user?.avatar_url as string) || '',
      },
      diffStats: {
        additions: (pr.additions as number) || 0,
        deletions: (pr.deletions as number) || 0,
        changedFiles: (pr.changed_files as number) || 0,
      },
      reviewStatus,
      requestedReviewers: requestedReviewers.map((r) => ({
        login: (r.login as string) || '',
        avatarUrl: (r.avatar_url as string) || '',
      })),
      labels: labels.map((l) => ({
        name: (l.name as string) || '',
        color: (l.color as string) || '',
      })),
      draft: (pr.draft as boolean) || false,
    }

    return c.json(details)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[github-pr] Error fetching PR #${prNumber}:`, msg)
    return c.json({ error: `Failed to fetch PR: ${msg}` }, 500)
  }
})

/**
 * GET /api/github/pr/:owner/:repo/:prNumber/checks
 * Fetch CI check runs and their statuses for the PR's head commit.
 */
app.get('/:owner/:repo/:prNumber/checks', async (c) => {
  const userId = (c.get('user') as AuthUser).id
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const prNumber = parseInt(c.req.param('prNumber'), 10)

  if (isNaN(prNumber) || prNumber <= 0) {
    return c.json({ error: 'Invalid PR number' }, 400)
  }

  const result = await getGitHubHeaders(userId)
  if ('error' in result) {
    return c.json({ error: result.error }, 401)
  }

  try {
    // First, get the PR to find the head SHA
    const prResponse = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`,
      { headers: result.headers }
    )

    if (!prResponse.ok) {
      if (prResponse.status === 404) {
        return c.json({ error: `PR #${prNumber} not found in ${owner}/${repo}` }, 404)
      }
      const errorText = await prResponse.text()
      return c.json({ error: `GitHub API error ${prResponse.status}: ${errorText}` }, prResponse.status as 400)
    }

    const pr = await prResponse.json() as Record<string, unknown>
    const head = pr.head as Record<string, unknown>
    const headSha = head?.sha as string

    if (!headSha) {
      return c.json({ error: 'Could not determine PR head SHA' }, 500)
    }

    // Fetch check runs for the head SHA
    const checksResponse = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/commits/${headSha}/check-runs`,
      { headers: result.headers }
    )

    if (!checksResponse.ok) {
      const errorText = await checksResponse.text()
      return c.json({ error: `GitHub API error ${checksResponse.status}: ${errorText}` }, checksResponse.status as 400)
    }

    const checksData = await checksResponse.json() as Record<string, unknown>
    const checkRuns = (checksData.check_runs as Array<Record<string, unknown>>) || []

    const checks: GitHubCheckRun[] = checkRuns.map((cr) => {
      const crApp = cr.app as Record<string, unknown> | null
      return {
        id: cr.id as number,
        name: cr.name as string,
        status: cr.status as string,
        conclusion: (cr.conclusion as string | null) ?? null,
        startedAt: (cr.started_at as string | null) ?? null,
        completedAt: (cr.completed_at as string | null) ?? null,
        htmlUrl: (cr.html_url as string) || '',
        app: crApp ? {
          name: (crApp.name as string) || '',
          slug: (crApp.slug as string) || '',
        } : null,
      }
    })

    // Compute overall CI status
    const totalChecks = checks.length
    const completedChecks = checks.filter((c) => c.status === 'completed')
    const failedChecks = completedChecks.filter((c) => c.conclusion === 'failure' || c.conclusion === 'timed_out')
    const successChecks = completedChecks.filter((c) => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral')

    let overallStatus = 'pending'
    if (totalChecks === 0) {
      overallStatus = 'none'
    } else if (failedChecks.length > 0) {
      overallStatus = 'failure'
    } else if (successChecks.length === totalChecks) {
      overallStatus = 'success'
    }

    return c.json({
      headSha,
      totalCount: totalChecks,
      overallStatus,
      checks,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[github-pr] Error fetching checks for PR #${prNumber}:`, msg)
    return c.json({ error: `Failed to fetch checks: ${msg}` }, 500)
  }
})

/**
 * GET /api/github/pr/:owner/:repo/:prNumber/reviews
 * Fetch review decisions for the PR.
 */
app.get('/:owner/:repo/:prNumber/reviews', async (c) => {
  const userId = (c.get('user') as AuthUser).id
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const prNumber = parseInt(c.req.param('prNumber'), 10)

  if (isNaN(prNumber) || prNumber <= 0) {
    return c.json({ error: 'Invalid PR number' }, 400)
  }

  const result = await getGitHubHeaders(userId)
  if ('error' in result) {
    return c.json({ error: result.error }, 401)
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      { headers: result.headers }
    )

    if (!response.ok) {
      if (response.status === 404) {
        return c.json({ error: `PR #${prNumber} not found in ${owner}/${repo}` }, 404)
      }
      const errorText = await response.text()
      return c.json({ error: `GitHub API error ${response.status}: ${errorText}` }, response.status as 400)
    }

    const reviewsData = await response.json() as Array<Record<string, unknown>>

    const reviews: GitHubReview[] = reviewsData.map((r) => {
      const reviewUser = r.user as Record<string, unknown> | null
      return {
        id: r.id as number,
        user: {
          login: (reviewUser?.login as string) || '',
          avatarUrl: (reviewUser?.avatar_url as string) || '',
        },
        state: r.state as string,
        body: (r.body as string | null) ?? null,
        submittedAt: (r.submitted_at as string | null) ?? null,
        htmlUrl: (r.html_url as string) || '',
      }
    })

    // Compute overall review status from the latest review per user
    const latestByUser = new Map<string, string>()
    for (const review of reviews) {
      if (review.state !== 'PENDING' && review.state !== 'COMMENTED') {
        latestByUser.set(review.user.login, review.state)
      }
    }

    let overallReviewStatus = 'pending'
    const reviewStates = Array.from(latestByUser.values())
    if (reviewStates.includes('CHANGES_REQUESTED')) {
      overallReviewStatus = 'changes_requested'
    } else if (reviewStates.length > 0 && reviewStates.every((s) => s === 'APPROVED')) {
      overallReviewStatus = 'approved'
    } else if (reviewStates.length > 0) {
      overallReviewStatus = 'reviewed'
    }

    return c.json({
      reviews,
      overallReviewStatus,
      reviewerCount: latestByUser.size,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[github-pr] Error fetching reviews for PR #${prNumber}:`, msg)
    return c.json({ error: `Failed to fetch reviews: ${msg}` }, 500)
  }
})

export default app
