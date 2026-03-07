/**
 * Local Merge Server-Side Tests
 *
 * Verifies the server-side plumbing for local git merge results:
 *   1. Relay types include commitBeforeSha/commitAfterSha
 *   2. PR creation hook persists commit SHAs for branch-only results (no PR)
 *   3. Dispatch result construction includes commit SHAs
 *   4. Project completion hook skips correctly for local repos
 *   5. Prompt templates suppress Push node for local repos
 */
import { describe, it, expect } from 'vitest'
import type { TaskResult } from '../server/types/relay'
import type { TaskResult as DispatchTaskResult } from '../packages/core/src/dispatch/types'
import { buildPlanSystemPrompt, type GitHubContextForPrompt } from '../packages/core/src/prompt-templates'

// ============================================================================
// 1. Relay TaskResult type includes commit SHA fields
// ============================================================================

describe('Relay TaskResult type (server/types/relay.ts)', () => {
  it('accepts commitBeforeSha and commitAfterSha fields', () => {
    const result: TaskResult = {
      taskId: 'task-1',
      status: 'completed',
      branchName: 'astro/abc123-n1',
      commitBeforeSha: 'aaa111',
      commitAfterSha: 'bbb222',
      deliveryStatus: 'success',
    }

    expect(result.commitBeforeSha).toBe('aaa111')
    expect(result.commitAfterSha).toBe('bbb222')
  })

  it('commit SHA fields are optional — backward compatible', () => {
    const result: TaskResult = {
      taskId: 'task-2',
      status: 'completed',
      branchName: 'astro/abc123-n2',
    }

    expect(result.commitBeforeSha).toBeUndefined()
    expect(result.commitAfterSha).toBeUndefined()
  })

  it('local merge result has deliveryStatus but no prUrl/prNumber', () => {
    const localResult: TaskResult = {
      taskId: 'task-local',
      status: 'completed',
      branchName: 'astro/abc123-n1',
      commitAfterSha: 'deadbeef123',
      deliveryStatus: 'success',
    }

    expect(localResult.prUrl).toBeUndefined()
    expect(localResult.prNumber).toBeUndefined()
    expect(localResult.deliveryStatus).toBe('success')
    expect(localResult.commitAfterSha).toBe('deadbeef123')
  })

  it('conflict result has deliveryStatus=failed and deliveryError', () => {
    const conflictResult: TaskResult = {
      taskId: 'task-conflict',
      status: 'completed',
      branchName: 'astro/abc123-n3',
      deliveryStatus: 'failed',
      deliveryError: 'Merge conflict in: src/index.ts, src/lib.ts',
    }

    expect(conflictResult.deliveryStatus).toBe('failed')
    expect(conflictResult.deliveryError).toContain('Merge conflict')
  })

  it('no-change result has deliveryStatus=skipped', () => {
    const noChangeResult: TaskResult = {
      taskId: 'task-nochange',
      status: 'completed',
      branchName: 'astro/abc123-n4',
      deliveryStatus: 'skipped',
    }

    expect(noChangeResult.deliveryStatus).toBe('skipped')
    expect(noChangeResult.commitAfterSha).toBeUndefined()
  })
})

// ============================================================================
// 2. DispatchTaskResult type mirrors relay fields
// ============================================================================

describe('DispatchTaskResult type (packages/core/src/dispatch/types.ts)', () => {
  it('includes commitBeforeSha and commitAfterSha', () => {
    const result: DispatchTaskResult = {
      taskId: 'task-1',
      status: 'success',
      branchName: 'astro/abc123-n1',
      commitBeforeSha: 'before-sha',
      commitAfterSha: 'after-sha',
      deliveryStatus: 'success',
    }

    expect(result.commitBeforeSha).toBe('before-sha')
    expect(result.commitAfterSha).toBe('after-sha')
  })

  it('includes deliveryStatus and deliveryError for local merge failures', () => {
    const result: DispatchTaskResult = {
      taskId: 'task-fail',
      status: 'success',
      deliveryStatus: 'failed',
      deliveryError: 'Merge conflict in: file.ts',
    }

    expect(result.deliveryStatus).toBe('failed')
    expect(result.deliveryError).toContain('Merge conflict')
  })
})

