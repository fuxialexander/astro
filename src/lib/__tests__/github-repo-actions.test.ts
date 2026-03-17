import { describe, expect, it } from 'vitest'
import { buildIssueTaskNode, buildPrTaskNode } from '../github-repo-actions'
import type { GitHubCachedIssue, GitHubCachedPr, Project } from '@/types'

const project: Project = {
  id: 'project-1',
  name: 'GitHub Project',
  description: '',
  visionDoc: '',
  teamId: 'team-1',
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

describe('github-repo-actions', () => {
  // ── buildIssueTaskNode ──
  describe('buildIssueTaskNode', () => {
    it('builds a linked task from an issue (quick_fix)', () => {
      const issue = makeIssue()
      const node = buildIssueTaskNode(project, issue, 'quick_fix')

      expect(node.githubIssueNumber).toBe(123)
      expect(node.title).toBe('#123 Fix login bug')
      expect(node.description).toContain(issue.url)
      expect(node.description).toContain('Fix the linked GitHub issue')
      expect(node.projectId).toBe(project.id)
      expect(node.status).toBe('planned')
      expect(node.type).toBe('task')
    })

    it('builds a linked task from an issue (add_to_plan)', () => {
      const issue = makeIssue()
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')

      expect(node.description).toContain('Investigate and implement')
      expect(node.description).not.toContain('Fix the linked')
    })

    it('generates a unique id for each call', () => {
      const issue = makeIssue()
      const node1 = buildIssueTaskNode(project, issue, 'quick_fix')
      const node2 = buildIssueTaskNode(project, issue, 'quick_fix')

      expect(node1.id).not.toBe(node2.id)
    })

    it('includes issue body in description', () => {
      const issue = makeIssue({ body: 'Steps to reproduce: open app' })
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')

      expect(node.description).toContain('Steps to reproduce: open app')
    })

    it('handles null/empty issue body', () => {
      const issue = makeIssue({ body: null })
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')

      // Should not crash; description still has the intent and URL
      expect(node.description).toContain(issue.url)
    })

    it('creates a github_issue link entry', () => {
      const issue = makeIssue()
      const node = buildIssueTaskNode(project, issue, 'quick_fix')

      expect(node.links).toHaveLength(1)
      expect(node.links![0]).toMatchObject({
        id: 'gh-123',
        type: 'github_issue',
        url: issue.url,
        title: issue.title,
        state: 'open',
        number: 123,
      })
    })

    it('sets githubIssueUrl on the node', () => {
      const issue = makeIssue()
      const node = buildIssueTaskNode(project, issue, 'quick_fix')

      expect(node.githubIssueUrl).toBe(issue.url)
    })

    it('truncates long issue bodies', () => {
      const longBody = 'x'.repeat(8000)
      const issue = makeIssue({ body: longBody })
      const node = buildIssueTaskNode(project, issue, 'add_to_plan')

      // The truncate function limits to 6000 chars
      expect(node.description!.length).toBeLessThan(8000)
      expect(node.description).toContain('[truncated]')
    })
  })

  // ── buildPrTaskNode ──
  describe('buildPrTaskNode', () => {
    it('builds a linked task from a pull request (fix_ci)', () => {
      const pr = makePr()
      const node = buildPrTaskNode(project, pr, 'fix_ci')

      expect(node.prNumber).toBe(88)
      expect(node.prUrl).toBe(pr.url)
      expect(node.title).toContain('Fix CI')
      expect(node.description).toContain('CI: failure')
      expect(node.description).toContain('failing CI checks')
      expect(node.branchName).toBe('fix-ci')
    })

    it('builds a linked task from a pull request (address_review)', () => {
      const pr = makePr()
      const node = buildPrTaskNode(project, pr, 'address_review')

      expect(node.title).toContain('Address Review')
      expect(node.description).toContain('review feedback')
      expect(node.description).toContain('Review: changes_requested')
    })

    it('creates a github_pr link entry', () => {
      const pr = makePr()
      const node = buildPrTaskNode(project, pr, 'fix_ci')

      expect(node.links).toHaveLength(1)
      expect(node.links![0]).toMatchObject({
        id: 'pr-88',
        type: 'github_pr',
        url: pr.url,
        title: pr.title,
        state: 'open',
        number: 88,
      })
    })

    it('includes branch info in description', () => {
      const pr = makePr({ headBranch: 'feature/auth', baseBranch: 'develop' })
      const node = buildPrTaskNode(project, pr, 'fix_ci')

      expect(node.description).toContain('Branch: feature/auth -> develop')
    })

    it('handles null branches gracefully', () => {
      const pr = makePr({ headBranch: null, baseBranch: null })
      const node = buildPrTaskNode(project, pr, 'fix_ci')

      expect(node.description).toContain('Branch: unknown -> unknown')
      expect(node.branchName).toBeUndefined()
    })

    it('includes PR body in description', () => {
      const pr = makePr({ body: 'This PR fixes the test suite' })
      const node = buildPrTaskNode(project, pr, 'fix_ci')

      expect(node.description).toContain('This PR fixes the test suite')
    })

    it('handles null PR body', () => {
      const pr = makePr({ body: null })
      const node = buildPrTaskNode(project, pr, 'fix_ci')

      // Should not crash
      expect(node.description).toBeDefined()
      expect(node.description).toContain(pr.url)
    })
  })
})
