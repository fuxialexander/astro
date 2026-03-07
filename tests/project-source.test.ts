/**
 * Tests for project source utility functions.
 *
 * Covers: detectRemoteType, deriveDeliveryMode, resolveProjectSource, urlsMatchSameRepo
 * These are the frontend utilities in src/lib/project-source.ts
 */
import { describe, it, expect } from 'vitest'
import {
  detectRemoteType,
  deriveDeliveryMode,
  resolveProjectSource,
  urlsMatchSameRepo,
  deliveryModeLabel,
  remoteTypeLabel,
} from '../src/lib/project-source'
import type { Project, ProjectSource } from '../src/types'

// ─── detectRemoteType ────────────────────────────────────────────

describe('detectRemoteType', () => {
  it('returns "none" for undefined/empty', () => {
    expect(detectRemoteType(undefined)).toBe('none')
    expect(detectRemoteType('')).toBe('none')
  })

  it('detects GitHub URLs', () => {
    expect(detectRemoteType('https://github.com/user/repo.git')).toBe('github')
    expect(detectRemoteType('git@github.com:user/repo.git')).toBe('github')
    expect(detectRemoteType('ssh://git@github.com/user/repo.git')).toBe('github')
  })

  it('detects GitLab URLs (including self-hosted)', () => {
    expect(detectRemoteType('https://gitlab.com/user/repo.git')).toBe('gitlab')
    expect(detectRemoteType('git@gitlab.com:user/repo.git')).toBe('gitlab')
    // Self-hosted GitLab
    expect(detectRemoteType('https://gitlab.company.com/group/repo.git')).toBe('gitlab')
    expect(detectRemoteType('git@gitlab.internal.corp:group/project.git')).toBe('gitlab')
  })

  it('detects Bitbucket URLs (including self-hosted)', () => {
    expect(detectRemoteType('https://bitbucket.org/user/repo.git')).toBe('bitbucket')
    expect(detectRemoteType('git@bitbucket.org:user/repo.git')).toBe('bitbucket')
    // Self-hosted Bitbucket
    expect(detectRemoteType('https://bitbucket.company.com/scm/proj/repo.git')).toBe('bitbucket')
  })

  it('returns "generic" for unknown git URLs', () => {
    expect(detectRemoteType('git@self-hosted.example.com:user/repo.git')).toBe('generic')
    expect(detectRemoteType('https://git.company.com/user/repo.git')).toBe('generic')
    expect(detectRemoteType('ssh://git@internal.server/repos/project.git')).toBe('generic')
  })

  it('returns "none" for non-URL strings', () => {
    expect(detectRemoteType('some-random-string')).toBe('none')
    expect(detectRemoteType('/local/path/to/repo')).toBe('none')
  })
})

// ─── deriveDeliveryMode ──────────────────────────────────────────

describe('deriveDeliveryMode', () => {
  it('returns "direct" for non-git sources', () => {
    const source: ProjectSource = {
      localPath: '/home/user/scripts',
      remoteType: 'none',
      baseBranch: 'main',
      isGit: false,
    }
    expect(deriveDeliveryMode(source)).toBe('direct')
  })

  it('returns "pr" for GitHub remotes', () => {
    const source: ProjectSource = {
      localPath: '/home/user/project',
      remoteUrl: 'git@github.com:user/repo.git',
      remoteType: 'github',
      baseBranch: 'main',
      isGit: true,
    }
    expect(deriveDeliveryMode(source)).toBe('pr')
  })

  it('returns "pr" for GitLab remotes', () => {
    const source: ProjectSource = {
      localPath: '/home/user/project',
      remoteUrl: 'git@gitlab.com:user/repo.git',
      remoteType: 'gitlab',
      baseBranch: 'main',
      isGit: true,
    }
    expect(deriveDeliveryMode(source)).toBe('pr')
  })

  it('returns "pr" for Bitbucket remotes', () => {
    const source: ProjectSource = {
      localPath: '/home/user/project',
      remoteUrl: 'git@bitbucket.org:user/repo.git',
      remoteType: 'bitbucket',
      baseBranch: 'main',
      isGit: true,
    }
    expect(deriveDeliveryMode(source)).toBe('pr')
  })

  it('returns "push" for generic remotes', () => {
    const source: ProjectSource = {
      localPath: '/home/user/project',
      remoteUrl: 'git@self-hosted.example.com:user/repo.git',
      remoteType: 'generic',
      baseBranch: 'main',
      isGit: true,
    }
    expect(deriveDeliveryMode(source)).toBe('push')
  })

  it('returns "branch" for git repos with no remote', () => {
    const source: ProjectSource = {
      localPath: '/home/user/analysis',
      remoteType: 'none',
      baseBranch: 'main',
      isGit: true,
    }
    expect(deriveDeliveryMode(source)).toBe('branch')
  })
})

