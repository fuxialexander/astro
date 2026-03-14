/**
 * Delivery Mode Safety Cache Fix — Comprehensive Tests
 *
 * Validates the fix for stale safety decision cache overriding delivery mode.
 * Tests cover:
 *
 * 1. deriveDefaultDeliveryMode() — server-side fallback mapping
 * 2. Frontend deriveDeliveryMode() — uses isGit to disambiguate remoteType='none'
 * 3. Delivery mode resolution chain — DB ground truth > fallback
 * 4. Safety decision cache isolation — no longer overrides delivery mode
 * 5. Template detection enrichment — DB stores deliveryMode at creation
 * 6. Integration: dryRun dispatch respects DB-stored deliveryMode
 *
 * Pattern: Pure logic simulation + PGlite integration (no external server).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

// ============================================================================
// 1. deriveDefaultDeliveryMode() — server-side fallback
//    Mirrors the function in server/routes/dispatch.ts:105-117
// ============================================================================

type DeliveryMode = 'pr' | 'push' | 'branch' | 'copy' | 'direct'

/**
 * Exact copy of the function from dispatch.ts.
 * The server uses this ONLY as a last-resort fallback when the DB has no deliveryMode.
 */
function deriveDefaultDeliveryMode(remoteType?: string): 'pr' | 'push' | 'branch' | 'direct' {
  switch (remoteType) {
    case 'github':
    case 'gitlab':
    case 'bitbucket':
      return 'pr'
    case 'generic':
      return 'push'
    case 'none':
    default:
      return 'direct'
  }
}

describe('deriveDefaultDeliveryMode (server fallback)', () => {
  it('github → pr', () => {
    expect(deriveDefaultDeliveryMode('github')).toBe('pr')
  })

  it('gitlab → pr', () => {
    expect(deriveDefaultDeliveryMode('gitlab')).toBe('pr')
  })

  it('bitbucket → pr', () => {
    expect(deriveDefaultDeliveryMode('bitbucket')).toBe('pr')
  })

  it('generic → push', () => {
    expect(deriveDefaultDeliveryMode('generic')).toBe('push')
  })

  it('none → direct (ambiguous: could be non-git OR local-git)', () => {
    expect(deriveDefaultDeliveryMode('none')).toBe('direct')
  })

  it('undefined → direct (legacy projects with no source)', () => {
    expect(deriveDefaultDeliveryMode(undefined)).toBe('direct')
  })

  it('unknown string → direct (safe default)', () => {
    expect(deriveDefaultDeliveryMode('unknown-platform')).toBe('direct')
  })

  it('empty string → direct', () => {
    expect(deriveDefaultDeliveryMode('')).toBe('direct')
  })
})

// ============================================================================
// 2. Frontend deriveDeliveryMode() — uses isGit to disambiguate
//    Mirrors src/lib/project-source.ts:41-54
// ============================================================================

interface ProjectSource {
  isGit: boolean
  remoteType: string
  localPath?: string
  baseBranch?: string
  remoteUrl?: string
}

/**
 * Frontend version — HAS isGit, so it can distinguish non-git from local-git.
 * This is what the agent-runner provides and what gets stored in the DB.
 */
function deriveDeliveryModeFrontend(source: ProjectSource): DeliveryMode {
  if (!source.isGit) return 'direct'
  switch (source.remoteType) {
    case 'github':
    case 'gitlab':
    case 'bitbucket':
      return 'pr'
    case 'generic':
      return 'push'
    case 'none':
    default:
      return 'branch'
  }
}

