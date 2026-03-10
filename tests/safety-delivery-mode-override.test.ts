/**
 * Safety Delivery Mode Override & YOLO Default Tests
 *
 * Tests for PR #859 fixes:
 * 1. Templates no longer hardcode deliveryMode: 'branch'
 * 2. YOLO mode defaults to ON when setting is unset
 * 3. Safety 'proceed' decision overrides delivery mode to 'direct'
 * 4. Builtin templates (astro--*) skip safety checks
 * 5. Duplicate Redis call optimization (safetyDecision reuse)
 *
 * Covers:
 * - Template execution config integrity (no hardcoded deliveryMode)
 * - YOLO default behavior (unset → true, 'false' → false, 'true' → true)
 * - Builtin template detection from project source
 * - Safety decision → delivery mode mapping
 * - Per-directory approval caching with decision value inspection
 * - skipSafetyCheck computation with isBuiltinTemplate
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  academicPresentationTemplate,
  academicReviewTemplate,
  moatFragilityTemplate,
  BUILTIN_EXAMPLES,
} from '../packages/core/src/templates/index.js'

// ============================================================================
// 1. Template execution config: no hardcoded deliveryMode
// ============================================================================

describe('Template execution config: no hardcoded deliveryMode', () => {
  it('academic-presentation has no deliveryMode in execution config', () => {
    expect(academicPresentationTemplate.execution).toBeDefined()
    expect('deliveryMode' in academicPresentationTemplate.execution!).toBe(false)
  })

  it('academic-review has no deliveryMode in execution config', () => {
    expect(academicReviewTemplate.execution).toBeDefined()
    expect('deliveryMode' in academicReviewTemplate.execution!).toBe(false)
  })

  it('moat-fragility has no deliveryMode in execution config', () => {
    expect(moatFragilityTemplate.execution).toBeDefined()
    expect('deliveryMode' in moatFragilityTemplate.execution!).toBe(false)
  })

  it('no builtin example template has deliveryMode in execution config', () => {
    for (const template of BUILTIN_EXAMPLES) {
      if (template.execution) {
        expect('deliveryMode' in template.execution).toBe(false)
      }
    }
  })

  it('all templates still have skipSafetyCheck: false', () => {
    for (const template of BUILTIN_EXAMPLES) {
      if (template.execution) {
        expect(template.execution.skipSafetyCheck).toBe(false)
      }
    }
  })

  it('all templates still have their skills configured', () => {
    expect(academicPresentationTemplate.execution!.skills).toEqual(['academic-presentation'])
    expect(academicReviewTemplate.execution!.skills).toEqual(['academic-review'])
    expect(moatFragilityTemplate.execution!.skills).toEqual(['moat-fragility'])
  })
})

// ============================================================================
// 2. YOLO mode default behavior
// ============================================================================

describe('YOLO mode default: ON when unset', () => {
  /**
   * Simulates the YOLO mode resolution logic from yolo-mode.ts and the
   * inline check in dispatch.ts. The key change: `!== 'false'` instead
   * of `=== 'true'`, so unset/undefined/null all default to YOLO ON.
   */
  function resolveYoloMode(
    settings: Record<string, string> | null | undefined,
    isPlayground: boolean = false,
  ): boolean {
    if (isPlayground) {
      return settings?.playgroundYoloMode === 'true'
    }
    // Default ON when unset (matches frontend default for new users)
    return settings?.yoloMode !== 'false'
  }

  it('returns true when settings is null (new user, no profile)', () => {
    expect(resolveYoloMode(null)).toBe(true)
  })

  it('returns true when settings is undefined', () => {
    expect(resolveYoloMode(undefined)).toBe(true)
  })

  it('returns true when yoloMode key is absent from settings', () => {
    expect(resolveYoloMode({})).toBe(true)
  })

  it('returns true when yoloMode is explicitly "true"', () => {
    expect(resolveYoloMode({ yoloMode: 'true' })).toBe(true)
  })

  it('returns false when yoloMode is explicitly "false"', () => {
    expect(resolveYoloMode({ yoloMode: 'false' })).toBe(false)
  })

  it('returns true for any non-"false" value (e.g. empty string)', () => {
    expect(resolveYoloMode({ yoloMode: '' })).toBe(true)
  })

  it('returns true for any non-"false" value (e.g. "yes")', () => {
    expect(resolveYoloMode({ yoloMode: 'yes' })).toBe(true)
  })

  // Playground mode uses different field and defaults to OFF
  it('playground: returns false when settings is null', () => {
    expect(resolveYoloMode(null, true)).toBe(false)
  })

  it('playground: returns false when playgroundYoloMode is absent', () => {
    expect(resolveYoloMode({}, true)).toBe(false)
  })

  it('playground: returns true when playgroundYoloMode is "true"', () => {
    expect(resolveYoloMode({ playgroundYoloMode: 'true' }, true)).toBe(true)
  })

  it('playground: returns false when playgroundYoloMode is "false"', () => {
    expect(resolveYoloMode({ playgroundYoloMode: 'false' }, true)).toBe(false)
  })
})

