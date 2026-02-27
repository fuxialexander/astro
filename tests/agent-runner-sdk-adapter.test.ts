/**
 * Verification tests for the agent runner's Claude SDK adapter
 * (packages/agent-runner/src/providers/claude-sdk-adapter.ts)
 *
 * These tests verify the adapter's source code implements the correct
 * patterns by reading the source and checking key behaviors. This approach
 * is necessary because the agent-runner has its own node_modules, making
 * cross-package vi.mock unreliable.
 *
 * Verifies:
 * - CLAUDE.md loading via settingSources
 * - Session preservation for post-completion steering
 * - Task type routing (maxTurns)
 * - System prompt and model selection
 * - Structured output format support
 * - MCP server loading and ASTRO_EXECUTION_ID injection
 * - Approval interception (AskUserQuestion)
 * - Conversation history handling
 * - Permission mode
 * - Abort/cancel handling
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ADAPTER_PATH = join(
  process.cwd(),
  'packages/agent-runner/src/providers/claude-sdk-adapter.ts',
)
const source = readFileSync(ADAPTER_PATH, 'utf-8')

// ============================================================================
// Source Code Verification Tests
// ============================================================================

describe('agent runner SDK adapter — CLAUDE.md loading', () => {
  it('uses settingSources with user, project, and local', () => {
    expect(source).toContain("settingSources: ['user', 'project', 'local']")
  })

  it('does NOT use empty settingSources', () => {
    expect(source).not.toContain('settingSources: []')
  })
})

describe('agent runner SDK adapter — session preservation', () => {
  it('defines SESSION_PRESERVE_MS constant', () => {
    expect(source).toContain('SESSION_PRESERVE_MS')
  })

  it('preserves session in finally block instead of deleting', () => {
    // Should NOT have the old pattern: this.activeQueries.delete(task.id) in finally
    // Should instead set query to null and keep the entry
    expect(source).toContain('query: null')
    expect(source).toContain('sessionId: existing.sessionId')
  })

  it('sets up auto-cleanup timeout for preserved sessions', () => {
    expect(source).toContain('setTimeout')
    expect(source).toContain('SESSION_PRESERVE_MS')
    expect(source).toContain('entry.query === null')
  })

  it('ActiveQuery interface allows null query for completed sessions', () => {
    expect(source).toContain('query: Query | null')
  })

  it('injectMessage checks for null query and returns false', () => {
    expect(source).toContain('if (!active.query)')
    expect(source).toContain('Cannot inject into completed session')
  })
})

describe('agent runner SDK adapter — task type routing', () => {
  it('uses maxTurns=10 for chat and summarize tasks', () => {
    expect(source).toContain("isTextOnlyTask ? 10 : 150")
  })

  it('allows task.maxTurns to override default', () => {
    expect(source).toContain('task.maxTurns ?? defaultMaxTurns')
  })
})

describe('agent runner SDK adapter — system prompt and model', () => {
  it('passes systemPrompt to SDK options when provided', () => {
    expect(source).toContain('task.systemPrompt')
    expect(source).toContain("options as Record<string, unknown>).systemPrompt = task.systemPrompt")
  })

  it('passes model to SDK options when provided', () => {
    expect(source).toContain('task.model')
    expect(source).toContain("options as Record<string, unknown>).model = task.model")
  })
})

describe('agent runner SDK adapter — structured output', () => {
  it('passes outputFormat to SDK options', () => {
    expect(source).toContain('task.outputFormat')
    expect(source).toContain("options as Record<string, unknown>).outputFormat = task.outputFormat")
  })

  it('captures structured_output from result messages', () => {
    expect(source).toContain('structured_output')
    expect(source).toContain('JSON.stringify(msgAny.structured_output)')
  })
})

describe('agent runner SDK adapter — MCP servers', () => {
  it('loads MCP servers from agent config', () => {
    expect(source).toContain('agentConfig.mcpServers')
    expect(source).toContain("Object.keys(agentConfig.mcpServers).length > 0")
  })

  it('injects ASTRO_EXECUTION_ID into MCP server env', () => {
    expect(source).toContain('ASTRO_EXECUTION_ID: task.id')
  })

  it('sets allowed tools pattern for MCP servers', () => {
    expect(source).toContain("mcp__${name}__*")
  })
})

describe('agent runner SDK adapter — approval interception', () => {
  it('intercepts AskUserQuestion tool', () => {
    expect(source).toContain("toolName === 'AskUserQuestion'")
  })

  it('validates single question requirement', () => {
    expect(source).toContain('askInput.questions.length !== 1')
    expect(source).toContain('Only one question at a time')
  })

  it('calls stream.approvalRequest for user approval', () => {
    expect(source).toContain('stream.approvalRequest(question.question, optionLabels)')
  })

  it('returns allow with updatedInput containing answers', () => {
    expect(source).toContain("behavior: 'allow'")
    expect(source).toContain('updatedInput')
    expect(source).toContain('answers: { [question.question]: result.answer }')
  })

  it('allows all non-AskUserQuestion tools', () => {
    expect(source).toContain("return { behavior: 'allow' as const, updatedInput: input }")
  })
})

describe('agent runner SDK adapter — conversation history', () => {
  it('handles messages array for chat tasks', () => {
    expect(source).toContain('task.messages && task.messages.length > 0')
  })

  it('formats conversation with Human/Assistant prefixes', () => {
    expect(source).toContain("m.role === 'user' ? 'Human' : 'Assistant'")
  })

  it('includes conversation history header', () => {
    expect(source).toContain('Conversation history:')
  })
})

describe('agent runner SDK adapter — permissions', () => {
  it('uses bypassPermissions mode', () => {
    expect(source).toContain("permissionMode: 'bypassPermissions'")
  })

  it('auto-detects sandbox mode (enabled for standard models, skipped for Bedrock)', () => {
    // getSandboxOption() enables sandbox for standard claude-* models, skips for Bedrock
    expect(source).toContain('getSandboxOption')
    expect(source).toContain("skip for Bedrock/custom models")
  })

  it('sets additional directories for file operations', () => {
    expect(source).toContain('additionalDirectories: [task.workingDirectory]')
  })
})

describe('agent runner SDK adapter — HPC context', () => {
  it('lazily initializes HPC context', () => {
    expect(source).toContain('this.hpcContext === undefined')
    expect(source).toContain('buildHpcContext')
  })

  it('prepends HPC context to prompt when available', () => {
    expect(source).toContain('this.hpcContext?.available')
    expect(source).toContain('this.hpcContext.contextString')
  })
})

describe('agent runner SDK adapter — streaming events', () => {
  it('emits sessionInit on system init', () => {
    expect(source).toContain('stream.sessionInit(sessionId, msg.model)')
  })

  it('emits text blocks from assistant messages', () => {
    expect(source).toContain('stream.text(block.text)')
  })

  it('emits toolUse for tool_use blocks', () => {
    expect(source).toContain('stream.toolUse(block.name, block.input)')
  })

  it('emits fileChange for Write operations', () => {
    expect(source).toContain("block.name === 'Write'")
    expect(source).toContain('stream.fileChange(')
  })

  it('emits fileChange for Edit operations', () => {
    expect(source).toContain("block.name === 'Edit'")
  })

  it('tracks file artifacts', () => {
    expect(source).toContain("type: 'file'")
    expect(source).toContain('metadata: { tool: block.name }')
  })

  it('emits toolResult from user messages', () => {
    expect(source).toContain('stream.toolResult(')
  })
})

describe('agent runner SDK adapter — abort/cancel handling', () => {
  it('creates AbortController that respects signal', () => {
    expect(source).toContain('signal.addEventListener')
    expect(source).toContain('abortController.abort()')
  })

  it('removes abort listener in finally block', () => {
    expect(source).toContain("signal.removeEventListener('abort', abortHandler)")
  })

  it('returns cancelled status on abort', () => {
    expect(source).toContain("status: 'cancelled'")
    expect(source).toContain("error: 'Task cancelled'")
  })

  it('checks for AbortError', () => {
    expect(source).toContain("error.name === 'AbortError'")
  })
})

describe('agent runner SDK adapter — error handling', () => {
  it('handles error_during_execution', () => {
    expect(source).toContain("msg.subtype === 'error_during_execution'")
  })

  it('handles error_max_turns', () => {
    expect(source).toContain("msg.subtype === 'error_max_turns'")
  })

  it('handles error_max_budget_usd', () => {
    expect(source).toContain("msg.subtype === 'error_max_budget_usd'")
  })

  it('handles error_max_structured_output_retries', () => {
    expect(source).toContain("msg.subtype === 'error_max_structured_output_retries'")
  })
})

describe('agent runner SDK adapter — Slurm job tracking', () => {
  it('detects sbatch submissions from tool results', () => {
    expect(source).toContain('Submitted batch job')
    expect(source).toContain('this.jobMonitor && typeof resultContent')
  })

  it('tracks detected jobs via jobMonitor', () => {
    expect(source).toContain('this.jobMonitor.trackJob(')
  })
})

describe('agent runner SDK adapter — concurrency', () => {
  it('tracks active task count', () => {
    expect(source).toContain('this.activeTasks++')
    expect(source).toContain('this.activeTasks--')
  })

  it('defaults to max 4 concurrent tasks', () => {
    expect(source).toContain('private maxTasks = 4')
  })

  it('stores active queries per task ID for steering', () => {
    expect(source).toContain('new Map<string, ActiveQuery>()')
    expect(source).toContain('this.activeQueries.set(task.id')
  })
})
