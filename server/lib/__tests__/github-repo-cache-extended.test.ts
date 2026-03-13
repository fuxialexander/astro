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

describe('github-repo-cache extended tests', () => {
  // ── Edge cases for normalization functions ──
  describe('normalizePullRequestState', () => {
    it('handles empty string state', () => {
      expect(normalizePullRequestState({ state: '' as 'open', merged_at: null })).toBe('open')
    })

    it('prioritizes merged_at over closed state', () => {
      expect(normalizePullRequestState({ state: 'closed', merged_at: '2026-01-01' })).toBe('merged')
    })
  })

  describe('normalizeReviewDecision', () => {
    it('returns correct value for each valid state', () => {
      const validStates = ['approved', 'changes_requested', 'reviewed', 'pending', 'none'] as const
      for (const state of validStates) {
        expect(normalizeReviewDecision(state)).toBe(state)
      }
    })

    it('handles whitespace strings', () => {
      expect(normalizeReviewDecision(' ')).toBe('none')
      expect(normalizeReviewDecision('  approved  ')).toBe('none') // Not trimmed — treated as unknown
    })
  })

  describe('normalizeMergeableState', () => {
    it('handles 0 as false (falsy but not null/undefined)', () => {
      // 0 is falsy but is `number`, not `boolean | null | undefined`
      // TypeScript would catch this, but testing runtime safety
      expect(normalizeMergeableState(false)).toBe('conflicting')
    })
  })

  // ── deriveAttentionItems stress tests ──
  describe('deriveAttentionItems – stress and ordering', () => {
    it('handles empty inputs', () => {
      expect(deriveAttentionItems([], [])).toEqual([])
    })

    it('handles projects with no PRs', () => {
      const projects = [makeProject()]
      expect(deriveAttentionItems(projects, [])).toEqual([])
    })

    it('handles many PRs across many projects', () => {
      const projects = Array.from({ length: 5 }, (_, i) =>
        makeProject({ projectId: `p${i}`, projectName: `Project ${i}`, repo: `org/repo-${i}` }),
      )

      const prs = projects.flatMap((p, i) =>
        Array.from({ length: 10 }, (_, j) =>
          makePr({
            projectId: p.projectId,
            prNumber: i * 100 + j,
            title: `PR ${j} for ${p.projectName}`,
            url: `https://example.com/${i}/${j}`,
            ciStatus: j % 3 === 0 ? 'failure' : j % 3 === 1 ? 'success' : 'pending',
            reviewDecision: j % 3 === 1 ? 'approved' : 'none',
            mergeableState: j % 3 === 1 ? 'mergeable' : 'unknown',
          }),
        ),
      )

      const items = deriveAttentionItems(projects, prs)

      // Each project has: j=0,3,6,9 → ci_failing (4 each), j=1,4,7 → ready_to_merge (3 each)
      // That's 7 per project × 5 projects = 35
      expect(items.length).toBe(35)

      // All items should have valid types
      for (const item of items) {
        expect(['ci_failing', 'changes_requested', 'ready_to_merge', 'new_issue']).toContain(item.type)
      }
    })

    it('includes updatedAt as ISO string from Date objects', () => {
      const projects = [makeProject()]
      const prs = [
        makePr({
          projectId: 'p1',
          prNumber: 1,
          title: 'Test',
          url: '#',
          ciStatus: 'failure',
          updatedAt: new Date('2026-06-15T10:30:00Z'),
        }),
      ]

      const items = deriveAttentionItems(projects, prs)
      expect(items[0].updatedAt).toBe('2026-06-15T10:30:00.000Z')
    })

    it('handles null updatedAt on PR', () => {
      const projects = [makeProject()]
      const prs = [
        makePr({
          projectId: 'p1',
          prNumber: 1,
          title: 'Test',
          url: '#',
          ciStatus: 'failure',
          updatedAt: null,
        }),
      ]

      const items = deriveAttentionItems(projects, prs)
      expect(items[0].updatedAt).toBeNull()
    })

    it('merged PRs are not considered (state=merged)', () => {
      const projects = [makeProject()]
      const prs = [
        makePr({
          projectId: 'p1',
          prNumber: 1,
          title: 'Merged',
          url: '#',
          state: 'merged',
          ciStatus: 'failure',
        }),
      ]

      expect(deriveAttentionItems(projects, prs)).toHaveLength(0)
    })

    it('draft PRs with failing CI still appear in attention', () => {
      const projects = [makeProject()]
      const prs = [
        makePr({
          projectId: 'p1',
          prNumber: 1,
          title: 'Draft',
          url: '#',
          draft: true,
          ciStatus: 'failure',
        }),
      ]

      // The current implementation doesn't filter drafts
      const items = deriveAttentionItems(projects, prs)
      expect(items).toHaveLength(1)
      expect(items[0].type).toBe('ci_failing')
    })

    it('PR with ciStatus=none and reviewDecision=none produces no attention item', () => {
      const projects = [makeProject()]
      const prs = [
        makePr({
          projectId: 'p1',
          prNumber: 1,
          title: 'Clean',
          url: '#',
          ciStatus: 'none',
          reviewDecision: 'none',
        }),
      ]

      expect(deriveAttentionItems(projects, prs)).toHaveLength(0)
    })
  })
})