// ============================================================================
// 3. Builtin template detection
// ============================================================================

describe('Builtin template detection from project source', () => {
  /**
   * Simulates the isBuiltinTemplate detection logic in dispatch.ts.
   * A project is a builtin template if:
   *   source.type === 'template' AND source.templateId starts with 'astro--'
   */
  function detectBuiltinTemplate(
    source: { type?: string; templateId?: string } | null,
  ): boolean {
    return source?.type === 'template'
      && typeof source?.templateId === 'string'
      && source.templateId.startsWith('astro--')
  }

  it('detects academic-presentation as builtin', () => {
    expect(detectBuiltinTemplate({
      type: 'template',
      templateId: 'astro--academic-presentation',
    })).toBe(true)
  })

  it('detects academic-review as builtin', () => {
    expect(detectBuiltinTemplate({
      type: 'template',
      templateId: 'astro--academic-review',
    })).toBe(true)
  })

  it('detects moat-fragility as builtin', () => {
    expect(detectBuiltinTemplate({
      type: 'template',
      templateId: 'astro--moat-fragility',
    })).toBe(true)
  })

  it('rejects non-template source type', () => {
    expect(detectBuiltinTemplate({
      type: 'github',
      templateId: 'astro--something',
    })).toBe(false)
  })

  it('rejects template with non-astro prefix', () => {
    expect(detectBuiltinTemplate({
      type: 'template',
      templateId: 'community--custom-template',
    })).toBe(false)
  })

  it('rejects null source', () => {
    expect(detectBuiltinTemplate(null)).toBe(false)
  })

  it('rejects source without type', () => {
    expect(detectBuiltinTemplate({
      templateId: 'astro--academic-review',
    })).toBe(false)
  })

  it('rejects source without templateId', () => {
    expect(detectBuiltinTemplate({
      type: 'template',
    })).toBe(false)
  })

  it('rejects source with numeric templateId', () => {
    expect(detectBuiltinTemplate({
      type: 'template',
      templateId: undefined,
    })).toBe(false)
  })

  it('rejects empty templateId', () => {
    expect(detectBuiltinTemplate({
      type: 'template',
      templateId: '',
    })).toBe(false)
  })

  it('rejects templateId that contains but does not start with astro--', () => {
    expect(detectBuiltinTemplate({
      type: 'template',
      templateId: 'my-astro--template',
    })).toBe(false)
  })

  it('all BUILTIN_EXAMPLES have IDs that start with astro--', () => {
    for (const template of BUILTIN_EXAMPLES) {
      expect(template.id.startsWith('astro--')).toBe(true)
    }
  })
})

// ============================================================================
// 4. Safety decision → delivery mode override
// ============================================================================

