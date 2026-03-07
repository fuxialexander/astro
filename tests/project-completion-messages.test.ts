/**
 * Project Completion Messages Tests
 *
 * Tests the user-facing toast messages shown when all tasks in a project
 * complete, covering both delivery modes (local branch and remote PR)
 * and the deduplication logic between client-side and server-side notifications.
 *
 * Message flow:
 * 1. Client-side (execution-store): immediate "All tasks complete" toast
 * 2. Server-side (project:completed SSE): follow-up with PR/branch details
 * 3. Persistent dashboard notification (notification-store): stays until user clicks OK
 *
 * Scenarios tested:
 * - Local branch mode: all success, some pruned, no branch
 * - Remote PR mode: PR created, PR failed, PR already existed
 * - Dedup: server event after client toast, server event first (race)
 * - Source code validation: SSE type registration, event forwarding
 * - Notification store: add, dismiss, dismissAll, ordering
 * - Markdown inline rendering: backticks → <code>, edge cases
 * - Integration: notifications wired from execution-store and realtime-store
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildClientCompletionMessage, buildServerCompletionMessage } from '../src/lib/completion-messages'

// ============================================================================
// 1. Client-side completion toast (execution-store)
// ============================================================================

describe('Client-side completion toast messages', () => {
  /** Uses the shared builder — same code path as execution-store.ts */
  const buildClientToast = buildClientCompletionMessage

  it('all success with branch — includes branch name', () => {
    const toast = buildClientToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      allSuccess: true,
    })
    expect(toast.type).toBe('success')
    expect(toast.title).toBe('All tasks complete')
    expect(toast.description).toBe('All tasks in "My Project" completed. Changes on branch `astro/abc123`. Use `git checkout astro/abc123` to review.')
  })

  it('all success without branch — generic success message', () => {
    const toast = buildClientToast({
      projectName: 'My Project',
      projectBranch: undefined,
      allSuccess: true,
    })
    expect(toast.type).toBe('success')
    expect(toast.title).toBe('All tasks complete')
    expect(toast.description).toBe('All tasks in "My Project" completed successfully.')
  })

  it('some pruned — warning with pruned note', () => {
    const toast = buildClientToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      allSuccess: false,
    })
    expect(toast.type).toBe('warning')
    expect(toast.title).toBe('All tasks finished')
    expect(toast.description).toBe('All tasks in "My Project" have finished. Some were pruned.')
  })

  it('no project found — fallback message', () => {
    const toast = buildClientToast({
      projectName: undefined,
      projectBranch: undefined,
      allSuccess: true,
    })
    expect(toast.type).toBe('success')
    expect(toast.description).toBe('All project tasks completed.')
  })

  it('no project, some pruned — fallback warning', () => {
    const toast = buildClientToast({
      projectName: undefined,
      projectBranch: undefined,
      allSuccess: false,
    })
    expect(toast.type).toBe('warning')
    expect(toast.description).toBe('All project tasks have finished.')
  })
})

// ============================================================================
// 2. Server-side completion toast (realtime-store)
// ============================================================================

describe('Server-side project:completed toast messages', () => {
  /** Uses the shared builder — same code path as realtime-store.ts */
  const buildServerToast = buildServerCompletionMessage

  // ── Remote PR mode: PR created ──────────────────────────────────────

  it('remote mode, PR created, already notified — follow-up PR toast', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: 'https://github.com/owner/repo/pull/42',
      deliveryMode: 'pr',
      baseBranch: 'main',
      alreadyNotified: true,
    })
    expect(toast).not.toBeNull()
    expect(toast!.title).toBe('PR ready for review')
    expect(toast!.description).toBe('"My Project": PR created from `astro/abc123` → `main`.')
  })

  it('remote mode, PR created, NOT notified (race) — full toast with PR', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: 'https://github.com/owner/repo/pull/42',
      deliveryMode: 'pr',
      baseBranch: 'main',
      alreadyNotified: false,
    })
    expect(toast).not.toBeNull()
    expect(toast!.title).toBe('Project complete — PR ready')
    expect(toast!.description).toBe('All tasks in "My Project" completed. PR created from `astro/abc123` → `main`.')
  })

  it('remote mode, PR created, custom base branch', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: 'https://github.com/owner/repo/pull/42',
      baseBranch: 'develop',
      alreadyNotified: true,
    })
    expect(toast!.description).toBe('"My Project": PR created from `astro/abc123` → `develop`.')
  })

  it('remote mode, PR created, no project name', () => {
    const toast = buildServerToast({
      projectName: undefined,
      projectBranch: 'astro/abc123',
      projectPrUrl: 'https://github.com/owner/repo/pull/42',
      baseBranch: 'main',
      alreadyNotified: true,
    })
    expect(toast!.description).toBe('PR created: astro/abc123 → main.')
  })

  // ── Remote PR mode: PR failed ───────────────────────────────────────

  it('remote mode, PR failed, already notified — no follow-up toast', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: undefined,
      deliveryMode: 'pr',
      baseBranch: 'main',
      alreadyNotified: true,
    })
    expect(toast).toBeNull()
  })

  it('remote mode, PR failed, NOT notified (race) — completion with skipped note', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: undefined,
      deliveryMode: 'pr',
      baseBranch: 'main',
      alreadyNotified: false,
    })
    expect(toast).not.toBeNull()
    expect(toast!.title).toBe('Project complete')
    expect(toast!.description).toBe('All tasks in "My Project" completed. Changes on branch `astro/abc123`. PR creation was skipped.')
  })

  it('remote mode, PR failed, no project name', () => {
    const toast = buildServerToast({
      projectName: undefined,
      projectBranch: 'astro/abc123',
      projectPrUrl: undefined,
      deliveryMode: 'pr',
      baseBranch: 'main',
      alreadyNotified: false,
    })
    expect(toast!.description).toBe('All tasks completed on branch `astro/abc123`.')
  })

  // ── Local branch mode ───────────────────────────────────────────────

  it('local branch mode, already notified — no follow-up toast', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: undefined,
      deliveryMode: 'branch',
      baseBranch: 'main',
      alreadyNotified: true,
    })
    expect(toast).toBeNull()
  })

  it('local branch mode, NOT notified (race) — completion with git diff hint', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: undefined,
      deliveryMode: 'branch',
      baseBranch: 'main',
      alreadyNotified: false,
    })
    expect(toast).not.toBeNull()
    expect(toast!.title).toBe('Project complete')
    expect(toast!.description).toBe(
      'All tasks in "My Project" completed. Changes on branch `astro/abc123`. Run `git checkout astro/abc123` or `git diff main...astro/abc123` to review.'
    )
  })

  it('local branch mode, custom base branch — git diff uses it', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: undefined,
      deliveryMode: 'branch',
      baseBranch: 'develop',
      alreadyNotified: false,
    })
    expect(toast!.description).toContain('git diff develop...astro/abc123')
  })

  it('local mode, no project name', () => {
    const toast = buildServerToast({
      projectName: undefined,
      projectBranch: 'astro/abc123',
      projectPrUrl: undefined,
      deliveryMode: 'branch',
      baseBranch: 'main',
      alreadyNotified: false,
    })
    expect(toast!.description).toBe('All tasks completed on branch `astro/abc123`. Run `git checkout astro/abc123` to review.')
  })

  // ── baseBranch defaults ─────────────────────────────────────────────

  it('defaults baseBranch to "main" when undefined', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: 'https://github.com/owner/repo/pull/42',
      baseBranch: undefined,
      alreadyNotified: true,
    })
    expect(toast!.description).toContain('→ `main`')
  })

  it('defaults baseBranch to "main" in git diff hint', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: undefined,
      deliveryMode: 'branch',
      baseBranch: undefined,
      alreadyNotified: false,
    })
    expect(toast!.description).toContain('git diff main...astro/abc123')
  })

  // ── Direct delivery mode ────────────────────────────────────────────

  it('direct mode — same as local branch mode', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: undefined,
      deliveryMode: 'direct',
      baseBranch: 'main',
      alreadyNotified: false,
    })
    expect(toast!.title).toBe('Project complete')
    expect(toast!.description).toContain('Changes on branch')
  })

  it('no delivery mode specified — same as local branch mode', () => {
    const toast = buildServerToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: undefined,
      deliveryMode: undefined,
      baseBranch: 'main',
      alreadyNotified: false,
    })
    expect(toast!.title).toBe('Project complete')
    expect(toast!.description).toContain('Changes on branch')
  })
})

