/**
 * GitHub Comments & PR Review Threads
 *
 * Components for displaying and replying to GitHub issue/PR comments
 * and PR review comment threads within Astro.
 */

import React, { useState, useCallback, useEffect } from 'react'
import {
  MessageSquare,
  Send,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  FileCode,
  Github,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGitHubCommentsStore } from '@/stores/github-comments-store'
import { useGitHubStore } from '@/stores/github-store'
import { StreamingMarkdown } from '@/components/ui/streaming-markdown'
import type { GitHubComment, GitHubReviewThread, GitHubReviewComment } from '@/types'

// ── Comment Reply Input ────────────────────────────────────────────────

interface ReplyInputProps {
  onSubmit: (body: string) => Promise<void>
  placeholder?: string
  className?: string
}

function ReplyInput({ onSubmit, placeholder = 'Write a reply...', className }: ReplyInputProps) {
  const [value, setValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!value.trim() || isSubmitting) return
    setIsSubmitting(true)
    try {
      await onSubmit(value.trim())
      setValue('')
    } finally {
      setIsSubmitting(false)
    }
  }, [value, isSubmitting, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  return (
    <div className={cn('relative rounded-lg border border-input bg-background overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-shadow', className)}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-none bg-transparent px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none"
      />
      <div className="flex items-center justify-between border-t border-border/50 bg-muted/20 px-2 py-1">
        <span className="text-[10px] text-muted-foreground">
          {value.trim() ? '⌘ Enter to submit' : 'Markdown supported'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSubmit}
          disabled={!value.trim() || isSubmitting}
          className="h-5 px-2 text-[10px] gap-1"
        >
          {isSubmitting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
          Reply
        </Button>
      </div>
    </div>
  )
}

// ── Connect GitHub Prompt ──────────────────────────────────────────────

function ConnectGitHubPrompt({ className }: { className?: string }) {
  const { connect, loading } = useGitHubStore()

  return (
    <div className={cn('flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 px-3 py-2', className)}>
      <Github className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground">Connect GitHub to reply</span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => connect()}
        disabled={loading}
        className="h-5 px-2 text-[10px] ml-auto"
      >
        Connect
      </Button>
    </div>
  )
}

// ── Single Comment Card ────────────────────────────────────────────────

interface CommentCardProps {
  comment: GitHubComment | GitHubReviewComment
  compact?: boolean
}

function CommentCard({ comment, compact }: CommentCardProps) {
  return (
    <div className={cn('group flex gap-2', compact ? 'py-1' : 'py-1.5')}>
      {/* Avatar */}
      <img
        src={comment.user.avatarUrl}
        alt={comment.user.login}
        className={cn(
          'rounded-full shrink-0 mt-0.5',
          compact ? 'h-5 w-5' : 'h-6 w-6'
        )}
      />
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground">{comment.user.login}</span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(comment.createdAt)}
          </span>
          <a
            href={comment.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
          >
            <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
          </a>
        </div>
        <div className="mt-0.5">
          <StreamingMarkdown
            content={comment.body}
            className="text-xs leading-relaxed text-foreground/90"
          />
        </div>
      </div>
    </div>
  )
}

// ── GitHub Comment Block (Issue/PR comments) ───────────────────────────

interface GitHubCommentBlockProps {
  owner: string
  repo: string
  number: number
  /** Optional: show as compact in activity feed */
  compact?: boolean
  className?: string
}

export function GitHubCommentBlock({
  owner,
  repo,
  number,
  compact,
  className,
}: GitHubCommentBlockProps) {
  const { connected } = useGitHubStore()
  const {
    comments,
    loading,
    errors,
    fetchComments,
    postComment,
  } = useGitHubCommentsStore()

  const key = `${owner}/${repo}/${number}`
  const commentList = comments[key] ?? []
  const isLoading = loading[key] ?? false
  const error = errors[key] ?? null
  const [expanded, setExpanded] = useState(true)

  const { subscribeToStream } = useGitHubCommentsStore()

  useEffect(() => {
    if (connected) {
      fetchComments(owner, repo, number)
    }
  }, [connected, owner, repo, number, fetchComments])

  // Subscribe to real-time comment updates via SSE
  useEffect(() => {
    if (!connected) return
    const unsubscribe = subscribeToStream(owner, repo, number)
    return unsubscribe
  }, [connected, owner, repo, number, subscribeToStream])

  const handleReply = useCallback(
    async (body: string) => {
      await postComment(owner, repo, number, body)
    },
    [owner, repo, number, postComment]
  )

  if (!connected) {
    return (
      <div className={cn('px-4 py-2', className)}>
        <ConnectGitHubPrompt />
      </div>
    )
  }

  return (
    <div className={cn('mx-4 my-1.5', className)}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-muted/30 rounded transition-colors cursor-pointer group"
      >
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-muted-foreground">
          GitHub Comments
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          {commentList.length > 0 ? `${commentList.length}` : ''}
        </span>
        <span className="text-[10px] text-muted-foreground/60 ml-auto">
          #{number}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 ml-2 mr-1 border-l-2 border-muted-foreground/20 pl-3">
          {/* Loading state */}
          {isLoading && commentList.length === 0 && (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading comments...
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="flex items-center gap-2 py-2 text-xs text-destructive">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {error}
            </div>
          )}

          {/* Comment list */}
          {commentList.length === 0 && !isLoading && !error && (
            <p className="text-[10px] text-muted-foreground py-2">No comments yet.</p>
          )}

          {commentList.map((comment) => (
            <CommentCard key={comment.id} comment={comment} compact={compact} />
          ))}

          {/* Reply input */}
          <ReplyInput onSubmit={handleReply} className="mt-2 mb-1" />
        </div>
      )}
    </div>
  )
}

