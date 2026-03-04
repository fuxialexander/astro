/**
 * PR Status Card — Displays pull request details inline in the activity feed.
 *
 * Shows PR title, branch, diff stats, CI check run statuses,
 * review status with reviewer avatars, and an "Open in GitHub" link.
 * Expandable section for CI check run details.
 * Action buttons: Approve & Merge, Request Changes.
 */

import { useState, useEffect, useCallback } from "react"
import {
  GitPullRequest,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Clock,
  Circle,
  Plus,
  Minus,
  FileText,
  Loader2,
  GitBranch,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  GitMerge,
  MessageSquareWarning,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { PlanNode } from "@/types"
import { apiUrl } from "@/lib/api-url"
import { authHeaders } from "@/lib/auth-headers"
import {
  type PrCheckRun,
  type PrReview,
  type PrData,
  getCheckIcon,
  getReviewStateLabel,
  getOverallCiStatus,
  getOverallReviewStatus,
  deduplicateReviewsByUser,
  formatCheckDuration,
} from "@/lib/github-pr-utils"

// Re-export types for consumers that import from this file
export type { PrCheckRun, PrReview, PrData }

// ─── Component ──────────────────────────────────────────────────────

interface PrStatusCardProps {
  node: PlanNode
  /** Pre-loaded PR data (from githubPrData or webhook updates) */
  prData?: PrData | null
  /** Owner/repo for fallback API fetch */
  owner?: string
  repo?: string
  className?: string
  /** Enable action buttons (approve/merge/request changes) */
  showActions?: boolean
  /** Number of review comments to display as a link */
  reviewCommentCount?: number
  /** Callback when user clicks the review comments link */
  onReviewCommentsClick?: () => void
}

export function PrStatusCard({ node, prData: externalPrData, owner, repo, className, showActions = true, reviewCommentCount, onReviewCommentsClick }: PrStatusCardProps) {
  const [prData, setPrData] = useState<PrData | null>(externalPrData ?? null)
  const [checksExpanded, setChecksExpanded] = useState(false)
  const [loading, setLoading] = useState(false)

  // Action state
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [showRequestChanges, setShowRequestChanges] = useState(false)
  const [requestChangesBody, setRequestChangesBody] = useState("")

  // Use external data when it changes (e.g., from webhook updates)
  useEffect(() => {
    if (externalPrData) {
      setPrData(externalPrData)
    }
  }, [externalPrData])

  // Fallback: fetch PR data from API if not provided and node has prNumber
  const fetchPrData = useCallback(async () => {
    if (!node.prNumber || !owner || !repo) return
    if (prData) return // Already have data

    setLoading(true)
    try {
      const [detailsRes, checksRes, reviewsRes] = await Promise.allSettled([
        fetch(apiUrl(`/api/github/pr/${owner}/${repo}/${node.prNumber}`)),
        fetch(apiUrl(`/api/github/pr/${owner}/${repo}/${node.prNumber}/checks`)),
        fetch(apiUrl(`/api/github/pr/${owner}/${repo}/${node.prNumber}/reviews`)),
      ])

      let details: Partial<PrData> = {}
      let checks: PrCheckRun[] = []
      let reviews: PrReview[] = []

      if (detailsRes.status === "fulfilled" && detailsRes.value.ok) {
        details = await detailsRes.value.json()
      }
      if (checksRes.status === "fulfilled" && checksRes.value.ok) {
        const data = await checksRes.value.json()
        checks = data.checks ?? data ?? []
      }
      if (reviewsRes.status === "fulfilled" && reviewsRes.value.ok) {
        const data = await reviewsRes.value.json()
        reviews = data.reviews ?? data ?? []
      }

      setPrData({
        title: details.title || node.title || `PR #${node.prNumber}`,
        number: node.prNumber,
        state: details.state || "open",
        htmlUrl: details.htmlUrl || node.prUrl || `https://github.com/${owner}/${repo}/pull/${node.prNumber}`,
        branchName: details.branchName || node.branchName,
        baseBranch: details.baseBranch,
        additions: details.additions,
        deletions: details.deletions,
        changedFiles: details.changedFiles,
        checks,
        reviews,
        draft: details.draft,
        mergeable: details.mergeable,
        updatedAt: details.updatedAt,
      })
    } catch {
      // Failed to fetch — show minimal card from node data
      setPrData({
        title: node.title || `PR #${node.prNumber}`,
        number: node.prNumber,
        state: "open",
        htmlUrl: node.prUrl || `https://github.com/${owner}/${repo}/pull/${node.prNumber}`,
        branchName: node.branchName,
        checks: [],
        reviews: [],
      })
    } finally {
      setLoading(false)
    }
  }, [node.prNumber, node.prUrl, node.branchName, node.title, owner, repo, prData])

  useEffect(() => {
    if (!prData && node.prNumber) {
      fetchPrData()
    }
  }, [prData, node.prNumber, fetchPrData])

  // ─── Action handlers ──────────────────────────────────────────────

  const handleApproveAndMerge = useCallback(async () => {
    if (!owner || !repo || !prData?.number) return
    setActionLoading("merge")
    setActionError(null)
    setActionSuccess(null)

    try {
      // Step 1: Submit APPROVE review
      const reviewRes = await fetch(
        apiUrl(`/api/github/pr/${owner}/${repo}/${prData.number}/review`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ event: "APPROVE", body: "Approved via Astro" }),
        },
      )

      if (!reviewRes.ok) {
        const data = await reviewRes.json().catch(() => ({ error: "Failed to approve" }))
        throw new Error(data.error || `Approve failed: ${reviewRes.status}`)
      }

      // Step 2: Merge the PR
      const mergeRes = await fetch(
        apiUrl(`/api/github/pr/${owner}/${repo}/${prData.number}/merge`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ mergeMethod: "squash" }),
        },
      )

      const mergeData = await mergeRes.json().catch(() => ({ success: false, error: "Unknown error" }))

      if (!mergeRes.ok || !mergeData.success) {
        const error = mergeData.error || `Merge failed: ${mergeRes.status}`
        // Check for specific merge failure reasons
        if (error.includes("conflict")) {
          throw new Error("PR has merge conflicts. Resolve conflicts before merging.")
        }
        if (error.includes("not open") || error.includes("cannot merge")) {
          throw new Error(error)
        }
        throw new Error(error)
      }

      setActionSuccess("PR approved and merged!")
      setPrData((prev) => prev ? { ...prev, state: "merged" } : prev)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to merge")
    } finally {
      setActionLoading(null)
    }
  }, [owner, repo, prData?.number])

  const handleRequestChanges = useCallback(async () => {
    if (!owner || !repo || !prData?.number || !requestChangesBody.trim()) return
    setActionLoading("request_changes")
    setActionError(null)
    setActionSuccess(null)

    try {
      const res = await fetch(
        apiUrl(`/api/github/pr/${owner}/${repo}/${prData.number}/review`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({
            event: "REQUEST_CHANGES",
            body: requestChangesBody.trim(),
          }),
        },
      )

      const data = await res.json().catch(() => ({ success: false, error: "Unknown error" }))

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request changes failed: ${res.status}`)
      }

      setActionSuccess("Changes requested")
      setShowRequestChanges(false)
      setRequestChangesBody("")
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to request changes")
    } finally {
      setActionLoading(null)
    }
  }, [owner, repo, prData?.number, requestChangesBody])

  // Show subtle empty state when no PR is linked
  if (!prData && !node.prNumber) {
    return (
      <div className={cn("mx-4 my-2 rounded-lg border border-dashed border-border/60 bg-card/30 p-3", className)}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <GitPullRequest className="h-3.5 w-3.5 shrink-0" />
          <span>No pull request linked</span>
        </div>
      </div>
    )
  }

  // Loading state
  if (loading && !prData) {
    return (
      <div className={cn("mx-4 my-2 rounded-lg border border-border bg-card/50 p-3", className)}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Loading PR details...</span>
        </div>
      </div>
    )
  }

  if (!prData) return null

  const checks = prData.checks || []
  const reviews = prData.reviews || []
  const ciStatus = getOverallCiStatus(checks)
  const reviewStatus = getOverallReviewStatus(reviews)

  const uniqueReviews = deduplicateReviewsByUser(reviews)

  const isOpen = prData.state === "open"
  const canMerge = isOpen && !prData.draft
  const hasPendingChecks = ciStatus === "pending"
  const hasFailedChecks = ciStatus === "failure"
  const isMergeable = prData.mergeable !== false // default to true if unknown

  return (
    <div className={cn("mx-4 my-2 rounded-lg border border-border bg-card/50 overflow-hidden", className)}>
      {/* Header: PR icon, title, number, state badge */}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <GitPullRequest className={cn(
          "h-4 w-4 mt-0.5 shrink-0",
          prData.state === "merged" ? "text-purple-500" :
          prData.state === "closed" ? "text-error" :
          prData.draft ? "text-muted-foreground" :
          "text-success"
        )} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium leading-tight truncate">{prData.title}</span>
            <span className="text-xs text-muted-foreground font-mono shrink-0">#{prData.number}</span>
            {prData.draft && (
              <Badge variant="secondary" className="text-[9px] py-0 px-1.5">Draft</Badge>
            )}
            {prData.state === "merged" && (
              <Badge variant="success" className="text-[9px] py-0 px-1.5">Merged</Badge>
            )}
            {prData.state === "closed" && (
              <Badge variant="destructive" className="text-[9px] py-0 px-1.5">Closed</Badge>
            )}
          </div>

          {/* Branch info */}
          {prData.branchName && (
            <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="font-mono truncate">{prData.branchName}</span>
              {prData.baseBranch && (
                <>
                  <span className="shrink-0">&rarr;</span>
                  <span className="font-mono shrink-0">{prData.baseBranch}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Open in GitHub button */}
        <a
          href={prData.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
        >
          <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ExternalLink className="h-3 w-3" />
            GitHub
          </Button>
        </a>
      </div>

      {/* Stats row: diff stats + CI status + review status */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-border/50 bg-muted/20 flex-wrap">
        {/* Diff stats */}
        {(prData.additions != null || prData.deletions != null || prData.changedFiles != null) && (
          <div className="flex items-center gap-2 text-xs">
            {prData.additions != null && (
              <span className="flex items-center gap-0.5 text-success font-mono">
                <Plus className="h-3 w-3" />{prData.additions}
              </span>
            )}
            {prData.deletions != null && (
              <span className="flex items-center gap-0.5 text-error font-mono">
                <Minus className="h-3 w-3" />{prData.deletions}
              </span>
            )}
            {prData.changedFiles != null && (
              <span className="flex items-center gap-0.5 text-muted-foreground">
                <FileText className="h-3 w-3" />{prData.changedFiles} file{prData.changedFiles !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        {/* Spacer */}
        {(prData.additions != null || prData.deletions != null || prData.changedFiles != null) && (checks.length > 0 || uniqueReviews.length > 0) && (
          <div className="h-3 w-px bg-border shrink-0" />
        )}

        {/* CI Status */}
        {checks.length > 0 && (
          <button
            onClick={() => setChecksExpanded(!checksExpanded)}
            className="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-muted/50 rounded px-1.5 py-0.5 -mx-1.5 -my-0.5 transition-colors"
          >
            {ciStatus === "success" && <Check className="h-3 w-3 text-success" />}
            {ciStatus === "failure" && <X className="h-3 w-3 text-error" />}
            {ciStatus === "pending" && <Loader2 className="h-3 w-3 text-warning animate-spin" />}
            <span className={cn(
              "font-medium",
              ciStatus === "success" ? "text-success" :
              ciStatus === "failure" ? "text-error" :
              "text-warning"
            )}>
              {checks.filter(c => c.conclusion === "success").length}/{checks.length} checks
            </span>
            {checksExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </button>
        )}

        {/* Review Status */}
        {uniqueReviews.length > 0 && (
          <div className="flex items-center gap-1.5">
            {reviewStatus === "approved" && <ShieldCheck className="h-3 w-3 text-success" />}
            {reviewStatus === "changes_requested" && <ShieldAlert className="h-3 w-3 text-error" />}
            {reviewStatus === "pending" && <ShieldQuestion className="h-3 w-3 text-muted-foreground" />}

            {/* Reviewer avatars */}
            <div className="flex items-center -space-x-1">
              {uniqueReviews.slice(0, 4).map((review) => (
                <Tooltip key={review.user.login}>
                  <TooltipTrigger asChild>
                    <div className={cn(
                      "relative h-5 w-5 rounded-full border-2 overflow-hidden",
                      review.state === "APPROVED" ? "border-success" :
                      review.state === "CHANGES_REQUESTED" ? "border-error" :
                      "border-muted"
                    )}>
                      {review.user.avatarUrl ? (
                        <img
                          src={review.user.avatarUrl}
                          alt={review.user.login}
                          className="h-full w-full rounded-full"
                        />
                      ) : (
                        <div className="h-full w-full bg-muted flex items-center justify-center text-[8px] font-medium text-muted-foreground">
                          {review.user.login.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span>{review.user.login}: {getReviewStateLabel(review.state).label}</span>
                  </TooltipContent>
                </Tooltip>
              ))}
              {uniqueReviews.length > 4 && (
                <span className="text-[10px] text-muted-foreground ml-1.5">+{uniqueReviews.length - 4}</span>
              )}
            </div>
          </div>
        )}

        {/* Review comments link */}
        {reviewCommentCount != null && reviewCommentCount > 0 && (
          <>
            {(checks.length > 0 || uniqueReviews.length > 0) && (
              <div className="h-3 w-px bg-border shrink-0" />
            )}
            <button
              onClick={onReviewCommentsClick}
              className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
            >
              <MessageSquareWarning className="h-3 w-3" />
              <span className="font-medium">
                {reviewCommentCount} review comment{reviewCommentCount !== 1 ? "s" : ""}
              </span>
            </button>
          </>
        )}
      </div>

      {/* Expandable CI check runs */}
      {checksExpanded && checks.length > 0 && (
        <div className="border-t border-border/50 bg-muted/10 px-3 py-2 space-y-1">
          {checks.map((check) => {
            const status = getCheckIcon(check.status, check.conclusion)
            const StatusIcon = status.label === "Running" ? Loader2 :
              status.label === "Queued" || status.label === "Pending" ? Clock :
              status.label === "Passed" ? Check :
              status.label === "Skipped" || status.label === "Neutral" ? Circle : X
            const duration = formatCheckDuration(check.startedAt, check.completedAt)

            return (
              <div key={check.name || check.htmlUrl} className="flex items-center gap-2 text-xs py-0.5">
                <StatusIcon className={cn("h-3 w-3 shrink-0", status.color, status.animate && "animate-spin")} />
                <span className="font-mono truncate flex-1 text-foreground/80">
                  {check.name}
                </span>
                {duration && (
                  <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
                    {duration}
                  </span>
                )}
                <span className={cn("text-[10px] shrink-0", status.color)}>
                  {status.label}
                </span>
                {check.htmlUrl && (
                  <a
                    href={check.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                  >
                    <ExternalLink className="h-3 w-3 text-muted-foreground/50 hover:text-foreground transition-colors" />
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Action buttons — only for open PRs with owner/repo context */}
      {showActions && canMerge && owner && repo && (
        <div className="border-t border-border/50 px-3 py-2">
          {/* Merge warnings */}
          {(hasPendingChecks || hasFailedChecks || !isMergeable) && (
            <div className="flex flex-wrap gap-2 mb-2">
              {!isMergeable && (
                <div className="flex items-center gap-1 text-[10px] text-error">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Merge conflicts detected</span>
                </div>
              )}
              {hasFailedChecks && (
                <div className="flex items-center gap-1 text-[10px] text-error">
                  <X className="h-3 w-3" />
                  <span>CI checks failed</span>
                </div>
              )}
              {hasPendingChecks && !hasFailedChecks && (
                <div className="flex items-center gap-1 text-[10px] text-warning">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Checks still running</span>
                </div>
              )}
            </div>
          )}

          {/* Action feedback */}
          {actionError && (
            <div className="flex items-center gap-1.5 text-[11px] text-error mb-2 px-2 py-1.5 rounded bg-error/10 border border-error/20">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>{actionError}</span>
              <button onClick={() => setActionError(null)} className="ml-auto text-error/70 hover:text-error cursor-pointer">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {actionSuccess && (
            <div className="flex items-center gap-1.5 text-[11px] text-success mb-2 px-2 py-1.5 rounded bg-success/10 border border-success/20">
              <Check className="h-3 w-3 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
          )}

          {/* Request changes form */}
          {showRequestChanges && (
            <div className="mb-2 space-y-2">
              <textarea
                value={requestChangesBody}
                onChange={(e) => setRequestChangesBody(e.target.value)}
                placeholder="Describe the changes you'd like..."
                rows={3}
                disabled={actionLoading === "request_changes"}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleRequestChanges()
                  }
                  if (e.key === "Escape") {
                    setShowRequestChanges(false)
                    setRequestChangesBody("")
                  }
                }}
              />
              <div className="flex items-center gap-1.5 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setShowRequestChanges(false)
                    setRequestChangesBody("")
                  }}
                  disabled={actionLoading === "request_changes"}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={handleRequestChanges}
                  disabled={!requestChangesBody.trim() || actionLoading === "request_changes"}
                >
                  {actionLoading === "request_changes" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <MessageSquareWarning className="h-3 w-3" />
                  )}
                  Submit Review
                </Button>
              </div>
            </div>
          )}

          {/* Action buttons row */}
          {!showRequestChanges && !actionSuccess && (
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 text-xs gap-1.5 bg-success hover:bg-success/90 text-white"
                    onClick={handleApproveAndMerge}
                    disabled={!!actionLoading || !isMergeable}
                  >
                    {actionLoading === "merge" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <GitMerge className="h-3 w-3" />
                    )}
                    Approve & Merge
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {!isMergeable
                    ? "Cannot merge: resolve conflicts first"
                    : hasFailedChecks
                      ? "Warning: CI checks have failed"
                      : hasPendingChecks
                        ? "Warning: checks are still running"
                        : "Approve and squash-merge this PR"}
                </TooltipContent>
              </Tooltip>

              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 text-error border-error/30 hover:bg-error/10 hover:text-error"
                onClick={() => setShowRequestChanges(true)}
                disabled={!!actionLoading}
              >
                <MessageSquareWarning className="h-3 w-3" />
                Request Changes
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
