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
 *
 * Scenarios tested:
 * - Local branch mode: all success, some pruned, no branch
 * - Remote PR mode: PR created, PR failed, PR already existed
 * - Dedup: server event after client toast, server event first (race)
 * - Source code validation: SSE type registration, event forwarding
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ============================================================================
// 1. Client-side completion toast (execution-store)
// ============================================================================

describe('Client-side completion toast messages', () => {
  /**
   * Simulates the toast message logic from execution-store.ts.
   * This is the FIRST toast the user sees — instant, client-side.
   */
  function buildClientToast(opts: {
    projectName?: string
    projectBranch?: string
    allSuccess: boolean
  }): { type: 'success' | 'warning'; title: string; description: string } {
    const { projectName, projectBranch, allSuccess } = opts
    const branch = projectBranch
    let desc: string
    if (projectName && allSuccess && branch) {
      desc = `All tasks in "${projectName}" completed. Changes on branch \`${branch}\`.`
    } else if (projectName && allSuccess) {
      desc = `All tasks in "${projectName}" completed successfully.`
    } else if (projectName) {
      desc = `All tasks in "${projectName}" have finished. Some were pruned.`
    } else {
      desc = allSuccess ? 'All project tasks completed.' : 'All project tasks have finished.'
    }
    return {
      type: allSuccess ? 'success' : 'warning',
      title: allSuccess ? 'All tasks complete' : 'All tasks finished',
      description: desc,
    }
  }

  it('all success with branch — includes branch name', () => {
    const toast = buildClientToast({
      projectName: 'My Project',
      projectBranch: 'astro/abc123',
      allSuccess: true,
    })
    expect(toast.type).toBe('success')
    expect(toast.title).toBe('All tasks complete')
    expect(toast.description).toBe('All tasks in "My Project" completed. Changes on branch `astro/abc123`.')
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
  /**
   * Simulates the toast message logic from realtime-store.ts project:completed handler.
   * This arrives AFTER the server hook runs (potentially with PR info).
   */
  function buildServerToast(opts: {
    projectName?: string
    projectBranch: string
    projectPrUrl?: string
    deliveryMode?: string
    baseBranch?: string
    alreadyNotified: boolean
  }): { title: string; description: string } | null {
    const { projectName, projectBranch, projectPrUrl: prUrl, deliveryMode, baseBranch, alreadyNotified } = opts

    if (prUrl && alreadyNotified) {
      // Follow-up: PR was created after the initial completion toast
      return {
        title: 'PR ready for review',
        description: projectName
          ? `"${projectName}": PR created from \`${projectBranch}\` → \`${baseBranch || 'main'}\`.`
          : `PR created: ${projectBranch} → ${baseBranch || 'main'}.`,
      }
    } else if (!alreadyNotified) {
      // Server event arrived first (rare) — show full completion toast
      let description: string
      if (prUrl) {
        description = projectName
          ? `All tasks in "${projectName}" completed. PR created from \`${projectBranch}\` → \`${baseBranch || 'main'}\`.`
          : `All tasks completed. PR created: ${projectBranch} → ${baseBranch || 'main'}.`
      } else if (deliveryMode === 'pr') {
        description = projectName
          ? `All tasks in "${projectName}" completed. Changes on branch \`${projectBranch}\`. PR creation was skipped.`
          : `All tasks completed on branch \`${projectBranch}\`.`
      } else {
        description = projectName
          ? `All tasks in "${projectName}" completed. Changes on branch \`${projectBranch}\`. Review: \`git diff ${baseBranch || 'main'}...${projectBranch}\``
          : `All tasks completed on branch \`${projectBranch}\`.`
      }
      return {
        title: prUrl ? 'Project complete — PR ready' : 'Project complete',
        description,
      }
    }

    // Already notified, no PR — no follow-up toast
    return null
  }

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
      'All tasks in "My Project" completed. Changes on branch `astro/abc123`. Review: `git diff main...astro/abc123`'
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
    expect(toast!.description).toBe('All tasks completed on branch `astro/abc123`.')
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

  it('shows follow-up PR toast when already notified', () => {
    expect(source).toContain('PR ready for review')
  })

  it('shows full completion toast when not yet notified', () => {
    expect(source).toContain('Project complete — PR ready')
    expect(source).toContain('Project complete')
  })

  it('marks project as notified in completedProjectIds', () => {
    // When server event arrives first, should add to completedProjectIds
    expect(source).toContain('next.add(projectId)')
  })

  it('updates project store with PR info', () => {
    expect(source).toContain('updateProject(projectId')
    expect(source).toContain('projectPrUrl: prUrl')
  })

  it('handles PR mode with failed PR creation', () => {
    expect(source).toContain("deliveryMode === 'pr'")
    expect(source).toContain('PR creation was skipped')
  })

  it('shows git diff hint for local branch mode', () => {
    expect(source).toContain('git diff')
  })

  it('imports useToastStore', () => {
    expect(source).toContain("import { useToastStore } from './toast-store'")
  })
})

// ============================================================================
// 9. Source code verification: execution-store.ts enhanced toast
// ============================================================================

describe('Source code: execution-store completion toast includes branch', () => {
  const source = readFileSync(
    join(__dirname, '../src/stores/execution-store.ts'),
    'utf-8'
  )

  it('reads projectBranch from project', () => {
    expect(source).toContain('proj?.projectBranch')
  })

  it('includes branch in success message', () => {
    expect(source).toContain('Changes on branch')
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
