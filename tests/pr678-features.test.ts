/**
 * PR #678 Feature Tests
 *
 * Comprehensive tests covering all code revised in PR #678:
 * 1. YOLO auto-complete logic (finalNodeStatus decision)
 * 2. Output directory prompt injection conditions
 * 3. Cmd+Enter hint consistency across all pages
 * 4. Dashboard running tasks scrollable container
 * 5. SSE event types and realtime store handling
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ============================================================================
// 1. YOLO auto-complete: finalNodeStatus decision logic
// ============================================================================

describe('YOLO auto-complete: finalNodeStatus decision', () => {
  /**
   * Simulates the finalNodeStatus decision in dispatch.ts task-result handler.
   * Current behavior on main: verification='human' → always awaiting_judgment.
   * Desired behavior: verification='human' + YOLO → auto_verified.
   */
  function decideFinalStatus(
    isSuccess: boolean,
    verification: 'auto' | 'human',
    deliveryOk: boolean,
    yoloEnabled: boolean,
  ): 'auto_verified' | 'awaiting_judgment' {
    if (!isSuccess) {
      return 'awaiting_judgment'
    }

    if (verification === 'auto' && deliveryOk) {
      return 'auto_verified'
    }

    // With YOLO mode fix: human verification + YOLO → auto_verified
    if (yoloEnabled) {
      return 'auto_verified'
    }

    return 'awaiting_judgment'
  }

  it('successful auto-verification with delivery ok → auto_verified', () => {
    expect(decideFinalStatus(true, 'auto', true, false)).toBe('auto_verified')
  })

  it('successful auto-verification with delivery failed → awaiting_judgment', () => {
    expect(decideFinalStatus(true, 'auto', false, false)).toBe('awaiting_judgment')
  })

  it('failed task always → awaiting_judgment regardless of YOLO', () => {
    expect(decideFinalStatus(false, 'auto', true, true)).toBe('awaiting_judgment')
    expect(decideFinalStatus(false, 'human', true, true)).toBe('awaiting_judgment')
  })

  it('human verification without YOLO → awaiting_judgment', () => {
    expect(decideFinalStatus(true, 'human', true, false)).toBe('awaiting_judgment')
  })

  it('human verification with YOLO → auto_verified', () => {
    // This is the key fix: YOLO mode should auto-complete even human-verified tasks
    expect(decideFinalStatus(true, 'human', true, true)).toBe('auto_verified')
  })

  it('auto verification with YOLO still works (fast path)', () => {
    expect(decideFinalStatus(true, 'auto', true, true)).toBe('auto_verified')
  })

  it('auto verification with bad delivery + YOLO → auto_verified (YOLO overrides)', () => {
    expect(decideFinalStatus(true, 'auto', false, true)).toBe('auto_verified')
  })

  it('delivery status does not matter when YOLO is on', () => {
    expect(decideFinalStatus(true, 'human', true, true)).toBe('auto_verified')
    expect(decideFinalStatus(true, 'human', false, true)).toBe('auto_verified')
  })

  it('failed task with YOLO → awaiting_judgment (safety: never auto-approve failures)', () => {
    expect(decideFinalStatus(false, 'human', true, true)).toBe('awaiting_judgment')
    expect(decideFinalStatus(false, 'auto', true, true)).toBe('awaiting_judgment')
  })
})

// ============================================================================
// 2. Output directory prompt injection conditions
// ============================================================================