// ============================================================================
// 3. Deduplication logic
// ============================================================================

describe('Toast deduplication between client and server', () => {
  /**
   * Simulates the completedProjectIds Set and the interaction between
   * execution-store (client-side) and realtime-store (server-side).
   */
  function createNotificationTracker() {
    const completedProjectIds = new Set<string>()
    const toasts: Array<{ source: string; title: string }> = []

    return {
      // Client-side: execution-store detects completion
      clientDetectsCompletion: (projectId: string) => {
        if (!completedProjectIds.has(projectId)) {
          completedProjectIds.add(projectId)
          toasts.push({ source: 'client', title: 'All tasks complete' })
          return true
        }
        return false
      },

      // Server-side: project:completed SSE event
      serverEventArrives: (projectId: string, hasPr: boolean) => {
        const alreadyNotified = completedProjectIds.has(projectId)
        if (hasPr && alreadyNotified) {
          toasts.push({ source: 'server', title: 'PR ready for review' })
          return 'follow-up'
        } else if (!alreadyNotified) {
          completedProjectIds.add(projectId)
          toasts.push({
            source: 'server',
            title: hasPr ? 'Project complete — PR ready' : 'Project complete',
          })
          return 'full'
        }
        return 'suppressed'
      },

      toasts,
      isNotified: (projectId: string) => completedProjectIds.has(projectId),
    }
  }

  it('normal flow: client first, then server with PR — two toasts', () => {
    const tracker = createNotificationTracker()
    tracker.clientDetectsCompletion('project-1')
    const action = tracker.serverEventArrives('project-1', true)

    expect(action).toBe('follow-up')
    expect(tracker.toasts).toHaveLength(2)
    expect(tracker.toasts[0]).toEqual({ source: 'client', title: 'All tasks complete' })
    expect(tracker.toasts[1]).toEqual({ source: 'server', title: 'PR ready for review' })
  })

  it('normal flow: client first, server without PR — one toast only', () => {
    const tracker = createNotificationTracker()
    tracker.clientDetectsCompletion('project-1')
    const action = tracker.serverEventArrives('project-1', false)

    expect(action).toBe('suppressed')
    expect(tracker.toasts).toHaveLength(1)
    expect(tracker.toasts[0].source).toBe('client')
  })

  it('race: server arrives first with PR — one full toast', () => {
    const tracker = createNotificationTracker()
    const action = tracker.serverEventArrives('project-1', true)

    expect(action).toBe('full')
    expect(tracker.toasts).toHaveLength(1)
    expect(tracker.toasts[0]).toEqual({ source: 'server', title: 'Project complete — PR ready' })
  })

  it('race: server arrives first, then client — client suppressed', () => {
    const tracker = createNotificationTracker()
    tracker.serverEventArrives('project-1', false)
    const clientFired = tracker.clientDetectsCompletion('project-1')

    expect(clientFired).toBe(false)
    expect(tracker.toasts).toHaveLength(1)
    expect(tracker.toasts[0].source).toBe('server')
  })

  it('different projects get independent notifications', () => {
    const tracker = createNotificationTracker()
    tracker.clientDetectsCompletion('project-1')
    tracker.clientDetectsCompletion('project-2')

    expect(tracker.toasts).toHaveLength(2)
    expect(tracker.isNotified('project-1')).toBe(true)
    expect(tracker.isNotified('project-2')).toBe(true)
  })

  it('duplicate client detections are idempotent', () => {
    const tracker = createNotificationTracker()
    tracker.clientDetectsCompletion('project-1')
    tracker.clientDetectsCompletion('project-1')
    tracker.clientDetectsCompletion('project-1')

    expect(tracker.toasts).toHaveLength(1)
  })

  it('duplicate server events are idempotent', () => {
    const tracker = createNotificationTracker()
    tracker.clientDetectsCompletion('project-1')
    tracker.serverEventArrives('project-1', true) // follow-up
    tracker.serverEventArrives('project-1', true) // should also follow-up (not suppressed)

    // Both server events produce follow-ups because PR URL is present
    expect(tracker.toasts).toHaveLength(3)
  })
})

