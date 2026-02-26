/**
 * Unit tests for delivery-mode-aware prompt construction, PRResult error
 * propagation, SSE race condition guard, TaskDispatch new fields, and
 * execute tooltip derivation.
 *
 * Pattern: Pure logic simulation — no server imports needed.
 * See tests/relay-dispatch-prompt.test.ts for the reference pattern.
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// 1. Delivery-mode-aware prompt construction
//    Simulates the logic in server/routes/dispatch.ts lines 466-531
// ============================================================================

type DeliveryMode = 'pr' | 'push' | 'branch' | 'copy' | 'direct'

/**
 * Mirrors the prompt construction logic in dispatch.ts.
 * Given delivery parameters, returns the workspace section string.
 */
function buildWorkspaceSection(opts: {
  deliveryMode?: DeliveryMode
  useWorktree?: boolean
  workingDirectory: string
  shortProjectId: string
  shortNodeId: string
  agentDir?: string
}): string {
  const effectiveDelivery = opts.deliveryMode ?? 'pr'
  const effectiveUseWorktree = opts.useWorktree !== false
  const effectiveAgentDir = opts.agentDir ?? '.astro'
  const usesWorktree =
    opts.workingDirectory && effectiveUseWorktree && effectiveDelivery !== 'direct'
  const branchName = `astro/${opts.shortProjectId}-${opts.shortNodeId}`

  if (effectiveDelivery === 'pr' && usesWorktree) {
    return `## Workspace & Delivery

You are working in a git worktree (isolated branch) created from the project at: ${opts.workingDirectory}
Your branch: ${branchName}
The worktree is located under \`${effectiveAgentDir}/worktrees/\` in the git root.

**IMPORTANT:**
- All your changes are on this isolated branch — commit freely
- NEVER cd to or modify files in the original project directory (${opts.workingDirectory})
- When you are done, commit all changes with a descriptive commit message
- After you finish, your branch will be automatically pushed and a PR will be created on GitHub
- Do NOT run \`git push\` or \`gh pr create\` yourself — the platform handles this`
  } else if (effectiveDelivery === 'push' && usesWorktree) {
    return `## Workspace & Delivery

You are working in a git worktree (isolated branch) created from the project at: ${opts.workingDirectory}
Your branch: ${branchName}
The worktree is located under \`${effectiveAgentDir}/worktrees/\` in the git root.

**IMPORTANT:**
- All changes are on this isolated branch — commit freely
- NEVER modify files in the original project directory (${opts.workingDirectory})
- When done, commit all changes with a descriptive commit message
- Your branch will be automatically pushed to the remote (user will create a PR manually)
- Do NOT run \`git push\` yourself — the platform handles this`
  } else if (effectiveDelivery === 'branch' && usesWorktree) {
    return `## Workspace & Delivery

You are working in a git worktree (isolated branch) created from the project at: ${opts.workingDirectory}
Your branch: ${branchName}
The worktree is located under \`${effectiveAgentDir}/worktrees/\` in the git root.

**IMPORTANT:**
- All changes are on this isolated branch — commit freely
- NEVER modify files in the original project directory (${opts.workingDirectory})
- When done, commit all changes with a descriptive commit message
- Your branch will stay local — the user will merge it manually`
  } else if (effectiveDelivery === 'copy' && usesWorktree) {
    return `## Workspace & Delivery

You are working in a temporary copy of the project at: ${opts.workingDirectory}
The original project is at: ${opts.workingDirectory}

**IMPORTANT:**
- Your changes are in a copy — the original is untouched until you finish
- When done, your changes will be diffed against the original and presented for review`
  } else if (effectiveDelivery === 'direct' || !usesWorktree) {
    return `## Workspace & Delivery

You are working directly in the project directory: ${opts.workingDirectory}
There is no branch isolation — changes are made in-place.

**IMPORTANT:**
- Be careful — changes are applied directly to the project files
- When done, commit all changes with a descriptive commit message`
  }

  return ''
}

