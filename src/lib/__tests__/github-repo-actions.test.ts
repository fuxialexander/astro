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

describe('github-repo-actions', () => {
  it('builds a linked task from an issue', () => {
    const issue: GitHubCachedIssue = {
      id: '1',
      projectId: project.id,
      issueNumber: 123,
      title: 'Fix login bug',
      body: 'Details',
      state: 'open',
      url: 'https://example.com/issues/123',
      labels: [],
      assignees: [],
      commentsCount: 0,
      cachedAt: new Date(),
    }

    const node = buildIssueTaskNode(project, issue, 'quick_fix')

    expect(node.githubIssueNumber).toBe(123)
    expect(node.links?.[0]?.type).toBe('github_issue')
    expect(node.description).toContain(issue.url)
  })

  it('builds a linked task from a pull request', () => {
    const pr: GitHubCachedPr = {
      id: '2',
      projectId: project.id,
      prNumber: 88,
      title: 'Improve CI',
      body: 'Checks are red',
      state: 'open',
      url: 'https://example.com/pulls/88',
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
    }

    const node = buildPrTaskNode(project, pr, 'fix_ci')

    expect(node.prNumber).toBe(88)
    expect(node.prUrl).toBe(pr.url)
    expect(node.description).toContain('CI: failure')
    expect(node.links?.[0]?.type).toBe('github_pr')
  })
})