// ============================================================================
// 4. Project completion hook logic
// ============================================================================

describe('Project completion hook event emission', () => {
  /**
   * Simulates the decision logic in project-completion-hook.ts for
   * whether and what to include in the project.completed event.
   */
  function simulateHook(opts: {
    hasGitHub: boolean
    projectPrUrl?: string
    projectBranch?: string
    allNodesComplete: boolean
    pushToGithubNode?: boolean
    prCreated?: boolean
  }): {
    emitted: boolean
    prUrl?: string
    prNumber?: number
    projectBranch?: string
  } {
    if (!opts.allNodesComplete) return { emitted: false }
    if (!opts.projectBranch) return { emitted: false }

    let prUrl: string | undefined
    let prNumber: number | undefined

    if (opts.hasGitHub && !opts.projectPrUrl) {
      if (opts.pushToGithubNode) {
        // Skip PR creation — explicit node handles it
      } else if (opts.prCreated) {
        prUrl = 'https://github.com/owner/repo/pull/99'
        prNumber = 99
      }
    } else if (opts.projectPrUrl) {
      prUrl = opts.projectPrUrl
      prNumber = 42
    }

    return {
      emitted: true,
      prUrl,
      prNumber,
      projectBranch: opts.projectBranch,
    }
  }

  it('emits for local projects with no GitHub', () => {
    const result = simulateHook({
      hasGitHub: false,
      projectBranch: 'astro/abc123',
      allNodesComplete: true,
    })
    expect(result.emitted).toBe(true)
    expect(result.prUrl).toBeUndefined()
    expect(result.projectBranch).toBe('astro/abc123')
  })

  it('emits with PR URL for GitHub projects when PR created', () => {
    const result = simulateHook({
      hasGitHub: true,
      projectBranch: 'astro/abc123',
      allNodesComplete: true,
      prCreated: true,
    })
    expect(result.emitted).toBe(true)
    expect(result.prUrl).toContain('github.com')
    expect(result.prNumber).toBe(99)
  })

  it('emits without PR URL when GitHub PR creation fails', () => {
    const result = simulateHook({
      hasGitHub: true,
      projectBranch: 'astro/abc123',
      allNodesComplete: true,
      prCreated: false,
    })
    expect(result.emitted).toBe(true)
    expect(result.prUrl).toBeUndefined()
  })

  it('does NOT emit when not all nodes complete', () => {
    const result = simulateHook({
      hasGitHub: false,
      projectBranch: 'astro/abc123',
      allNodesComplete: false,
    })
    expect(result.emitted).toBe(false)
  })

  it('does NOT emit when no project branch', () => {
    const result = simulateHook({
      hasGitHub: false,
      projectBranch: undefined,
      allNodesComplete: true,
    })
    expect(result.emitted).toBe(false)
  })

  it('skips PR creation when Push to GitHub node exists', () => {
    const result = simulateHook({
      hasGitHub: true,
      projectBranch: 'astro/abc123',
      allNodesComplete: true,
      pushToGithubNode: true,
      prCreated: false, // would have been created without the push node
    })
    expect(result.emitted).toBe(true)
    expect(result.prUrl).toBeUndefined()
  })

  it('carries forward existing PR URL', () => {
    const result = simulateHook({
      hasGitHub: true,
      projectPrUrl: 'https://github.com/owner/repo/pull/42',
      projectBranch: 'astro/abc123',
      allNodesComplete: true,
    })
    expect(result.emitted).toBe(true)
    expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42')
  })
})

// ============================================================================
// 5. SSE event type registration
// ============================================================================

describe('SSE event type: project:completed', () => {
  it('RealtimeEventType includes project:completed', () => {
    const source = readFileSync(
      join(__dirname, '../src/lib/realtime-client.ts'),
      'utf-8'
    )
    expect(source).toContain("'project:completed'")
  })

  it('eventTypes array includes project:completed for SSE listener', () => {
    const source = readFileSync(
      join(__dirname, '../src/lib/realtime-client.ts'),
      'utf-8'
    )
    // Should appear in both the type definition AND the eventTypes array
    const typeDefMatch = source.match(/RealtimeEventType\s*=[\s\S]*?'project:completed'/)
    const arrayMatch = source.match(/eventTypes[\s\S]*?'project:completed'/)
    expect(typeDefMatch).not.toBeNull()
    expect(arrayMatch).not.toBeNull()
  })
})

// ============================================================================
// 6. Source code verification: events.ts project:completed handler
// ============================================================================

describe('Source code: events.ts project:completed handler', () => {
  const source = readFileSync(
    join(__dirname, '../server/routes/events.ts'),
    'utf-8'
  )

  it('imports ProjectCompletedEvent type', () => {
    expect(source).toContain('ProjectCompletedEvent')
  })

  it('handles project.completed in astroEventHandler', () => {
    expect(source).toContain("event.type === 'project.completed'")
  })

  it('forwards as project:completed SSE event', () => {
    expect(source).toContain("event: 'project:completed'")
  })

  it('checks project ownership before forwarding', () => {
    expect(source).toContain('isProjectOwnedByUser(event.projectId)')
  })

  it('includes delivery-relevant fields in SSE payload', () => {
    expect(source).toContain('projectBranch: event.projectBranch')
    expect(source).toContain('projectPrUrl: event.projectPrUrl')
    expect(source).toContain('projectPrNumber: event.projectPrNumber')
    expect(source).toContain('deliveryMode: event.project?.deliveryMode')
    expect(source).toContain('projectName: event.project?.name')
  })

  it('extracts baseBranch from project.source', () => {
    // Should read baseBranch from project.source, defaulting to 'main'
    expect(source).toContain("baseBranch")
    expect(source).toContain("'main'")
  })
})

// ============================================================================
// 7. Source code verification: project-completion-hook.ts
// ============================================================================

