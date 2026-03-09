/**
 * Tests for auto-extraction of githubOwner/githubRepo from repository URL.
 *
 * Covers:
 * 1. extractRepoInfo utility — SSH, HTTPS, edge cases
 * 2. POST /projects auto-extraction logic
 * 3. PATCH /projects/:id auto-extraction logic
 * 4. Explicit githubOwner/githubRepo takes precedence over auto-extraction
 * 5. Repository cleared → GitHub metadata cleared
 * 6. Non-GitHub URLs → no extraction
 */

import { describe, it, expect } from 'vitest'
import { extractRepoInfo } from '../packages/core/src/git-url-utils'

// ─── 1. extractRepoInfo utility ─────────────────────────────────────────────

describe('extractRepoInfo', () => {
  it('extracts owner/repo from SSH URL', () => {
    const result = extractRepoInfo('git@github.com:acme/widgets.git')
    expect(result).toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('extracts owner/repo from SSH URL without .git suffix', () => {
    const result = extractRepoInfo('git@github.com:acme/widgets')
    expect(result).toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('extracts owner/repo from HTTPS URL', () => {
    const result = extractRepoInfo('https://github.com/acme/widgets.git')
    expect(result).toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('extracts owner/repo from HTTPS URL without .git suffix', () => {
    const result = extractRepoInfo('https://github.com/acme/widgets')
    expect(result).toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('extracts owner/repo from HTTP URL', () => {
    const result = extractRepoInfo('http://github.com/acme/widgets.git')
    expect(result).toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('returns null for GitLab SSH URL', () => {
    expect(extractRepoInfo('git@gitlab.com:acme/widgets.git')).toBeNull()
  })

  it('returns null for GitLab HTTPS URL', () => {
    expect(extractRepoInfo('https://gitlab.com/acme/widgets.git')).toBeNull()
  })

  it('returns null for Bitbucket URL', () => {
    expect(extractRepoInfo('git@bitbucket.org:acme/widgets.git')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractRepoInfo('')).toBeNull()
  })

  it('returns null for non-URL string', () => {
    expect(extractRepoInfo('not-a-url')).toBeNull()
  })

  it('handles owner/repo with dots, dashes, underscores', () => {
    const result = extractRepoInfo('git@github.com:my-org/my_repo.name.git')
    expect(result).toEqual({ owner: 'my-org', repo: 'my_repo.name' })
  })

  it('extracts owner/repo from ssh:// protocol URL', () => {
    expect(extractRepoInfo('ssh://git@github.com/acme/widgets'))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('extracts owner/repo from ssh:// protocol URL with .git suffix', () => {
    expect(extractRepoInfo('ssh://git@github.com/acme/widgets.git'))
      .toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('returns null for undefined', () => {
    expect(extractRepoInfo(undefined)).toBeNull()
  })
})

// ─── 2. POST /projects auto-extraction logic ────────────────────────────────

describe('POST /projects — auto-extract githubOwner/githubRepo', () => {
  /**
   * Simulates the auto-extraction logic from server/routes/data.ts POST handler.
   * This mirrors the actual code without needing to spin up the full server.
   */
  function simulatePostExtraction(body: {
    repository?: string
    githubOwner?: string | null
    githubRepo?: string | null
  }) {
    const githubOwner = body.githubOwner || null
    const githubRepo = body.githubRepo || null

    let finalGithubOwner = githubOwner
    let finalGithubRepo = githubRepo
    if (finalGithubOwner === null && finalGithubRepo === null && body.repository) {
      const extracted = extractRepoInfo(body.repository)
      if (extracted) {
        finalGithubOwner = extracted.owner
        finalGithubRepo = extracted.repo
      }
    }
    return { githubOwner: finalGithubOwner, githubRepo: finalGithubRepo }
  }

  it('auto-extracts from GitHub SSH repository URL', () => {
    const result = simulatePostExtraction({
      repository: 'git@github.com:acme/widgets.git',
    })
    expect(result).toEqual({ githubOwner: 'acme', githubRepo: 'widgets' })
  })

  it('auto-extracts from GitHub HTTPS repository URL', () => {
    const result = simulatePostExtraction({
      repository: 'https://github.com/acme/widgets.git',
    })
    expect(result).toEqual({ githubOwner: 'acme', githubRepo: 'widgets' })
  })

  it('does not extract from non-GitHub repository URL', () => {
    const result = simulatePostExtraction({
      repository: 'git@gitlab.com:acme/widgets.git',
    })
    expect(result).toEqual({ githubOwner: null, githubRepo: null })
  })

  it('does not extract when no repository is provided', () => {
    const result = simulatePostExtraction({})
    expect(result).toEqual({ githubOwner: null, githubRepo: null })
  })

  it('explicit githubOwner/githubRepo takes precedence', () => {
    const result = simulatePostExtraction({
      repository: 'git@github.com:acme/widgets.git',
      githubOwner: 'custom-owner',
      githubRepo: 'custom-repo',
    })
    expect(result).toEqual({ githubOwner: 'custom-owner', githubRepo: 'custom-repo' })
  })

  it('does not overwrite explicit githubOwner even if extraction would succeed', () => {
    const result = simulatePostExtraction({
      repository: 'git@github.com:acme/widgets.git',
      githubOwner: 'explicit-owner',
      githubRepo: 'explicit-repo',
    })
    expect(result.githubOwner).toBe('explicit-owner')
    expect(result.githubRepo).toBe('explicit-repo')
  })
})

// ─── 3. PATCH /projects/:id auto-extraction logic ───────────────────────────

describe('PATCH /projects/:id — auto-extract githubOwner/githubRepo', () => {
  /**
   * Simulates the auto-extraction logic from server/routes/data.ts PATCH handler.
   */
  function simulatePatchExtraction(body: {
    repository?: string
    githubOwner?: string | null
    githubRepo?: string | null
  }) {
    const patch: Record<string, unknown> = {}
    if (body.repository !== undefined) patch.repository = body.repository || null

    const githubOwnerProvided = body.githubOwner !== undefined
    const githubRepoProvided = body.githubRepo !== undefined

    if (body.repository !== undefined && !githubOwnerProvided && !githubRepoProvided) {
      const repoUrl = body.repository || null
      if (repoUrl) {
        const extracted = extractRepoInfo(repoUrl)
        if (extracted) {
          patch.githubOwner = extracted.owner
          patch.githubRepo = extracted.repo
        }
      } else {
        patch.githubOwner = null
        patch.githubRepo = null
        patch.githubRepoId = null
      }
    }

    return patch
  }

  it('auto-extracts when repository is updated to a GitHub URL', () => {
    const patch = simulatePatchExtraction({
      repository: 'git@github.com:org/project.git',
    })
    expect(patch.githubOwner).toBe('org')
    expect(patch.githubRepo).toBe('project')
  })

  it('auto-extracts from HTTPS GitHub URL on update', () => {
    const patch = simulatePatchExtraction({
      repository: 'https://github.com/org/project',
    })
    expect(patch.githubOwner).toBe('org')
    expect(patch.githubRepo).toBe('project')
  })

  it('does not extract from non-GitHub URL on update', () => {
    const patch = simulatePatchExtraction({
      repository: 'git@gitlab.com:org/project.git',
    })
    expect(patch.githubOwner).toBeUndefined()
    expect(patch.githubRepo).toBeUndefined()
  })

  it('clears GitHub metadata when repository is cleared', () => {
    const patch = simulatePatchExtraction({
      repository: '',
    })
    expect(patch.githubOwner).toBeNull()
    expect(patch.githubRepo).toBeNull()
    expect(patch.githubRepoId).toBeNull()
  })

  it('does not auto-extract when githubOwner is explicitly provided', () => {
    const patch = simulatePatchExtraction({
      repository: 'git@github.com:acme/widgets.git',
      githubOwner: 'manual-owner',
    })
    // Auto-extraction should NOT have run since githubOwner was explicitly provided
    expect(patch.githubOwner).toBeUndefined()
    expect(patch.githubRepo).toBeUndefined()
  })

  it('does not auto-extract when githubRepo is explicitly provided', () => {
    const patch = simulatePatchExtraction({
      repository: 'git@github.com:acme/widgets.git',
      githubRepo: 'manual-repo',
    })
    expect(patch.githubOwner).toBeUndefined()
    expect(patch.githubRepo).toBeUndefined()
  })

  it('does not touch GitHub metadata when repository is not in patch', () => {
    const patch = simulatePatchExtraction({})
    expect(patch.githubOwner).toBeUndefined()
    expect(patch.githubRepo).toBeUndefined()
  })
})