describe('deriveDeliveryMode (frontend, has isGit)', () => {
  it('non-git + remoteType=none → direct', () => {
    expect(deriveDeliveryModeFrontend({ isGit: false, remoteType: 'none' })).toBe('direct')
  })

  it('local git + remoteType=none → branch (key disambiguation)', () => {
    // This is the critical case: server can't distinguish, frontend CAN
    expect(deriveDeliveryModeFrontend({ isGit: true, remoteType: 'none' })).toBe('branch')
  })

  it('git + github → pr', () => {
    expect(deriveDeliveryModeFrontend({ isGit: true, remoteType: 'github' })).toBe('pr')
  })

  it('git + gitlab → pr', () => {
    expect(deriveDeliveryModeFrontend({ isGit: true, remoteType: 'gitlab' })).toBe('pr')
  })

  it('git + bitbucket → pr', () => {
    expect(deriveDeliveryModeFrontend({ isGit: true, remoteType: 'bitbucket' })).toBe('pr')
  })

  it('git + generic → push', () => {
    expect(deriveDeliveryModeFrontend({ isGit: true, remoteType: 'generic' })).toBe('push')
  })

  it('non-git + github (contradictory) → direct (isGit overrides)', () => {
    // Defensive: isGit=false should always produce 'direct' regardless of remoteType
    expect(deriveDeliveryModeFrontend({ isGit: false, remoteType: 'github' })).toBe('direct')
  })
})

// ============================================================================
// 3. Delivery mode resolution chain
//    Simulates the logic at dispatch.ts:482,1251
//    Chain: request body → DB → deriveDefaultDeliveryMode(remoteType)
// ============================================================================

/**
 * Simulates the delivery mode resolution chain in dispatch.ts.
 * This is the core of the fix: DB is the ground truth, fallback is last resort.
 */
function resolveDeliveryMode(opts: {
  bodyDeliveryMode?: DeliveryMode
  dbDeliveryMode?: DeliveryMode | null
  remoteType?: string
  isPushToGithub?: boolean
}): DeliveryMode {
  const { bodyDeliveryMode, dbDeliveryMode, remoteType, isPushToGithub } = opts

  // Step 1: body takes precedence
  let deliveryMode: DeliveryMode | undefined = bodyDeliveryMode

  // Step 2: DB fallback (dispatch.ts:482)
  if (!deliveryMode && dbDeliveryMode) {
    deliveryMode = dbDeliveryMode
  }

  // Step 3: Final resolution (dispatch.ts:1251)
  if (isPushToGithub) return 'push'
  return deliveryMode ?? deriveDefaultDeliveryMode(remoteType)
}

