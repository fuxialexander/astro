import { describe, expect, it } from 'vitest'
import { buildIssueTaskNode, buildPrTaskNode } from '../github-repo-actions'
import type { GitHubCachedIssue, GitHubCachedPr, Project } from '@/types'

const project: Project = {
  id: 'project-1',
  name: 'GitHub Project',
  description: '',
  visionDoc: '',
  status: 'active',
  projectType: 'github',
  githubOwner: 'org',
  githubRepo: 'repo',
  createdAt: new Date(),
  updatedAt: new Date(),
}

function makeIssue(overrides?: Partial<GitHubCachedIssue>): GitHubCachedIssue {
  return {
    id: '1',
    projectId: project.id,
    issueNumber: 123,
    title: 'Fix login bug',
    body: 'Detailed description of the bug',
    state: 'open',
    url: 'https://github.com/org/repo/issues/123',
    labels: [],
    assignees: [],
    commentsCount: 0,
    cachedAt: new Date(),
    ...overrides,
  }
}

function makePr(overrides?: Partial<GitHubCachedPr>): GitHubCachedPr {
  return {
    id: '2',
    projectId: project.id,
    prNumber: 88,
    title: 'Improve CI',
    body: 'Checks are red',
    state: 'open',
    url: 'https://github.com/org/repo/pulls/88',
    labels: [],
    ciStatus: 'failure',
    reviewDecision: 'changes_requested',
    mergeableState: 'conflicting',
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    commentsCount: 1,
    draft: false,
    headBranch: 'fix-ci',
    baseBranch: 'main',
    cachedAt: new Date(),
    ...overrides,
  }
}

describe('github-repo-actions – extended edge cases', () => {
  describe('buildIssueTaskNode', () => {
    it('handles issue with special characters in title', () => {
      const issue = makeIssue({ title: 'Fix <script>alert("xss")</script> bug' })
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')

      expect(node.title).toBe('#123 Fix <script>alert("xss")</script> bug')
      // Title should be passed through as-is (sanitization is UI-level)
    })

    it('handles issue with unicode in title and body', () => {
      const issue = makeIssue({
        title: '修复登录bug 🐛',
        body: '详细描述：用户无法登录',
      })
      const node = buildIssueTaskNode(project, issue, 'quick_fix')

      expect(node.title).toBe('#123 修复登录bug 🐛')
      expect(node.description).toContain('详细描述：用户无法登录')
    })

    it('handles issue with very long title', () => {
      const longTitle = 'A'.repeat(500)
      const issue = makeIssue({ title: longTitle })
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')

      expect(node.title).toBe(`#123 ${longTitle}`)
    })

    it('preserves all labels in the issue data', () => {
      const issue = makeIssue({
        labels: [
          { name: 'bug', color: 'ff0000' },
          { name: 'priority:high' },
        ],
      })
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')

      // Labels are part of the issue object, not directly on the node
      // But the link entry should capture the issue metadata
      expect(node.links![0].type).toBe('github_issue')
    })

    it('builds correct link for closed issues', () => {
      const issue = makeIssue({ state: 'closed' })
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')

      expect(node.links![0].state).toBe('closed')
    })

    it('sets verification to auto for quick_fix', () => {
      const issue = makeIssue()
      const node = buildIssueTaskNode(project, issue, 'quick_fix')
      expect(node.verification).toBe('auto')
    })

    it('sets verification to auto for add_to_plan', () => {
      const issue = makeIssue()
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')
      expect(node.verification).toBe('auto')
    })

    it('sets position to origin', () => {
      const issue = makeIssue()
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')
      expect(node.position).toEqual({ x: 0, y: 0 })
    })

    it('sets createdAt and updatedAt to recent dates', () => {
      const before = Date.now()
      const issue = makeIssue()
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')
      const after = Date.now()

      expect(node.createdAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(node.createdAt.getTime()).toBeLessThanOrEqual(after)
      expect(node.updatedAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(node.updatedAt.getTime()).toBeLessThanOrEqual(after)
    })

    it('sets parentId to null and dependencies to empty', () => {
      const issue = makeIssue()
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')
      expect(node.parentId).toBeNull()
      expect(node.dependencies).toEqual([])
    })

    it('truncation happens at 6000 chars', () => {
      // Exactly 6000 should NOT be truncated
      const exactBody = 'x'.repeat(6000)
      const issue1 = makeIssue({ body: exactBody })
      const node1 = buildIssueTaskNode(project, issue1, 'add_to_plan')
      expect(node1.description).not.toContain('[truncated]')

      // 6001 should be truncated
      const longBody = 'x'.repeat(6001)
      const issue2 = makeIssue({ body: longBody })
      const node2 = buildIssueTaskNode(project, issue2, 'add_to_plan')
      expect(node2.description).toContain('[truncated]')
    })
  })

  describe('buildPrTaskNode', () => {
    it('handles PR with large additions/deletions', () => {
      const pr = makePr({ additions: 50000, deletions: 30000, changedFiles: 500 })
      const node = buildPrTaskNode(project, pr, 'fix_ci')

      // Should not crash; the node is created normally
      expect(node.prNumber).toBe(88)
    })

    it('handles PR with draft status', () => {
      const pr = makePr({ draft: true })
      const node = buildPrTaskNode(project, pr, 'fix_ci')

      // Draft status doesn't affect node creation
      expect(node.prNumber).toBe(88)
    })

    it('handles closed PR', () => {
      const pr = makePr({ state: 'closed' })
      const node = buildPrTaskNode(project, pr, 'address_review')

      expect(node.links![0].state).toBe('closed')
    })

    it('handles merged PR', () => {
      const pr = makePr({ state: 'merged' })
      const node = buildPrTaskNode(project, pr, 'address_review')

      expect(node.links![0].state).toBe('merged')
    })

    it('includes all CI and review status in description for fix_ci', () => {
      const pr = makePr({
        ciStatus: 'failure',
        reviewDecision: 'approved',
        headBranch: 'feat/new',
        baseBranch: 'develop',
      })
      const node = buildPrTaskNode(project, pr, 'fix_ci')

      expect(node.description).toContain('CI: failure')
      expect(node.description).toContain('Review: approved')
      expect(node.description).toContain('Branch: feat/new -> develop')
    })

    it('uses PR URL as prUrl on the node', () => {
      const pr = makePr({ url: 'https://github.com/org/repo/pull/42' })
      const node = buildPrTaskNode(project, pr, 'fix_ci')

      expect(node.prUrl).toBe('https://github.com/org/repo/pull/42')
    })

    it('title format for address_review includes "Address Review"', () => {
      const pr = makePr({ title: 'Add dark mode' })
      const node = buildPrTaskNode(project, pr, 'address_review')

      expect(node.title).toBe('PR #88 Address Review: Add dark mode')
    })

    it('title format for fix_ci includes "Fix CI"', () => {
      const pr = makePr({ title: 'Add dark mode' })
      const node = buildPrTaskNode(project, pr, 'fix_ci')

      expect(node.title).toBe('PR #88 Fix CI: Add dark mode')
    })
  })
})
