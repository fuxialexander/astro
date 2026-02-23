/**
 * Integration tests for Workspace V2 server-side features:
 *
 * A. Dispatch route schema validation with workspace fields (deliveryMode, agentDir, worktreeStrategy)
 * B. ensureAgentDir() real filesystem behavior
 * C. setupProjectRepo() integration with real git repos
 *
 * Uses PGlite-backed test server for dispatch route tests and real
 * temporary git repos for repo-setup tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestServer, postJson } from '../helpers/test-server.js'
import { ensureAgentDir, setupProjectRepo } from '../../server/lib/repo-setup.js'
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Test server setup (PGlite, local mode)
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await setupTestServer()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Directories created during tests -- cleaned up in afterAll. */
const tmpDirs: string[] = []

/**
 * Create a real git repository in a temporary directory with:
 *  - git init
 *  - user config
 *  - one initial commit containing README.md
 *  - on `main` branch
 */
function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'astro-dispatch-test-'))
  tmpDirs.push(dir)
  execFileSync('git', ['init'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), '# Test\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir })
  return dir
}

/**
 * Create a plain temporary directory (no git).
 */
function createTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'astro-dispatch-test-plain-'))
  tmpDirs.push(dir)
  return dir
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  for (const dir of tmpDirs) {
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
})

// ===========================================================================
// A. Dispatch route schema validation (POST /api/dispatch/task)
// ===========================================================================

