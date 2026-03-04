/**
 * Shared PR utility types and functions.
 *
 * Used by both the read-only PrStatusCard (activity feed)
 * and the action-capable PrStatusCard (task detail page).
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface PrCheckRun {
  name: string
  status: "queued" | "in_progress" | "completed"
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped" | null
  startedAt?: string
  completedAt?: string
  htmlUrl?: string
}

export interface PrReview {
  user: {
    login: string
    avatarUrl?: string
  }
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING" | "DISMISSED"
  submittedAt?: string
}

export interface PrData {
  title: string
  number: number
  state: "open" | "closed" | "merged"
  htmlUrl: string
  branchName?: string
  baseBranch?: string
  additions?: number
  deletions?: number
  changedFiles?: number
  checks?: PrCheckRun[]
  reviews?: PrReview[]
  draft?: boolean
  mergeable?: boolean
  updatedAt?: string
}

// ─── Icon helpers ───────────────────────────────────────────────────

export function getCheckIcon(status: PrCheckRun["status"], conclusion: PrCheckRun["conclusion"]) {
  if (status !== "completed") {
    if (status === "in_progress") return { color: "text-warning", animate: true, label: "Running" }
    return { color: "text-muted-foreground", animate: false, label: "Queued" }
  }
  switch (conclusion) {
    case "success":
      return { color: "text-success", animate: false, label: "Passed" }
    case "failure":
      return { color: "text-error", animate: false, label: "Failed" }
    case "skipped":
    case "neutral":
      return { color: "text-muted-foreground", animate: false, label: conclusion === "skipped" ? "Skipped" : "Neutral" }
    case "cancelled":
    case "timed_out":
      return { color: "text-warning", animate: false, label: conclusion === "cancelled" ? "Cancelled" : "Timed out" }
    default:
      return { color: "text-muted-foreground", animate: false, label: "Pending" }
  }
}

export function getReviewStateLabel(state: PrReview["state"]): { color: string; label: string } {
  switch (state) {
    case "APPROVED":
      return { color: "text-success", label: "Approved" }
    case "CHANGES_REQUESTED":
      return { color: "text-error", label: "Changes requested" }
    case "COMMENTED":
      return { color: "text-muted-foreground", label: "Commented" }
    case "PENDING":
      return { color: "text-warning", label: "Pending review" }
    case "DISMISSED":
      return { color: "text-muted-foreground", label: "Dismissed" }
  }
}

// ─── Status aggregation ─────────────────────────────────────────────

export function getOverallCiStatus(checks: PrCheckRun[]): "success" | "failure" | "pending" | "none" {
  if (checks.length === 0) return "none"
  if (checks.some(c => c.conclusion === "failure")) return "failure"
  if (checks.some(c => c.status !== "completed")) return "pending"
  return "success"
}

export function getOverallReviewStatus(reviews: PrReview[]): "approved" | "changes_requested" | "pending" | "none" {
  if (reviews.length === 0) return "none"
  const latestByUser = deduplicateReviewsByUser(reviews)
  if (latestByUser.some(r => r.state === "CHANGES_REQUESTED")) return "changes_requested"
  if (latestByUser.some(r => r.state === "APPROVED")) return "approved"
  return "pending"
}

/**
 * Deduplicate reviews: keep only the latest review per user.
 */
export function deduplicateReviewsByUser(reviews: PrReview[]): PrReview[] {
  const latestByUser = new Map<string, PrReview>()
  for (const r of reviews) {
    const existing = latestByUser.get(r.user.login)
    if (!existing || (r.submittedAt && existing.submittedAt && r.submittedAt > existing.submittedAt)) {
      latestByUser.set(r.user.login, r)
    }
  }
  return Array.from(latestByUser.values())
}

export function formatCheckDuration(startedAt?: string, completedAt?: string): string | null {
  if (!startedAt || !completedAt) return null
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return "<1s"
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m${s > 0 ? ` ${s}s` : ""}`
}
