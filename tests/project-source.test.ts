/**
 * Tests for project source utility functions.
 *
 * Covers: extractGitHubOwnerRepo, detectRemoteType, deriveDeliveryMode,
 *         resolveProjectSource, urlsMatchSameRepo, and plan creation metadata assembly
 * These are the frontend utilities in src/lib/project-source.ts
 */
import { describe, it, expect } from 'vitest'
import {
  extractGitHubOwnerRepo,
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
    expect(detectRemoteType('https://gitlab.company.com/group/repo.git')).toBe('gitlab')
    expect(detectRemoteType('git@gitlab.internal.corp:group/project.git')).toBe('gitlab')
  })

  it('detects Bitbucket URLs (including self-hosted)', () => {
    expect(detectRemoteType('https://bitbucket.org/user/repo.git')).toBe('bitbucket')
    expect(detectRemoteType('git@bitbucket.org:user/repo.git')).toBe('bitbucket')
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

  it('defaults baseBranch to "main" for git directories', () => {
    const project = {
      workingDirectory: '/home/user/project',
      repository: 'https://github.com/user/repo.git',
    } as Project

    const source = resolveProjectSource(project)
    expect(source!.baseBranch).toBe('main')
  })

  it('leaves baseBranch undefined for non-git directories', () => {
    const project = {
      workingDirectory: '/home/user/scripts',
    } as Project

    const source = resolveProjectSource(project)
    expect(source!.baseBranch).toBeUndefined()
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

// ─── extractGitHubOwnerRepo ─────────────────────────────────────

describe('extractGitHubOwnerRepo', () => {
  // ── Positive: standard URL formats ──────────────────────────
  it('extracts from HTTPS URL with .git suffix', () => {
    expect(extractGitHubOwnerRepo('https://github.com/acme/widgets.git'))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('extracts from HTTPS URL without .git suffix', () => {
    expect(extractGitHubOwnerRepo('https://github.com/acme/widgets'))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('extracts from SSH URL with .git suffix', () => {
    expect(extractGitHubOwnerRepo('git@github.com:acme/widgets.git'))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('extracts from SSH URL without .git suffix', () => {
    expect(extractGitHubOwnerRepo('git@github.com:acme/widgets'))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('extracts from ssh:// protocol URL', () => {
    expect(extractGitHubOwnerRepo('ssh://git@github.com/acme/widgets'))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('extracts from ssh:// protocol URL with .git suffix', () => {
    expect(extractGitHubOwnerRepo('ssh://git@github.com/acme/widgets.git'))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('extracts from HTTP (non-HTTPS) URL', () => {
    expect(extractGitHubOwnerRepo('http://github.com/acme/widgets.git'))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  // ── Owner/repo with special characters ──────────────────────
  it('handles owner with hyphens', () => {
    expect(extractGitHubOwnerRepo('git@github.com:my-org/repo.git'))
      .toEqual({ owner: 'my-org', repo: 'repo' })
  })

  it('handles repo with hyphens', () => {
    expect(extractGitHubOwnerRepo('git@github.com:acme/my-project.git'))
      .toEqual({ owner: 'acme', repo: 'my-project' })
  })

  it('handles owner with underscores', () => {
    expect(extractGitHubOwnerRepo('https://github.com/my_org/repo'))
      .toEqual({ owner: 'my_org', repo: 'repo' })
  })

  it('handles repo with dots', () => {
    expect(extractGitHubOwnerRepo('git@github.com:acme/my.repo.name.git'))
      .toEqual({ owner: 'acme', repo: 'my.repo.name' })
  })

  it('handles numeric owner/repo', () => {
    expect(extractGitHubOwnerRepo('https://github.com/12345/67890'))
      .toEqual({ owner: '12345', repo: '67890' })
  })

  // ── Whitespace and trailing characters ──────────────────────
  it('trims leading/trailing whitespace', () => {
    expect(extractGitHubOwnerRepo('  https://github.com/acme/widgets.git  '))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('strips trailing slashes', () => {
    expect(extractGitHubOwnerRepo('https://github.com/acme/widgets/'))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('strips .git/ with trailing slash', () => {
    expect(extractGitHubOwnerRepo('https://github.com/acme/widgets.git/'))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  // ── Case insensitivity ──────────────────────────────────────
  it('is case-insensitive for domain matching', () => {
    expect(extractGitHubOwnerRepo('git@GitHub.COM:Acme/Widgets.git'))
      .toEqual({ owner: 'Acme', repo: 'Widgets' })
  })

  it('preserves original case of owner/repo', () => {
    expect(extractGitHubOwnerRepo('https://GITHUB.com/MyOrg/MyRepo'))
      .toEqual({ owner: 'MyOrg', repo: 'MyRepo' })
  })

  // ── Negative cases ──────────────────────────────────────────
  it('returns null for undefined', () => {
    expect(extractGitHubOwnerRepo(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractGitHubOwnerRepo('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(extractGitHubOwnerRepo('   ')).toBeNull()
  })

  it('returns null for GitLab SSH URL', () => {
    expect(extractGitHubOwnerRepo('git@gitlab.com:acme/widgets.git')).toBeNull()
  })

  it('returns null for GitLab HTTPS URL', () => {
    expect(extractGitHubOwnerRepo('https://gitlab.com/acme/widgets.git')).toBeNull()
  })

  it('returns null for Bitbucket URL', () => {
    expect(extractGitHubOwnerRepo('git@bitbucket.org:acme/widgets.git')).toBeNull()
  })

  it('returns null for self-hosted GitLab URL', () => {
    expect(extractGitHubOwnerRepo('https://gitlab.company.com/org/project.git')).toBeNull()
  })

  it('returns null for generic git remote', () => {
    expect(extractGitHubOwnerRepo('git@internal.server:org/repo.git')).toBeNull()
  })

  it('returns null for non-URL string', () => {
    expect(extractGitHubOwnerRepo('not-a-url')).toBeNull()
  })

  it('returns null for local path', () => {
    expect(extractGitHubOwnerRepo('/home/user/project')).toBeNull()
  })

  it('returns null for GitHub URL with only owner (no repo)', () => {
    expect(extractGitHubOwnerRepo('https://github.com/acme')).toBeNull()
  })
})

// ─── Plan creation metadata assembly ─────────────────────────────
// These tests simulate the logic in project-new-plan.tsx to verify
// that the correct metadata flows from directory detection to plan creation.

describe('plan creation — GitHub metadata assembly', () => {
  /**
   * Simulates the metadata assembly logic from project-new-plan.tsx
   * for the normal (new project) flow.
   */
  function assembleNormalFlowOptions(detection: {
    remoteUrl?: string
    remoteType?: string
  } | null) {
    const github = detection?.remoteType === 'github'
      ? extractGitHubOwnerRepo(detection.remoteUrl)
      : null

    return {
      repository: detection?.remoteUrl || undefined,
      ...(github ? { githubOwner: github.owner, githubRepo: github.repo } : {}),
    }
  }

  /**
   * Simulates the metadata assembly logic from project-new-plan.tsx
   * for the regeneration (existing project) flow.
   */
  function assembleRegenFlowUpdates(
    detection: { remoteUrl?: string; remoteType?: string } | null,
    existingProject: { repository?: string; githubOwner?: string; githubRepo?: string },
  ) {
    const github = detection?.remoteType === 'github'
      ? extractGitHubOwnerRepo(detection.remoteUrl)
      : null

    return {
      repository: detection?.remoteUrl || existingProject.repository || undefined,
      ...(github && !existingProject.githubOwner
        ? { githubOwner: github.owner, githubRepo: github.repo }
        : {}),
    }
  }

  // ── Normal flow ─────────────────────────────────────────────
  it('normal flow: passes owner/repo for GitHub SSH detection', () => {
    const result = assembleNormalFlowOptions({
      remoteUrl: 'git@github.com:fuxialexander/astro.git',
      remoteType: 'github',
    })
    expect(result).toEqual({
      repository: 'git@github.com:fuxialexander/astro.git',
      githubOwner: 'fuxialexander',
      githubRepo: 'astro',
    })
  })

  it('normal flow: passes owner/repo for GitHub HTTPS detection', () => {
    const result = assembleNormalFlowOptions({
      remoteUrl: 'https://github.com/acme/widgets.git',
      remoteType: 'github',
    })
    expect(result).toEqual({
      repository: 'https://github.com/acme/widgets.git',
      githubOwner: 'acme',
      githubRepo: 'widgets',
    })
  })

  it('normal flow: no github metadata for GitLab repos', () => {
    const result = assembleNormalFlowOptions({
      remoteUrl: 'git@gitlab.com:team/project.git',
      remoteType: 'gitlab',
    })
    expect(result).toEqual({
      repository: 'git@gitlab.com:team/project.git',
    })
    expect(result).not.toHaveProperty('githubOwner')
    expect(result).not.toHaveProperty('githubRepo')
  })

  it('normal flow: no github metadata for generic git remotes', () => {
    const result = assembleNormalFlowOptions({
      remoteUrl: 'git@internal.company.com:team/project.git',
      remoteType: 'generic',
    })
    expect(result).toEqual({
      repository: 'git@internal.company.com:team/project.git',
    })
    expect(result).not.toHaveProperty('githubOwner')
    expect(result).not.toHaveProperty('githubRepo')
  })

  it('normal flow: no metadata when detection is null', () => {
    const result = assembleNormalFlowOptions(null)
    expect(result).toEqual({ repository: undefined })
    expect(result).not.toHaveProperty('githubOwner')
    expect(result).not.toHaveProperty('githubRepo')
  })

  it('normal flow: no metadata when remoteUrl is undefined (local dir)', () => {
    const result = assembleNormalFlowOptions({ remoteType: 'none' })
    expect(result).toEqual({ repository: undefined })
    expect(result).not.toHaveProperty('githubOwner')
    expect(result).not.toHaveProperty('githubRepo')
  })

  it('normal flow: passes repository even for non-github remotes', () => {
    const result = assembleNormalFlowOptions({
      remoteUrl: 'git@bitbucket.org:team/project.git',
      remoteType: 'bitbucket',
    })
    expect(result.repository).toBe('git@bitbucket.org:team/project.git')
  })

  // ── Regeneration flow ───────────────────────────────────────
  it('regen flow: patches github metadata when existing project has none', () => {
    const result = assembleRegenFlowUpdates(
      { remoteUrl: 'git@github.com:acme/widgets.git', remoteType: 'github' },
      { repository: undefined, githubOwner: undefined, githubRepo: undefined },
    )
    expect(result).toEqual({
      repository: 'git@github.com:acme/widgets.git',
      githubOwner: 'acme',
      githubRepo: 'widgets',
    })
  })

  it('regen flow: does NOT overwrite existing github metadata', () => {
    const result = assembleRegenFlowUpdates(
      { remoteUrl: 'git@github.com:new-org/new-repo.git', remoteType: 'github' },
      { repository: 'git@github.com:old-org/old-repo.git', githubOwner: 'old-org', githubRepo: 'old-repo' },
    )
    expect(result.repository).toBe('git@github.com:new-org/new-repo.git')
    expect(result).not.toHaveProperty('githubOwner')
    expect(result).not.toHaveProperty('githubRepo')
  })

  it('regen flow: preserves existing repository when detection has none', () => {
    const result = assembleRegenFlowUpdates(
      null,
      { repository: 'git@github.com:acme/widgets.git', githubOwner: 'acme', githubRepo: 'widgets' },
    )
    expect(result.repository).toBe('git@github.com:acme/widgets.git')
  })

  it('regen flow: no github metadata for non-github detection', () => {
    const result = assembleRegenFlowUpdates(
      { remoteUrl: 'git@gitlab.com:team/project.git', remoteType: 'gitlab' },
      { repository: undefined, githubOwner: undefined, githubRepo: undefined },
    )
    expect(result).toEqual({
      repository: 'git@gitlab.com:team/project.git',
    })
    expect(result).not.toHaveProperty('githubOwner')
    expect(result).not.toHaveProperty('githubRepo')
  })

  it('regen flow: detection URL takes precedence over existing repository', () => {
    const result = assembleRegenFlowUpdates(
      { remoteUrl: 'git@github.com:new-org/new-repo.git', remoteType: 'github' },
      { repository: 'git@github.com:old-org/old-repo.git', githubOwner: undefined, githubRepo: undefined },
    )
    expect(result.repository).toBe('git@github.com:new-org/new-repo.git')
    expect(result).toHaveProperty('githubOwner', 'new-org')
    expect(result).toHaveProperty('githubRepo', 'new-repo')
  })

  it('regen flow: falls back to existing repository when detection has no URL', () => {
    const result = assembleRegenFlowUpdates(
      { remoteType: 'none' },
      { repository: 'git@github.com:acme/widgets.git' },
    )
    expect(result.repository).toBe('git@github.com:acme/widgets.git')
  })
})

// ─── Consistency: extractGitHubOwnerRepo vs detectRemoteType ─────

describe('extractGitHubOwnerRepo and detectRemoteType consistency', () => {
  const githubUrls = [
    'https://github.com/acme/widgets.git',
    'git@github.com:acme/widgets.git',
    'ssh://git@github.com/acme/widgets',
    'http://github.com/acme/widgets',
  ]

  const nonGithubUrls = [
    'git@gitlab.com:acme/widgets.git',
    'https://gitlab.com/acme/widgets.git',
    'git@bitbucket.org:acme/widgets.git',
    'git@internal.server:acme/widgets.git',
  ]

  for (const url of githubUrls) {
    it(`both agree "${url}" is GitHub`, () => {
      expect(detectRemoteType(url)).toBe('github')
      expect(extractGitHubOwnerRepo(url)).not.toBeNull()
    })
  }

  for (const url of nonGithubUrls) {
    it(`both agree "${url}" is NOT GitHub`, () => {
      expect(detectRemoteType(url)).not.toBe('github')
      expect(extractGitHubOwnerRepo(url)).toBeNull()
    })
  }
})
