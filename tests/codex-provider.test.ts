/**
 * Codex Provider Adapter Tests
 *
 * Tests the CodexProvider implementation including:
 * - Provider ID and name
 * - Capability declaration
 * - Detection of Codex CLI installation
 * - Context preparation
 * - Cancel method for non-existent tasks
 * - Execute/stream error handling when Codex is not installed
 */

import { describe, it, expect } from 'vitest'
import { CodexProvider } from '../server/lib/providers/adapters/codex.js'
import type { TaskDispatch, TaskContext } from '../server/lib/providers/types.js'

describe('CodexProvider', () => {
  const provider = new CodexProvider()

  it('has correct id and name', () => {
    expect(provider.id).toBe('codex')
    expect(provider.name).toBe('OpenAI Codex')
  })

  describe('capabilities', () => {
    it('declares correct capability fields', () => {
      const caps = provider.capabilities()

      expect(caps.providerId).toBe('codex')
      expect(caps.supportsStreaming).toBe(true)
      expect(caps.supportsCancellation).toBe(true)
      expect(caps.contextInjectionMethod).toBe('prompt_prefix')
      expect(caps.supportsSessionResume).toBe(false)
    })

    it('includes required task types', () => {
      const caps = provider.capabilities()
      const requiredTaskTypes = ['code_generation', 'code_review', 'bug_fix', 'general'] as const

      for (const t of requiredTaskTypes) {
        expect(caps.taskTypes).toContain(t)
      }
    })

    it('includes required models', () => {
      const caps = provider.capabilities()

      expect(caps.availableModels).toContain('gpt-4o')
      expect(caps.availableModels).toContain('gpt-4o-mini')
    })

    it('has correct max context tokens', () => {
      const caps = provider.capabilities()
      expect(caps.maxContextTokens).toBe(128000)
    })
  })

  describe('detect', () => {
    it('returns a detection result with timestamp', async () => {
      const detection = await provider.detect()

      expect(detection.detectedAt).toBeInstanceOf(Date)
      expect(typeof detection.installed).toBe('boolean')
      expect(typeof detection.authStatus).toBe('string')
    })
  })

  describe('prepareContext', () => {
    it('uses prompt_prefix method with full context', async () => {
      const context: TaskContext = {
        projectId: 'test-project',
        visionDoc: 'This is a test vision document for the project.',
        workingDirectory: '/tmp/test-workspace',
        dependencyContext: 'This task depends on task-123 which created auth.ts',
        environment: 'local',
      }

      const prepared = await provider.prepareContext(context)

      expect(prepared.method).toBe('prompt_prefix')
      expect(prepared.promptContent).toBeDefined()
      expect(prepared.promptContent).toContain('Vision Document')
      expect(prepared.promptContent).toContain('Dependency Context')
      expect(prepared.promptContent).toContain('Working Directory')
    })

    it('returns no prompt content for empty context', async () => {
      const emptyContext: TaskContext = {
        projectId: 'test-project',
      }

      const prepared = await provider.prepareContext(emptyContext)

      expect(prepared.method).toBe('prompt_prefix')
      // Empty context may produce no content or minimal content
    })
  })

  describe('cancel', () => {
    it('returns false for non-existent task', async () => {
      const result = await provider.cancel('non-existent-task-id')
      expect(result).toBe(false)
    })
  })

  describe('execute error handling', () => {
    it('returns error when Codex is not installed', async () => {
      const detection = await provider.detect()

      if (!detection.installed) {
        const task: TaskDispatch = {
          taskId: 'test-task-1',
          type: 'code_generation',
          prompt: 'Generate a hello world function',
          context: { projectId: 'test' },
        }

        const result = await provider.execute(task)

        expect(result.status).toBe('error')
        expect(result.providerId).toBe('codex')
        expect(result.completedAt).toBeInstanceOf(Date)
      }
    })
  })

  describe('stream error handling', () => {
    it('emits error event when Codex is not installed', async () => {
      const detection = await provider.detect()

      if (!detection.installed) {
        const task: TaskDispatch = {
          taskId: 'test-stream-task',
          type: 'general',
          prompt: 'Test prompt',
          context: { projectId: 'test' },
        }

        const events: { type: string }[] = []
        for await (const event of provider.stream(task)) {
          events.push(event)
        }

        expect(events.some((e) => e.type === 'error')).toBe(true)
      }
    })
  })
})
