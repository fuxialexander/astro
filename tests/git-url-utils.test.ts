/**
 * Tests for server-side git URL utility functions.
 *
 * Covers: detectRemoteType, urlsMatchSameRepo from server/lib/git-url-utils.ts
 */
import { describe, it, expect } from 'vitest'
import { detectRemoteType, urlsMatchSameRepo } from '../server/lib/git-url-utils'

// ─── detectRemoteType (server-side) ──────────────────────────────

describe('detectRemoteType (server)', () => {
  it('returns "none" for undefined/empty', () => {
    expect(detectRemoteType(undefined)).toBe('none')
    expect(detectRemoteType('')).toBe('none')
  })

  it('detects GitHub', () => {
    expect(detectRemoteType('git@github.com:user/repo.git')).toBe('github')
    expect(detectRemoteType('https://github.com/user/repo')).toBe('github')
  })

  it('detects GitLab (gitlab.com)', () => {
    expect(detectRemoteType('git@gitlab.com:user/repo.git')).toBe('gitlab')
    expect(detectRemoteType('https://gitlab.com/user/repo')).toBe('gitlab')
  })

  it('detects self-hosted GitLab (gitlab.* domain)', () => {
    expect(detectRemoteType('https://gitlab.company.com/group/repo.git')).toBe('gitlab')
    expect(detectRemoteType('git@gitlab.internal.corp:org/project.git')).toBe('gitlab')
    expect(detectRemoteType('https://gitlab.mit.edu/lab/analysis.git')).toBe('gitlab')
  })

  it('detects Bitbucket', () => {
    expect(detectRemoteType('git@bitbucket.org:user/repo.git')).toBe('bitbucket')
    expect(detectRemoteType('https://bitbucket.org/user/repo')).toBe('bitbucket')
  })

  it('detects self-hosted Bitbucket (bitbucket.* domain)', () => {
    expect(detectRemoteType('https://bitbucket.company.com/scm/proj/repo.git')).toBe('bitbucket')
  })

  it('returns "generic" for unknown git URLs', () => {
    expect(detectRemoteType('git@internal.server.com:user/repo.git')).toBe('generic')
    expect(detectRemoteType('https://git.example.com/user/repo.git')).toBe('generic')
    expect(detectRemoteType('ssh://git@custom-forge.io/org/repo.git')).toBe('generic')
  })

  it('returns "none" for non-URL strings', () => {
    expect(detectRemoteType('/local/path')).toBe('none')
    expect(detectRemoteType('just-text')).toBe('none')
  })
})

// ─── urlsMatchSameRepo (server-side) ─────────────────────────────

describe('urlsMatchSameRepo (server)', () => {
  it('matches SSH and HTTPS for same repo', () => {
    expect(urlsMatchSameRepo(
      'git@github.com:user/repo.git',
      'https://github.com/user/repo.git'
    )).toBe(true)
  })

  it('matches with and without .git', () => {
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
      'git@GitHub.COM:User/Repo.git',
      'https://github.com/user/repo'
    )).toBe(true)
  })

  it('matches cross-protocol for GitLab', () => {
    expect(urlsMatchSameRepo(
      'git@gitlab.com:team/project.git',
      'https://gitlab.com/team/project.git'
    )).toBe(true)
  })

  it('handles ssh:// protocol prefix', () => {
    expect(urlsMatchSameRepo(
      'ssh://git@github.com/user/repo.git',
      'https://github.com/user/repo.git'
    )).toBe(true)
  })
})
