/**
 * Claude Code Provider Adapter
 *
 * Implements the AgentProvider interface for Claude Code (via @anthropic-ai/claude-agent-sdk).
 * This adapter translates Astro task dispatches into Claude SDK invocations.
 */

import { query, type Query, type Options } from '@anthropic-ai/claude-agent-sdk'
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
import {
  buildAppendContent,
  calculateCacheStats,
} from '../cache-utils.js'
import { SessionLogger } from '../session-logger.js'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// .env loader (no external dependency)
// ---------------------------------------------------------------------------

/**
 * Parse a .env file from a directory into key=value pairs.
 * Supports # comments, quoted values, and multi-line values.
 */
export function loadDotEnv(dir?: string): Record<string, string> {
  if (!dir) return {}
  const envPath = join(dir, '.env')
  if (!existsSync(envPath)) return {}

  try {
    const content = readFileSync(envPath, 'utf-8')
    const result: Record<string, string> = {}

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue
      // Match KEY=VALUE (value may be quoted)
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      // Strip inline comment (only for unquoted values)
      const hashIdx = value.indexOf(' #')
      if (hashIdx !== -1 && !trimmed.slice(eqIdx + 1).trim().startsWith('"')) {
        value = value.slice(0, hashIdx).trim()
      }
      if (key) result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

interface ClaudeCodeProviderConfig {
  hooks?: Record<string, unknown>
  extraArgs?: Record<string, string | null>
}

// ---------------------------------------------------------------------------
// Active task tracking
// ---------------------------------------------------------------------------

/** Map of active tasks for cancellation */
const activeTasks = new Map<string, AbortController>()

/**
 * Map of active queries for steering (message injection).
 * After execution completes, query is set to null but sessionId and workingDirectory
 * are preserved so the session can be resumed for post-execution steering.
 */
const activeQueries = new Map<string, {
  query: Query | null
  sessionId: string
  workingDirectory?: string
}>()

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

/**
 * Claude Code provider adapter.
 * Wraps the @anthropic-ai/claude-agent-sdk for use with the Astro provider abstraction.
 */
export class ClaudeCodeProvider implements AgentProvider {
  readonly id = 'claude-code'
  readonly name = 'Claude Code'

  private defaultModel = 'claude-sonnet-4-5-20250929'
  private fallbackModel = 'sonnet'
  private cachedDetection: ProviderDetectionResult | null = null
  private config: ClaudeCodeProviderConfig

  constructor(config: ClaudeCodeProviderConfig = {}) {
    this.config = config
  }

  /**
   * Probe whether Claude Code SDK is installed and authenticated.
   */
  async detect(): Promise<ProviderDetectionResult> {
    try {
      // Check if we're inside a Claude Code session (nested session blocked)
      if (process.env.CLAUDECODE) {
        const hasOAuthOrKey = !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY)
        const hasBedrock = !!(process.env.CLAUDE_CODE_USE_BEDROCK && (
          process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_SESSION_TOKEN
        ))
        const hasToken = hasOAuthOrKey || hasBedrock

        this.cachedDetection = {
          installed: true,
          authStatus: hasToken ? 'authenticated' : 'unauthenticated',
          message: hasToken
            ? `Claude Code detected (running in nested session${hasBedrock ? ', Bedrock auth' : ''})`
            : 'Claude Code installed but not authenticated',
          detectedAt: new Date(),
        }

        return this.cachedDetection
      }

      const abortController = new AbortController()
      const timeout = setTimeout(() => abortController.abort(), 30_000)

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
      const isAuthError = message.includes('auth') || message.includes('login') || message.includes('API key')

      this.cachedDetection = {
        installed: true,
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
      languages: ['*'],
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
      fallbackModel: this.fallbackModel,
      contextInjectionMethod: 'system_prompt',
      supportsSessionResume: true,
      maxTurns: 150,
    }
  }

  // -----------------------------------------------------------------------
  // Shared option building
  // -----------------------------------------------------------------------

  /**
   * Build MCP server config for a task.
   */
  private buildMcpServers(task: TaskDispatch): Record<string, unknown> | undefined {
    let mcpServers: Record<string, unknown> | undefined
    if (task.context.workingDirectory) {
      mcpServers = loadMcpConfig(task.context.workingDirectory)
    }

    // Add Astro built-in MCP server
    const astroMcpPath = new URL('../mcp/astro-tools-server.ts', import.meta.url).pathname
    mcpServers = {
      ...mcpServers,
      'astro-tools': {
        command: 'node',
        args: ['--import=tsx/esm', astroMcpPath],
        env: {
          ASTRO_EXECUTION_ID: task.taskId,
          ASTRO_PROJECT_ID: task.context.projectId || '',
          ASTRO_SERVER_URL: process.env.ASTRO_SERVER_URL || 'http://localhost:3001',
          ASTRO_AUTH_TOKEN: task.context.authToken || '',
        },
      },
    }

    return mcpServers
  }

  /**
   * Build the canUseTool callback for AskUserQuestion interception.
   */
  private buildCanUseTool(task: TaskDispatch): Options['canUseTool'] {
    const approvalCallback = task.context.approvalCallback
    if (!approvalCallback) return undefined

    return async (toolName, input, opts) => {
      if (toolName === 'AskUserQuestion') {
        console.log(`[claude-code] Intercepted AskUserQuestion (toolUseID: ${opts.toolUseID})`)

        const askInput = input as {
          questions?: Array<{
            question: string
            options: Array<{ label: string; description?: string }>
          }>
        }

        if (!askInput.questions || !Array.isArray(askInput.questions)) {
          return {
            behavior: 'deny' as const,
            message: 'Invalid AskUserQuestion input: questions array is required',
          }
        }

        if (askInput.questions.length !== 1) {
          return {
            behavior: 'deny' as const,
            message: 'Only one question at a time is supported.',
          }
        }

        const question = askInput.questions[0]
        const optionLabels = question.options.map(opt => opt.label)

        try {
          const result = await approvalCallback(task.taskId, question.question, optionLabels)

          return {
            behavior: 'allow' as const,
            updatedInput: {
              questions: askInput.questions,
              answers: { [question.question]: result },
            },
          }
        } catch (error) {
          return {
            behavior: 'deny' as const,
            message: `Failed to get user approval: ${errorMessage(error)}`,
          }
        }
      }

      // Allow all other tools
      return { behavior: 'allow' as const, updatedInput: input }
    }
  }

  /**
   * Build query options shared across execute(), stream(), and resumeLocalTask().
   *
   * Uses `settingSources` for automatic CLAUDE.md loading and `systemPrompt` preset
   * with an append containing Astro-specific context (vision doc, dependency context, etc.).
   */
  private buildQueryOptions(task: TaskDispatch, abortController: AbortController): Options {
    const isExecution = task.type !== 'planning' && task.type !== 'chat'
    const isPlanningWithRepo = task.type === 'planning' && !!task.context.workingDirectory
    const needsTools = isExecution || isPlanningWithRepo

    // Build MCP servers
    const mcpServers = this.buildMcpServers(task)

    // Build tool access control
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

    // Build append content for system prompt (Astro-specific context only)
    const appendContent = buildAppendContent({
      baseInstructions: task.context.environment
        ? `## Execution Environment\n${task.context.environment}`
        : undefined,
      visionDoc: task.context.visionDoc,
      dependencyContext: task.context.dependencyContext,
      workingDirectory: task.context.workingDirectory,
    })

    // Build env: process env + task env vars + .env file
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...(task.context.environmentVariables || {}),
      ...loadDotEnv(task.context.workingDirectory),
      CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
    }

    // Build system prompt: use preset with append, or explicit task.systemPrompt override
    const systemPrompt: Options['systemPrompt'] = task.systemPrompt
      ?? (appendContent
        ? { type: 'preset' as const, preset: 'claude_code' as const, append: appendContent }
        : { type: 'preset' as const, preset: 'claude_code' as const })

    // Build canUseTool callback
    const canUseTool = this.buildCanUseTool(task)

    const options: Options = {
      abortController,
      model: task.model ?? this.defaultModel,
      fallbackModel: this.fallbackModel,
      maxTurns: task.maxTurns ?? 1,
      env,
      systemPrompt,
      ...(needsTools
        ? {
            // Execution & planning-with-repo: full tool access
            permissionMode: 'bypassPermissions' as const,
            settingSources: ['user' as const, 'project' as const, 'local' as const],
            ...(task.context.workingDirectory ? { cwd: task.context.workingDirectory } : {}),
            ...(mcpServers ? { mcpServers } : {}),
            ...(allowedTools ? { allowedTools } : {}),
            ...(disallowedTools ? { disallowedTools } : {}),
          }
        : {
            // Planning-without-repo & chat: no tools, just text generation
            allowedTools: [] as string[],
          }),
      ...(task.outputFormat ? { outputFormat: task.outputFormat } : {}),
      ...(task.sessionId ? { resume: task.sessionId } : {}),
      ...(canUseTool ? { canUseTool } : {}),
      // Hooks passthrough (provider-level + task-level)
      ...(this.config.hooks || task.context.hooks
        ? { hooks: { ...this.config.hooks, ...(task.context.hooks as Record<string, unknown>) } as Options['hooks'] }
        : {}),
      // Extra args passthrough
      ...(this.config.extraArgs || task.context.extraArgs
        ? { extraArgs: { ...this.config.extraArgs, ...task.context.extraArgs } }
        : {}),
    }

    return options
  }

  // -----------------------------------------------------------------------
  // Result metrics extraction (shared helper)
  // -----------------------------------------------------------------------

  private extractResultMetrics(msg: Record<string, unknown>): Partial<TaskMetrics> {
    const metrics: Partial<TaskMetrics> = {}

    // Prefer modelUsage (aggregated across all models, includes cache tokens)
    // over usage (BetaUsage, which only has non-cached direct input_tokens).
    const modelUsage = msg.modelUsage as Record<string, {
      inputTokens?: number
      outputTokens?: number
      cacheReadInputTokens?: number
      cacheCreationInputTokens?: number
      costUSD?: number
    }> | undefined

    if (modelUsage) {
      let totalInput = 0
      let totalOutput = 0
      let totalCacheRead = 0
      let totalCacheCreation = 0

      for (const mu of Object.values(modelUsage)) {
        totalInput += mu.inputTokens ?? 0
        totalOutput += mu.outputTokens ?? 0
        totalCacheRead += mu.cacheReadInputTokens ?? 0
        totalCacheCreation += mu.cacheCreationInputTokens ?? 0
      }

      metrics.inputTokens = totalInput + totalCacheRead + totalCacheCreation
      metrics.outputTokens = totalOutput
      metrics.tokensUsed = metrics.inputTokens + metrics.outputTokens

      if (totalCacheRead > 0 || totalCacheCreation > 0) {
        const cacheStats = calculateCacheStats({
          input_tokens: totalInput,
          cache_read_input_tokens: totalCacheRead,
          cache_creation_input_tokens: totalCacheCreation,
        })
        console.log(
          `[claude-code] Cache stats: ${cacheStats.totalInputTokens} tokens, ` +
          `${(cacheStats.cacheHitRate * 100).toFixed(1)}% hit rate, ` +
          `~${cacheStats.estimatedSavings.toFixed(0)}% cost savings`
        )
      }
    } else {
      // Fallback to BetaUsage (non-cached counts only)
      const usage = msg.usage as Record<string, number> | undefined
      if (usage) {
        metrics.inputTokens = usage.input_tokens
        metrics.outputTokens = usage.output_tokens
        metrics.tokensUsed = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)

        if (usage.cache_read_input_tokens || usage.cache_creation_input_tokens) {
          const cacheStats = calculateCacheStats(usage)
          console.log(
            `[claude-code] Cache stats: ${cacheStats.totalInputTokens} tokens, ` +
            `${(cacheStats.cacheHitRate * 100).toFixed(1)}% hit rate, ` +
            `~${cacheStats.estimatedSavings.toFixed(0)}% cost savings`
          )
        }
      }
    }

    if (typeof msg.total_cost_usd === 'number') {
      metrics.estimatedCostUsd = msg.total_cost_usd
    }
    if (typeof msg.num_turns === 'number') {
      metrics.turnsUsed = msg.num_turns
    }
    if (typeof msg.duration_ms === 'number') {
      metrics.durationMs = msg.duration_ms
    }
    return metrics
  }

  // -----------------------------------------------------------------------
  // execute()
  // -----------------------------------------------------------------------

  /**
   * Execute a task and return a structured result.
   */
  async execute(task: TaskDispatch): Promise<TaskResult> {
    const startTime = Date.now()
    const abortController = task.abortController ?? new AbortController()
    activeTasks.set(task.taskId, abortController)

    const logger = new SessionLogger(task.taskId)

    try {
      const options = this.buildQueryOptions(task, abortController)
      const gen = query({ prompt: task.prompt, options })

      let assistantText = ''
      let structuredOutput: StructuredOutput | undefined
      let sessionId: string | undefined
      let model = task.model ?? this.defaultModel
      let status: TaskStatus = 'success'
      let errorMsg: string | undefined
      let resultMetrics: Partial<TaskMetrics> = {}

      for await (const msg of gen) {
        logger.log(msg as unknown as { type: string })

        if (msg.type === 'system' && msg.subtype === 'init') {
          model = msg.model
          sessionId = msg.session_id
        } else if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              assistantText += block.text
            }
          }
        } else if (msg.type === 'result') {
          sessionId = msg.session_id

          resultMetrics = this.extractResultMetrics(msg as unknown as Record<string, unknown>)

          if (msg.subtype === 'success') {
            status = 'success'
            if (msg.structured_output) {
              structuredOutput = { type: 'structured', data: msg.structured_output }
            } else if (msg.result) {
              try {
                const parsed = JSON.parse(typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result))
                structuredOutput = { type: 'json', data: parsed }
              } catch {
                // Not JSON
              }
            }
          } else {
            status = 'error'

            const subtypeMessages: Record<string, string> = {
              error: 'Task failed with an error from the AI provider.',
              error_max_turns: 'Max turns reached — the AI used all available conversation turns without completing the task.',
              error_max_budget_usd: 'Budget limit reached — the task exceeded the allowed cost budget.',
              error_max_structured_output_retries: 'The AI failed to produce valid structured output after multiple attempts.',
            }

            const msgAny = msg as unknown as Record<string, unknown>
            errorMsg = subtypeMessages[msg.subtype]
              || (typeof msgAny.error === 'string' ? msgAny.error : null)
              || `Task ended with non-success status: ${msg.subtype}`
          }
          break
        }
      }

      const durationMs = Date.now() - startTime
      const result: TaskResult = {
        taskId: task.taskId,
        sessionId,
        status,
        output: structuredOutput,
        stdout: assistantText,
        errorMessage: errorMsg,
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

      await logger.finalize(result)
      return result
    } catch (error) {
      const durationMs = Date.now() - startTime
      const isAbort = error instanceof Error && error.name === 'AbortError'
      const result: TaskResult = {
        taskId: task.taskId,
        status: isAbort ? 'cancelled' : 'error',
        errorMessage: errorMessage(error),
        metrics: { durationMs, model: task.model ?? this.defaultModel },
        providerId: this.id,
        completedAt: new Date(),
      }
      await logger.finalize(result)
      return result
    } finally {
      activeTasks.delete(task.taskId)
      const existing = activeQueries.get(task.taskId)
      if (existing) existing.query = null
    }
  }

  // -----------------------------------------------------------------------
  // stream()
  // -----------------------------------------------------------------------

  /**
   * Execute a task with streaming output.
   */
  async *stream(task: TaskDispatch): AsyncGenerator<StreamEvent, TaskResult, undefined> {
    const startTime = Date.now()
    const abortController = task.abortController ?? new AbortController()
    activeTasks.set(task.taskId, abortController)

    const logger = new SessionLogger(task.taskId)

    try {
      const options = this.buildQueryOptions(task, abortController)
      console.log(`[claude-code] stream() taskId=${task.taskId} cwd=${task.context.workingDirectory ?? 'none'}`)
      const gen = query({ prompt: task.prompt, options })

      let assistantText = ''
      let structuredOutput: StructuredOutput | undefined
      let sessionId: string | undefined
      let model = task.model ?? this.defaultModel
      let status: TaskStatus = 'success'
      let resultMetrics: Partial<TaskMetrics> = {}

      // Map toolUseId → toolName for correlating tool_use → tool_result
      const toolUseIdToName = new Map<string, string>()

      for await (const msg of gen) {
        logger.log(msg as unknown as { type: string })

        if (msg.type === 'system' && msg.subtype === 'init') {
          model = msg.model
          sessionId = msg.session_id
          activeQueries.set(task.taskId, {
            query: gen,
            sessionId: msg.session_id,
            workingDirectory: task.context.workingDirectory,
          })

          yield {
            type: 'init',
            taskId: task.taskId,
            model,
            sessionId: msg.session_id,
            timestamp: new Date(),
          }
        } else if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              assistantText += block.text
              yield { type: 'text', taskId: task.taskId, text: block.text, timestamp: new Date() }
            } else if (block.type === 'tool_use') {
              toolUseIdToName.set(block.id, block.name)
              yield {
                type: 'tool_use',
                taskId: task.taskId,
                toolName: block.name,
                toolInput: block.input,
                toolUseId: block.id,
                timestamp: new Date(),
              }
            }
          }
        } else if (msg.type === 'user') {
          const content = Array.isArray(msg.message?.content) ? msg.message.content : []
          for (const block of content) {
            if ((block as Record<string, unknown>).type === 'tool_result') {
              const toolResult = block as Record<string, unknown>
              const tuId = toolResult.tool_use_id as string
              yield {
                type: 'tool_result',
                taskId: task.taskId,
                toolName: toolUseIdToName.get(tuId) ?? 'unknown',
                success: !toolResult.is_error,
                result: typeof toolResult.content === 'string'
                  ? toolResult.content.slice(0, 100000)
                  : JSON.stringify(toolResult.content).slice(0, 100000),
                toolUseId: tuId,
                timestamp: new Date(),
              }
            }
          }
        } else if (msg.type === 'result') {
          sessionId = msg.session_id

          resultMetrics = this.extractResultMetrics(msg as unknown as Record<string, unknown>)

          if (msg.subtype === 'success') {
            status = 'success'

            if (msg.structured_output) {
              structuredOutput = { type: 'structured', data: msg.structured_output }
              yield {
                type: 'structured_output',
                taskId: task.taskId,
                output: structuredOutput,
                timestamp: new Date(),
              }
            } else if (msg.result) {
              try {
                const parsed = JSON.parse(typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result))
                structuredOutput = { type: 'json', data: parsed }
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
            status = 'error'

            const subtypeMessages: Record<string, string> = {
              error: 'Task failed with an error from the AI provider.',
              error_max_turns: 'Max turns reached — the AI used all available conversation turns without completing the task. Try increasing max turns or simplifying the request.',
              error_max_budget_usd: 'Budget limit reached — the task exceeded the allowed cost budget.',
              error_max_structured_output_retries: 'The AI failed to produce valid structured output after multiple attempts. Try simplifying the request.',
            }

            const msgAnyErr = msg as unknown as Record<string, unknown>
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

      yield { type: 'result', taskId: task.taskId, result, timestamp: new Date() }

      await logger.finalize(result)
      return result
    } catch (error) {
      const durationMs = Date.now() - startTime
      const isAbort = error instanceof Error && error.name === 'AbortError'

      if (isAbort) {
        yield { type: 'aborted', taskId: task.taskId, reason: 'User cancelled', timestamp: new Date() }
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
        metrics: { durationMs, model: task.model ?? this.defaultModel },
        providerId: this.id,
        completedAt: new Date(),
      }

      await logger.finalize(result)
      return result
    } finally {
      activeTasks.delete(task.taskId)
      const existing = activeQueries.get(task.taskId)
      if (existing) existing.query = null
    }
  }

  // -----------------------------------------------------------------------
  // cancel()
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // prepareContext()
  // -----------------------------------------------------------------------

  /**
   * Build the context injection for Claude Code.
   *
   * Note: With settingSources enabled, the SDK loads CLAUDE.md automatically.
   * This method now only builds the Astro-specific append content
   * (vision doc, dependency context, working directory).
   */
  async prepareContext(context: TaskContext): Promise<PreparedContext> {
    const appendContent = buildAppendContent({
      baseInstructions: context.environment
        ? `## Execution Environment\n${context.environment}`
        : undefined,
      visionDoc: context.visionDoc,
      dependencyContext: context.dependencyContext,
      workingDirectory: context.workingDirectory,
    })

    if (!appendContent) {
      return { method: 'system_prompt' }
    }

    return {
      method: 'system_prompt',
      promptContent: appendContent,
    }
  }
}

