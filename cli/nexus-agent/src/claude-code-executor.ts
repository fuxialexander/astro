/**
 * Claude Code Executor
 *
 * Executes tasks using the Claude Agent SDK (Claude Code).
 * Handles streaming output, tool traces, and file changes.
 */

import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as os from 'os'

export interface ClaudeCodeInfo {
  available: boolean
  version?: string
  path?: string
  authStatus?: 'authenticated' | 'unauthenticated' | 'unknown'
}

export interface TaskDispatch {
  taskId: string
  projectId: string
  nodeId: string
  title: string
  description: string
  visionDoc?: string
  environment: string
  preferredProvider?: string
  timeout?: number
  workingDirectory?: string
  dependencies?: string[]
  metadata?: Record<string, string>
}

export interface TaskExecutionResult {
  status: 'completed' | 'failed' | 'cancelled' | 'timeout'
  exitCode?: number
  output?: string
  error?: string
  duration?: number
}

export interface ExecutionCallbacks {
  onOutput?: (stream: 'stdout' | 'stderr', data: string) => void
  onProgress?: (progress: number, message?: string) => void
  onToolTrace?: (toolName: string, toolInput: unknown, toolResult?: unknown, success?: boolean, duration?: number) => void
  onFileChange?: (path: string, action: 'created' | 'modified' | 'deleted', linesAdded?: number, linesRemoved?: number) => void
}

/**
 * Detect Claude Code CLI availability
 */
export async function detectClaudeCode(): Promise<ClaudeCodeInfo> {
  try {
    // Check if claude command is available
    const result = await runCommand('claude', ['--version'])

    if (result.exitCode === 0) {
      // Parse version from output
      const versionMatch = result.stdout.match(/(\d+\.\d+\.\d+)/)
      const version = versionMatch ? versionMatch[1] : 'unknown'

      // Check authentication status
      let authStatus: 'authenticated' | 'unauthenticated' | 'unknown' = 'unknown'
      try {
        const authResult = await runCommand('claude', ['auth', 'status'], 5000)
        if (authResult.exitCode === 0 && authResult.stdout.includes('authenticated')) {
          authStatus = 'authenticated'
        } else {
          authStatus = 'unauthenticated'
        }
      } catch {
        authStatus = 'unknown'
      }

      return {
        available: true,
        version,
        path: 'claude',
        authStatus,
      }
    }

    return { available: false }
  } catch {
    return { available: false }
  }
}

/**
 * Claude Code Executor
 *
 * Executes tasks using Claude Code CLI in a subprocess.
 * This allows for better process isolation and control.
 */
export class ClaudeCodeExecutor {
  private activeTasks: Map<string, ChildProcess> = new Map()
  private info: ClaudeCodeInfo

  constructor(info: ClaudeCodeInfo) {
    this.info = info
  }

