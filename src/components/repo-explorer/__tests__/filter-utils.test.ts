import { describe, expect, it } from "vitest"
import type { GitHubCachedIssue, GitHubCachedPr } from "@/types"
import { filterIssues, filterPullRequests, getUniqueFilterValues } from "../filter-utils"

const issues: GitHubCachedIssue[] = [
  {
    id: "issue-1",
    projectId: "project-1",
    issueNumber: 11,
    title: "Open bug",
    body: "Needs a fix",
    state: "open",
    url: "https://example.com/issues/11",
    authorLogin: "alice",
    labels: [{ name: "bug", color: "ff0000" }],
    assignees: [{ login: "bob" }],
    commentsCount: 2,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    updatedAt: new Date("2026-03-02T00:00:00Z"),
    closedAt: null,
    cachedAt: new Date("2026-03-02T00:00:00Z"),
  },
  {
    id: "issue-2",
    projectId: "project-1",
    issueNumber: 12,
    title: "Closed task",
    body: "Already handled",
    state: "closed",
    url: "https://example.com/issues/12",
    authorLogin: "carol",
    labels: [{ name: "docs", color: "0000ff" }],
    assignees: [],
    commentsCount: 0,
    createdAt: new Date("2026-03-03T00:00:00Z"),
    updatedAt: new Date("2026-03-04T00:00:00Z"),
    closedAt: new Date("2026-03-04T00:00:00Z"),
    cachedAt: new Date("2026-03-04T00:00:00Z"),
  },
]

const pullRequests: GitHubCachedPr[] = [
  {
    id: "pr-1",
    projectId: "project-1",
    prNumber: 21,
    title: "Open PR",
    body: "Touches auth",
    state: "open",
    url: "https://example.com/pull/21",
    authorLogin: "alice",
    headBranch: "feature/auth",
    baseBranch: "main",
    labels: [{ name: "backend", color: "00ff00" }],
    ciStatus: "failure",
    reviewDecision: "changes_requested",
    mergeableState: "conflicting",
    additions: 10,
    deletions: 4,
    changedFiles: 2,
    commentsCount: 1,
    draft: false,
    createdAt: new Date("2026-03-05T00:00:00Z"),
    updatedAt: new Date("2026-03-06T00:00:00Z"),
    mergedAt: null,
    closedAt: null,
    cachedAt: new Date("2026-03-06T00:00:00Z"),
  },
  {
    id: "pr-2",
    projectId: "project-1",
    prNumber: 22,
    title: "Merged PR",
    body: "Already landed",
    state: "merged",
    url: "https://example.com/pull/22",
    authorLogin: "dana",
    headBranch: "feature/docs",
    baseBranch: "main",
    labels: [{ name: "docs", color: "0000ff" }],
    ciStatus: "success",
    reviewDecision: "approved",
    mergeableState: "mergeable",
    additions: 2,
    deletions: 1,
    changedFiles: 1,
    commentsCount: 0,
    draft: false,
    createdAt: new Date("2026-03-07T00:00:00Z"),
    updatedAt: new Date("2026-03-08T00:00:00Z"),
    mergedAt: new Date("2026-03-08T00:00:00Z"),
    closedAt: new Date("2026-03-08T00:00:00Z"),
    cachedAt: new Date("2026-03-08T00:00:00Z"),
  },
]

describe("repo explorer filter helpers", () => {
  it("defaults issues to open-only when state filter is open", () => {
    const filtered = filterIssues(issues, {
      query: "",
      state: "open",
      label: null,
      author: null,
      assignee: null,
    })

    expect(filtered.map((issue) => issue.issueNumber)).toEqual([11])
  })

  it("filters issues by assignee and label", () => {
    const filtered = filterIssues(issues, {
      query: "",
      state: "all",
      label: "bug",
      author: null,
      assignee: "bob",
    })

    expect(filtered.map((issue) => issue.issueNumber)).toEqual([11])
  })

  it("defaults pull requests to open-only and excludes merged PRs", () => {
    const filtered = filterPullRequests(pullRequests, {
      query: "",
      state: "open",
      label: null,
      author: null,
      review: "all",
      ci: "all",
    })

    expect(filtered.map((pr) => pr.prNumber)).toEqual([21])
  })

  it("filters pull requests by review state and CI status", () => {
    const filtered = filterPullRequests(pullRequests, {
      query: "auth",
      state: "all",
      label: null,
      author: "alice",
      review: "changes_requested",
      ci: "failure",
    })

    expect(filtered.map((pr) => pr.prNumber)).toEqual([21])
  })

  it("returns sorted unique filter values without blanks", () => {
    expect(getUniqueFilterValues(["zeta", null, "alpha", "", "alpha", "beta"])).toEqual([
      "alpha",
      "beta",
      "zeta",
    ])
  })
})