// ─── urlsMatchSameRepo ──────────────────────────────────────────

describe('urlsMatchSameRepo', () => {
  it('matches SSH and HTTPS for same GitHub repo', () => {
    expect(urlsMatchSameRepo(
      'git@github.com:user/repo.git',
      'https://github.com/user/repo.git'
    )).toBe(true)
  })

  it('matches with and without .git suffix', () => {
    expect(urlsMatchSameRepo(
      'git@github.com:user/repo.git',
      'git@github.com:user/repo'
    )).toBe(true)
  })

  it('matches with trailing slashes', () => {
    expect(urlsMatchSameRepo(
      'https://github.com/user/repo/',
      'https://github.com/user/repo'
    )).toBe(true)
  })

  it('does not match different repos', () => {
    expect(urlsMatchSameRepo(
      'git@github.com:user/repo-a.git',
      'git@github.com:user/repo-b.git'
    )).toBe(false)
  })

  it('does not match different owners', () => {
    expect(urlsMatchSameRepo(
      'git@github.com:alice/repo.git',
      'git@github.com:bob/repo.git'
    )).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(urlsMatchSameRepo(
      'git@GitHub.com:User/Repo.git',
      'https://github.com/user/repo.git'
    )).toBe(true)
  })
})

// ─── resolveProjectSource ────────────────────────────────────────

describe('resolveProjectSource', () => {
  it('returns existing source if already populated', () => {
    const existingSource: ProjectSource = {
      localPath: '/existing/path',
      remoteType: 'github',
      baseBranch: 'develop',
      isGit: true,
    }
    const project = {
      source: existingSource,
    } as Project

    expect(resolveProjectSource(project)).toBe(existingSource)
  })

  it('returns undefined when no paths available', () => {
    const project = {} as Project
    expect(resolveProjectSource(project)).toBeUndefined()
  })

  it('resolves from workingDirectory with repository', () => {
    const project = {
      workingDirectory: '/home/user/project',
      repository: 'https://github.com/user/repo.git',
    } as Project

    const source = resolveProjectSource(project)
    expect(source).toBeDefined()
    expect(source!.localPath).toBe('/home/user/project')
    expect(source!.remoteType).toBe('github')
    expect(source!.isGit).toBe(true)
  })

  it('resolves from workingDirectory alone', () => {
    const project = {
      workingDirectory: '/home/user/work',
    } as Project

    const source = resolveProjectSource(project)
    expect(source).toBeDefined()
    expect(source!.localPath).toBe('/home/user/work')
    expect(source!.remoteType).toBe('none')
    expect(source!.isGit).toBe(false)
  })

  it('infers git type when repository has a URL', () => {
    const project = {
      workingDirectory: '/home/user/project',
      repository: 'git@gitlab.company.com:team/repo.git',
    } as Project

    const source = resolveProjectSource(project)
    expect(source).toBeDefined()
    expect(source!.remoteType).toBe('gitlab')
    expect(source!.isGit).toBe(true)
  })

  it('defaults baseBranch to "main"', () => {
    const project = {
      workingDirectory: '/home/user/project',
    } as Project

    const source = resolveProjectSource(project)
    expect(source!.baseBranch).toBe('main')
  })
})

// ─── Label functions ─────────────────────────────────────────────

describe('deliveryModeLabel', () => {
  it('returns correct labels', () => {
    expect(deliveryModeLabel('pr')).toBe('Pull Request')
    expect(deliveryModeLabel('push')).toBe('Push to Remote')
    expect(deliveryModeLabel('branch')).toBe('Local Branch')
    expect(deliveryModeLabel('copy')).toBe('Copy to Worktree')
    expect(deliveryModeLabel('direct')).toBe('Direct (in-place)')
  })
})

describe('remoteTypeLabel', () => {
  it('returns correct labels', () => {
    expect(remoteTypeLabel('github')).toBe('GitHub')
    expect(remoteTypeLabel('gitlab')).toBe('GitLab')
    expect(remoteTypeLabel('bitbucket')).toBe('Bitbucket')
    expect(remoteTypeLabel('generic')).toBe('Git Remote')
    expect(remoteTypeLabel('none')).toBe('No Remote')
  })
})
