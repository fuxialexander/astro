import { describe, it, expect } from 'vitest'
import { projectWorktreePath, resolveFilePathForBrowsing } from '../src/components/task-detail/file-path-utils'

describe('projectWorktreePath', () => {
  it('derives worktree path from standard project branch', () => {
    expect(projectWorktreePath('/home/user/project', 'astro/abc123'))
      .toBe('/home/user/project/.astro/worktrees/abc123')
  })

  it('handles multi-segment branch prefix', () => {
    expect(projectWorktreePath('/home/user/project', 'org/team/def456'))
      .toBe('/home/user/project/.astro/worktrees/def456')
  })

  it('handles bare branch name without prefix', () => {
    expect(projectWorktreePath('/home/user/project', 'mybranch'))
      .toBe('/home/user/project/.astro/worktrees/mybranch')
  })

  it('strips trailing slash from working directory', () => {
    expect(projectWorktreePath('/home/user/project/', 'astro/abc123'))
      .toBe('/home/user/project/.astro/worktrees/abc123')
  })
})

describe('resolveFilePathForBrowsing', () => {
  const browseDir = '/home/user/project/.astro/worktrees/abc123'

  describe('worktree paths (from real-time adapter file_change events)', () => {
    it('strips task worktree prefix and resolves into browse dir', () => {
      const taskWorktreePath = '/home/user/project/.astro/worktrees/abc123-n1/src/app.tsx'
      expect(resolveFilePathForBrowsing(taskWorktreePath, browseDir))
        .toBe('/home/user/project/.astro/worktrees/abc123/src/app.tsx')
    })

    it('handles nested directory in worktree path', () => {
      const path = '/home/user/project/.astro/worktrees/def456/src/components/deep/file.ts'
      expect(resolveFilePathForBrowsing(path, browseDir))
        .toBe('/home/user/project/.astro/worktrees/abc123/src/components/deep/file.ts')
    })

    it('handles relative worktree path', () => {
      const path = '.astro/worktrees/task-xyz/README.md'
      expect(resolveFilePathForBrowsing(path, browseDir))
        .toBe('/home/user/project/.astro/worktrees/abc123/README.md')
    })
  })

  describe('relative paths (from git diff --numstat)', () => {
    it('prepends browse dir to relative path', () => {
      expect(resolveFilePathForBrowsing('src/app.tsx', browseDir))
        .toBe('/home/user/project/.astro/worktrees/abc123/src/app.tsx')
    })

    it('handles deeply nested relative path', () => {
      expect(resolveFilePathForBrowsing('src/components/ui/button.tsx', browseDir))
        .toBe('/home/user/project/.astro/worktrees/abc123/src/components/ui/button.tsx')
    })

    it('handles root-level file', () => {
      expect(resolveFilePathForBrowsing('package.json', browseDir))
        .toBe('/home/user/project/.astro/worktrees/abc123/package.json')
    })
  })

  describe('absolute paths (non-worktree)', () => {
    it('passes through absolute paths unchanged', () => {
      expect(resolveFilePathForBrowsing('/tmp/some-file.txt', browseDir))
        .toBe('/tmp/some-file.txt')
    })
  })

  describe('with base working directory (no project branch)', () => {
    const baseDir = '/home/user/project'

    it('resolves relative path into base dir', () => {
      expect(resolveFilePathForBrowsing('src/app.tsx', baseDir))
        .toBe('/home/user/project/src/app.tsx')
    })

    it('strips worktree prefix and resolves into base dir', () => {
      const path = '/home/user/project/.astro/worktrees/abc123-n1/src/app.tsx'
      expect(resolveFilePathForBrowsing(path, baseDir))
        .toBe('/home/user/project/src/app.tsx')
    })
  })

  describe('edge cases', () => {
    it('handles trailing slash on browse dir', () => {
      expect(resolveFilePathForBrowsing('src/app.tsx', browseDir + '/'))
        .toBe('/home/user/project/.astro/worktrees/abc123/src/app.tsx')
    })
  })
})