describe('Safety decision → delivery mode override', () => {
  /**
   * Simulates the delivery mode override logic added in dispatch.ts.
   * When safetyDecision === 'proceed', delivery mode is forced to 'direct'
   * and worktree is disabled.
   */
  function applyDeliveryModeOverride(
    deliveryMode: string | undefined,
    useWorktree: boolean | undefined,
    safetyDecision: string | null,
  ): { deliveryMode: string | undefined; useWorktree: boolean | undefined } {
    if (safetyDecision === 'proceed') {
      return { deliveryMode: 'direct', useWorktree: false }
    }
    return { deliveryMode, useWorktree }
  }

  it('proceed → forces deliveryMode to direct', () => {
    const result = applyDeliveryModeOverride('branch', true, 'proceed')
    expect(result.deliveryMode).toBe('direct')
  })

  it('proceed → forces useWorktree to false', () => {
    const result = applyDeliveryModeOverride('branch', true, 'proceed')
    expect(result.useWorktree).toBe(false)
  })

  it('proceed overrides even when deliveryMode was pr', () => {
    const result = applyDeliveryModeOverride('pr', true, 'proceed')
    expect(result.deliveryMode).toBe('direct')
    expect(result.useWorktree).toBe(false)
  })

  it('proceed overrides even when deliveryMode was push', () => {
    const result = applyDeliveryModeOverride('push', true, 'proceed')
    expect(result.deliveryMode).toBe('direct')
  })

  it('init-git → does NOT override (git will be initialized)', () => {
    const result = applyDeliveryModeOverride('branch', true, 'init-git')
    expect(result.deliveryMode).toBe('branch')
    expect(result.useWorktree).toBe(true)
  })

  it('null decision → no override', () => {
    const result = applyDeliveryModeOverride('branch', true, null)
    expect(result.deliveryMode).toBe('branch')
    expect(result.useWorktree).toBe(true)
  })

  it('undefined deliveryMode preserved when decision is not proceed', () => {
    const result = applyDeliveryModeOverride(undefined, undefined, null)
    expect(result.deliveryMode).toBeUndefined()
    expect(result.useWorktree).toBeUndefined()
  })

  it('undefined deliveryMode overridden when decision is proceed', () => {
    const result = applyDeliveryModeOverride(undefined, undefined, 'proceed')
    expect(result.deliveryMode).toBe('direct')
    expect(result.useWorktree).toBe(false)
  })
})

// ============================================================================
// 5. Per-directory approval caching with decision value
// ============================================================================

describe('Per-directory approval: decision value differentiation', () => {
  /**
   * Extended version of the approvedSafetyDirs simulation that differentiates
   * between 'proceed' and 'init-git' decision values. This is the key change
   * in PR #859: we now inspect the decision VALUE, not just whether it exists.
   */
  function createDirCacheWithDecision() {
    const approvedSafetyDirs = new Map<string, string>()
    const dispatchedTaskDirs = new Map<string, string>()

    return {
      trackDispatch: (taskId: string, workDir: string) => {
        dispatchedTaskDirs.set(taskId, workDir)
      },
      recordDecision: (taskId: string, decision: string) => {
        if (decision !== 'cancel') {
          const workdir = dispatchedTaskDirs.get(taskId)
          if (workdir) {
            approvedSafetyDirs.set(workdir, decision)
          }
        }
      },
      shouldSkip: (workDir: string) => approvedSafetyDirs.has(workDir),
      getDecision: (workDir: string) => approvedSafetyDirs.get(workDir) ?? null,
      shouldForceDirect: (workDir: string) => {
        const decision = approvedSafetyDirs.get(workDir)
        return decision === 'proceed'
      },
    }
  }

  it('proceed decision forces direct mode', () => {
    const cache = createDirCacheWithDecision()
    cache.trackDispatch('task-1', '/tmp/non-git-dir')
    cache.recordDecision('task-1', 'proceed')
    expect(cache.shouldForceDirect('/tmp/non-git-dir')).toBe(true)
  })

  it('init-git decision does NOT force direct mode', () => {
    const cache = createDirCacheWithDecision()
    cache.trackDispatch('task-1', '/tmp/non-git-dir')
    cache.recordDecision('task-1', 'init-git')
    expect(cache.shouldForceDirect('/tmp/non-git-dir')).toBe(false)
  })

  it('both proceed and init-git skip safety check', () => {
    const cache = createDirCacheWithDecision()
    cache.trackDispatch('task-1', '/tmp/dir-a')
    cache.recordDecision('task-1', 'proceed')
    cache.trackDispatch('task-2', '/tmp/dir-b')
    cache.recordDecision('task-2', 'init-git')

    expect(cache.shouldSkip('/tmp/dir-a')).toBe(true)
    expect(cache.shouldSkip('/tmp/dir-b')).toBe(true)
  })

  it('unknown directory returns null for decision', () => {
    const cache = createDirCacheWithDecision()
    expect(cache.getDecision('/tmp/unknown')).toBeNull()
  })

  it('proceed decision preserved for subsequent task lookups', () => {
    const cache = createDirCacheWithDecision()
    cache.trackDispatch('task-1', '/tmp/shared')
    cache.recordDecision('task-1', 'proceed')

    // Subsequent task in same dir
    expect(cache.getDecision('/tmp/shared')).toBe('proceed')
    expect(cache.shouldForceDirect('/tmp/shared')).toBe(true)
  })

  it('cancel does not store any decision', () => {
    const cache = createDirCacheWithDecision()
    cache.trackDispatch('task-1', '/tmp/cancelled')
    cache.recordDecision('task-1', 'cancel')
    expect(cache.getDecision('/tmp/cancelled')).toBeNull()
    expect(cache.shouldSkip('/tmp/cancelled')).toBe(false)
    expect(cache.shouldForceDirect('/tmp/cancelled')).toBe(false)
  })
})