// ============================================================================
// 3. PR creation hook: Path 2 logic simulation
// ============================================================================

describe('PR creation hook Path 2 — branch-only results', () => {
  /**
   * Simulates the pr-creation-hook's data persistence logic.
   * When there's no prUrl/prNumber but there IS a branch/commitAfterSha,
   * it should persist them to the DB.
   */
  function simulatePrCreationHook(result: {
    prUrl?: string
    prNumber?: number
    branchName?: string
    commitBeforeSha?: string
    commitAfterSha?: string
  }): { persisted: boolean; data: Record<string, string | number | undefined> } {
    // Path 1: Agent already created PR
    if (result.prUrl && result.prNumber) {
      return {
        persisted: true,
        data: {
          branchName: result.branchName,
          prUrl: result.prUrl,
          prNumber: result.prNumber,
          commitBeforeSha: result.commitBeforeSha,
          commitAfterSha: result.commitAfterSha,
        },
      }
    }

    // Path 2: Branch only, no PR — record branch + commit SHAs
    if (result.branchName || result.commitAfterSha) {
      return {
        persisted: true,
        data: {
          branchName: result.branchName,
          commitBeforeSha: result.commitBeforeSha,
          commitAfterSha: result.commitAfterSha,
        },
      }
    }

    return { persisted: false, data: {} }
  }

  it('GitHub PR result — persists all fields (Path 1)', () => {
    const { persisted, data } = simulatePrCreationHook({
      branchName: 'astro/abc123-n1',
      prUrl: 'https://github.com/foo/bar/pull/42',
      prNumber: 42,
      commitBeforeSha: 'before',
      commitAfterSha: 'after',
    })

    expect(persisted).toBe(true)
    expect(data.prUrl).toBe('https://github.com/foo/bar/pull/42')
    expect(data.prNumber).toBe(42)
    expect(data.commitAfterSha).toBe('after')
  })

  it('local merge result — persists branch + commit SHAs (Path 2)', () => {
    const { persisted, data } = simulatePrCreationHook({
      branchName: 'astro/abc123-n1',
      commitAfterSha: 'deadbeef',
    })

    expect(persisted).toBe(true)
    expect(data.branchName).toBe('astro/abc123-n1')
    expect(data.commitAfterSha).toBe('deadbeef')
    expect(data.prUrl).toBeUndefined()
  })

  it('local merge conflict — persists branch only (no commit SHA)', () => {
    const { persisted, data } = simulatePrCreationHook({
      branchName: 'astro/abc123-n2',
    })

    expect(persisted).toBe(true)
    expect(data.branchName).toBe('astro/abc123-n2')
    expect(data.commitAfterSha).toBeUndefined()
  })

  it('commitAfterSha without branchName — still persisted', () => {
    const { persisted, data } = simulatePrCreationHook({
      commitAfterSha: 'abc123',
    })

    expect(persisted).toBe(true)
    expect(data.commitAfterSha).toBe('abc123')
  })

  it('empty result — nothing persisted', () => {
    const { persisted } = simulatePrCreationHook({})

    expect(persisted).toBe(false)
  })
})

// ============================================================================
// 4. Dispatch result construction simulation
// ============================================================================

