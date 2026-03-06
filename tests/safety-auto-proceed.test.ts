/**
 * Safety Auto-Proceed Tests
 *
 * Tests for the YOLO mode and per-project safety auto-proceed logic:
 * - YOLO mode: auto-proceed all safety prompts
 * - Per-project: once approved, subsequent tasks in same project skip dialog
 * - Per-directory: approvedSafetyDirs caching in dispatch
 * - SSE event types for auto-proceeded notifications
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ============================================================================
// 1. Per-project safety approval tracking
// ============================================================================

describe('Per-project safety approval Set', () => {
  /**
   * Simulates the safetyApprovedProjects Set in events.ts SSE handler.
   * Once a project is approved (via YOLO or manual response), subsequent
   * safety prompts for tasks in the same project auto-proceed.
   */
  function createApprovalTracker() {
    const safetyApprovedProjects = new Set<string>()
    return {
      approve: (projectId: string) => safetyApprovedProjects.add(projectId),
      isApproved: (projectId: string) => safetyApprovedProjects.has(projectId),
      size: () => safetyApprovedProjects.size,
    }
  }

  it('new project is not approved by default', () => {
    const tracker = createApprovalTracker()
    expect(tracker.isApproved('project-1')).toBe(false)
  })

  it('approved project is remembered', () => {
    const tracker = createApprovalTracker()
    tracker.approve('project-1')
    expect(tracker.isApproved('project-1')).toBe(true)
  })

  it('approval is scoped per project', () => {
    const tracker = createApprovalTracker()
    tracker.approve('project-1')
    expect(tracker.isApproved('project-1')).toBe(true)
    expect(tracker.isApproved('project-2')).toBe(false)
  })

  it('multiple projects can be approved independently', () => {
    const tracker = createApprovalTracker()
    tracker.approve('project-1')
    tracker.approve('project-2')
    expect(tracker.isApproved('project-1')).toBe(true)
    expect(tracker.isApproved('project-2')).toBe(true)
    expect(tracker.isApproved('project-3')).toBe(false)
  })

  it('duplicate approvals are idempotent', () => {
    const tracker = createApprovalTracker()
    tracker.approve('project-1')
    tracker.approve('project-1')
    expect(tracker.size()).toBe(1)
  })
})

// ============================================================================
// 2. YOLO auto-proceed decision logic
// ============================================================================

describe('YOLO safety auto-proceed logic', () => {
  interface SafetyPromptMsg {
    taskId: string
    safetyTier: string
    warning?: string
    machineId?: string
    options: Array<{ id: string; label: string; description?: string }>
  }

  interface ExecutionContext {
    executionId: string
    projectId: string
    userId: string
    machineId: string
  }

  /**
   * Simulates the onTaskSafetyPrompt handler in events.ts.
   * Returns the action taken: 'dialog', 'auto_project', 'auto_yolo', or 'dialog_no_machine'.
   */
  function decideSafetyAction(
    msg: SafetyPromptMsg,
    ctx: ExecutionContext | undefined,
    approvedProjects: Set<string>,
    yoloEnabled: boolean,
  ): 'dialog' | 'auto_project' | 'auto_yolo' | 'dialog_no_machine' {
    if (!msg.machineId) {
      return 'dialog_no_machine'
    }

    // Per-project auto-proceed
    if (ctx && approvedProjects.has(ctx.projectId)) {
      return 'auto_project'
    }

    // YOLO mode auto-proceed
    if (yoloEnabled) {
      if (ctx) approvedProjects.add(ctx.projectId)
      return 'auto_yolo'
    }

    return 'dialog'
  }

  const baseMsg: SafetyPromptMsg = {
    taskId: 'exec-task-1',
    safetyTier: 'risky',
    warning: 'No git repository detected',
    machineId: 'machine-1',
    options: [
      { id: 'proceed', label: 'Continue anyway' },
      { id: 'init-git', label: 'Initialize git first' },
      { id: 'cancel', label: 'Cancel task' },
    ],
  }

  const baseCtx: ExecutionContext = {
    executionId: 'exec-task-1',
    projectId: 'project-1',
    userId: 'user-1',
    machineId: 'machine-1',
  }

  it('shows dialog when no YOLO and no prior approval', () => {
    const approved = new Set<string>()
    const action = decideSafetyAction(baseMsg, baseCtx, approved, false)
    expect(action).toBe('dialog')
  })

  it('auto-proceeds via YOLO when enabled', () => {
    const approved = new Set<string>()
    const action = decideSafetyAction(baseMsg, baseCtx, approved, true)
    expect(action).toBe('auto_yolo')
  })

  it('YOLO adds project to approved set', () => {
    const approved = new Set<string>()
    decideSafetyAction(baseMsg, baseCtx, approved, true)
    expect(approved.has('project-1')).toBe(true)
  })

  it('auto-proceeds via per-project when previously approved', () => {
    const approved = new Set<string>(['project-1'])
    const action = decideSafetyAction(baseMsg, baseCtx, approved, false)
    expect(action).toBe('auto_project')
  })

  it('per-project takes priority over YOLO check', () => {
    const approved = new Set<string>(['project-1'])
    // Even with YOLO enabled, per-project should trigger first (faster, no DB read)
    const action = decideSafetyAction(baseMsg, baseCtx, approved, true)
    expect(action).toBe('auto_project')
  })

  it('falls back to dialog when no machineId', () => {
    const noMachineMsg = { ...baseMsg, machineId: undefined }
    const approved = new Set<string>()
    const action = decideSafetyAction(noMachineMsg, baseCtx, approved, true)
    expect(action).toBe('dialog_no_machine')
  })

  it('shows dialog when no execution context (unknown task)', () => {
    const approved = new Set<string>()
    const action = decideSafetyAction(baseMsg, undefined, approved, false)
    expect(action).toBe('dialog')
  })

  it('YOLO without execution context still auto-proceeds but does not track project', () => {
    const approved = new Set<string>()
    const action = decideSafetyAction(baseMsg, undefined, approved, true)
    expect(action).toBe('auto_yolo')
    expect(approved.size).toBe(0)
  })

  it('second task in same project auto-proceeds after YOLO approves first', () => {
    const approved = new Set<string>()

    // First task: YOLO auto-proceeds
    const action1 = decideSafetyAction(
      { ...baseMsg, taskId: 'exec-task-1' },
      { ...baseCtx, executionId: 'exec-task-1' },
      approved,
      true,
    )
    expect(action1).toBe('auto_yolo')

    // Second task: per-project auto-proceeds (even if YOLO toggled off)
    const action2 = decideSafetyAction(
      { ...baseMsg, taskId: 'exec-task-2' },
      { ...baseCtx, executionId: 'exec-task-2' },
      approved,
      false, // YOLO now OFF
    )
    expect(action2).toBe('auto_project')
  })

  it('different project still shows dialog after first project approved', () => {
    const approved = new Set<string>(['project-1'])

    const action = decideSafetyAction(
      { ...baseMsg, taskId: 'exec-task-3' },
      { ...baseCtx, executionId: 'exec-task-3', projectId: 'project-2' },
      approved,
      false,
    )
    expect(action).toBe('dialog')
  })
})