// ============================================================================
// 6. skipSafetyCheck computation with isBuiltinTemplate
// ============================================================================

describe('skipSafetyCheck computation', () => {
  /**
   * Simulates the skipSafetyCheck computation from dispatch.ts line 1217.
   * Tests that isBuiltinTemplate is OR'd with the existing conditions.
   */
  function computeSkipSafetyCheck(params: {
    isBuiltinTemplate: boolean
    skipSafetyCheck: boolean
    nodeId: string
    workingDirectory: string | undefined
    approvedDirs: Set<string>
  }): boolean {
    return params.isBuiltinTemplate
      || (params.skipSafetyCheck && params.nodeId.startsWith('playground-'))
      || (!!params.workingDirectory && params.approvedDirs.has(params.workingDirectory))
  }

  it('builtin template always skips safety', () => {
    expect(computeSkipSafetyCheck({
      isBuiltinTemplate: true,
      skipSafetyCheck: false,
      nodeId: 'node-1',
      workingDirectory: undefined,
      approvedDirs: new Set(),
    })).toBe(true)
  })

  it('builtin template skips even when workdir is not approved', () => {
    expect(computeSkipSafetyCheck({
      isBuiltinTemplate: true,
      skipSafetyCheck: false,
      nodeId: 'task-abc',
      workingDirectory: '/tmp/non-git',
      approvedDirs: new Set(),
    })).toBe(true)
  })

  it('playground with skipSafetyCheck flag skips safety', () => {
    expect(computeSkipSafetyCheck({
      isBuiltinTemplate: false,
      skipSafetyCheck: true,
      nodeId: 'playground-123',
      workingDirectory: undefined,
      approvedDirs: new Set(),
    })).toBe(true)
  })

  it('non-playground with skipSafetyCheck flag does NOT skip safety', () => {
    expect(computeSkipSafetyCheck({
      isBuiltinTemplate: false,
      skipSafetyCheck: true,
      nodeId: 'node-1',
      workingDirectory: undefined,
      approvedDirs: new Set(),
    })).toBe(false)
  })

  it('approved directory skips safety', () => {
    expect(computeSkipSafetyCheck({
      isBuiltinTemplate: false,
      skipSafetyCheck: false,
      nodeId: 'node-1',
      workingDirectory: '/tmp/approved',
      approvedDirs: new Set(['/tmp/approved']),
    })).toBe(true)
  })

  it('unapproved directory does NOT skip safety', () => {
    expect(computeSkipSafetyCheck({
      isBuiltinTemplate: false,
      skipSafetyCheck: false,
      nodeId: 'node-1',
      workingDirectory: '/tmp/not-approved',
      approvedDirs: new Set(['/tmp/other']),
    })).toBe(false)
  })

  it('no working directory does NOT skip safety (even with approved dirs)', () => {
    expect(computeSkipSafetyCheck({
      isBuiltinTemplate: false,
      skipSafetyCheck: false,
      nodeId: 'node-1',
      workingDirectory: undefined,
      approvedDirs: new Set(['/tmp/approved']),
    })).toBe(false)
  })

  it('all conditions false → does NOT skip safety', () => {
    expect(computeSkipSafetyCheck({
      isBuiltinTemplate: false,
      skipSafetyCheck: false,
      nodeId: 'node-1',
      workingDirectory: undefined,
      approvedDirs: new Set(),
    })).toBe(false)
  })
})

