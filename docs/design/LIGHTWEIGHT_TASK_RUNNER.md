# Lightweight Task Runner: KIRA-Inspired Simple Task Execution

> **Status:** Design draft
> **Date:** 2026-03-16
> **Inspired by:** [Terminus-KIRA](https://github.com/krafton-ai/Terminus-KIRA) (75.7% Terminal-Bench, ~1,160 lines)

---

## Problem

Astro's agent-runner (`packages/agent-runner`) wraps Claude Code for task execution. This is powerful for complex, multi-file coding tasks but is **heavyweight for simple tasks**:

- Starting Claude Code takes seconds (process spawn, MCP init, CLAUDE.md loading)
- Each execution consumes a full Claude Code session with all tools
- Simple tasks (run a command, check a file, fix a lint error) don't need the full agent
- Terminal-Bench tasks are self-contained CLI problems — no IDE, no complex tooling

KIRA proves that a **minimal agent loop with 3 tools** can solve 75.7% of terminal tasks. We should build a similar lightweight runner for Astro's simple/fast-track tasks.

---

## What KIRA Gets Right

KIRA is ~1,160 lines of Python. Its entire architecture:

```
System prompt (5 lines)
  + 3 tools (execute_commands, task_complete, image_read)
  + Marker-based polling (detect command completion early)
  + Double-confirmation (prevent premature "done")
  + 30KB output cap (prevent context bloat)
  + LLM summarization on context overflow
= 75.7% Terminal-Bench
```

Key patterns worth adopting:

### 1. Structured Tool Schema Forces Planning

```json
{
  "name": "execute_commands",
  "parameters": {
    "analysis": "What do you see? What has been accomplished?",
    "plan": "What commands will you run and why?",
    "commands": [{ "keystrokes": "...", "duration": 1.0 }]
  },
  "required": ["analysis", "plan", "commands"]
}
```

The `analysis` + `plan` fields are the entire planning system. No separate planner module, no memory tools, no RepoMap — just forced chain-of-thought at the tool schema level.

### 2. Marker-Based Command Completion

```python
# After each command, send a marker
await session.send_keys(f"echo '__CMDEND__{seq}__'\n")

# Poll for marker instead of waiting fixed duration
while time.monotonic() - start < duration_sec:
    output = await session.capture_pane()
    if marker in output:
        break
    await asyncio.sleep(0.5)
```

Fast commands (cd, ls, cat) complete instantly instead of waiting 1+ seconds. KIRA reports significant cumulative time savings.

### 3. Double-Confirmation Before Completion

First `task_complete` returns a checklist:
- Does solution meet requirements?
- Robust against numeric/config variations?
- Verified from 3 perspectives: test engineer, QA engineer, requesting user?

Agent must call `task_complete` again after reviewing. Prevents the most common failure: declaring victory too early.

### 4. Minimal System Prompt

KIRA's entire prompt is 5 lines + task description + terminal state. No elaborate persona, no pages of instructions. The tools carry the behavioral contract.

---

## Design: Astro Lightweight Runner

### When to Use

The dispatcher (`server/lib/dispatch/`) selects the runner based on task characteristics:

| Signal | Lightweight | Full (Claude Code) |
|---|---|---|
| Estimate XS/S | yes | — |
| Task title matches pattern (fix lint, run test, check ...) | yes | — |
| No file creation/modification expected | yes | — |
| Single-command tasks | yes | — |
| Estimate M/L/XL | — | yes |
| Multi-file changes | — | yes |
| Architecture/design work | — | yes |
| User explicitly requests full agent | — | yes |

The lightweight runner is the **fast path**. If it fails or the task turns out to be complex, it escalates to the full runner automatically.

### Architecture

```
┌─────────────────────────────────────────────┐
│ LightweightRunner                           │
│                                             │
│ ┌─────────────┐  ┌───────────────────────┐  │
│ │ System      │  │ Tool Definitions      │  │
│ │ Prompt      │  │ - execute_commands    │  │
│ │ (minimal)   │  │ - task_complete       │  │
│ │             │  │ - read_file           │  │
│ │             │  │ - write_file          │  │
│ │             │  │ - image_read          │  │
│ └─────────────┘  └───────────────────────┘  │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Agent Loop                              │ │
│ │  1. Send prompt + tools to LLM          │ │
│ │  2. Parse tool calls                    │ │
│ │  3. Execute (shell / file I/O)          │ │
│ │  4. Append results to conversation      │ │
│ │  5. Check: task_complete? overflow?      │ │
│ │  6. Repeat                              │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─────────────┐  ┌───────────────────────┐  │
│ │ Shell       │  │ Guards                │  │
│ │ (child      │  │ - 30KB output cap     │  │
│ │  process,   │  │ - marker polling      │  │
│ │  not tmux)  │  │ - double-confirmation │  │
│ │             │  │ - max 20 episodes     │  │
│ │             │  │ - context summarize   │  │
│ └─────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Tools (5)

Adapting KIRA's 3 tools + adding minimal file I/O for coding tasks:

#### `execute_commands`
Same as KIRA — `analysis` + `plan` + `commands[]` with marker-based polling.

```typescript
{
  name: 'execute_commands',
  description: 'Run shell commands with analysis and plan.',
  inputSchema: {
    type: 'object',
    properties: {
      analysis: { type: 'string', description: 'Analyze current state from output.' },
      plan: { type: 'string', description: 'Describe next steps and expected outcomes.' },
      commands: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            timeout_sec: { type: 'number', description: 'Max wait (default 5, max 60).' },
          },
          required: ['command'],
        },
      },
    },
    required: ['analysis', 'plan', 'commands'],
  },
}
```

#### `read_file`
Read a file by path (with line range). Not in KIRA (terminal-only), but needed for coding tasks.

#### `write_file`
Write/patch a file. Supports full write or search-and-replace. Keeps it simple — no diff format, no AST manipulation.

#### `task_complete`
Same as KIRA — double-confirmation with 3-perspective checklist. On first call returns the checklist; on second call, actually completes.

#### `image_read`
Same as KIRA — base64 encode an image, send to LLM for multimodal analysis.

### Implementation

**Location:** `packages/agent-runner/src/runners/lightweight.ts`

```typescript
interface LightweightRunnerConfig {
  model: string              // e.g. 'claude-sonnet-4-6' (fast, cheap)
  maxEpisodes: number        // default 20
  maxOutputBytes: number     // default 30_000
  workingDirectory: string
  taskDescription: string
  visionDoc?: string         // project context (kept short)
}