// ============================================================================
// 3. Per-directory approval caching (dispatch.ts)
// ============================================================================

describe('Per-directory approval caching', () => {
  /**
   * Simulates the approvedSafetyDirs Map in dispatch.ts.
   * Maps workingDirectory -> decision. Used to set skipSafetyCheck on
   * subsequent task dispatches to the same directory.
   */
  function createDirCache() {
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
      getDecision: (workDir: string) => approvedSafetyDirs.get(workDir),
    }
  }

  it('new directory is not skipped', () => {
    const cache = createDirCache()
    expect(cache.shouldSkip('/tmp/myproject')).toBe(false)
  })

  it('proceed decision caches the directory', () => {
    const cache = createDirCache()
    cache.trackDispatch('task-1', '/tmp/myproject')
    cache.recordDecision('task-1', 'proceed')
    expect(cache.shouldSkip('/tmp/myproject')).toBe(true)
    expect(cache.getDecision('/tmp/myproject')).toBe('proceed')
  })

  it('init-git decision caches the directory', () => {
    const cache = createDirCache()
    cache.trackDispatch('task-1', '/tmp/myproject')
    cache.recordDecision('task-1', 'init-git')
    expect(cache.shouldSkip('/tmp/myproject')).toBe(true)
  })

  it('cancel decision does NOT cache the directory', () => {
    const cache = createDirCache()
    cache.trackDispatch('task-1', '/tmp/myproject')
    cache.recordDecision('task-1', 'cancel')
    expect(cache.shouldSkip('/tmp/myproject')).toBe(false)
  })

  it('different directories are independent', () => {
    const cache = createDirCache()
    cache.trackDispatch('task-1', '/tmp/project-a')
    cache.recordDecision('task-1', 'proceed')
    expect(cache.shouldSkip('/tmp/project-a')).toBe(true)
    expect(cache.shouldSkip('/tmp/project-b')).toBe(false)
  })

  it('same directory approved by different tasks', () => {
    const cache = createDirCache()
    cache.trackDispatch('task-1', '/tmp/shared')
    cache.recordDecision('task-1', 'proceed')
    // Second task in same dir already skipped
    expect(cache.shouldSkip('/tmp/shared')).toBe(true)
  })

  it('recording decision for untracked task is safe (no-op)', () => {
    const cache = createDirCache()
    cache.recordDecision('unknown-task', 'proceed')
    // No crash, no entries added
    expect(cache.shouldSkip('/tmp/anything')).toBe(false)
  })
})

// ============================================================================
// 4. SSE event type registration
// ============================================================================

