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

function makeProject(overrides?: Partial<GitHubWorkspaceProjectSummary>): GitHubWorkspaceProjectSummary {
  return {
    projectId: 'p1',
    projectName: 'Web App',
    repo: 'org/web-app',
    openIssues: 0,
    openPullRequests: 0,
    failingPrs: 0,
    changesRequestedPrs: 0,
    readyToMergePrs: 0,
    lastSyncedAt: '2026-03-13T00:00:00Z',
    ...overrides,
  }
}

describe('github-repo-cache helpers', () => {
  // ── normalizeReviewDecision ──
  describe('normalizeReviewDecision', () => {
    it('normalizes known review decisions', () => {
      expect(normalizeReviewDecision('approved')).toBe('approved')
      expect(normalizeReviewDecision('changes_requested')).toBe('changes_requested')
      expect(normalizeReviewDecision('reviewed')).toBe('reviewed')
      expect(normalizeReviewDecision('pending')).toBe('pending')
      expect(normalizeReviewDecision('none')).toBe('none')
    })

    it('returns "none" for unknown values', () => {
      expect(normalizeReviewDecision(undefined)).toBe('none')
      expect(normalizeReviewDecision(null)).toBe('none')
      expect(normalizeReviewDecision('unexpected')).toBe('none')
      expect(normalizeReviewDecision('')).toBe('none')
    })
  })

  // ── normalizeMergeableState ──
  describe('normalizeMergeableState', () => {
    it('normalizes true/false/null', () => {
      expect(normalizeMergeableState(true)).toBe('mergeable')
      expect(normalizeMergeableState(false)).toBe('conflicting')
      expect(normalizeMergeableState(null)).toBe('unknown')
      expect(normalizeMergeableState(undefined)).toBe('unknown')
    })
  })

  // ── normalizePullRequestState ──
  describe('normalizePullRequestState', () => {
    it('derives merged pull request state', () => {
      expect(normalizePullRequestState({ state: 'closed', merged_at: '2026-03-13T00:00:00Z' })).toBe('merged')
      expect(normalizePullRequestState({ state: 'closed', merged_at: null })).toBe('closed')
      expect(normalizePullRequestState({ state: 'open', merged_at: null })).toBe('open')
    })

    it('returns merged even when state is open but merged_at exists', () => {
      // Edge case: should be impossible via GitHub API but our logic prioritizes merged_at
      expect(normalizePullRequestState({ state: 'open', merged_at: '2026-01-01T00:00:00Z' })).toBe('merged')
    })
  })

  // ── deriveAttentionItems ──
  describe('deriveAttentionItems', () => {
    it('builds workspace attention items from PR health', () => {
      const projects = [makeProject({ openPullRequests: 3, failingPrs: 1, changesRequestedPrs: 1, readyToMergePrs: 1 })]

      const prs: GitHubCachedPr[] = [
        makePr({ projectId: 'p1', prNumber: 41, title: 'Fix auth', url: 'https://example.com/41', ciStatus: 'failure' }),
        makePr({ projectId: 'p1', prNumber: 42, title: 'Refactor API', url: 'https://example.com/42', reviewDecision: 'changes_requested' }),
        makePr({ projectId: 'p1', prNumber: 43, title: 'Cleanup', url: 'https://example.com/43', ciStatus: 'success', reviewDecision: 'approved', mergeableState: 'mergeable' }),
      ]

      const items = deriveAttentionItems(projects, prs)
      expect(items.map((item) => item.type)).toEqual([
        'ci_failing',
        'changes_requested',
        'ready_to_merge',
      ])
    })

    it('ignores closed PRs', () => {
      const projects = [makeProject()]
      const prs: GitHubCachedPr[] = [
        makePr({ projectId: 'p1', prNumber: 1, title: 'Closed failing', url: 'https://example.com/1', state: 'closed', ciStatus: 'failure' }),
      ]

      expect(deriveAttentionItems(projects, prs)).toHaveLength(0)
    })

    it('ignores PRs with no matching project', () => {
      const projects = [makeProject({ projectId: 'p1' })]
      const prs: GitHubCachedPr[] = [
        makePr({ projectId: 'p99', prNumber: 1, title: 'Orphan', url: 'https://example.com/1', ciStatus: 'failure' }),
      ]

      expect(deriveAttentionItems(projects, prs)).toHaveLength(0)
    })

    it('ignores healthy open PRs (no CI failure, no changes requested, not ready)', () => {
      const projects = [makeProject()]
      const prs: GitHubCachedPr[] = [
        makePr({ projectId: 'p1', prNumber: 1, title: 'In progress', url: 'https://example.com/1', ciStatus: 'pending', reviewDecision: 'none' }),
      ]

      expect(deriveAttentionItems(projects, prs)).toHaveLength(0)
    })

    it('populates attention item fields correctly', () => {
      const projects = [makeProject({ projectId: 'p1', projectName: 'My App', repo: 'org/my-app' })]
      const prs: GitHubCachedPr[] = [
        makePr({
          projectId: 'p1',
          prNumber: 99,
          title: 'Big refactor',
          url: 'https://github.com/org/my-app/pull/99',
          ciStatus: 'failure',
          updatedAt: new Date('2026-03-12T12:00:00Z'),
        }),
      ]

      const items = deriveAttentionItems(projects, prs)
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        type: 'ci_failing',
        projectId: 'p1',
        projectName: 'My App',
        repo: 'org/my-app',
        number: 99,
        title: 'Big refactor',
        url: 'https://github.com/org/my-app/pull/99',
        updatedAt: '2026-03-12T12:00:00.000Z',
      })
    })

    it('handles multiple projects', () => {
      const projects = [
        makeProject({ projectId: 'p1', projectName: 'App A', repo: 'org/a' }),
        makeProject({ projectId: 'p2', projectName: 'App B', repo: 'org/b' }),
      ]
      const prs: GitHubCachedPr[] = [
        makePr({ projectId: 'p1', prNumber: 1, title: 'Fix A', url: 'https://example.com/1', ciStatus: 'failure' }),
        makePr({ projectId: 'p2', prNumber: 2, title: 'Fix B', url: 'https://example.com/2', reviewDecision: 'changes_requested' }),
      ]

      const items = deriveAttentionItems(projects, prs)
      expect(items).toHaveLength(2)
      expect(items[0].projectName).toBe('App A')
      expect(items[1].projectName).toBe('App B')
    })

    it('ready_to_merge requires all three conditions (ci=success, review=approved, mergeable)', () => {
      const projects = [makeProject()]

      // Missing mergeable
      expect(deriveAttentionItems(projects, [
        makePr({ projectId: 'p1', prNumber: 1, title: 'T', url: '#', ciStatus: 'success', reviewDecision: 'approved', mergeableState: 'conflicting' }),
      ])).toHaveLength(0)

      // Missing CI
      expect(deriveAttentionItems(projects, [
        makePr({ projectId: 'p1', prNumber: 2, title: 'T', url: '#', ciStatus: 'pending', reviewDecision: 'approved', mergeableState: 'mergeable' }),
      ])).toHaveLength(0)

      // Missing review
      expect(deriveAttentionItems(projects, [
        makePr({ projectId: 'p1', prNumber: 3, title: 'T', url: '#', ciStatus: 'success', reviewDecision: 'none', mergeableState: 'mergeable' }),
      ])).toHaveLength(0)

      // All three present
      const items = deriveAttentionItems(projects, [
        makePr({ projectId: 'p1', prNumber: 4, title: 'T', url: '#', ciStatus: 'success', reviewDecision: 'approved', mergeableState: 'mergeable' }),
      ])
      expect(items).toHaveLength(1)
      expect(items[0].type).toBe('ready_to_merge')
    })

    it('ci_failing takes priority over changes_requested when both apply', () => {
      const projects = [makeProject()]
      const prs: GitHubCachedPr[] = [
        makePr({ projectId: 'p1', prNumber: 1, title: 'T', url: '#', ciStatus: 'failure', reviewDecision: 'changes_requested' }),
      ]

      const items = deriveAttentionItems(projects, prs)
      expect(items).toHaveLength(1)
      // The code checks ci_failing first, so that wins
      expect(items[0].type).toBe('ci_failing')
    })
  })
})