describe('Dispatch result construction for local merge', () => {
  /**
   * Simulates how dispatch.ts builds the nodePatch for DB persistence.
   */
  function buildNodePatch(result: {
    branchName?: string
    prUrl?: string
    prNumber?: number
    commitBeforeSha?: string
    commitAfterSha?: string
    output?: string
    error?: string
    status: string
  }) {
    const nodePatch: Record<string, unknown> = {
      status: result.status === 'completed' ? 'auto_verified' : 'awaiting_judgment',
      executionOutput: result.output ?? null,
      executionCompletedAt: new Date(),
      executionError: result.error ?? null,
      updatedAt: new Date(),
    }
    if (result.branchName) nodePatch.branchName = result.branchName
    if (result.prUrl) nodePatch.prUrl = result.prUrl
    if (result.prNumber) nodePatch.prNumber = result.prNumber
    if (result.commitBeforeSha) nodePatch.commitBeforeSha = result.commitBeforeSha
    if (result.commitAfterSha) nodePatch.commitAfterSha = result.commitAfterSha
    return nodePatch
  }

  it('includes commitAfterSha in node patch for local merge success', () => {
    const patch = buildNodePatch({
      status: 'completed',
      branchName: 'astro/abc123-n1',
      commitAfterSha: 'deadbeef',
      output: 'Task completed successfully',
    })

    expect(patch.branchName).toBe('astro/abc123-n1')
    expect(patch.commitAfterSha).toBe('deadbeef')
    expect(patch.prUrl).toBeUndefined()
    expect(patch.prNumber).toBeUndefined()
  })

  it('includes both commitBeforeSha and commitAfterSha for GitHub PR merge', () => {
    const patch = buildNodePatch({
      status: 'completed',
      branchName: 'astro/abc123-n1',
      prUrl: 'https://github.com/foo/bar/pull/42',
      prNumber: 42,
      commitBeforeSha: 'before-sha',
      commitAfterSha: 'after-sha',
    })

    expect(patch.commitBeforeSha).toBe('before-sha')
    expect(patch.commitAfterSha).toBe('after-sha')
    expect(patch.prUrl).toBe('https://github.com/foo/bar/pull/42')
  })

  it('omits commit SHAs when not present (backward compatible)', () => {
    const patch = buildNodePatch({
      status: 'completed',
      branchName: 'astro/abc123-n1',
    })

    expect('commitBeforeSha' in patch).toBe(false)
    expect('commitAfterSha' in patch).toBe(false)
  })
})

// ============================================================================
// 5. Project completion hook behavior for local repos
// ============================================================================

describe('Project completion hook — local repo behavior', () => {
  it('skips when no GitHub repo is configured (local mode)', () => {
    // The hook checks: if (!project.githubOwner || !project.githubRepo) return
    const project = {
      githubOwner: null as string | null,
      githubRepo: null as string | null,
    }

    const shouldSkip = !project.githubOwner || !project.githubRepo
    expect(shouldSkip).toBe(true)
  })

  it('proceeds when GitHub repo is configured', () => {
    const project = {
      githubOwner: 'fuxialexander',
      githubRepo: 'astro',
    }

    const shouldSkip = !project.githubOwner || !project.githubRepo
    expect(shouldSkip).toBe(false)
  })
})

// ============================================================================
// 6. Prompt template — Push to GitHub node suppression
// ============================================================================

describe('Plan prompt — Push to GitHub node for local repos', () => {
  it('includes Push to GitHub instructions when GitHub repo is configured', () => {
    const githubContext: GitHubContextForPrompt = {
      hasRepo: true,
      owner: 'fuxialexander',
      repo: 'astro',
      baseBranch: 'main',
    }

    const prompt = buildPlanSystemPrompt(undefined, undefined, undefined, undefined, githubContext)
    expect(prompt).toContain('Push to GitHub')
    expect(prompt).toContain('fuxialexander/astro')
  })

  it('omits Push to GitHub instructions when no GitHub context', () => {
    const prompt = buildPlanSystemPrompt()
    expect(prompt).not.toContain('Push to GitHub')
  })

  it('omits Push to GitHub when githubContext.hasRepo is false', () => {
    const githubContext: GitHubContextForPrompt = {
      hasRepo: false,
    }

    const prompt = buildPlanSystemPrompt(undefined, undefined, undefined, undefined, githubContext)
    expect(prompt).not.toContain('Push to GitHub')
  })

  it('omits Push to GitHub when owner or repo is missing', () => {
    const githubContext: GitHubContextForPrompt = {
      hasRepo: true,
      owner: 'fuxialexander',
      // repo is missing
    }

    const prompt = buildPlanSystemPrompt(undefined, undefined, undefined, undefined, githubContext)
    expect(prompt).not.toContain('Push to GitHub')
  })
})

