/**
 * GitHubCommentBlock — Displays GitHub issue/PR comments with inline reply support.
 *
 * Features:
 * - Fetches and displays comments from a GitHub issue/PR
 * - Inline reply textarea with markdown support
 * - Optimistic update: shows posted comment immediately
 * - "Connect GitHub to reply" prompt if user has no OAuth token
 * - Deduplication of echoed webhook comments
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  MessageSquare,
  Send,
  ExternalLink,
  Loader2,
  Github,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGitHubStore } from '@/stores/github-store'
import {
  fetchGitHubComments,
  postGitHubComment,
  type GitHubComment,
} from '@/lib/github-comments-client'
import { StreamingMarkdown } from '@/components/ui/streaming-markdown'
import { formatRelativeTime } from '@/lib/date-utils'

interface GitHubCommentBlockProps {
  owner: string
  repo: string
  number: number
  /** Initial collapsed state */
  defaultExpanded?: boolean
  /** Max height for the comment list before scrolling */
  maxHeight?: number
  /** Callback when a comment is posted (for real-time sync) */
  onCommentPosted?: (comment: GitHubComment) => void
}

export function GitHubCommentBlock({
  owner,
  repo,
  number,
  defaultExpanded = false,
  maxHeight = 400,
  onCommentPosted,
}: GitHubCommentBlockProps) {
  const [comments, setComments] = useState<GitHubComment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [replyText, setReplyText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Track comment IDs we've posted for deduplication
  const postedIdsRef = useRef<Set<number>>(new Set())

  const connected = useGitHubStore((s) => s.connected)
  const ghUser = useGitHubStore((s) => s.user)
  const connectGitHub = useGitHubStore((s) => s.connect)

  // Fetch comments when expanded
  useEffect(() => {
    if (!expanded) return

    let cancelled = false

    const loadComments = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await fetchGitHubComments(owner, repo, number)
        if (!cancelled) {
          setComments(result)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load comments')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadComments()

    return () => { cancelled = true }
  }, [owner, repo, number, expanded])

  // Auto-scroll to bottom when new comments arrive
  useEffect(() => {
    if (scrollRef.current && expanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [comments.length, expanded])

  const handleSubmit = useCallback(async () => {
    if (!replyText.trim() || isSubmitting) return

    setIsSubmitting(true)
    setError(null)

    // Create optimistic comment
    const optimisticComment: GitHubComment = {
      id: -Date.now(), // Negative ID for optimistic entry
      body: replyText.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      htmlUrl: '',
      user: ghUser ? {
        login: ghUser.login,
        avatarUrl: ghUser.avatarUrl,
        id: ghUser.id,
      } : null,
    }

    // Optimistic update
    setComments((prev) => [...prev, optimisticComment])
    const savedText = replyText
    setReplyText('')

    try {
      const posted = await postGitHubComment(owner, repo, number, savedText)
      // Replace optimistic comment with real one
      setComments((prev) =>
        prev.map((c) => (c.id === optimisticComment.id ? posted : c))
      )
      // Track posted ID for webhook dedup
      postedIdsRef.current.add(posted.id)
      onCommentPosted?.(posted)
    } catch (err) {
      // Revert optimistic update on failure
      setComments((prev) => prev.filter((c) => c.id !== optimisticComment.id))
      setReplyText(savedText)
      setError(err instanceof Error ? err.message : 'Failed to post comment')
    } finally {
      setIsSubmitting(false)
    }
  }, [replyText, isSubmitting, owner, repo, number, ghUser, onCommentPosted])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <Github className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground">
          Comments
        </span>
        <span className="text-[10px] text-muted-foreground">
          {owner}/{repo}#{number}
        </span>
        {comments.length > 0 && (
          <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
            {comments.length}
          </span>
        )}
        <a
          href={`https://github.com/${owner}/${repo}/issues/${number}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border">
          {/* Comment list */}
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading comments...
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-xs text-error">{error}</div>
          ) : comments.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              No comments yet.
            </div>
          ) : (
            <div
              ref={scrollRef}
              className="overflow-y-auto divide-y divide-border/50"
              style={{ maxHeight }}
            >
              {comments.map((comment) => (
                <CommentRow key={comment.id} comment={comment} />
              ))}
            </div>
          )}

          {/* Reply input */}
          {connected ? (
            <div className="border-t border-border">
              <div className="relative">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Reply on GitHub..."
                  rows={2}
                  className="w-full resize-none bg-transparent px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none"
                />
                <div className="flex items-center justify-between border-t border-border/50 bg-muted/20 px-3 py-1">
                  <span className="text-[10px] text-muted-foreground">
                    {replyText.trim() ? `Posting as ${ghUser?.login ?? 'you'} · ⌘Enter to send` : 'Markdown supported'}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleSubmit}
                    disabled={!replyText.trim() || isSubmitting}
                    className="h-5 px-2 text-[10px] gap-1"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Send className="h-2.5 w-2.5" />
                    )}
                    Reply
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="border-t border-border px-3 py-2.5 flex items-center gap-2">
              <Github className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Connect GitHub to reply
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={connectGitHub}
                className="h-6 px-2 text-[10px] ml-auto"
              >
                Connect
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────

function CommentRow({ comment }: { comment: GitHubComment }) {
  const isOptimistic = comment.id < 0

  return (
    <div className={cn(
      'flex gap-2.5 px-3 py-2.5',
      isOptimistic && 'opacity-60'
    )}>
      {/* Avatar */}
      {comment.user?.avatarUrl ? (
        <img
          src={comment.user.avatarUrl}
          alt={comment.user.login}
          className="h-6 w-6 rounded-full shrink-0 mt-0.5"
        />
      ) : (
        <div className="h-6 w-6 rounded-full bg-muted shrink-0 mt-0.5 flex items-center justify-center">
          <MessageSquare className="h-3 w-3 text-muted-foreground" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">
            {comment.user?.login ?? 'Unknown'}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(new Date(comment.createdAt))}
          </span>
          {comment.htmlUrl && (
            <a
              href={comment.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors ml-auto"
            >
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
        <div className="mt-1">
          <StreamingMarkdown
            content={comment.body}
            className="text-xs leading-relaxed"
          />
        </div>
      </div>
    </div>
  )
}