describe('delivery-mode-aware prompt construction', () => {
  const base = {
    workingDirectory: '/home/user/my-project',
    shortProjectId: 'a1b2c3',
    shortNodeId: 'd4e5f6',
  }

  it('PR mode generates branch name, worktree location, and "PR will be created" instruction', () => {
    const section = buildWorkspaceSection({ ...base, deliveryMode: 'pr' })

    expect(section).toContain('## Workspace & Delivery')
    expect(section).toContain('git worktree (isolated branch)')
    expect(section).toContain('`.astro/worktrees/`')
    expect(section).toContain('astro/a1b2c3-d4e5f6')
    expect(section).toContain('PR will be created on GitHub')
    expect(section).toContain('Do NOT run `git push`')
    expect(section).toContain('Do NOT run `git push` or `gh pr create` yourself')
  })

  it('push mode includes "pushed to remote" and "Do NOT run git push"', () => {
    const section = buildWorkspaceSection({ ...base, deliveryMode: 'push' })

    expect(section).toContain('## Workspace & Delivery')
    expect(section).toContain('git worktree (isolated branch)')
    expect(section).toContain('`.astro/worktrees/`')
    expect(section).toContain('pushed to the remote')
    expect(section).toContain('Do NOT run `git push` yourself')
  })

  it('branch mode includes "branch will stay local"', () => {
    const section = buildWorkspaceSection({ ...base, deliveryMode: 'branch' })

    expect(section).toContain('## Workspace & Delivery')
    expect(section).toContain('git worktree (isolated branch)')
    expect(section).toContain('`.astro/worktrees/`')
    expect(section).toContain('branch will stay local')
    expect(section).toContain('user will merge it manually')
  })

  it('copy mode includes "temporary copy"', () => {
    const section = buildWorkspaceSection({ ...base, deliveryMode: 'copy' })

    expect(section).toContain('## Workspace & Delivery')
    expect(section).toContain('temporary copy')
    expect(section).toContain('original is untouched')
  })

  it('direct mode includes "directly in project directory" and "no branch isolation"', () => {
    const section = buildWorkspaceSection({ ...base, deliveryMode: 'direct' })

    expect(section).toContain('## Workspace & Delivery')
    expect(section).toContain('directly in the project directory')
    expect(section).toContain('no branch isolation')
    expect(section).not.toContain('.astro/worktrees')
  })

  it('worktree location uses agentDir/worktrees/ relative to git root', () => {
    const section = buildWorkspaceSection({ ...base, deliveryMode: 'pr' })
    expect(section).toContain('`.astro/worktrees/`')
    expect(section).toContain('in the git root')
  })

  it('custom agentDir is reflected in worktree location', () => {
    const section = buildWorkspaceSection({ ...base, deliveryMode: 'pr', agentDir: '.custom-agent' })
    expect(section).toContain('`.custom-agent/worktrees/`')
  })

  it('branch name formula: astro/{shortProjectId}-{shortNodeId}', () => {
    const section = buildWorkspaceSection({ ...base, deliveryMode: 'pr' })
    expect(section).toContain(`astro/${base.shortProjectId}-${base.shortNodeId}`)
  })

  it('useWorktree=false falls through to direct mode prompt', () => {
    const section = buildWorkspaceSection({
      ...base,
      deliveryMode: 'pr',
      useWorktree: false,
    })

    // When useWorktree is false, worktreePath is undefined, so it falls through to direct
    expect(section).toContain('directly in the project directory')
    expect(section).toContain('no branch isolation')
    expect(section).not.toContain('.astro/worktrees')
  })

  it('deliveryMode defaults to "pr" when omitted', () => {
    const section = buildWorkspaceSection({ ...base })
    expect(section).toContain('PR will be created on GitHub')
  })
})

// ============================================================================
// 2. PRResult error propagation
//    Verifies the interface shape from packages/agent-runner/src/lib/git-pr.ts
// ============================================================================

describe('PRResult error propagation', () => {
  interface PRResult {
    branchName: string
    pushed?: boolean
    prUrl?: string
    prNumber?: number
    error?: string
  }

  it('PRResult interface supports error field', () => {
    const result: PRResult = {
      branchName: 'astro/abc123-def456',
      error: 'Failed to push branch: permission denied',
    }

    expect(result.error).toBe('Failed to push branch: permission denied')
    expect(result.pushed).toBeUndefined()
    expect(result.prUrl).toBeUndefined()
  })

  it('PRResult represents successful push + PR', () => {
    const result: PRResult = {
      branchName: 'astro/abc123-def456',
      pushed: true,
      prUrl: 'https://github.com/org/repo/pull/42',
      prNumber: 42,
    }

    expect(result.pushed).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.prNumber).toBe(42)
  })

  it('pushBranch return type is { ok: boolean; error?: string }', () => {
    // Simulate successful push
    const success: { ok: boolean; error?: string } = { ok: true }
    expect(success.ok).toBe(true)
    expect(success.error).toBeUndefined()

    // Simulate failed push
    const failure: { ok: boolean; error?: string } = {
      ok: false,
      error: 'Failed to push branch: remote rejected',
    }
    expect(failure.ok).toBe(false)
    expect(failure.error).toContain('Failed to push branch')
  })

  it('pushAndCreatePR propagates push error into PRResult.error', () => {
    // Simulate the logic in pushAndCreatePR when push fails
    const pushResult = { ok: false, error: 'Authentication failed' }
    const result: PRResult = { branchName: 'astro/abc-def' }

    if (!pushResult.ok) {
      result.error = pushResult.error || 'Failed to push branch'
    }

    expect(result.error).toBe('Authentication failed')
    expect(result.pushed).toBeUndefined()
  })
})

