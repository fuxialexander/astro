/**
 * Anthropic Direct Provider Adapter
 *
 * Lightweight provider that calls the Anthropic Messages API directly,
 * bypassing the Claude Code CLI subprocess. This avoids false-positive
 * usage policy errors that the CLI's safety filter triggers on voice input.
 *
 * Requires ANTHROPIC_API_KEY env var. When not set, detect() returns
 * unauthenticated and getChatProvider() in agent.ts falls back to
 * the Claude Code provider (which uses query() with its built-in auth).
 *
 * Used for chat endpoints (type: 'chat', no tools, maxTurns: 1).
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  AgentProvider,
  ProviderDetectionResult,
  ProviderCapabilities,
  TaskDispatch,
  TaskResult,
  StreamEvent,
  PreparedContext,
  TaskContext,
  TaskStatus,
  TaskMetrics,
} from '../types.js'
import { errorMessage } from '../../error-utils.js'

// Map of active tasks for cancellation
const activeTasks = new Map<string, AbortController>()

/**
 * Direct Anthropic API provider.
 * Calls the Messages API without going through the Claude Code CLI.
 */
export class AnthropicDirectProvider implements AgentProvider {
  readonly id = 'anthropic-direct'
  readonly name = 'Anthropic Direct'

  private defaultModel = 'claude-sonnet-4-5-20250929'

  private getClient(): Anthropic | null {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return null
    return new Anthropic({ apiKey })
  }

