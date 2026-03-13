import { describe, expect, it } from 'vitest'
import {
  deriveAttentionItems,
  normalizeMergeableState,
  normalizePullRequestState,
  normalizeReviewDecision,
} from '../github-repo-cache.js'
import type { GitHubCachedPr, GitHubWorkspaceProjectSummary } from '../../../packages/core/src/types.js'

function makePr(overrides: Partial<GitHubCachedPr> & Pick<GitHubCachedPr, 'projectId' | 'prNumber' | 'title' | 'url'>): GitHubCachedPr {
  return {
    id: String(overrides.prNumber),
    body: null,
    state: 'open',
    authorLogin: 'octocat',
    headBranch: 'feature/test',
    baseBranch: 'main',
    labels: [],
    ciStatus: 'pending',
    reviewDecision: 'none',
    mergeableState: 'unknown',
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    commentsCount: 0,
    draft: false,
    createdAt: new Date('2026-03-13T00:00:00Z'),
    updatedAt: new Date('2026-03-13T00:00:00Z'),
    mergedAt: null,
    closedAt: null,
    cachedAt: new Date('2026-03-13T00:00:00Z'),
    ...overrides,
  }
}

describe('github-repo-cache helpers', () => {
  it('normalizes review decisions', () => {
    expect(normalizeReviewDecision('approved')).toBe('approved')
    expect(normalizeReviewDecision('changes_requested')).toBe('changes_requested')
    expect(normalizeReviewDecision(undefined)).toBe('none')
    expect(normalizeReviewDecision('unexpected')).toBe('none')
  })

  it('normalizes mergeable state', () => {
    expect(normalizeMergeableState(true)).toBe('mergeable')
    expect(normalizeMergeableState(false)).toBe('conflicting')
    expect(normalizeMergeableState(null)).toBe('unknown')
  })

  it('derives merged pull request state', () => {
    expect(normalizePullRequestState({ state: 'closed', merged_at: '2026-03-13T00:00:00Z' })).toBe('merged')
    expect(normalizePullRequestState({ state: 'closed', merged_at: null })).toBe('closed')
    expect(normalizePullRequestState({ state: 'open', merged_at: null })).toBe('open')
  })

  it('builds workspace attention items from PR health', () => {
    const projects: GitHubWorkspaceProjectSummary[] = [
      {
        projectId: 'p1',
        projectName: 'Web App',
        repo: 'org/web-app',
        openIssues: 0,
        openPullRequests: 3,
        failingPrs: 1,
        changesRequestedPrs: 1,
        readyToMergePrs: 1,
        lastSyncedAt: '2026-03-13T00:00:00Z',
      },
    ]

    const prs: GitHubCachedPr[] = [
      makePr({ projectId: 'p1', prNumber: 41, title: 'Fix auth', url: 'https://example.com/41', ciStatus: 'failure' }),
      makePr({ projectId: 'p1', prNumber: 42, title: 'Refactor API', url: 'https://example.com/42', reviewDecision: 'changes_requested' }),
      makePr({ projectId: 'p1', prNumber: 43, title: 'Cleanup', url: 'https://example.com/43', ciStatus: 'success', reviewDecision: 'approved', mergeableState: 'mergeable' }),
    ]

    expect(deriveAttentionItems(projects, prs).map((item) => item.type)).toEqual([
      'ci_failing',
      'changes_requested',
      'ready_to_merge',
    ])
  })
})
