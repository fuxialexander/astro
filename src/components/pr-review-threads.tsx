/**
 * PR Review Comment Threads
 *
 * Displays threaded review comments grouped by file path + line.
 * Each thread shows the diff hunk context, comments chronologically,
 * and a reply input. Threads are collapsible.
 */

import { useState, useRef, useCallback, useEffect } from "react"
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  MessageSquare,
  Loader2,
  Send,
  Reply,
  ExternalLink,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { StreamingMarkdown } from "@/components/ui/streaming-markdown"
import { useGitHubCommentsStore } from "@/stores/github-comments-store"
import type { GitHubReviewThread, GitHubReviewComment } from "@/types"

const EMPTY_THREADS: GitHubReviewThread[] = []

// ─── Types ──────────────────────────────────────────────────────────

interface PRReviewThreadsProps {
  owner: string
  repo: string
  prNumber: number
  /** Optional: scroll target thread root comment ID (from PrStatusCard link) */
  scrollToThreadId?: number | null
  className?: string
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 60) return "just now"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

/** Extract the last N lines of a diff hunk for context display */
function formatDiffHunk(diffHunk: string, maxLines = 6): string[] {
  if (!diffHunk) return []
  const lines = diffHunk.split("\n")
  // Show last maxLines (closest to the commented line)
  return lines.slice(-maxLines)
}

/** Get the short filename from a path */
function shortPath(path: string): string {
  const segments = path.split("/")
  return segments.length > 2
    ? `.../${segments.slice(-2).join("/")}`
    : path
}

// ─── Main Component ─────────────────────────────────────────────────

export function PRReviewThreads({
  owner,
  repo,
  prNumber,
  scrollToThreadId,
  className,
}: PRReviewThreadsProps) {
  const key = `${owner}/${repo}/${prNumber}`
  const threadsRaw = useGitHubCommentsStore((s) => s.reviewThreads[key])
  const threads = threadsRaw ?? EMPTY_THREADS
  const loading = useGitHubCommentsStore((s) => s.loading[`review-${key}`] ?? false)
  const error = useGitHubCommentsStore((s) => s.errors[`review-${key}`] ?? null)
  const fetchReviewComments = useGitHubCommentsStore((s) => s.fetchReviewComments)

  const [expanded, setExpanded] = useState(false)

  // Fetch review comments on mount (only when not yet fetched — threadsRaw is undefined)
  useEffect(() => {
    if (threadsRaw === undefined && !loading && !error) {
      fetchReviewComments(owner, repo, prNumber)
    }
  }, [owner, repo, prNumber, threadsRaw, loading, error, fetchReviewComments])

  // Auto-expand when scrollToThreadId changes
  const shouldExpand = scrollToThreadId != null
  useEffect(() => {
    if (shouldExpand) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(true)
    }
  }, [shouldExpand])

  const totalComments = threads.reduce((sum, t) => sum + t.comments.length, 0)

  if (threads.length === 0 && !loading && !error) {
    return null // No review comments — don't render the section
  }

  return (
    <div id="pr-review-threads" className={cn("mx-4 my-2", className)}>
      {/* Section header — collapsible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-border bg-card/50 hover:bg-card/80 transition-colors cursor-pointer"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <MessageSquare className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        <span className="text-xs font-medium text-foreground">
          Review Comments
        </span>
        <span className="text-[10px] text-muted-foreground">
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin inline" />
          ) : (
            `${totalComments} comment${totalComments !== 1 ? "s" : ""} in ${threads.length} thread${threads.length !== 1 ? "s" : ""}`
          )}
        </span>
      </button>

      {/* Error state */}
      {error && expanded && (
        <div className="mt-1 px-3 py-2 text-[11px] text-error rounded-md bg-error/10 border border-error/20">
          Failed to load review comments: {error}
        </div>
      )}

      {/* Thread list */}
      {expanded && !loading && threads.length > 0 && (
        <div className="mt-1 space-y-2">
          {threads.map((thread) => (
            <ReviewThread
              key={thread.rootCommentId}
              thread={thread}
              owner={owner}
              repo={repo}
              prNumber={prNumber}
              isScrollTarget={scrollToThreadId === thread.rootCommentId}
            />
          ))}
        </div>
      )}

      {/* Loading state */}
      {expanded && loading && (
        <div className="mt-2 flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading review comments...
        </div>
      )}
    </div>
  )
}

// ─── Single Review Thread ───────────────────────────────────────────

interface ReviewThreadProps {
  thread: GitHubReviewThread
  owner: string
  repo: string
  prNumber: number
  isScrollTarget?: boolean
}

