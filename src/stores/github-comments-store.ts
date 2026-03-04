/**
 * GitHub Comments Store
 *
 * Manages fetching and posting comments on GitHub issues/PRs,
 * plus PR review comment threads. Supports optimistic updates
 * and duplicate detection for webhook echoes.
 */

import { create } from 'zustand'
import type { GitHubComment, GitHubReviewComment, GitHubReviewThread } from '@/types'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'
import { getActiveTeamId } from '@/lib/api-client'

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  const token = await getAccessToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const teamId = getActiveTeamId()
  if (teamId) {
    headers['X-Team-Id'] = teamId
  }
  return headers
}

/** Normalize a raw GitHub API comment to our GitHubComment type */
function normalizeComment(raw: Record<string, unknown>): GitHubComment {
  const user = raw.user as Record<string, unknown> | undefined
  return {
    id: raw.id as number,
    nodeId: (raw.node_id as string) ?? '',
    body: (raw.body as string) ?? '',
    htmlUrl: (raw.html_url as string) ?? '',
    createdAt: (raw.created_at as string) ?? '',
    updatedAt: (raw.updated_at as string) ?? '',
    user: {
      login: (user?.login as string) ?? '',
      avatarUrl: (user?.avatar_url as string) ?? '',
      id: (user?.id as number) ?? 0,
    },
  }
}

/** Normalize a raw GitHub API review comment */
function normalizeReviewComment(raw: Record<string, unknown>): GitHubReviewComment {
  const user = raw.user as Record<string, unknown> | undefined
  return {
    id: raw.id as number,
    nodeId: (raw.node_id as string) ?? '',
    body: (raw.body as string) ?? '',
    htmlUrl: (raw.html_url as string) ?? '',
    path: (raw.path as string) ?? '',
    line: (raw.line as number | null) ?? null,
    originalLine: (raw.original_line as number | null) ?? null,
    side: ((raw.side as string) ?? 'RIGHT') as 'LEFT' | 'RIGHT',
    diffHunk: (raw.diff_hunk as string) ?? '',
    inReplyToId: (raw.in_reply_to_id as number | null) ?? null,
    createdAt: (raw.created_at as string) ?? '',
    updatedAt: (raw.updated_at as string) ?? '',
    user: {
      login: (user?.login as string) ?? '',
      avatarUrl: (user?.avatar_url as string) ?? '',
      id: (user?.id as number) ?? 0,
    },
  }
}

/** Group flat review comments into threads keyed by root comment */
function groupReviewCommentsIntoThreads(comments: GitHubReviewComment[]): GitHubReviewThread[] {
  const rootComments = comments.filter(c => c.inReplyToId === null)
  const replyMap = new Map<number, GitHubReviewComment[]>()

  for (const c of comments) {
    if (c.inReplyToId !== null) {
      const existing = replyMap.get(c.inReplyToId) ?? []
      existing.push(c)
      replyMap.set(c.inReplyToId, existing)
    }
  }

  return rootComments.map(root => {
    // Collect all replies in this thread chain
    const replies: GitHubReviewComment[] = []
    const queue = [root.id]
    while (queue.length > 0) {
      const parentId = queue.shift()!
      const children = replyMap.get(parentId) ?? []
      for (const child of children) {
        replies.push(child)
        queue.push(child.id)
      }
    }

    return {
      rootCommentId: root.id,
      path: root.path,
      line: root.line,
      diffHunk: root.diffHunk,
      comments: [root, ...replies].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    }
  })
}

interface CommentsState {
  // Issue/PR comments keyed by "owner/repo/number"
  comments: Record<string, GitHubComment[]>
  // PR review threads keyed by "owner/repo/number"
  reviewThreads: Record<string, GitHubReviewThread[]>

  loading: Record<string, boolean>
  errors: Record<string, string | null>

  // Posted comment IDs for duplicate detection (webhook echo)
  postedCommentIds: Set<number>

  // Active SSE subscriptions (for cleanup)
  activeStreams: Record<string, AbortController>

  // Actions
  fetchComments: (owner: string, repo: string, number: number) => Promise<void>
  postComment: (owner: string, repo: string, number: number, body: string) => Promise<GitHubComment | null>
  fetchReviewComments: (owner: string, repo: string, number: number) => Promise<void>
  postReviewReply: (owner: string, repo: string, number: number, body: string, inReplyTo: number) => Promise<GitHubReviewComment | null>
  addWebhookComment: (owner: string, repo: string, number: number, comment: GitHubComment) => void
  subscribeToStream: (owner: string, repo: string, number: number) => () => void
}

function makeKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}/${number}`
}

export const useGitHubCommentsStore = create<CommentsState>((set, get) => ({
  comments: {},
  reviewThreads: {},
  loading: {},
  errors: {},
  postedCommentIds: new Set(),
  activeStreams: {},

  fetchComments: async (owner, repo, number) => {
    const key = makeKey(owner, repo, number)
    set(s => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }))

    try {
      const headers = await authHeaders()
      const response = await fetch(apiUrl(`/api/github/comments/${owner}/${repo}/${number}`), { headers })

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      const data = await response.json()
      const comments = (data.comments as Record<string, unknown>[]).map(normalizeComment)

      set(s => ({
        comments: { ...s.comments, [key]: comments },
        loading: { ...s.loading, [key]: false },
      }))
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set(s => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: msg },
      }))
    }
  },

  postComment: async (owner, repo, number, body) => {
    const key = makeKey(owner, repo, number)

    try {
      const headers = await authHeaders()
      const response = await fetch(apiUrl(`/api/github/comments/${owner}/${repo}/${number}`), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      const data = await response.json()
      const comment = normalizeComment(data.comment as Record<string, unknown>)

      // Optimistic: add to local state immediately
      set(s => ({
        comments: {
          ...s.comments,
          [key]: [...(s.comments[key] ?? []), comment],
        },
        postedCommentIds: new Set([...s.postedCommentIds, comment.id]),
      }))

      return comment
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set(s => ({ errors: { ...s.errors, [key]: msg } }))
      return null
    }
  },

  fetchReviewComments: async (owner, repo, number) => {
    const key = makeKey(owner, repo, number)
    set(s => ({ loading: { ...s.loading, [`review-${key}`]: true }, errors: { ...s.errors, [`review-${key}`]: null } }))

    try {
      const headers = await authHeaders()
      const response = await fetch(apiUrl(`/api/github/review-comments/${owner}/${repo}/${number}`), { headers })

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      const data = await response.json()
      const comments = (data.comments as Record<string, unknown>[]).map(normalizeReviewComment)
      const threads = groupReviewCommentsIntoThreads(comments)

      set(s => ({
        reviewThreads: { ...s.reviewThreads, [key]: threads },
        loading: { ...s.loading, [`review-${key}`]: false },
      }))
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set(s => ({
        loading: { ...s.loading, [`review-${key}`]: false },
        errors: { ...s.errors, [`review-${key}`]: msg },
      }))
    }
  },

  postReviewReply: async (owner, repo, number, body, inReplyTo) => {
    const key = makeKey(owner, repo, number)

    try {
      const headers = await authHeaders()
      const response = await fetch(apiUrl(`/api/github/review-comments/${owner}/${repo}/${number}`), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, in_reply_to: inReplyTo }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      const data = await response.json()
      const comment = normalizeReviewComment(data.comment as Record<string, unknown>)

      // Optimistic: add reply to the matching thread
      set(s => {
        const threads = [...(s.reviewThreads[key] ?? [])]
        const threadIdx = threads.findIndex(t => t.rootCommentId === inReplyTo || t.comments.some(c => c.id === inReplyTo))
        if (threadIdx >= 0) {
          threads[threadIdx] = {
            ...threads[threadIdx],
            comments: [...threads[threadIdx].comments, comment],
          }
        }
        return {
          reviewThreads: { ...s.reviewThreads, [key]: threads },
          postedCommentIds: new Set([...s.postedCommentIds, comment.id]),
        }
      })

      return comment
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set(s => ({ errors: { ...s.errors, [`review-${key}`]: msg } }))
      return null
    }
  },

  addWebhookComment: (owner, repo, number, comment) => {
    const key = makeKey(owner, repo, number)
    const { postedCommentIds } = get()

    // Duplicate detection: skip if we already added this comment optimistically
    if (postedCommentIds.has(comment.id)) {
      return
    }

    set(s => ({
      comments: {
        ...s.comments,
        [key]: [...(s.comments[key] ?? []), comment],
      },
    }))
  },

  subscribeToStream: (owner, repo, number) => {
    const key = makeKey(owner, repo, number)

    // Don't double-subscribe
    const { activeStreams } = get()
    if (activeStreams[key]) {
      return () => { /* already subscribed */ }
    }

    const controller = new AbortController()
    set(s => ({
      activeStreams: { ...s.activeStreams, [key]: controller },
    }))

    const url = apiUrl(`/api/github/comments-stream/${owner}/${repo}/${number}`)

    // Connect to SSE stream
    const connect = async () => {
      try {
        const headers = await authHeaders()
        const response = await fetch(url, {
          headers: { ...headers, Accept: 'text/event-stream' },
          signal: controller.signal,
        })

        if (!response.ok || !response.body) return

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          let currentEvent = ''
          let currentData = ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7)
            } else if (line.startsWith('data: ')) {
              currentData = line.slice(6)
            } else if (line === '' && currentEvent && currentData) {
              if (currentEvent === 'comment') {
                try {
                  const raw = JSON.parse(currentData) as Record<string, unknown>
                  const comment = normalizeComment(raw)
                  get().addWebhookComment(owner, repo, number, comment)
                } catch {
                  // Skip malformed events
                }
              }
              currentEvent = ''
              currentData = ''
            }
          }
        }
      } catch (err) {
        // AbortError is expected on cleanup
        if (err instanceof Error && err.name === 'AbortError') return
        console.warn('[github-comments] SSE stream error:', err)
      }
    }

    void connect()

    // Return cleanup function
    return () => {
      controller.abort()
      set(s => {
        const streams = { ...s.activeStreams }
        delete streams[key]
        return { activeStreams: streams }
      })
    }
  },
}))
