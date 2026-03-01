# AI Provider Adoption: OpenClaw, OpenCode, and Future Providers

## Overview

This document analyzes the current integration of OpenClaw and OpenCode in Astro, identifies gaps, proposes improvements for observability, SDK-based execution, social media integration, and lays out a strategy for adopting additional AI providers in the future.

## Current State

### Provider Architecture in Astro

Astro's agent-runner has a pluggable provider system with 5 active adapters:

| Provider | Type | Execution Model | Observability | Maturity |
|----------|------|-----------------|---------------|----------|
| **Claude Code (SDK)** | `claude-sdk` | In-process (npm `@anthropic-ai/claude-agent-sdk`) | Full: streaming events, tool traces, file changes, approvals, steering, MCP | **Production** |
| **Claude Code (CLI)** | `claude-code` | Spawn `claude --print --output-format stream-json` | Full: JSONL parsing, tool_use/result correlation | **Production** |
| **Codex** | `codex` | Spawn `codex --json` | Good: turn-based events, item tracking | **Tested** |
| **OpenClaw** | `openclaw` | Spawn `openclaw agent --mode rpc --json` | Basic: JSONL events, metrics | **Untested** |
| **OpenCode** | `opencode` | Spawn `opencode run --print --output-format json` | Basic: JSONL events, metrics | **Untested** |

### What Exists (Agent-Runner)

**File locations:**
- `packages/agent-runner/src/providers/openclaw-adapter.ts` — CLI-spawning adapter
- `packages/agent-runner/src/providers/opencode-adapter.ts` — CLI-spawning adapter
- `packages/agent-runner/src/providers/base-adapter.ts` — Shared interface
- `packages/agent-runner/src/providers/index.ts` — Provider factory + registry
- `packages/agent-runner/src/lib/providers.ts` — Detection (PATH + common install locations)

**How providers are currently called:**

1. **OpenClaw**: `openclaw agent --mode rpc --json --prompt "<task>"`
   - Parses JSONL events: session.start, content.text, tool_use.start/end, file.change, session.end
   - Extracts metrics from session.end event

2. **OpenCode**: `opencode run --print --output-format json "<task>"`
   - Parses JSONL events: system, assistant, tool_result, result
   - Handles both direct tool_result format and content block format
   - Flexible metric extraction (handles multiple field name variants)

**Common pattern:** Both adapters spawn a child process, parse JSONL stdout line-by-line, and map events to the `TaskOutputStream` interface (text, toolUse, toolResult, fileChange, sessionInit, status).

### What's Missing

| Gap | Impact | Priority |
|-----|--------|----------|
| **No SDK/API mode** — Both use CLI spawn, not SDK calls | No in-process control, no steering, no session resume | **Critical** |
| **No observability storage** — Events streamed but not persisted to DB | Can't query tool traces, cost history, or performance analytics | **High** |
| **No testing** — Adapters written but never tested end-to-end | Unknown if event formats match actual CLI output | **Critical** |
| **No social media integration** — OpenClaw's Telegram/Slack/WhatsApp unused | Missing a key differentiator for user engagement | **High** |
| **No planning mode** — Both only support execution, not plan generation | Can't use OpenCode/OpenClaw for AI-assisted planning | **Medium** |
| **No approval flow** — Only Claude SDK supports approvalRequest | OpenClaw/OpenCode tasks can't pause for user decisions | **Medium** |
| **No MCP integration** — Only Claude SDK integrates with MCP servers | OpenClaw/OpenCode can't use Astro's 15 MCP tools | **Medium** |
| **No concurrent tasks** — Both limited to maxTasks: 1 | Bottleneck for parallel plan execution | **Low** |

## Deep Analysis

### OpenClaw: What It Actually Is

OpenClaw is a **multi-channel AI gateway** with:

**Architecture:**
```
User (Telegram/Slack/WhatsApp/Discord/LINE/...)
       ↓ Messages
OpenClaw Gateway (WebSocket, port 18789)
       ↓ RPC
Pi Agent Runtime (embedded)
       ↓ Tool calls
File system, Browser, Canvas, Memory, etc.
```