describe('delivery mode resolution chain', () => {
  it('request body takes highest precedence', () => {
    expect(resolveDeliveryMode({
      bodyDeliveryMode: 'branch',
      dbDeliveryMode: 'direct',
      remoteType: 'github',
    })).toBe('branch')
  })

  it('DB deliveryMode used when body is absent', () => {
    expect(resolveDeliveryMode({
      dbDeliveryMode: 'branch',
      remoteType: 'none',
    })).toBe('branch')
  })

  it('DB deliveryMode overrides fallback for local-git (the fix)', () => {
    // Before the fix: DB was null, fallback returned 'direct' for remoteType='none'
    // After the fix: DB stores 'branch' from detection
    expect(resolveDeliveryMode({
      dbDeliveryMode: 'branch',
      remoteType: 'none',
    })).toBe('branch')
  })

  it('fallback fires when both body and DB are absent (legacy project)', () => {
    expect(resolveDeliveryMode({
      remoteType: 'none',
    })).toBe('direct')
  })

  it('fallback fires when DB deliveryMode is null', () => {
    expect(resolveDeliveryMode({
      dbDeliveryMode: null,
      remoteType: 'github',
    })).toBe('pr')
  })

  it('isPushToGithub overrides everything to push', () => {
    expect(resolveDeliveryMode({
      bodyDeliveryMode: 'pr',
      dbDeliveryMode: 'pr',
      remoteType: 'github',
      isPushToGithub: true,
    })).toBe('push')
  })

  describe('normal project creation scenarios', () => {
    it('non-git directory: detection stores direct in DB', () => {
      // Agent-runner: isGit=false, remoteType='none', suggested='direct'
      // Frontend stores deliveryMode='direct' in DB
      expect(resolveDeliveryMode({ dbDeliveryMode: 'direct', remoteType: 'none' })).toBe('direct')
    })

    it('local git, no remote: detection stores branch in DB', () => {
      // Agent-runner: isGit=true, remoteType='none', suggested='branch'
      // Frontend stores deliveryMode='branch' in DB
      expect(resolveDeliveryMode({ dbDeliveryMode: 'branch', remoteType: 'none' })).toBe('branch')
    })

    it('git + GitHub: detection stores pr in DB', () => {
      // Agent-runner: isGit=true, remoteType='github', suggested='pr'
      expect(resolveDeliveryMode({ dbDeliveryMode: 'pr', remoteType: 'github' })).toBe('pr')
    })

    it('git + generic remote: detection stores push in DB', () => {
      expect(resolveDeliveryMode({ dbDeliveryMode: 'push', remoteType: 'generic' })).toBe('push')
    })

    it('no machine connected: DB null, fallback to direct', () => {
      expect(resolveDeliveryMode({ dbDeliveryMode: null, remoteType: undefined })).toBe('direct')
    })
  })

  describe('template project scenarios', () => {
    it('template in non-git dir: detection stores direct', () => {
      expect(resolveDeliveryMode({ dbDeliveryMode: 'direct' })).toBe('direct')
    })

    it('template in local-git dir: detection stores branch', () => {
      expect(resolveDeliveryMode({ dbDeliveryMode: 'branch', remoteType: 'none' })).toBe('branch')
    })

    it('template in dir with GitHub remote: detection stores pr', () => {
      expect(resolveDeliveryMode({ dbDeliveryMode: 'pr', remoteType: 'github' })).toBe('pr')
    })

    it('template with detection failure: DB null, fallback to direct', () => {
      expect(resolveDeliveryMode({ dbDeliveryMode: null })).toBe('direct')
    })

    it('template with no machine: DB null, fallback to direct', () => {
      expect(resolveDeliveryMode({ dbDeliveryMode: null, remoteType: undefined })).toBe('direct')
    })
  })

  describe('regeneration scenarios', () => {
    it('regen after git init: detection updates DB to branch', () => {
      // Previously 'direct', now detection finds git → 'branch'
      expect(resolveDeliveryMode({ dbDeliveryMode: 'branch', remoteType: 'none' })).toBe('branch')
    })

    it('regen with no new detection: existing DB value preserved', () => {
      expect(resolveDeliveryMode({ dbDeliveryMode: 'direct' })).toBe('direct')
    })
  })
})

// ============================================================================
// 4. Safety decision cache isolation
//    Verifies the cache is only used for skipSafetyCheck, not delivery mode
// ============================================================================

