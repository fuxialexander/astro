/**
 * Tests for git-pull-hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { gitPullHook } from '../git-pull-hook.js'
import type { AstroEvent, TaskCompletedEvent } from '../../types.js'
import type { PlanNode } from '../../../../../src/types/index.js'
import type { Project } from '../../../../../src/types/index.js'
import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'

// Mock child_process
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

// Mock fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

// Helper to create a minimal PlanNode for testing
function makeNode(overrides: Partial<PlanNode> & { id: string; projectId: string }): PlanNode {
  return {
    type: 'task',
    title: 'Test',
    description: '',
    status: 'completed',
    parentId: null,
    dependencies: [],
    verification: 'auto',
    position: { x: 0, y: 0 },
    ...overrides,
  } as PlanNode
}

// Helper to create a minimal Project for testing
function makeProject(overrides: Partial<Project> & { id: string; name: string }): Project {
  return {
    description: '',
    visionDoc: '',
    status: 'active',
    ...overrides,
  } as Project
}

describe('gitPullHook', () => {
  const mockExecFile = vi.mocked(childProcess.execFile)
  const mockExistsSync = vi.mocked(fs.existsSync)

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: directory and .git exist
    mockExistsSync.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should skip if event is not task.completed', async () => {
    const event: AstroEvent = {
      type: 'task.started',
      taskId: 'task-1',
      nodeId: 'node-1',
      projectId: 'proj-1',
      executionId: 'exec-1',
      timestamp: new Date(),
      node: makeNode({ id: 'node-1', projectId: 'proj-1' }),
    }

    await gitPullHook(event)

    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('should skip if project is missing', async () => {
    const event: TaskCompletedEvent = {
      type: 'task.completed',
      taskId: 'task-1',
      nodeId: 'node-1',
      projectId: 'proj-1',
      executionId: 'exec-1',
      result: { taskId: 'task-1', status: 'success' },
      node: makeNode({ id: 'node-1', projectId: 'proj-1' }),
      timestamp: new Date(),
    }

    await gitPullHook(event)

    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('should skip if workingDirectory is missing', async () => {
    const event: TaskCompletedEvent = {
      type: 'task.completed',
      taskId: 'task-1',
      nodeId: 'node-1',
      projectId: 'proj-1',
      executionId: 'exec-1',
      result: { taskId: 'task-1', status: 'success' },
      node: makeNode({ id: 'node-1', projectId: 'proj-1' }),
      project: makeProject({ id: 'proj-1', name: 'Test Project' }),
      timestamp: new Date(),
    }

    await gitPullHook(event)

    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('should skip if directory does not exist', async () => {
    mockExistsSync.mockReturnValueOnce(false) // workdir doesn't exist

    const event: TaskCompletedEvent = {
      type: 'task.completed',
      taskId: 'task-1',
      nodeId: 'node-1',
      projectId: 'proj-1',
      executionId: 'exec-1',
      result: { taskId: 'task-1', status: 'success' },
      node: makeNode({ id: 'node-1', projectId: 'proj-1' }),
      project: makeProject({ id: 'proj-1', name: 'Test', workingDirectory: '/tmp/test' }),
      timestamp: new Date(),
    }

    await gitPullHook(event)

    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('should skip if .git directory does not exist', async () => {
    mockExistsSync.mockReturnValueOnce(true)  // workdir exists
    mockExistsSync.mockReturnValueOnce(false) // .git doesn't exist

    const event: TaskCompletedEvent = {
      type: 'task.completed',
      taskId: 'task-1',
      nodeId: 'node-1',
      projectId: 'proj-1',
      executionId: 'exec-1',
      result: { taskId: 'task-1', status: 'success' },
      node: makeNode({ id: 'node-1', projectId: 'proj-1' }),
      project: makeProject({ id: 'proj-1', name: 'Test', workingDirectory: '/tmp/test' }),
      timestamp: new Date(),
    }

    await gitPullHook(event)

    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('should execute git pull when conditions are met', async () => {
    // Mock successful git pull
    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      if (callback) {
        (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, { stdout: 'Already up to date.\n', stderr: '' })
      }
      return {} as ReturnType<typeof childProcess.execFile>
    })

    const event: TaskCompletedEvent = {
      type: 'task.completed',
      taskId: 'task-1',
      nodeId: 'node-1',
      projectId: 'proj-1',
      executionId: 'exec-1',
      result: { taskId: 'task-1', status: 'success' },
      node: makeNode({ id: 'node-1', projectId: 'proj-1' }),
      project: makeProject({ id: 'proj-1', name: 'Test', workingDirectory: '/tmp/test' }),
      timestamp: new Date(),
    }

    await gitPullHook(event)

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['pull'],
      expect.objectContaining({
        cwd: '/tmp/test',
        timeout: 30000,
      }),
      expect.any(Function)
    )
  })

  it('should handle git pull errors gracefully', async () => {
    // Mock failed git pull
    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      if (callback) {
        (callback as (err: Error | null, result: { stdout: string; stderr: string } | null) => void)(new Error('Network error'), null)
      }
      return {} as ReturnType<typeof childProcess.execFile>
    })

    const event: TaskCompletedEvent = {
      type: 'task.completed',
      taskId: 'task-1',
      nodeId: 'node-1',
      projectId: 'proj-1',
      executionId: 'exec-1',
      result: { taskId: 'task-1', status: 'success' },
      node: makeNode({ id: 'node-1', projectId: 'proj-1' }),
      project: makeProject({ id: 'proj-1', name: 'Test', workingDirectory: '/tmp/test' }),
      timestamp: new Date(),
    }

    // Should not throw
    await expect(gitPullHook(event)).resolves.toBeUndefined()
  })
})