**Key capabilities for Astro:**
1. **13+ messaging channels**: Telegram, Slack, Discord, WhatsApp, LINE, iMessage, Signal, Matrix, Google Chat, MS Teams, Nostr, IRC, WebChat
2. **WebSocket control plane**: Gateway protocol with RPC methods (chat.send, sessions.*, config.*, logs.tail)
3. **Streaming events**: ChatEvent with state machine: delta → final/aborted/error
4. **Plugin system**: Custom tools, commands, RPC methods, background services
5. **Skill system**: SKILL.md files loadable from configured paths
6. **Multi-model**: Anthropic, OpenAI, Google, Ollama, Groq, AWS Bedrock, etc.
7. **Privacy-first**: Runs locally, data stays on device

**Gateway Protocol (for SDK-style integration):**
```typescript
// Connect to gateway
ws.connect("ws://localhost:18789")

// Send chat message
ws.send({ type: "req", id: "1", method: "chat.send", params: {
  sessionKey: "session-123",
  message: "Build a REST API for user management",
  attachments: []
}})

// Receive streaming response
ws.on("message", (frame) => {
  if (frame.type === "event" && frame.event === "chat.event") {
    // { runId, seq, state: "delta"|"final"|"aborted"|"error", message, usage }
  }
})
```

### OpenCode: What It Actually Is

OpenCode is a **provider-agnostic AI coding agent** with:

**Architecture:**
```
CLI / Desktop / Web UI
       ↓
Hono.js Server (port 54321)
       ↓
Session Processor (loop: LLM → tool calls → results → LLM)
       ↓
Vercel AI SDK (streamText)
       ↓
LLM Provider (Anthropic, OpenAI, Google, etc.)
```

**Key capabilities for Astro:**
1. **REST API**: Full CRUD for sessions, messages, events
2. **Python SDK**: `opencode-ai` package with typed client, streaming SSE support
3. **JavaScript SDK**: Generated from OpenAPI spec
4. **46+ built-in tools**: bash, edit, read, glob, grep, ls, webfetch, websearch, LSP, batch, task, todo
5. **MCP support**: Full MCP v1.25.2 (stdio, SSE, HTTP transports)
6. **Session management**: Fork, branch, archive, share, summarize
7. **Multi-provider**: 20+ LLM providers including custom OpenAI-compatible servers
8. **Permission system**: Fine-grained per-agent tool permissions
9. **Event streaming**: SSE with typed events (message.updated, session.error, etc.)

**SDK Integration (Python):**
```python
from opencode_ai import Opencode

client = Opencode(base_url="http://localhost:54321")

# Create session
session = client.session.create()

# Send message and get response
response = client.session.chat(
    id=session.id,
    model_id="claude-opus",
    provider_id="anthropic",
    parts=[{"type": "text", "text": "Implement user authentication"}]
)

# Stream events
for event in client.event.list():
    if event.type == "message.part.updated":
        # Tool call progress, text deltas, etc.
        pass
```

**SDK Integration (JavaScript):**
```typescript
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk"

const server = await createOpencodeServer()
const client = createOpencodeClient({ baseUrl: server.url })

const session = await client.session.create()
await client.session.prompt({
  path: { id: session.data.id },
  body: { parts: [{ type: "text", text: "Build the API" }] }
})
```

### Comparison: How Each Provider Is Called

| Aspect | Claude Code (SDK) | Claude Code (CLI) | Codex (CLI) | OpenClaw (CLI) | OpenCode (CLI) |
|--------|-------------------|-------------------|-------------|----------------|----------------|
| **Invocation** | In-process npm import | `claude --print` | `codex --json` | `openclaw agent --mode rpc --json` | `opencode run --print` |
| **Streaming** | SDK events | JSONL stdout | JSONL stdout | JSONL stdout | JSONL stdout |
| **Tool traces** | Full (with tool_use_id correlation) | Full | Item-based | Start/end pairs | Content blocks |
| **File changes** | Via tool results | Via tool results | Via command_execution | Explicit file.change events | Not tracked |
| **Metrics** | Full (cost, tokens, turns, model) | Full | Full (OpenAI format) | Full (session.end) | Full (result event) |
| **Steering** | Yes (Query.streamInput) | No | No | No | No |
| **Approval** | Yes (AskUserQuestion tool) | No | No | No | No |
| **MCP tools** | Yes (canUseTool callback) | No | No | No | No |
| **Multi-turn** | Yes (in-process session) | No (single prompt) | No | No | No |
| **Concurrent** | 4 tasks | 1 task | 1 task | 1 task | 1 task |

### The SDK Opportunity

Both OpenClaw and OpenCode offer richer integration than CLI spawning:

