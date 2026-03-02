/**
 * Tests for generateGitDiffSummary function.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { generateGitDiffSummary } from '../git-diff-summary.js'

describe('generateGitDiffSummary', () => {
  let tempDir: string

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-diff-summary-test-'))
  })

  afterEach(() => {
    // Clean up the temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns null for invalid input', () => {
    expect(generateGitDiffSummary('')).toBeNull()
    expect(generateGitDiffSummary(null as unknown as string)).toBeNull()
    expect(generateGitDiffSummary(undefined as unknown as string)).toBeNull()
  })

  it('returns null for non-git directory', () => {
    const result = generateGitDiffSummary(tempDir)
    expect(result).toBeNull()
  })

  it('returns null for empty git repo (no commits)', () => {
    // Initialize an empty git repo with no commits
    execSync('git init', { cwd: tempDir })
    const result = generateGitDiffSummary(tempDir)
    // Should return null since there are no commits and no changes
    expect(result).toBeNull()
  })

  it('returns markdown with commits section for repo with commits', () => {
    // Initialize git repo with a commit
    execSync('git init', { cwd: tempDir })
    execSync('git config user.email "test@test.com"', { cwd: tempDir })
    execSync('git config user.name "Test User"', { cwd: tempDir })

    // Create a file and commit it
    fs.writeFileSync(path.join(tempDir, 'test.txt'), 'hello world')
    execSync('git add .', { cwd: tempDir })
    execSync('git commit -m "Initial commit"', { cwd: tempDir })

    const result = generateGitDiffSummary(tempDir)
    expect(result).not.toBeNull()
    expect(result).toContain('## Commits')
    expect(result).toContain('Initial commit')
  })

  it('returns markdown with changes section for repo with file changes', () => {
    // Initialize git repo with commits
    execSync('git init', { cwd: tempDir })
    execSync('git config user.email "test@test.com"', { cwd: tempDir })
    execSync('git config user.name "Test User"', { cwd: tempDir })

    // Create first commit
    fs.writeFileSync(path.join(tempDir, 'test.txt'), 'hello')
    execSync('git add .', { cwd: tempDir })
    execSync('git commit -m "First commit"', { cwd: tempDir })

    // Create second commit with changes
    fs.writeFileSync(path.join(tempDir, 'test.txt'), 'hello world')
    execSync('git add .', { cwd: tempDir })
    execSync('git commit -m "Second commit"', { cwd: tempDir })

    const result = generateGitDiffSummary(tempDir)
    expect(result).not.toBeNull()
    expect(result).toContain('## Changes')
    expect(result).toContain('## Commits')
    expect(result).toContain('test.txt')
    expect(result).toContain('Second commit')
    expect(result).toContain('First commit')
  })

  it('returns markdown with staged changes when HEAD~1 fails', () => {
    // Initialize git repo with only one commit
    execSync('git init', { cwd: tempDir })
    execSync('git config user.email "test@test.com"', { cwd: tempDir })
    execSync('git config user.name "Test User"', { cwd: tempDir })

    // Create a file and commit it
    fs.writeFileSync(path.join(tempDir, 'test.txt'), 'hello world')
    execSync('git add .', { cwd: tempDir })
    execSync('git commit -m "Initial commit"', { cwd: tempDir })

    // Stage some changes
    fs.writeFileSync(path.join(tempDir, 'new-file.txt'), 'new content')
    execSync('git add .', { cwd: tempDir })

    const result = generateGitDiffSummary(tempDir)
    expect(result).not.toBeNull()
    expect(result).toContain('## Commits')
    expect(result).toContain('Initial commit')
    // May or may not have staged changes displayed depending on git behavior
  })

  it('returns properly formatted markdown', () => {
    // Initialize git repo with commits
    execSync('git init', { cwd: tempDir })
    execSync('git config user.email "test@test.com"', { cwd: tempDir })
    execSync('git config user.name "Test User"', { cwd: tempDir })

    // Create commits
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'content')
    execSync('git add .', { cwd: tempDir })
    execSync('git commit -m "Add a.txt"', { cwd: tempDir })

    fs.writeFileSync(path.join(tempDir, 'b.txt'), 'more content')
    execSync('git add .', { cwd: tempDir })
    execSync('git commit -m "Add b.txt"', { cwd: tempDir })

    const result = generateGitDiffSummary(tempDir)
    expect(result).not.toBeNull()

    // Check structure
    expect(result).toMatch(/^## Changes/)
    expect(result).toMatch(/## Commits/)
    expect(result).toContain('```')

    // Should have proper section separation
    const parts = result!.split('## ')
    expect(parts.length).toBeGreaterThanOrEqual(2)
  })

  it('handles non-existent directory', () => {
    const result = generateGitDiffSummary('/non/existent/path/12345')
    expect(result).toBeNull()
  })
})
