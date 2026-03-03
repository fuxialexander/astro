/**
 * PrReviewThreads — Displays inline PR review comment threads grouped by file.
 *
 * Features:
 * - Fetches review comments from a PR and groups by file path + line
 * - Shows diff hunk context for each thread
 * - Allows replying to specific review threads
 * - Collapsible per-file sections
 * - "Connect GitHub to reply" prompt for unauthenticated users
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  FileCode2,
  MessageSquare,
  Send,
  Loader2,
  Github,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useGitHubStore } from '@/stores/github-store'
import {
  fetchPrReviewThreads,
  replyToPrReviewThread,
  type PrReviewThread,
  type PrReviewComment,
} from '@/lib/github-comments-client'
import { StreamingMarkdown } from '@/components/ui/streaming-markdown'
import { formatRelativeTime } from '@/lib/date-utils'

interface PrReviewThreadsProps {
  owner: string
  repo: string
  prNumber: number
  /** Start expanded */
  defaultExpanded?: boolean
}

export function PrReviewThreads({
  owner,
  repo,
  prNumber,
  defaultExpanded = false,
}: PrReviewThreadsProps) {
  const [threads, setThreads] = useState<PrReviewThread[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(defaultExpanded)

  const connected = useGitHubStore((s) => s.connected)

  // Fetch threads when expanded
  useEffect(() => {
    if (!expanded) return

    let cancelled = false

    const loadThreads = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await fetchPrReviewThreads(owner, repo, prNumber)
        if (!cancelled) {
          setThreads(result)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load review threads')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadThreads()

    return () => { cancelled = true }
  }, [owner, repo, prNumber, expanded])

  // Group threads by file path
  const groupedByFile = threads.reduce<Record<string, PrReviewThread[]>>((acc, thread) => {
    const path = thread.path || 'unknown'
    if (!acc[path]) acc[path] = []
    acc[path].push(thread)
    return acc
  }, {})

  const handleReplyPosted = useCallback((threadId: number, comment: PrReviewComment) => {
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === threadId) {
          return { ...t, comments: [...t.comments, comment] }
        }
        return t
      })
    )
  }, [])

  const totalComments = threads.reduce((sum, t) => sum + t.comments.length, 0)

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
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground">
          Review Threads
        </span>
        {threads.length > 0 && (
          <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
            {threads.length} thread{threads.length !== 1 ? 's' : ''} · {totalComments} comment{totalComments !== 1 ? 's' : ''}
          </span>
        )}
        <a
          href={`https://github.com/${owner}/${repo}/pull/${prNumber}`}
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
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading review threads...
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-xs text-error">{error}</div>
          ) : threads.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              No review comments on this PR.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {Object.entries(groupedByFile).map(([filePath, fileThreads]) => (
                <FileThreadGroup
                  key={filePath}
                  filePath={filePath}
                  threads={fileThreads}
                  owner={owner}
                  repo={repo}
                  prNumber={prNumber}
                  connected={connected}
                  onReplyPosted={handleReplyPosted}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── File Thread Group ──────────────────────────────────────────────

function FileThreadGroup({
  filePath,
  threads,
  owner,
  repo,
  prNumber,
  connected,
  onReplyPosted,
}: {
  filePath: string
  threads: PrReviewThread[]
  owner: string
  repo: string
  prNumber: number
  connected: boolean
  onReplyPosted: (threadId: number, comment: PrReviewComment) => void
}) {
  const [fileExpanded, setFileExpanded] = useState(true)
  const filename = filePath.split('/').pop() || filePath

  return (
    <div>
      {/* File header */}
      <button
        onClick={() => setFileExpanded((e) => !e)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-muted/20 transition-colors bg-muted/10"
      >
        {fileExpanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <FileCode2 className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-medium text-foreground">{filename}</span>
        <span className="text-[10px] text-muted-foreground truncate">{filePath}</span>
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
          {threads.length} thread{threads.length !== 1 ? 's' : ''}
        </span>
      </button>

      {/* Threads */}
      {fileExpanded && (
        <div className="divide-y divide-border/30">
          {threads.map((thread) => (
            <ThreadView
              key={thread.id}
              thread={thread}
              owner={owner}
              repo={repo}
              prNumber={prNumber}
              connected={connected}
              onReplyPosted={onReplyPosted}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Thread View ────────────────────────────────────────────────────

function ThreadView({
  thread,
  owner,
  repo,
  prNumber,
  connected,
  onReplyPosted,
}: {
  thread: PrReviewThread
  owner: string
  repo: string
  prNumber: number
  connected: boolean
  onReplyPosted: (threadId: number, comment: PrReviewComment) => void
}) {
  const [replyText, setReplyText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [showReply, setShowReply] = useState(false)
  const replyRef = useRef<HTMLTextAreaElement>(null)

  const ghUser = useGitHubStore((s) => s.user)
  const connectGitHub = useGitHubStore((s) => s.connect)

  const handleSubmit = useCallback(async () => {
    if (!replyText.trim() || isSubmitting) return

    setIsSubmitting(true)
    setReplyError(null)

    try {
      const posted = await replyToPrReviewThread(
        owner,
        repo,
        prNumber,
        thread.id,
        replyText.trim()
      )
      onReplyPosted(thread.id, posted)
      setReplyText('')
      setShowReply(false)
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'Failed to reply')
    } finally {
      setIsSubmitting(false)
    }
  }, [replyText, isSubmitting, owner, repo, prNumber, thread.id, onReplyPosted])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      setShowReply(false)
      setReplyText('')
    }
  }, [handleSubmit])

  useEffect(() => {
    if (showReply && replyRef.current) {
      replyRef.current.focus()
    }
  }, [showReply])

  return (
    <div className="px-3 py-2">
      {/* Diff hunk context */}
      {thread.diffHunk && (
        <div className="mb-2 rounded-md overflow-hidden border border-border/50">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/30 text-[10px] text-muted-foreground">
            {thread.line != null && (
              <span className="font-mono">Line {thread.startLine ? `${thread.startLine}-${thread.line}` : thread.line}</span>
            )}
          </div>
          <pre className="px-2 py-1.5 text-[10px] font-mono leading-relaxed overflow-x-auto bg-muted/10 max-h-[120px]">
            {formatDiffHunk(thread.diffHunk)}
          </pre>
        </div>
      )}

      {/* Comments in thread */}
      <div className="space-y-2">
        {thread.comments.map((comment) => (
          <ThreadComment key={comment.id} comment={comment} />
        ))}
      </div>

      {/* Reply area */}
      {connected ? (
        showReply ? (
          <div className="mt-2 rounded-md border border-border overflow-hidden">
            <textarea
              ref={replyRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Reply to this thread..."
              rows={2}
              className="w-full resize-none bg-transparent px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none"
            />
            <div className="flex items-center justify-between border-t border-border/50 bg-muted/20 px-2 py-1">
              <span className="text-[9px] text-muted-foreground">
                {replyText.trim() ? `Posting as ${ghUser?.login ?? 'you'} · ⌘Enter` : 'Esc to cancel'}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setShowReply(false); setReplyText('') }}
                  className="h-5 px-1.5 text-[10px]"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleSubmit}
                  disabled={!replyText.trim() || isSubmitting}
                  className="h-5 px-1.5 text-[10px] gap-0.5"
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
            {replyError && (
              <div className="px-2 py-1 text-[10px] text-error bg-error/5">
                {replyError}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowReply(true)}
            className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <MessageSquare className="h-2.5 w-2.5" />
            Reply
          </button>
        )
      ) : (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Github className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">
            Connect GitHub to reply
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={connectGitHub}
            className="h-5 px-1.5 text-[9px]"
          >
            Connect
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Thread Comment ─────────────────────────────────────────────────

function ThreadComment({ comment }: { comment: PrReviewComment }) {
  return (
    <div className="flex gap-2">
      {comment.user?.avatarUrl ? (
        <img
          src={comment.user.avatarUrl}
          alt={comment.user.login}
          className="h-5 w-5 rounded-full shrink-0 mt-0.5"
        />
      ) : (
        <div className="h-5 w-5 rounded-full bg-muted shrink-0 mt-0.5 flex items-center justify-center">
          <MessageSquare className="h-2.5 w-2.5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-foreground">
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
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
        <div className="mt-0.5">
          <StreamingMarkdown
            content={comment.body}
            className="text-xs leading-relaxed"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatDiffHunk(hunk: string): string {
  // Return last few lines of the diff hunk for context
  const lines = hunk.split('\n')
  const contextLines = lines.slice(-8) // Show last 8 lines
  return contextLines.join('\n')
}