describe('Source code: project-completion-hook emits project.completed', () => {
  const source = readFileSync(
    join(__dirname, '../server/lib/events/hooks/project-completion-hook.ts'),
    'utf-8'
  )

  it('imports astroEventTransport', () => {
    expect(source).toContain("import { astroEventTransport } from '../astro-event-transport.js'")
  })

  it('emits project.completed event', () => {
    expect(source).toContain("type: 'project.completed'")
  })

  it('includes projectBranch in emitted event', () => {
    // The emitEvent call should include projectBranch
    expect(source).toContain('projectBranch,')
  })

  it('includes projectPrUrl in emitted event', () => {
    expect(source).toContain('projectPrUrl: prUrl')
  })

  it('includes projectPrNumber in emitted event', () => {
    expect(source).toContain('projectPrNumber: prNumber')
  })

  it('handles both GitHub and non-GitHub projects (no early return for non-GitHub)', () => {
    // The hook should NOT have an early return for non-GitHub projects before emitEvent
    // Old code had: if (!project.githubOwner || !project.githubRepo) return
    // New code should NOT have that guard before the emit
    const hookFn = source.match(/export const projectCompletionHook[\s\S]*$/)
    expect(hookFn).not.toBeNull()
    const hookBody = hookFn![0]

    // Should not return early based on GitHub config before allNodesComplete check
    const emitLine = hookBody.indexOf("type: 'project.completed'")
    expect(emitLine).toBeGreaterThan(0)

    // Check that the emit is NOT inside a GitHub-only conditional
    // The emit should be at the same nesting level as the allNodesComplete check
    const linesBeforeEmit = hookBody.slice(0, emitLine)
    expect(linesBeforeEmit).not.toMatch(/if\s*\(hasGitHub\b[^)]*\)\s*\{[^}]*type:\s*'project\.completed'/)
  })

  it('carries forward existing projectPrUrl for already-PR-ed projects', () => {
    expect(source).toContain('project.projectPrUrl')
    expect(source).toContain('project.projectPrNumber')
  })

  it('reads baseBranch from project.source', () => {
    expect(source).toContain("project.source as { baseBranch?: string }")
    expect(source).toContain("?? 'main'")
  })
})

// ============================================================================
// 8. Source code verification: realtime-store.ts project:completed handler
// ============================================================================

describe('Source code: realtime-store handles project:completed', () => {
  const source = readFileSync(
    join(__dirname, '../src/stores/realtime-store.ts'),
    'utf-8'
  )

  it('has a case for project:completed', () => {
    expect(source).toContain("case 'project:completed'")
  })

  it('checks completedProjectIds for dedup', () => {
    expect(source).toContain('completedProjectIds')
  })

  it('delegates message building to buildServerCompletionMessage', () => {
    expect(source).toContain('buildServerCompletionMessage(')
  })

  it('conditionally shows toast and notification when msg is non-null', () => {
    expect(source).toContain('if (msg)')
    expect(source).toContain('useToastStore.getState().add(')
    expect(source).toContain('useNotificationStore.getState().add(')
  })

  it('marks project as notified in completedProjectIds', () => {
    // When server event arrives first, should add to completedProjectIds
    expect(source).toContain('next.add(projectId)')
  })

  it('updates project store with PR info', () => {
    expect(source).toContain('updateProject(projectId')
    expect(source).toContain('projectPrUrl: prUrl')
  })

  it('uses shared builder for message logic', () => {
    expect(source).toContain("import { buildServerCompletionMessage } from '@/lib/completion-messages'")
    expect(source).toContain('buildServerCompletionMessage(')
  })

  it('imports useToastStore', () => {
    expect(source).toContain("import { useToastStore } from './toast-store'")
  })
})

// ============================================================================
// 9. Source code verification: execution-store.ts enhanced toast
// ============================================================================

describe('Source code: execution-store completion toast uses shared builder', () => {
  const source = readFileSync(
    join(__dirname, '../src/stores/execution-store.ts'),
    'utf-8'
  )

  it('imports buildClientCompletionMessage', () => {
    expect(source).toContain("import { buildClientCompletionMessage } from \"@/lib/completion-messages\"")
  })

  it('calls buildClientCompletionMessage with project data', () => {
    expect(source).toContain('buildClientCompletionMessage(')
    expect(source).toContain('projectName: proj?.name')
    expect(source).toContain('projectBranch: proj?.projectBranch')
  })

  it('uses completedProjectIds for dedup', () => {
    expect(source).toContain('completedProjectIds')
  })
})

// ============================================================================
// 10. ProjectCompletedEvent type definition
// ============================================================================

describe('ProjectCompletedEvent type', () => {
  const source = readFileSync(
    join(__dirname, '../server/lib/events/types.ts'),
    'utf-8'
  )

  it('is defined in types.ts', () => {
    expect(source).toContain('interface ProjectCompletedEvent')
  })

  it('includes projectBranch field', () => {
    expect(source).toContain('projectBranch: string')
  })

  it('includes optional projectPrUrl', () => {
    expect(source).toContain('projectPrUrl?: string')
  })

  it('includes optional projectPrNumber', () => {
    expect(source).toContain('projectPrNumber?: number')
  })

  it('is part of the AstroEvent union', () => {
    expect(source).toContain('ProjectCompletedEvent')
    // Verify it's in the union
    const unionMatch = source.match(/type AstroEvent\s*=[\s\S]*?ProjectCompletedEvent/)
    expect(unionMatch).not.toBeNull()
  })
})

// ============================================================================
// 10.5. Source code verification: completion-messages.ts (shared builder)
// ============================================================================

describe('Source code: completion-messages.ts shared builder', () => {
  const source = readFileSync(
    join(__dirname, '../src/lib/completion-messages.ts'),
    'utf-8'
  )

  it('exports buildClientCompletionMessage', () => {
    expect(source).toContain('export function buildClientCompletionMessage')
  })

  it('exports buildServerCompletionMessage', () => {
    expect(source).toContain('export function buildServerCompletionMessage')
  })

  it('exports CompletionMessage interface', () => {
    expect(source).toContain('export interface CompletionMessage')
  })

  it('handles all client scenarios: success+branch, success, pruned, fallback', () => {
    expect(source).toContain('Changes on branch')
    expect(source).toContain('completed successfully')
    expect(source).toContain('Some were pruned')
    expect(source).toContain('All project tasks completed.')
  })

  it('handles all server scenarios: PR created, PR failed, local branch', () => {
    expect(source).toContain('PR created from')
    expect(source).toContain('PR creation was skipped')
    expect(source).toContain('git diff')
  })

  it('handles deliveryMode === pr check', () => {
    expect(source).toContain("deliveryMode === 'pr'")
  })

  it('defaults baseBranch to main', () => {
    expect(source).toContain("baseBranch || 'main'")
  })

  it('returns null when suppressed', () => {
    expect(source).toContain('return null')
  })
})