describe('Dispatch route schema validation', { timeout: 30_000 }, () => {
  /** Base body that passes required field validation (dryRun=true skips actual dispatch). */
  const baseBody = {
    nodeId: 'n1',
    projectId: 'p1',
    title: 'Test task',
    description: 'Test task description',
    workingDirectory: '/tmp/test',
    dryRun: true,
  }

  // 1. Accepts all delivery modes
  it.each(['pr', 'push', 'branch', 'copy', 'direct'] as const)(
    'accepts deliveryMode=%s',
    async (mode) => {
      const res = await postJson('/api/dispatch/task', {
        ...baseBody,
        deliveryMode: mode,
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.dryRun).toBe(true)
      expect(body.success).toBe(true)
    },
  )

  // 2. Accepts agentDir field
  it('accepts agentDir field', async () => {
    const res = await postJson('/api/dispatch/task', {
      ...baseBody,
      agentDir: '.myagent',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.success).toBe(true)
  })

  // 3. Accepts all worktreeStrategy values
  it.each(['copy', 'reference', 'direct'] as const)(
    'accepts worktreeStrategy=%s',
    async (strategy) => {
      const res = await postJson('/api/dispatch/task', {
        ...baseBody,
        worktreeStrategy: strategy,
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.dryRun).toBe(true)
      expect(body.success).toBe(true)
    },
  )

  // 4. Rejects invalid deliveryMode
  it('rejects invalid deliveryMode', async () => {
    const res = await postJson('/api/dispatch/task', {
      ...baseBody,
      deliveryMode: 'invalid',
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Invalid input')
  })

  // 5. Rejects invalid worktreeStrategy
  it('rejects invalid worktreeStrategy', async () => {
    const res = await postJson('/api/dispatch/task', {
      ...baseBody,
      worktreeStrategy: 'invalid',
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Invalid input')
  })

  // 6. Accepts deliveryMode=direct (serial execution constraint tested separately)
  it('accepts deliveryMode=direct with dryRun', async () => {
    const res = await postJson('/api/dispatch/task', {
      ...baseBody,
      deliveryMode: 'direct',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.dryRun).toBe(true)
  })

  // Extra: Rejects missing required fields
  it('rejects missing workingDirectory when not dryRun', async () => {
    const res = await postJson('/api/dispatch/task', {
      nodeId: 'n1',
      projectId: 'p1',
      title: 'Test',
      description: 'Test desc',
      dryRun: false,
    })
    // Should get 400 because workingDirectory is required for actual dispatch
    expect(res.status).toBe(400)
  })

  // Extra: Accepts remoteType field
  it.each(['github', 'gitlab', 'bitbucket', 'generic', 'none'] as const)(
    'accepts remoteType=%s',
    async (rt) => {
      const res = await postJson('/api/dispatch/task', {
        ...baseBody,
        remoteType: rt,
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    },
  )
})

// ===========================================================================
// B. ensureAgentDir (real filesystem)
// ===========================================================================

describe('ensureAgentDir', { timeout: 30_000 }, () => {
  // 7. Creates .astro dir with config.json in git repo
  it('creates .astro dir with config.json in a git repo', () => {
    const dir = createTmpGitRepo()

    const result = ensureAgentDir(dir)
    expect(result.agentDir).toBe('.astro')

    const agentDirPath = join(dir, '.astro')
    expect(existsSync(agentDirPath)).toBe(true)

    const configPath = join(agentDirPath, 'config.json')
    expect(existsSync(configPath)).toBe(true)

    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(config).toHaveProperty('baseBranch')
    expect(config).toHaveProperty('branchPrefix', 'astro/')
    expect(config).toHaveProperty('remoteType')
    expect(config).toHaveProperty('deliveryMode')
  })

  // 8. Detects baseBranch from git
  it('detects baseBranch from git (main)', () => {
    const dir = createTmpGitRepo()

    ensureAgentDir(dir)
    const configPath = join(dir, '.astro', 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(config.baseBranch).toBe('main')
  })

  // 9. Updates .gitignore with agent dir entries
  it('updates .gitignore with agent dir entries', () => {
    const dir = createTmpGitRepo()
    // Write an existing .gitignore
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')

    ensureAgentDir(dir)

    const gitignoreContent = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(gitignoreContent).toContain('.astro/worktrees/')
    expect(gitignoreContent).toContain('.astro/cache/')
    // Should preserve existing content
    expect(gitignoreContent).toContain('node_modules/')
  })

  // 10. Uses custom agentDir name
  it('uses custom agentDir name', () => {
    const dir = createTmpGitRepo()

    const result = ensureAgentDir(dir, '.myagent')
    expect(result.agentDir).toBe('.myagent')

    expect(existsSync(join(dir, '.myagent'))).toBe(true)
    expect(existsSync(join(dir, '.myagent', 'config.json'))).toBe(true)

    const gitignoreContent = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(gitignoreContent).toContain('.myagent/worktrees/')
    expect(gitignoreContent).toContain('.myagent/cache/')
  })

  // 11. Idempotent: doesn't overwrite existing config.json
  it('does not overwrite existing config.json', () => {
    const dir = createTmpGitRepo()

    // Write custom config before calling ensureAgentDir
    const agentDirPath = join(dir, '.astro')
    mkdirSync(agentDirPath, { recursive: true })
    const customConfig = { branchPrefix: 'custom/', baseBranch: 'develop' }
    writeFileSync(
      join(agentDirPath, 'config.json'),
      JSON.stringify(customConfig, null, 2) + '\n',
      'utf-8',
    )

    ensureAgentDir(dir)

    const config = JSON.parse(readFileSync(join(agentDirPath, 'config.json'), 'utf-8'))
    expect(config.branchPrefix).toBe('custom/')
    expect(config.baseBranch).toBe('develop')
  })

  // 12. Works in non-git directory
  it('works in non-git directory', () => {
    const dir = createTmpDir()

    const result = ensureAgentDir(dir)
    expect(result.agentDir).toBe('.astro')
    expect(existsSync(join(dir, '.astro'))).toBe(true)
    expect(existsSync(join(dir, '.astro', 'config.json'))).toBe(true)

    const config = JSON.parse(readFileSync(join(dir, '.astro', 'config.json'), 'utf-8'))
    // In non-git dir, baseBranch defaults to 'main'
    expect(config.baseBranch).toBe('main')
  })
})

// ===========================================================================
// C. setupProjectRepo integration
// ===========================================================================

describe('setupProjectRepo', { timeout: 30_000 }, () => {
  // 13. Creates project from scratch (no dir, no repo)
  it('creates project from scratch when no directory or repo given', () => {
    const result = setupProjectRepo({
      projectId: `test-scratch-${Date.now()}`,
      projectName: 'Test Scratch',
    })

    // Track for cleanup
    tmpDirs.push(result.workingDirectory)

    // Should create a directory under ~/.astro/projects/
    expect(result.workingDirectory).toContain('.astro')
    expect(result.workingDirectory).toContain('projects')
    expect(existsSync(result.workingDirectory)).toBe(true)

    // Should return agentDir
    expect(result.agentDir).toBe('.astro')

    // .astro/config.json should exist in the project dir
    expect(existsSync(join(result.workingDirectory, '.astro', 'config.json'))).toBe(true)

    // source should be git (since it git-inits a fresh dir)
    expect(result.source).toBeDefined()
    expect(result.source!.isGit).toBe(true)
  })

  // 14. Sets up existing git directory
  it('sets up an existing git directory', () => {
    const dir = createTmpGitRepo()

    const result = setupProjectRepo({
      projectId: 'test-existing-git',
      projectName: 'Test Git',
      workingDirectory: dir,
    })

    expect(result.agentDir).toBe('.astro')
    expect(result.source).toBeDefined()
    expect(result.source!.isGit).toBe(true)
    expect(existsSync(join(dir, '.astro', 'config.json'))).toBe(true)
  })

  // 15. Non-git directory returns needsGitInit
  it('returns needsGitInit for non-git directory', () => {
    const dir = createTmpDir()

    const result = setupProjectRepo({
      projectId: 'test-nongit',
      projectName: 'Test NonGit',
      workingDirectory: dir,
    })

    expect(result.needsGitInit).toBe(true)
    expect(result.deliveryMode).toBe('direct')
    expect(result.source).toBeDefined()
    expect(result.source!.isGit).toBe(false)
  })
})