class LightweightRunner {
  private messages: Message[] = []
  private markerSeq = 0
  private pendingCompletion = false

  async run(config: LightweightRunnerConfig): Promise<TaskResult> {
    // 1. Build system prompt (minimal — task + cwd + tools)
    // 2. Agent loop: LLM call → tool execution → append → repeat
    // 3. Stream events via same SSE protocol as full runner
    // 4. On task_complete (confirmed): return result
    // 5. On max episodes: return partial result
    // 6. On context overflow: summarize and continue
  }
}
```

**Key differences from full runner:**
- Direct LLM API calls (Anthropic SDK or LiteLLM), not Claude Code subprocess
- Shell commands via `child_process.spawn`, not tmux
- No MCP server, no worktrees, no CLAUDE.md injection
- Same SSE event protocol (`text`, `tool_use`, `tool_result`, `done`) — UI doesn't know the difference
- Uses Sonnet by default (faster, cheaper) — Opus for full runner

### Model Selection

| Runner | Default Model | Why |
|---|---|---|
| Lightweight | claude-sonnet-4-6 | Fast, cheap, good at structured tool use |
| Full | claude-opus-4-6 | Best at complex multi-step reasoning |

The lightweight runner can optionally use Haiku for trivial tasks (check if file exists, run a single command).

### Escalation

If the lightweight runner detects it's in over its head:

```typescript
const ESCALATION_SIGNALS = [
  episodes > maxEpisodes * 0.8,           // using too many turns
  totalTokens > 100_000,                  // context getting large
  fileWriteCount > 5,                     // multi-file change
  errorCount > 3,                         // stuck in error loop
  agentRequestsEscalation,               // agent says "this is complex"
]
```

On escalation:
1. Summarize what was attempted and what was learned
2. Dispatch to full runner with the summary as context
3. Stream an `escalation` event so UI can show the handoff

### SSE Compatibility

The lightweight runner emits the same streaming events as the full runner:

```typescript
// Same event types, same UI rendering
emit('session_init', { sessionId, model })
emit('text', { content: '...' })
emit('tool_use', { name: 'execute_commands', input: { analysis, plan, commands } })
emit('tool_result', { output: '...' })
emit('result', { summary, cost, tokens })
emit('done', {})
```

The activity feed, streaming panel, and execution restoration all work unchanged.

---

## Implementation Plan

### Phase 1: Core Loop

```
packages/agent-runner/src/runners/
  lightweight.ts      — LightweightRunner class
  lightweight-tools.ts — Tool definitions + handlers
  shell-executor.ts   — Command execution with marker polling
```

- Direct Anthropic SDK calls with `tools` parameter
- Shell execution via `child_process.spawn` with marker polling
- `read_file` / `write_file` tools
- Double-confirmation on `task_complete`
- 30KB output cap
- SSE event emission (same protocol)

### Phase 2: Dispatcher Integration

- Add `runner: 'lightweight' | 'full'` to dispatch decision
- Heuristic-based selection (estimate, title patterns, explicit user choice)
- Escalation path from lightweight → full

### Phase 3: Model Tiering

- Sonnet for lightweight, Opus for full (configurable)
- Haiku option for trivial tasks
- Cost tracking per runner type in usage-store

### Phase 4: Benchmarking

- Run Terminal-Bench sample via Astro's lightweight runner
- Compare with KIRA baseline
- Tune: prompt, tools, escalation thresholds

---

## Cost Comparison

Rough estimates per task:

| Runner | Model | Avg Turns | Input Tokens | Output Tokens | Cost |
|---|---|---|---|---|---|
| Full (Claude Code) | Opus | 15-30 | ~200K | ~50K | ~$5-15 |
| Lightweight | Sonnet | 5-10 | ~30K | ~10K | ~$0.20-0.50 |
| Lightweight | Haiku | 3-5 | ~15K | ~5K | ~$0.02-0.05 |

For simple tasks, the lightweight runner is **10-100x cheaper** and **3-5x faster** (no Claude Code startup, fewer turns, smaller context).

---

## What We Don't Build

- **No tmux** — KIRA uses tmux because Terminal-Bench requires persistent terminal state. We use simple `child_process.spawn` — each command is independent.
- **No Harbor dependency** — We build directly on the Anthropic SDK. No framework dependency.
- **No separate evaluation harness** — We use Astro's existing dispatch + SSE infrastructure.
- **No memory tools** — The lightweight runner is for simple tasks. It doesn't need hierarchical memory. If it needs memory, it should escalate to the full runner.
