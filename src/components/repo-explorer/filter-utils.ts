import type { GitHubCachedIssue, GitHubCachedPr } from "@/types"

export type IssueStateFilter = "open" | "closed" | "all"
export type PrStateFilter = "open" | "closed" | "merged" | "all"
export type PrReviewFilter = "all" | "approved" | "changes_requested" | "reviewed" | "pending" | "none"
export type PrCiFilter = "all" | "success" | "failure" | "pending" | "none"

export interface IssueFilters {
  query: string
  state: IssueStateFilter
  label: string | null
  author: string | null
  assignee: string | null
}

export interface PrFilters {
  query: string
  state: PrStateFilter
  label: string | null
  author: string | null
  review: PrReviewFilter
  ci: PrCiFilter
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

function matchesQuery(
  query: string,
  values: Array<string | number | null | undefined>,
): boolean {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return true

  return values.some((value) => normalizeText(String(value ?? "")).includes(normalizedQuery))
}

export function filterIssues(
  issues: GitHubCachedIssue[],
  filters: IssueFilters,
): GitHubCachedIssue[] {
  return issues.filter((issue) => {
    if (filters.state !== "all" && issue.state !== filters.state) return false
    if (filters.label && !issue.labels.some((label) => label.name === filters.label)) return false
    if (filters.author && issue.authorLogin !== filters.author) return false
    if (filters.assignee && !issue.assignees.some((assignee) => assignee.login === filters.assignee)) return false

    return matchesQuery(filters.query, [
      issue.title,
      issue.issueNumber,
      issue.body,
      issue.authorLogin,
      ...issue.labels.map((label) => label.name),
      ...issue.assignees.map((assignee) => assignee.login),
    ])
  })
}

export function filterPullRequests(
  pullRequests: GitHubCachedPr[],
  filters: PrFilters,
): GitHubCachedPr[] {
  return pullRequests.filter((pr) => {
    if (filters.state !== "all" && pr.state !== filters.state) return false
    if (filters.label && !pr.labels.some((label) => label.name === filters.label)) return false
    if (filters.author && pr.authorLogin !== filters.author) return false
    if (filters.review !== "all" && (pr.reviewDecision ?? "none") !== filters.review) return false
    if (filters.ci !== "all" && (pr.ciStatus ?? "none") !== filters.ci) return false

    return matchesQuery(filters.query, [
      pr.title,
      pr.prNumber,
      pr.body,
      pr.authorLogin,
      pr.headBranch,
      pr.baseBranch,
      ...pr.labels.map((label) => label.name),
    ])
  })
}

export function getUniqueFilterValues(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))))
    .sort((a, b) => a.localeCompare(b))
}