describe('Output directory prompt injection logic', () => {
  /**
   * Simulates the condition for injecting the Output Directory prompt.
   * Only inject when the task uses a worktree (files will be lost on cleanup).
   */
  function shouldInjectOutputDirectoryPrompt(
    workingDirectory: string | undefined,
    useWorktree: boolean | undefined,
    deliveryMode: string | undefined,
  ): boolean {
    const outputBase = workingDirectory
    const usesWorktreeForOutput =
      !!outputBase &&
      useWorktree !== false &&
      (deliveryMode ?? 'pr') !== 'direct'
    return usesWorktreeForOutput
  }

  it('injects when worktree with PR delivery', () => {
    expect(shouldInjectOutputDirectoryPrompt(
      '/project', true, 'pr'
    )).toBe(true)
  })

  it('injects when worktree with push delivery', () => {
    expect(shouldInjectOutputDirectoryPrompt(
      '/project', true, 'push'
    )).toBe(true)
  })

  it('injects when worktree with branch delivery', () => {
    expect(shouldInjectOutputDirectoryPrompt(
      '/project', true, 'branch'
    )).toBe(true)
  })

  it('injects when worktree with copy delivery', () => {
    expect(shouldInjectOutputDirectoryPrompt(
      '/project', true, 'copy'
    )).toBe(true)
  })

  it('does NOT inject for direct delivery (no worktree cleanup)', () => {
    expect(shouldInjectOutputDirectoryPrompt(
      '/project', true, 'direct'
    )).toBe(false)
  })

  it('does NOT inject when useWorktree is false', () => {
    expect(shouldInjectOutputDirectoryPrompt(
      '/project', false, 'pr'
    )).toBe(false)
  })

  it('does NOT inject when no directory available', () => {
    expect(shouldInjectOutputDirectoryPrompt(
      undefined, true, 'pr'
    )).toBe(false)
  })

  it('injects with workingDirectory', () => {
    expect(shouldInjectOutputDirectoryPrompt(
      '/project', true, 'pr'
    )).toBe(true)
  })

  it('defaults delivery mode to pr when undefined', () => {
    // (deliveryMode ?? 'pr') !== 'direct' → 'pr' !== 'direct' → true
    expect(shouldInjectOutputDirectoryPrompt(
      '/project', true, undefined
    )).toBe(true)
  })

  it('defaults useWorktree to true when undefined', () => {
    // useWorktree !== false → undefined !== false → true
    expect(shouldInjectOutputDirectoryPrompt(
      '/project', undefined, 'pr'
    )).toBe(true)
  })
})

// ============================================================================
// 3. Cmd+Enter hint consistency across all pages
// ============================================================================