  async detect(): Promise<ProviderDetectionResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return {
        installed: true,
        authStatus: 'unauthenticated',
        message: 'ANTHROPIC_API_KEY not set',
        detectedAt: new Date(),
      }
    }

    return {
      installed: true,
      version: this.defaultModel,
      authStatus: 'authenticated',
      message: 'Anthropic API key configured',
      detectedAt: new Date(),
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      providerId: this.id,
      name: this.name,
      languages: ['*'],
      taskTypes: ['chat', 'general'],
      maxContextTokens: 200000,
      supportsStreaming: true,
      supportsCancellation: true,
      availableModels: [
        'claude-sonnet-4-5-20250929',
        'claude-opus-4-6',
        'claude-opus-4-5-20251101',
        'claude-haiku-4-5-20251001',
        'claude-3-5-haiku-20241022',
      ],
      defaultModel: this.defaultModel,
      contextInjectionMethod: 'system_prompt',
      supportsSessionResume: false,
      maxTurns: 1,
    }
  }

  async execute(task: TaskDispatch): Promise<TaskResult> {
    const startTime = Date.now()
    const abortController = task.abortController ?? new AbortController()
    activeTasks.set(task.taskId, abortController)

    try {
      const client = this.getClient()
      if (!client) {
        return {
          taskId: task.taskId,
          status: 'error',
          errorMessage: 'ANTHROPIC_API_KEY not set',
          metrics: { durationMs: Date.now() - startTime, model: task.model ?? this.defaultModel },
          providerId: this.id,
          completedAt: new Date(),
        }
      }

      const preparedContext = await this.prepareContext(task.context)
      let systemPrompt = task.systemPrompt ?? ''
      if (preparedContext.method === 'system_prompt' && preparedContext.promptContent) {
        systemPrompt = systemPrompt
          ? `${systemPrompt}\n\n${preparedContext.promptContent}`
          : preparedContext.promptContent
      }

      const model = task.model ?? this.defaultModel
      const maxTokens = 8192
      // Build multi-turn messages array from history + current prompt
      const historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = task.messages || []
      const allMessages = [
        ...historyMessages,
        { role: 'user' as const, content: task.prompt },
      ]
      const response = await client.messages.create(
        {
          model,
          max_tokens: maxTokens,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: allMessages,
        },
        { signal: abortController.signal },
      )

      let assistantText = ''
      for (const block of response.content) {
        if (block.type === 'text') {
          assistantText += block.text
        }
      }

      const durationMs = Date.now() - startTime
      return {
        taskId: task.taskId,
        sessionId: task.taskId,
        status: 'success',
        stdout: assistantText,
        metrics: {
          durationMs,
          model,
          turnsUsed: 1,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        },
        providerId: this.id,
        completedAt: new Date(),
      }
    } catch (error) {
      const durationMs = Date.now() - startTime
      const isAbort = error instanceof Error && error.name === 'AbortError'
      return {
        taskId: task.taskId,
        status: isAbort ? 'cancelled' : 'error',
        errorMessage: errorMessage(error),
        metrics: { durationMs, model: task.model ?? this.defaultModel },
        providerId: this.id,
        completedAt: new Date(),
      }
    } finally {
      activeTasks.delete(task.taskId)
    }
  }

  async *stream(task: TaskDispatch): AsyncGenerator<StreamEvent, TaskResult, undefined> {
    const startTime = Date.now()
    const abortController = task.abortController ?? new AbortController()
    activeTasks.set(task.taskId, abortController)

    try {
      const client = this.getClient()
      if (!client) {
        const errResult: TaskResult = {
          taskId: task.taskId,
          status: 'error',
          errorMessage: 'ANTHROPIC_API_KEY not set',
          metrics: { durationMs: Date.now() - startTime, model: task.model ?? this.defaultModel },
          providerId: this.id,
          completedAt: new Date(),
        }
        yield { type: 'error', taskId: task.taskId, error: 'ANTHROPIC_API_KEY not set', recoverable: false, timestamp: new Date() }
        return errResult
      }

      const preparedContext = await this.prepareContext(task.context)
      let systemPrompt = task.systemPrompt ?? ''
      if (preparedContext.method === 'system_prompt' && preparedContext.promptContent) {
        systemPrompt = systemPrompt
          ? `${systemPrompt}\n\n${preparedContext.promptContent}`
          : preparedContext.promptContent
      }

      const model = task.model ?? this.defaultModel
      const maxTokens = 8192

      // Emit init event
      yield {
        type: 'init',
        taskId: task.taskId,
        model,
        sessionId: task.taskId,
        timestamp: new Date(),
      }

      // Build multi-turn messages array from history + current prompt
      const historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = task.messages || []
      const allMessages = [
        ...historyMessages,
        { role: 'user' as const, content: task.prompt },
      ]

      const messageStream = client.messages.stream(
        {
          model,
          max_tokens: maxTokens,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: allMessages,
        },
        { signal: abortController.signal },
      )

      let assistantText = ''

      for await (const event of messageStream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          assistantText += event.delta.text
          yield {
            type: 'text',
            taskId: task.taskId,
            text: event.delta.text,
            timestamp: new Date(),
          }
        }
      }

      const finalMessage = await messageStream.finalMessage()
      const durationMs = Date.now() - startTime
      const metrics: TaskMetrics = {
        durationMs,
        model,
        turnsUsed: 1,
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        tokensUsed: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
      }

      const status: TaskStatus = 'success'
      const result: TaskResult = {
        taskId: task.taskId,
        sessionId: task.taskId,
        status,
        stdout: assistantText,
        metrics,
        providerId: this.id,
        completedAt: new Date(),
      }

      yield { type: 'result', taskId: task.taskId, result, timestamp: new Date() }
      return result
    } catch (error) {
      const durationMs = Date.now() - startTime
      const isAbort = error instanceof Error && error.name === 'AbortError'

      if (isAbort) {
        yield { type: 'aborted', taskId: task.taskId, reason: 'User cancelled', timestamp: new Date() }
      } else {
        yield { type: 'error', taskId: task.taskId, error: errorMessage(error), recoverable: false, timestamp: new Date() }
      }

      return {
        taskId: task.taskId,
        status: isAbort ? 'cancelled' : 'error',
        errorMessage: errorMessage(error),
        metrics: { durationMs, model: task.model ?? this.defaultModel },
        providerId: this.id,
        completedAt: new Date(),
      }
    } finally {
      activeTasks.delete(task.taskId)
    }
  }

  async cancel(taskId: string): Promise<boolean> {
    const controller = activeTasks.get(taskId)
    if (controller) {
      controller.abort()
      activeTasks.delete(taskId)
      return true
    }
    return false
  }

  async prepareContext(context: TaskContext): Promise<PreparedContext> {
    const parts: string[] = []

    if (context.visionDoc) {
      parts.push(`## Project Vision Document\n${context.visionDoc}`)
    }
    if (context.dependencyContext) {
      parts.push(`## Dependency Context\n${context.dependencyContext}`)
    }
    if (context.workingDirectory) {
      parts.push(`## Working Directory\n${context.workingDirectory}`)
    }
    if (context.environment) {
      parts.push(`## Execution Environment\n${context.environment}`)
    }

    if (parts.length === 0) {
      return { method: 'system_prompt' }
    }

    return {
      method: 'system_prompt',
      promptContent: parts.join('\n\n'),
    }
  }
}

// Export singleton instance
export const anthropicDirectProvider = new AnthropicDirectProvider()
