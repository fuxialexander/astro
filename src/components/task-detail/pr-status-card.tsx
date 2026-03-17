/**
 * PrStatusCard — displays PR details and provides action buttons
 * for approve, request changes, merge, and commenting on a PR.
 */
import { useState, useEffect, useCallback, useRef } from "react"
import {
  Check,
  X,
  GitMerge,
  MessageSquare,
  ChevronDown,
  ExternalLink,
  Loader2,
  AlertCircle,
  GitPullRequest,
  RefreshCw,
  Shield,
  CircleDot,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { useToastStore } from "@/stores/toast-store"
import {
  fetchPrDetails,
  fetchPrChecks,
  fetchPrReviews,
  submitPrReview,
  mergePr,
  commentOnPr,
  closePr,
  markPrReady,
  type PrDetails,
  type PrChecksResult,
  type PrReviewsResult,
  type PrReviewEvent,
  type PrMergeMethod,
} from "@/lib/api-client"
import { StreamingMarkdown } from "@/components/ui/streaming-markdown"
import { cn } from "@/lib/utils"
import { useGitHubAppStore } from "@/stores/github-app-store"
import { useGitHubCommentsStore } from "@/stores/github-comments-store"

interface PrStatusCardProps {
  owner: string
  repo: string
  prNumber: number
  prUrl: string
  /** Current user's GitHub login (to disable self-approval) */
  currentUserLogin?: string
}

export function PrStatusCard({
  owner,
  repo,
  prNumber,
  prUrl,
  currentUserLogin,
}: PrStatusCardProps) {
  const addToast = useToastStore((s) => s.add)
  const connected = useGitHubAppStore((s) => s.installations.length > 0)
  const [prDetails, setPrDetails] = useState<PrDetails | null>(null)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [checksResult, setChecksResult] = useState<PrChecksResult | null>(null)
  const [reviewsResult, setReviewsResult] = useState<PrReviewsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Dialog states
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [commentDialogOpen, setCommentDialogOpen] = useState(false)
  const [selectedMergeMethod, setSelectedMergeMethod] = useState<PrMergeMethod>("squash")
  const [reviewEvent, setReviewEvent] = useState<PrReviewEvent>("APPROVE")
  const [reviewBody, setReviewBody] = useState("")
  const [commentBody, setCommentBody] = useState("")

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadPrDetails = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [details, checks, reviews] = await Promise.all([
        fetchPrDetails(owner, repo, prNumber),
        fetchPrChecks(owner, repo, prNumber).catch(() => null),
        fetchPrReviews(owner, repo, prNumber).catch(() => null),
      ])
      setPrDetails(details)
      setChecksResult(checks)
      setReviewsResult(reviews)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [owner, repo, prNumber])

  useEffect(() => {
    loadPrDetails()
  }, [loadPrDetails])

  // Derived state
  const pr = prDetails
  const reviews = reviewsResult?.reviews || []
  const checks = checksResult?.checks || []

  const isOwnPr = currentUserLogin && pr?.user?.login === currentUserLogin
  const isMerged = pr?.merged === true
  const isClosed = pr?.state === 'closed' && !isMerged
  const isOpen = pr?.state === 'open'
  const isDraft = pr?.draft === true

  // Auto-refresh open PRs every 60 seconds
  useEffect(() => {
    if (!isOpen) return
    const interval = setInterval(() => {
      loadPrDetails()
    }, 60_000)
    return () => clearInterval(interval)
  }, [isOpen, loadPrDetails])

  // Check status aggregation
  const totalChecks = checks.length
  const passingChecks = checks.filter((c: { conclusion: string | null }) => c.conclusion === 'success').length
  const failingChecks = checks.filter((c: { conclusion: string | null }) => c.conclusion === 'failure').length
  const pendingChecks = checks.filter((c: { status: string; conclusion: string | null }) => c.status === 'in_progress' || c.status === 'queued' || !c.conclusion).length

  // Review status
  const approvedReviews = reviews.filter((r: { state: string }) => r.state === 'APPROVED')
  const changesRequestedReviews = reviews.filter((r: { state: string }) => r.state === 'CHANGES_REQUESTED')
  const hasApproval = approvedReviews.length > 0
  const hasChangesRequested = changesRequestedReviews.length > 0

  // Can merge check
  const canMerge = isOpen && !isDraft && pr?.mergeable !== false && failingChecks === 0

  // ── Action handlers ─────────────────────────────────────────────────

  const handleReview = useCallback(async () => {
    if (!isOpen) return
    setActionLoading('review')
    try {
      const result = await submitPrReview(owner, repo, prNumber, reviewEvent, reviewBody || undefined)
      if (result.success) {
        addToast({
          type: "success",
          title: reviewEvent === 'APPROVE' ? "PR approved" :
                 reviewEvent === 'REQUEST_CHANGES' ? "Changes requested" : "Review comment posted",
        })
        setReviewDialogOpen(false)
        setReviewBody("")
        // Refresh PR details
        loadPrDetails()
      } else {
        addToast({
          type: "error",
          title: "Review failed",
          description: result.error || "Unknown error",
        })
      }
    } catch (err) {
      addToast({
        type: "error",
        title: "Review failed",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionLoading(null)
    }
  }, [owner, repo, prNumber, reviewEvent, reviewBody, isOpen, addToast, loadPrDetails])

  const handleMerge = useCallback(async () => {
    if (!canMerge) return
    setActionLoading('merge')
    // Optimistic update
    const prevDetails = prDetails
    setPrDetails(prev => prev ? { ...prev, state: 'closed', merged: true } : prev)
    setMergeDialogOpen(false)
    try {
      const result = await mergePr(owner, repo, prNumber, selectedMergeMethod)
      if (result.success) {
        addToast({
          type: "success",
          title: "PR merged",
          description: `Successfully merged via ${selectedMergeMethod}`,
        })
        loadPrDetails()
      } else {
        // Rollback optimistic update
        setPrDetails(prevDetails)
        addToast({
          type: "error",
          title: "Merge failed",
          description: result.error || "Unknown error",
        })
      }
    } catch (err) {
      setPrDetails(prevDetails)
      addToast({
        type: "error",
        title: "Merge failed",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionLoading(null)
    }
  }, [owner, repo, prNumber, selectedMergeMethod, canMerge, addToast, loadPrDetails, prDetails])

  const handleComment = useCallback(async () => {
    if (!commentBody.trim()) return
    setActionLoading('comment')
    try {
      const result = await commentOnPr(owner, repo, prNumber, commentBody)
      if (result.success) {
        addToast({
          type: "success",
          title: "Comment posted",
        })
        // Sync the new comment into the comments store so it appears in the feed
        if (result.comment) {
          useGitHubCommentsStore.getState().addWebhookComment(owner, repo, prNumber, {
            id: result.comment.id,
            nodeId: '',
            body: commentBody.trim(),
            htmlUrl: result.comment.htmlUrl || '',
            createdAt: result.comment.createdAt || new Date().toISOString(),
            updatedAt: result.comment.createdAt || new Date().toISOString(),
            user: {
              login: result.comment.user?.login ?? '',
              avatarUrl: result.comment.user?.avatarUrl ?? '',
              id: result.comment.user?.id ?? 0,
            },
          })
        }
        setCommentDialogOpen(false)
        setCommentBody("")
      } else {
        addToast({
          type: "error",
          title: "Comment failed",
          description: result.error || "Unknown error",
        })
      }
    } catch (err) {
      addToast({
        type: "error",
        title: "Comment failed",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionLoading(null)
    }
  }, [owner, repo, prNumber, commentBody, addToast])

  const handleMarkReady = useCallback(async () => {
    if (!isDraft || !isOpen) return
    setActionLoading('ready')
    const prevDetails = prDetails
    setPrDetails(prev => prev ? { ...prev, draft: false } : prev)
    try {
      const result = await markPrReady(owner, repo, prNumber)
      if (result.success) {
        addToast({ type: "success", title: "PR marked as ready for review" })
        loadPrDetails()
      } else {
        setPrDetails(prevDetails)
        addToast({ type: "error", title: "Failed to mark ready", description: result.error || "Unknown error" })
      }
    } catch (err) {
      setPrDetails(prevDetails)
      addToast({ type: "error", title: "Failed to mark ready", description: err instanceof Error ? err.message : String(err) })
    } finally {
      setActionLoading(null)
    }
  }, [owner, repo, prNumber, isDraft, isOpen, addToast, loadPrDetails, prDetails])

  const handleClose = useCallback(async () => {
    if (!isOpen) return
    setActionLoading('close')
    const prevDetails = prDetails
    setPrDetails(prev => prev ? { ...prev, state: 'closed' } : prev)
    setCloseDialogOpen(false)
    try {
      const result = await closePr(owner, repo, prNumber)
      if (result.success) {
        addToast({ type: "success", title: "PR closed" })
        loadPrDetails()
      } else {
        setPrDetails(prevDetails)
        addToast({ type: "error", title: "Close failed", description: result.error || "Unknown error" })
      }
    } catch (err) {
      setPrDetails(prevDetails)
      addToast({ type: "error", title: "Close failed", description: err instanceof Error ? err.message : String(err) })
    } finally {
      setActionLoading(null)
    }
  }, [owner, repo, prNumber, isOpen, addToast, loadPrDetails, prDetails])

  // ── Loading/Error states ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 border rounded-lg bg-card">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading PR details...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 border rounded-lg bg-card border-destructive/30">
        <AlertCircle className="h-4 w-4 text-destructive" />
        <span className="text-sm text-destructive">{error}</span>
        <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={loadPrDetails}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
      </div>
    )
  }

  if (!pr) return null

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <>
      <div className="border rounded-lg bg-card overflow-hidden">
        {/* PR Header */}
        <div className="px-4 py-3 flex items-start gap-3">
          <div className="mt-0.5">
            {isMerged ? (
              <GitMerge className="h-4 w-4 text-purple-500" />
            ) : isClosed ? (
              <GitPullRequest className="h-4 w-4 text-destructive" />
            ) : isDraft ? (
              <GitPullRequest className="h-4 w-4 text-muted-foreground" />
            ) : (
              <GitPullRequest className="h-4 w-4 text-success" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium hover:underline truncate"
              >
                {pr.title}
              </a>
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
              <span>#{prNumber}</span>
              <span>·</span>
              <span>{pr.branch} → {pr.baseBranch}</span>
              <span>·</span>
              <span className="text-success">+{pr.diffStats.additions}</span>
              <span className="text-destructive">-{pr.diffStats.deletions}</span>
              <span>·</span>
              <span>{pr.diffStats.changedFiles} file{pr.diffStats.changedFiles !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={loadPrDetails}
              aria-label="Refresh PR details"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
            <Badge
              variant={isMerged ? "default" : isClosed ? "destructive" : isDraft ? "secondary" : "success"}
              className="text-[10px]"
            >
              {isMerged ? "Merged" : isClosed ? "Closed" : isDraft ? "Draft" : "Open"}
            </Badge>
          </div>
        </div>

        {/* PR Description */}
        {pr.body && (
          <div className="px-4 py-2 border-t border-border/50">
            <button
              onClick={() => setDescriptionExpanded(!descriptionExpanded)}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {descriptionExpanded ? 'Hide description' : 'Show description'}
            </button>
            {descriptionExpanded && (
              <div className="mt-1">
                <StreamingMarkdown
                  content={pr.body}
                  className="text-xs leading-relaxed text-foreground/90"
                />
              </div>
            )}
          </div>
        )}

        {/* Status Row: checks + reviews */}
        <div className="px-4 py-2 border-t border-border/50 flex items-center gap-4 flex-wrap text-xs">
          {/* Checks */}
          {totalChecks > 0 && (
            <div className="flex items-center gap-1.5">
              {failingChecks > 0 ? (
                <X className="h-3 w-3 text-destructive" />
              ) : pendingChecks > 0 ? (
                <CircleDot className="h-3 w-3 text-warning animate-pulse" />
              ) : (
                <Check className="h-3 w-3 text-success" />
              )}
              <span className={cn(
                failingChecks > 0 ? "text-destructive" :
                pendingChecks > 0 ? "text-warning" : "text-success"
              )}>
                {passingChecks}/{totalChecks} checks
              </span>
            </div>
          )}
          {/* Reviews */}
          {reviews.length > 0 && (
            <div className="flex items-center gap-1.5">
              {hasChangesRequested ? (
                <AlertCircle className="h-3 w-3 text-warning" />
              ) : hasApproval ? (
                <Shield className="h-3 w-3 text-success" />
              ) : (
                <MessageSquare className="h-3 w-3 text-muted-foreground" />
              )}
              <span className={cn(
                hasChangesRequested ? "text-warning" :
                hasApproval ? "text-success" : "text-muted-foreground"
              )}>
                {hasChangesRequested ? "Changes requested" :
                 hasApproval ? `${approvedReviews.length} approval${approvedReviews.length !== 1 ? 's' : ''}` :
                 `${reviews.length} review${reviews.length !== 1 ? 's' : ''}`}
              </span>
            </div>
          )}
          {/* Mergeable state */}
          {isOpen && pr.mergeable === false && (
            <div className="flex items-center gap-1.5 text-destructive">
              <AlertCircle className="h-3 w-3" />
              <span>Conflicts</span>
            </div>
          )}
        </div>

        {/* Action buttons - only for open PRs */}
        {isOpen && !connected && (
          <div className="px-4 py-2.5 border-t border-border/50 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Install the GitHub App to take actions</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs ml-auto"
              onClick={() => { window.location.href = '/settings?tab=connected-accounts' }}
            >
              Install
            </Button>
          </div>
        )}
        {isOpen && connected && (
          <div className="px-4 py-2.5 border-t border-border/50 flex items-center gap-2 flex-wrap">
            {/* Approve */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={!!actionLoading || !!isOwnPr}
              title={isOwnPr ? "Cannot approve your own PR" : "Approve this PR"}
              onClick={() => {
                setReviewEvent("APPROVE")
                setReviewBody("")
                setReviewDialogOpen(true)
              }}
            >
              <Check className="h-3 w-3 text-success" />
              Approve
            </Button>

            {/* Request Changes */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={!!actionLoading}
              onClick={() => {
                setReviewEvent("REQUEST_CHANGES")
                setReviewBody("")
                setReviewDialogOpen(true)
              }}
            >
              <AlertCircle className="h-3 w-3 text-warning" />
              Request Changes
            </Button>

            {/* Comment */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={!!actionLoading}
              onClick={() => {
                setCommentBody("")
                setCommentDialogOpen(true)
              }}
            >
              <MessageSquare className="h-3 w-3" />
              Comment
            </Button>

            {/* Mark as Ready — only for draft PRs */}
            {isDraft && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={!!actionLoading}
                onClick={handleMarkReady}
              >
                {actionLoading === 'ready' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <GitPullRequest className="h-3 w-3" />
                )}
                Ready for Review
              </Button>
            )}

            {/* Close PR — only for open, non-merged PRs */}
            {!isMerged && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                disabled={!!actionLoading}
                onClick={() => setCloseDialogOpen(true)}
              >
                {actionLoading === 'close' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
                Close
              </Button>
            )}

            <div className="flex-1" />

            {/* Merge dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={!canMerge || !!actionLoading}
                  title={
                    !canMerge
                      ? isDraft ? "Cannot merge draft PR" :
                        pr.mergeable === false ? "PR has conflicts" :
                        failingChecks > 0 ? "Checks are failing" :
                        "Cannot merge"
                      : "Merge this PR"
                  }
                >
                  {actionLoading === 'merge' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <GitMerge className="h-3 w-3" />
                  )}
                  Merge
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">Merge method</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedMergeMethod("squash")
                    setMergeDialogOpen(true)
                  }}
                >
                  <div>
                    <div className="text-sm font-medium">Squash and merge</div>
                    <div className="text-xs text-muted-foreground">Combine all commits into one</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedMergeMethod("merge")
                    setMergeDialogOpen(true)
                  }}
                >
                  <div>
                    <div className="text-sm font-medium">Create a merge commit</div>
                    <div className="text-xs text-muted-foreground">All commits will be preserved</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedMergeMethod("rebase")
                    setMergeDialogOpen(true)
                  }}
                >
                  <div>
                    <div className="text-sm font-medium">Rebase and merge</div>
                    <div className="text-xs text-muted-foreground">Replay commits onto base</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* ── Merge Confirmation Dialog ──────────────────────────────────── */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Pull Request</DialogTitle>
            <DialogDescription>
              Are you sure you want to merge PR #{prNumber} using{" "}
              <span className="font-medium">{selectedMergeMethod}</span> strategy?
              {pr && (
                <span className="block mt-1 text-muted-foreground">
                  {pr.branch} → {pr.baseBranch} · {pr.diffStats.changedFiles} file{pr.diffStats.changedFiles !== 1 ? 's' : ''} ·{" "}
                  <span className="text-success">+{pr.diffStats.additions}</span>{" "}
                  <span className="text-destructive">-{pr.diffStats.deletions}</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMergeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={actionLoading === 'merge'}
              onClick={handleMerge}
            >
              {actionLoading === 'merge' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <GitMerge className="h-3.5 w-3.5 mr-1.5" />
              )}
              Merge PR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Close Confirmation Dialog ──────────────────────────────────── */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Pull Request</DialogTitle>
            <DialogDescription>
              Are you sure you want to close PR #{prNumber}? This will not delete the branch.
              {pr && (
                <span className="block mt-1 text-muted-foreground">
                  {pr.branch} → {pr.baseBranch}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCloseDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={actionLoading === 'close'}
              onClick={handleClose}
            >
              {actionLoading === 'close' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <X className="h-3.5 w-3.5 mr-1.5" />
              )}
              Close PR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Review Dialog ─────────────────────────────────────────────── */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewEvent === 'APPROVE' ? 'Approve PR' :
               reviewEvent === 'REQUEST_CHANGES' ? 'Request Changes' :
               'Submit Review Comment'}
            </DialogTitle>
            <DialogDescription>
              {reviewEvent === 'APPROVE'
                ? 'Approve this pull request. You can optionally add a comment.'
                : reviewEvent === 'REQUEST_CHANGES'
                ? 'Request changes on this pull request. A comment is required.'
                : 'Submit a review comment without approving or requesting changes.'}
            </DialogDescription>
          </DialogHeader>
          <textarea
            ref={textareaRef}
            aria-label="Review comment"
            className="w-full min-h-[100px] rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
            placeholder={
              reviewEvent === 'APPROVE' ? "Leave an optional comment..." :
              reviewEvent === 'REQUEST_CHANGES' ? "Describe what changes are needed..." :
              "Write your review comment..."
            }
            value={reviewBody}
            onChange={(e) => setReviewBody(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReviewDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={reviewEvent === 'APPROVE' ? 'default' : reviewEvent === 'REQUEST_CHANGES' ? 'destructive' : 'secondary'}
              disabled={
                actionLoading === 'review' ||
                (reviewEvent === 'REQUEST_CHANGES' && !reviewBody.trim())
              }
              onClick={handleReview}
            >
              {actionLoading === 'review' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : reviewEvent === 'APPROVE' ? (
                <Check className="h-3.5 w-3.5 mr-1.5" />
              ) : reviewEvent === 'REQUEST_CHANGES' ? (
                <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
              ) : (
                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
              )}
              {reviewEvent === 'APPROVE' ? 'Approve' :
               reviewEvent === 'REQUEST_CHANGES' ? 'Request Changes' :
               'Submit Comment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Comment Dialog ────────────────────────────────────────────── */}
      <Dialog open={commentDialogOpen} onOpenChange={setCommentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Comment on PR</DialogTitle>
            <DialogDescription>
              Post a comment on PR #{prNumber}.
            </DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="PR comment"
            className="w-full min-h-[100px] rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
            placeholder="Write your comment..."
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCommentDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={actionLoading === 'comment' || !commentBody.trim()}
              onClick={handleComment}
            >
              {actionLoading === 'comment' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
              )}
              Post Comment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
