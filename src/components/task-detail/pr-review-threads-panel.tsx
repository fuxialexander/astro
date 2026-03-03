/**
 * PR Review Threads Panel
 *
 * Expandable section that displays PR review comment threads
 * grouped by file path, with inline reply capability.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Loader2,
  RefreshCw,
  GitPullRequest,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PrReviewThreadBlock } from '@/components/activity-blocks'
import { useGitHubComments } from '@/hooks/use-github-comments'
import type { GitHubReviewThread } from '@/types'

interface PrReviewThreadsPanelProps {
  owner: string
  repo: string
  prNumber: number
}

export function PrReviewThreadsPanel({ owner, repo, prNumber }: PrReviewThreadsPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const {
    reviewThreads,
    isLoading,
    error,
    isGitHubConnected,
    fetchThreads,
    replyToThread,
  } = useGitHubComments({
    owner,
    repo,
    number: prNumber,
    isPr: true,
    autoFetch: false,
  })

  // Fetch threads when expanded
  useEffect(() => {
    if (expanded && reviewThreads.length === 0 && !isLoading) {
      fetchThreads()
    }
  }, [expanded, reviewThreads.length, isLoading, fetchThreads])

  const handleReply = useCallback(async (commentId: number, body: string) => {
    await replyToThread(commentId, body)
  }, [replyToThread])

  // Convert API response threads to GitHubReviewThread type
  const threads: GitHubReviewThread[] = reviewThreads.map(t => ({
    path: t.path,
    line: t.line ?? undefined,
    diffHunk: t.diffHunk,
    isResolved: t.isResolved,
    comments: t.comments.map(c => ({
      id: c.id,
      body: c.body,
      author: c.author,
      authorAvatarUrl: c.authorAvatarUrl,
      htmlUrl: c.htmlUrl,
      path: c.path,
      line: c.line ?? undefined,
      originalLine: c.originalLine ?? undefined,
      side: (c.side === 'LEFT' ? 'LEFT' : 'RIGHT') as 'LEFT' | 'RIGHT',
      diffHunk: c.diffHunk,
      inReplyToId: c.inReplyToId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  }))

  const totalComments = threads.reduce((sum, t) => sum + t.comments.length, 0)

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <GitPullRequest className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Review Threads</span>
        {threads.length > 0 && (
          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full font-medium text-muted-foreground">
            {threads.length} thread{threads.length !== 1 ? 's' : ''}
            {totalComments > 0 && ` · ${totalComments} comment${totalComments !== 1 ? 's' : ''}`}
          </span>
        )}
        <div className="flex-1" />
        {expanded && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              fetchThreads()
            }}
            className="text-muted-foreground hover:text-foreground"
            title="Refresh threads"
          >
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
          </button>
        )}
      </button>

      {/* Content */}
      {expanded && (
        <div className="border-t border-border/50">
          {isLoading && threads.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading review threads...
            </div>
          )}

          {error && (
            <div className="px-3 py-4 text-xs text-destructive text-center">
              {error}
            </div>
          )}

          {!isLoading && !error && threads.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
              No review threads
            </div>
          )}

          {threads.map((thread, i) => (
            <PrReviewThreadBlock
              key={`${thread.path}-${thread.line}-${i}`}
              thread={thread}
              onReply={handleReply}
              isGitHubConnected={isGitHubConnected}
            />
          ))}
        </div>
      )}
    </div>
  )
}
