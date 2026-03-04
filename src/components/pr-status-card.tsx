/**
 * PR Status Card — Displays pull request details inline in the activity feed.
 *
 * Shows PR title, branch, diff stats, CI check run statuses,
 * review status with reviewer avatars, and an "Open in GitHub" link.
 * Expandable section for CI check run details.
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { PlanNode } from "@/types"
import { apiUrl } from "@/lib/api-url"
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
}

export function PrStatusCard({ node, prData: externalPrData, owner, repo, className }: PrStatusCardProps) {
  const [prData, setPrData] = useState<PrData | null>(externalPrData ?? null)
  const [checksExpanded, setChecksExpanded] = useState(false)
  const [loading, setLoading] = useState(false)

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
    </div>
  )
}
