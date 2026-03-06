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
  User,
  Pencil,
  Trash2,
  Check,
  X,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGitHubCommentsStore } from '@/stores/github-comments-store'
import { useGitHubStore } from '@/stores/github-store'
import { editGitHubComment, deleteGitHubComment } from '@/lib/api-client'
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
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = useCallback(async () => {
    if (!value.trim() || isSubmitting) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await onSubmit(value.trim())
      setValue('')  // Only clear on success
    } catch (err) {
      // Error shown via store state or inline — don't clear input
      setSubmitError(err instanceof Error ? err.message : 'Failed to post reply')
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
        onChange={(e) => { setValue(e.target.value); setSubmitError(null) }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
        aria-label="Reply to comment"
        className="w-full resize-none bg-transparent px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none"
      />
      {submitError && (
        <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {submitError}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border/50 bg-muted/20 px-2 py-1">
        <span className="text-[10px] text-muted-foreground">
          {value.trim() ? '⌘+Enter to submit' : 'Markdown supported'}
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
  /** Owner/repo needed for edit/delete API calls */
  owner?: string
  repo?: string
  /** Current user's GitHub login — edit/delete shown only for own comments */
  currentUserLogin?: string
  /** Called after successful edit/delete to refresh the comment list */
  onMutated?: () => void
}

function CommentCard({ comment, compact, owner, repo, currentUserLogin, onMutated }: CommentCardProps) {
  const [avatarError, setAvatarError] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOwn = currentUserLogin && comment.user.login === currentUserLogin
  const canMutate = isOwn && owner && repo

  const handleSaveEdit = useCallback(async () => {
    if (!canMutate || !editBody.trim() || saving) return
    setSaving(true)
    setError(null)
    const result = await editGitHubComment(owner!, repo!, comment.id, editBody.trim())
    setSaving(false)
    if (result.success) {
      setEditing(false)
      onMutated?.()
    } else {
      setError(result.error || 'Failed to edit')
    }
  }, [canMutate, owner, repo, comment.id, editBody, saving, onMutated])

  const handleDelete = useCallback(async () => {
    if (!canMutate || deleting) return
    setDeleting(true)
    setError(null)
    const result = await deleteGitHubComment(owner!, repo!, comment.id)
    setDeleting(false)
    if (result.success) {
      onMutated?.()
    } else {
      setError(result.error || 'Failed to delete')
    }
  }, [canMutate, owner, repo, comment.id, deleting, onMutated])

  return (
    <div className={cn('group flex gap-2', compact ? 'py-1' : 'py-1.5')}>
      {/* Avatar */}
      {comment.user.avatarUrl && !avatarError ? (
        <img
          src={comment.user.avatarUrl}
          alt={comment.user.login}
          onError={() => setAvatarError(true)}
          className={cn(
            'rounded-full shrink-0 mt-0.5',
            compact ? 'h-5 w-5' : 'h-6 w-6'
          )}
        />
      ) : (
        <div className={cn(
          'rounded-full shrink-0 mt-0.5 bg-muted flex items-center justify-center',
          compact ? 'h-5 w-5' : 'h-6 w-6'
        )}>
          <User className={cn('text-muted-foreground', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        </div>
      )}
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground">{comment.user.login}</span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(comment.createdAt)}
          </span>
          {/* Edit/Delete buttons — only for own comments */}
          {canMutate && !editing && !confirmDelete && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 ml-auto">
              <button
                onClick={() => { setEditing(true); setEditBody(comment.body) }}
                className="p-0.5 rounded hover:bg-muted transition-colors"
                aria-label="Edit comment"
              >
                <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-0.5 rounded hover:bg-muted transition-colors"
                aria-label="Delete comment"
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          )}
          {confirmDelete && (
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-[10px] text-destructive">Delete?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="p-0.5 rounded hover:bg-destructive/10 transition-colors"
                aria-label="Confirm delete"
              >
                {deleting ? (
                  <Loader2 className="h-3 w-3 animate-spin text-destructive" />
                ) : (
                  <Check className="h-3 w-3 text-destructive" />
                )}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="p-0.5 rounded hover:bg-muted transition-colors"
                aria-label="Cancel delete"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          )}
          {!canMutate && (
            <a
              href={comment.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open on GitHub"
              className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
            >
              <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
            </a>
          )}
        </div>
        {editing ? (
          <div className="mt-1 space-y-1.5">
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="w-full min-h-[60px] rounded border border-border bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              aria-label="Edit comment"
            />
            {error && (
              <div className="text-[10px] text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {error}
              </div>
            )}
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-2 text-[10px] gap-1"
                onClick={handleSaveEdit}
                disabled={saving || !editBody.trim()}
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-2 text-[10px] gap-1"
                onClick={() => { setEditing(false); setError(null) }}
              >
                <X className="h-3 w-3" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5">
            <StreamingMarkdown
              content={comment.body}
              className="text-xs leading-relaxed text-foreground/90"
            />
          </div>
        )}
        {!editing && error && (
          <div className="text-[10px] text-destructive flex items-center gap-1 mt-0.5">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {error}
          </div>
        )}
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
  const { connected, user: ghUser } = useGitHubStore()
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
        aria-expanded={expanded}
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
              <span className="flex-1">{error}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-2 text-[10px] gap-1 text-destructive hover:text-destructive shrink-0"
                onClick={() => fetchComments(owner, repo, number)}
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
            </div>
          )}

          {/* Comment list */}
          {commentList.length === 0 && !isLoading && !error && (
            <p className="text-[10px] text-muted-foreground py-2">No comments yet.</p>
          )}

          {commentList.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              compact={compact}
              owner={owner}
              repo={repo}
              currentUserLogin={ghUser?.login}
              onMutated={() => fetchComments(owner, repo, number)}
            />
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
  const [expanded, setExpanded] = useState(true)
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
        aria-expanded={expanded}
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
  const [expanded, setExpanded] = useState(true)

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
        aria-expanded={expanded}
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
              <span className="flex-1">{error}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-2 text-[10px] gap-1 text-destructive hover:text-destructive shrink-0"
                onClick={() => fetchReviewComments(owner, repo, number)}
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
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