describe('safety decision cache isolation', () => {
  /**
   * Simulates the old (broken) logic that used to override delivery mode.
   * This test proves the old behavior was wrong.
   */
  function resolveDeliveryModeOLD(opts: {
    dbDeliveryMode?: DeliveryMode | null
    remoteType?: string
    safetyDecision?: string | null
  }): { deliveryMode: DeliveryMode; useWorktree: boolean } {
    let deliveryMode: DeliveryMode | undefined = opts.dbDeliveryMode ?? undefined
    let useWorktree = true

    // OLD BROKEN: safety decision overrode delivery mode
    if (opts.safetyDecision === 'proceed') {
      deliveryMode = 'direct'
      useWorktree = false
    }

    return {
      deliveryMode: deliveryMode ?? deriveDefaultDeliveryMode(opts.remoteType),
      useWorktree,
    }
  }

  /**
   * Simulates the new (fixed) logic — safety decision only affects skipSafetyCheck.
   */
  function resolveDeliveryModeNEW(opts: {
    dbDeliveryMode?: DeliveryMode | null
    remoteType?: string
    safetyDecision?: string | null
  }): { deliveryMode: DeliveryMode; useWorktree: boolean; skipSafetyCheck: boolean } {
    const deliveryMode: DeliveryMode = opts.dbDeliveryMode
      ?? deriveDefaultDeliveryMode(opts.remoteType)
    const useWorktree = deliveryMode !== 'direct'
    const skipSafetyCheck = opts.safetyDecision !== null

    return { deliveryMode, useWorktree, skipSafetyCheck }
  }

  describe('the stale cache bug (old behavior)', () => {
    it('OLD: safety decision=proceed forced direct even with branch in DB', () => {
      const result = resolveDeliveryModeOLD({
        dbDeliveryMode: 'branch',
        safetyDecision: 'proceed',
      })
      // BUG: this was the wrong behavior
      expect(result.deliveryMode).toBe('direct')
      expect(result.useWorktree).toBe(false)
    })

    it('OLD: safety decision=proceed forced direct even with pr in DB', () => {
      const result = resolveDeliveryModeOLD({
        dbDeliveryMode: 'pr',
        remoteType: 'github',
        safetyDecision: 'proceed',
      })
      // BUG: this was the wrong behavior
      expect(result.deliveryMode).toBe('direct')
      expect(result.useWorktree).toBe(false)
    })
  })

  describe('the fix (new behavior)', () => {
    it('NEW: safety decision=proceed does NOT override delivery mode', () => {
      const result = resolveDeliveryModeNEW({
        dbDeliveryMode: 'branch',
        safetyDecision: 'proceed',
      })
      expect(result.deliveryMode).toBe('branch')
      expect(result.useWorktree).toBe(true)
      expect(result.skipSafetyCheck).toBe(true)
    })

    it('NEW: safety decision=proceed preserves pr mode', () => {
      const result = resolveDeliveryModeNEW({
        dbDeliveryMode: 'pr',
        remoteType: 'github',
        safetyDecision: 'proceed',
      })
      expect(result.deliveryMode).toBe('pr')
      expect(result.useWorktree).toBe(true)
      expect(result.skipSafetyCheck).toBe(true)
    })

    it('NEW: safety decision=null does not enable skipSafetyCheck', () => {
      const result = resolveDeliveryModeNEW({
        dbDeliveryMode: 'branch',
        safetyDecision: null,
      })
      expect(result.deliveryMode).toBe('branch')
      expect(result.skipSafetyCheck).toBe(false)
    })

    it('NEW: direct mode correctly disables worktree', () => {
      const result = resolveDeliveryModeNEW({
        dbDeliveryMode: 'direct',
        safetyDecision: 'proceed',
      })
      expect(result.deliveryMode).toBe('direct')
      expect(result.useWorktree).toBe(false)
      expect(result.skipSafetyCheck).toBe(true)
    })
  })

  describe('the key scenario: user inits git after first run', () => {
    it('first run: non-git dir, safety decision cached', () => {
      const result = resolveDeliveryModeNEW({
        dbDeliveryMode: 'direct',
        safetyDecision: null,
      })
      expect(result.deliveryMode).toBe('direct')
      expect(result.useWorktree).toBe(false)
    })

    it('second run: user inits git, DB updated to branch, stale cache present', () => {
      // DB was updated from 'direct' to 'branch' via regeneration detection
      // The stale safety decision is 'proceed' from the first run
      const result = resolveDeliveryModeNEW({
        dbDeliveryMode: 'branch',      // DB updated by detection
        safetyDecision: 'proceed',      // stale cache from first run
      })
      // FIX: delivery mode follows DB, not cache
      expect(result.deliveryMode).toBe('branch')
      expect(result.useWorktree).toBe(true)
      expect(result.skipSafetyCheck).toBe(true)
    })
  })
})

// ============================================================================
// 5. Agent-runner detection result → DB storage mapping
//    Verifies the mapping from agent-runner's detect response to DB fields
// ============================================================================

interface DetectionResult {
  exists: boolean
  isGit: boolean
  remoteType: string
  suggestedDeliveryMode: string
  baseBranch?: string
  remoteUrl?: string
  error?: string
}

