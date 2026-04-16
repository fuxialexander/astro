# Astro Improvement Roadmap

> Evolving Astro from a planning-first platform into a full agentic observability and management system.

**Date**: February 2026
**Status**: Draft (Revision 5 -- separates agent models from execution strategies; hub model)

---

## Table of Contents

1. [Guiding Philosophy](#1-guiding-philosophy)
2. [Strategic Decision: Claude Agent SDK vs CLI vs App](#2-strategic-decision-claude-agent-sdk-vs-cli-vs-app)
3. [Strategic Decision: Rust vs Node.js](#3-strategic-decision-rust-vs-nodejs)
4. [Strategic Decision: Multi-Model Support](#4-strategic-decision-multi-model-support)
5. [Strategic Decision: Agent Models × Execution Strategies](#5-strategic-decision-agent-models--execution-strategies)
6. [Pillar 1: Observability](#6-pillar-1-observability)
7. [Pillar 2: Safety Rails](#7-pillar-2-safety-rails)
8. [Pillar 3: Skills System](#8-pillar-3-skills-system)
9. [Pillar 4: Editor / UI Integration](#9-pillar-4-editor--ui-integration)
10. [Pillar 5: Features to Adopt from Reference Packages](#10-pillar-5-features-to-adopt-from-reference-packages)
11. [Implementation Phases](#11-implementation-phases)
12. [Architecture Decisions](#12-architecture-decisions)

---

## 1. Guiding Philosophy

The core insight: **agents are the new first-class citizens**. Humans should be managers, not code reviewers. The system should:

- Let agents do all the work; humans manage via PRs and test results
- Only surface code details when absolutely necessary
- Track everything the agent does for accountability and debugging
- Enforce safety boundaries so agents can run 24/7 unattended
- Treat Claude Code (and alternatives like OpenCode) as an operating system in the agent era

---

## 2. Strategic Decision: Claude Agent SDK vs CLI vs App

### 2.1 The Three Options

Astro currently uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) for local execution and the Claude Code CLI for remote execution via agent-runners. The question: should we standardize on one approach?

| Approach | What It Is | How Astro Uses It |
|----------|-----------|-------------------|
| **Claude Agent SDK** | TypeScript/Python library; `query()` returns async generator of structured `SDKMessage` objects | Local dispatch in `server/lib/providers/adapters/claude-code.ts` |
| **Claude Code CLI** | Binary invoked via `claude` command; outputs stdout/stderr | Remote dispatch via `packages/agent-runner/src/providers/claude-code-adapter` |
| **Claude Code App** | Desktop GUI application (VS Code-like) | Not used by Astro |

### 2.2 Deep Analysis

#### Claude Agent SDK (Recommended Primary Path)

**What it provides natively (from the docs):**

- **Full structured streaming**: Every message is typed (`SDKAssistantMessage`, `SDKUserMessage`, `SDKResultMessage`, `SDKSystemMessage`, `SDKPartialAssistantMessage`). Each includes `uuid`, `session_id`, and full Anthropic API message content. This is exactly the data we need for observability -- no parsing required.

- **Hooks system**: 12 hook events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PermissionRequest`). Hooks can:
  - **Block** tool calls (`permissionDecision: 'deny'`) -- direct safety rail enforcement
  - **Modify** tool inputs (`updatedInput`) -- input sanitization
  - **Log** every action -- observability without post-processing
  - **Inject context** (`systemMessage`, `additionalContext`) -- dynamic guidance

- **Cost control**: `maxBudgetUsd` option kills the agent when cost exceeds threshold. `SDKResultMessage` includes `total_cost_usd`, per-model `modelUsage` with `costUSD`, and full token breakdowns.

- **Permission modes**: `default` (custom `canUseTool` callback), `acceptEdits` (auto-approve file changes), `bypassPermissions` (full automation), `plan` (no execution).

- **Session management**: Sessions persist via `session_id`. Can `resume` sessions and `forkSession` for branching exploration. This maps directly to Astro's task branching model.

- **MCP servers**: In-process (`createSdkMcpServer()` with `tool()` helper) and out-of-process (stdio/SSE/HTTP). Astro's existing MCP tools server works with both.

- **Sandbox**: Programmatic sandbox configuration with network restrictions, filesystem controls, and unsandboxed command fallback with `canUseTool` approval.

- **Subagents**: Define agents programmatically via `agents` option with description, tools, prompt, and model override.

- **Structured output**: `outputFormat: { type: 'json_schema', schema: ... }` for deterministic output formats.

**Verdict on SDK**: It is definitively the right choice for Astro. The SDK gives us:
1. Observability for free via structured `SDKMessage` streaming + hooks
2. Safety rails for free via `PreToolUse` hooks + `maxBudgetUsd`
3. Session continuity via `resume` / `forkSession`
4. Sandbox enforcement via programmatic `SandboxSettings`
5. Cost tracking via `SDKResultMessage.total_cost_usd` and `modelUsage`

#### Claude Code CLI

**When you'd still use the CLI:**
- Remote machines where installing the SDK dependency tree is impractical
- Environments that already have `claude` installed (developer workstations)
- Cases where you want the full Claude Code system prompt and tool suite without configuration

**Observability challenge**: The CLI outputs to stdout/stderr. However:
1. The SDK's hooks documentation mentions `transcript_path` in every hook's `BaseHookInput` -- this is a file path where the full conversation transcript is written. The agent-runner can read this file.
2. Claude Code writes JSONL logs to `~/.claude/projects/*/logs/`.
3. Both of these provide structured data even when using the CLI.

**Verdict on CLI**: Keep as a secondary path for remote agent-runners. Migrate the agent-runner to use the SDK where possible (it already has a `claude-sdk-adapter` alongside the `claude-code-adapter`). For machines where only the CLI is available, use transcript file + JSONL log tailing for observability.

#### Claude Code App (Desktop)

**Verdict**: Not relevant for Astro. The app is for interactive human use. Astro's agents run programmatically. Skip entirely.

### 2.3 Recommendation

**Standardize on the Claude Agent SDK.** Specifically:

1. **Local execution (server-side)**: Already uses SDK. Enhance to leverage hooks for observability and safety.
2. **Remote execution (agent-runner)**: Migrate `claude-code-adapter` to use the SDK instead of spawning the CLI binary. The SDK supports `cwd`, `env`, `allowedTools`, `permissionMode`, and all the same capabilities. The agent-runner should `npm install @anthropic-ai/claude-agent-sdk` on the remote machine.
3. **CLI fallback**: Keep for edge cases (pre-installed CLI on machines you don't control). Use `transcript_path` + JSONL log tailing for observability.

### 2.4 SDK-Native Observability Architecture

With the SDK, observability becomes dramatically simpler:

```
┌─────────────────────────────────────────────────────────────────┐
│                  SDK-Native Observation Flow                     │
│                                                                   │
│  query({                                                          │
│    prompt: taskPrompt,                                            │
│    options: {                                                     │
│      hooks: {                                                     │
│        PreToolUse:  [{ hooks: [observeToolCall, safetyCheck] }],  │
│        PostToolUse: [{ hooks: [observeToolResult, auditLog] }],   │
│        SessionStart:[{ hooks: [initMetrics] }],                   │
│        SessionEnd:  [{ hooks: [finalizeMetrics] }],               │
│        Notification:[{ hooks: [forwardToSSE] }],                  │
│        Stop:        [{ hooks: [cleanup] }],                       │
│      },                                                           │
│      maxBudgetUsd: costGuard.perTaskLimit,                        │
│      canUseTool: safetyEngine.evaluate,                           │
│    }                                                              │
│  })                                                               │
│         │                                                         │
│         ▼                                                         │
│  for await (const msg of query) {                                 │
│    // Every SDKMessage has: uuid, session_id, typed content       │
│    observationCollector.record(msg);  // Persistent storage       │
│    sseEmitter.emit(msg);              // Real-time to browser     │
│  }                                                                │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight**: With the SDK approach, the hooks ARE the safety rails, and the message stream IS the observation data. No separate infrastructure needed.

---

## 3. Strategic Decision: Rust vs Node.js

### 3.1 The Question

ZeroClaw demonstrates that a Rust implementation achieves <5MB memory and <10ms startup versus Node.js's >100MB memory and multi-second startup. Should Astro migrate to Rust?

### 3.2 Analysis

#### Current State

| Component | Language | Memory | Justification |
|-----------|----------|--------|--------------|
| Astro server (Hono) | TypeScript/Node.js | ~100-200MB | Shares language with frontend, SDK is TypeScript-native |
| Astro frontend | TypeScript/React | Browser | Cannot be Rust |
| Agent-runner | TypeScript/Node.js | ~80-150MB | SDK is TypeScript-native |
| Claude Agent SDK | TypeScript | N/A | Anthropic provides TypeScript + Python only |

#### The Fundamental Constraint

**The Claude Agent SDK is only available in TypeScript and Python.** This is the single most important factor. The SDK is the core execution engine for agent tasks. A Rust migration would require either:

1. **FFI bridge to Node.js/Python**: Call the SDK from Rust via N-API or PyO3. This adds complexity, negates memory savings (you still run a Node.js/Python process), and creates debugging nightmares.

2. **Reimplement the SDK in Rust**: Reverse-engineer the Claude Agent SDK protocol and reimplement it. This is fragile (the SDK protocol is undocumented and changes frequently), expensive to maintain, and would fall behind on features like hooks, sessions, sandbox, etc.

3. **HTTP API wrapper**: Call the Anthropic Messages API directly from Rust, reimplementing tool execution, context management, and the agentic loop. This is what ZeroClaw does, but it means forfeiting all SDK features (hooks, sessions, sandbox, MCP integration, permission modes, subagents, etc.).

#### Where Rust Makes Sense

Rust makes sense for components that DON'T depend on the Claude Agent SDK:

| Component | Rust Viable? | Benefit |
|-----------|-------------|---------|
| **Agent-runner relay client** | Yes, but marginal | WebSocket client + process spawner. Memory savings ~100MB. But the agent-runner needs the SDK for execution. |
| **Observation collector** | Yes | High-throughput event ingestion + SQLite writes. Rust excels here. |
| **Safety rule engine** | Yes | Pattern matching on event streams. Rust's performance is ideal for real-time analysis. |
| **Log tailer / file watcher** | Yes | Tail JSONL logs with minimal overhead. |
| **Edge agent-runner** | Yes, with caveats | For machines with <1GB RAM (IoT/edge), a Rust binary that spawns Claude Code CLI is viable. It won't have SDK hooks but can tail logs. |

#### Where Rust Doesn't Make Sense

| Component | Why Not Rust |
|-----------|-------------|
| **Astro server (Hono)** | Tightly coupled to SDK for plan generation, chat, and task dispatch. Rewriting in Rust means losing SDK integration or adding an FFI bridge. |
| **Frontend** | React. Not applicable. |
| **Agent-runner task executor** | Needs SDK for direct execution. Rust can only invoke the CLI and tail logs. |
| **MCP tools server** | SDK provides `createSdkMcpServer()` and `tool()` helpers in TypeScript. Reimplementing in Rust means writing raw MCP protocol. |

### 3.3 Recommendation

**Stay with TypeScript for core components. Introduce Rust selectively for performance-critical subsystems.**

Specifically:

1. **Keep TypeScript**: Astro server, frontend, agent-runner task executor, MCP tools. The SDK integration is too valuable to lose.

2. **Consider Rust for (future)**:
   - **Observation collector sidecar**: A small Rust binary that receives high-volume observation events via Unix socket, batch-writes to SQLite, and serves query API. This is a performance optimization, not a rewrite.
   - **Safety rule engine**: A Rust WASM module loaded into the Node.js process for real-time pattern matching. Faster than JS regex for high-volume streams.
   - **Edge agent-runner**: A minimal Rust binary for <1GB machines that spawns Claude Code CLI and tails logs. No SDK features, just execution + observation forwarding.

3. **Memory mitigation for Node.js**:
   - Use `--max-old-space-size` to cap heap
   - Stream events instead of buffering
   - Use SQLite for persistence instead of in-memory caches
   - Consider Bun runtime (OpenCode uses it) for lower memory overhead, though Bun compatibility with the Claude Agent SDK needs testing

### 3.4 The Honest Trade-off

| Factor | TypeScript | Rust | Winner |
|--------|-----------|------|--------|
| Claude Agent SDK compatibility | Native | Requires FFI/reimplementation | TypeScript |
| Memory usage | 100-200MB | <5MB | Rust |
| Development speed | Fast (same language as frontend) | Slower (different toolchain) | TypeScript |
| Team familiarity | Assumed high (web stack) | Assumed lower | TypeScript |
| Ecosystem (Hono, Drizzle, React) | Native | Requires alternatives (Axum, Diesel) | TypeScript |
| Performance ceiling | Adequate for orchestration | Superior for data processing | Rust |
| Edge deployment | Requires Node.js runtime | Single binary | Rust |
| Long-term maintenance | One language for full stack | Two languages, two build systems | TypeScript |

**Bottom line**: The 100-200MB memory overhead of Node.js is acceptable for an orchestration platform that manages cloud/VM agents. The value of Claude Agent SDK integration (hooks, sessions, safety, observability) far exceeds the memory savings from Rust. Rust becomes relevant only when deploying agent-runners to truly resource-constrained environments.

---

## 4. Strategic Decision: Multi-Model Support

### 4.1 The Question

Can Astro use models beyond Claude? Specifically:
- **OpenAI Codex** (coding agent from OpenAI)
- **Chinese models**: GLM-5 (Zhipu AI), Kimi-K2.5 (Moonshot AI), MiniMax-M2.5
- Can the Claude Agent SDK be used with non-Claude backends?
- Can the Claude Agent SDK run on remote servers for full observability across all machines?

### 4.2 Can the Claude Agent SDK Use Non-Claude Models?

**No. The Claude Agent SDK is locked to Claude models.**

The SDK documentation is explicit: it requires either an `ANTHROPIC_API_KEY` or authentication through approved cloud providers:
- **Amazon Bedrock** (`CLAUDE_CODE_USE_BEDROCK=1`) -- runs Claude models on AWS
- **Google Vertex AI** (`CLAUDE_CODE_USE_VERTEX=1`) -- runs Claude models on GCP
- **Microsoft Azure AI Foundry** (`CLAUDE_CODE_USE_FOUNDRY=1`) -- runs Claude models on Azure

All three of these are still running Claude. You cannot point the Claude Agent SDK at an OpenAI, GLM-5, or Kimi endpoint. The SDK includes Claude-specific tool execution, system prompts, context management, and the agentic loop -- all tightly coupled to Claude's API format and capabilities.

**This is a fundamental architectural constraint.** The SDK's value (hooks, sessions, safety, MCP, structured output, sandbox) only works with Claude.

### 4.3 The Two-Layer Architecture

This constraint leads to a clear architecture: **Astro needs two execution layers**.

```
┌───────────────────────────────────────────────────────────────────┐
│                    Astro Multi-Model Architecture                  │
│                                                                     │
│  Layer 1: Claude Agent SDK (Primary)                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Full observability, hooks, safety rails, sessions, MCP      │   │
│  │  Models: Claude Opus/Sonnet/Haiku (via API, Bedrock, Vertex) │   │
│  │  Used for: Complex agentic coding tasks, planning, review    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Layer 2: Provider Adapters (Secondary)                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Astro-managed observability (wrapper-based, not hook-based) │   │
│  │  Models: Codex, GLM-5, Kimi-K2.5, MiniMax-M2.5, DeepSeek   │   │
│  │  Used for: Cost-sensitive tasks, specific model strengths    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Astro Orchestration Layer (Shared)                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Task dispatch, plan graph, analytics, UI -- provider-agnostic│   │
│  └─────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

### 4.4 OpenAI Codex Integration

#### What Codex Is

OpenAI Codex is a coding agent (CLI + SDK + desktop app) analogous to Claude Code. It has its own TypeScript SDK (`@openai/codex` on npm) with:

- **`Codex` class**: `codex.startThread()` → `thread.run(prompt)` / `thread.runStreamed(prompt)`
- **Thread persistence**: Sessions stored in `~/.codex/sessions`, resumable via `resumeThread()`
- **Streaming events**: `runStreamed()` yields `item.completed` and `turn.completed` events with tool call details
- **Models**: GPT-4o, GPT-4o-mini, o1, o1-mini, o3-mini
- **Structured output**: JSON Schema / Zod support via `outputSchema`

#### How Astro Already Integrates Codex

Astro already has a `codex.ts` provider adapter that:
- Spawns the Codex CLI as a subprocess
- Injects context via prompt prefix (Codex doesn't support `--context-file`)
- Parses NDJSON output for tool traces and file changes
- Supports task cancellation via SIGTERM

#### How to Upgrade Codex Integration

**Migrate from CLI spawning to the Codex TypeScript SDK** (`@openai/codex`):

```typescript
// server/lib/providers/adapters/codex.ts (upgraded)
import { Codex } from '@openai/codex';

async *stream(task: TaskDispatch): AsyncGenerator<StreamEvent> {
  const codex = new Codex({
    workingDirectory: task.context.workingDirectory,
    config: { model: task.model ?? 'gpt-4o' }
  });

  const thread = codex.startThread();

  // Observability: wrap the streaming call
  const streamed = thread.runStreamed(task.prompt);
  for await (const event of streamed) {
    // Normalize Codex events → Astro ObservationEvent
    observationCollector.record(normalizeCodexEvent(event, task.executionId));

    // Yield Astro StreamEvents for backwards compatibility
    if (event.type === 'item.completed') {
      yield { type: 'text', text: event.item?.text ?? '' };
    }
    if (event.type === 'turn.completed') {
      yield { type: 'result', result: buildTaskResult(event) };
    }
  }
}
```

**Observability**: Since Codex SDK provides streaming events with tool calls and file changes, we get similar (though less granular) observability as the Claude SDK. No hooks, but we can wrap the stream.

**Safety**: No `PreToolUse` hooks like Claude SDK. Safety must be implemented as a wrapper that inspects events after they happen (PostToolUse equivalent). We can still enforce cost limits by tracking token usage from turn results and aborting via `thread.cancel()`.

### 4.5 Chinese Model Integration

#### The Models

| Model | Provider | OpenAI-Compatible API | Tool Use | Strengths | Pricing (approx.) |
|-------|----------|----------------------|----------|-----------|-------------------|
| **GLM-5** | Zhipu AI | Yes | Yes | Strong Chinese NLP, good coding | ~$0.50-2/M tokens |
| **Kimi-K2.5** | Moonshot AI | Yes | Yes | Long context (128K+), good reasoning | ~$0.50-1.50/M tokens |
| **MiniMax-M2.5** | MiniMax | Yes | Yes | Balanced general purpose | ~$0.50-1.50/M tokens |
| **DeepSeek-V3** | DeepSeek | Yes | Yes | Very strong coding, cheap | ~$0.14-0.28/M tokens |
| **Qwen-3** | Alibaba | Yes | Yes | Multilingual, good coding | ~$0.30-1.20/M tokens |

#### Key Insight: OpenAI-Compatible APIs

All major Chinese models expose **OpenAI-compatible API endpoints**. This means they accept the same request format as OpenAI's Chat Completions API:

```
POST https://open.bigmodel.cn/api/paas/v4/chat/completions   (GLM-5)
POST https://api.moonshot.cn/v1/chat/completions               (Kimi)
POST https://api.minimax.chat/v1/chat/completions               (MiniMax)
POST https://api.deepseek.com/v1/chat/completions               (DeepSeek)
```

They all support:
- Streaming (`stream: true`)
- Tool/function calling (`tools` parameter)
- System messages
- JSON mode / structured output

#### Implementation: OpenAI-Compatible Provider Adapter

Build a single provider adapter that works with ANY OpenAI-compatible API:

```typescript
// server/lib/providers/adapters/openai-compatible.ts
import OpenAI from 'openai';

export class OpenAICompatibleProvider implements AgentProvider {
  private client: OpenAI;

  constructor(private config: {
    id: string;           // e.g., 'glm-5', 'kimi-k2.5', 'minimax-m2.5'
    name: string;         // e.g., 'GLM-5 (Zhipu AI)'
    baseURL: string;      // e.g., 'https://open.bigmodel.cn/api/paas/v4'
    apiKey: string;
    defaultModel: string; // e.g., 'glm-5'
    availableModels: string[];
    maxContextTokens: number;
  }) {
    // The OpenAI SDK supports custom base URLs
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async *stream(task: TaskDispatch): AsyncGenerator<StreamEvent> {
    const messages = this.buildMessages(task);
    const tools = this.buildTools(task);  // Convert Astro MCP tools to OpenAI tool format

    const stream = await this.client.chat.completions.create({
      model: task.model ?? this.config.defaultModel,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
    });

    let toolCalls: ToolCall[] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        observationCollector.record({
          executionId: task.executionId,
          type: 'assistant_message',
          content: delta.content,
        });
        yield { type: 'text', text: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          observationCollector.record({
            executionId: task.executionId,
            type: 'tool_call',
            toolName: tc.function?.name,
            toolInput: tc.function?.arguments,
          });
        }
      }
    }

    // Handle tool call execution loop
    // (Must implement agentic loop ourselves since no SDK does this for us)
    while (toolCalls.length > 0) {
      const results = await this.executeTools(toolCalls, task);
      // ... continue conversation with tool results
    }
  }
}
```

#### The Agentic Loop Problem

**Critical difference**: The Claude Agent SDK and Codex SDK handle the entire agentic loop (model call → tool execution → model call → ... → result). For Chinese models, **Astro must implement its own agentic loop**.

This means:
1. Call the model API
2. Parse tool calls from the response
3. Execute tools (Read, Write, Edit, Bash, etc.)
4. Feed tool results back to the model
5. Repeat until the model stops calling tools

This is the "Client SDK" pattern from the Claude docs -- significantly more work than the Agent SDK pattern. However, it gives Astro **total control** over:
- Observability (we control every step)
- Safety (we can inspect every tool call before execution)
- Cost tracking (we see every API call)
- Tool implementation (we define what tools are available)

#### Astro Agentic Loop for OpenAI-Compatible Models

```typescript
// server/lib/providers/agentic-loop.ts
export class AgenticLoop {
  constructor(
    private client: OpenAI,
    private tools: Tool[],
    private safetyEngine: SafetyEngine,
    private collector: ObservationCollector,
  ) {}

  async *run(task: TaskDispatch): AsyncGenerator<StreamEvent> {
    const messages: ChatMessage[] = [
      { role: 'system', content: task.systemPrompt ?? '' },
      { role: 'user', content: task.prompt },
    ];

    let turn = 0;
    const maxTurns = task.maxTurns ?? 30;

    while (turn < maxTurns) {
      turn++;

      // 1. Call model
      const response = await this.client.chat.completions.create({
        model: task.model,
        messages,
        tools: this.tools.map(t => t.toOpenAIFormat()),
        stream: true,
      });

      // 2. Collect response
      let assistantContent = '';
      const toolCalls: ToolCall[] = [];

      for await (const chunk of response) {
        // ... accumulate content and tool calls, yield StreamEvents
      }

      messages.push({ role: 'assistant', content: assistantContent, tool_calls: toolCalls });

      // 3. If no tool calls, we're done
      if (toolCalls.length === 0) break;

      // 4. Execute tools with safety checks
      for (const tc of toolCalls) {
        // Safety check BEFORE execution
        const verdict = await this.safetyEngine.checkBehavior(tc.name, tc.arguments, task.executionId);
        if (verdict.action === 'abort') {
          yield { type: 'error', message: `Safety: ${verdict.reason}` };
          return;
        }

        // Execute tool
        const result = await this.executeTool(tc);

        // Record observation
        this.collector.record({
          executionId: task.executionId,
          type: 'tool_result',
          toolName: tc.name,
          toolResult: result,
        });

        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    }
  }
}
```

### 4.6 Remote SDK Deployment for Full Observability

#### The Question

Can we run the Claude Agent SDK on remote servers (not just locally) to get full hook-based observability across all machines?

#### Answer: Yes, Absolutely

The Claude Agent SDK is a Node.js/Python library. It runs anywhere Node.js runs. The requirements are:

1. **Node.js 18+** installed on the remote machine
2. **`@anthropic-ai/claude-agent-sdk`** npm package installed
3. **API key** available as `ANTHROPIC_API_KEY` (or Bedrock/Vertex/Azure credentials)
4. **Working directory** with the code to operate on

The agent-runner package (`packages/agent-runner/`) already has a `claude-sdk-adapter` that uses the SDK. The migration path is:

```
Current state:
  Remote machine → agent-runner → claude-code-adapter → spawns `claude` CLI → stdout parsing
                                                                                  ❌ No hooks
                                                                                  ❌ No structured events
                                                                                  ❌ Lossy observability

Target state:
  Remote machine → agent-runner → claude-sdk-adapter → calls query() from SDK → full hooks
                                                                                  ✅ PreToolUse/PostToolUse
                                                                                  ✅ SDKMessage stream
                                                                                  ✅ maxBudgetUsd
                                                                                  ✅ canUseTool safety
                                                                                  ✅ Session resume/fork
```

#### Implementation

Modify the agent-runner to default to SDK-based execution:

```typescript
// packages/agent-runner/src/providers/claude-sdk-adapter.ts
import { query } from '@anthropic-ai/claude-agent-sdk';

export class ClaudeSdkAdapter implements AgentProvider {
  async *stream(task: TaskDispatch): AsyncGenerator<StreamEvent> {
    // Full SDK with hooks -- same code as local server execution
    const observationHooks = createObservationHooks(collector, task.executionId);
    const safetyHooks = createSafetyHooks(safetyEngine, task.executionId);

    const q = query({
      prompt: task.prompt,
      options: {
        cwd: task.context.workingDirectory,
        hooks: mergeHooks(observationHooks, safetyHooks),
        maxBudgetUsd: task.costLimit,
        canUseTool: safetyEngine.evaluate,
        mcpServers: task.mcpServers,
        permissionMode: 'bypassPermissions', // Agent-runner handles permissions
        allowDangerouslySkipPermissions: true,
      }
    });

    for await (const msg of q) {
      // Forward structured events via relay WebSocket
      relayClient.send({
        type: 'task.observation',
        executionId: task.executionId,
        sdkMessage: msg, // Full SDK message, not just stdout
      });

      // Also yield StreamEvents for local processing
      yield* normalizeSDKMessage(msg);
    }
  }
}
```

This gives us **identical observability on remote machines as local execution**. The hooks run on the remote machine, and the structured events are forwarded to the Astro server via the relay WebSocket.

### 4.7 Provider Comparison Matrix

| Capability | Claude SDK | Codex SDK | OpenAI-Compatible (Chinese) |
|-----------|-----------|-----------|----------------------------|
| **Hooks (PreToolUse)** | Native (12 events) | None | Astro-managed (agentic loop) |
| **Safety enforcement** | `canUseTool` + `maxBudgetUsd` | Manual (abort thread) | Astro-managed (pre-execution check) |
| **Observability** | `SDKMessage` stream (full) | `runStreamed()` events (partial) | Astro-managed (full, since we control the loop) |
| **Session resume** | `resume` / `forkSession` | `resumeThread()` | Manual (message history) |
| **MCP integration** | `createSdkMcpServer()` + `tool()` | None | Manual (tool definitions) |
| **Sandbox** | `SandboxSettings` | `--sandbox` flag | None (Astro must sandbox) |
| **Built-in tools** | Read, Write, Edit, Bash, Glob, Grep, etc. | Similar set | None (Astro provides tools) |
| **Structured output** | `outputFormat` | `outputSchema` | `response_format` |
| **Cost** | $3-75/M tokens (model-dependent) | ~$2-15/M tokens | $0.14-2/M tokens |
| **Agentic loop** | SDK handles it | SDK handles it | **Astro must implement** |
| **Remote deployment** | Yes (npm install) | Yes (npm install) | Yes (API calls, no local install needed) |

### 4.8 Recommended Multi-Model Strategy

#### Tier 1: Claude Agent SDK (Primary, Full Features)

- Models: Claude Opus 4, Sonnet 4, Haiku (via direct API, Bedrock, Vertex, Azure)
- Used for: Complex multi-step coding, planning, review, agentic tasks requiring rich tool use
- Observability: Full (hooks + SDKMessage stream)
- Safety: Full (canUseTool + maxBudgetUsd + sandbox)
- Deploy on: Local server + all remote agent-runners via SDK

#### Tier 2: Codex SDK (Secondary, Good Features)

- Models: GPT-4o, o3-mini, o1
- Used for: OpenAI-ecosystem tasks, model diversity, cost comparison
- Observability: Good (streaming events from `runStreamed()`, Astro wraps)
- Safety: Partial (Astro-managed cost tracking, no pre-execution hooks)
- Deploy on: Machines with Codex SDK installed

#### Tier 3: OpenAI-Compatible (Cost-Optimized, Astro-Managed)

- Models: DeepSeek-V3, GLM-5, Kimi-K2.5, MiniMax-M2.5, Qwen-3
- Used for: Cost-sensitive tasks, batch operations, Chinese-language tasks, bulk code generation
- Observability: Full (Astro controls the agentic loop, sees everything)
- Safety: Full (Astro checks every tool call before execution)
- Deploy on: Server-side only (API calls, no local SDK needed)
- Key advantage: **Cheapest option** (DeepSeek at ~$0.14/M input tokens is 20-50x cheaper than Claude)

#### Smart Routing

Astro should intelligently route tasks to providers based on:

```typescript
interface RoutingPolicy {
  // Cost optimization
  costSensitive: boolean;              // If true, prefer Tier 3 models
  maxCostPerTask: number;              // Route to cheapest model that fits

  // Quality requirements
  requiresComplexReasoning: boolean;   // If true, prefer Claude Opus/Sonnet
  requiresLongContext: boolean;        // If true, prefer Kimi (128K+) or Claude
  requiresToolUse: boolean;            // If true, prefer Claude SDK (best tool use)
  languagePreference?: string;         // 'zh' → prefer Chinese models

  // Observability requirements
  requiresFullHooks: boolean;          // If true, must use Claude SDK
  requiresSessionResume: boolean;      // If true, must use Claude SDK or Codex SDK

  // Fallback chain
  preferredProviders: string[];        // e.g., ['claude-code', 'deepseek', 'codex']
}
```

### 4.9 Architecture Decision

**ADR-007: Multi-provider architecture with three tiers**

**Context**: Users want to use cheaper models for routine tasks and Claude for complex ones. Chinese models offer 20-50x cost savings.

**Decision**: Three-tier provider system. Claude SDK for full-featured execution. Codex SDK for OpenAI ecosystem. OpenAI-compatible adapter for Chinese models. Astro provides its own agentic loop for Tier 3 models.

**Rationale**: The Claude SDK's hooks are irreplaceable for complex agentic tasks. But not every task needs $3/M-token quality. A simple "add a docstring to every function" task can run on DeepSeek at $0.14/M tokens. The agentic loop for Tier 3 models is more work to build, but gives Astro complete control over observability and safety -- arguably even better than relying on external SDK hooks.

**Trade-off**: Building the agentic loop is significant engineering effort. But it also makes Astro less dependent on any single provider. If Claude or Codex changes their SDK, Astro's own loop is unaffected.

---

## 5. Strategic Decision: Agent Models × Execution Strategies

### 5.1 The Core Insight: Two Orthogonal Dimensions

The current codebase conflates two independent concerns into a single `AgentProvider` interface. Claude, Codex, and SLURM all implement the same contract — but SLURM is not an AI model. It's a way to run jobs. These are orthogonal:

```
┌──────────────────────────────────────────────────────────────────────┐
│  DIMENSION 1: AGENT MODEL — the AI that reasons about the task      │
│                                                                      │
│  Claude (Agent SDK), Codex (OpenAI CLI), DeepSeek, GPT, local LLM  │
│  Or: NONE — pure compute (training, inference, tests, deploy)       │
│                                                                      │
│  Concerns: calling an AI API, prompt assembly, tool use, sessions   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  DIMENSION 2: EXECUTION STRATEGY — how the task runs on the node    │
│                                                                      │
│  Direct (fork/exec), SLURM (sbatch), Docker (docker run),          │
│  K8s Job (kubectl create job)                                        │
│                                                                      │
│  Concerns: process lifecycle, resource allocation, log streaming    │
└──────────────────────────────────────────────────────────────────────┘
```

Any agent model can be combined with any execution strategy:

```
                         EXECUTION STRATEGY
                   Direct     SLURM      Docker     K8s Job
                ┌──────────┬──────────┬──────────┬──────────┐
    Claude      │ Claude   │ Claude   │ Claude   │ Claude   │
                │ on your  │ coding   │ in a     │ coding   │
                │ laptop   │ on HPC   │ container│ in pod   │
 A              ├──────────┼──────────┼──────────┼──────────┤
 G  Codex      │ Codex    │ Codex    │ Codex    │ Codex    │
 E              │ locally  │ on HPC   │ in a     │ in pod   │
 N              │          │          │ container│          │
 T              ├──────────┼──────────┼──────────┼──────────┤
    DeepSeek   │ DeepSeek │ DeepSeek │ DeepSeek │ DeepSeek │
 M              │ locally  │ on HPC   │ in a     │ in pod   │
 O              │          │          │ container│          │
 D              ├──────────┼──────────┼──────────┼──────────┤
 E  None       │ python   │ sbatch   │ docker   │ k8s job  │
 L  (compute)  │ train.py │ train.sh │ run train│ train    │
                └──────────┴──────────┴──────────┴──────────┘
```

**Examples of the cross-product:**
- Run a training experiment on an SSH server (VM) → Agent: None, Execution: Direct
- Run a training experiment via SLURM on HPC → Agent: None, Execution: SLURM
- Have Claude write code on your laptop → Agent: Claude, Execution: Direct
- Have Claude write code in a Docker container → Agent: Claude, Execution: Docker
- Run inference with a local vLLM server → Agent: None, Execution: Direct
- Have Codex refactor code on a K8s pod → Agent: Codex, Execution: K8s Job

### 5.2 What This Means for the Codebase

**Current state** (conflated):

| Current "Provider" | File | Actually is |
|---------------------|------|-------------|
| `claude-code.ts` | `server/lib/providers/adapters/` | Agent model (Claude API) — always runs direct |
| `codex.ts` | `server/lib/providers/adapters/` | Agent model (OpenAI API) — always runs direct |
| `anthropic-direct.ts` | `server/lib/providers/adapters/` | Agent model (Anthropic API) — always runs direct |
| `slurm-adapter.ts` | `packages/agent-runner/src/providers/` | Execution strategy (sbatch) — NOT an AI model |

SLURM is a *way to run jobs*, not an *AI that reasons*. It should be in the execution strategy registry, not the agent model registry.

**Target state** (separated):

```
Agent-Runner internals:

  AgentModelRegistry                    ExecutionStrategyRegistry
  ┌──────────────────────┐              ┌─────────────────────────┐
  │ claude-code (SDK)    │              │ direct (fork/exec)      │  ← always available
  │ codex (CLI)          │              │ slurm (sbatch/squeue)   │  ← if sbatch found
  │ anthropic-direct     │              │ docker (docker run)     │  ← if docker found
  │ deepseek (future)    │              │ k8s-job (kubectl)       │  ← if kubectl found
  │ (none / passthrough) │              │                         │
  └──────────────────────┘              └─────────────────────────┘
          │                                       │
          └───────────────────┬───────────────────┘
                              │
                    Task dispatch specifies:
                    - agentModel: 'claude' | 'codex' | 'none' | ...
                    - executionStrategy: 'direct' | 'slurm' | ... (or let node decide)
```

**Interfaces:**

```typescript
// Agent Model — wraps an AI API (or passthrough for pure compute)
interface AgentModel {
  readonly id: string;
  detect(): Promise<{ available: boolean; version?: string }>;
  capabilities(): { taskTypes: string[]; languages: string[]; models: string[] };
  stream(task: TaskDispatch): AsyncGenerator<StreamEvent>;
  cancel(taskId: string): void;
  prepareContext(context: TaskContext): PreparedContext;
}

// Execution Strategy — wraps how a process runs
interface ExecutionStrategy {
  readonly id: string;
  detect(): Promise<{ available: boolean }>;
  submit(command: string, resources?: ResourceSpec): Promise<JobHandle>;
  cancel(jobId: string): Promise<void>;
  getStatus(jobId: string): Promise<JobStatus>;
  getLogs(jobId: string): AsyncGenerator<string>;
}
```

### 5.3 Node Registration with Both Dimensions

When an agent-runner connects to the relay, it registers both:

```typescript
// What the node sends on connect:
{
  machineId: "gpu-server-1",
  agentModels: ["claude-code", "codex"],           // AI models available
  executionStrategies: ["direct", "slurm"],         // how it can run tasks
  resources: { cpuCores: 64, memoryMB: 256000, gpuCount: 8 },
  labels: { team: "ml", env: "production" }
}
```

**Your laptop** might register as:
```
agentModels: [claude-code, codex]
executionStrategies: [direct, docker, k8s-job]   // has Docker Desktop + kubectl
```

**An HPC login node** might register as:
```
agentModels: [claude-code]
executionStrategies: [direct, slurm]             // can run direct OR submit jobs
```

**A K8s pod running vLLM** might register as:
```
agentModels: []                                   // no AI API keys
executionStrategies: [direct]                     // just runs in-process
```

**A VM on EC2** might register as:
```
agentModels: [claude-code, codex]
executionStrategies: [direct, docker]             // has Docker installed
```

### 5.4 The Hub Model

The Astro server is a **passive hub**, not a compute orchestrator. It does not SSH into machines, create K8s Jobs, pick Docker images, or manage conda environments.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ARCHITECTURE PRINCIPLE                                              │
│                                                                      │
│  The server is a HUB. It accepts connections and dispatches tasks.  │
│                                                                      │
│  Compute nodes are set up INDEPENDENTLY by the user/infra team.    │
│  Each node runs the agent-runner, which connects to the relay.     │
│  The server routes tasks based on:                                  │
│    - Required agent model (Claude, Codex, None, ...)               │
│    - Required execution strategy (direct, slurm, docker, ...)      │
│    - Resource requirements (GPU, memory, labels)                   │
│    - Current load                                                   │
│                                                                      │
│  The agent-runner is EMBEDDABLE — a lightweight npm package added   │
│  to whatever environment the user already has, not a container      │
│  that replaces it.                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.5 What Already Exists

| Component | Status | Key Files |
|-----------|--------|-----------|
| **Claude model adapter** | Working | `server/lib/providers/adapters/claude-code.ts` — SDK `query()` |
| **Codex model adapter** | Working | `server/lib/providers/adapters/codex.ts` — CLI subprocess |
| **Anthropic Direct adapter** | Working | `server/lib/providers/adapters/anthropic-direct.ts` — Messages API |
| **SLURM execution strategy** | Working (but lives in providers/) | `packages/agent-runner/src/providers/slurm-adapter.ts` — sbatch/squeue |
| **Direct execution** | Working (implicit) | Built into each adapter — they all fork/exec |
| **WebSocket relay** | Working | `server/lib/relay-server.ts` — WS hub on port 3002 |
| **Machine registry** | Working | `server/lib/machine-registry.ts` — tracks connected machines |
| **Agent-runner** | Working | `packages/agent-runner/` — connects to relay, executes tasks |
| **SSH setup CLI** | Working (interactive) | `ssh-installer.ts` + `ssh-discovery.ts` |
| **Device auth flow** | Working | `server/routes/device-auth.ts` + setup.ts |

### 5.6 What We Need to Build

| Work Item | Description |
|-----------|-------------|
| **Split AgentProvider into AgentModel + ExecutionStrategy** | The central refactor. Move SLURM out of providers into execution strategies. Make Direct execution explicit (not implicit). |
| **Agent model: None / passthrough** | For pure compute tasks (training, tests, deploy). Receives a command, delegates to execution strategy, streams output. No AI API calls. |
| **Execution strategy: Docker** | `docker run` with mounted volumes. Detect via `docker info`. |
| **Execution strategy: K8s Job** | `kubectl create job` for nodes with kubectl access. Detect via `kubectl cluster-info`. |
| **Two-dimensional node registration** | Agent-runner registers both `agentModels[]` and `executionStrategies[]` to relay. |
| **Two-dimensional routing** | Dispatch engine matches task requirements to node capabilities on both dimensions. |
| **Server deployment manifests** | K8s YAML, docker-compose, systemd — so the Astro server itself can run persistently. |
| **Agent-runner CLI polish** | Non-interactive setup, token pre-provisioning, batch SSH install. |
| **Environments UI** | Show both dimensions per machine. Assign tasks to specific machines. |

### 5.7 The Agent-Runner's Role

The agent-runner is a thin coordination layer. It does NOT replace your environment:

```
Your environment (you own this):
  ┌────────────────────────────────────────────┐
  │  conda env: ml          Docker: vllm:latest│
  │  PyTorch, CUDA          K8s node with GPU  │
  │  or: Node.js 22         or: samtools, R    │
  │  or: anything else      or: anything else  │
  └─────────────────────┬──────────────────────┘
                        │
Agent-runner (Astro provides — ~5MB):
  ┌─────────────────────▼──────────────────────┐
  │  npm install -g @astroanywhere/agent               │
  │  Connects to relay via WebSocket           │
  │  Receives task dispatches                  │
  │  Selects agent model (Claude, Codex, None) │
  │  Selects execution strategy (Direct, SLURM)│
  │  Runs the task in YOUR environment          │
  │  Streams stdout/results back to relay      │
  └────────────────────────────────────────────┘
```

### 5.8 Does the Compute Node Need Claude?

**Only if the task uses Claude as the agent model.** The answer depends entirely on what the task does:

| Task Type | Agent Model | Execution Strategy | Credentials Needed |
|-----------|-------------|-------------------|--------------------|
| Coding agent (Claude) | Claude | Direct | `ANTHROPIC_API_KEY` or `~/.claude/` |
| Coding agent (Codex) | Codex | Direct | `OPENAI_API_KEY` |
| ML training (laptop) | None | Direct | None |
| ML training (HPC) | None | SLURM | None |
| ML training (container) | None | Docker | None |
| vLLM inference | None | Direct | None |
| Run tests / deploy | None | Direct | None |
| Claude coding on HPC | Claude | SLURM | `ANTHROPIC_API_KEY` |

### 5.9 Deploying the Astro Server

The server itself can run on your laptop (dev), a dedicated server, or a long-lived K8s pod. It needs:
- Node.js 22+, the Astro npm packages
- `RELAY_JWT_SECRET` for auth
- `ANTHROPIC_API_KEY` (for plan generation in the UI)
- Network reachability from all compute nodes (HTTP :3001 + WebSocket :3002)

**K8s deployment** (recommended for teams):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: astro-server }
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: astro
        image: ghcr.io/fuxialexander/astro-server:latest
        ports:
        - { containerPort: 3001, name: api }
        - { containerPort: 3002, name: relay }
        env:
        - { name: RELAY_JWT_SECRET, valueFrom: { secretKeyRef: { name: astro, key: jwt } } }
        - { name: ANTHROPIC_API_KEY, valueFrom: { secretKeyRef: { name: astro, key: anthropic } } }
        volumeMounts:
        - { name: data, mountPath: /data }
---
apiVersion: v1
kind: Service
metadata: { name: astro-server }
spec:
  ports:
  - { port: 3001, name: api }
  - { port: 3002, name: relay }
```

### 5.10 Setting Up Nodes

**SSH server / VM (direct execution):**

```bash
conda activate ml                                    # your environment
npm install -g @astroanywhere/agent                          # agent-runner
astro-agent setup --relay wss://astro-server:3002    # authenticate
export ANTHROPIC_API_KEY=sk-ant-...                  # only if running AI tasks
astro-agent start                                     # connect to relay
```

**K8s (add to your existing image):**

```dockerfile
FROM pytorch/pytorch:2.4-cuda12.1-cudnn9-runtime     # YOUR base image
RUN pip install transformers datasets                 # YOUR dependencies
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g @astroanywhere/agent                    # agent-runner
CMD ["astro-agent", "start", "--relay", "ws://astro-server.default.svc:3002"]
```

### 5.11 Architecture Decisions

**ADR-008: Hub model — server does not manage compute**

The server is a passive hub. Compute nodes are set up independently. Each node runs the agent-runner, which connects to the relay and registers capabilities. The server dispatches tasks to connected machines based on capabilities.

**ADR-009: Separate agent models from execution strategies**

Agent models (Claude, Codex, DeepSeek, None) and execution strategies (Direct, SLURM, Docker, K8s Job) are orthogonal dimensions. The codebase must not conflate them into a single `AgentProvider` interface. SLURM is an execution strategy, not an AI model. Each node registers both dimensions independently.

---

## 6. Pillar 1: Observability — PARTIALLY IMPLEMENTED

> **Status**: Core backend (observation collector, DB schema, query API) and trace viewer UI are implemented on `zhuoran/observability-trace-viewer`. Analytics dashboard and safety UI are pending. See Phase 1 in section 11 for details.

### 6.1 The Problem (Solved)

Astro previously captured streaming events (stdout, tool traces, file changes, progress) during task execution, but:

- **No persistent dialogue storage**: Conversations were streamed and displayed but not durably stored with structure — **now stored in `observation_events` table**
- **No cross-session analytics**: Couldn't answer "how many tokens did agent X use this week?" — **stats endpoint implemented, analytics dashboard pending**
- **No replay capability**: Couldn't replay an agent's full reasoning chain — **trace viewer with turn-based replay implemented**

### 6.2 Architecture: SDK-Native Observation Pipeline

With the Claude Agent SDK as the standard execution path, observability leverages the SDK's native capabilities:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Agent Execution Sources                      │
│                                                                   │
│  ┌──────────────────────┐  ┌───────────────────────────────┐    │
│  │ Claude Agent SDK      │  │ CLI Fallback                  │    │
│  │ (primary path)        │  │ (transcript_path + JSONL)     │    │
│  │                       │  │                               │    │
│  │ - SDKMessage stream   │  │ - Read transcript file        │    │
│  │ - PreToolUse hooks    │  │ - Tail JSONL logs             │    │
│  │ - PostToolUse hooks   │  │ - Parse stdout markers        │    │
│  │ - SessionStart/End    │  │                               │    │
│  │ - SDKResultMessage    │  │                               │    │
│  │   (cost, tokens,      │  │                               │    │
│  │    modelUsage, turns)  │  │                               │    │
│  └──────────┬────────────┘  └──────────────┬────────────────┘    │
│             │                               │                     │
│             ▼                               ▼                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Observation Collector (server-side)            │  │
│  │                                                             │  │
│  │  Normalizes all sources into ObservationEvent records       │  │
│  │  Assigns: executionId, timestamp, sequence, type            │  │
│  └──────────────────────┬──────────────────────────────────┘  │
│                          │                                     │
│         ┌────────────────┼───────────────────┐                 │
│         ▼                ▼                   ▼                 │
│  ┌────────────┐  ┌────────────────┐  ┌──────────────────┐     │
│  │ Event Store │  │ Real-time SSE  │  │ Safety Rail      │     │
│  │ (SQLite /   │  │ (existing)     │  │ Engine           │     │
│  │  Postgres)  │  │                │  │ (see Pillar 2)   │     │
│  └────────────┘  └────────────────┘  └──────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 SDK Hook-Based Collection (Primary Path)

The SDK hooks provide structured data at every execution point. Here's how to implement the observation hooks:

```typescript
// server/lib/observability/sdk-hooks.ts
import type { HookCallback, PreToolUseHookInput, PostToolUseHookInput } from
  '@anthropic-ai/claude-agent-sdk';

export function createObservationHooks(collector: ObservationCollector, executionId: string) {
  const observePreToolUse: HookCallback = async (input, toolUseID, { signal }) => {
    const pre = input as PreToolUseHookInput;
    collector.record({
      executionId,
      type: 'tool_call',
      toolName: pre.tool_name,
      toolInput: pre.tool_input,
      toolUseId: toolUseID,
      sessionId: pre.session_id,
      cwd: pre.cwd,
    });
    return {}; // Allow the tool call to proceed
  };

  const observePostToolUse: HookCallback = async (input, toolUseID, { signal }) => {
    const post = input as PostToolUseHookInput;
    collector.record({
      executionId,
      type: 'tool_result',
      toolName: post.tool_name,
      toolInput: post.tool_input,
      toolResult: post.tool_response,
      toolUseId: toolUseID,
    });
    return {};
  };

  const observeSessionEnd: HookCallback = async (input, toolUseID, { signal }) => {
    collector.record({
      executionId,
      type: 'session_end',
      reason: (input as any).reason,
    });
    return {};
  };

  return {
    PreToolUse:  [{ hooks: [observePreToolUse] }],
    PostToolUse: [{ hooks: [observePostToolUse] }],
    SessionEnd:  [{ hooks: [observeSessionEnd] }],
    Notification:[{ hooks: [async (input) => {
      collector.record({ executionId, type: 'notification', content: (input as any).message });
      return {};
    }]}],
  };
}
```

And in the provider adapter:

```typescript
// Enhanced claude-code.ts provider adapter
async *stream(task: TaskDispatch): AsyncGenerator<StreamEvent> {
  const collector = new ObservationCollector(task.taskId);
  const observationHooks = createObservationHooks(collector, task.executionId);
  const safetyHooks = createSafetyHooks(safetyEngine, task.executionId);

  const q = query({
    prompt: task.prompt,
    options: {
      hooks: mergeHooks(observationHooks, safetyHooks),
      maxBudgetUsd: task.costLimit,
      canUseTool: (toolName, input, opts) => safetyEngine.evaluate(toolName, input, opts),
      mcpServers: { 'astro-tools': astroMcpServer },
      // ...existing options
    }
  });

  for await (const msg of q) {
    // Record every SDK message for full dialogue replay
    collector.recordMessage(msg);

    // Also yield existing StreamEvents for backwards compatibility
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if ('text' in block) yield { type: 'text', text: block.text };
        if ('name' in block) yield { type: 'tool_use', toolName: block.name, toolInput: block.input };
      }
    }
    if (msg.type === 'result') {
      yield {
        type: 'result',
        result: {
          status: msg.subtype === 'success' ? 'success' : 'failure',
          metrics: {
            totalCostUsd: msg.total_cost_usd,
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
            turnsUsed: msg.num_turns,
            durationMs: msg.duration_ms,
            modelUsage: msg.modelUsage, // NEW: per-model breakdown
          }
        }
      };
    }
  }
}
```

### 6.4 CLI Fallback Collection

For remote machines using the CLI, the hook input type `BaseHookInput` includes `transcript_path` -- a file containing the full conversation. The agent-runner can read this:

```typescript
// packages/agent-runner/src/watchers/transcript-watcher.ts
class TranscriptWatcher {
  watch(transcriptPath: string, onEvent: (event: ObservationEvent) => void) {
    // The transcript file is written by Claude Code during execution
    // Watch for changes and parse new entries
    fs.watch(transcriptPath, () => {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const messages = JSON.parse(content); // Array of SDK-format messages
      for (const msg of messages.slice(this.lastIndex)) {
        onEvent(this.normalize(msg));
        this.lastIndex++;
      }
    });
  }
}
```

### 6.5 ObservationEvent Schema

```typescript
interface ObservationEvent {
  id: string;                          // UUID
  executionId: string;                 // Links to task execution
  projectId: string;
  taskId: string;
  machineId?: string;
  providerId: string;

  timestamp: Date;
  sequence: number;

  type: ObservationEventType;

  // SDK message data (stored as-is for full fidelity)
  sdkMessageType?: string;            // 'assistant', 'user', 'result', 'system'
  sdkMessageUuid?: string;            // From SDKMessage.uuid
  sessionId?: string;                 // From SDKMessage.session_id

  // Parsed fields for querying
  role?: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolSuccess?: boolean;
  toolUseId?: string;                 // Correlates PreToolUse with PostToolUse

  filePath?: string;
  fileAction?: 'create' | 'modify' | 'delete';
  diffSummary?: string;

  metrics?: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    durationMs?: number;
    turnsUsed?: number;
    model?: string;
    modelUsage?: Record<string, { inputTokens: number; outputTokens: number; costUSD: number }>;
  };

  errorMessage?: string;
  errorRecoverable?: boolean;
}

type ObservationEventType =
  | 'session_start'
  | 'turn_start'
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'file_change'
  | 'progress'
  | 'approval_request'
  | 'approval_response'
  | 'steer'
  | 'error'
  | 'session_end'
  | 'cost_checkpoint'
  | 'notification'
  | 'compact_boundary'          // NEW: conversation was compacted
  | 'subagent_start'            // NEW: subagent spawned
  | 'subagent_stop';            // NEW: subagent completed
```

### 6.6 Storage, Querying, and Frontend

(Same as previous revision -- database schema, query API endpoints, dialogue viewer, analytics dashboard. See database schema in section 4.5 of the previous revision.)

#### Query API Endpoints

```
GET /api/observations/:executionId          -- Full dialogue replay
GET /api/observations/:executionId/summary  -- Execution summary
GET /api/observations/project/:projectId    -- Project-level aggregates
GET /api/observations/analytics             -- Cross-project analytics
  ?period=day|week|month
  &metric=cost|tokens|tasks|duration
  &groupBy=provider|machine|project
```

#### Frontend: Dialogue Viewer

Add a **Dialogue Replay** tab to the task-detail page:

- Render the full agent conversation as a chat UI
- Show tool calls inline with expandable input/output
- Highlight file changes with diff previews
- Show cost accumulation as the conversation progresses
- Allow searching within the dialogue
- Timeline scrubber for long conversations

#### Frontend: Analytics Dashboard

Add an **Analytics** section to the dashboard:

- **Cost over time**: Line chart of daily/weekly spending by project/provider
- **Token usage**: Bar chart of input vs output tokens
- **Per-model breakdown**: Leverage `modelUsage` from SDK results for granular cost attribution
- **Task metrics**: Completion rate, average duration, average turns
- **Provider breakdown**: Usage distribution across Claude Code, Codex, etc.
- **Machine utilization**: Activity heatmap across connected machines
- **Anomaly alerts**: Flag executions with unusually high cost or token usage

---

## 7. Pillar 2: Safety Rails

### 7.1 SDK-Native Safety Implementation

The Claude Agent SDK provides two direct enforcement mechanisms:

1. **`hooks.PreToolUse`**: Evaluate every tool call before execution. Return `permissionDecision: 'deny'` to block.
2. **`canUseTool` callback**: Custom permission function called for every tool use. Return `{ behavior: 'deny', message: '...' }` to block.
3. **`maxBudgetUsd`**: Hard cost cap. The SDK automatically terminates when exceeded with `error_max_budget_usd` result subtype.

This means safety rails don't need a separate engine -- they're hooks in the SDK execution pipeline.

### 7.2 Implementation: Safety as SDK Hooks

```typescript
// server/lib/safety/sdk-safety-hooks.ts
export function createSafetyHooks(engine: SafetyEngine, executionId: string) {

  const costGuard: HookCallback = async (input, toolUseID, { signal }) => {
    const pre = input as PreToolUseHookInput;
    const verdict = engine.checkCost(executionId);
    if (verdict.action === 'warn') {
      return { systemMessage: `Warning: cost approaching limit (${verdict.reason})` };
    }
    if (verdict.action === 'pause') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Paused: ${verdict.reason}. Awaiting approval.`
        }
      };
    }
    return {};
  };

  const behaviorGuard: HookCallback = async (input, toolUseID, { signal }) => {
    const pre = input as PreToolUseHookInput;
    const verdict = engine.checkBehavior(pre.tool_name, pre.tool_input, executionId);
    if (verdict.action === 'abort') {
      return {
        continue: false,
        stopReason: verdict.reason,
      };
    }
    if (verdict.action === 'deny') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: verdict.reason,
        }
      };
    }
    return {};
  };

  return {
    PreToolUse: [
      { hooks: [costGuard, behaviorGuard] },                    // All tools
      { matcher: 'Bash', hooks: [dangerousCommandGuard] },      // Bash-specific
      { matcher: 'Write|Edit', hooks: [sensitiveFileGuard] },   // File-specific
      { matcher: '^mcp__', hooks: [mcpToolGuard] },             // MCP tools
    ],
    PostToolUse: [
      { hooks: [secretExposureGuard] },  // Check tool output for leaked secrets
    ],
  };
}
```

### 7.3 The `canUseTool` Callback (Complementary)

For permission-mode-based safety:

```typescript
const safetyPermissionHandler: CanUseTool = async (toolName, input, { signal, suggestions }) => {
  // Cost check
  const costVerdict = safetyEngine.checkCost(executionId);
  if (costVerdict.action === 'abort') {
    return { behavior: 'deny', message: costVerdict.reason };
  }

  // Behavior check
  const behaviorVerdict = safetyEngine.checkBehavior(toolName, input, executionId);
  if (behaviorVerdict.action === 'deny') {
    return { behavior: 'deny', message: behaviorVerdict.reason };
  }

  // Auto-approve safe operations
  if (safetyEngine.isSafeOperation(toolName, input)) {
    return { behavior: 'allow', updatedInput: input };
  }

  // Defer to user for uncertain cases
  return { behavior: 'deny', message: 'Requires manual approval', interrupt: true };
};
```

### 7.4 Built-in Safety Rules

| Rule | Hook | Trigger | Default Action |
|------|------|---------|----------------|
| `cost-per-task` | `maxBudgetUsd` | SDK native | SDK auto-terminates |
| `cost-per-hour` | PreToolUse | Running cost > hourly limit | pause |
| `cost-per-day` | PreToolUse | Running cost > daily limit | abort |
| `tool-loop-detector` | PreToolUse | Same tool 5+ times with similar input | pause |
| `dangerous-command` | PreToolUse (Bash) | `rm -rf /`, `git push --force`, `DROP TABLE` | abort |
| `secret-exposure` | PostToolUse | API keys, passwords in tool output | pause |
| `sensitive-file` | PreToolUse (Write\|Edit) | `.env`, `*.pem`, `*.key`, `credentials` | warn |
| `excessive-turns` | PreToolUse | Turn count > configurable limit | pause |
| `error-cascade` | PostToolUseFailure | 3+ consecutive failures | pause |
| `scope-drift` | PreToolUse (Write\|Edit) | Files outside expected scope | warn |

### 7.5 Autonomy Levels

```typescript
type AutonomyLevel = 'supervised' | 'semi-autonomous' | 'autonomous';
```

Maps to SDK permission modes:

| Autonomy | SDK `permissionMode` | SDK `canUseTool` | SDK `maxBudgetUsd` |
|----------|---------------------|-------------------|---------------------|
| supervised | `'default'` | Always returns `deny` + `interrupt: true` | Low |
| semi-autonomous | `'acceptEdits'` | Custom safety checks, auto-approve safe ops | Medium |
| autonomous | `'bypassPermissions'` + safety hooks | N/A (bypassed) | High |

### 7.6 Audit Log

Every safety evaluation is logged (same as previous revision). Queryable via API for compliance and debugging.

---

## 8. Pillar 3: Skills System

### 8.1 Design: SDK-Integrated Skills

With the SDK, skills can be delivered via three mechanisms:

1. **In-process MCP tools** (`createSdkMcpServer()` + `tool()`): Most observable, lowest latency
2. **External MCP servers** (stdio/SSE/HTTP): For complex skills that need their own process
3. **SDK Plugins** (`plugins: [{ type: 'local', path: './my-skill' }]`): The SDK's native extension mechanism

### 8.2 In-Process MCP Skills (Recommended)

```typescript
// server/lib/skills/skill-mcp-server.ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const runTests = tool(
  'run_tests',
  'Run the project test suite and return results',
  { testPattern: z.string().optional(), coverage: z.boolean().default(false) },
  async (args) => {
    const result = await executeTests(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

const createPR = tool(
  'create_pull_request',
  'Create a GitHub pull request from current changes',
  { title: z.string(), body: z.string(), draft: z.boolean().default(false) },
  async (args) => {
    const pr = await createGitHubPR(args);
    return { content: [{ type: 'text', text: `PR created: ${pr.url}` }] };
  }
);

export const skillServer = createSdkMcpServer({
  name: 'astro-skills',
  tools: [runTests, createPR, /* ...more skills */],
});
```

Then inject into every agent execution:

```typescript
const q = query({
  prompt: taskPrompt,
  options: {
    mcpServers: {
      'astro-tools': astroToolsServer,   // Existing platform tools
      'astro-skills': skillServer,        // NEW: skill tools
    },
  }
});
```

### 8.3 Skills Directory Structure

(Same as previous revision -- `astro/skills/` with `registry.json`, `built-in/`, `community/`, `custom/`.)

### 8.4 Built-in Skills (Initial Set)

| Skill | Description | SDK Integration |
|-------|-------------|----------------|
| `run-tests` | Run project test suite | `tool()` MCP |
| `create-pr` | Create GitHub PR | `tool()` MCP |
| `deploy-staging` | Deploy to staging | `tool()` MCP |
| `analyze-logs` | Search and summarize logs | `tool()` MCP |
| `security-scan` | Run security scanners | `tool()` MCP |
| `schedule-task` | Schedule a future task (inspired by HappyClaw) | `tool()` MCP |
| `memory-recall` | Cross-session memory lookup (inspired by HappyClaw) | `tool()` MCP |

---

## 9. Pillar 4: Editor / UI Integration

### 9.1 The Philosophy

> "If it is not necessary, we don't want people to look into the code detail. Just use PR and unit test to make the agent do all the work and humans play the role of a manager."

### 9.2 Three Options (Ordered by Pragmatism)

**Option C: Enhance existing web UI** (start here)
- Monaco Editor embedded in task-detail for diff viewing
- Enhance existing `file-changes-view.tsx` with richer diffs
- Click-to-expand diffs inline in the dialogue replay
- No new codebase required

**Option A: VS Code Extension** (next)
- Lightweight sidebar panel via WebView loading stripped Astro React app
- Uses VS Code's built-in `vscode.diff` for file comparisons
- Read-only monitoring -- no code editing features

**Option B: Standalone Agent Viewer** (future)
- Dedicated Electron app with agent-first design (shipped — see `docs/design/ELECTRON_APP.md`)
- Agent grid as primary view, code as secondary
- Deferred until web UI and VS Code extension prove the concept

### 9.3 SDK's File Checkpointing

The SDK offers `enableFileCheckpointing: true` which tracks all file changes and allows `rewindFiles(userMessageUuid)` to roll back. This directly supports the "click to see what changed" use case:

```typescript
const q = query({
  prompt: taskPrompt,
  options: {
    enableFileCheckpointing: true,
    // ...
  }
});

// Later, in the UI, user wants to see state at a specific point:
await q.rewindFiles(selectedMessageUuid);
// Files are restored to that point for comparison
```

---

## 10. Pillar 5: Features to Adopt from Reference Packages

Analysis of features from HappyClaw, OpenClaw, OpenCode, and ZeroClaw that Astro should adopt.

### 8.1 From HappyClaw

| Feature | Priority | Rationale |
|---------|----------|-----------|
| **Scheduled / autonomous tasks** | High | Cron/interval/once scheduling for 24/7 agent operation. Astro currently only dispatches tasks manually or via dependency resolution. Add a task scheduler that triggers agent tasks on schedule. |
| **Cross-session memory** | High | Multi-layer memory (user global, session private, daily logs). For 24/7 agents, they need to remember past work across sessions. Store as CLAUDE.md injection or SDK `systemPrompt` appendage. |
| **IM channel integration** | Medium | Slack/Discord/Telegram notifications for task completion, safety alerts, approval requests. Not full IM-based interaction (that's HappyClaw's niche), but notification forwarding. |
| **Web terminal access** | Medium | xterm.js access to agent execution environments. Useful for debugging when you need to inspect the agent's workspace. |
| **PWA / mobile support** | Low | Mobile-friendly dashboard for monitoring agents on the go. Current Astro UI is desktop-first. |
| **Per-user AI personality** | Low | Customizable agent name/avatar. Nice for multi-user environments. |

### 8.2 From OpenClaw

| Feature | Priority | Rationale |
|---------|----------|-----------|
| **Diagnostic event system** | High | Input provenance tracking (which channel/user triggered what). Helps audit who requested which agent task. |
| **Rolling log buffer** | Medium | Bounded log storage with automatic rotation. Prevents observation data from growing unbounded. |
| **Tool loop detection** | High | Already planned in safety rails. OpenClaw's pattern (detect identical tool calls) validates the approach. |

### 8.3 From OpenCode

| Feature | Priority | Rationale |
|---------|----------|-----------|
| **Desktop app (Electron)** | Shipped | Astro's standalone desktop client is delivered as an Electron app (`electron/` directory). See `docs/design/ELECTRON_APP.md` for the architecture. |
| **Plugin/extension system** | Medium | The SDK now has `plugins` support. Build on this for Astro-specific extensions. |
| **Multi-agent switching** | Medium | OpenCode supports 2 built-in agents. Astro should make it easy to switch providers per task (already has the architecture, needs UI polish). |
| **Session context metrics** | High | OpenCode's `AsyncLocalStorage` pattern for tracking per-session metrics. Adopt for Astro's observation pipeline. |

### 8.4 From ZeroClaw

| Feature | Priority | Rationale |
|---------|----------|-----------|
| **Trait-based observer architecture** | High | Already adopted conceptually. The SDK hooks are the TypeScript equivalent. |
| **Three-tier budget enforcement** | High | `Allowed` / `Warning` / `Exceeded` maps to Astro's cost guard `allow` / `warn` / `abort`. |
| **JSONL cost persistence** | Medium | Persistent cost tracking across sessions. Implement via observation events stored in SQLite. |
| **SkillForge pipeline** | Low | Scout/Evaluate/Integrate for skill discovery. Future enhancement for community skills. |
| **Hardware discovery** | Low | Relevant only if Astro targets edge deployment. |
| **Autonomy levels** | High | Already adopted (`supervised` / `semi-autonomous` / `autonomous`). |

### 8.5 Composite Feature: Agent Memory System

Inspired by HappyClaw's multi-layer memory, Astro should implement:

```
Memory Layers:
1. Project Memory     → Stored as project vision doc (existing)
2. Agent Memory       → CLAUDE.md files per project/workspace
3. Session Memory     → SDK session continuity (resume/fork)
4. Cross-Session      → Observation summaries injected into new sessions
5. Organizational     → Shared knowledge base across projects
```

Implementation:
- Layer 1-2: Already exists (vision doc, CLAUDE.md via `settingSources: ['project']`)
- Layer 3: SDK `resume` option
- Layer 4: New -- query `execution_summaries` for relevant past executions, inject as context
- Layer 5: New -- shared skills + knowledge base (future)

### 8.6 Composite Feature: Task Scheduling

Inspired by HappyClaw's scheduler:

```typescript
interface ScheduledTask {
  id: string;
  projectId: string;
  taskId: string;               // Links to plan node
  schedule: {
    type: 'cron' | 'interval' | 'once';
    value: string;              // Cron expression, ms interval, or ISO 8601 datetime
    timezone?: string;
  };
  context: 'project' | 'isolated';  // Use project context or start fresh
  enabled: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
}
```

Add to Astro server as a scheduler service that triggers task dispatch on schedule. Use `node-cron` or `croner` for cron parsing. Store schedules in the existing database.

---

## 11. Implementation Phases

### Phase 0: Local/Server Mode Clean Separation -- COMPLETE

**Status**: Merged to main (PR #82, Feb 2026)

**Goal**: Fix 4 data persistence gaps and introduce `isLocalMode()`/`isServerMode()` abstraction.

**What was delivered**:
- `src/lib/app-mode.ts` + `server/lib/app-mode.ts` -- mode detection API
- `activity-store.ts` rewritten to standard pattern (was IndexedDB-only)
- `sidebar-store.ts` routed through `dataClient` (was direct Supabase)
- `settings-store.ts` + server endpoints made functional (were stubs)
- `shouldUseSupabase()` replaced across ~30 files
- Supabase migrations: `activity_events` table, `settings` JSONB column
- 16 unit tests, build passing

**Branch**: `zhuoran/local-server-mode-refactor` (merged)

### Phase 1: Observability Backend + Trace Viewer -- COMPLETE

**Status**: Implemented on `zhuoran/observability-trace-viewer` branch

**Goal**: Persistent observation storage, query API, and trace replay UI.

**Architecture note**: The original roadmap proposed SDK hook callbacks as the collection mechanism. The actual implementation uses **event-bus subscription** instead -- the `ObservationCollector` subscribes to both `astroEventTransport` (lifecycle events) and `executionEventBus` (streaming events). This is more pragmatic because it works with the existing event infrastructure without requiring SDK hook injection changes. SDK hooks remain a future enhancement for even richer data capture.

**What was delivered**:

Backend:
- `server/lib/observability/observation-collector.ts` (870 lines) -- turn-based event grouping, tool_use/tool_result correlation, batch buffering (50 events / 5s flush), markdown summary generation
- `server/lib/observability/types.ts` -- ObservationEvent schema with hierarchical parent/child relationships
- `server/lib/observability/safety-rails.ts` -- cost tracking + tool allowlist gating (stubs for enforcement)
- `server/routes/observations.ts` -- query API: list (filterable), get by trace, summary, aggregate stats
- `server/lib/db/schema.ts` -- `observationEvents` table (Drizzle)
- Database migrations: `drizzle/0006_observation_events.sql` + `supabase/migrations/20260219000003_observation_events.sql`
- `server/lib/providers/adapters/claude-code.ts` -- fixed `toolUseId` propagation, `toolName` resolution via `Map<toolUseId, toolName>` lookup

Frontend:
- `src/components/task-detail/trace-viewer/` -- 6 components (index, summary-card, turn-list, turn-detail, tool-call-item, collapsible-content)
  - Split-panel UI: left (40%) shows turn list, right (60%) shows selected turn detail
  - TraceSummaryCard: turns, tool calls, model, tokens, cost, duration, error count
  - Auto-polling every 3s while task is running
  - Graceful fallback to flat event list for providers without structured observations
- `src/stores/observation-store.ts` -- Zustand store with `buildTraceTree()` transformer
- `src/types/observations.ts` -- frontend type definitions
- `src/lib/api-client.ts` -- `fetchTraceObservations()` + `fetchTraceStats()`
- `src/pages/task-detail.tsx` -- added "Trace" tab

Testing:
- `server/lib/observability/__tests__/observation-collector.test.ts` (841 lines, 31 tests)
- `server/lib/providers/adapters/__tests__/claude-code-adapter.test.ts` (452 lines, 7 tests)
- `src/stores/__tests__/observation-store.test.ts` (586 lines, 23 tests)
- `tests/smoke-trace-viewer.test.ts` (442 lines, 4 integration tests)
- `scripts/test-trace-viewer.sh` (231 lines)
- **Total: 169 tests passing**

### Phase 2: Analytics Dashboard + Safety UI -- PENDING

**Goal**: Cross-session analytics, cost dashboards, safety configuration UI.

**Files to create/modify**:
- `src/pages/analytics.tsx` -- new page: cost over time, token usage, per-model breakdown, task metrics, machine utilization
- `src/components/safety/` -- safety alert components, rule configuration
- `src/stores/safety-store.ts` -- safety config and alert state
- `server/routes/safety.ts` -- safety config and audit log API
- `server/lib/safety/engine.ts` -- safety rule evaluation engine (upgrade from current stubs)
- `server/lib/safety/cost-guard.ts` -- cost threshold monitoring
- `server/lib/safety/rules/` -- built-in safety rule definitions

**Depends on**: Phase 1 observation data being populated in production use

### Phase 2.5: SDK Hook Enhancement -- PENDING

**Goal**: Upgrade from event-bus-based collection to direct SDK hook callbacks for richer data capture.

**What this adds over Phase 1**:
- `PreToolUse` hooks capture tool inputs before execution (currently only captured after)
- `PostToolUse` hooks capture results with full SDK context
- `SessionStart`/`SessionEnd` hooks for precise session lifecycle tracking
- `Notification` hooks for forwarding SDK notifications to SSE
- `canUseTool` callback integration for real-time safety enforcement

**Files to create/modify**:
- `server/lib/observability/sdk-hooks.ts` -- observation hook callbacks
- `server/lib/safety/sdk-safety-hooks.ts` -- safety hook callbacks
- `server/lib/providers/adapters/claude-code.ts` -- inject hooks into `query()` options

### Phase 3: Remote Agent Observability -- PENDING

**Goal**: Capture structured dialogues from remote agent-runners.

**Files to create/modify**:
- `packages/agent-runner/` -- migrate to SDK-based execution
- `packages/agent-runner/src/watchers/transcript-watcher.ts` -- transcript file reader
- `server/types/relay.ts` -- add `task.observation` message type
- `server/lib/relay-server.ts` -- handle observation messages from runners

### Phase 4: Skills + Memory + Scheduling -- PENDING

**Goal**: Extensible skills, cross-session memory, and task scheduling.

**Files to create/modify**:
- `astro/skills/` -- skill directories with manifests and handlers
- `server/lib/skills/` -- registry, loader
- `server/lib/skills/skill-mcp-server.ts` -- in-process MCP skill server
- `server/lib/scheduler/` -- task scheduling service
- `server/lib/memory/` -- cross-session memory injection

### Phase 5: Editor Integration -- PENDING

**Goal**: Enhanced web UI diff viewer + VS Code extension.

**Files to create/modify**:
- `src/components/task-detail/file-changes-view.tsx` -- enhanced with Monaco diff
- `src/components/task-detail/trace-viewer/` -- click-to-diff links in trace viewer
- `packages/vscode-extension/` -- new VS Code extension (future)

---

## 12. Architecture Decisions

### ADR-001: Standardize on Claude Agent SDK over CLI

**Context**: Astro uses both the SDK (local) and CLI (remote). Hooks, sessions, and safety features are only available via SDK.

**Decision**: Make the SDK the primary execution path everywhere. Keep CLI as fallback only.

**Rationale**: SDK hooks provide observability and safety for free. `SDKMessage` stream is already structured -- no parsing needed. Cost control via `maxBudgetUsd` is native. Session resume/fork supports the task branching model.

### ADR-002: Stay with TypeScript, not Rust

**Context**: ZeroClaw shows Rust achieves <5MB memory vs Node.js's ~100-200MB.

**Decision**: Keep TypeScript for all core components. Consider Rust only for future performance-critical sidecars.

**Rationale**: The Claude Agent SDK is TypeScript/Python only. Rewriting in Rust would require FFI bridges or reimplementation. The memory overhead is acceptable for a cloud orchestration platform. The SDK's hooks, sessions, sandbox, and MCP integration are too valuable to lose.

### ADR-003: Safety rails implemented as SDK hooks, not separate engine

**Context**: Safety could be a separate process evaluating events, or inline SDK hooks.

**Decision**: Implement as SDK `PreToolUse`/`PostToolUse` hooks + `canUseTool` callback + `maxBudgetUsd`.

**Rationale**: SDK hooks execute before the tool call, enabling real-time blocking. No separate IPC or message queue needed. The SDK's permission decision flow (`deny` → `ask` → `allow`) is purpose-built for this.

### ADR-004: Observation events stored server-side only

**Context**: Could store in IndexedDB (client) or SQLite/Postgres (server).

**Decision**: Server-side only. Frontend queries via API.

**Rationale**: Observation events are high-volume (full dialogues). Would exhaust browser storage. Server-side enables cross-device access and analytics.

### ADR-005: Skills use SDK's in-process MCP server

**Context**: Skills could be external MCP processes, REST handlers, or in-process.

**Decision**: Use `createSdkMcpServer()` + `tool()` for most skills. External MCP for complex ones.

**Rationale**: In-process is fastest, most observable, and requires no subprocess management. The SDK's `tool()` helper provides Zod schema validation. External MCP servers are still supported for skills that need isolation.

### ADR-006: Memory system uses SDK session resume + context injection

**Context**: Cross-session memory could be a custom database, or leverage SDK sessions.

**Decision**: Layer 1-3 via SDK (`resume`, `forkSession`, `settingSources`). Layer 4-5 via context injection from observation summaries.

**Rationale**: The SDK already handles session persistence. For cross-session memory, query past execution summaries from the observation database and inject as `systemPrompt` context. No custom memory infrastructure needed.

---

## Summary

| Pillar | Key Deliverable | SDK Feature Leveraged |
|--------|----------------|----------------------|
| **Observability** | Persistent dialogue storage + replay + analytics | `SDKMessage` stream, `PostToolUse` hooks, `SDKResultMessage.modelUsage` |
| **Safety Rails** | Cost guards + behavior analysis + audit log | `PreToolUse` hooks, `canUseTool`, `maxBudgetUsd`, `SandboxSettings` |
| **Skills** | MCP-based extensible skill system | `createSdkMcpServer()`, `tool()`, `plugins` |
| **Editor/UI** | Web diff viewer + VS Code extension | `enableFileCheckpointing`, `rewindFiles()` |
| **Cross-Package** | Memory, scheduling, IM notifications | `resume`/`forkSession`, `settingSources`, `Notification` hooks |

Each pillar builds on the previous one. The SDK is the foundation -- its hooks provide observability, safety, and extensibility natively. The strategic choices (SDK over CLI, TypeScript over Rust) are driven by this dependency.