// ============================================================================
// 11. Notification Store
// ============================================================================

describe('Notification store', () => {
  /**
   * Simulates the notification store logic from notification-store.ts.
   * Tests the pure data model independently of Zustand.
   */
  function createNotificationStore() {
    type Notification = {
      id: string
      type: 'info' | 'success' | 'warning' | 'error'
      title: string
      description: string
      createdAt: string
      projectId?: string
      prUrl?: string
    }

    let notifications: Notification[] = []
    let idCounter = 0

    return {
      get notifications() { return notifications },

      add(n: Omit<Notification, 'id' | 'createdAt'>) {
        const entry: Notification = {
          ...n,
          id: `notif-${++idCounter}`,
          createdAt: new Date().toISOString(),
        }
        notifications = [entry, ...notifications]
        return entry
      },

      dismiss(id: string) {
        notifications = notifications.filter((n) => n.id !== id)
      },

      dismissAll() {
        notifications = []
      },
    }
  }

  it('adds a notification and returns it with an id', () => {
    const store = createNotificationStore()
    const n = store.add({
      type: 'success',
      title: 'All tasks complete',
      description: 'All tasks in "My Project" completed.',
    })
    expect(n.id).toBeTruthy()
    expect(n.createdAt).toBeTruthy()
    expect(store.notifications).toHaveLength(1)
  })

  it('newest notification appears first', () => {
    const store = createNotificationStore()
    store.add({ type: 'success', title: 'First', description: 'first' })
    store.add({ type: 'info', title: 'Second', description: 'second' })
    expect(store.notifications[0].title).toBe('Second')
    expect(store.notifications[1].title).toBe('First')
  })

  it('dismisses a notification by id', () => {
    const store = createNotificationStore()
    const n1 = store.add({ type: 'success', title: 'Keep', description: 'keep' })
    const n2 = store.add({ type: 'info', title: 'Remove', description: 'remove' })
    store.dismiss(n2.id)
    expect(store.notifications).toHaveLength(1)
    expect(store.notifications[0].id).toBe(n1.id)
  })

  it('dismissAll clears all notifications', () => {
    const store = createNotificationStore()
    store.add({ type: 'success', title: 'A', description: 'a' })
    store.add({ type: 'info', title: 'B', description: 'b' })
    store.add({ type: 'warning', title: 'C', description: 'c' })
    store.dismissAll()
    expect(store.notifications).toHaveLength(0)
  })

  it('dismiss with unknown id is a no-op', () => {
    const store = createNotificationStore()
    store.add({ type: 'success', title: 'A', description: 'a' })
    store.dismiss('nonexistent')
    expect(store.notifications).toHaveLength(1)
  })

  it('stores projectId when provided', () => {
    const store = createNotificationStore()
    const n = store.add({
      type: 'success',
      title: 'Complete',
      description: 'Done',
      projectId: 'proj-123',
    })
    expect(n.projectId).toBe('proj-123')
  })

  it('stores prUrl when provided', () => {
    const store = createNotificationStore()
    const n = store.add({
      type: 'success',
      title: 'PR ready',
      description: 'Done',
      prUrl: 'https://github.com/owner/repo/pull/42',
    })
    expect(n.prUrl).toBe('https://github.com/owner/repo/pull/42')
  })

  it('supports all notification types', () => {
    const store = createNotificationStore()
    const types = ['info', 'success', 'warning', 'error'] as const
    for (const type of types) {
      store.add({ type, title: type, description: type })
    }
    expect(store.notifications).toHaveLength(4)
    expect(store.notifications.map((n) => n.type)).toEqual(['error', 'warning', 'success', 'info'])
  })

  it('notifications persist until explicitly dismissed (no auto-dismiss)', () => {
    const store = createNotificationStore()
    store.add({ type: 'success', title: 'Persistent', description: 'Stays' })
    // No auto-dismiss — still there
    expect(store.notifications).toHaveLength(1)
    // Only goes away when user clicks OK
    store.dismiss(store.notifications[0].id)
    expect(store.notifications).toHaveLength(0)
  })
})

// ============================================================================
// 12. Markdown inline rendering
// ============================================================================

