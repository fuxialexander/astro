/**
 * OpenAI Codex Provider Adapter
 *
 * Implements the AgentProvider interface for OpenAI Codex CLI.
 * This adapter translates Nexus task dispatches into Codex CLI invocations.
 *
 * Key characteristics:
 * - Spawns Codex CLI as external process
 * - Context injection via prompt prefix (Codex has no native --context-file)
 * - Parses structured output from CLI JSON mode
 * - Supports cancellation via process termination
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
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
  FileChange,
  StructuredOutput,
} from '../types.js'
import { errorMessage } from '../../error-utils.js'

const execAsync = promisify(exec)

// Map of active tasks for cancellation
const activeTasks = new Map<string, { process: ChildProcess; abortController: AbortController }>()

/**
 * Common installation paths for Codex CLI
 */
function getCodexPaths(): string[] {
  const home = homedir()
  const platform = process.platform

  const paths: string[] = []

  // npm global installs
  paths.push(join(home, '.npm', 'bin', 'codex'))
  paths.push(join(home, '.npm-global', 'bin', 'codex'))
  paths.push(join(home, '.local', 'bin', 'codex'))

  // Platform-specific paths
  if (platform === 'darwin') {
    // macOS: Homebrew and user local
    paths.push('/usr/local/bin/codex')
    paths.push('/opt/homebrew/bin/codex')
  } else if (platform === 'win32') {
    // Windows: AppData locations
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    paths.push(join(appData, 'npm', 'codex.cmd'))
    paths.push(join(appData, 'npm', 'codex'))
  } else {
    // Linux: Standard locations
    paths.push('/usr/local/bin/codex')
    paths.push('/usr/bin/codex')
  }

  return paths
}

/**
 * Check if a file exists and is executable
 */
async function fileExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Check if a command exists in PATH
 */
async function commandExists(command: string): Promise<string | null> {
  try {
    const platform = process.platform
    const checkCommand = platform === 'win32' ? `where ${command}` : `which ${command}`
    const { stdout } = await execAsync(checkCommand, { timeout: 5000 })
    return stdout.trim().split('\n')[0] ?? null
  } catch {
    return null
  }
}

/**
 * Get the version of the Codex CLI
 */
async function getCodexVersion(codexPath: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`"${codexPath}" --version`, { timeout: 5000 })
    // Extract version number from output
    const versionMatch = stdout.match(/(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)/)
    return versionMatch?.[1] ?? stdout.trim().split('\n')[0] ?? null
  } catch {
    return null
  }
}

/**
 * OpenAI Codex provider adapter.
 * Wraps the OpenAI Codex CLI for use with the Nexus provider abstraction.
 */
export class CodexProvider implements AgentProvider {
  readonly id = 'codex'
  readonly name = 'OpenAI Codex'

  private cachedDetection: ProviderDetectionResult | null = null
  private codexPath: string | null = null

  /**
   * Probe whether Codex CLI is installed and available.
   */
  async detect(): Promise<ProviderDetectionResult> {
    try {
      // First check if 'codex' is in PATH
      const pathResult = await commandExists('codex')
      if (pathResult) {
        this.codexPath = pathResult
        const version = await getCodexVersion(pathResult)

        this.cachedDetection = {
          installed: true,
          version: version ?? undefined,
          executablePath: pathResult,
          authStatus: 'unknown', // Codex auth is checked at runtime via OPENAI_API_KEY
          message: 'Codex CLI found in PATH',
          detectedAt: new Date(),
        }

        return this.cachedDetection
      }

      // Check common installation paths
      const commonPaths = getCodexPaths()
      for (const codexPath of commonPaths) {
        const isExecutable = await fileExecutable(codexPath)
        if (isExecutable) {
          this.codexPath = codexPath
          const version = await getCodexVersion(codexPath)

          this.cachedDetection = {
            installed: true,
            version: version ?? undefined,
            executablePath: codexPath,
            authStatus: 'unknown',
            message: `Codex CLI found at ${codexPath}`,
            detectedAt: new Date(),
          }

          return this.cachedDetection
        }
      }

      // Codex not found
      this.cachedDetection = {
        installed: false,
        authStatus: 'unknown',
        message: 'Codex CLI not found. Install via: npm install -g @openai/codex',
        detectedAt: new Date(),
      }

      return this.cachedDetection
    } catch (error) {
      const message = errorMessage(error)

      this.cachedDetection = {
        installed: false,
        authStatus: 'unknown',
        message: `Error detecting Codex: ${message}`,
        detectedAt: new Date(),
      }

      return this.cachedDetection
    }
  }