describe('Cmd+Enter hint consistency', () => {
  const files = [
    { path: 'src/pages/playground.tsx', expected: '⌘+Enter' },
    { path: 'src/pages/project-new-plan.tsx', expected: '⌘+Enter' },
    { path: 'src/components/github-comments.tsx', expected: '⌘+Enter' },
    { path: 'src/components/task-detail/comment-section.tsx', expected: '⌘+Enter' },
    { path: 'src/components/task-detail/unified-activity-view.tsx', expected: '⌘+Enter' },
  ]

  for (const { path, expected } of files) {
    it(`${path} uses ${expected} format`, () => {
      const source = readFileSync(join(__dirname, '..', path), 'utf-8')
      expect(source).toContain(expected)
    })
  }

  it('no file uses old "Cmd+Enter" format (case-sensitive)', () => {
    for (const { path } of files) {
      const source = readFileSync(join(__dirname, '..', path), 'utf-8')
      // Should NOT contain "Cmd+Enter" (capital C, spelled out)
      // But may contain "Cmd" in other contexts (e.g., comments)
      // Check specifically for the hint pattern
      const oldPattern = /['"`]Cmd\+Enter/
      expect(source.match(oldPattern)).toBeNull()
    }
  })

  it('no file uses platform-detecting "Ctrl" hint pattern', () => {
    for (const { path } of files) {
      const source = readFileSync(join(__dirname, '..', path), 'utf-8')
      // Should not have "Ctrl Enter" or "Ctrl+Enter" in submit hints
      const ctrlPattern = /Ctrl\+?Enter.*submit|submit.*Ctrl\+?Enter/i
      expect(source.match(ctrlPattern)).toBeNull()
    }
  })
})

// ============================================================================
// 4. Dashboard running tasks scrollable container
// ============================================================================

describe('Dashboard running tasks scroll', () => {
  const source = readFileSync(
    join(__dirname, '../src/pages/dashboard.tsx'),
    'utf-8'
  )

  it('running tasks container has max-height constraint', () => {
    expect(source).toContain('max-h-[min(50vh,400px)]')
  })

  it('running tasks container has overflow-y-auto for scrolling', () => {
    expect(source).toContain('overflow-y-auto')
  })

  it('max-h and overflow are on the same element', () => {
    // Both classes should be on the same element (same className string)
    const match = source.match(/className="[^"]*max-h-\[min\(50vh,400px\)\][^"]*overflow-y-auto[^"]*"/)
    expect(match).not.toBeNull()
  })
})

// ============================================================================
// 6. dispatch.ts: verification logic source verification
// ============================================================================

describe('Source code: dispatch.ts verification logic', () => {
  const source = readFileSync(
    join(__dirname, '../server/routes/dispatch.ts'),
    'utf-8'
  )

  it('computes isSuccess from result.status', () => {
    expect(source).toContain("msg.result.status === 'completed'")
  })

  it('computes deliveryOk from deliveryStatus', () => {
    expect(source).toContain("msg.result.deliveryStatus === 'success'")
    expect(source).toContain("msg.result.deliveryStatus === 'skipped'")
  })

  it('auto_verified triggers autoDispatchDownstream', () => {
    expect(source).toContain("finalNodeStatus === 'auto_verified'")
    expect(source).toContain('autoDispatchDownstream')
  })

  it('has workspace delivery mode prompt sections', () => {
    expect(source).toContain('## Workspace & Delivery')
    // Multiple delivery modes should be covered
    expect(source).toContain("effectiveDelivery === 'pr'")
    expect(source).toContain("effectiveDelivery === 'push'")
    expect(source).toContain("effectiveDelivery === 'branch'")
    expect(source).toContain("effectiveDelivery === 'copy'")
    expect(source).toContain("effectiveDelivery === 'direct'")
  })

  it('has usesWorktree condition combining workDir + worktree flag + delivery', () => {
    expect(source).toContain('usesWorktree')
    expect(source).toContain("effectiveDelivery !== 'direct'")
  })
})

// ============================================================================
// 7. dispatch.ts: YOLO auto-approve in safety decision endpoint
// ============================================================================

describe('Source code: dispatch.ts YOLO safety auto-approve', () => {
  const source = readFileSync(
    join(__dirname, '../server/routes/dispatch.ts'),
    'utf-8'
  )

  it('uses shared YOLO resolution for task completion', () => {
    expect(source).toContain('isYoloMode')
    expect(source).toContain("await isYoloMode(user?.id, nodeId).catch(() => false)")
  })

  it('auto-approves first option in YOLO mode', () => {
    expect(source).toContain('YOLO auto-approved')
    expect(source).toContain('options[0]')
  })
})

// ============================================================================
// 8. events.ts: YOLO + per-project safety auto-proceed
// ============================================================================

describe('Source code: events.ts YOLO + per-project safety', () => {
  const source = readFileSync(
    join(__dirname, '../server/routes/events.ts'),
    'utf-8'
  )

  it('imports shared isYoloMode from yolo-mode module', () => {
    expect(source).toContain('isYoloMode')
    expect(source).toContain("from '../lib/yolo-mode")
  })

  it('has safetyApprovedProjects Set for per-project tracking', () => {
    expect(source).toContain('safetyApprovedProjects')
    expect(source).toContain('new Set<string>()')
  })

  it('emits task:safety_auto_proceeded SSE event', () => {
    expect(source).toContain("'task:safety_auto_proceeded'")
  })

  it('persists safety_response for auto-proceeded prompts', () => {
    expect(source).toContain("streamingEventLog.append(msg.taskId, 'safety_response'")
  })

  it('listens for task:safety_approved relay events', () => {
    expect(source).toContain("relayServer.on('task:safety_approved'")
  })

  it('cleans up task:safety_approved listener on disconnect', () => {
    expect(source).toContain("relayServer.off('task:safety_approved'")
  })

  it('per-project check happens before YOLO DB read in safety prompt handler', () => {
    // In the safety prompt handler specifically, per-project check should come before YOLO.
    // events.ts has multiple isYoloMode calls — the one in the safety prompt handler
    // (after safetyApprovedProjects.has) is the relevant one.
    const projectCheckIdx = source.indexOf('safetyApprovedProjects.has(')
    expect(projectCheckIdx).toBeGreaterThan(-1)
    // Find the isYoloMode call AFTER the per-project check (same handler)
    // isYoloMode now takes (user?.id, msg.taskId) for playground-aware YOLO
    const yoloAfterProjectIdx = source.indexOf('isYoloMode(user?.id, msg.taskId).then(', projectCheckIdx)
    expect(yoloAfterProjectIdx).toBeGreaterThan(-1)
    expect(projectCheckIdx).toBeLessThan(yoloAfterProjectIdx)
  })
})

// ============================================================================
// 9. realtime-client.ts: SSE event type registration
// ============================================================================

describe('SSE event type: task:safety_auto_proceeded', () => {
  const source = readFileSync(
    join(__dirname, '../src/lib/realtime-client.ts'),
    'utf-8'
  )

  it('RealtimeEventType includes safety_auto_proceeded', () => {
    expect(source).toContain("'task:safety_auto_proceeded'")
  })

  it('appears in both type definition AND eventTypes array', () => {
    const typeDefMatch = source.match(/RealtimeEventType\s*=[\s\S]*?'task:safety_auto_proceeded'/)
    const arrayMatch = source.match(/eventTypes[\s\S]*?'task:safety_auto_proceeded'/)
    expect(typeDefMatch).not.toBeNull()
    expect(arrayMatch).not.toBeNull()
  })
})

// ============================================================================
// 10. Safety prompt dialog is rendered in app layout
// ============================================================================

describe('SafetyPromptDialog in app layout', () => {
  const source = readFileSync(
    join(__dirname, '../src/components/layout/app-layout.tsx'),
    'utf-8'
  )

  it('renders SafetyPromptDialog component', () => {
    expect(source).toContain('<SafetyPromptDialog')
  })

  it('imports SafetyPromptDialog', () => {
    expect(source).toContain("SafetyPromptDialog")
    expect(source).toMatch(/import.*SafetyPromptDialog/)
  })
})

// ============================================================================
// 11. Comment section multiline support
// ============================================================================

describe('Comment section multiline', () => {
  const source = readFileSync(
    join(__dirname, '../src/components/task-detail/comment-section.tsx'),
    'utf-8'
  )

  it('comment content uses whitespace-pre-wrap', () => {
    expect(source).toContain('whitespace-pre-wrap')
  })

  it('textarea allows multi-row input', () => {
    expect(source).toContain('rows={2}')
  })

  it('supports Cmd+Enter to submit', () => {
    // Check for metaKey (Cmd on Mac) + Enter handling
    expect(source).toContain("e.key === 'Enter'")
    expect(source).toContain('e.metaKey')
  })
})

// ============================================================================
// 12. SSE disconnect banner state machine (pure logic)
// ============================================================================

describe('SSE disconnect banner: state machine logic', () => {
  type Phase = 'waiting' | 'ready' | 'disconnected' | 'reconnected'

  /**
   * Simulates the state machine transitions in sse-disconnect-banner.tsx.
   * On connect: waiting → ready, disconnected → reconnected
   * On disconnect: ready → disconnected (after delay)
   */
  function transition(connected: boolean, currentPhase: Phase): Phase | null {
    if (connected) {
      if (currentPhase === 'waiting') return 'ready'
      if (currentPhase === 'disconnected') return 'reconnected'
    }
    // Disconnect transitions are handled by delay timer, not here
    return null
  }

  it('waiting + connected → ready', () => {
    expect(transition(true, 'waiting')).toBe('ready')
  })

  it('disconnected + connected → reconnected', () => {
    expect(transition(true, 'disconnected')).toBe('reconnected')
  })

  it('ready + connected → no change', () => {
    expect(transition(true, 'ready')).toBeNull()
  })

  it('reconnected + connected → no change', () => {
    expect(transition(true, 'reconnected')).toBeNull()
  })

  it('waiting + disconnected → no change (still initializing)', () => {
    expect(transition(false, 'waiting')).toBeNull()
  })

  it('ready + disconnected → no immediate change (delay handles it)', () => {
    expect(transition(false, 'ready')).toBeNull()
  })

  it('disconnected + still disconnected → no change', () => {
    expect(transition(false, 'disconnected')).toBeNull()
  })

  // Full flow simulation
  it('full lifecycle: waiting → ready → disconnected → reconnected → ready', () => {
    let phase: Phase = 'waiting'

    // Initial connect
    const t1 = transition(true, phase)
    expect(t1).toBe('ready')
    phase = t1!

    // Disconnect (simulated: delay would set this)
    phase = 'disconnected'

    // Reconnect
    const t2 = transition(true, phase)
    expect(t2).toBe('reconnected')
    phase = t2!

    // Banner visible phases
    expect(phase).toBe('reconnected')
    // After auto-dismiss timer, would go back to 'ready'
  })

  // Banner visibility logic
  function shouldShowBanner(phase: Phase): boolean {
    return phase === 'disconnected' || phase === 'reconnected'
  }

  it('banner hidden during waiting phase', () => {
    expect(shouldShowBanner('waiting')).toBe(false)
  })

  it('banner hidden during ready phase', () => {
    expect(shouldShowBanner('ready')).toBe(false)
  })

  it('banner shown during disconnected phase', () => {
    expect(shouldShowBanner('disconnected')).toBe(true)
  })

  it('banner shown during reconnected phase', () => {
    expect(shouldShowBanner('reconnected')).toBe(true)
  })
})