  /**
   * Execute a task using Claude Code
   */
  async execute(
    task: TaskDispatch,
    callbacks: ExecutionCallbacks
  ): Promise<TaskExecutionResult> {
    const startTime = Date.now()

    if (!this.info.available) {
      return {
        status: 'failed',
        error: 'Claude Code is not available on this machine',
      }
    }

    // Build the prompt
    const promptParts: string[] = []

    if (task.visionDoc) {
      promptParts.push(`## Project Vision\n\n${task.visionDoc}`)
    }

    if (task.dependencies && task.dependencies.length > 0) {
      promptParts.push(`## Previous Task Context\n\n${task.dependencies.join('\n\n---\n\n')}`)
    }

    promptParts.push(`## Current Task\n\n**${task.title}**\n\n${task.description}`)

    promptParts.push(`## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered
- Verify your work when possible
- Be thorough but efficient`)

    const prompt = promptParts.join('\n\n---\n\n')

    // Determine working directory
    const workingDir = task.workingDirectory || process.cwd()

    try {
      // Create a temporary file with the prompt to avoid shell escaping issues
      const promptFile = path.join(os.tmpdir(), `nexus-task-${task.taskId}.txt`)
      await fs.writeFile(promptFile, prompt, 'utf-8')

      // Run Claude Code CLI with the prompt file
      const result = await this.runClaudeCode(
        task.taskId,
        promptFile,
        workingDir,
        task.timeout || 600000, // 10 minutes default
        callbacks
      )

      // Clean up prompt file
      try {
        await fs.unlink(promptFile)
      } catch {
        // Ignore cleanup errors
      }

      return {
        status: result.exitCode === 0 ? 'completed' : 'failed',
        exitCode: result.exitCode,
        output: result.stdout,
        error: result.stderr || (result.exitCode !== 0 ? 'Task failed' : undefined),
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * Run Claude Code CLI
   */
  private async runClaudeCode(
    taskId: string,
    promptFile: string,
    workingDir: string,
    timeout: number,
    callbacks: ExecutionCallbacks
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let progressEmitted = false

      // Use claude CLI in non-interactive mode
      // Read prompt from file to avoid shell escaping issues
      const args = [
        '--print',          // Print output instead of interactive mode
        '--dangerously-skip-permissions', // Skip permission prompts for automation
        '-p', `$(cat "${promptFile}")`,   // Read prompt from file
      ]

      const child = spawn('claude', args, {
        cwd: workingDir,
        shell: true,
        env: {
          ...process.env,
          // Ensure non-interactive mode
          CI: 'true',
          CLAUDE_CODE_HEADLESS: '1',
        },
      })

      this.activeTasks.set(taskId, child)

      // Set timeout
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM')
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL')
          }
        }, 5000)
        reject(new Error('Task timed out'))
      }, timeout)

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        callbacks.onOutput?.('stdout', text)

        // Parse output for progress indicators
        if (!progressEmitted && text.length > 0) {
          callbacks.onProgress?.(10, 'Claude Code started processing')
          progressEmitted = true
        }

        // Try to detect tool usage patterns in output
        this.parseToolUsage(text, callbacks)

        // Try to detect file changes
        this.parseFileChanges(text, callbacks)
      })

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderr += text
        callbacks.onOutput?.('stderr', text)
      })

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        this.activeTasks.delete(taskId)
        callbacks.onProgress?.(100, 'Task completed')
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
        })
      })

      child.on('error', (error) => {
        clearTimeout(timeoutId)
        this.activeTasks.delete(taskId)
        reject(error)
      })
    })
  }

  /**
   * Parse tool usage from Claude Code output
   */
  private parseToolUsage(text: string, callbacks: ExecutionCallbacks): void {
    // Look for common tool usage patterns in Claude Code output
    // Tool use patterns: "Using tool: <name>", "Tool result:", etc.
    const toolUseMatch = text.match(/(?:Using tool|Calling|Tool):\s*(\w+)/i)
    if (toolUseMatch) {
      callbacks.onToolTrace?.(toolUseMatch[1], {}, undefined, undefined, undefined)
    }

    // Look for Read/Write/Edit tool patterns
    const readMatch = text.match(/Reading (?:file )?[`"]?([^`"\n]+)[`"]?/i)
    if (readMatch) {
      callbacks.onToolTrace?.('Read', { file_path: readMatch[1] }, undefined, true, undefined)
    }

    const writeMatch = text.match(/(?:Writing|Creating) (?:file )?[`"]?([^`"\n]+)[`"]?/i)
    if (writeMatch) {
      callbacks.onToolTrace?.('Write', { file_path: writeMatch[1] }, undefined, true, undefined)
      callbacks.onFileChange?.(writeMatch[1], 'created', undefined, undefined)
    }

    const editMatch = text.match(/(?:Editing|Modifying) (?:file )?[`"]?([^`"\n]+)[`"]?/i)
    if (editMatch) {
      callbacks.onToolTrace?.('Edit', { file_path: editMatch[1] }, undefined, true, undefined)
      callbacks.onFileChange?.(editMatch[1], 'modified', undefined, undefined)
    }

    // Look for Bash command execution
    const bashMatch = text.match(/(?:Running|Executing):\s*[`"]?(.+?)[`"]?$/im)
    if (bashMatch) {
      callbacks.onToolTrace?.('Bash', { command: bashMatch[1] }, undefined, undefined, undefined)
    }
  }

  /**
   * Parse file changes from output
   */
  private parseFileChanges(text: string, callbacks: ExecutionCallbacks): void {
    // Look for file change indicators
    const patterns = [
      { regex: /Created (?:file )?[`"]?([^`"\n]+)[`"]?/gi, action: 'created' as const },
      { regex: /Modified (?:file )?[`"]?([^`"\n]+)[`"]?/gi, action: 'modified' as const },
      { regex: /Deleted (?:file )?[`"]?([^`"\n]+)[`"]?/gi, action: 'deleted' as const },
    ]

    for (const { regex, action } of patterns) {
      let match
      while ((match = regex.exec(text)) !== null) {
        callbacks.onFileChange?.(match[1], action, undefined, undefined)
      }
    }
  }

  /**
   * Cancel a running task
   */
  async cancel(taskId: string): Promise<boolean> {
    const child = this.activeTasks.get(taskId)
    if (child) {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL')
        }
      }, 5000)
      this.activeTasks.delete(taskId)
      return true
    }
    return false
  }

  /**
   * Cancel all running tasks
   */
  async cancelAll(): Promise<void> {
    for (const [, child] of this.activeTasks) {
      child.kill('SIGTERM')
    }
    // Wait a bit and force kill any remaining
    await new Promise(resolve => setTimeout(resolve, 5000))
    for (const [, child] of this.activeTasks) {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }
    this.activeTasks.clear()
  }
}

/**
 * Helper to run a command and capture output
 */
async function runCommand(
  cmd: string,
  args: string[],
  timeout = 10000
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(cmd, args, { shell: true })

    const timeoutId = setTimeout(() => {
      child.kill()
      reject(new Error('Command timed out'))
    }, timeout)

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })

    child.on('error', (error) => {
      clearTimeout(timeoutId)
      reject(error)
    })
  })
}