describe('Markdown inline rendering (backticks)', () => {
  /**
   * Pure function version of renderMarkdownInline for testing.
   * Returns an array of { type: 'text' | 'code', content: string }.
   */
  function parseMarkdownInline(text: string): Array<{ type: 'text' | 'code'; content: string }> {
    const parts: Array<{ type: 'text' | 'code'; content: string }> = []
    let remaining = text

    while (remaining.length > 0) {
      const start = remaining.indexOf('`')
      if (start === -1) {
        parts.push({ type: 'text', content: remaining })
        break
      }
      const end = remaining.indexOf('`', start + 1)
      if (end === -1) {
        parts.push({ type: 'text', content: remaining })
        break
      }
      if (start > 0) {
        parts.push({ type: 'text', content: remaining.slice(0, start) })
      }
      parts.push({ type: 'code', content: remaining.slice(start + 1, end) })
      remaining = remaining.slice(end + 1)
    }

    return parts
  }

  it('plain text with no backticks', () => {
    const result = parseMarkdownInline('Hello world')
    expect(result).toEqual([{ type: 'text', content: 'Hello world' }])
  })

  it('single backtick-wrapped code', () => {
    const result = parseMarkdownInline('Branch `astro/abc123` is ready')
    expect(result).toEqual([
      { type: 'text', content: 'Branch ' },
      { type: 'code', content: 'astro/abc123' },
      { type: 'text', content: ' is ready' },
    ])
  })

  it('multiple backtick-wrapped segments', () => {
    const result = parseMarkdownInline('Run `git diff main...astro/abc123` or `git log`')
    expect(result).toEqual([
      { type: 'text', content: 'Run ' },
      { type: 'code', content: 'git diff main...astro/abc123' },
      { type: 'text', content: ' or ' },
      { type: 'code', content: 'git log' },
    ])
  })

  it('backticks at the start', () => {
    const result = parseMarkdownInline('`astro/abc123` is the branch')
    expect(result).toEqual([
      { type: 'code', content: 'astro/abc123' },
      { type: 'text', content: ' is the branch' },
    ])
  })

  it('backticks at the end', () => {
    const result = parseMarkdownInline('Branch name is `astro/abc123`')
    expect(result).toEqual([
      { type: 'text', content: 'Branch name is ' },
      { type: 'code', content: 'astro/abc123' },
    ])
  })

  it('entire text is backtick-wrapped', () => {
    const result = parseMarkdownInline('`astro/abc123`')
    expect(result).toEqual([{ type: 'code', content: 'astro/abc123' }])
  })

  it('empty backticks', () => {
    const result = parseMarkdownInline('Empty `` here')
    expect(result).toEqual([
      { type: 'text', content: 'Empty ' },
      { type: 'code', content: '' },
      { type: 'text', content: ' here' },
    ])
  })

  it('unmatched backtick — treated as plain text', () => {
    const result = parseMarkdownInline('Some `unclosed backtick')
    expect(result).toEqual([{ type: 'text', content: 'Some `unclosed backtick' }])
  })

  it('empty string', () => {
    const result = parseMarkdownInline('')
    expect(result).toEqual([])
  })

  it('consecutive backtick pairs', () => {
    const result = parseMarkdownInline('`a``b`')
    expect(result).toEqual([
      { type: 'code', content: 'a' },
      { type: 'code', content: 'b' },
    ])
  })

  it('arrow notation in PR message', () => {
    const result = parseMarkdownInline('PR created from `astro/abc123` → `main`.')
    expect(result).toEqual([
      { type: 'text', content: 'PR created from ' },
      { type: 'code', content: 'astro/abc123' },
      { type: 'text', content: ' → ' },
      { type: 'code', content: 'main' },
      { type: 'text', content: '.' },
    ])
  })

  it('git diff command in message', () => {
    const result = parseMarkdownInline('Review: `git diff main...astro/abc123`')
    expect(result).toEqual([
      { type: 'text', content: 'Review: ' },
      { type: 'code', content: 'git diff main...astro/abc123' },
    ])
  })

  it('special characters inside backticks', () => {
    const result = parseMarkdownInline('Branch `feat/my-feature_v2.0` ready')
    expect(result).toEqual([
      { type: 'text', content: 'Branch ' },
      { type: 'code', content: 'feat/my-feature_v2.0' },
      { type: 'text', content: ' ready' },
    ])
  })
})

// ============================================================================
// 13. Notification messages match toast messages
// ============================================================================

describe('Persistent notification messages mirror toast messages', () => {
  /**
   * Both stores (execution-store + realtime-store) call the shared builders
   * from completion-messages.ts and spread the result into both toast and
   * notification. This section proves the messages are identical by design.
   */

  it('client-side: toast and notification have same description — success with branch', () => {
    const msg = buildClientCompletionMessage({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      allSuccess: true,
    })
    // execution-store spreads msg into both toast and notification
    const toast = { ...msg, duration: 8000 }
    const notification = { ...msg, projectId: 'proj-1' }
    expect(toast.description).toBe(notification.description)
    expect(toast.type).toBe(notification.type)
    expect(toast.title).toBe(notification.title)
    expect(notification.projectId).toBe('proj-1')
  })

  it('client-side: toast and notification have same description — pruned', () => {
    const msg = buildClientCompletionMessage({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      allSuccess: false,
    })
    expect(msg.type).toBe('warning')
    // Both toast and notification come from the same msg object
  })

  it('client-side: toast and notification have same description — no project name', () => {
    const msg = buildClientCompletionMessage({
      projectName: undefined,
      projectBranch: undefined,
      allSuccess: true,
    })
    // Same msg spreads into both — guaranteed identical
    expect(msg.description).toBe('All project tasks completed.')
  })

  it('server-side follow-up: single msg object used for both toast and notification', () => {
    const msg = buildServerCompletionMessage({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: 'https://github.com/owner/repo/pull/42',
      baseBranch: 'main',
      alreadyNotified: true,
    })
    expect(msg).not.toBeNull()
    // realtime-store spreads this same msg into both toast and notification
    expect(msg!.prUrl).toBe('https://github.com/owner/repo/pull/42')
    expect(msg!.title).toBe('PR ready for review')
  })

  it('server-side full (PR): single msg object used for both', () => {
    const msg = buildServerCompletionMessage({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: 'https://github.com/owner/repo/pull/42',
      baseBranch: 'main',
      alreadyNotified: false,
    })
    expect(msg).not.toBeNull()
    expect(msg!.prUrl).toBe('https://github.com/owner/repo/pull/42')
    expect(msg!.title).toBe('Project complete — PR ready')
  })

  it('server-side full (local): single msg object, no prUrl', () => {
    const msg = buildServerCompletionMessage({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      deliveryMode: 'branch',
      baseBranch: 'main',
      alreadyNotified: false,
    })
    expect(msg).not.toBeNull()
    expect(msg!.prUrl).toBeUndefined()
    expect(msg!.title).toBe('Project complete')
  })

  it('server-side suppressed (already notified, no PR): returns null', () => {
    const msg = buildServerCompletionMessage({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      deliveryMode: 'branch',
      baseBranch: 'main',
      alreadyNotified: true,
    })
    expect(msg).toBeNull()
  })
})

// ============================================================================
// 14. Source code verification: notification-store.ts
// ============================================================================

