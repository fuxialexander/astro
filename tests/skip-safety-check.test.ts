/**
 * skipSafetyCheck Relay Protocol Extension Tests
 *
 * Verifies the new skipSafetyCheck field on TaskDispatch:
 *   1. Type definition accepts the new optional field
 *   2. Relay server forwards it in the dispatch payload
 *   3. Backward compatibility — omitting the field works
 *   4. executeViaRelay tasks (refinement, summarization) set it to true
 */

import { describe, it, expect } from 'vitest'
import type { TaskDispatch } from '../server/types/relay'

// ============================================================================
// 1. Type definition tests
// ============================================================================

describe('skipSafetyCheck type definition', () => {
  it('accepts skipSafetyCheck as an optional boolean', () => {
    const dispatch: TaskDispatch = {
      taskId: 'task-1',
      projectId: 'proj-1',
      nodeId: 'node-1',
      title: 'Refine content',
      description: 'Polish title and description',
      skipSafetyCheck: true,
    }

    expect(dispatch.skipSafetyCheck).toBe(true)
  })

  it('defaults to undefined when not specified (backward compatible)', () => {
    const dispatch: TaskDispatch = {
      taskId: 'task-1',
      projectId: 'proj-1',
      nodeId: 'node-1',
      title: 'Execute task',
      description: 'Normal execution',
    }

    expect(dispatch.skipSafetyCheck).toBeUndefined()
  })

  it('accepts false explicitly', () => {
    const dispatch: TaskDispatch = {
      taskId: 'task-1',
      projectId: 'proj-1',
      nodeId: 'node-1',
      title: 'Execute task',
      description: 'Requires safety check',
      skipSafetyCheck: false,
    }

    expect(dispatch.skipSafetyCheck).toBe(false)
  })
})

// ============================================================================
// 2. Relay dispatch payload construction — mirrors relay-server.ts
// ============================================================================

describe('Relay server dispatch payload with skipSafetyCheck', () => {
  /**
   * Simulates the relay server's dispatchTask payload construction.
   * Mirrors the logic in server/lib/relay-server.ts dispatchTask().
   */
  function buildDispatchPayload(task: TaskDispatch) {
    const finalPrompt = task.prompt || `## Current Task\n\n**${task.title}**\n\n${task.description}`

    return {
      id: task.taskId,
      projectId: task.projectId,
      planNodeId: task.nodeId,
      provider: task.preferredProvider || 'claude-sdk',
      prompt: finalPrompt,
      workingDirectory: task.workingDirectory || '',
      timeout: task.timeout,
      maxTurns: task.maxTurns,
      outputFormat: task.outputFormat,
      createdAt: new Date().toISOString(),
      ...(task.type && { type: task.type }),
      ...(task.systemPrompt && { systemPrompt: task.systemPrompt }),
      ...(task.messages && { messages: task.messages }),
      ...(task.model && { model: task.model }),
      ...(task.useWorktree !== undefined && { useWorktree: task.useWorktree }),
      ...(task.skipSafetyCheck !== undefined && { skipSafetyCheck: task.skipSafetyCheck }),
    }
  }

  it('forwards skipSafetyCheck: true in payload', () => {
    const payload = buildDispatchPayload({
      taskId: 'refine-abc',
      projectId: 'proj-1',
      nodeId: 'node-1',
      title: 'refine',
      description: 'Refine title and description',
      workingDirectory: '/tmp',
      skipSafetyCheck: true,
    })

    expect(payload.skipSafetyCheck).toBe(true)
  })

  it('forwards skipSafetyCheck: false in payload', () => {
    const payload = buildDispatchPayload({
      taskId: 'exec-1',
      projectId: 'proj-1',
      nodeId: 'node-1',
      title: 'Execute',
      description: 'Run task',
      skipSafetyCheck: false,
    })

    expect(payload.skipSafetyCheck).toBe(false)
  })

  it('omits skipSafetyCheck from payload when not provided', () => {
    const payload = buildDispatchPayload({
      taskId: 'exec-1',
      projectId: 'proj-1',
      nodeId: 'node-1',
      title: 'Execute',
      description: 'Run task',
    })

    expect('skipSafetyCheck' in payload).toBe(false)
  })

  it('coexists with other optional relay fields', () => {
    const payload = buildDispatchPayload({
      taskId: 'refine-1',
      projectId: 'proj-1',
      nodeId: 'node-1',
      title: 'Refine',
      description: 'Polish content',
      type: 'summarize',
      maxTurns: 1,
      workingDirectory: '/tmp',
      skipSafetyCheck: true,
      useWorktree: false,
    })

    expect(payload.skipSafetyCheck).toBe(true)
    expect(payload.useWorktree).toBe(false)
    expect(payload.type).toBe('summarize')
    expect(payload.maxTurns).toBe(1)
  })
})

