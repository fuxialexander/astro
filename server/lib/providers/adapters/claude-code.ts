/**
 * Claude Code Provider Adapter
 *
 * Implements the AgentProvider interface for Claude Code (via @anthropic-ai/claude-agent-sdk).
 * This adapter translates Nexus task dispatches into Claude SDK invocations.
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
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
  StructuredOutput,
  TaskMetrics,
} from '../types.js'

// Map of active tasks for cancellation
const activeTasks = new Map<string, AbortController>()

/**
 * Claude Code provider adapter.
 * Wraps the @anthropic-ai/claude-agent-sdk for use with the Nexus provider abstraction.
 */
export class ClaudeCodeProvider implements AgentProvider {
  readonly id = 'claude-code'
  readonly name = 'Claude Code'

  private defaultModel = 'claude-sonnet-4-5-20250929'
  private cachedDetection: ProviderDetectionResult | null = null

  /**
   * Probe whether Claude Code SDK is installed and authenticated.
   */
  async detect(): Promise<ProviderDetectionResult> {
    try {
      const abortController = new AbortController()

      // Timeout detection after 30 seconds
      const timeout = setTimeout(() => abortController.abort(), 30_000)

      // Use a minimal prompt to check auth — immediately abort after init
      const gen = query({
        prompt: 'respond with ok',
        options: {
          abortController,
          maxTurns: 1,
          tools: [],
        },
      })

      let model = 'unknown'
      let authenticated = false

      for await (const msg of gen) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          model = msg.model
          authenticated = true
          abortController.abort()
          break
        }
        if (msg.type === 'result') {
          authenticated = true
          break
        }
      }

      clearTimeout(timeout)

      this.cachedDetection = {
        installed: true,
        version: model,
        authStatus: authenticated ? 'authenticated' : 'unauthenticated',
        message: authenticated ? 'Claude Code SDK authenticated' : 'Claude Code SDK requires authentication',
        detectedAt: new Date(),
      }

      return this.cachedDetection
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      // Check for specific auth-related errors
      const isAuthError = message.includes('auth') || message.includes('login') || message.includes('API key')

      this.cachedDetection = {
        installed: true, // SDK is installed, just not authenticated
        authStatus: isAuthError ? 'unauthenticated' : 'unknown',
        message: isAuthError ? 'Claude Code requires authentication. Run `claude login`.' : message,
        detectedAt: new Date(),
      }