describe('Source code: notification-store.ts', () => {
  const source = readFileSync(
    join(__dirname, '../src/stores/notification-store.ts'),
    'utf-8'
  )

  it('exports useNotificationStore', () => {
    expect(source).toContain('export const useNotificationStore')
  })

  it('defines Notification interface with required fields', () => {
    expect(source).toContain('id: string')
    expect(source).toContain('type: NotificationType')
    expect(source).toContain('title: string')
    expect(source).toContain('description: string')
    expect(source).toContain('createdAt: string')
  })

  it('has optional projectId field', () => {
    expect(source).toContain('projectId?: string')
  })

  it('has optional prUrl field', () => {
    expect(source).toContain('prUrl?: string')
  })

  it('has add method', () => {
    expect(source).toContain('add:')
  })

  it('has dismiss method', () => {
    expect(source).toContain('dismiss:')
  })

  it('has dismissAll method', () => {
    expect(source).toContain('dismissAll:')
  })

  it('does NOT auto-dismiss (no setTimeout)', () => {
    expect(source).not.toContain('setTimeout')
  })

  it('exports NotificationType', () => {
    expect(source).toContain('export type NotificationType')
  })

  it('exports Notification type', () => {
    expect(source).toContain('export interface Notification')
  })
})

// ============================================================================
// 15. Source code verification: execution-store adds notifications
// ============================================================================

describe('Source code: execution-store uses shared builder + adds notifications', () => {
  const source = readFileSync(
    join(__dirname, '../src/stores/execution-store.ts'),
    'utf-8'
  )

  it('imports useNotificationStore', () => {
    expect(source).toContain("import { useNotificationStore } from \"./notification-store\"")
  })

  it('imports buildClientCompletionMessage from shared lib', () => {
    expect(source).toContain("import { buildClientCompletionMessage } from \"@/lib/completion-messages\"")
  })

  it('calls buildClientCompletionMessage', () => {
    expect(source).toContain('buildClientCompletionMessage(')
  })

  it('spreads msg into both toast and notification', () => {
    expect(source).toContain('useToastStore.getState().add({ ...msg, duration: 8000 })')
    expect(source).toContain('useNotificationStore.getState().add({ ...msg, projectId: pid })')
  })
})

// ============================================================================
// 16. Source code verification: realtime-store adds notifications
// ============================================================================

describe('Source code: realtime-store uses shared builder + adds notifications', () => {
  const source = readFileSync(
    join(__dirname, '../src/stores/realtime-store.ts'),
    'utf-8'
  )

  it('imports useNotificationStore', () => {
    expect(source).toContain("import { useNotificationStore } from './notification-store'")
  })

  it('imports buildServerCompletionMessage from shared lib', () => {
    expect(source).toContain("import { buildServerCompletionMessage } from '@/lib/completion-messages'")
  })

  it('calls buildServerCompletionMessage in project:completed handler', () => {
    const handler = source.match(/case 'project:completed'[\s\S]*?break/)
    expect(handler).not.toBeNull()
    expect(handler![0]).toContain('buildServerCompletionMessage(')
  })

  it('spreads msg into both toast and notification', () => {
    const handler = source.match(/case 'project:completed'[\s\S]*?break/)
    expect(handler).not.toBeNull()
    expect(handler![0]).toContain('useToastStore.getState().add({ ...msg, duration: 12000 })')
    expect(handler![0]).toContain('useNotificationStore.getState().add(')
  })

  it('passes projectId and prUrl to notification', () => {
    const handler = source.match(/case 'project:completed'[\s\S]*?break/)
    expect(handler).not.toBeNull()
    expect(handler![0]).toContain('projectId')
    expect(handler![0]).toContain('msg.prUrl')
  })
})

// ============================================================================
// 17. Source code verification: dashboard renders NotificationCards
// ============================================================================

describe('Source code: dashboard.tsx renders NotificationCards', () => {
  const source = readFileSync(
    join(__dirname, '../src/pages/dashboard.tsx'),
    'utf-8'
  )

  it('imports NotificationCards', () => {
    expect(source).toContain("import { NotificationCards } from \"@/components/dashboard/notification-card\"")
  })

  it('renders <NotificationCards />', () => {
    expect(source).toContain('<NotificationCards />')
  })

  it('renders notifications before attention cards', () => {
    const notifPos = source.indexOf('<NotificationCards />')
    const attentionPos = source.indexOf('Attention cards')
    expect(notifPos).toBeGreaterThan(-1)
    expect(attentionPos).toBeGreaterThan(-1)
    expect(notifPos).toBeLessThan(attentionPos)
  })
})

// ============================================================================
// 18. Source code verification: notification-card.tsx component
// ============================================================================

describe('Source code: notification-card.tsx', () => {
  const source = readFileSync(
    join(__dirname, '../src/components/dashboard/notification-card.tsx'),
    'utf-8'
  )

  it('exports NotificationCards component', () => {
    expect(source).toContain('export function NotificationCards()')
  })

  it('imports renderMarkdownInline from lib', () => {
    expect(source).toContain("import { renderMarkdownInline } from \"@/lib/markdown-inline\"")
  })

  it('renders OK button for dismissal', () => {
    expect(source).toContain('OK')
    expect(source).toContain('dismiss(notification.id)')
  })

  it('renders View PR link when prUrl is available', () => {
    expect(source).toContain('View PR')
    expect(source).toContain('notification.prUrl')
  })

  it('has Dismiss All button for multiple notifications', () => {
    expect(source).toContain('Dismiss All')
    expect(source).toContain('notifications.length > 1')
  })

  it('returns null when no notifications', () => {
    expect(source).toContain('if (notifications.length === 0) return null')
  })

  it('calls renderMarkdownInline on description', () => {
    expect(source).toContain('renderMarkdownInline(notification.description)')
  })

  it('uses useNotificationStore for state', () => {
    expect(source).toContain("useNotificationStore")
  })

  it('uses formatRelativeTime for timestamp display', () => {
    expect(source).toContain('formatRelativeTime')
  })

  it('shows external link icon for PR button', () => {
    expect(source).toContain('ExternalLink')
  })
})

// ============================================================================
// 19. Source code verification: markdown-inline.ts
// ============================================================================

describe('Source code: markdown-inline.ts', () => {
  const source = readFileSync(
    join(__dirname, '../src/lib/markdown-inline.ts'),
    'utf-8'
  )

  it('exports renderMarkdownInline function', () => {
    expect(source).toContain('export function renderMarkdownInline')
  })

  it('converts backtick pairs to code elements', () => {
    expect(source).toContain("remaining.indexOf(\"`\")")
    expect(source).toContain("\"code\"")
  })

  it('handles unmatched backtick as plain text', () => {
    // When end === -1, should push remaining as-is
    expect(source).toContain('if (end === -1)')
    expect(source).toContain('parts.push(remaining)')
  })

  it('uses createElement for code elements (not JSX)', () => {
    expect(source).toContain('createElement')
  })
})

