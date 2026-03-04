/**
 * Hook to fetch and convert GitHub comments into TaskActivityEvents.
 *
 * Fetches comments from the backend API for a given issue/PR number,
 * merges cached comments from the plan node's githubComments field,
 * and returns them as TaskActivityEvent[] for the activity feed.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiUrl } from '@/lib/api-url'
import type { TaskActivityEvent, GitHubComment } from '@/types'

interface UseGitHubCommentsOptions {
  owner?: string
  repo?: string
  issueOrPrNumber?: number
  /** Cached comments from plan node's githubComments JSONB field */
  cachedComments?: GitHubComment[]
  /** Whether to fetch from the API (default: true if owner/repo/number are provided) */
  enabled?: boolean
}

interface UseGitHubCommentsResult {
  /** GitHub comments as TaskActivityEvents, sorted chronologically */
  commentEvents: TaskActivityEvent[]
  /** Whether the initial fetch is in progress */
  isLoading: boolean
  /** Error message if fetch failed */
  error: string | null
  /** Manually trigger a refetch */
  refetch: () => void
}

/**
 * Convert a GitHubComment to a TaskActivityEvent.
 */
function commentToActivityEvent(comment: GitHubComment): Extract<TaskActivityEvent, { type: 'github_comment' }> {
  return {
    type: 'github_comment',
    commentId: comment.id,
    author: {
      login: comment.author.login,
      avatar: comment.author.avatar,
    },
    body: comment.body,
    commentType: comment.type,
    path: comment.path,
    line: comment.line,
    timestamp: new Date(comment.createdAt),
  }
}

export function useGitHubComments({
  owner,
  repo,
  issueOrPrNumber,
  cachedComments,
  enabled = true,
}: UseGitHubCommentsOptions): UseGitHubCommentsResult {
  const [commentEvents, setCommentEvents] = useState<TaskActivityEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const etagsRef = useRef<{ issueEtag?: string; reviewEtag?: string }>({})

  const canFetch = enabled && !!owner && !!repo && !!issueOrPrNumber

  const fetchComments = useCallback(async () => {
    if (!canFetch) return

    setIsLoading(true)
    setError(null)

    try {
      const headers: Record<string, string> = {}
      if (etagsRef.current.issueEtag) {
        headers['X-Issue-ETag'] = etagsRef.current.issueEtag
      }
      if (etagsRef.current.reviewEtag) {
        headers['X-Review-ETag'] = etagsRef.current.reviewEtag
      }

      const response = await fetch(
        apiUrl(`/api/github/comments/${owner}/${repo}/${issueOrPrNumber}`),
        { headers }
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch comments: ${response.statusText}`)
      }

      const data = await response.json() as {
        comments: GitHubComment[]
        totalCount: number
        issueEtag?: string
        reviewEtag?: string
      }

      // Update ETags for next poll
      if (data.issueEtag) etagsRef.current.issueEtag = data.issueEtag
      if (data.reviewEtag) etagsRef.current.reviewEtag = data.reviewEtag

      const events = data.comments.map(commentToActivityEvent)
      setCommentEvents(events)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch comments'
      setError(msg)

      // Fall back to cached comments
      if (cachedComments && cachedComments.length > 0) {
        setCommentEvents(cachedComments.map(commentToActivityEvent))
      }
    } finally {
      setIsLoading(false)
    }
  }, [canFetch, owner, repo, issueOrPrNumber, cachedComments])

  // Initial fetch + use cached comments as immediate data
  useEffect(() => {
    if (cachedComments && cachedComments.length > 0) {
      setCommentEvents(cachedComments.map(commentToActivityEvent))
    }

    if (canFetch) {
      void fetchComments()
    }
  }, [canFetch]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    commentEvents,
    isLoading,
    error,
    refetch: fetchComments,
  }
}
