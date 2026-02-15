/**
 * Procedure Executor Tests
 */

import { describe, it, expect } from 'vitest'
import {
  interpolatePrompt,
  parseValidationResult,
  isValidationPassed,
  buildFixerPrompt,
  initValidationLoop,
  recordValidationAttempt,
  shouldRetryValidation,
} from '../procedure-executor.js'
import type { PlanNode } from '../../../../src/types/index.js'
import type { TaskResult } from '../../providers/types.js'
import type { ProcedureState } from '../procedure-types.js'

describe('Procedure Executor', () => {
  const mockNode: PlanNode = {
    id: 'node-1',
    title: 'Test Task',
    description: 'Test task description',
    status: 'planned',
    type: 'task',
    position: { x: 0, y: 0 },
  }

  const mockState: ProcedureState = {
    procedureName: 'test-procedure',
    currentSubroutineIndex: 0,
    subroutineHistory: [],
  }

  describe('interpolatePrompt', () => {
    it('should replace {{task.description}}', () => {
      const template = 'Fix this issue: {{task.description}}'
      const result = interpolatePrompt(template, mockNode, mockState)

      expect(result).toBe('Fix this issue: Test task description')
    })

    it('should replace {{task.title}}', () => {
      const template = 'Task: {{task.title}}'
      const result = interpolatePrompt(template, mockNode, mockState)

      expect(result).toBe('Task: Test Task')
    })

    it('should replace {{task.id}}', () => {
      const template = 'Node ID: {{task.id}}'
      const result = interpolatePrompt(template, mockNode, mockState)

      expect(result).toBe('Node ID: node-1')
    })

    it('should replace {{previous.results}}', () => {
      const stateWithHistory: ProcedureState = {
        ...mockState,
        subroutineHistory: [
          {
            subroutine: 'step1',
            completedAt: new Date(),
            sessionId: null,
            result: 'Step 1 output',
          },
          {
            subroutine: 'step2',
            completedAt: new Date(),
            sessionId: null,
            result: 'Step 2 output',
          },
        ],
      }

      const template = 'Previous results:\n{{previous.results}}'
      const result = interpolatePrompt(template, mockNode, stateWithHistory)

      expect(result).toContain('## step1')
      expect(result).toContain('Step 1 output')
      expect(result).toContain('## step2')
      expect(result).toContain('Step 2 output')
    })

    it('should handle multiple replacements', () => {
      const template = '{{task.title}}: {{task.description}} ({{task.id}})'
      const result = interpolatePrompt(template, mockNode, mockState)

      expect(result).toBe('Test Task: Test task description (node-1)')
    })
  })

  describe('parseValidationResult', () => {
    it('should extract verification hints', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
        verification: {
          testsRun: 10,
          testsPassed: 8,
          testsFailed: 2,
          buildSucceeded: false,
          lintPassed: true,
        },
      }

      const parsed = parseValidationResult(result)

      expect(parsed.testsRun).toBe(10)
      expect(parsed.testsPassed).toBe(8)
      expect(parsed.testsFailed).toBe(2)
      expect(parsed.buildSucceeded).toBe(false)
      expect(parsed.lintPassed).toBe(true)
    })

    it('should handle missing verification', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
      }

      const parsed = parseValidationResult(result)

      expect(parsed.testsRun).toBeUndefined()
      expect(parsed.testsPassed).toBeUndefined()
      expect(parsed.testsFailed).toBeUndefined()
    })
  })

  describe('isValidationPassed', () => {
    const mockSubroutine = {
      name: 'test',
      promptTemplate: 'test',
    }

    it('should pass if validation command succeeded', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
      }

      const validationResult = {
        pass: true,
        reason: 'Tests passed',
        exitCode: 0,
      }

      expect(isValidationPassed(result, mockSubroutine, validationResult)).toBe(true)
    })

    it('should fail if validation command failed', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
      }

      const validationResult = {
        pass: false,
        reason: 'Tests failed',
        exitCode: 1,
      }

      expect(isValidationPassed(result, mockSubroutine, validationResult)).toBe(false)
    })

    it('should fail if task status is not success', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'error',
        errorMessage: 'Task failed',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
      }

      expect(isValidationPassed(result, mockSubroutine)).toBe(false)
    })

    it('should check test results', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
        verification: {
          testsRun: 10,
          testsPassed: 8,
          testsFailed: 2,
        },
      }

      expect(isValidationPassed(result, mockSubroutine)).toBe(false)
    })

    it('should pass if all tests passed', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        metrics: { durationMs: 1000 },
        providerId: 'test',
        completedAt: new Date(),
        verification: {
          testsRun: 10,
          testsPassed: 10,
          testsFailed: 0,
        },
      }

      expect(isValidationPassed(result, mockSubroutine)).toBe(true)
    })
  })

  describe('buildFixerPrompt', () => {
    it('should build prompt with validation error', () => {
      const originalPrompt = 'Fix the bug'
      const validationResult = {
        pass: false,
        reason: 'Test suite failed: 2 tests failed',
        exitCode: 1,
      }

      const result = buildFixerPrompt(originalPrompt, validationResult, 2)

      expect(result).toContain('Attempt 2')
      expect(result).toContain('Test suite failed: 2 tests failed')
      expect(result).toContain('Fix the bug')
    })
  })

  describe('Validation Loop Metadata', () => {
    it('should initialize validation loop', () => {
      const metadata = initValidationLoop()

      expect(metadata.iteration).toBe(1)
      expect(metadata.inFixerMode).toBe(false)
      expect(metadata.attempts).toEqual([])
    })

    it('should record validation attempt', () => {
      const metadata = initValidationLoop()

      recordValidationAttempt(metadata, false, 'Tests failed')

      expect(metadata.attempts).toHaveLength(1)
      expect(metadata.attempts[0].iteration).toBe(1)
      expect(metadata.attempts[0].pass).toBe(false)
      expect(metadata.attempts[0].reason).toBe('Tests failed')
    })

    it('should determine retry eligibility', () => {
      const metadata = initValidationLoop()

      expect(shouldRetryValidation(metadata, 3)).toBe(true)

      metadata.iteration = 3
      expect(shouldRetryValidation(metadata, 3)).toBe(false)

      metadata.iteration = 4
      expect(shouldRetryValidation(metadata, 3)).toBe(false)
    })
  })
})