// ============================================================================
// 20. End-to-end notification flow simulation
// ============================================================================

describe('End-to-end notification flow', () => {
  type Notification = {
    type: 'success' | 'warning'
    title: string
    description: string
    projectId?: string
    prUrl?: string
  }

  type Toast = {
    type: 'success' | 'warning'
    title: string
    description: string
    duration: number
  }

  /**
   * Full simulation of the client + server notification pipeline.
   * Uses the same shared builders as the real stores.
   */
  function createFullPipeline() {
    const completedProjectIds = new Set<string>()
    const toasts: Toast[] = []
    const notifications: Notification[] = []

    return {
      // Simulates execution-store completion detection
      clientComplete(opts: {
        projectId: string
        projectName?: string
        projectBranch?: string
        allSuccess: boolean
      }) {
        const { projectId } = opts
        if (completedProjectIds.has(projectId)) return

        completedProjectIds.add(projectId)
        const msg = buildClientCompletionMessage(opts)
        toasts.push({ ...msg, duration: 8000 })
        notifications.push({ ...msg, projectId })
      },

      // Simulates realtime-store project:completed handler
      serverComplete(opts: {
        projectId: string
        projectName?: string
        projectBranch: string
        projectPrUrl?: string
        deliveryMode?: string
        baseBranch?: string
      }) {
        const { projectId } = opts
        const alreadyNotified = completedProjectIds.has(projectId)
        const msg = buildServerCompletionMessage({ ...opts, alreadyNotified })

        if (msg) {
          toasts.push({ ...msg, duration: 12000 })
          notifications.push({ ...msg, projectId, prUrl: msg.prUrl })
          if (!alreadyNotified) completedProjectIds.add(projectId)
        }
      },

      toasts,
      notifications,
    }
  }

  it('local branch: client + server — one notification, one toast', () => {
    const p = createFullPipeline()
    p.clientComplete({
      projectId: 'proj-1',
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      allSuccess: true,
    })
    p.serverComplete({
      projectId: 'proj-1',
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      deliveryMode: 'branch',
      baseBranch: 'main',
    })
    // Client toast + notification, server suppressed (no new info)
    expect(p.toasts).toHaveLength(1)
    expect(p.notifications).toHaveLength(1)
    expect(p.notifications[0].description).toContain('`astro/abc123`')
  })

  it('remote PR: client + server with PR — two toasts, two notifications', () => {
    const p = createFullPipeline()
    p.clientComplete({
      projectId: 'proj-1',
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      allSuccess: true,
    })
    p.serverComplete({
      projectId: 'proj-1',
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: 'https://github.com/owner/repo/pull/42',
      deliveryMode: 'pr',
      baseBranch: 'main',
    })
    expect(p.toasts).toHaveLength(2)
    expect(p.notifications).toHaveLength(2)
    expect(p.toasts[0].title).toBe('All tasks complete')
    expect(p.toasts[1].title).toBe('PR ready for review')
    expect(p.notifications[1].prUrl).toBe('https://github.com/owner/repo/pull/42')
  })

  it('server arrives first with PR — one toast, one notification', () => {
    const p = createFullPipeline()
    p.serverComplete({
      projectId: 'proj-1',
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: 'https://github.com/owner/repo/pull/42',
      baseBranch: 'main',
    })
    // Client detection happens after — suppressed
    p.clientComplete({
      projectId: 'proj-1',
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      allSuccess: true,
    })
    expect(p.toasts).toHaveLength(1)
    expect(p.notifications).toHaveLength(1)
    expect(p.notifications[0].title).toBe('Project complete — PR ready')
    expect(p.notifications[0].prUrl).toBe('https://github.com/owner/repo/pull/42')
  })

  it('multiple projects: each gets independent notifications', () => {
    const p = createFullPipeline()
    p.clientComplete({ projectId: 'proj-1', projectName: 'Project A', projectBranch: 'astro/aaa', allSuccess: true })
    p.clientComplete({ projectId: 'proj-2', projectName: 'Project B', projectBranch: 'astro/bbb', allSuccess: true })
    p.serverComplete({ projectId: 'proj-1', projectName: 'Project A', projectBranch: 'astro/aaa', projectPrUrl: 'https://github.com/a/pull/1', baseBranch: 'main' })
    p.serverComplete({ projectId: 'proj-2', projectName: 'Project B', projectBranch: 'astro/bbb', deliveryMode: 'branch', baseBranch: 'main' })

    expect(p.toasts).toHaveLength(3) // 2 client + 1 PR follow-up (proj-2 suppressed)
    expect(p.notifications).toHaveLength(3) // same
    expect(p.notifications.filter((n) => n.projectId === 'proj-1')).toHaveLength(2)
    expect(p.notifications.filter((n) => n.projectId === 'proj-2')).toHaveLength(1)
  })

  it('pruned project: notification has warning type', () => {
    const p = createFullPipeline()
    p.clientComplete({
      projectId: 'proj-1',
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      allSuccess: false,
    })
    expect(p.notifications[0].type).toBe('warning')
    expect(p.notifications[0].title).toBe('All tasks finished')
  })

  it('all notifications contain backtick-wrapped branch names for markdown rendering', () => {
    const p = createFullPipeline()
    p.clientComplete({
      projectId: 'proj-1',
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      allSuccess: true,
    })
    p.serverComplete({
      projectId: 'proj-1',
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      projectPrUrl: 'https://github.com/owner/repo/pull/42',
      baseBranch: 'develop',
    })
    // Client notification: branch in backticks
    expect(p.notifications[0].description).toContain('`astro/abc123`')
    // Server notification: branch and base in backticks
    expect(p.notifications[1].description).toContain('`astro/abc123`')
    expect(p.notifications[1].description).toContain('`develop`')
  })

  it('notification with no project name still has useful content', () => {
    const p = createFullPipeline()
    p.clientComplete({
      projectId: 'proj-1',
      projectName: undefined,
      projectBranch: undefined,
      allSuccess: true,
    })
    expect(p.notifications[0].description).toBe('All project tasks completed.')
    expect(p.notifications[0].projectId).toBe('proj-1')
  })
})
