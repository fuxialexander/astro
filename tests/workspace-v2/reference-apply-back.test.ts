/**
 * Real filesystem tests for the reference-mode apply-back workflow.
 *
 * Flow:  createReferenceWorktree → agent writes files in empty worktree
 *        → applyChangesFromCopy → verify changes in original directory
 *
 * No mocking — every assertion verifies on-disk state.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

import {
  createReferenceWorktree,
  applyChangesFromCopy,
} from '../../packages/agent-runner/src/lib/copy-worktree.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestProject(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'astro-ref-apply-test-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content)
  }
  return dir
}

const tmpDirs: string[] = []

afterEach(async () => {
  for (const dir of tmpDirs) {
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true })
    }
  }
  tmpDirs.length = 0
})

function tracked(dir: string): string {
  tmpDirs.push(dir)
  return dir
}

// ===========================================================================
// Tests
// ===========================================================================

describe('reference mode apply-back workflow', () => {
  it('full workflow: create reference worktree → write files → apply back', async () => {
    const projectDir = tracked(
      createTestProject({
        'src/index.ts': 'export default 42;',
        'README.md': '# Hello',
      }),
    )

    // Step 1: Create reference worktree (empty directory + file map)
    const ref = await createReferenceWorktree(projectDir, '.astro', 'ref-apply-1')
    expect(existsSync(ref.worktreePath)).toBe(true)
    expect(ref.fileMap.length).toBe(2)

    // Step 2: Simulate agent work — write a new file in the worktree
    mkdirSync(join(ref.worktreePath, 'src'), { recursive: true })
    writeFileSync(join(ref.worktreePath, 'src/new-module.ts'), 'export const x = 1;')

    // Step 3: Apply changes back to original
    const result = await applyChangesFromCopy(ref.worktreePath, projectDir, '.astro')

    // New file should be created in original
    expect(result.created).toContain('src/new-module.ts')
    expect(existsSync(join(projectDir, 'src/new-module.ts'))).toBe(true)
    expect(readFileSync(join(projectDir, 'src/new-module.ts'), 'utf-8')).toBe('export const x = 1;')

    // Original files not in worktree appear as deleted (but not physically removed)
    expect(result.deleted).toContain('src/index.ts')
    expect(result.deleted).toContain('README.md')
    // They still exist on disk (applyChangesFromCopy does NOT remove files)
    expect(existsSync(join(projectDir, 'src/index.ts'))).toBe(true)
    expect(existsSync(join(projectDir, 'README.md'))).toBe(true)

    await ref.cleanup()
  })

  it('agent copies from original, edits, saves in worktree → apply-back updates original', async () => {
    const projectDir = tracked(
      createTestProject({
        'src/app.ts': 'const version = "1.0.0";',
        'config.json': '{"debug": false}',
      }),
    )

    const ref = await createReferenceWorktree(projectDir, '.astro', 'ref-apply-2')

    // Simulate: agent reads from original via absolute path, edits, writes to worktree
    const originalContent = readFileSync(join(projectDir, 'src/app.ts'), 'utf-8')
    const editedContent = originalContent.replace('1.0.0', '2.0.0')

    mkdirSync(join(ref.worktreePath, 'src'), { recursive: true })
    writeFileSync(join(ref.worktreePath, 'src/app.ts'), editedContent)

    // Also copy config.json unchanged
    writeFileSync(
      join(ref.worktreePath, 'config.json'),
      readFileSync(join(projectDir, 'config.json')),
    )

    const result = await applyChangesFromCopy(ref.worktreePath, projectDir, '.astro')

    // app.ts should be modified
    expect(result.modified).toContain('src/app.ts')
    expect(readFileSync(join(projectDir, 'src/app.ts'), 'utf-8')).toBe(
      'const version = "2.0.0";',
    )

    // config.json is unchanged — should NOT appear in modified
    expect(result.modified).not.toContain('config.json')

    await ref.cleanup()
  })

  it('files in original that agent did not touch remain unchanged', async () => {
    const projectDir = tracked(
      createTestProject({
        'src/a.ts': 'const a = 1;',
        'src/b.ts': 'const b = 2;',
        'data/train.csv': 'col1,col2\n1,2\n3,4',
      }),
    )

    const ref = await createReferenceWorktree(projectDir, '.astro', 'ref-apply-3')

    // Agent only touches src/a.ts (copies and edits)
    mkdirSync(join(ref.worktreePath, 'src'), { recursive: true })
    writeFileSync(join(ref.worktreePath, 'src/a.ts'), 'const a = 100;')

    const result = await applyChangesFromCopy(ref.worktreePath, projectDir, '.astro')

    // a.ts modified
    expect(result.modified).toContain('src/a.ts')
    expect(readFileSync(join(projectDir, 'src/a.ts'), 'utf-8')).toBe('const a = 100;')

    // b.ts and data/train.csv are untouched on disk
    expect(readFileSync(join(projectDir, 'src/b.ts'), 'utf-8')).toBe('const b = 2;')
    expect(readFileSync(join(projectDir, 'data/train.csv'), 'utf-8')).toBe(
      'col1,col2\n1,2\n3,4',
    )

    // They show as "deleted" in the result since they're not in the worktree
    expect(result.deleted).toContain('src/b.ts')
    expect(result.deleted).toContain('data/train.csv')

    await ref.cleanup()
  })

  it('binary data files in original are NOT physically deleted even if absent in worktree', async () => {
    const binaryData = Buffer.alloc(2_000_000, 0xab)
    const projectDir = tracked(
      createTestProject({
        'src/main.py': 'print("hello")',
        'data/model.bin': binaryData,
        'data/features.npy': Buffer.alloc(500_000, 0xcd),
      }),
    )

    const ref = await createReferenceWorktree(projectDir, '.astro', 'ref-apply-4')

    // Agent only writes code files, ignoring data
    mkdirSync(join(ref.worktreePath, 'src'), { recursive: true })
    writeFileSync(join(ref.worktreePath, 'src/main.py'), 'print("updated")')

    const result = await applyChangesFromCopy(ref.worktreePath, projectDir, '.astro')

    // Data files are reported as deleted but NOT physically removed
    expect(result.deleted).toContain('data/model.bin')
    expect(result.deleted).toContain('data/features.npy')
    expect(existsSync(join(projectDir, 'data/model.bin'))).toBe(true)
    expect(existsSync(join(projectDir, 'data/features.npy'))).toBe(true)

    // Binary content untouched
    const ondisk = readFileSync(join(projectDir, 'data/model.bin'))
    expect(ondisk.equals(binaryData)).toBe(true)

    await ref.cleanup()
  })

  it('cleanup removes the worktree directory', async () => {
    const projectDir = tracked(
      createTestProject({
        'file.txt': 'content',
      }),
    )

    const ref = await createReferenceWorktree(projectDir, '.astro', 'ref-apply-5')
    expect(existsSync(ref.worktreePath)).toBe(true)

    // Write something to simulate agent work
    writeFileSync(join(ref.worktreePath, 'output.txt'), 'result')
    expect(existsSync(join(ref.worktreePath, 'output.txt'))).toBe(true)

    await ref.cleanup()
    expect(existsSync(ref.worktreePath)).toBe(false)
  })

  it('apply-back handles new files in nested directories', async () => {
    const projectDir = tracked(
      createTestProject({
        'src/index.ts': 'export {};',
      }),
    )

    const ref = await createReferenceWorktree(projectDir, '.astro', 'ref-apply-6')

    // Agent creates deeply nested new files
    mkdirSync(join(ref.worktreePath, 'src/lib/utils'), { recursive: true })
    writeFileSync(join(ref.worktreePath, 'src/lib/utils/helpers.ts'), 'export const helper = () => {};')
    writeFileSync(join(ref.worktreePath, 'src/lib/constants.ts'), 'export const MAX = 100;')

    const result = await applyChangesFromCopy(ref.worktreePath, projectDir, '.astro')

    expect(result.created).toContain('src/lib/utils/helpers.ts')
    expect(result.created).toContain('src/lib/constants.ts')

    // Files actually created in original
    expect(readFileSync(join(projectDir, 'src/lib/utils/helpers.ts'), 'utf-8')).toBe(
      'export const helper = () => {};',
    )
    expect(readFileSync(join(projectDir, 'src/lib/constants.ts'), 'utf-8')).toBe(
      'export const MAX = 100;',
    )

    await ref.cleanup()
  })
})