// ============================================================================
// 7. Source code verification: dispatch.ts changes
// ============================================================================

describe('Source code: dispatch.ts safety/delivery mode changes', () => {
  const source = readFileSync(
    join(__dirname, '../server/routes/dispatch.ts'),
    'utf-8'
  )

  it('has isBuiltinTemplate variable declaration', () => {
    expect(source).toContain('let isBuiltinTemplate = false')
  })

  it('detects builtin templates via source.type and source.templateId', () => {
    expect(source).toContain("source?.type === 'template'")
    expect(source).toContain("source.templateId.startsWith('astro--')")
  })

  it('includes isBuiltinTemplate in skipSafetyCheck computation', () => {
    expect(source).toContain('skipSafetyCheck: isBuiltinTemplate ||')
  })

  it('overrides delivery mode for proceed decision', () => {
    expect(source).toContain("if (safetyDecision === 'proceed')")
    expect(source).toContain("deliveryMode = 'direct'")
    expect(source).toContain('useWorktree = false')
  })

  it('reads safety decision from both local Map and Redis', () => {
    expect(source).toContain('approvedSafetyDirs.get(workingDirectory)')
    expect(source).toContain('redisPubSub.getApprovedSafetyDir(workingDirectory)')
  })

  it('uses !== false for YOLO default (not === true)', () => {
    // The inline check in dispatchViaRelay
    expect(source).toContain("settings?.yoloMode !== 'false'")
  })
})

// ============================================================================
// 8. Source code verification: yolo-mode.ts
// ============================================================================

describe('Source code: yolo-mode.ts YOLO default', () => {
  const source = readFileSync(
    join(__dirname, '../server/lib/yolo-mode.ts'),
    'utf-8'
  )

  it('uses !== false for default ON behavior', () => {
    expect(source).toContain("settings?.yoloMode !== 'false'")
  })

  it('does NOT use === true (old behavior)', () => {
    // Ensure the old pattern is gone
    expect(source).not.toContain("settings?.yoloMode === 'true'")
  })

  it('still uses === true for playground (different default)', () => {
    expect(source).toContain("settings?.playgroundYoloMode === 'true'")
  })

  it('has comment explaining the default behavior', () => {
    expect(source).toContain('Default ON when unset')
  })
})

// ============================================================================
// 9. Template source code: no deliveryMode in execution config
// ============================================================================

describe('Template source files: deliveryMode removed', () => {
  const templates = [
    {
      name: 'academic-presentation',
      path: 'packages/core/src/templates/examples/academic-presentation.ts',
    },
    {
      name: 'academic-review',
      path: 'packages/core/src/templates/examples/academic-review.ts',
    },
    {
      name: 'moat-fragility',
      path: 'packages/core/src/templates/examples/moat-fragility.ts',
    },
  ]

  for (const { name, path: templatePath } of templates) {
    it(`${name} source does not contain deliveryMode in execution block`, () => {
      const source = readFileSync(join(__dirname, '..', templatePath), 'utf-8')
      // Find the execution block and verify no deliveryMode
      const executionMatch = source.match(/execution:\s*\{[\s\S]*?\n\s*\}/)
      expect(executionMatch).not.toBeNull()
      expect(executionMatch![0]).not.toContain('deliveryMode')
    })
  }
})

