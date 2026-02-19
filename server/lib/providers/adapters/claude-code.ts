/**
 * Claude Code Provider Adapter
 *
 * Implements the AgentProvider interface for Claude Code (via @anthropic-ai/claude-agent-sdk).
 * This adapter translates Astro task dispatches into Claude SDK invocations.
 */

import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
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
import { errorMessage } from '../../error-utils.js'
import { loadMcpConfig, mergeAllowedTools } from '../mcp-loader.js'
import { readRepoContext } from '../../repo-context.js'
import {
  buildCachedSystemPrompt,
  calculateCacheStats,
  extractSourceRepoPath,
} from '../cache-utils.js'

// Map of active tasks for cancellation
const activeTasks = new Map<string, AbortController>()

// Map of active queries for steering (message injection).
// After execution completes, query is set to null but sessionId and workingDirectory
// are preserved so the session can be resumed for post-execution steering.
const activeQueries = new Map<string, {
  query: Query | null
  sessionId: string
  workingDirectory?: string
}>()

/**
 * Claude Code provider adapter.
 * Wraps the @anthropic-ai/claude-agent-sdk for use with the Astro provider abstraction.
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
      // Check if we're inside a Claude Code session (nested session blocked)
      if (process.env.CLAUDECODE) {
        // We're inside Claude Code, so it's definitely available
        // Check if auth token exists
        const hasToken = !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY)

        this.cachedDetection = {
          installed: true,
          authStatus: hasToken ? 'authenticated' : 'unauthenticated',
          message: hasToken
            ? 'Claude Code detected (running in nested session)'
            : 'Claude Code installed but not authenticated',
          detectedAt: new Date(),
        }

        return this.cachedDetection
      }

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
      const message = errorMessage(error)

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
        'claude-opus-4-6',
        'claude-opus-4-5-20251101',
        'claude-haiku-4-5-20251001',
        'claude-3-5-haiku-20241022',
      ],
      defaultModel: this.defaultModel,
      contextInjectionMethod: 'system_prompt', // Claude Code uses system prompt for context
      supportsSessionResume: true,
      maxTurns: 150,
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

      // Determine if this task needs full tool access
      const isExecution = task.type !== 'planning' && task.type !== 'chat'
      const isPlanningWithRepo = task.type === 'planning' && !!task.context.workingDirectory

      // Load MCP config from working directory (Cyrus pattern)
      let mcpServers: Record<string, unknown> | undefined
      if (task.context.workingDirectory) {
        mcpServers = loadMcpConfig(task.context.workingDirectory)
      }

      // Add Astro built-in MCP server for custom tools (plan/project management, user questions)
      const astroMcpPath = new URL('../mcp/astro-tools-server.ts', import.meta.url).pathname
      const astroMcpServer = {
        command: 'node',
        args: ['--import=tsx/esm', astroMcpPath],
        env: {
          ASTRO_EXECUTION_ID: task.taskId,
          ASTRO_PROJECT_ID: task.context.projectId || '',
          ASTRO_SERVER_URL: process.env.ASTRO_SERVER_URL || 'http://localhost:3001',
          ASTRO_AUTH_TOKEN: task.context.authToken || '',
        },
      }

      mcpServers = {
        ...mcpServers,
        'astro-tools': astroMcpServer,
      }

      // Process tool access control (Cyrus pattern)
      const allowedTools = mergeAllowedTools(
        task.context.allowedTools,
        task.context.allowedDirectories
      )
      const disallowedTools = task.context.disallowedTools

      console.log('[claude-code] Tool access control:', {
        allowedTools: allowedTools?.length ?? 'all',
        disallowedTools: disallowedTools?.length ?? 'none',
        mcpServers: mcpServers ? Object.keys(mcpServers).length : 0,
      })

      // Build options
      const options: Parameters<typeof query>[0]['options'] = {
        abortController,
        model: task.model ?? this.defaultModel,
        maxTurns: task.maxTurns ?? 1,
        ...((isExecution || isPlanningWithRepo)
          ? {
              // Execution & planning-with-repo: controlled tool access
              permissionMode: 'bypassPermissions' as const,
              ...(task.context.workingDirectory ? { cwd: task.context.workingDirectory } : {}),
              // Add MCP servers if found (with caching on last tool)
              ...(mcpServers ? { mcpServers } : {}),
              // Add tool restrictions if specified
              ...(allowedTools ? { allowedTools } : {}),
              ...(disallowedTools ? { disallowedTools } : {}),
            }
          : {
              // Planning-without-repo & chat: no tools needed, just text generation
              tools: [],
            }),
      }

      // Add system prompt (prefer systemBlocks for caching, fallback to string)
      if (task.systemPrompt) {
        options.systemPrompt = task.systemPrompt
      } else if (preparedContext.systemBlocks && preparedContext.systemBlocks.length > 0) {
        // Use structured blocks with cache_control
        options.systemPrompt = preparedContext.systemBlocks as unknown as string
      } else if (preparedContext.promptContent) {
        options.systemPrompt = preparedContext.promptContent
      }

      // Add output format for structured JSON output
      if (task.outputFormat) {
        options.outputFormat = task.outputFormat
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

            // Log cache effectiveness
            if (usage.cache_read_input_tokens || usage.cache_creation_input_tokens) {
              const cacheStats = calculateCacheStats(usage)
              console.log(
                `[claude-code] Cache stats: ${cacheStats.totalInputTokens} tokens, ` +
                `${(cacheStats.cacheHitRate * 100).toFixed(1)}% hit rate, ` +
                `~${cacheStats.estimatedSavings.toFixed(0)}% cost savings`
              )
            }
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
        errorMessage: errorMessage(error),
        metrics: {
          durationMs,
          model: task.model ?? this.defaultModel,
        },
        providerId: this.id,
        completedAt: new Date(),
      }
    } finally {
      activeTasks.delete(task.taskId)
      // Preserve session context for post-execution steering (resume)
      const existing = activeQueries.get(task.taskId)
      if (existing) {
        existing.query = null
      }
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

      // Determine if this task needs full tool access
      const isExecution = task.type !== 'planning' && task.type !== 'chat'
      const isPlanningWithRepo = task.type === 'planning' && !!task.context.workingDirectory

      // Load MCP config from working directory (Cyrus pattern)
      let mcpServers: Record<string, unknown> | undefined
      if (task.context.workingDirectory) {
        mcpServers = loadMcpConfig(task.context.workingDirectory)
      }

      // Add Astro built-in MCP server for custom tools (plan/project management, user questions)
      const astroMcpPath = new URL('../mcp/astro-tools-server.ts', import.meta.url).pathname
      const astroMcpServer = {
        command: 'node',
        args: ['--import=tsx/esm', astroMcpPath],
        env: {
          ASTRO_EXECUTION_ID: task.taskId,
          ASTRO_PROJECT_ID: task.context.projectId || '',
          ASTRO_SERVER_URL: process.env.ASTRO_SERVER_URL || 'http://localhost:3001',
          ASTRO_AUTH_TOKEN: task.context.authToken || '',
        },
      }

      mcpServers = {
        ...mcpServers,
        'astro-tools': astroMcpServer,
      }

      // Process tool access control (Cyrus pattern)
      const allowedTools = mergeAllowedTools(
        task.context.allowedTools,
        task.context.allowedDirectories
      )
      const disallowedTools = task.context.disallowedTools

      console.log('[claude-code] Tool access control:', {
        allowedTools: allowedTools?.length ?? 'all',
        disallowedTools: disallowedTools?.length ?? 'none',
        mcpServers: mcpServers ? Object.keys(mcpServers).length : 0,
      })

      // Build options
      const options: Parameters<typeof query>[0]['options'] = {
        abortController,
        model: task.model ?? this.defaultModel,
        maxTurns: task.maxTurns ?? 1,
        ...((isExecution || isPlanningWithRepo)
          ? {
              // Execution & planning-with-repo: controlled tool access
              permissionMode: 'bypassPermissions' as const,
              ...(task.context.workingDirectory ? { cwd: task.context.workingDirectory } : {}),
              // Add MCP servers if found (with caching on last tool)
              ...(mcpServers ? { mcpServers } : {}),
              // Add tool restrictions if specified
              ...(allowedTools ? { allowedTools } : {}),
              ...(disallowedTools ? { disallowedTools } : {}),
            }
          : {
              // Planning-without-repo & chat: no tools needed, just text generation
              tools: [],
            }),
      }

      // Add system prompt (prefer systemBlocks for caching, fallback to string)
      if (task.systemPrompt) {
        options.systemPrompt = task.systemPrompt
      } else if (preparedContext.systemBlocks && preparedContext.systemBlocks.length > 0) {
        // Use structured blocks with cache_control
        options.systemPrompt = preparedContext.systemBlocks as unknown as string
      } else if (preparedContext.promptContent) {
        options.systemPrompt = preparedContext.promptContent
      }

      // Add output format for structured JSON output (e.g., plan generation)
      if (task.outputFormat) {
        options.outputFormat = task.outputFormat
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
          activeQueries.set(task.taskId, {
            query: gen,
            sessionId: msg.sessionId,
            workingDirectory: task.context.workingDirectory,
          })

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
                  ? toolResult.content.slice(0, 100000)
                  : JSON.stringify(toolResult.content).slice(0, 100000),
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

            // Log cache effectiveness
            if (usage.cache_read_input_tokens || usage.cache_creation_input_tokens) {
              const cacheStats = calculateCacheStats(usage)
              console.log(
                `[claude-code] Cache stats: ${cacheStats.totalInputTokens} tokens, ` +
                `${(cacheStats.cacheHitRate * 100).toFixed(1)}% hit rate, ` +
                `~${cacheStats.estimatedSavings.toFixed(0)}% cost savings`
              )
            }
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
          } else {
            // Handle all non-success result subtypes:
            // 'error', 'error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries', etc.
            status = 'error'

            const subtypeMessages: Record<string, string> = {
              error: 'Task failed with an error from the AI provider.',
              error_max_turns: 'Max turns reached — the AI used all available conversation turns without completing the task. Try increasing max turns or simplifying the request.',
              error_max_budget_usd: 'Budget limit reached — the task exceeded the allowed cost budget.',
              error_max_structured_output_retries: 'The AI failed to produce valid structured output after multiple attempts. Try simplifying the request.',
            }

            const msgAnyErr = msg as Record<string, unknown>
            const errorDetail = subtypeMessages[msg.subtype]
              || (typeof msgAnyErr.error === 'string' ? msgAnyErr.error : null)
              || `Task ended with non-success status: ${msg.subtype}`

            console.warn(`[claude-code] Non-success result: subtype=${msg.subtype}, detail=${errorDetail}`)

            yield {
              type: 'error',
              taskId: task.taskId,
              error: errorDetail,
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
          error: errorMessage(error),
          recoverable: false,
          timestamp: new Date(),
        }
      }

      const result: TaskResult = {
        taskId: task.taskId,
        status: isAbort ? 'cancelled' : 'error',
        errorMessage: errorMessage(error),
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
      // Preserve session context for post-execution steering (resume)
      const existing = activeQueries.get(task.taskId)
      if (existing) {
        existing.query = null
      }
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
   * Claude Code uses system prompts with prompt caching for efficiency.
   *
   * Cache strategy:
   * - Repo context (1h): Stable across all tasks in a project
   * - Vision doc (1h): Stable per project
   * - Dependency context (5m): Shared by downstream tasks
   */
  async prepareContext(context: TaskContext): Promise<PreparedContext> {
    // For worktrees, read repo context from SOURCE repo (not worktree)
    // This enables cache hits across all worktrees from the same repo
    let repoContext
    if (context.workingDirectory) {
      const sourceRepoPath = await extractSourceRepoPath(context.workingDirectory)
      repoContext = readRepoContext(sourceRepoPath)

      // Log if we're using a worktree (different from source)
      if (sourceRepoPath !== context.workingDirectory) {
        console.log(
          `[claude-code] Using repo context from source: ${sourceRepoPath} (worktree: ${context.workingDirectory})`
        )
      }
    }

    // Build cached system prompt blocks
    const systemBlocks = buildCachedSystemPrompt({
      baseInstructions: context.environment
        ? `## Execution Environment\n${context.environment}`
        : undefined,
      repoContext,
      visionDoc: context.visionDoc,
      dependencyContext: context.dependencyContext,
      workingDirectory: context.workingDirectory,
    })

    if (systemBlocks.length === 0) {
      return { method: 'system_prompt' }
    }

    // Return as structured blocks (SDK supports array of system blocks)
    return {
      method: 'system_prompt',
      systemBlocks, // Pass blocks directly for cache_control support
    }
  }
}