// Export singleton instance
export const claudeCodeProvider = new ClaudeCodeProvider()

// ---------------------------------------------------------------------------
// Steering & resume functions (module-level exports)
// ---------------------------------------------------------------------------

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
    const { loadMcpConfig: loadMcp } = await import('../mcp-loader.js')
    let mcpServers: Record<string, unknown> | undefined = loadMcp(workingDirectory)

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

    // Build env with .env loading
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...loadDotEnv(workingDirectory),
      CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
    }

    const options: Options = {
      abortController,
      model: 'claude-sonnet-4-5-20250929',
      fallbackModel: 'sonnet',
      maxTurns: 100,
      permissionMode: 'bypassPermissions' as const,
      settingSources: ['user' as const, 'project' as const, 'local' as const],
      systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const },
      cwd: workingDirectory,
      env,
      resume: sessionId,
      ...(mcpServers ? { mcpServers } : {}),
    }

    const gen = query({ prompt: message, options })

    let newSessionId = sessionId
    const toolUseIdToName = new Map<string, string>()

    for await (const msg of gen) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        newSessionId = msg.session_id
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
            toolUseIdToName.set(block.id, block.name)
            yield { type: 'tool_use', taskId, toolName: block.name, toolInput: block.input, toolUseId: block.id, timestamp: new Date() }
          }
        }
      } else if (msg.type === 'user') {
        const content = Array.isArray(msg.message?.content) ? msg.message.content : []
        for (const block of content) {
          if ((block as Record<string, unknown>).type === 'tool_result') {
            const toolResult = block as Record<string, unknown>
            const tuId = toolResult.tool_use_id as string
            yield {
              type: 'tool_result',
              taskId,
              toolName: toolUseIdToName.get(tuId) ?? 'unknown',
              success: !toolResult.is_error,
              result: typeof toolResult.content === 'string'
                ? toolResult.content.slice(0, 100000)
                : JSON.stringify(toolResult.content).slice(0, 100000),
              toolUseId: tuId,
              timestamp: new Date(),
            }
          }
        }
      } else if (msg.type === 'result') {
        newSessionId = msg.session_id

        const msgAny = msg as unknown as Record<string, unknown>
        // Use same extraction logic as ClaudeCodeProvider.extractResultMetrics
        const metrics: Partial<TaskMetrics> = {}
        const modelUsage = msgAny.modelUsage as Record<string, {
          inputTokens?: number; outputTokens?: number
          cacheReadInputTokens?: number; cacheCreationInputTokens?: number
        }> | undefined
        if (modelUsage) {
          let totalIn = 0, totalOut = 0, totalCacheRead = 0, totalCacheCreate = 0
          for (const mu of Object.values(modelUsage)) {
            totalIn += mu.inputTokens ?? 0
            totalOut += mu.outputTokens ?? 0
            totalCacheRead += mu.cacheReadInputTokens ?? 0
            totalCacheCreate += mu.cacheCreationInputTokens ?? 0
          }
          metrics.inputTokens = totalIn + totalCacheRead + totalCacheCreate
          metrics.outputTokens = totalOut
          metrics.tokensUsed = metrics.inputTokens + metrics.outputTokens
        } else {
          const usage = msgAny.usage as Record<string, number> | undefined
          if (usage) {
            metrics.inputTokens = usage.input_tokens
            metrics.outputTokens = usage.output_tokens
            metrics.tokensUsed = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
          }
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
    const existing = activeQueries.get(taskId)
    if (existing) existing.query = null
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