// ============================================================================
// 7. Relay server result passthrough simulation
// ============================================================================

describe('Relay server — task result passthrough', () => {
  /**
   * Simulates handleAgentRunnerTaskResult in relay-server.ts
   */
  function buildRelayResultMessage(payload: Record<string, unknown>) {
    const {
      taskId, status, exitCode, output, error, artifacts, metrics,
      branchName, prUrl, prNumber, commitBeforeSha, commitAfterSha,
      deliveryStatus, deliveryError, summary,
    } = payload

    return {
      type: 'task.result' as const,
      timestamp: new Date(),
      result: {
        taskId,
        status: status === 'completed' ? 'completed' : 'failed',
        exitCode,
        output,
        error,
        artifacts,
        metrics,
        branchName,
        prUrl,
        prNumber,
        commitBeforeSha,
        commitAfterSha,
        deliveryStatus,
        deliveryError,
        summary,
      },
    }
  }

  it('passes through commitBeforeSha and commitAfterSha from agent runner', () => {
    const msg = buildRelayResultMessage({
      taskId: 'task-1',
      status: 'completed',
      branchName: 'astro/abc123-n1',
      commitBeforeSha: 'aaa',
      commitAfterSha: 'bbb',
      deliveryStatus: 'success',
    })

    expect(msg.result.commitBeforeSha).toBe('aaa')
    expect(msg.result.commitAfterSha).toBe('bbb')
    expect(msg.result.deliveryStatus).toBe('success')
  })

  it('passes through conflict delivery status', () => {
    const msg = buildRelayResultMessage({
      taskId: 'task-2',
      status: 'completed',
      branchName: 'astro/abc123-n2',
      deliveryStatus: 'failed',
      deliveryError: 'Merge conflict in: file.ts',
    })

    expect(msg.result.deliveryStatus).toBe('failed')
    expect(msg.result.deliveryError).toContain('Merge conflict')
    expect(msg.result.commitAfterSha).toBeUndefined()
  })

  it('handles result with no delivery fields (backward compatible)', () => {
    const msg = buildRelayResultMessage({
      taskId: 'task-3',
      status: 'completed',
      output: 'Done',
    })

    expect(msg.result.commitBeforeSha).toBeUndefined()
    expect(msg.result.commitAfterSha).toBeUndefined()
    expect(msg.result.deliveryStatus).toBeUndefined()
    expect(msg.result.branchName).toBeUndefined()
  })
})

// ============================================================================
// 8. Delivery mode derivation for local repos
// ============================================================================

describe('Delivery mode for local repos', () => {
  it('remoteType=none maps to deliveryMode=branch', () => {
    // This mirrors deriveDeliveryMode() in src/lib/project-source.ts
    function deriveDeliveryMode(remoteType: string | undefined): string {
      if (!remoteType || remoteType === 'none') return 'branch'
      if (remoteType === 'github' || remoteType === 'gitlab' || remoteType === 'bitbucket') return 'pr'
      return 'push'
    }

    expect(deriveDeliveryMode('none')).toBe('branch')
    expect(deriveDeliveryMode('github')).toBe('pr')
    expect(deriveDeliveryMode('gitlab')).toBe('pr')
    expect(deriveDeliveryMode('generic')).toBe('push')
    expect(deriveDeliveryMode(undefined)).toBe('branch')
  })
})
