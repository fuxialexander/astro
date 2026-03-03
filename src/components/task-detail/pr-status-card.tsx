/**
 * PrStatusCard — Compact PR status display for the task activity feed.
 *
 * Shows PR title, branch, diff stats, CI check status badges,
 * reviewer avatars with approval state, and an "Open in GitHub" escape hatch.
 * Expandable section for CI check run details.
 */

import { useState, useEffect, useCallback } from "react"
import {
  GitPullRequest,
  GitMerge,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  CircleDot,
  GitBranch,
  Plus,
  Minus,
  FileText,
  Loader2,
  RefreshCw,
  MessageSquare,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  PlanNode,
  GithubPrData,
  GithubCheckRun,
  GithubReview,
} from "@/types"
import { fetchPrDetails, fetchPrChecks, fetchPrReviews } from "@/lib/api-client"

// ─── Helpers ────────────────────────────────────────────────────────

function formatDuration(startedAt?: string, completedAt?: string): string | null {
  if (!startedAt || !completedAt) return null
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return "<1s"
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function getCheckIcon(status: GithubCheckRun["status"], conclusion: GithubCheckRun["conclusion"]) {
  if (status !== "completed") {
    if (status === "in_progress") return { icon: Loader2, color: "text-warning", animate: true }
    return { icon: Clock, color: "text-muted-foreground", animate: false }
  }
  switch (conclusion) {
    case "success":
      return { icon: CheckCircle2, color: "text-success", animate: false }
    case "failure":
    case "timed_out":
      return { icon: XCircle, color: "text-error", animate: false }
    case "cancelled":
    case "skipped":
      return { icon: CircleDot, color: "text-muted-foreground", animate: false }
    default:
      return { icon: CircleDot, color: "text-warning", animate: false }
  }
}

function getOverallCheckStatus(checks: GithubCheckRun[]): "success" | "failure" | "pending" | "none" {
  if (checks.length === 0) return "none"
  const hasFailure = checks.some(
    (c) => c.status === "completed" && (c.conclusion === "failure" || c.conclusion === "timed_out")
  )
  if (hasFailure) return "failure"
  const allPassed = checks.every(
    (c) => c.status === "completed" && (c.conclusion === "success" || c.conclusion === "skipped" || c.conclusion === "neutral")
  )
  if (allPassed) return "success"
  return "pending"
}

function getReviewIcon(state: GithubReview["state"]) {
  switch (state) {
    case "APPROVED":
      return { icon: CheckCircle2, color: "text-success" }
    case "CHANGES_REQUESTED":
      return { icon: XCircle, color: "text-error" }
    case "COMMENTED":
      return { icon: MessageSquare, color: "text-muted-foreground" }
    case "PENDING":
      return { icon: Clock, color: "text-muted-foreground" }
    case "DISMISSED":
      return { icon: CircleDot, color: "text-muted-foreground" }
    default:
      return { icon: CircleDot, color: "text-muted-foreground" }
  }
}

function getOverallReviewStatus(reviews: GithubReview[]): "approved" | "changes_requested" | "pending" | "none" {
  if (reviews.length === 0) return "none"
  const hasChangesRequested = reviews.some((r) => r.state === "CHANGES_REQUESTED")
  if (hasChangesRequested) return "changes_requested"
  const hasApproved = reviews.some((r) => r.state === "APPROVED")
  if (hasApproved) return "approved"
  return "pending"
}

// ─── Props ──────────────────────────────────────────────────────────

interface PrStatusCardProps {
  node: PlanNode
  owner?: string
  repo?: string
}

// ─── Component ──────────────────────────────────────────────────────

export function PrStatusCard({ node, owner, repo }: PrStatusCardProps) {
  const [checksExpanded, setChecksExpanded] = useState(false)
  const [prData, setPrData] = useState<GithubPrData | null>(node.githubPrData ?? null)
  const [checks, setChecks] = useState<GithubCheckRun[]>(node.githubPrData?.checks ?? [])
  const [reviews, setReviews] = useState<GithubReview[]>(node.githubPrData?.reviews ?? [])
  const [loading, setLoading] = useState(false)

  // Derive owner/repo from prUrl if not provided
  const resolvedOwnerRepo = useResolvedOwnerRepo(owner, repo, node.prUrl)

  // Fetch PR data on mount if stale/missing
  const refreshPrData = useCallback(async () => {
    if (!resolvedOwnerRepo || !node.prNumber) return
    setLoading(true)
    try {
      const [details, checkRuns, reviewList] = await Promise.all([
        fetchPrDetails(resolvedOwnerRepo.owner, resolvedOwnerRepo.repo, node.prNumber),
        fetchPrChecks(resolvedOwnerRepo.owner, resolvedOwnerRepo.repo, node.prNumber),
        fetchPrReviews(resolvedOwnerRepo.owner, resolvedOwnerRepo.repo, node.prNumber),
      ])
      if (details) setPrData(details)
      setChecks(checkRuns)
      setReviews(reviewList)
    } catch {
      // Silently fail — we still have cached data
    } finally {
      setLoading(false)
    }
  }, [resolvedOwnerRepo, node.prNumber])

  useEffect(() => {
    // Auto-fetch if no cached data or data is stale (> 2 minutes old)
    const isStale = prData?.updatedAt
      ? Date.now() - new Date(prData.updatedAt).getTime() > 2 * 60 * 1000
      : true
    if (isStale && resolvedOwnerRepo && node.prNumber) {
      refreshPrData()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.prNumber, resolvedOwnerRepo?.owner, resolvedOwnerRepo?.repo])

  // Update from node prop changes (webhook updates)
  useEffect(() => {
    if (node.githubPrData) {
      setPrData(node.githubPrData)
      if (node.githubPrData.checks) setChecks(node.githubPrData.checks)
      if (node.githubPrData.reviews) setReviews(node.githubPrData.reviews)
    }
  }, [node.githubPrData])

  if (!node.prNumber) return null

  const prTitle = prData?.title || `PR #${node.prNumber}`
  const prState = prData?.state ?? (node.mergeQueueStatus === "merged" ? "merged" : "open")
  const branchName = prData?.headRef || node.branchName
  const additions = prData?.additions
  const deletions = prData?.deletions
  const changedFiles = prData?.changedFiles
  const overallCheckStatus = getOverallCheckStatus(checks)
  const overallReviewStatus = getOverallReviewStatus(reviews)

  // Card border color based on PR state
  const borderColor = prState === "merged"
    ? "border-purple-500/30"
    : prState === "closed"
      ? "border-error/30"
      : overallCheckStatus === "failure"
        ? "border-error/30"
        : overallCheckStatus === "success"
          ? "border-success/30"
          : "border-border"

  const bgColor = prState === "merged"
    ? "bg-purple-500/5"
    : prState === "closed"
      ? "bg-error/5"
      : "bg-card"

  return (
    <div className={cn("mx-4 my-2 rounded-lg border p-3", borderColor, bgColor)}>
      {/* Header: PR icon + title + state badge */}
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {prState === "merged" ? (
            <GitMerge className="h-4 w-4 text-purple-500" />
          ) : (
            <GitPullRequest className={cn("h-4 w-4", prState === "closed" ? "text-error" : "text-success")} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold truncate">{prTitle}</span>
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
              prState === "merged"
                ? "bg-purple-500/10 text-purple-500"
                : prState === "closed"
                  ? "bg-error/10 text-error"
                  : prData?.draft
                    ? "bg-muted text-muted-foreground"
                    : "bg-success/10 text-success"
            )}>
              {prData?.draft ? "draft" : prState}
            </span>
            <span className="text-[10px] text-muted-foreground">
              #{node.prNumber}
            </span>
            {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>

          {/* Branch name */}
          {branchName && (
            <div className="flex items-center gap-1 mt-1">
              <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[10px] font-mono text-muted-foreground truncate">
                {branchName}
                {prData?.baseRef && (
                  <> &larr; {prData.baseRef}</>
                )}
              </span>
            </div>
          )}

          {/* Diff stats + status summary row */}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {/* Diff stats */}
            {(additions != null || deletions != null || changedFiles != null) && (
              <div className="flex items-center gap-2 text-[10px] font-mono">
                {additions != null && (
                  <span className="flex items-center gap-0.5 text-success">
                    <Plus className="h-2.5 w-2.5" />{additions}
                  </span>
                )}
                {deletions != null && (
                  <span className="flex items-center gap-0.5 text-error">
                    <Minus className="h-2.5 w-2.5" />{deletions}
                  </span>
                )}
                {changedFiles != null && (
                  <span className="flex items-center gap-0.5 text-muted-foreground">
                    <FileText className="h-2.5 w-2.5" />{changedFiles} file{changedFiles !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}

            {/* CI status summary */}
            {checks.length > 0 && (
              <CiStatusSummary checks={checks} status={overallCheckStatus} />
            )}

            {/* Review status summary */}
            {reviews.length > 0 && (
              <ReviewStatusSummary reviews={reviews} status={overallReviewStatus} />
            )}
          </div>

          {/* Reviewer avatars */}
          {reviews.length > 0 && (
            <div className="flex items-center gap-1 mt-2">
              {reviews.map((review) => (
                <ReviewerAvatar key={review.user} review={review} />
              ))}
            </div>
          )}

          {/* CI checks expandable */}
          {checks.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setChecksExpanded(!checksExpanded)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                {checksExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span>{checks.length} check{checks.length !== 1 ? "s" : ""}</span>
              </button>

              {checksExpanded && (
                <div className="mt-1 ml-1 space-y-0.5">
                  {checks.map((check) => (
                    <CheckRunRow key={check.id} check={check} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {resolvedOwnerRepo && (
            <button
              onClick={refreshPrData}
              disabled={loading}
              className="p-1 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
              title="Refresh PR data"
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            </button>
          )}
          {node.prUrl && (
            <a
              href={node.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Open in GitHub"
            >
              <ExternalLink className="h-3 w-3" />
              GitHub
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function CiStatusSummary({
  checks,
  status,
}: {
  checks: GithubCheckRun[]
  status: "success" | "failure" | "pending" | "none"
}) {
  const passed = checks.filter(
    (c) => c.status === "completed" && (c.conclusion === "success" || c.conclusion === "skipped" || c.conclusion === "neutral")
  ).length
  const failed = checks.filter(
    (c) => c.status === "completed" && (c.conclusion === "failure" || c.conclusion === "timed_out")
  ).length
  const pending = checks.filter((c) => c.status !== "completed").length

  const color = status === "success"
    ? "text-success"
    : status === "failure"
      ? "text-error"
      : "text-warning"

  const Icon = status === "success"
    ? CheckCircle2
    : status === "failure"
      ? XCircle
      : Clock

  return (
    <div className={cn("flex items-center gap-1 text-[10px]", color)}>
      <Icon className="h-3 w-3" />
      <span>
        {status === "success" && `${passed}/${checks.length} passed`}
        {status === "failure" && `${failed} failed`}
        {status === "pending" && `${pending} pending`}
      </span>
    </div>
  )
}

function ReviewStatusSummary({
  reviews,
  status,
}: {
  reviews: GithubReview[]
  status: "approved" | "changes_requested" | "pending" | "none"
}) {
  const color = status === "approved"
    ? "text-success"
    : status === "changes_requested"
      ? "text-error"
      : "text-muted-foreground"

  const label = status === "approved"
    ? "Approved"
    : status === "changes_requested"
      ? "Changes requested"
      : `${reviews.length} review${reviews.length !== 1 ? "s" : ""}`

  return (
    <div className={cn("flex items-center gap-1 text-[10px]", color)}>
      {status === "approved" && <CheckCircle2 className="h-3 w-3" />}
      {status === "changes_requested" && <XCircle className="h-3 w-3" />}
      {status === "pending" && <MessageSquare className="h-3 w-3" />}
      <span>{label}</span>
    </div>
  )
}

function ReviewerAvatar({ review }: { review: GithubReview }) {
  const { icon: StatusIcon, color } = getReviewIcon(review.state)

  return (
    <div className="relative group" title={`${review.user}: ${review.state.toLowerCase().replace("_", " ")}`}>
      {review.avatarUrl ? (
        <img
          src={review.avatarUrl}
          alt={review.user}
          className="h-5 w-5 rounded-full border border-border"
        />
      ) : (
        <div className="h-5 w-5 rounded-full bg-muted border border-border flex items-center justify-center">
          <span className="text-[8px] font-medium text-muted-foreground">
            {review.user[0]?.toUpperCase()}
          </span>
        </div>
      )}
      <div className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-background flex items-center justify-center", color)}>
        <StatusIcon className="h-2 w-2" />
      </div>
    </div>
  )
}

function CheckRunRow({ check }: { check: GithubCheckRun }) {
  const { icon: StatusIcon, color, animate } = getCheckIcon(check.status, check.conclusion)
  const duration = formatDuration(check.startedAt, check.completedAt)

  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-muted/30 transition-colors">
      <div className={cn("shrink-0", color)}>
        <StatusIcon className={cn("h-3 w-3", animate && "animate-spin")} />
      </div>
      <span className="text-[10px] font-mono truncate flex-1 text-foreground/80">
        {check.name}
      </span>
      {duration && (
        <span className="text-[9px] text-muted-foreground/60 tabular-nums shrink-0">
          {duration}
        </span>
      )}
      {check.detailsUrl && (
        <a
          href={check.detailsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground/60 hover:text-foreground shrink-0"
          title="View check details"
        >
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </div>
  )
}

// ─── Hook: resolve owner/repo from PR URL ───────────────────────────

function useResolvedOwnerRepo(
  owner?: string,
  repo?: string,
  prUrl?: string,
): { owner: string; repo: string } | null {
  if (owner && repo) return { owner, repo }

  // Parse from prUrl: https://github.com/{owner}/{repo}/pull/{number}
  if (prUrl) {
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull/)
    if (match) return { owner: match[1], repo: match[2] }
  }

  return null
}