      return this.cachedDetection
    }
  }

  /**
   * Declare Claude Code capabilities.
   */
  capabilities(): ProviderCapabilities {
    return {
      providerId: this.id,
      name: this.name,
      languages: ['*'], // Claude Code supports all languages
      taskTypes: [
        'code_generation',
        'code_review',
        'code_analysis',
        'test_generation',
        'documentation',
        'refactoring',
        'bug_fix',
        'planning',
        'chat',
        'general',
      ],
      maxContextTokens: 200000, // Claude's context window
      supportsStreaming: true,
      supportsCancellation: true,
      availableModels: [
        'claude-sonnet-4-5-20250929',
        'claude-opus-4-5-20251101',
        'claude-3-5-haiku-20241022',
      ],
      defaultModel: this.defaultModel,
      contextInjectionMethod: 'system_prompt', // Claude Code uses system prompt for context
      supportsSessionResume: true,
      maxTurns: 100,
    }
  }

  /**
   * Execute a task and return a structured result.
   */
  async execute(task: TaskDispatch): Promise<TaskResult> {
    const startTime = Date.now()
    const abortController = task.abortController ?? new AbortController()

    // Track for cancellation
    activeTasks.set(task.taskId, abortController)

    try {
      // Prepare context
      const preparedContext = await this.prepareContext(task.context)

      // Build the full prompt with context
      let fullPrompt = task.prompt
      if (preparedContext.method === 'prompt_prefix' && preparedContext.promptContent) {
        fullPrompt = `${preparedContext.promptContent}\n\n---\n\n${task.prompt}`
      }

      // Determine if this is an execution task (needs full tools) vs planning/chat (limited)
      const isExecution = task.type !== 'planning' && task.type !== 'chat'

      // Build options
      const options: Parameters<typeof query>[0]['options'] = {
        abortController,
        model: task.model ?? this.defaultModel,
        maxTurns: task.maxTurns ?? 1,
        ...(isExecution
          ? {
              // Execution tasks: full tool access, auto-accept permissions
              permissionMode: 'bypassPermissions' as const,
              ...(task.context.workingDirectory ? { cwd: task.context.workingDirectory } : {}),
            }
          : {
              // Planning/chat tasks: no tools needed, just text generation
              tools: [],
            }),
      }

      // Add system prompt if provided
      if (task.systemPrompt || (preparedContext.method === 'system_prompt' && preparedContext.promptContent)) {
        options.systemPrompt = task.systemPrompt ?? preparedContext.promptContent
      }

      // Handle session resume
      if (task.sessionId) {
        (options as Record<string, unknown>).resume = task.sessionId
      }

      // Execute query
      const gen = query({ prompt: fullPrompt, options })

      let assistantText = ''
      let structuredOutput: StructuredOutput | undefined
      let sessionId: string | undefined
      let model = task.model ?? this.defaultModel
      let status: TaskStatus = 'success'
      const resultMetrics: Partial<TaskMetrics> = {}

      for await (const msg of gen) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          model = msg.model
          sessionId = msg.sessionId
        } else if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              assistantText += block.text
            }
          }
        } else if (msg.type === 'result') {
          sessionId = msg.sessionId

          // Extract SDK usage metrics
          const msgAny = msg as Record<string, unknown>
          const usage = msgAny.usage as Record<string, number> | undefined
          if (usage) {
            resultMetrics.inputTokens = usage.input_tokens
            resultMetrics.outputTokens = usage.output_tokens
            resultMetrics.tokensUsed = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
          }
          if (typeof msgAny.total_cost_usd === 'number') {
            resultMetrics.estimatedCostUsd = msgAny.total_cost_usd
          }
          if (typeof msgAny.num_turns === 'number') {
            resultMetrics.turnsUsed = msgAny.num_turns
          }
          if (typeof msgAny.duration_ms === 'number') {
            resultMetrics.durationMs = msgAny.duration_ms
          }

          if (msg.subtype === 'success') {
            status = 'success'

            // Check for structured output
            if (msg.structured_output) {
              structuredOutput = {
                type: 'structured',
                data: msg.structured_output,
              }
            } else if (msg.result) {
              // Try to parse as JSON
              try {
                const parsed = JSON.parse(typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result))
                structuredOutput = {
                  type: 'json',
                  data: parsed,
                }
              } catch {
                // Not JSON, leave as text
              }
            }
          } else if (msg.subtype === 'error') {
            status = 'error'
          }
          break
        }
      }

      const durationMs = Date.now() - startTime

      return {
        taskId: task.taskId,
        sessionId,
        status,
        output: structuredOutput,
        stdout: assistantText,
        metrics: {
          durationMs: resultMetrics.durationMs ?? durationMs,
          model,
          turnsUsed: resultMetrics.turnsUsed ?? 1,
          inputTokens: resultMetrics.inputTokens,
          outputTokens: resultMetrics.outputTokens,
          tokensUsed: resultMetrics.tokensUsed,
          estimatedCostUsd: resultMetrics.estimatedCostUsd,
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
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          durationMs,
          model: task.model ?? this.defaultModel,
        },
        providerId: this.id,
        completedAt: new Date(),
      }
    } finally {
      activeTasks.delete(task.taskId)
    }
  }

  /**
   * Execute a task with streaming output.
   */
  async *stream(task: TaskDispatch): AsyncGenerator<StreamEvent, TaskResult, undefined> {
    const startTime = Date.now()
    const abortController = task.abortController ?? new AbortController()

    // Track for cancellation
    activeTasks.set(task.taskId, abortController)

    try {
      // Prepare context
      const preparedContext = await this.prepareContext(task.context)

      // Build the full prompt with context
      let fullPrompt = task.prompt
      if (preparedContext.method === 'prompt_prefix' && preparedContext.promptContent) {
        fullPrompt = `${preparedContext.promptContent}\n\n---\n\n${task.prompt}`
      }

      // Determine if this is an execution task (needs full tools) vs planning/chat (limited)
      const isExecution = task.type !== 'planning' && task.type !== 'chat'

      // Build options
      const options: Parameters<typeof query>[0]['options'] = {
        abortController,
        model: task.model ?? this.defaultModel,
        maxTurns: task.maxTurns ?? 1,
        ...(isExecution
          ? {
              // Execution tasks: full tool access, auto-accept permissions
              permissionMode: 'bypassPermissions' as const,
              ...(task.context.workingDirectory ? { cwd: task.context.workingDirectory } : {}),
            }
          : {
              // Planning/chat tasks: no tools needed, just text generation
              tools: [],
            }),
      }

      // Add system prompt if provided
      if (task.systemPrompt || (preparedContext.method === 'system_prompt' && preparedContext.promptContent)) {
        options.systemPrompt = task.systemPrompt ?? preparedContext.promptContent
      }

      // Handle session resume
      if (task.sessionId) {
        (options as Record<string, unknown>).resume = task.sessionId
      }

      // Execute query
      const gen = query({ prompt: fullPrompt, options })

      let assistantText = ''
      let structuredOutput: StructuredOutput | undefined
      let sessionId: string | undefined
      let model = task.model ?? this.defaultModel
      let status: TaskStatus = 'success'
      const resultMetrics: Partial<TaskMetrics> = {}

      for await (const msg of gen) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          model = msg.model
          sessionId = msg.sessionId

          yield {
            type: 'init',
            taskId: task.taskId,
            model,
            sessionId,
            timestamp: new Date(),
          }
        } else if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              assistantText += block.text

              yield {
                type: 'text',
                taskId: task.taskId,
                text: block.text,
                timestamp: new Date(),
              }
            } else if (block.type === 'tool_use') {
              yield {
                type: 'tool_use',
                taskId: task.taskId,
                toolName: block.name,
                toolInput: block.input,
                timestamp: new Date(),
              }
            }
          }
        } else if (msg.type === 'user') {
          // Tool results come back as user messages with tool_result blocks
          const content = Array.isArray(msg.message?.content) ? msg.message.content : []
          for (const block of content) {
            if ((block as Record<string, unknown>).type === 'tool_result') {
              const toolResult = block as Record<string, unknown>
              yield {
                type: 'tool_result',
                taskId: task.taskId,
                toolName: (toolResult.tool_use_id as string) ?? 'unknown',
                success: !toolResult.is_error,
                result: typeof toolResult.content === 'string'
                  ? toolResult.content.slice(0, 5000)
                  : JSON.stringify(toolResult.content).slice(0, 5000),
                timestamp: new Date(),
              }
            }
          }
        } else if (msg.type === 'result') {
          sessionId = msg.sessionId

          // Extract SDK usage metrics
          const msgAny = msg as Record<string, unknown>
          const usage = msgAny.usage as Record<string, number> | undefined
          if (usage) {
            resultMetrics.inputTokens = usage.input_tokens
            resultMetrics.outputTokens = usage.output_tokens
            resultMetrics.tokensUsed = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
          }
          if (typeof msgAny.total_cost_usd === 'number') {
            resultMetrics.estimatedCostUsd = msgAny.total_cost_usd
          }
          if (typeof msgAny.num_turns === 'number') {
            resultMetrics.turnsUsed = msgAny.num_turns
          }
          if (typeof msgAny.duration_ms === 'number') {
            resultMetrics.durationMs = msgAny.duration_ms
          }

          if (msg.subtype === 'success') {
            status = 'success'

            // Check for structured output
            if (msg.structured_output) {
              structuredOutput = {
                type: 'structured',
                data: msg.structured_output,
              }

              yield {
                type: 'structured_output',
                taskId: task.taskId,
                output: structuredOutput,
                timestamp: new Date(),
              }
            } else if (msg.result) {
              try {
                const parsed = JSON.parse(typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result))
                structuredOutput = {
                  type: 'json',
                  data: parsed,
                }

                yield {
                  type: 'structured_output',
                  taskId: task.taskId,
                  output: structuredOutput,
                  timestamp: new Date(),
                }
              } catch {
                // Not JSON
              }
            }
          } else if (msg.subtype === 'error') {
            status = 'error'

            yield {
              type: 'error',
              taskId: task.taskId,
              error: 'Task failed',
              recoverable: false,
              timestamp: new Date(),
            }
          }
          break
        }
      }

      const durationMs = Date.now() - startTime
      const metrics: TaskMetrics = {
        durationMs: resultMetrics.durationMs ?? durationMs,
        model,
        turnsUsed: resultMetrics.turnsUsed ?? 1,
        inputTokens: resultMetrics.inputTokens,
        outputTokens: resultMetrics.outputTokens,
        tokensUsed: resultMetrics.tokensUsed,
        estimatedCostUsd: resultMetrics.estimatedCostUsd,
      }

      const result: TaskResult = {
        taskId: task.taskId,
        sessionId,
        status,
        output: structuredOutput,
        stdout: assistantText,
        metrics,
        providerId: this.id,
        completedAt: new Date(),
      }

      yield {
        type: 'result',
        taskId: task.taskId,
        result,
        timestamp: new Date(),
      }

      return result
    } catch (error) {
      const durationMs = Date.now() - startTime
      const isAbort = error instanceof Error && error.name === 'AbortError'

      if (isAbort) {
        yield {
          type: 'aborted',
          taskId: task.taskId,
          reason: 'User cancelled',
          timestamp: new Date(),
        }
      } else {
        yield {
          type: 'error',
          taskId: task.taskId,
          error: error instanceof Error ? error.message : 'Unknown error',
          recoverable: false,
          timestamp: new Date(),
        }
      }

      const result: TaskResult = {
        taskId: task.taskId,
        status: isAbort ? 'cancelled' : 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          durationMs,
          model: task.model ?? this.defaultModel,
        },
        providerId: this.id,
        completedAt: new Date(),
      }

      return result
    } finally {
      activeTasks.delete(task.taskId)
    }
  }

  /**
   * Cancel a running task.
   */
  async cancel(taskId: string): Promise<boolean> {
    const controller = activeTasks.get(taskId)
    if (controller) {
      controller.abort()
      activeTasks.delete(taskId)
      return true
    }
    return false
  }

  /**
   * Build the context injection for Claude Code.
   * Claude Code uses system prompts for context injection.
   */
  async prepareContext(context: TaskContext): Promise<PreparedContext> {
    const parts: string[] = []

    // Add vision doc
    if (context.visionDoc) {
      parts.push(`## Project Vision Document\n${context.visionDoc}`)
    }

    // Add dependency context
    if (context.dependencyContext) {
      parts.push(`## Dependency Context\n${context.dependencyContext}`)
    }

    // Add working directory info
    if (context.workingDirectory) {
      parts.push(`## Working Directory\n${context.workingDirectory}`)
    }

    // Add environment info
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
export const claudeCodeProvider = new ClaudeCodeProvider()
