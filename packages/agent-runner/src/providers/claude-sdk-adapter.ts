/**
 * Claude Agent SDK Adapter
 *
 * Executes tasks using the @anthropic-ai/claude-agent-sdk.
 * Runs in-process with zero serialization overhead.
 * Supports mid-execution steering via Query.streamInput().
 */

import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Task, TaskResult, TaskArtifact } from '../types.js';
import type { ProviderAdapter, TaskOutputStream, ProviderStatus } from './base-adapter.js';
import { buildHpcContext, type HpcContext } from '../lib/hpc-context.js';
import type { SlurmJobMonitor } from '../lib/slurm-job-monitor.js';
import { config } from '../lib/config.js';

/** Active query state for a running task */
interface ActiveQuery {
  query: Query;
  sessionId: string;
}

export class ClaudeSdkAdapter implements ProviderAdapter {
  readonly type = 'claude-sdk';
  readonly name = 'Claude Agent SDK';

  private activeTasks = 0;
  private maxTasks = 4; // SDK supports concurrent tasks
  private lastError?: string;
  private isAuthenticated = false;
  private model = 'unknown';

  /** Active Query instances per task ID for steering */
  private activeQueries = new Map<string, ActiveQuery>();

  /** Lazily-initialized HPC context (undefined = not checked, null = not available) */
  private hpcContext: HpcContext | null | undefined = undefined;

  /** Optional Slurm job monitor for tracking sbatch submissions */
  private jobMonitor?: SlurmJobMonitor;

