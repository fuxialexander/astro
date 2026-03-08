/**
 * Tests for post-completion session resume UI logic.
 *
 * Verifies:
 * - canSteer derivation: running, local completed, remote completed, no session
 * - Routing: steer vs chat based on canSteer
 * - Session context notice text adapts to mode
 * - Placeholder text adapts to mode
 * - Dead steer-chat.tsx was removed
 *
 * Run with: npx vitest run tests/steer-resume-ui.test.ts
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// ─── canSteer derivation ────────────────────────────────────────────────────
//
// The logic in unified-activity-view.tsx is:
//   const canSteer = isRunning || (execution?.status === "success" && !!execution?.sessionId)
//
// We test this as a pure function extracted from the component logic.

function canSteer(
  isRunning: boolean,
  executionStatus: string | undefined,
  sessionId: string | undefined,
): boolean {
  return isRunning || (executionStatus === 'success' && !!sessionId)
}

// ─── Routing derivation ────────────────────────────────────────────────────
//
// The routing in unified-activity-view.tsx is:
//   if (canSteer) { handleSteer(text, interrupt) } else { handleChat(text) }

function routeMessage(
  isRunning: boolean,
  executionStatus: string | undefined,
  sessionId: string | undefined,
): 'steer' | 'chat' {
  return canSteer(isRunning, executionStatus, sessionId) ? 'steer' : 'chat'
}

// ─── Placeholder derivation ────────────────────────────────────────────────

function getPlaceholder(
  isRunning: boolean,
  steerEnabled: boolean,
): string {
  if (steerEnabled) {
    return isRunning
      ? 'Steer the agent... (type @ to reference files)'
      : 'Resume session in worktree... (type @ to reference files)'
  }
  return 'Ask about this task... (type @ to reference files)'
}

// ─── Session context notice ────────────────────────────────────────────────

function getSessionNotice(
  isRunning: boolean,
  steerEnabled: boolean,
  branchName: string | undefined,
): string | null {
  if (isRunning) return null // no notice during active execution
  if (steerEnabled) {
    return `Resume session in worktree${branchName ? ` on \`${branchName}\`` : ''}`
  }
  return `Follow-up chat${branchName ? ` — changes on \`${branchName}\`` : ''}`
}

// ═══════════════════════════════════════════════════════════════════════════

describe('canSteer derivation', () => {
  describe('running tasks', () => {
    it('allows steer on running task (local)', () => {
      expect(canSteer(true, 'running', undefined)).toBe(true)
    })

    it('allows steer on running task (remote)', () => {
      expect(canSteer(true, 'running', 'session-123')).toBe(true)
    })

    it('allows steer on running task without session', () => {
      expect(canSteer(true, undefined, undefined)).toBe(true)
    })
  })

  describe('completed tasks with session', () => {
    it('allows steer on completed local task with session', () => {
      expect(canSteer(false, 'success', 'session-local-123')).toBe(true)
    })

    it('allows steer on completed remote task with session', () => {
      expect(canSteer(false, 'success', 'session-remote-456')).toBe(true)
    })

    it('allows steer regardless of machine type when session exists', () => {
      // This is the key change — no machineId === "local" check
      expect(canSteer(false, 'success', 'any-session-id')).toBe(true)
    })
  })

  describe('completed tasks without session', () => {
    it('disallows steer on completed task without session', () => {
      expect(canSteer(false, 'success', undefined)).toBe(false)
    })

    it('disallows steer on completed task with empty session', () => {
      expect(canSteer(false, 'success', '')).toBe(false)
    })
  })

  describe('failed tasks', () => {
    it('disallows steer on failed task even with session', () => {
      expect(canSteer(false, 'failure', 'session-123')).toBe(false)
    })

    it('disallows steer on failed task without session', () => {
      expect(canSteer(false, 'failure', undefined)).toBe(false)
    })
  })

  describe('other statuses', () => {
    it('disallows steer on planned task', () => {
      expect(canSteer(false, 'planned', undefined)).toBe(false)
    })

    it('disallows steer on dispatched task', () => {
      expect(canSteer(false, 'dispatched', undefined)).toBe(false)
    })

    it('disallows steer on pruned task', () => {
      expect(canSteer(false, 'pruned', undefined)).toBe(false)
    })

    it('disallows steer when execution is undefined', () => {
      expect(canSteer(false, undefined, undefined)).toBe(false)
    })
  })
})

describe('message routing', () => {
  it('routes to steer when task is running', () => {
    expect(routeMessage(true, 'running', undefined)).toBe('steer')
  })

  it('routes to steer when task completed with session (local)', () => {
    expect(routeMessage(false, 'success', 'session-local')).toBe('steer')
  })

  it('routes to steer when task completed with session (remote)', () => {
    expect(routeMessage(false, 'success', 'session-remote')).toBe('steer')
  })

  it('routes to chat when task completed without session', () => {
    expect(routeMessage(false, 'success', undefined)).toBe('chat')
  })

  it('routes to chat when task failed', () => {
    expect(routeMessage(false, 'failure', 'session-123')).toBe('chat')
  })

  it('routes to chat when no execution', () => {
    expect(routeMessage(false, undefined, undefined)).toBe('chat')
  })
})

describe('placeholder text', () => {
  it('shows steer placeholder when running', () => {
    expect(getPlaceholder(true, true)).toBe(
      'Steer the agent... (type @ to reference files)',
    )
  })

  it('shows resume placeholder when completed with session', () => {
    expect(getPlaceholder(false, true)).toBe(
      'Resume session in worktree... (type @ to reference files)',
    )
  })

  it('shows chat placeholder when no steer available', () => {
    expect(getPlaceholder(false, false)).toBe(
      'Ask about this task... (type @ to reference files)',
    )
  })
})

describe('session context notice', () => {
  it('returns null during active execution', () => {
    expect(getSessionNotice(true, true, 'feat/test')).toBeNull()
  })

  it('shows resume notice for completed task with session', () => {
    expect(getSessionNotice(false, true, undefined)).toBe(
      'Resume session in worktree',
    )
  })

  it('shows resume notice with branch name', () => {
    expect(getSessionNotice(false, true, 'feat/my-branch')).toBe(
      'Resume session in worktree on `feat/my-branch`',
    )
  })

  it('shows follow-up chat notice without session', () => {
    expect(getSessionNotice(false, false, undefined)).toBe('Follow-up chat')
  })

  it('shows follow-up chat notice with branch', () => {
    expect(getSessionNotice(false, false, 'feat/other')).toBe(
      'Follow-up chat — changes on `feat/other`',
    )
  })
})

describe('dead code removal', () => {
  it('steer-chat.tsx does not exist', () => {
    const steerChatPath = join(
      __dirname,
      '..',
      'src',
      'components',
      'task-detail',
      'steer-chat.tsx',
    )
    expect(existsSync(steerChatPath)).toBe(false)
  })
})

// ─── canSteer equivalence table ──────────────────────────────────────────
//
// Exhaustive truth table verifying the formula:
//   canSteer = isRunning || (status === "success" && !!sessionId)

describe('canSteer truth table', () => {
  const cases: Array<{
    isRunning: boolean
    status: string | undefined
    sessionId: string | undefined
    expected: boolean
    label: string
  }> = [
    { isRunning: true, status: 'running', sessionId: 'sid', expected: true, label: 'running + session' },
    { isRunning: true, status: 'running', sessionId: undefined, expected: true, label: 'running, no session' },
    { isRunning: true, status: undefined, sessionId: undefined, expected: true, label: 'running, no status' },
    { isRunning: false, status: 'success', sessionId: 'sid', expected: true, label: 'success + session' },
    { isRunning: false, status: 'success', sessionId: undefined, expected: false, label: 'success, no session' },
    { isRunning: false, status: 'success', sessionId: '', expected: false, label: 'success, empty session' },
    { isRunning: false, status: 'failure', sessionId: 'sid', expected: false, label: 'failure + session' },
    { isRunning: false, status: 'failure', sessionId: undefined, expected: false, label: 'failure, no session' },
    { isRunning: false, status: 'planned', sessionId: undefined, expected: false, label: 'planned' },
    { isRunning: false, status: 'dispatched', sessionId: undefined, expected: false, label: 'dispatched' },
    { isRunning: false, status: 'pruned', sessionId: undefined, expected: false, label: 'pruned' },
    { isRunning: false, status: undefined, sessionId: undefined, expected: false, label: 'no execution' },
    { isRunning: false, status: undefined, sessionId: 'sid', expected: false, label: 'no status + session' },
    { isRunning: false, status: 'auto_verified', sessionId: 'sid', expected: false, label: 'auto_verified + session' },
    { isRunning: false, status: 'awaiting_judgment', sessionId: 'sid', expected: false, label: 'awaiting_judgment + session' },
    { isRunning: false, status: 'completed', sessionId: 'sid', expected: false, label: 'completed + session (not success)' },
  ]

  for (const { isRunning, status, sessionId, expected, label } of cases) {
    it(label, () => {
      expect(canSteer(isRunning, status, sessionId)).toBe(expected)
    })
  }
})

// ─── Routing matrix ─────────────────────────────────────────────────────
//
// Verifies the correct route (steer vs chat) for realistic scenarios

describe('routing scenarios', () => {
  const scenarios: Array<{
    label: string
    isRunning: boolean
    status: string | undefined
    sessionId: string | undefined
    expectedRoute: 'steer' | 'chat'
  }> = [
    // Active execution
    { label: 'Claude running on local machine', isRunning: true, status: 'running', sessionId: 'session-claude', expectedRoute: 'steer' },
    { label: 'Codex running on remote HPC', isRunning: true, status: 'running', sessionId: undefined, expectedRoute: 'steer' },

    // Post-completion resume (the key feature)
    { label: 'Claude completed on local — resume session', isRunning: false, status: 'success', sessionId: 'session-claude-done', expectedRoute: 'steer' },
    { label: 'Codex completed on remote — resume session', isRunning: false, status: 'success', sessionId: 'session-codex-done', expectedRoute: 'steer' },
    { label: 'OpenClaw completed on HPC — resume session', isRunning: false, status: 'success', sessionId: 'session-openclaw', expectedRoute: 'steer' },
    { label: 'OpenCode completed — resume session', isRunning: false, status: 'success', sessionId: 'session-opencode', expectedRoute: 'steer' },

    // No session — falls back to chat
    { label: 'Old task without session — chat mode', isRunning: false, status: 'success', sessionId: undefined, expectedRoute: 'chat' },
    { label: 'Failed task — chat mode', isRunning: false, status: 'failure', sessionId: 'session-123', expectedRoute: 'chat' },
    { label: 'Planned task — chat mode', isRunning: false, status: 'planned', sessionId: undefined, expectedRoute: 'chat' },
  ]

  for (const { label, isRunning, status, sessionId, expectedRoute } of scenarios) {
    it(label, () => {
      expect(routeMessage(isRunning, status, sessionId)).toBe(expectedRoute)
    })
  }
})
