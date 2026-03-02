/**
 * Summary Utils Tests
 *
 * Tests for git diff summary generation utilities.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  generateGitDiffSummary,
  generateGitDiffSummaryWithOptions,
} from '../packages/core/src/dispatch/summary-utils.js'

// ============================================================================
// Test Setup
// ============================================================================

let testDir: string

beforeEach(() => {
  // Create a temporary directory for each test
  testDir = mkdtempSync(join(tmpdir(), 'summary-utils-test-'))
})

afterEach(() => {
  // Clean up temporary directory
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
})

/**
 * Initialize a git repo in the test directory with some commits
 */
function initGitRepo(options: { commitCount?: number } = {}): void {
  const { commitCount = 2 } = options

  execSync('git init', { cwd: testDir, stdio: 'ignore' })
  execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'ignore' })
  execSync('git config user.name "Test"', { cwd: testDir, stdio: 'ignore' })

  for (let i = 0; i < commitCount; i++) {
    const filename = `file${i}.txt`
    writeFileSync(join(testDir, filename), `Content for file ${i}\nLine 2\nLine 3`)
    execSync(`git add ${filename}`, { cwd: testDir, stdio: 'ignore' })
    execSync(`git commit -m "Commit ${i + 1}: Add ${filename}"`, { cwd: testDir, stdio: 'ignore' })
  }
}

// ============================================================================
// generateGitDiffSummary Tests
// ============================================================================

describe('generateGitDiffSummary', () => {
  it('should return null for non-existent path', () => {
    const result = generateGitDiffSummary('/path/that/does/not/exist')
    expect(result).toBeNull()
  })

  it('should return null for empty string', () => {
    const result = generateGitDiffSummary('')
    expect(result).toBeNull()
  })

  it('should return null for non-git directory', () => {
    // testDir exists but is not a git repo
    const result = generateGitDiffSummary(testDir)
    expect(result).toBeNull()
  })

  it('should return summary for git repo with commits', () => {
    initGitRepo({ commitCount: 3 })

    const result = generateGitDiffSummary(testDir)

    expect(result).not.toBeNull()
    expect(result).toContain('## Changes')
    expect(result).toContain('## Commits')
    // Should show the commit messages
    expect(result).toContain('Commit')
  })

  it('should include file change stats', () => {
    initGitRepo({ commitCount: 2 })

    // Make another change and commit
    writeFileSync(join(testDir, 'file0.txt'), 'Modified content')
    execSync('git add file0.txt', { cwd: testDir, stdio: 'ignore' })
    execSync('git commit -m "Modify file0"', { cwd: testDir, stdio: 'ignore' })

    const result = generateGitDiffSummary(testDir)

    expect(result).not.toBeNull()
    expect(result).toContain('## Changes')
    // Should show file change info
    expect(result).toContain('file0.txt')
  })

  it('should handle repo with single commit', () => {
    initGitRepo({ commitCount: 1 })

    const result = generateGitDiffSummary(testDir)

    // Should still return something even with only one commit
    // The diff against HEAD~1 will fail, but we have a fallback
    expect(result).not.toBeNull()
    expect(result).toContain('## Commits')
  })
})

// ============================================================================
// generateGitDiffSummaryWithOptions Tests
// ============================================================================

describe('generateGitDiffSummaryWithOptions', () => {
  it('should return null for non-existent path', () => {
    const result = generateGitDiffSummaryWithOptions('/path/that/does/not/exist')
    expect(result).toBeNull()
  })

  it('should return null for non-git directory', () => {
    const result = generateGitDiffSummaryWithOptions(testDir)
    expect(result).toBeNull()
  })

  it('should respect commitCount option', () => {
    initGitRepo({ commitCount: 10 })

    const result = generateGitDiffSummaryWithOptions(testDir, { commitCount: 3 })

    expect(result).not.toBeNull()
    // Count the number of commits shown (each commit is on its own line after "## Commits")
    const commitsSection = result!.split('## Commits')[1]
    const commitLines = commitsSection.split('\n').filter(line => line.trim().length > 0)
    expect(commitLines.length).toBeLessThanOrEqual(3)
  })

  it('should use custom timeout', () => {
    initGitRepo({ commitCount: 2 })

    // Just verify it works with a custom timeout
    const result = generateGitDiffSummaryWithOptions(testDir, { timeout: 5000 })
    expect(result).not.toBeNull()
  })

  it('should use custom baseRef', () => {
    initGitRepo({ commitCount: 5 })

    // Get the hash of a few commits back
    const hash = execSync('git rev-parse HEAD~3', {
      cwd: testDir,
      encoding: 'utf-8'
    }).trim()

    const result = generateGitDiffSummaryWithOptions(testDir, { baseRef: hash })

    expect(result).not.toBeNull()
    expect(result).toContain('## Changes')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('should handle git worktree (where .git is a file)', () => {
    // Create a main repo
    const mainDir = mkdtempSync(join(tmpdir(), 'main-repo-'))
    execSync('git init', { cwd: mainDir, stdio: 'ignore' })
    execSync('git config user.email "test@test.com"', { cwd: mainDir, stdio: 'ignore' })
    execSync('git config user.name "Test"', { cwd: mainDir, stdio: 'ignore' })
    writeFileSync(join(mainDir, 'file.txt'), 'Content')
    execSync('git add file.txt', { cwd: mainDir, stdio: 'ignore' })
    execSync('git commit -m "Initial commit"', { cwd: mainDir, stdio: 'ignore' })

    // Create a worktree
    const worktreeDir = join(tmpdir(), `worktree-${Date.now()}`)
    execSync(`git worktree add ${worktreeDir} -b test-branch`, { cwd: mainDir, stdio: 'ignore' })

    try {
      const result = generateGitDiffSummary(worktreeDir)

      // Should work with worktrees (where .git is a file, not a directory)
      expect(result).not.toBeNull()
      expect(result).toContain('## Commits')
    } finally {
      // Clean up
      execSync(`git worktree remove ${worktreeDir}`, { cwd: mainDir, stdio: 'ignore' })
      rmSync(mainDir, { recursive: true, force: true })
    }
  })

  it('should handle invalid path types gracefully', () => {
    // @ts-expect-error - Testing invalid input
    expect(generateGitDiffSummary(null)).toBeNull()
    // @ts-expect-error - Testing invalid input
    expect(generateGitDiffSummary(undefined)).toBeNull()
    // @ts-expect-error - Testing invalid input
    expect(generateGitDiffSummary(123)).toBeNull()
  })
})