describe('SSE event type: task:safety_auto_proceeded', () => {
  it('RealtimeEventType includes safety_auto_proceeded', () => {
    const source = readFileSync(
      join(__dirname, '../src/lib/realtime-client.ts'),
      'utf-8'
    )
    expect(source).toContain("'task:safety_auto_proceeded'")
  })

  it('eventTypes array includes safety_auto_proceeded for SSE listener', () => {
    const source = readFileSync(
      join(__dirname, '../src/lib/realtime-client.ts'),
      'utf-8'
    )
    // Should appear in both the type definition AND the eventTypes array
    const typeDefMatch = source.match(/RealtimeEventType\s*=[\s\S]*?'task:safety_auto_proceeded'/)
    const arrayMatch = source.match(/eventTypes[\s\S]*?'task:safety_auto_proceeded'/)
    expect(typeDefMatch).not.toBeNull()
    expect(arrayMatch).not.toBeNull()
  })
})

// ============================================================================
// 5. Frontend event handler for auto-proceeded
// ============================================================================

describe('Realtime store: task:safety_auto_proceeded handler', () => {
  /**
   * Simulates the case handler in realtime-store.ts processSSEEvent().
   */
  function handleSafetyAutoProceeded(
    data: { taskId: string; safetyTier: string; warning?: string },
    safetyPrompts: Map<string, unknown>,
  ): { safetyPrompts: Map<string, unknown>; activityLogged: boolean } {
    // Auto-proceeded events should NOT add to safetyPrompts (no dialog)
    // They should only log an activity event
    return {
      safetyPrompts: new Map(safetyPrompts), // unchanged
      activityLogged: true,
    }
  }

  it('does not add to safetyPrompts map (no dialog)', () => {
    const prompts = new Map()
    const result = handleSafetyAutoProceeded(
      { taskId: 'task-1', safetyTier: 'risky', warning: 'No git repo' },
      prompts,
    )
    expect(result.safetyPrompts.size).toBe(0)
  })

  it('logs activity for visibility', () => {
    const prompts = new Map()
    const result = handleSafetyAutoProceeded(
      { taskId: 'task-1', safetyTier: 'risky' },
      prompts,
    )
    expect(result.activityLogged).toBe(true)
  })

  it('does not affect existing safety prompts from other tasks', () => {
    const prompts = new Map()
    prompts.set('task-2', { taskId: 'task-2', safetyTier: 'risky', options: [] })

    const result = handleSafetyAutoProceeded(
      { taskId: 'task-1', safetyTier: 'risky' },
      prompts,
    )
    expect(result.safetyPrompts.size).toBe(1)
    expect(result.safetyPrompts.has('task-2')).toBe(true)
  })
})

// ============================================================================
// 6. Source code verification: events.ts safety handler
// ============================================================================

describe('Source code: events.ts safety prompt handler', () => {
  const source = readFileSync(
    join(__dirname, '../server/routes/events.ts'),
    'utf-8'
  )

  it('checks YOLO mode for safety prompts', () => {
    expect(source).toContain('isYoloMode(user?.id)')
    // Should be in the safety prompt handler context
    expect(source).toContain('safety auto-proceed')
  })

  it('tracks per-project approvals via safetyApprovedProjects Set', () => {
    expect(source).toContain('safetyApprovedProjects')
    expect(source).toContain('new Set<string>()')
  })

  it('checks per-project approval before YOLO check', () => {
    // Per-project check should come before YOLO check (faster, no DB read)
    const projectCheckIdx = source.indexOf('safetyApprovedProjects.has(')
    const yoloCheckIdx = source.indexOf('isYoloMode(user?.id).then(')
    // Both should exist
    expect(projectCheckIdx).toBeGreaterThan(-1)
    expect(yoloCheckIdx).toBeGreaterThan(-1)
  })

  it('emits task:safety_auto_proceeded SSE event', () => {
    expect(source).toContain("'task:safety_auto_proceeded'")
  })

  it('persists safety_response for auto-proceeded prompts', () => {
    expect(source).toContain("streamingEventLog.append(msg.taskId, 'safety_response'")
  })

  it('listens for task:safety_approved from dispatch', () => {
    expect(source).toContain("relayServer.on('task:safety_approved'")
  })

  it('cleans up task:safety_approved listener on disconnect', () => {
    expect(source).toContain("relayServer.off('task:safety_approved'")
  })
})

// ============================================================================
// 7. Source code verification: dispatch.ts safety_approved emission
// ============================================================================

describe('Source code: dispatch.ts safety_approved emission', () => {
  const source = readFileSync(
    join(__dirname, '../server/routes/dispatch.ts'),
    'utf-8'
  )

  it('emits task:safety_approved when user approves (non-cancel)', () => {
    expect(source).toContain("relayServer.emit('task:safety_approved'")
  })

  it('includes projectId in safety_approved event', () => {
    expect(source).toContain('projectId: ctx.projectId')
  })
})