// ============================================================================
// 10. End-to-end scenario: builtin example on non-git directory
// ============================================================================

describe('E2E scenario: builtin example on non-git directory', () => {
  /**
   * Simulates the full dispatch pipeline for a builtin example template
   * targeting a non-git working directory. Verifies that:
   * 1. isBuiltinTemplate is detected
   * 2. skipSafetyCheck is true
   * 3. No hardcoded deliveryMode from template
   * 4. If proceed decision exists, delivery mode is forced to direct
   */
  function simulateDispatch(params: {
    projectSource: { type?: string; templateId?: string } | null
    deliveryMode: string | undefined
    useWorktree: boolean | undefined
    workingDirectory: string
    approvedDirs: Map<string, string>
  }) {
    // Step 1: Detect builtin template
    const isBuiltinTemplate = params.projectSource?.type === 'template'
      && typeof params.projectSource?.templateId === 'string'
      && params.projectSource.templateId.startsWith('astro--')

    // Step 2: Compute skipSafetyCheck
    const skipSafetyCheck = isBuiltinTemplate
      || params.approvedDirs.has(params.workingDirectory)

    // Step 3: Apply safety decision override
    let { deliveryMode, useWorktree } = params
    const safetyDecision = params.approvedDirs.get(params.workingDirectory) ?? null
    if (safetyDecision === 'proceed') {
      deliveryMode = 'direct'
      useWorktree = false
    }

    return { isBuiltinTemplate, skipSafetyCheck, deliveryMode, useWorktree }
  }

  it('first launch: builtin template skips safety, no delivery mode override', () => {
    const result = simulateDispatch({
      projectSource: { type: 'template', templateId: 'astro--moat-fragility' },
      deliveryMode: undefined, // No hardcoded deliveryMode from template
      useWorktree: undefined,
      workingDirectory: '/tmp/PLTR',
      approvedDirs: new Map(),
    })

    expect(result.isBuiltinTemplate).toBe(true)
    expect(result.skipSafetyCheck).toBe(true)
    expect(result.deliveryMode).toBeUndefined() // Auto-detected later by deriveDefaultDeliveryMode
    expect(result.useWorktree).toBeUndefined()
  })

  it('second launch after proceed: delivery mode forced to direct', () => {
    const approvedDirs = new Map([
      ['/tmp/PLTR', 'proceed'],
    ])

    const result = simulateDispatch({
      projectSource: { type: 'template', templateId: 'astro--moat-fragility' },
      deliveryMode: undefined,
      useWorktree: undefined,
      workingDirectory: '/tmp/PLTR',
      approvedDirs,
    })

    expect(result.isBuiltinTemplate).toBe(true)
    expect(result.skipSafetyCheck).toBe(true)
    expect(result.deliveryMode).toBe('direct')
    expect(result.useWorktree).toBe(false)
  })

  it('non-builtin template after proceed: still forces direct', () => {
    const approvedDirs = new Map([
      ['/tmp/myproject', 'proceed'],
    ])

    const result = simulateDispatch({
      projectSource: { type: 'github', templateId: undefined },
      deliveryMode: 'branch',
      useWorktree: true,
      workingDirectory: '/tmp/myproject',
      approvedDirs,
    })

    expect(result.isBuiltinTemplate).toBe(false)
    expect(result.skipSafetyCheck).toBe(true) // Dir is approved
    expect(result.deliveryMode).toBe('direct') // Overridden by proceed
    expect(result.useWorktree).toBe(false)
  })

  it('init-git decision: does NOT force direct, allows worktree', () => {
    const approvedDirs = new Map([
      ['/tmp/myproject', 'init-git'],
    ])

    const result = simulateDispatch({
      projectSource: { type: 'github', templateId: undefined },
      deliveryMode: 'branch',
      useWorktree: true,
      workingDirectory: '/tmp/myproject',
      approvedDirs,
    })

    expect(result.skipSafetyCheck).toBe(true) // Dir is approved
    expect(result.deliveryMode).toBe('branch') // NOT overridden
    expect(result.useWorktree).toBe(true) // NOT overridden
  })
})