/**
 * Simulates the template detection logic in examples.ts.
 * After project insert, we run detection and update the DB.
 */
function computeDBUpdate(
  detect: DetectionResult,
  originalSource: Record<string, unknown>,
  workingDirectory: string,
): { deliveryMode: string; source: Record<string, unknown> } | null {
  if (!detect.exists || detect.error) return null

  return {
    deliveryMode: detect.suggestedDeliveryMode,
    source: {
      ...originalSource,
      localPath: workingDirectory,
      isGit: detect.isGit,
      remoteType: detect.remoteType,
      ...(detect.baseBranch ? { baseBranch: detect.baseBranch } : {}),
      ...(detect.remoteUrl ? { remoteUrl: detect.remoteUrl } : {}),
    },
  }
}

describe('template detection → DB update mapping', () => {
  const templateSource = { type: 'template', templateId: 'academic-review', templateVersion: '1.0.0' }

  it('non-git directory: stores direct + isGit=false', () => {
    const detect: DetectionResult = {
      exists: true, isGit: false, remoteType: 'none',
      suggestedDeliveryMode: 'direct',
    }
    const result = computeDBUpdate(detect, templateSource, '/home/user/papers')
    expect(result).not.toBeNull()
    expect(result!.deliveryMode).toBe('direct')
    expect(result!.source.isGit).toBe(false)
    expect(result!.source.remoteType).toBe('none')
    expect(result!.source.localPath).toBe('/home/user/papers')
    // Original template fields preserved
    expect(result!.source.type).toBe('template')
    expect(result!.source.templateId).toBe('academic-review')
  })

  it('local git directory: stores branch + isGit=true', () => {
    const detect: DetectionResult = {
      exists: true, isGit: true, remoteType: 'none',
      suggestedDeliveryMode: 'branch',
      baseBranch: 'main',
    }
    const result = computeDBUpdate(detect, templateSource, '/home/user/git-project')
    expect(result).not.toBeNull()
    expect(result!.deliveryMode).toBe('branch')
    expect(result!.source.isGit).toBe(true)
    expect(result!.source.remoteType).toBe('none')
    expect(result!.source.baseBranch).toBe('main')
  })

  it('git with GitHub remote: stores pr + remoteUrl', () => {
    const detect: DetectionResult = {
      exists: true, isGit: true, remoteType: 'github',
      suggestedDeliveryMode: 'pr',
      baseBranch: 'main',
      remoteUrl: 'https://github.com/org/repo.git',
    }
    const result = computeDBUpdate(detect, templateSource, '/home/user/github-repo')
    expect(result).not.toBeNull()
    expect(result!.deliveryMode).toBe('pr')
    expect(result!.source.isGit).toBe(true)
    expect(result!.source.remoteType).toBe('github')
    expect(result!.source.remoteUrl).toBe('https://github.com/org/repo.git')
    expect(result!.source.baseBranch).toBe('main')
  })

  it('detection failure: returns null (DB not updated)', () => {
    const detect: DetectionResult = {
      exists: true, isGit: false, remoteType: 'none',
      suggestedDeliveryMode: 'direct',
      error: 'Timeout',
    }
    const result = computeDBUpdate(detect, templateSource, '/home/user/papers')
    expect(result).toBeNull()
  })

  it('directory does not exist: returns null', () => {
    const detect: DetectionResult = {
      exists: false, isGit: false, remoteType: 'none',
      suggestedDeliveryMode: 'direct',
    }
    const result = computeDBUpdate(detect, templateSource, '/nonexistent')
    expect(result).toBeNull()
  })

  it('preserves original source fields when merging', () => {
    const richSource = {
      type: 'template',
      templateId: 'academic-review',
      templateVersion: '1.0.0',
      parameters: { paperUrl: 'https://example.com/paper.pdf' },
      launchedAt: '2026-01-01T00:00:00Z',
    }
    const detect: DetectionResult = {
      exists: true, isGit: true, remoteType: 'none',
      suggestedDeliveryMode: 'branch',
    }
    const result = computeDBUpdate(detect, richSource, '/home/user/project')
    expect(result!.source.type).toBe('template')
    expect(result!.source.parameters).toEqual({ paperUrl: 'https://example.com/paper.pdf' })
    expect(result!.source.launchedAt).toBe('2026-01-01T00:00:00Z')
    // New detection fields added
    expect(result!.source.isGit).toBe(true)
    expect(result!.source.localPath).toBe('/home/user/project')
  })

  it('does not include baseBranch/remoteUrl when absent from detection', () => {
    const detect: DetectionResult = {
      exists: true, isGit: false, remoteType: 'none',
      suggestedDeliveryMode: 'direct',
    }
    const result = computeDBUpdate(detect, templateSource, '/home/user/papers')
    expect(result!.source.baseBranch).toBeUndefined()
    expect(result!.source.remoteUrl).toBeUndefined()
  })
})