function ReviewThread({ thread, owner, repo, prNumber, isScrollTarget }: ReviewThreadProps) {
  const [expanded, setExpanded] = useState(isScrollTarget ?? false)
  const [showReply, setShowReply] = useState(false)
  const [replyText, setReplyText] = useState("")
  const [replySending, setReplySending] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const postReviewReply = useGitHubCommentsStore((s) => s.postReviewReply)

  // Scroll into view when this is the target thread
  useEffect(() => {
    if (isScrollTarget && threadRef.current) {
      threadRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
      setExpanded(true)
    }
  }, [isScrollTarget])

  const handleReply = useCallback(async () => {
    if (!replyText.trim() || replySending) return
    setReplySending(true)
    setReplyError(null)

    try {
      await postReviewReply(owner, repo, prNumber, replyText.trim(), thread.rootCommentId)
      setReplyText("")
      setShowReply(false)
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Failed to post reply")
    } finally {
      setReplySending(false)
    }
  }, [replyText, replySending, postReviewReply, owner, repo, prNumber, thread.rootCommentId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleReply()
      }
      if (e.key === "Escape") {
        setShowReply(false)
        setReplyText("")
        setReplyError(null)
      }
    },
    [handleReply],
  )

  const diffLines = formatDiffHunk(thread.diffHunk)

  return (
    <div
      ref={threadRef}
      className={cn(
        "rounded-lg border overflow-hidden",
        isScrollTarget
          ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
          : "border-border bg-card/30",
      )}
    >
      {/* Thread header: file path + line */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <FileCode className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        <span className="text-[11px] font-mono text-foreground truncate" title={thread.path}>
          {shortPath(thread.path)}
        </span>
        {thread.line != null && (
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
            L{thread.line}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
          {thread.comments.length} comment{thread.comments.length !== 1 ? "s" : ""}
        </span>
      </button>

      {expanded && (
        <>
          {/* Diff hunk context */}
          {diffLines.length > 0 && (
            <div className="border-t border-border/50 bg-muted/10 px-1 py-1 overflow-x-auto">
              <pre className="font-mono text-[10px] leading-relaxed">
                {diffLines.map((line, i) => {
                  let lineClass = "text-muted-foreground/70 px-2"
                  if (line.startsWith("+")) {
                    lineClass = "text-success bg-success/10 px-2"
                  } else if (line.startsWith("-")) {
                    lineClass = "text-error bg-error/10 px-2"
                  } else if (line.startsWith("@@")) {
                    lineClass = "text-info/60 px-2"
                  }
                  return (
                    <div key={i} className={lineClass}>
                      {line}
                    </div>
                  )
                })}
              </pre>
            </div>
          )}

          {/* Comments */}
          <div className="divide-y divide-border/40">
            {thread.comments.map((comment) => (
              <ReviewCommentItem key={comment.id} comment={comment} />
            ))}
          </div>

          {/* Reply section */}
          <div className="border-t border-border/50">
            {!showReply ? (
              <button
                onClick={() => {
                  setShowReply(true)
                  requestAnimationFrame(() => replyRef.current?.focus())
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full"
              >
                <Reply className="h-3 w-3" />
                Reply to thread
              </button>
            ) : (
              <div className="px-3 py-2 space-y-2">
                <textarea
                  ref={replyRef}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Reply to this review thread..."
                  rows={2}
                  disabled={replySending}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-50"
                />
                {replyError && (
                  <p className="text-[10px] text-destructive">{replyError}</p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+Enter to send
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setShowReply(false)
                        setReplyText("")
                        setReplyError(null)
                      }}
                      disabled={replySending}
                      className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleReply}
                      disabled={!replyText.trim() || replySending}
                      className={cn(
                        "flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded transition-colors cursor-pointer",
                        "bg-primary text-primary-foreground hover:bg-primary/90",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                      )}
                    >
                      {replySending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      {replySending ? "Sending..." : "Reply"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Single Comment Item ────────────────────────────────────────────

function ReviewCommentItem({ comment }: { comment: GitHubReviewComment }) {
  const [bodyExpanded, setBodyExpanded] = useState(false)
  const isLong = comment.body.length > 300
  const displayBody = isLong && !bodyExpanded ? comment.body.slice(0, 300) + "..." : comment.body

  return (
    <div className="px-3 py-2">
      {/* Comment header */}
      <div className="flex items-center gap-2 mb-1">
        {comment.user.avatarUrl ? (
          <img
            src={comment.user.avatarUrl}
            alt={comment.user.login}
            className="h-4 w-4 rounded-full shrink-0"
          />
        ) : (
          <div className="h-4 w-4 rounded-full bg-muted-foreground/20 shrink-0" />
        )}
        <span className="text-[11px] font-medium text-foreground">
          {comment.user.login}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {formatRelativeTime(comment.createdAt)}
        </span>
        {comment.htmlUrl && (
          <a
            href={comment.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-muted-foreground/40 hover:text-foreground transition-colors"
            title="View on GitHub"
          >
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>

      {/* Comment body */}
      <div className="ml-6">
        <StreamingMarkdown
          content={displayBody}
          className="text-xs leading-relaxed"
        />
        {isLong && (
          <button
            onClick={() => setBodyExpanded(!bodyExpanded)}
            className="text-[10px] text-primary hover:underline mt-0.5 cursor-pointer"
          >
            {bodyExpanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  )
}
