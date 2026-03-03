/**
 * GitHub Comments & PR Review API Client
 *
 * Frontend client for interacting with GitHub issue/PR comments
 * and PR review threads via the Astro backend proxy.
 */

import { apiUrl } from './api-url'
import { getAccessToken } from './supabase-client'

// ─── Types ──────────────────────────────────────────────────────────

export interface GitHubCommentUser {
  login: string
  avatarUrl: string
  id: number
}

export interface GitHubComment {
  id: number
  body: string
  createdAt: string
  updatedAt: string
  htmlUrl: string
  user: GitHubCommentUser | null
}

export interface PrReviewComment extends GitHubComment {
  inReplyToId: number | null
}

export interface PrReviewThread {
  id: number
  path: string
  line: number | null
  side: string
  startLine: number | null
  diffHunk: string
  comments: PrReviewComment[]
}

// ─── Helpers ────────────────────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = await getAccessToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

// ─── API Functions ──────────────────────────────────────────────────

/**
 * Fetch all issue/PR comments for a given issue or pull request.
 */
export async function fetchGitHubComments(
  owner: string,
  repo: string,
  number: number
): Promise<GitHubComment[]> {
  const headers = await authHeaders()
  const response = await fetch(
    apiUrl(`/api/github/comments/${owner}/${repo}/${number}`),
    { headers }
  )

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error((data as Record<string, string>).error || `Failed to fetch comments: ${response.status}`)
  }

  const data = await response.json() as { comments: GitHubComment[] }
  return data.comments
}

/**
 * Post a new comment on a GitHub issue or pull request.
 * Uses the current user's OAuth token so comments appear as themselves.
 */
export async function postGitHubComment(
  owner: string,
  repo: string,
  number: number,
  body: string
): Promise<GitHubComment> {
  const headers = await authHeaders()
  const response = await fetch(
    apiUrl(`/api/github/comments/${owner}/${repo}/${number}`),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ body }),
    }
  )

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error((data as Record<string, string>).error || `Failed to post comment: ${response.status}`)
  }

  const data = await response.json() as { comment: GitHubComment }
  return data.comment
}

/**
 * Fetch PR review comment threads grouped by file path.
 */
export async function fetchPrReviewThreads(
  owner: string,
  repo: string,
  number: number
): Promise<PrReviewThread[]> {
  const headers = await authHeaders()
  const response = await fetch(
    apiUrl(`/api/github/pr-reviews/${owner}/${repo}/${number}`),
    { headers }
  )

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error((data as Record<string, string>).error || `Failed to fetch PR reviews: ${response.status}`)
  }

  const data = await response.json() as { threads: PrReviewThread[] }
  return data.threads
}

/**
 * Reply to a specific PR review comment thread.
 */
export async function replyToPrReviewThread(
  owner: string,
  repo: string,
  number: number,
  inReplyTo: number,
  body: string
): Promise<PrReviewComment> {
  const headers = await authHeaders()
  const response = await fetch(
    apiUrl(`/api/github/pr-reviews/${owner}/${repo}/${number}/reply`),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ body, inReplyTo }),
    }
  )

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error((data as Record<string, string>).error || `Failed to reply to review: ${response.status}`)
  }

  const data = await response.json() as { comment: PrReviewComment }
  return data.comment
}