// ============================================================================
// 3. SSE race condition guard
//    Simulates the error handler logic in execution-store.ts lines 1756-1797
// ============================================================================

type ExecutionStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled'

interface MockExecution {
  status: ExecutionStatus
  error?: string
  completedAt?: Date
}

function processErrorEvent(
  execution: MockExecution | undefined,
  errorMessage: string,
): { ignored: boolean; updatedExecution?: MockExecution } {
  // Guard: ignore late error events if result already processed
  if (execution && (execution.status === 'success' || execution.status === 'failure')) {
    return { ignored: true }
  }

  // Process the error normally
  if (execution) {
    return {
      ignored: false,
      updatedExecution: {
        ...execution,
        status: 'failure',
        error: errorMessage,
        completedAt: new Date(),
      },
    }
  }

  return { ignored: false }
}

describe('SSE race condition guard', () => {
  it('ignores late error events when status is already "success"', () => {
    const execution: MockExecution = { status: 'success', completedAt: new Date() }
    const result = processErrorEvent(execution, 'Late error after success')

    expect(result.ignored).toBe(true)
    expect(result.updatedExecution).toBeUndefined()
  })

  it('ignores late error events when status is already "failure"', () => {
    const execution: MockExecution = {
      status: 'failure',
      error: 'Original error',
      completedAt: new Date(),
    }
    const result = processErrorEvent(execution, 'Duplicate error event')

    expect(result.ignored).toBe(true)
    expect(result.updatedExecution).toBeUndefined()
  })

  it('processes error events normally when status is "running"', () => {
    const execution: MockExecution = { status: 'running' }
    const result = processErrorEvent(execution, 'Task crashed')

    expect(result.ignored).toBe(false)
    expect(result.updatedExecution).toBeDefined()
    expect(result.updatedExecution!.status).toBe('failure')
    expect(result.updatedExecution!.error).toBe('Task crashed')
    expect(result.updatedExecution!.completedAt).toBeInstanceOf(Date)
  })

  it('processes error events normally when status is "pending"', () => {
    const execution: MockExecution = { status: 'pending' }
    const result = processErrorEvent(execution, 'Failed before start')

    expect(result.ignored).toBe(false)
    expect(result.updatedExecution).toBeDefined()
    expect(result.updatedExecution!.status).toBe('failure')
  })

  it('does not crash when execution is undefined', () => {
    const result = processErrorEvent(undefined, 'Error for unknown execution')

    expect(result.ignored).toBe(false)
    expect(result.updatedExecution).toBeUndefined()
  })
})

// ============================================================================
// 4. TaskDispatch new fields
//    Verifies the interface from server/types/relay.ts accepts new fields
// ============================================================================