**OpenClaw: Gateway WebSocket Protocol**
- Connect to the gateway at `ws://localhost:18789`
- Use RPC methods: `chat.send`, `sessions.list`, `logs.tail`
- Receive streaming ChatEvents with usage metrics
- No need to spawn a process — connect to already-running gateway

**OpenCode: REST API + Python/JS SDK**
- Connect to server at `http://localhost:54321`
- Use typed SDK: `client.session.create()`, `client.session.chat()`
- Stream events via SSE: `client.event.list()`
- Get full message history, tool traces, and session metadata
- Fork sessions for branching exploration

## Proposed Improvements

### 1. SDK-Based Adapters (Replace CLI Spawning)

#### OpenClaw SDK Adapter

Replace the CLI-spawning `OpenClawAdapter` with a WebSocket gateway client:

```typescript
// packages/agent-runner/src/providers/openclaw-sdk-adapter.ts

import WebSocket from 'ws';

export class OpenClawSdkAdapter implements ProviderAdapter {
  readonly type = 'openclaw';
  readonly name = 'OpenClaw (SDK)';

  private gateway: WebSocket | null = null;
  private gatewayUrl = 'ws://localhost:18789';
  private pendingRequests = new Map<string, { resolve, reject }>();

  async isAvailable(): Promise<boolean> {
    // Check if gateway is running
    try {
      const ws = new WebSocket(this.gatewayUrl);
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 5000);
      });
      ws.close();
      return true;
    } catch {
      return false;
    }
  }

  async execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult> {
    // Connect to gateway
    this.gateway = new WebSocket(this.gatewayUrl);

    // Authenticate
    await this.sendRpc('connect', {
      client: { name: 'astro-agent', version: '0.1.0' },
      auth: { token: process.env.OPENCLAW_GATEWAY_TOKEN }
    });

    // Create or resume session
    const sessionKey = `astro-${task.id}`;
    stream.sessionInit(sessionKey, task.model);

    // Send task prompt
    const requestId = this.sendRpc('chat.send', {
      sessionKey,
      message: task.prompt,
    });

    // Stream events
    return new Promise((resolve) => {
      this.gateway.on('message', (data) => {
        const frame = JSON.parse(data.toString());

        if (frame.type === 'event' && frame.event === 'chat.event') {
          const { state, message, usage, seq } = frame.payload;

          if (state === 'delta') {
            // Streaming text or tool use
            if (message?.content) {
              stream.text(message.content);
            }
          } else if (state === 'final') {
            // Extract metrics from usage
            resolve({
              taskId: task.id,
              status: 'completed',
              metrics: {
                inputTokens: usage?.inputTokens,
                outputTokens: usage?.outputTokens,
                totalCost: usage?.cost,
                model: usage?.model,
              }
            });
          } else if (state === 'error') {
            resolve({
              taskId: task.id,
              status: 'failed',
              error: frame.payload.errorMessage,
            });
          }
        }
      });
    });
  }
}
```

#### OpenCode SDK Adapter

Replace CLI spawning with the REST API client:

```typescript
// packages/agent-runner/src/providers/opencode-sdk-adapter.ts

export class OpenCodeSdkAdapter implements ProviderAdapter {
  readonly type = 'opencode';
  readonly name = 'OpenCode (SDK)';

  private baseUrl = 'http://localhost:54321';

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/config`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult> {
    // Create session
    const session = await this.createSession(task);
    stream.sessionInit(session.id, task.model);

    // Start SSE event listener for real-time observability
    const eventStream = this.streamEvents(session.id, stream, signal);

    // Send prompt
    const response = await fetch(`${this.baseUrl}/session/${session.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts: [{ type: 'text', text: task.prompt }],
        model: { modelID: task.model, providerID: 'anthropic' },
        system: task.systemPrompt,
      }),
      signal,
    });

    // Parse response (contains final message with all parts)
    const result = await response.json();

    // Extract metrics from response
    return {
      taskId: task.id,
      status: 'completed',
      metrics: {
        inputTokens: result.tokens?.input,
        outputTokens: result.tokens?.output,
        totalCost: result.cost,
        model: result.model,
      }
    };
  }

  private async streamEvents(sessionId: string, stream: TaskOutputStream, signal: AbortSignal) {
    const eventSource = new EventSource(`${this.baseUrl}/event`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'message.part.updated': {
          const part = data.properties;
          if (part.type === 'text') {
            stream.text(part.value);
          } else if (part.type === 'tool') {
            if (part.state.status === 'running') {
              stream.toolUse(part.tool, part.state.input);
            } else if (part.state.status === 'completed') {
              stream.toolResult(part.tool, part.state.output, true);
            } else if (part.state.status === 'error') {
              stream.toolResult(part.tool, part.state.output, false);
            }
          }
          break;
        }
        case 'session.error':
          stream.status('failed', undefined, data.properties.error);
          break;
      }
    };

    signal.addEventListener('abort', () => eventSource.close());
  }
}
```

### 2. Observability Pipeline

Currently, streaming events are emitted via `TaskOutputStream` but not persisted. We need to store them for:
- Post-execution analysis (which tools were called, what failed)
- Cost tracking per provider/model
- Performance comparison across providers
- Debugging failed executions

**Proposed: Observation Collector Integration**

The observation collector (`server/lib/observability/observation-collector.ts`) already exists. We need to wire provider events into it:

```typescript
// In dispatch-engine.ts or a new stream-observer.ts

class ObservableTaskStream implements TaskOutputStream {
  constructor(
    private inner: TaskOutputStream,
    private collector: ObservationCollector,
    private taskId: string,
    private provider: string,
  ) {}

  text(data: string) {
    this.inner.text(data);
    this.collector.addSpan({
      taskId: this.taskId,
      type: 'text',
      provider: this.provider,
      data,
      timestamp: Date.now(),
    });
  }

  toolUse(toolName: string, toolInput: unknown) {
    this.inner.toolUse(toolName, toolInput);
    this.collector.addSpan({
      taskId: this.taskId,
      type: 'tool_use',
      provider: this.provider,
      toolName,
      toolInput,
      timestamp: Date.now(),
    });
  }

  toolResult(toolName: string, result: unknown, success: boolean) {
    this.inner.toolResult(toolName, result, success);
    this.collector.addSpan({
      taskId: this.taskId,
      type: 'tool_result',
      provider: this.provider,
      toolName,
      result,
      success,
      timestamp: Date.now(),
    });
  }

  // ... wrap all methods similarly
}
```

**Database storage:**

```sql
CREATE TABLE execution_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id VARCHAR(100) NOT NULL,
  execution_id UUID REFERENCES executions(id),
  provider VARCHAR(20) NOT NULL,
  event_type VARCHAR(50) NOT NULL,  -- text, tool_use, tool_result, file_change, session_init
  tool_name VARCHAR(100),
  tool_input JSONB,
  tool_output TEXT,
  success BOOLEAN,
  timestamp TIMESTAMPTZ NOT NULL,
  metadata JSONB
);

CREATE INDEX idx_traces_task ON execution_traces(task_id);
CREATE INDEX idx_traces_execution ON execution_traces(execution_id);
CREATE INDEX idx_traces_provider ON execution_traces(provider);
```

### 3. Social Media Integration via OpenClaw

OpenClaw's killer feature for Astro is its channel system. We can:

**A. Notifications via OpenClaw Channels**

Astro already has a channel notification system (`server/lib/channel/`). OpenClaw can be a channel backend:

```typescript
// server/lib/channel/adapters/openclaw-channel.ts

class OpenClawChannelAdapter implements ChannelAdapter {
  private gateway: WebSocket;

  async sendNotification(channel: string, message: string) {
    // Route through OpenClaw gateway to any connected channel
    await this.gateway.send({
      method: 'message.send',
      params: {
        channel, // 'telegram', 'slack', 'discord', etc.
        recipient: this.config.recipientId,
        text: message,
      }
    });
  }
}
```

**B. Two-Way Interaction**

Users can interact with Astro projects via messaging platforms:

```
User (Telegram): "/plan status"
  → OpenClaw Gateway → Astro webhook → Returns plan progress

User (Slack): "Run task 5 on my HPC cluster"
  → OpenClaw Gateway → Astro dispatch API → Task executed → Result sent back to Slack

User (WhatsApp): "What's the cost so far?"
  → OpenClaw Gateway → Astro usage API → Cost summary sent back
```

**C. Approval Flow via Messaging**

When an agent needs user approval (ask_user_question), route to the user's preferred channel:

```
Agent: needs approval → Astro server → OpenClaw gateway → Telegram
User receives: "Task 'deploy API' needs your approval. Options: [Approve] [Reject] [Modify]"
User replies: "Approve"
Telegram → OpenClaw → Astro → Agent resumes
```

### 4. Planning Mode Support

Currently, OpenClaw/OpenCode are only used for task execution. We should also support plan generation:

```typescript
// In agent-runner, when task.type === 'plan':
// Use the provider's planning capability

if (task.type === 'plan') {
  // For OpenCode: use the built-in 'plan' agent (read-only mode)
  const args = ['run', '--print', '--output-format', 'json', '--agent', 'plan', effectivePrompt];

  // For OpenClaw: add planning system prompt
  const planningPrompt = `You are a planning assistant. Analyze the following goal and produce a structured plan with tasks, dependencies, and estimated effort.\n\n${effectivePrompt}`;
}
```

### 5. Testing Strategy

#### Unit Tests (Adapter Event Parsing)

Test that each adapter correctly parses its provider's output format:

```typescript
// tests/providers/openclaw-adapter.test.ts

describe('OpenClawAdapter', () => {
  it('parses session.start event', () => {
    const adapter = new OpenClawAdapter();
    const stream = createMockStream();
    const artifacts: TaskArtifact[] = [];

    adapter.handleStreamLine(
      '{"type":"session.start","session_id":"abc","model":"claude-opus-4-6"}',
      stream, artifacts
    );

    expect(stream.sessionInit).toHaveBeenCalledWith('abc', 'claude-opus-4-6');
  });

  it('parses tool_use.start/end events', () => {
    const adapter = new OpenClawAdapter();
    const stream = createMockStream();
    const artifacts: TaskArtifact[] = [];

    adapter.handleStreamLine(
      '{"type":"tool_use.start","tool_name":"bash","tool_input":{"command":"ls"}}',
      stream, artifacts
    );
    expect(stream.toolUse).toHaveBeenCalledWith('bash', { command: 'ls' });

    adapter.handleStreamLine(
      '{"type":"tool_use.end","tool_name":"bash","result":"file1.txt\nfile2.txt","success":true}',
      stream, artifacts
    );
    expect(stream.toolResult).toHaveBeenCalledWith('bash', 'file1.txt\nfile2.txt', true);
  });

  it('extracts metrics from session.end', () => {
    const adapter = new OpenClawAdapter();
    const stream = createMockStream();
    const artifacts: TaskArtifact[] = [];

    const metrics = adapter.handleStreamLine(
      '{"type":"session.end","cost":0.05,"input_tokens":1000,"output_tokens":500,"turns":3,"model":"claude-opus-4-6","duration_ms":5000}',
      stream, artifacts
    );

    expect(metrics).toEqual({
      totalCost: 0.05,
      inputTokens: 1000,
      outputTokens: 500,
      numTurns: 3,
      model: 'claude-opus-4-6',
      durationMs: 5000,
    });
  });
});
```

#### Integration Tests (End-to-End with Real Providers)

```typescript
// tests/providers/integration/openclaw-e2e.test.ts

describe('OpenClaw E2E', () => {
  it('executes a simple task', async () => {
    const adapter = new OpenClawAdapter();
    if (!(await adapter.isAvailable())) {
      return; // Skip if not installed
    }

    const stream = createMockStream();
    const task: Task = {
      id: 'test-1',
      projectId: 'test',
      planNodeId: 'test',
      provider: 'openclaw',
      prompt: 'What is 2 + 2? Reply with just the number.',
      workingDirectory: '/tmp',
    };

    const result = await adapter.execute(task, stream, new AbortController().signal);

    expect(result.status).toBe('completed');
    expect(result.metrics?.inputTokens).toBeGreaterThan(0);
    expect(stream.text).toHaveBeenCalled();
  });
});
```

#### Testing with Own API (Non-CLI Mode)

For testing OpenCode via its REST API instead of CLI:

```python
# tests/providers/test_opencode_api.py
from opencode_ai import Opencode

def test_opencode_api_session():
    """Test OpenCode via REST API (requires opencode server running)."""
    client = Opencode(base_url="http://localhost:54321")

    # Create session
    session = client.session.create()
    assert session.id

    # Send message
    response = client.session.chat(
        id=session.id,
        model_id="claude-opus",
        provider_id="anthropic",
        parts=[{"type": "text", "text": "What is 2 + 2?"}]
    )

    assert response.cost is not None or response.tokens is not None

    # Get messages
    messages = client.session.messages(id=session.id)
    assert len(messages) >= 2  # user + assistant

    # Cleanup
    client.session.delete(id=session.id)

def test_opencode_api_streaming():
    """Test SSE event streaming."""
    client = Opencode(base_url="http://localhost:54321")

    session = client.session.create()

    # Start streaming events (background)
    events = []
    stream = client.event.list()

    # Send message (will generate events)
    response = client.session.chat(
        id=session.id,
        model_id="claude-opus",
        provider_id="anthropic",
        parts=[{"type": "text", "text": "Hello"}]
    )

    # Check events were received
    for event in stream:
        events.append(event)
        if event.type == "session.idle":
            break

    assert any(e.type == "message.updated" for e in events)
```

For testing OpenClaw via gateway:

```bash
# Test OpenClaw gateway health
openclaw gateway health

# Test via gateway RPC
openclaw gateway call chat.send '{"sessionKey":"test","message":"What is 2+2?"}'

# Test via curl (if HTTP endpoint available)
curl -X POST http://localhost:18789/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionKey":"test","message":"Hello"}'
```

### 6. Future Provider Adoption Strategy

#### Provider Abstraction Layers

The current `ProviderAdapter` interface is good but can be extended:

```typescript
// Enhanced provider interface for future providers
export interface ProviderAdapter {
  readonly type: string;
  readonly name: string;

  // Existing
  isAvailable(): Promise<boolean>;
  execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult>;
  getStatus(): Promise<ProviderStatus>;

  // New: capabilities declaration
  getCapabilities(): ProviderCapabilities;

  // New: session management (for SDK-based providers)
  createSession?(task: Task): Promise<string>;
  resumeSession?(sessionId: string): Promise<boolean>;
  steer?(sessionId: string, message: string): Promise<void>;

  // New: planning support
  generatePlan?(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult>;

  // New: structured output
  executeWithSchema?(task: Task, schema: JsonSchema, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult>;
}

export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  multiTurn: boolean;
  steering: boolean;
  approval: boolean;
  mcp: boolean;
  planning: boolean;
  structuredOutput: boolean;
  maxConcurrentTasks: number;
  supportedModels: string[];
  executionMode: 'cli' | 'sdk' | 'api';
}
```

#### Adding New Providers

To add a new provider (e.g., Google Agent Development Kit, Amazon Q, GitHub Copilot Workspace):

1. **Create adapter file**: `packages/agent-runner/src/providers/<name>-adapter.ts`
2. **Implement ProviderAdapter interface**: isAvailable, execute, getStatus
3. **Add detection**: `packages/agent-runner/src/lib/providers.ts` → detect function
4. **Register in factory**: `packages/agent-runner/src/providers/index.ts` → createProviderAdapter
5. **Add tests**: Unit tests for event parsing + integration tests
6. **Document CLI args and event format**: In adapter file header comment

#### Provider Comparison Matrix (Current + Future)

| Provider | Execution | Tools | Streaming | MCP | Steering | Social | Planning |
|----------|-----------|-------|-----------|-----|----------|--------|----------|
| Claude SDK | In-process | 20+ | Full | Yes | Yes | No | Yes |
| Claude CLI | Child process | 20+ | JSONL | No | No | No | Yes |
| Codex | Child process | 10+ | JSONL | No | No | No | No |
| OpenClaw | WebSocket/CLI | 10+ | WS events | No | Partial | **Yes** | No |
| OpenCode | REST API/CLI | 46+ | SSE | Yes | No | No | Yes |
| *Gemini (future)* | REST API | Google tools | SSE | No | No | No | Yes |
| *Amazon Q (future)* | REST API | AWS tools | SSE | No | No | No | Yes |
| *GitHub Copilot (future)* | REST API | VS Code tools | SSE | No | No | No | Yes |

### 7. Social Media Integration Design

#### Architecture

```
┌──────────────────────────────────────────────────┐
│ Astro Server                                      │
│                                                    │
│  Channel Router (server/lib/channel/)              │
│  ├── Webhook (Slack incoming webhook)              │
│  ├── Email (SMTP)                                  │
│  ├── OpenClaw (NEW: multi-channel gateway)         │
│  └── Push Notification (web push)                  │
│                                                    │
│  Notification Triggers:                            │
│  ├── Task completed/failed                         │
│  ├── Approval needed                               │
│  ├── Plan generation complete                      │
│  ├── Cost threshold exceeded                       │
│  └── Machine disconnected                          │
└──────────────┬───────────────────────────────────┘
               │ WebSocket
┌──────────────▼───────────────────────────────────┐
│ OpenClaw Gateway                                   │
│                                                    │
│  Channels:                                         │
│  ├── Telegram → User's Telegram chat               │
│  ├── Slack → Team Slack channel                    │
│  ├── Discord → Team Discord server                 │
│  ├── WhatsApp → User's WhatsApp                   │
│  └── ... (13+ supported)                           │
│                                                    │
│  Two-way:                                          │
│  ├── Notifications → User (outbound)               │
│  └── Commands → Astro API (inbound)                │
└──────────────────────────────────────────────────┘
```

#### Inbound Commands (from messaging platforms)

```
/astro status                    → Project summary
/astro tasks                     → Active tasks list
/astro approve <task-id>         → Approve pending decision
/astro run <task-id>             → Execute a plan node
/astro cost                      → Current session cost
/astro logs <task-id>            → Recent task output
/astro plan <project-id>         → View plan summary
/astro stop <task-id>            → Cancel running task
```

## Implementation Phases

### Phase 1: Testing & Validation (1 week) — **Critical**

1. **Install and test OpenClaw and OpenCode locally**
   - Install both tools, verify CLI invocation works
   - Compare actual JSONL output with adapter expectations
   - Fix any event format mismatches
2. **Write unit tests** for event parsing in both adapters
3. **Write integration tests** (auto-skip without provider installed)
4. **Document actual CLI flags and output formats**

### Phase 2: SDK Adapters (2 weeks) — **High**

1. **OpenCode SDK adapter** using REST API + SSE streaming
   - Use `opencode-ai` Python SDK or JS SDK for typed access
   - Replace CLI spawning with API calls
   - Add session management (create, resume, fork)
2. **OpenClaw SDK adapter** using WebSocket gateway protocol
   - Connect to gateway, authenticate, send chat messages
   - Parse ChatEvent streaming
   - Handle session lifecycle
3. **Fallback logic**: SDK adapter preferred, CLI adapter as fallback

### Phase 3: Observability Pipeline (1 week) — **High**

1. **ObservableTaskStream wrapper** that persists all events to DB
2. **execution_traces table** migration
3. **Trace viewer UI** in task-detail page (already partially exists)
4. **Provider comparison dashboard** — cost/tokens/duration per provider

### Phase 4: Social Media Integration (2 weeks) — **Medium**

1. **OpenClaw channel adapter** for Astro's notification system
2. **Outbound notifications**: Task completion, approvals, cost alerts
3. **Inbound commands**: Basic status/approve/run commands via messaging
4. **Approval routing**: Agent approvals → user's messaging platform

### Phase 5: Planning Mode (1 week) — **Medium**

1. **Add `generatePlan` method** to ProviderAdapter interface
2. **OpenCode plan agent**: Use `--agent plan` flag for read-only mode
3. **OpenClaw planning**: Inject planning system prompt
4. **Test plan generation** quality across providers

### Phase 6: Provider Abstraction (1 week) — **Low**

1. **Enhanced ProviderCapabilities** declaration
2. **Provider marketplace** — discover and install new providers
3. **Custom provider config** (`~/.astro/providers.json`) for user-defined adapters
4. **Documentation** for adding new providers

## Priority Summary

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| Phase 1: Testing & Validation | 1 week | Foundation | **Critical** |
| Phase 2: SDK Adapters | 2 weeks | Rich integration | **High** |
| Phase 3: Observability Pipeline | 1 week | Debugging + analytics | **High** |
| Phase 4: Social Media Integration | 2 weeks | User engagement | **Medium** |
| Phase 5: Planning Mode | 1 week | Multi-provider planning | **Medium** |
| Phase 6: Provider Abstraction | 1 week | Future-proofing | **Low** |

**Total: ~8 weeks for full implementation**
**MVP (Phase 1-3): ~4 weeks**

## Related Documents

- `docs/planning/02-SKILLS-ARCHITECTURE.md` — Skills that enable providers to use domain tools
- `docs/planning/10-DEFAULT-SKILL-LOADING.md` — Builtin skills loaded per provider
- `docs/planning/11-SKILLS-UI-AND-LIFECYCLE.md` — Skills UI for managing provider-specific skills