// Export singleton instance
export const claudeCodeProvider = new ClaudeCodeProvider()

/**
 * Inject a steering message into a locally-running task's Claude session.
 * Uses Query.streamInput() to feed a new user message into the running query.
 * When interrupt=true, calls Query.interrupt() first to stop the current turn
 * before injecting the message.
 *
 * Returns 'injected' if message was injected into active session,
 * 'no_active_query' if no query exists (task unknown),
 * 'completed' if execution finished but context is preserved (needs resume).
 */
export async function steerLocalTask(taskId: string, message: string, interrupt = false): Promise<'injected' | 'no_active_query' | 'completed'> {
  const active = activeQueries.get(taskId)
  if (!active) return 'no_active_query'

  // If query is null, execution completed but context is preserved
  if (!active.query) return 'completed'

  if (interrupt) {
    // Fire interrupt without awaiting — interrupt() may block until the
    // current turn finishes, which can take a long time.  We fire and
    // forget, then add a small delay for the signal to propagate.
    active.query.interrupt().catch(() => {
      /* agent may be idle between turns */
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  const msg = {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: message,
    },
    parent_tool_use_id: null,
    session_id: active.sessionId,
  }

  const iterable = {
    async *[Symbol.asyncIterator]() {
      yield msg
    },
  }

  active.query.streamInput(iterable).catch((err: Error) => {
    console.error(`[claude-code] Failed to inject steer for ${taskId}:`, err.message)
  })

  return 'injected'
}

/**
 * Resume a completed local task session in its worktree.
 * Creates a new query() call with resume: sessionId so the agent
 * continues in the same conversation context.
 *
 * Returns an AsyncGenerator<StreamEvent> for streaming back to the client.
 */
export async function* resumeLocalTask(
  taskId: string,
  message: string,
  workingDirectory: string,
  sessionId: string,
): AsyncGenerator<StreamEvent, void, undefined> {
  const abortController = new AbortController()
  activeTasks.set(taskId, abortController)

  try {
    // Load MCP config from working directory
    const { loadMcpConfig } = await import('../mcp-loader.js')
    let mcpServers: Record<string, unknown> | undefined = loadMcpConfig(workingDirectory)

    // Add Astro built-in MCP server
    const astroMcpPath = new URL('../mcp/astro-tools-server.ts', import.meta.url).pathname
    mcpServers = {
      ...mcpServers,
      'astro-tools': {
        command: 'node',
        args: ['--import=tsx/esm', astroMcpPath],
        env: {
          ASTRO_EXECUTION_ID: taskId,
          ASTRO_PROJECT_ID: '',
          ASTRO_SERVER_URL: process.env.ASTRO_SERVER_URL || 'http://localhost:3001',
          ASTRO_AUTH_TOKEN: '',
        },
      },
    }

    const options: Parameters<typeof query>[0]['options'] = {
      abortController,
      model: 'claude-sonnet-4-5-20250929',
      maxTurns: 100,
      permissionMode: 'bypassPermissions' as const,
      cwd: workingDirectory,
      ...(mcpServers ? { mcpServers } : {}),
    }

    // Resume from previous session
    ;(options as Record<string, unknown>).resume = sessionId

    const gen = query({ prompt: message, options })

    let newSessionId = sessionId

    for await (const msg of gen) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        newSessionId = msg.sessionId
        // Update activeQueries with the new live query
        activeQueries.set(taskId, {
          query: gen,
          sessionId: newSessionId,
          workingDirectory,
        })

        yield {
          type: 'init',
          taskId,
          model: msg.model,
          sessionId: newSessionId,
          timestamp: new Date(),
        }
      } else if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            yield { type: 'text', taskId, text: block.text, timestamp: new Date() }
          } else if (block.type === 'tool_use') {
            yield { type: 'tool_use', taskId, toolName: block.name, toolInput: block.input, timestamp: new Date() }
          }
        }
      } else if (msg.type === 'user') {
        const content = Array.isArray(msg.message?.content) ? msg.message.content : []
        for (const block of content) {
          if ((block as Record<string, unknown>).type === 'tool_result') {
            const toolResult = block as Record<string, unknown>
            yield {
              type: 'tool_result',
              taskId,
              toolName: (toolResult.tool_use_id as string) ?? 'unknown',
              success: !toolResult.is_error,
              result: typeof toolResult.content === 'string'
                ? toolResult.content.slice(0, 100000)
                : JSON.stringify(toolResult.content).slice(0, 100000),
              timestamp: new Date(),
            }
          }
        }
      } else if (msg.type === 'result') {
        newSessionId = msg.sessionId

        const msgAny = msg as Record<string, unknown>
        const usage = msgAny.usage as Record<string, number> | undefined
        const metrics: Partial<TaskMetrics> = {}
        if (usage) {
          metrics.inputTokens = usage.input_tokens
          metrics.outputTokens = usage.output_tokens
          metrics.tokensUsed = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
        }
        if (typeof msgAny.total_cost_usd === 'number') {
          metrics.estimatedCostUsd = msgAny.total_cost_usd
        }
        if (typeof msgAny.num_turns === 'number') {
          metrics.turnsUsed = msgAny.num_turns
        }
        if (typeof msgAny.duration_ms === 'number') {
          metrics.durationMs = msgAny.duration_ms
        }

        yield {
          type: 'result',
          taskId,
          result: {
            taskId,
            sessionId: newSessionId,
            status: msg.subtype === 'success' ? 'success' : 'error',
            metrics: {
              durationMs: metrics.durationMs ?? 0,
              model: 'claude-sonnet-4-5-20250929',
              turnsUsed: metrics.turnsUsed,
              inputTokens: metrics.inputTokens,
              outputTokens: metrics.outputTokens,
              tokensUsed: metrics.tokensUsed,
              estimatedCostUsd: metrics.estimatedCostUsd,
            },
            providerId: 'claude-code',
            completedAt: new Date(),
          },
          timestamp: new Date(),
        }
        break
      }
    }

    // After resume completes, preserve context again
    activeQueries.set(taskId, {
      query: null,
      sessionId: newSessionId,
      workingDirectory,
    })
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError'
    if (isAbort) {
      yield { type: 'aborted', taskId, reason: 'User cancelled', timestamp: new Date() }
    } else {
      yield {
        type: 'error',
        taskId,
        error: errorMessage(error),
        recoverable: false,
        timestamp: new Date(),
      }
    }
  } finally {
    activeTasks.delete(taskId)
    // Preserve session context for subsequent resumes
    const existing = activeQueries.get(taskId)
    if (existing) {
      existing.query = null
    }
  }
}

/**
 * Get session context for a completed local task.
 * Returns sessionId and workingDirectory if available.
 */
export function getLocalTaskContext(taskId: string): { sessionId: string; workingDirectory?: string } | null {
  const active = activeQueries.get(taskId)
  if (!active) return null
  return { sessionId: active.sessionId, workingDirectory: active.workingDirectory }
}

/**
 * Clean up preserved session context for a task.
 * Called when a task is explicitly completed or pruned.
 */
export function cleanupLocalTaskContext(taskId: string): void {
  activeQueries.delete(taskId)
}