// ============================================================================
// 6. Corner cases: server vs agent-runner disagreement
//    The agent-runner always re-validates at prepareTaskWorkspace()
// ============================================================================

describe('corner cases: defense in depth', () => {
  /**
   * Simulates the agent-runner's prepareTaskWorkspace() fallback.
   * At line 1732, it checks isGitRepo() and falls back to directory-lock
   * regardless of server's deliveryMode.
   */
  function agentRunnerDecision(opts: {
    serverDeliveryMode: DeliveryMode
    actuallyIsGit: boolean
  }): { usesWorktree: boolean; usesDirectoryLock: boolean } {
    if (opts.serverDeliveryMode === 'direct') {
      return { usesWorktree: false, usesDirectoryLock: true }
    }

    // Non-direct mode: agent-runner checks if dir is actually git
    if (!opts.actuallyIsGit) {
      // Fallback: directory lock, serial execution
      return { usesWorktree: false, usesDirectoryLock: true }
    }

    // Git dir + non-direct mode: use worktree
    return { usesWorktree: true, usesDirectoryLock: false }
  }

  it('server sends branch, dir is git: worktree used', () => {
    const result = agentRunnerDecision({ serverDeliveryMode: 'branch', actuallyIsGit: true })
    expect(result.usesWorktree).toBe(true)
    expect(result.usesDirectoryLock).toBe(false)
  })

  it('server sends branch, dir is NOT git: agent-runner falls back to directory lock', () => {
    // This is the defense-in-depth scenario
    const result = agentRunnerDecision({ serverDeliveryMode: 'branch', actuallyIsGit: false })
    expect(result.usesWorktree).toBe(false)
    expect(result.usesDirectoryLock).toBe(true)
  })

  it('server sends direct, dir is git: directory lock (respects server)', () => {
    const result = agentRunnerDecision({ serverDeliveryMode: 'direct', actuallyIsGit: true })
    expect(result.usesWorktree).toBe(false)
    expect(result.usesDirectoryLock).toBe(true)
  })

  it('server sends direct, dir is NOT git: directory lock', () => {
    const result = agentRunnerDecision({ serverDeliveryMode: 'direct', actuallyIsGit: false })
    expect(result.usesWorktree).toBe(false)
    expect(result.usesDirectoryLock).toBe(true)
  })

  it('server sends pr, dir is git: worktree used', () => {
    const result = agentRunnerDecision({ serverDeliveryMode: 'pr', actuallyIsGit: true })
    expect(result.usesWorktree).toBe(true)
  })

  it('server sends pr, dir is NOT git: falls back safely', () => {
    const result = agentRunnerDecision({ serverDeliveryMode: 'pr', actuallyIsGit: false })
    expect(result.usesWorktree).toBe(false)
    expect(result.usesDirectoryLock).toBe(true)
  })
})

// ============================================================================
// 7. Integration: dryRun dispatch respects DB-stored deliveryMode
//    Uses PGlite test server — no external services needed
// ============================================================================