  /**
   * Set a SlurmJobMonitor for tracking batch job submissions.
   * Call this before executing tasks if HPC support is desired.
   */
  setJobMonitor(monitor: SlurmJobMonitor): void {
    this.jobMonitor = monitor;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const abortController = new AbortController();

      // Minimal prompt to check authentication
      const gen = query({
        prompt: 'respond with ok',
        options: {
          abortController,
          maxTurns: 1,
          permissionMode: 'plan',
          tools: [],
          persistSession: false,
        },
      });

      for await (const msg of gen) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.model = msg.model;
          this.isAuthenticated = true;
          abortController.abort();
          break;
        }
        if (msg.type === 'result') {
          this.isAuthenticated = true;
          break;
        }
      }

      return this.isAuthenticated;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.lastError = message;
      return false;
    }
  }

  async execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult> {
    this.activeTasks++;
    const startedAt = new Date().toISOString();

    // Create an abort controller that respects the signal
    const abortController = new AbortController();
    const abortHandler = () => abortController.abort();
    signal.addEventListener('abort', abortHandler);

    try {
      stream.status('running', 0, 'Starting Claude Agent SDK');

      const result = await this.runQuery(task, stream, abortController);

      return {
        taskId: task.id,
        status: result.success ? 'completed' : 'failed',
        exitCode: result.success ? 0 : 1,
        output: result.output,
        error: result.error,
        startedAt,
        completedAt: new Date().toISOString(),
        artifacts: result.artifacts,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.lastError = errorMsg;

      const isAbort = error instanceof Error && error.name === 'AbortError';

      if (signal.aborted || isAbort) {
        return {
          taskId: task.id,
          status: 'cancelled',
          error: 'Task cancelled',
          startedAt,
          completedAt: new Date().toISOString(),
        };
      }

      return {
        taskId: task.id,
        status: 'failed',
        error: errorMsg,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } finally {
      signal.removeEventListener('abort', abortHandler);
      this.activeQueries.delete(task.id);
      this.activeTasks--;
    }
  }

  /**
   * Inject a steering message into a running task's session.
   * Uses Query.streamInput() to feed a new user message into the running query.
   * When interrupt=true, calls Query.interrupt() first to stop the current turn.
   * Returns true if the message was successfully injected.
   */
  async injectMessage(taskId: string, content: string, interrupt = false): Promise<boolean> {
    const active = this.activeQueries.get(taskId);
    if (!active) return false;

    if (interrupt) {
      // Fire interrupt without awaiting — interrupt() may block until the
      // current turn finishes, which can take a long time.  We don't need
      // to wait for it; the SDK will process the interrupt and streamInput
      // in order internally.
      active.query.interrupt().catch(() => {
        /* agent may be idle between turns */
      });

      // Small delay to let the interrupt signal propagate before injecting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Create a single-message async iterable with proper SDKUserMessage shape
    const message = {
      type: 'user' as const,
      message: {
        role: 'user' as const,
        content,
      },
      parent_tool_use_id: null,
      session_id: active.sessionId,
    };

    // Single-shot async iterable
    const iterable = {
      async *[Symbol.asyncIterator]() {
        yield message;
      },
    };

    // streamInput returns a Promise — fire and forget
    active.query.streamInput(iterable).catch((err: Error) => {
      console.error(`[claude-sdk] Failed to inject steer message for task ${taskId}:`, err.message);
    });

    return true;
  }

  async getStatus(): Promise<ProviderStatus> {
    const available = this.isAuthenticated || (await this.isAvailable());

    return {
      available,
      version: this.model,
      activeTasks: this.activeTasks,
      maxTasks: this.maxTasks,
      lastError: this.lastError,
    };
  }

  private async runQuery(
    task: Task,
    stream: TaskOutputStream,
    abortController: AbortController
  ): Promise<{
    success: boolean;
    output: string;
    error?: string;
    artifacts?: TaskArtifact[];
  }> {
    // Ensure CLAUDE_CONFIG_DIR points to a user-writable location.
    // The SDK derives internal storage paths from cwd, and /tmp/claude/ may be
    // owned by another user on shared machines, causing EACCES errors.
    if (!process.env.CLAUDE_CONFIG_DIR) {
      process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.claude');
    }

    // Enable SDK debug logging to diagnose MCP connection issues
    process.env.DEBUG_SDK = '1';
    process.env.CLAUDE_CODE_DEBUG_LOGS_DIR = join(homedir(), '.astro', 'logs', 'sdk-debug');

    // NOTE: We intentionally do NOT call process.chdir() here.
    // process.cwd() is global state shared across concurrent tasks, so calling
    // chdir() creates race conditions where one task captures another's worktree
    // path as its "original cwd", then fails to restore when that worktree is
    // cleaned up. The SDK's `cwd` option (line below) handles per-query working
    // directory correctly without mutating global state.

    // Determine appropriate maxTurns based on task type
    const defaultMaxTurns = (task.type === 'chat' || task.type === 'summarize') ? 10 : 150;

    // Build options for the query
    const options: Parameters<typeof query>[0]['options'] = {
      abortController,
      maxTurns: task.maxTurns ?? defaultMaxTurns,
      permissionMode: 'bypassPermissions', // Auto-accept all tool calls
      sandbox: { enabled: false }, // Run on host machine, not in Docker container
      settingSources: [], // Don't load settings from project - worktree is empty
      persistSession: false,
      cwd: task.workingDirectory,
      additionalDirectories: [task.workingDirectory], // Allow file operations in worktree
      env: {
        ...process.env,
        ...task.environment,
        CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1', // Enable additional directories for CLAUDE.md loading
      },
      // Intercept built-in AskUserQuestion to handle approvals (following Cyrus pattern)
      canUseTool: async (toolName: string, input: Record<string, unknown>, options: { toolUseID: string; signal: AbortSignal }) => {
        if (toolName === 'AskUserQuestion') {
          console.log(`[claude-sdk] Intercepted AskUserQuestion (toolUseID: ${options.toolUseID})`);

          // Validate input structure
          const askInput = input as { questions?: Array<{ question: string; options: Array<{ label: string; description?: string }> }> };
          if (!askInput.questions || !Array.isArray(askInput.questions)) {
            console.error('[claude-sdk] Invalid AskUserQuestion input: questions array missing');
            return {
              behavior: 'deny' as const,
              message: 'Invalid AskUserQuestion input: questions array is required',
            };
          }

          // Only support one question at a time (following Cyrus pattern)
          if (askInput.questions.length !== 1) {
            console.log(`[claude-sdk] Rejecting AskUserQuestion with ${askInput.questions.length} questions (only 1 allowed)`);
            return {
              behavior: 'deny' as const,
              message: 'Only one question at a time is supported. Please ask each question separately.',
            };
          }

          const question = askInput.questions[0];
          const optionLabels = question.options.map(opt => opt.label);

          try {
            console.log(`[claude-sdk] Requesting approval from user: "${question.question}"`);

            // Call the approval request handler (emits event and waits for response)
            const result = await stream.approvalRequest(question.question, optionLabels);

            if (result.answered && result.answer) {
              console.log(`[claude-sdk] User approved with answer: "${result.answer}"`);

              // Return the answer via updatedInput (SDK will see this as the tool result)
              return {
                behavior: 'allow' as const,
                updatedInput: {
                  questions: askInput.questions,
                  answers: { [question.question]: result.answer },
                },
              };
            } else {
              console.log(`[claude-sdk] User denied approval: ${result.message || 'No response'}`);
              return {
                behavior: 'deny' as const,
                message: result.message || 'User did not respond to the question',
              };
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[claude-sdk] Error handling approval request: ${errorMessage}`);
            return {
              behavior: 'deny' as const,
              message: `Failed to get user approval: ${errorMessage}`,
            };
          }
        }

        // Allow all other tools
        return { behavior: 'allow' as const, updatedInput: input };
      },
    };

    // Lazily initialize HPC context on first query
    if (this.hpcContext === undefined) {
      try {
        this.hpcContext = await buildHpcContext();
        if (this.hpcContext.available) {
          console.log(`[claude-sdk] HPC context loaded (cluster: ${this.hpcContext.slurmInfo?.clusterName ?? 'unknown'})`);
        }
      } catch {
        this.hpcContext = null;
      }
    }

    // Prepend HPC context to prompt if available
    let effectivePrompt = task.prompt;
    if (this.hpcContext?.available) {
      effectivePrompt = this.hpcContext.contextString + '\n\n---\n\n' + task.prompt;
    }

    // Add structured output format if requested (e.g., plan generation)
    if (task.outputFormat) {
      (options as Record<string, unknown>).outputFormat = task.outputFormat;
    }

    // Apply system prompt if provided (new relay protocol field)
    // This keeps system instructions separate from user content.
    if (task.systemPrompt) {
      (options as Record<string, unknown>).systemPrompt = task.systemPrompt;
    }

    // Apply explicit model selection if provided (new relay protocol field)
    if (task.model) {
      (options as Record<string, unknown>).model = task.model;
    }

    // Load MCP servers from config if available
    const agentConfig = config.getConfig();
    console.log(`[claude-sdk] Agent config loaded:`, JSON.stringify(agentConfig, null, 2));
    console.log(`[claude-sdk] mcpServers present:`, !!agentConfig.mcpServers);
    console.log(`[claude-sdk] mcpServers keys:`, agentConfig.mcpServers ? Object.keys(agentConfig.mcpServers) : 'N/A');
    if (agentConfig.mcpServers && Object.keys(agentConfig.mcpServers).length > 0) {
      console.log(`[claude-sdk] Loading ${Object.keys(agentConfig.mcpServers).length} MCP server(s): ${Object.keys(agentConfig.mcpServers).join(', ')}`);

      // Inject execution ID into MCP server environment variables
      const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
      for (const [name, serverConfig] of Object.entries(agentConfig.mcpServers)) {
        const server = serverConfig as { command: string; args: string[]; env?: Record<string, string> };
        mcpServers[name] = {
          ...server,
          env: {
            ...server.env,
            ASTRO_EXECUTION_ID: task.id, // Inject current task ID for approval routing
          },
        };
      }

      (options as Record<string, unknown>).mcpServers = mcpServers;

      // Allow all MCP tools from configured servers
      const allowedTools = Object.keys(mcpServers).map(name => `mcp__${name}__*`);
      (options as Record<string, unknown>).allowedTools = allowedTools;
      console.log(`[claude-sdk] Allowed MCP tools:`, allowedTools);
    }

    // Build the prompt: use messages array if provided (chat tasks), otherwise flat string
    // The messages field carries multi-turn conversation history from chat endpoints,
    // preserving role structure (user/assistant turns) that would be lost with a flat string.
    let queryPrompt: string | AsyncIterable<{ role: 'user'; content: string }>;
    if (task.messages && task.messages.length > 0) {
      // For chat tasks with conversation history, build the prompt by appending
      // the conversation history to the effective prompt. The last user message
      // is the actual query; prior messages provide context.
      const conversationContext = task.messages
        .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
        .join('\n\n');
      queryPrompt = effectivePrompt
        ? `${effectivePrompt}\n\n---\n\nConversation history:\n${conversationContext}`
        : conversationContext;
    } else {
      queryPrompt = effectivePrompt;
    }

    const gen = query({
      prompt: queryPrompt,
      options,
    });

    let output = '';
    let success = true;
    let errorMessage: string | undefined;
    const artifacts: TaskArtifact[] = [];
    let progress = 0;

    for await (const msg of gen) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        this.model = msg.model;
        const sessionId = (msg as unknown as Record<string, unknown>).session_id as string ?? '';
        stream.status('running', 5, `Model: ${msg.model}`);
        stream.sessionInit(sessionId, msg.model);

        // Store the query instance for steering
        this.activeQueries.set(task.id, { query: gen, sessionId });
      } else if (msg.type === 'assistant') {
        // Stream assistant content blocks
        for (const block of msg.message.content) {
          if (typeof block === 'string') continue;
          if (block.type === 'text') {
            output += block.text;
            stream.text(block.text);
          } else if (block.type === 'tool_use') {
            // Emit structured tool use
            progress = Math.min(progress + 10, 90);
            stream.status('running', progress, `Using tool: ${block.name}`);
            stream.toolUse(block.name, block.input);

            // Record file operations as artifacts
            if (block.name === 'Write' || block.name === 'Edit') {
              const input = block.input as Record<string, unknown>;
              if (input.file_path) {
                artifacts.push({
                  type: 'file',
                  name: String(input.file_path),
                  path: String(input.file_path),
                  metadata: { tool: block.name },
                });
                // Emit file change event
                const action = block.name === 'Write' ? 'created' : 'modified';
                stream.fileChange(String(input.file_path), action as 'created' | 'modified' | 'deleted');
              }
            }
          }
        }
      } else if (msg.type === 'user') {
        // Tool results from the SDK
        for (const block of msg.message.content) {
          if (typeof block === 'string') continue;
          if (block.type === 'tool_result') {
            const resultContent = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
            const isError = block.is_error ?? false;
            stream.toolResult(
              block.tool_use_id ?? 'unknown',
              resultContent,
              !isError,
            );

            // Detect sbatch submissions for job tracking
            if (this.jobMonitor && typeof resultContent === 'string') {
              const sbatchMatch = resultContent.match(/Submitted batch job (\d+)/);
              if (sbatchMatch) {
                const jobId = sbatchMatch[1];
                // Try to extract output path from sbatch script (common pattern: --output=...)
                const outputMatch = resultContent.match(/--output[= ](\S+)/);
                const outputPath = outputMatch?.[1]?.replace('%j', jobId);
                this.jobMonitor.trackJob(jobId, task.id, task.planNodeId, outputPath);
                console.log(`[claude-sdk] Detected sbatch submission: job ${jobId}`);
              }
            }
          }
        }
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          success = true;
          stream.status('completed', 100, 'Task completed successfully');

          // Capture structured output (produced when outputFormat is set)
          const msgAny = msg as Record<string, unknown>;
          if (msgAny.structured_output) {
            const jsonStr = JSON.stringify(msgAny.structured_output);
            output += jsonStr;
            stream.text(jsonStr);
          } else if (msgAny.result && !output) {
            // Fallback: capture result text if no output was accumulated
            const resultStr = typeof msgAny.result === 'string'
              ? msgAny.result
              : JSON.stringify(msgAny.result);
            output += resultStr;
            stream.text(resultStr);
          }
        } else if (
          msg.subtype === 'error_during_execution' ||
          msg.subtype === 'error_max_turns' ||
          msg.subtype === 'error_max_budget_usd' ||
          msg.subtype === 'error_max_structured_output_retries'
        ) {
          success = false;
          errorMessage = `Task failed: ${msg.subtype}`;
          stream.status('failed', progress, errorMessage);
        }
        break;
      }
    }

    return {
      success,
      output,
      error: errorMessage,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    };
  }
}