  /**
   * Declare Codex capabilities.
   */
  capabilities(): ProviderCapabilities {
    return {
      providerId: this.id,
      name: this.name,
      languages: ['*'], // Codex supports all languages
      taskTypes: [
        'code_generation',
        'code_review',
        'code_analysis',
        'test_generation',
        'documentation',
        'refactoring',
        'bug_fix',
        'chat',
        'general',
      ],
      maxContextTokens: 128000, // GPT-4 context window
      supportsStreaming: true,
      supportsCancellation: true,
      availableModels: [
        'gpt-4o',
        'gpt-4o-mini',
        'o1',
        'o1-mini',
        'o3-mini',
      ],
      defaultModel: 'gpt-4o',
      contextInjectionMethod: 'prompt_prefix', // Codex uses prompt prefix for context
      supportsSessionResume: false, // Codex CLI doesn't support session resumption
      maxTurns: 1, // Single-turn by default
    }
  }

  /**
   * Execute a task and return a structured result.
   */
  async execute(task: TaskDispatch): Promise<TaskResult> {
    const startTime = Date.now()
    const abortController = task.abortController ?? new AbortController()

    // Ensure Codex is available
    if (!this.codexPath) {
      const detection = await this.detect()
      if (!detection.installed) {
        return {
          taskId: task.taskId,
          status: 'error',
          errorMessage: detection.message ?? 'Codex CLI not found',
          metrics: { durationMs: Date.now() - startTime },
          providerId: this.id,
          completedAt: new Date(),
        }
      }
    }

    try {
      // Prepare context
      const preparedContext = await this.prepareContext(task.context)

      // Build the full prompt with context
      let fullPrompt = task.prompt
      if (preparedContext.method === 'prompt_prefix' && preparedContext.promptContent) {
        fullPrompt = `${preparedContext.promptContent}\n\n---\n\nTask:\n${task.prompt}`
      }

      // Execute Codex CLI
      const result = await this.runCodex(task.taskId, fullPrompt, task, abortController)

      const durationMs = Date.now() - startTime

      return {
        taskId: task.taskId,
        status: result.status,
        output: result.output,
        stdout: result.stdout,
        stderr: result.stderr,
        filesChanged: result.filesChanged,
        metrics: {
          durationMs,
          model: task.model ?? 'gpt-4o',
          turnsUsed: 1,
        },
        verification: result.exitCode !== undefined ? { exitCode: result.exitCode } : undefined,
        errorMessage: result.errorMessage,
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
          model: task.model ?? 'gpt-4o',
        },
        providerId: this.id,
        completedAt: new Date(),
      }
    }
  }

  /**
   * Execute a task with streaming output.
   */
  async *stream(task: TaskDispatch): AsyncGenerator<StreamEvent, TaskResult, undefined> {
    const startTime = Date.now()
    const abortController = task.abortController ?? new AbortController()

    // Ensure Codex is available
    if (!this.codexPath) {
      const detection = await this.detect()
      if (!detection.installed) {
        const errorResult: TaskResult = {
          taskId: task.taskId,
          status: 'error',
          errorMessage: detection.message ?? 'Codex CLI not found',
          metrics: { durationMs: Date.now() - startTime },
          providerId: this.id,
          completedAt: new Date(),
        }

        yield {
          type: 'error',
          taskId: task.taskId,
          error: detection.message ?? 'Codex CLI not found',
          recoverable: false,
          timestamp: new Date(),
        }

        return errorResult
      }
    }

    try {
      // Prepare context
      const preparedContext = await this.prepareContext(task.context)

      // Build the full prompt with context
      let fullPrompt = task.prompt
      if (preparedContext.method === 'prompt_prefix' && preparedContext.promptContent) {
        fullPrompt = `${preparedContext.promptContent}\n\n---\n\nTask:\n${task.prompt}`
      }

      // Emit init event
      yield {
        type: 'init',
        taskId: task.taskId,
        model: task.model ?? 'gpt-4o',
        sessionId: task.taskId, // Use taskId as session since Codex doesn't support resumption
        timestamp: new Date(),
      }

      // Stream from Codex CLI
      const streamGenerator = this.streamCodex(task.taskId, fullPrompt, task, abortController)

      let stdout = ''
      let stderr = ''
      let status: TaskStatus = 'success'
      let exitCode: number | undefined
      const filesChanged: FileChange[] = []

      for await (const event of streamGenerator) {
        if (event.type === 'stdout') {
          stdout += event.text
          yield {
            type: 'text',
            taskId: task.taskId,
            text: event.text,
            timestamp: new Date(),
          }

          // Check for file changes in output
          const fileChanges = this.extractFileChanges(event.text)
          for (const change of fileChanges) {
            if (!filesChanged.some(f => f.path === change.path)) {
              filesChanged.push(change)
              yield {
                type: 'file_change',
                taskId: task.taskId,
                change,
                timestamp: new Date(),
              }
            }
          }
        } else if (event.type === 'stderr') {
          stderr += event.text
        } else if (event.type === 'progress') {
          yield {
            type: 'progress',
            taskId: task.taskId,
            message: event.message,
            percentage: event.percentage,
            timestamp: new Date(),
          }
        } else if (event.type === 'exit') {
          exitCode = event.code
          status = event.code === 0 ? 'success' : 'failure'
        } else if (event.type === 'error') {
          status = 'error'
          stderr += event.message
        }
      }

      // Try to parse structured output from stdout
      const structuredOutput = this.parseStructuredOutput(stdout)

      const durationMs = Date.now() - startTime
      const metrics: TaskMetrics = {
        durationMs,
        model: task.model ?? 'gpt-4o',
        turnsUsed: 1,
      }

      const result: TaskResult = {
        taskId: task.taskId,
        status,
        output: structuredOutput,
        stdout,
        stderr: stderr || undefined,
        filesChanged: filesChanged.length > 0 ? filesChanged : undefined,
        metrics,
        verification: exitCode !== undefined ? { exitCode } : undefined,
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
          model: task.model ?? 'gpt-4o',
        },
        providerId: this.id,
        completedAt: new Date(),
      }

      return result
    }
  }

  /**
   * Cancel a running task.
   */
  async cancel(taskId: string): Promise<boolean> {
    const taskInfo = activeTasks.get(taskId)
    if (taskInfo) {
      taskInfo.abortController.abort()

      // Gracefully terminate the process
      taskInfo.process.kill('SIGTERM')

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!taskInfo.process.killed) {
          taskInfo.process.kill('SIGKILL')
        }
      }, 5000)

      activeTasks.delete(taskId)
      return true
    }
    return false
  }

  /**
   * Build the context injection for Codex.
   * Codex uses prompt prefix for context injection.
   */
  async prepareContext(context: TaskContext): Promise<PreparedContext> {
    const parts: string[] = []

    // Add vision doc
    if (context.visionDoc) {
      parts.push(`## Project Vision Document\n\n${context.visionDoc}`)
    }

    // Add dependency context
    if (context.dependencyContext) {
      parts.push(`## Dependency Context\n\n${context.dependencyContext}`)
    }

    // Add working directory info
    if (context.workingDirectory) {
      parts.push(`## Working Directory\n\n${context.workingDirectory}`)
    }

    // Add environment info
    if (context.environment) {
      parts.push(`## Execution Environment\n\n${context.environment}`)
    }

    if (parts.length === 0) {
      return { method: 'prompt_prefix' }
    }

    return {
      method: 'prompt_prefix',
      promptContent: parts.join('\n\n---\n\n'),
    }
  }

  /**
   * Run Codex CLI and collect result.
   */
  private runCodex(
    taskId: string,
    prompt: string,
    task: TaskDispatch,
    abortController: AbortController
  ): Promise<{
    status: TaskStatus
    stdout: string
    stderr?: string
    output?: StructuredOutput
    filesChanged?: FileChange[]
    exitCode?: number
    errorMessage?: string
  }> {
    return new Promise((resolve, reject) => {
      // Build CLI arguments
      const args = this.buildCodexArgs(task, prompt)

      const env = {
        ...process.env,
        ...task.context.environmentVariables,
      }

      let proc: ChildProcess

      try {
        proc = spawn(this.codexPath!, args, {
          cwd: task.context.workingDirectory,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (error) {
        reject(error)
        return
      }

      // Track for cancellation
      activeTasks.set(taskId, { process: proc, abortController })

      let stdout = ''
      let stderr = ''
      const filesChanged: FileChange[] = []

      const abortHandler = () => {
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL')
          }
        }, 5000)
      }

      abortController.signal.addEventListener('abort', abortHandler)

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text

        // Extract file changes
        const changes = this.extractFileChanges(text)
        for (const change of changes) {
          if (!filesChanged.some(f => f.path === change.path)) {
            filesChanged.push(change)
          }
        }
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('error', (error) => {
        abortController.signal.removeEventListener('abort', abortHandler)
        activeTasks.delete(taskId)
        reject(error)
      })

      proc.on('close', (code) => {
        abortController.signal.removeEventListener('abort', abortHandler)
        activeTasks.delete(taskId)

        const structuredOutput = this.parseStructuredOutput(stdout)

        resolve({
          status: abortController.signal.aborted ? 'cancelled' : (code === 0 ? 'success' : 'failure'),
          stdout,
          stderr: stderr || undefined,
          output: structuredOutput,
          filesChanged: filesChanged.length > 0 ? filesChanged : undefined,
          exitCode: code ?? undefined,
          errorMessage: code !== 0 && stderr ? stderr.trim() : undefined,
        })
      })

      // Write prompt to stdin if needed
      if (proc.stdin) {
        proc.stdin.end()
      }
    })
  }

  /**
   * Stream output from Codex CLI.
   */
  private async *streamCodex(
    taskId: string,
    prompt: string,
    task: TaskDispatch,
    abortController: AbortController
  ): AsyncGenerator<
    | { type: 'stdout'; text: string }
    | { type: 'stderr'; text: string }
    | { type: 'progress'; message: string; percentage?: number }
    | { type: 'exit'; code: number }
    | { type: 'error'; message: string }
  > {
    // Build CLI arguments
    const args = this.buildCodexArgs(task, prompt)

    const env = {
      ...process.env,
      ...task.context.environmentVariables,
    }

    let proc: ChildProcess

    try {
      proc = spawn(this.codexPath!, args, {
        cwd: task.context.workingDirectory,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      yield { type: 'error', message: errorMessage(error) }
      return
    }

    // Track for cancellation
    activeTasks.set(taskId, { process: proc, abortController })

    // Set up abort handler
    const abortHandler = () => {
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL')
        }
      }, 5000)
    }

    abortController.signal.addEventListener('abort', abortHandler)

    // Create promise-based interface for process events
    const processEnded = new Promise<number | null>((resolve, reject) => {
      proc.on('close', resolve)
      proc.on('error', reject)
    })

    // Buffer for collecting chunks
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []

    proc.stdout?.on('data', (data: Buffer) => {
      stdoutChunks.push(data.toString())
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderrChunks.push(data.toString())
    })

    // Close stdin
    if (proc.stdin) {
      proc.stdin.end()
    }

    // Poll for output
    const pollInterval = 100
    let lastStdoutIndex = 0
    let lastStderrIndex = 0

    try {
      while (true) {
        // Check if process has ended
        const exitCode = await Promise.race([
          processEnded,
          new Promise<'continue'>((resolve) => setTimeout(() => resolve('continue'), pollInterval)),
        ])

        // Yield any new stdout
        while (lastStdoutIndex < stdoutChunks.length) {
          yield { type: 'stdout', text: stdoutChunks[lastStdoutIndex]! }
          lastStdoutIndex++
        }

        // Yield any new stderr
        while (lastStderrIndex < stderrChunks.length) {
          yield { type: 'stderr', text: stderrChunks[lastStderrIndex]! }
          lastStderrIndex++
        }

        if (exitCode !== 'continue') {
          yield { type: 'exit', code: exitCode ?? 1 }
          break
        }

        if (abortController.signal.aborted) {
          yield { type: 'exit', code: -1 }
          break
        }
      }
    } finally {
      abortController.signal.removeEventListener('abort', abortHandler)
      activeTasks.delete(taskId)
    }
  }

  /**
   * Build Codex CLI arguments.
   */
  private buildCodexArgs(task: TaskDispatch, prompt: string): string[] {
    const args: string[] = []

    // Quiet mode to suppress interactive prompts
    args.push('--quiet')

    // Model selection if not default
    if (task.model) {
      args.push('--model', task.model)
    }

    // Full auto mode for non-interactive execution
    args.push('--full-auto')

    // Add the prompt
    args.push(prompt)

    return args
  }

  /**
   * Extract file changes from output.
   */
  private extractFileChanges(output: string): FileChange[] {
    const changes: FileChange[] = []

    // Common patterns indicating file creation/modification
    const patterns = [
      { regex: /Created file:\s*(.+)/gi, action: 'created' as const },
      { regex: /Writing to\s*(.+)/gi, action: 'created' as const },
      { regex: /Wrote\s+(.+)/gi, action: 'created' as const },
      { regex: /Modified:\s*(.+)/gi, action: 'modified' as const },
      { regex: /Updated:\s*(.+)/gi, action: 'modified' as const },
      { regex: /Deleted:\s*(.+)/gi, action: 'deleted' as const },
      { regex: /Removed:\s*(.+)/gi, action: 'deleted' as const },
      // JSON format patterns
      { regex: /"file":\s*"([^"]+)".*"action":\s*"(create|write)"/gi, action: 'created' as const },
      { regex: /"file":\s*"([^"]+)".*"action":\s*"(modify|update)"/gi, action: 'modified' as const },
      { regex: /"file":\s*"([^"]+)".*"action":\s*"(delete|remove)"/gi, action: 'deleted' as const },
    ]

    for (const { regex, action } of patterns) {
      let match
      while ((match = regex.exec(output)) !== null) {
        const filePath = match[1]?.trim()
        if (filePath && !changes.some(c => c.path === filePath)) {
          changes.push({
            path: filePath,
            action,
          })
        }
      }
    }

    return changes
  }

  /**
   * Parse structured output from stdout.
   */
  private parseStructuredOutput(stdout: string): StructuredOutput | undefined {
    // Try to find JSON blocks in output
    const jsonBlockMatch = stdout.match(/```json\n([\s\S]*?)\n```/)
    if (jsonBlockMatch?.[1]) {
      try {
        const data = JSON.parse(jsonBlockMatch[1])
        return { type: 'json', data }
      } catch {
        // Not valid JSON
      }
    }

    // Try to parse entire output as JSON
    const trimmed = stdout.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const data = JSON.parse(trimmed)
        return { type: 'json', data }
      } catch {
        // Not valid JSON
      }
    }

    // Look for newline-delimited JSON (streaming output)
    const lines = stdout.split('\n').filter(line => line.trim())
    const jsonLines: unknown[] = []
    for (const line of lines) {
      try {
        jsonLines.push(JSON.parse(line))
      } catch {
        // Not JSON, skip
      }
    }

    if (jsonLines.length > 0) {
      return { type: 'ndjson', data: jsonLines }
    }

    return undefined
  }
}

// Export singleton instance
export const codexProvider = new CodexProvider()