// ============================================================================
// 3. executeViaRelay task construction — mirrors agent.ts
// ============================================================================

describe('executeViaRelay task construction for text-only tasks', () => {
  /**
   * Simulates the executeViaRelay function's task construction.
   * Text-only tasks (refine, summarize, title generation) should always
   * set skipSafetyCheck: true since they don't touch the filesystem.
   */
  function buildRelayTask(opts: {
    taskId: string
    projectId: string
    nodeId?: string
    prompt: string
    systemPrompt?: string
    type?: string
    maxTurns?: number
  }): TaskDispatch {
    return {
      taskId: opts.taskId,
      projectId: opts.projectId,
      nodeId: opts.nodeId,
      title: opts.type || 'summarize',
      description: opts.prompt.slice(0, 200),
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      type: opts.type as TaskDispatch['type'],
      maxTurns: opts.maxTurns ?? 1,
      workingDirectory: '/tmp',
      skipSafetyCheck: true,
    }
  }

  it('sets skipSafetyCheck: true for refine tasks', () => {
    const task = buildRelayTask({
      taskId: 'refine-abc123',
      projectId: 'proj-1',
      prompt: 'Refine the following: My cool project...',
      type: 'summarize',
    })

    expect(task.skipSafetyCheck).toBe(true)
  })

  it('sets workingDirectory to /tmp for text-only tasks', () => {
    const task = buildRelayTask({
      taskId: 'refine-abc123',
      projectId: 'proj-1',
      prompt: 'Polish this description',
    })

    expect(task.workingDirectory).toBe('/tmp')
  })

  it('sets maxTurns to 1 by default for text-only tasks', () => {
    const task = buildRelayTask({
      taskId: 'title-gen',
      projectId: 'proj-1',
      prompt: 'Generate a title',
    })

    expect(task.maxTurns).toBe(1)
  })

  it('respects explicit maxTurns override', () => {
    const task = buildRelayTask({
      taskId: 'chat-1',
      projectId: 'proj-1',
      prompt: 'Multi-turn conversation',
      maxTurns: 5,
    })

    expect(task.maxTurns).toBe(5)
  })
})

// ============================================================================
// 4. Source code verification — ensure relay-server.ts forwards the field
// ============================================================================

describe('relay-server.ts source code verification', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const relaySource = fs.readFileSync(
    path.join(process.cwd(), 'server/lib/relay-server.ts'),
    'utf-8'
  )

  it('forwards skipSafetyCheck in the dispatch payload construction', () => {
    expect(relaySource).toContain('task.skipSafetyCheck')
    expect(relaySource).toContain('skipSafetyCheck: task.skipSafetyCheck')
  })

  it('uses the same spread pattern as useWorktree (backward-compatible omission)', () => {
    // Both should use the `...(task.X !== undefined && { X: task.X })` pattern
    expect(relaySource).toContain('task.skipSafetyCheck !== undefined')
  })
})

describe('agent.ts source code verification', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const agentSource = fs.readFileSync(
    path.join(process.cwd(), 'server/routes/agent.ts'),
    'utf-8'
  )

  it('sets skipSafetyCheck: true in executeViaRelay task', () => {
    expect(agentSource).toContain('skipSafetyCheck: true')
  })
})