// ── PR Review Thread ───────────────────────────────────────────────────

interface PrReviewThreadProps {
  thread: GitHubReviewThread
  owner: string
  repo: string
  number: number
}

export function PrReviewThread({ thread, owner, repo, number }: PrReviewThreadProps) {
  const [expanded, setExpanded] = useState(false)
  const { connected } = useGitHubStore()
  const { postReviewReply } = useGitHubCommentsStore()

  const handleReply = useCallback(
    async (body: string) => {
      await postReviewReply(owner, repo, number, body, thread.rootCommentId)
    },
    [owner, repo, number, thread.rootCommentId, postReviewReply]
  )

  const rootComment = thread.comments[0]
  if (!rootComment) return null

  // Get the last few lines of the diff hunk for context
  const diffLines = thread.diffHunk.split('\n')
  const contextLines = diffLines.slice(-4)

  return (
    <div className="rounded-md border border-border/60 overflow-hidden">
      {/* File path header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 bg-muted/40 text-left hover:bg-muted/60 transition-colors cursor-pointer"
      >
        <FileCode className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-mono text-foreground truncate">{thread.path}</span>
        {thread.line != null && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            L{thread.line}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/60 shrink-0 ml-auto">
          {thread.comments.length} {thread.comments.length === 1 ? 'comment' : 'comments'}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        )}
      </button>

      {expanded && (
        <div>
          {/* Diff context */}
          <div className="bg-muted/20 border-b border-border/40 px-3 py-1.5 overflow-x-auto">
            <pre className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              {contextLines.map((line, idx) => {
                let lineClass = ''
                if (line.startsWith('+')) lineClass = 'text-success'
                else if (line.startsWith('-')) lineClass = 'text-destructive'
                return (
                  <div key={idx} className={lineClass}>
                    {line}
                  </div>
                )
              })}
            </pre>
          </div>

          {/* Thread comments */}
          <div className="px-3 py-1">
            {thread.comments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} compact />
            ))}
          </div>

          {/* Reply */}
          {connected ? (
            <div className="px-3 pb-2">
              <ReplyInput onSubmit={handleReply} placeholder="Reply to this review thread..." />
            </div>
          ) : (
            <div className="px-3 pb-2">
              <ConnectGitHubPrompt />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── PR Review Threads Section ──────────────────────────────────────────

interface PrReviewThreadsSectionProps {
  owner: string
  repo: string
  number: number
  className?: string
}

export function PrReviewThreadsSection({
  owner,
  repo,
  number,
  className,
}: PrReviewThreadsSectionProps) {
  const { connected } = useGitHubStore()
  const {
    reviewThreads,
    loading,
    errors,
    fetchReviewComments,
  } = useGitHubCommentsStore()

  const key = `${owner}/${repo}/${number}`
  const threads = reviewThreads[key] ?? []
  const isLoading = loading[`review-${key}`] ?? false
  const error = errors[`review-${key}`] ?? null
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (connected) {
      fetchReviewComments(owner, repo, number)
    }
  }, [connected, owner, repo, number, fetchReviewComments])

  if (!connected) return null
  if (threads.length === 0 && !isLoading && !error) return null

  return (
    <div className={cn('mx-4 my-1.5', className)}>
      {/* Section header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-muted/30 rounded transition-colors cursor-pointer group"
      >
        <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-muted-foreground">
          Review Threads
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          {threads.length > 0 ? `${threads.length}` : ''}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0 ml-auto" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0 ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 space-y-2">
          {isLoading && threads.length === 0 && (
            <div className="flex items-center gap-2 py-2 px-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading review threads...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 py-2 px-2 text-xs text-destructive">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {error}
            </div>
          )}

          {threads.map((thread) => (
            <PrReviewThread
              key={thread.rootCommentId}
              thread={thread}
              owner={owner}
              repo={repo}
              number={number}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return d.toLocaleDateString()
}