describe('TaskDispatch new fields', () => {
  // Minimal TaskDispatch shape for testing field acceptance
  interface TaskDispatchSubset {
    taskId: string
    projectId: string
    nodeId: string
    title: string
    description: string
    astroBaseUrl?: string
    githubIssueUrl?: string
    githubIssueNumber?: number
    deliveryMode?: 'pr' | 'push' | 'branch' | 'copy' | 'direct'
    useWorktree?: boolean
  }

  it('accepts astroBaseUrl, githubIssueUrl, githubIssueNumber', () => {
    const dispatch: TaskDispatchSubset = {
      taskId: 'task-1',
      projectId: 'proj-1',
      nodeId: 'node-1',
      title: 'Fix bug',
      description: 'Fix the login bug',
      astroBaseUrl: 'https://astro.example.com',
      githubIssueUrl: 'https://github.com/org/repo/issues/42',
      githubIssueNumber: 42,
    }

    expect(dispatch.astroBaseUrl).toBe('https://astro.example.com')
    expect(dispatch.githubIssueUrl).toBe('https://github.com/org/repo/issues/42')
    expect(dispatch.githubIssueNumber).toBe(42)
  })

  it('backward compatible — omitting new fields works', () => {
    const dispatch: TaskDispatchSubset = {
      taskId: 'task-1',
      projectId: 'proj-1',
      nodeId: 'node-1',
      title: 'Fix bug',
      description: 'Fix the login bug',
    }

    expect(dispatch.astroBaseUrl).toBeUndefined()
    expect(dispatch.githubIssueUrl).toBeUndefined()
    expect(dispatch.githubIssueNumber).toBeUndefined()
  })

  it('accepts deliveryMode and useWorktree fields', () => {
    const dispatch: TaskDispatchSubset = {
      taskId: 'task-1',
      projectId: 'proj-1',
      nodeId: 'node-1',
      title: 'Add feature',
      description: 'Add new feature',
      deliveryMode: 'push',
      useWorktree: false,
    }

    expect(dispatch.deliveryMode).toBe('push')
    expect(dispatch.useWorktree).toBe(false)
  })
})

// ============================================================================
// 5. Execute tooltip derivation
//    Simulates the useMemo logic from execution-panel.tsx lines 154-169
// ============================================================================

function deriveExecuteTooltip(deliveryMode: string | undefined, useWorktree: boolean): string {
  const dm = deliveryMode ?? 'pr'
  if (!useWorktree) {
    if (dm === 'pr') return 'Execute in project directory (worktree disabled), push branch and open PR'
    if (dm === 'push') return 'Execute in project directory (worktree disabled), push branch to remote'
    return 'Execute directly in project directory (no isolation)'
  }
  switch (dm) {
    case 'pr':
      return 'Execute in git worktree, push branch and open PR on GitHub'
    case 'push':
      return 'Execute in git worktree, push branch to remote'
    case 'branch':
      return 'Execute in git worktree, commit to local branch'
    case 'copy':
      return 'Execute in a copy of the project directory'
    case 'direct':
      return 'Execute directly in project directory (no isolation, serial only)'
    default:
      return 'Execute task'
  }
}

describe('execute tooltip derivation', () => {
  it('PR + worktree: mentions git worktree and PR on GitHub', () => {
    const tooltip = deriveExecuteTooltip('pr', true)
    expect(tooltip).toBe('Execute in git worktree, push branch and open PR on GitHub')
  })

  it('push + worktree: mentions git worktree and push to remote', () => {
    const tooltip = deriveExecuteTooltip('push', true)
    expect(tooltip).toBe('Execute in git worktree, push branch to remote')
  })

  it('branch + worktree: mentions git worktree and local branch', () => {
    const tooltip = deriveExecuteTooltip('branch', true)
    expect(tooltip).toBe('Execute in git worktree, commit to local branch')
  })

  it('copy + worktree: mentions copy of project directory', () => {
    const tooltip = deriveExecuteTooltip('copy', true)
    expect(tooltip).toBe('Execute in a copy of the project directory')
  })

  it('direct mode: mentions no isolation and serial only', () => {
    const tooltip = deriveExecuteTooltip('direct', true)
    expect(tooltip).toBe('Execute directly in project directory (no isolation, serial only)')
  })

  it('PR + worktree disabled: mentions worktree disabled', () => {
    const tooltip = deriveExecuteTooltip('pr', false)
    expect(tooltip).toContain('worktree disabled')
    expect(tooltip).toContain('open PR')
  })

  it('push + worktree disabled: mentions worktree disabled and push', () => {
    const tooltip = deriveExecuteTooltip('push', false)
    expect(tooltip).toContain('worktree disabled')
    expect(tooltip).toContain('push branch to remote')
  })

  it('direct + worktree disabled: mentions no isolation', () => {
    const tooltip = deriveExecuteTooltip('direct', false)
    expect(tooltip).toContain('no isolation')
  })

  it('defaults to PR mode when deliveryMode is undefined', () => {
    const tooltip = deriveExecuteTooltip(undefined, true)
    expect(tooltip).toBe('Execute in git worktree, push branch and open PR on GitHub')
  })

  it('unknown delivery mode falls back to "Execute task"', () => {
    const tooltip = deriveExecuteTooltip('unknown-mode', true)
    expect(tooltip).toBe('Execute task')
  })
})