import { setupTestServer, postJson, db } from './helpers/test-server.js'
import { projects, planNodes } from '../packages/core/src/db/schema.js'
import { eq } from 'drizzle-orm'

describe('dryRun dispatch: DB deliveryMode as ground truth', () => {
  let projectId: string
  const nodeId = 'safety-cache-test-node-001'

  beforeAll(async () => {
    await setupTestServer()
  })

  beforeEach(async () => {
    await db.delete(planNodes)
    await db.delete(projects)

    // Create project with deliveryMode stored in DB
    const res = await postJson('/api/data/projects', {
      name: 'Safety Cache Test Project',
      description: 'Testing that DB deliveryMode is respected',
      source: { localPath: '/tmp/test-repo', isGit: true, remoteType: 'none' },
      deliveryMode: 'branch',
    })
    const body = await res.json()
    projectId = body.id

    await postJson('/api/data/plan/nodes', {
      id: nodeId,
      projectId,
      type: 'task',
      title: 'Safety Cache Test Task',
      description: 'Test that deliveryMode from DB is used',
      status: 'planned',
      position: { x: 0, y: 0 },
    })
  })

  it('dryRun uses DB deliveryMode=branch when body omits deliveryMode', async () => {
    const res = await postJson('/api/dispatch/task', {
      nodeId,
      projectId,
      title: 'Safety Cache Test Task',
      description: 'Test delivery mode resolution',
      workingDirectory: '/tmp/test-repo',
      // NO deliveryMode in body — should fall through to DB
      dryRun: true,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.taskMeta).toBeDefined()
    expect(body.taskMeta.deliveryMode).toBe('branch')
  })

  it('dryRun: body deliveryMode takes precedence over DB', async () => {
    const res = await postJson('/api/dispatch/task', {
      nodeId,
      projectId,
      title: 'Safety Cache Test Task',
      description: 'Test delivery mode resolution',
      workingDirectory: '/tmp/test-repo',
      deliveryMode: 'direct',  // explicit override
      dryRun: true,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.taskMeta.deliveryMode).toBe('direct')
  })

  it('project with deliveryMode=direct: dryRun reflects direct', async () => {
    // Create a project with direct mode (simulating non-git directory)
    await db.delete(planNodes)
    await db.delete(projects)

    const res1 = await postJson('/api/data/projects', {
      name: 'Direct Mode Project',
      source: { localPath: '/tmp/no-git', isGit: false, remoteType: 'none' },
      deliveryMode: 'direct',
    })
    const proj = await res1.json()
    const directNodeId = 'direct-mode-test-node'

    await postJson('/api/data/plan/nodes', {
      id: directNodeId,
      projectId: proj.id,
      type: 'task',
      title: 'Direct Task',
      description: 'Test direct mode',
      status: 'planned',
      position: { x: 0, y: 0 },
    })

    const res2 = await postJson('/api/dispatch/task', {
      nodeId: directNodeId,
      projectId: proj.id,
      title: 'Direct Task',
      description: 'Test direct mode',
      workingDirectory: '/tmp/no-git',
      dryRun: true,
    })

    expect(res2.status).toBe(200)
    const body = await res2.json()
    expect(body.taskMeta.deliveryMode).toBe('direct')
  })

  it('project with deliveryMode=pr: dryRun reflects pr', async () => {
    await db.delete(planNodes)
    await db.delete(projects)

    const res1 = await postJson('/api/data/projects', {
      name: 'PR Mode Project',
      source: {
        localPath: '/tmp/github-repo',
        isGit: true,
        remoteType: 'github',
        remoteUrl: 'https://github.com/org/repo.git',
      },
      deliveryMode: 'pr',
    })
    const proj = await res1.json()
    const prNodeId = 'pr-mode-test-node'

    await postJson('/api/data/plan/nodes', {
      id: prNodeId,
      projectId: proj.id,
      type: 'task',
      title: 'PR Task',
      description: 'Test PR mode',
      status: 'planned',
      position: { x: 0, y: 0 },
    })

    const res2 = await postJson('/api/dispatch/task', {
      nodeId: prNodeId,
      projectId: proj.id,
      title: 'PR Task',
      description: 'Test PR mode',
      workingDirectory: '/tmp/github-repo',
      dryRun: true,
    })

    expect(res2.status).toBe(200)
    const body = await res2.json()
    expect(body.taskMeta.deliveryMode).toBe('pr')
  })

  it('legacy project with null deliveryMode: falls through to deriveDefault', async () => {
    await db.delete(planNodes)
    await db.delete(projects)

    // Create project WITHOUT deliveryMode (simulating legacy)
    const res1 = await postJson('/api/data/projects', {
      name: 'Legacy Project',
      source: { localPath: '/tmp/legacy' },
      // no deliveryMode
    })
    const proj = await res1.json()
    const legacyNodeId = 'legacy-test-node'

    await postJson('/api/data/plan/nodes', {
      id: legacyNodeId,
      projectId: proj.id,
      type: 'task',
      title: 'Legacy Task',
      description: 'Test legacy fallback',
      status: 'planned',
      position: { x: 0, y: 0 },
    })

    const res2 = await postJson('/api/dispatch/task', {
      nodeId: legacyNodeId,
      projectId: proj.id,
      title: 'Legacy Task',
      description: 'Test legacy fallback',
      workingDirectory: '/tmp/legacy',
      dryRun: true,
    })

    expect(res2.status).toBe(200)
    const body = await res2.json()
    // No deliveryMode in DB, no remoteType → deriveDefaultDeliveryMode(undefined) → 'direct'
    expect(body.taskMeta.deliveryMode).toBe('direct')
  })

  it('delivery mode from DB persists correctly after update', async () => {
    // Simulate the regeneration scenario: update project deliveryMode from direct→branch
    await db.update(projects)
      .set({ deliveryMode: 'branch' })
      .where(eq(projects.id, projectId))

    const res = await postJson('/api/dispatch/task', {
      nodeId,
      projectId,
      title: 'After Regen Task',
      description: 'Test after regeneration update',
      workingDirectory: '/tmp/test-repo',
      dryRun: true,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.taskMeta.deliveryMode).toBe('branch')
  })
})

// ============================================================================
// 8. Frontend delivery mode passthrough via startPlanGeneration
//    Verifies the execution-store accepts and stores deliveryMode
// ============================================================================

describe('startPlanGeneration deliveryMode passthrough', () => {
  /**
   * Simulates the addProject call in execution-store.ts.
   * Verifies that deliveryMode from options flows into the project object.
   */
  function buildProjectFromOptions(options: {
    deliveryMode?: string
    source?: ProjectSource
  }): Record<string, unknown> {
    return {
      name: 'Test Project',
      ...(options.source ? {
        source: {
          localPath: '/tmp/test',
          isGit: options.source.isGit,
          remoteType: options.source.remoteType,
        },
      } : {}),
      ...(options.deliveryMode ? { deliveryMode: options.deliveryMode } : {}),
    }
  }

  it('passes deliveryMode=branch when detection provides it', () => {
    const project = buildProjectFromOptions({
      deliveryMode: 'branch',
      source: { isGit: true, remoteType: 'none' },
    })
    expect(project.deliveryMode).toBe('branch')
  })

  it('passes deliveryMode=direct for non-git', () => {
    const project = buildProjectFromOptions({
      deliveryMode: 'direct',
      source: { isGit: false, remoteType: 'none' },
    })
    expect(project.deliveryMode).toBe('direct')
  })

  it('passes deliveryMode=pr for GitHub', () => {
    const project = buildProjectFromOptions({
      deliveryMode: 'pr',
      source: { isGit: true, remoteType: 'github' },
    })
    expect(project.deliveryMode).toBe('pr')
  })

  it('omits deliveryMode when detection has no suggestion', () => {
    const project = buildProjectFromOptions({})
    expect(project.deliveryMode).toBeUndefined()
  })
})
