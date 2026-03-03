/**
 * Hook for fetching and managing GitHub comments and PR review threads.
 *
 * Provides:
 * - Lazy-loading of comments for issues/PRs linked to plan nodes
 * - PR review thread fetching grouped by file path
 * - Comment reply capabilities
 * - Duplicate detection for comments posted from Astro and echoed back via webhook
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchGitHubComments,
  fetchPrReviewThreads,
  postGitHubComment,
  replyToReviewThread,
  type GitHubCommentResponse,
  type GitHubReviewThreadResponse,
} from '@/lib/api-client'
import type { TaskActivityEvent } from '@/types'

interface UseGitHubCommentsOptions {
  owner: string
  repo: string
  number: number
  isPr?: boolean
  /** If true, auto-fetch on mount */
  autoFetch?: boolean
}

interface UseGitHubCommentsReturn {
  comments: GitHubCommentResponse[]
  reviewThreads: GitHubReviewThreadResponse[]
  isLoading: boolean
  error: string | null
  isGitHubConnected: boolean
  fetchComments: () => Promise<void>
  fetchThreads: () => Promise<void>
  postComment: (body: string) => Promise<GitHubCommentResponse | null>
  replyToThread: (commentId: number, body: string) => Promise<void>
  /** Convert comments to TaskActivityEvents for the activity feed */
  commentEvents: TaskActivityEvent[]
  /** Set of comment IDs posted from this Astro session (for duplicate detection) */
  localCommentIds: Set<number>
}

export function useGitHubComments(options: UseGitHubCommentsOptions): UseGitHubCommentsReturn {
  const { owner, repo, number, isPr = false, autoFetch = false } = options

  const [comments, setComments] = useState<GitHubCommentResponse[]>([])
  const [reviewThreads, setReviewThreads] = useState<GitHubReviewThreadResponse[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isGitHubConnected, setIsGitHubConnected] = useState(true)

  // Track comment IDs posted from this Astro session for duplicate detection
  const localCommentIdsRef = useRef<Set<number>>(new Set())
  const [localCommentIds, setLocalCommentIds] = useState<Set<number>>(new Set())

  const fetchComments = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await fetchGitHubComments(owner, repo, number)
      if (result.requiresAuth) {
        setIsGitHubConnected(false)
      } else {
        setComments(result.comments)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch comments')
    } finally {
      setIsLoading(false)
    }
  }, [owner, repo, number])

  const fetchThreads = useCallback(async () => {
    if (!isPr) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await fetchPrReviewThreads(owner, repo, number)
      setReviewThreads(result.threads)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch review threads')
    } finally {
      setIsLoading(false)
    }
  }, [owner, repo, number, isPr])

  const postComment = useCallback(async (body: string): Promise<GitHubCommentResponse | null> => {
    try {
      const result = await postGitHubComment(owner, repo, number, body)
      const newComment = result.comment

      // Add to local state immediately (optimistic update)
      setComments(prev => [...prev, newComment])

      // Track for duplicate detection
      localCommentIdsRef.current.add(newComment.id)
      setLocalCommentIds(new Set(localCommentIdsRef.current))

      return newComment
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment')
      return null
    }
  }, [owner, repo, number])

  const handleReplyToThread = useCallback(async (commentId: number, body: string) => {
    try {
      const result = await replyToReviewThread(owner, repo, number, commentId, body)
      const newComment = result.comment

      // Update thread with the new reply (optimistic update)
      setReviewThreads(prev => prev.map(thread => {
        const hasComment = thread.comments.some(c => c.id === commentId)
        if (hasComment) {
          return {
            ...thread,
            comments: [...thread.comments, {
              ...newComment,
              side: 'RIGHT',
              diffHunk: '',
            }],
          }
        }
        return thread
      }))

      // Track for duplicate detection
      localCommentIdsRef.current.add(newComment.id)
      setLocalCommentIds(new Set(localCommentIdsRef.current))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reply to thread')
      throw err
    }
  }, [owner, repo, number])

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch) {
      fetchComments()
      if (isPr) fetchThreads()
    }
  }, [autoFetch, fetchComments, fetchThreads, isPr])

  // Convert comments to TaskActivityEvents for the activity feed
  const commentEvents: TaskActivityEvent[] = comments.map(comment => ({
    type: 'github_comment' as const,
    id: comment.id,
    body: comment.body,
    author: comment.author,
    authorAvatarUrl: comment.authorAvatarUrl,
    htmlUrl: comment.htmlUrl,
    createdAt: comment.createdAt,
    timestamp: new Date(comment.createdAt),
  }))

  return {
    comments,
    reviewThreads,
    isLoading,
    error,
    isGitHubConnected,
    fetchComments,
    fetchThreads,
    postComment,
    replyToThread: handleReplyToThread,
    commentEvents,
    localCommentIds,
  }
}
