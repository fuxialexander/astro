# AI Provider Adoption: OpenClaw, OpenCode, and Future Providers

## Overview

This document analyzes the current integration of OpenClaw and OpenCode in Astro, identifies gaps, proposes improvements for observability, SDK-based execution, social media integration, and lays out a strategy for adopting additional AI providers in the future.

It also covers two additional integration vectors:
- **Astro CLI as an OpenClaw plugin** — exposing Astro's project/plan/task management to any OpenClaw user
- **OpenClaw node/device pairing** — connecting a local OpenClaw instance to remote machines running Claude Code

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
| **No Astro CLI plugin for OpenClaw** — Can't use Astro from within OpenClaw sessions | Missed distribution channel | **Medium** |
| **No cross-machine pairing via OpenClaw** — Not using OpenClaw node system | Missed opportunity for easy remote execution | **Medium** |

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
2. **WebSocket control plane**: Gateway protocol with 99+ RPC methods
3. **Streaming events**: ChatEvent with state machine: delta → final/aborted/error
4. **Plugin system**: Custom tools, commands, RPC methods, background services, HTTP routes, channels
5. **Skill system**: SKILL.md files loadable from configured paths
6. **Node/device pairing**: Connect to remote machines and execute commands
7. **Multi-model**: Anthropic, OpenAI, Google, Ollama, Groq, AWS Bedrock, etc.
8. **Privacy-first**: Runs locally, data stays on device

**Gateway Protocol (WebSocket RPC — NOT REST):**

OpenClaw uses a **WebSocket-first RPC protocol** on port 18789. There is no REST API. All communication uses typed frames:

```typescript
// Frame types
type RequestFrame = { type: 'req', id: string, method: string, params: Record<string, any> }
type ResponseFrame = { type: 'res', id: string, result?: any, error?: { code: number, message: string } }
type EventFrame = { type: 'event', event: string, payload: any }

// Connect to gateway
const ws = new WebSocket('ws://localhost:18789')

// Send RPC request
ws.send(JSON.stringify({
  type: 'req',
  id: '1',
  method: 'chat.send',
  params: {
    sessionKey: 'session-123',
    message: 'Build a REST API for user management',
    attachments: []
  }
}))

// Receive streaming response (EventFrame)
ws.on('message', (data) => {
  const frame = JSON.parse(data.toString())
  if (frame.type === 'event' && frame.event === 'chat.event') {
    const { runId, seq, state, message, usage } = frame.payload
    // state: 'delta' | 'final' | 'aborted' | 'error'
  }
})
```

**Key RPC Methods (99+ available):**
```
chat.send              — Send message, receive streaming ChatEvents
sessions.list          — List active sessions
sessions.get           — Get session details
sessions.delete        — Delete session
config.get / config.set — Read/write configuration
logs.tail              — Stream logs
node.pair.request      — Request pairing with remote node
node.pair.approve      — Approve pairing request
node.invoke            — Execute command on paired node
node.list              — List paired nodes
skills.list            — List available skills
skills.install         — Install skill from URL
tools.list             — List available tools
tools.invoke           — Invoke a tool directly
```

**Plugin System:**

OpenClaw has a full plugin SDK with `openclaw.plugin.json` manifest:

```json
{
  "name": "astro-plugin",
  "version": "1.0.0",
  "description": "Astro project management for OpenClaw",
  "main": "dist/index.js",
  "openclaw": {
    "minVersion": "0.50.0"
  }
}
```

Plugins can register:
- **Tools**: Custom agent tools (functions the AI can call)
- **Hooks**: Lifecycle callbacks (on-message, on-session-start, etc.)
- **Gateway methods**: New RPC methods on the gateway
- **CLI commands**: New CLI subcommands
- **Channels**: New messaging channel adapters
- **Services**: Background processes
- **HTTP routes**: REST endpoints on the gateway

```typescript
// Plugin API
export interface OpenClawPluginApi {
  registerTool(tool: ToolDefinition): void
  registerHook(hook: HookDefinition): void
  registerGatewayMethod(method: GatewayMethodDefinition): void
  registerCliCommand(command: CliCommandDefinition): void
  registerChannel(channel: ChannelDefinition): void
  registerService(service: ServiceDefinition): void
  registerHttpRoute(route: HttpRouteDefinition): void
  getConfig(): PluginConfig
  getLogger(): Logger
}
```

**Node/Device Pairing System:**

OpenClaw has a built-in system for connecting to remote machines:

```
Local Machine (OpenClaw)     Remote Machine (Claude Code)
         │                            │
         │  node.pair.request ───────>│
         │<──────── node.pair.approve │
         │                            │
         │  node.invoke("bash", ...) ─>│  (execute on remote)
         │<────────── result           │
```

```typescript
// NodeSession in OpenClaw
interface NodeSession {
  nodeId: string          // Unique device ID
  name: string            // Human-readable name
  caps: string[]          // Capabilities: ['bash', 'python', 'gpu', 'docker']
  commands: string[]      // Available commands
  permissions: string[]   // Granted permissions
  paired: boolean         // Pairing status
  lastSeen: number        // Heartbeat timestamp
}
```

This enables a use case where:
1. User runs OpenClaw locally (laptop)
2. Claude Code runs on a remote HPC/GPU machine
3. OpenClaw pairs with the remote via `node.pair.request`
4. User chats with OpenClaw (even from Telegram/Slack) and OpenClaw routes execution to the remote Claude Code

### OpenCode: What It Actually Is

OpenCode is a **provider-agnostic AI coding agent** with:

**Architecture:**
```
CLI / Desktop / Web UI
       ↓
Hono.js Server (port 4096)
       ↓
Session Processor (loop: LLM → tool calls → results → LLM)
       ↓
Vercel AI SDK (streamText)
       ↓
LLM Provider (Anthropic, OpenAI, Google, etc.)
```

**Key capabilities for Astro:**
1. **REST API**: Full CRUD for sessions, messages, events on port 4096
2. **JavaScript SDK**: `@opencode-ai/sdk` on npm (v1.2.15, zero dependencies, **recommended for Astro**)
3. **Python SDK**: `opencode-ai` on PyPI (v0.1.0-alpha.36, **not recommended** — alpha, unnecessary for TypeScript agent-runner)
4. **46+ built-in tools**: bash, edit, read, glob, grep, ls, webfetch, websearch, LSP, batch, task, todo
5. **MCP support**: Full MCP v1.25.2 (stdio, SSE, HTTP transports)
6. **Session management**: Fork, branch, archive, share, summarize
7. **Multi-provider**: 20+ LLM providers including custom OpenAI-compatible servers
8. **Permission system**: Fine-grained per-agent tool permissions
9. **Event streaming**: SSE with typed events (message.updated, session.error, etc.)

**SDK Recommendation: `@opencode-ai/sdk` (JavaScript)**

For Astro's TypeScript-based agent-runner, the **JavaScript SDK** is the right choice:

```
Package: @opencode-ai/sdk
Version: 1.2.15 (production)
Dependencies: 0 (zero deps)
Install: npm install @opencode-ai/sdk
```

```typescript
import { createClient } from '@opencode-ai/sdk'

// Connect to running OpenCode server
const client = createClient({ baseUrl: 'http://localhost:4096' })

// Create session
const { data: session } = await client.session.create()

// Send prompt
await client.session.prompt({
  path: { id: session.id },
  body: {
    parts: [{ type: 'text', text: 'Implement user authentication' }]
  }
})

// Get messages
const { data: messages } = await client.session.messages({
  path: { id: session.id }
})

// Stream events via SSE
const eventSource = new EventSource('http://localhost:4096/event')
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data)
  // data.type: 'message.updated', 'message.part.updated', 'session.error', etc.
}

// Abort running session
await client.session.abort({ path: { id: session.id } })

// Fork session (branch exploration)
const { data: forked } = await client.session.fork({
  path: { id: session.id }
})

// Delete session
await client.session.delete({ path: { id: session.id } })
```

**REST API Endpoints (port 4096):**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/session` | List sessions |
| POST | `/session` | Create session |
| GET | `/session/:id` | Get session |
| DELETE | `/session/:id` | Delete session |
| POST | `/session/:id/message` | Send prompt |
| GET | `/session/:id/messages` | Get message history |
| POST | `/session/:id/abort` | Abort running session |
| POST | `/session/:id/share` | Share session |
| POST | `/session/:id/fork` | Fork/branch session |
| POST | `/session/:id/summarize` | Summarize session |
| GET | `/event` | SSE event stream |
| GET | `/config` | Get configuration |

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

### The SDK/API Opportunity

Both OpenClaw and OpenCode offer richer integration than CLI spawning:

**OpenClaw: Gateway WebSocket Protocol**
- Connect to the gateway at `ws://localhost:18789`
- Use 99+ RPC methods: `chat.send`, `sessions.list`, `logs.tail`, `node.invoke`
- Receive streaming ChatEvents with usage metrics
- No need to spawn a process — connect to already-running gateway
- **Important**: This is WebSocket-only, not REST

**OpenCode: REST API + `@opencode-ai/sdk`**
- Connect to server at `http://localhost:4096`
- Use typed JS SDK: `client.session.create()`, `client.session.prompt()`
- Stream events via SSE: `EventSource('/event')`
- Get full message history, tool traces, and session metadata
- Fork sessions for branching exploration
- **Recommended SDK**: `@opencode-ai/sdk` (npm, v1.2.15, zero deps)

## Proposed Improvements

### 1. SDK-Based Adapters (Replace CLI Spawning)

#### OpenClaw SDK Adapter

Replace the CLI-spawning `OpenClawAdapter` with a WebSocket gateway client:

```typescript
// packages/agent-runner/src/providers/openclaw-sdk-adapter.ts

import WebSocket from 'ws'

export class OpenClawSdkAdapter implements ProviderAdapter {
  readonly type = 'openclaw'
  readonly name = 'OpenClaw (Gateway)'

  private gatewayUrl = 'ws://localhost:18789'

  async isAvailable(): Promise<boolean> {
    try {
      const ws = new WebSocket(this.gatewayUrl)
      await new Promise((resolve, reject) => {
        ws.on('open', resolve)
        ws.on('error', reject)
        setTimeout(() => reject(new Error('timeout')), 5000)
      })
      ws.close()
      return true
    } catch {
      return false
    }
  }

  async execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult> {
    const ws = new WebSocket(this.gatewayUrl)
    await new Promise<void>((resolve) => ws.on('open', resolve))

    let requestId = 0
    const sendRpc = (method: string, params: Record<string, any>) => {
      const id = String(++requestId)
      ws.send(JSON.stringify({ type: 'req', id, method, params }))
      return id
    }

    // Create session
    const sessionKey = `astro-${task.id}`
    stream.sessionInit(sessionKey, task.model)

    // Send task prompt
    sendRpc('chat.send', {
      sessionKey,
      message: task.prompt,
    })

    // Stream events
    return new Promise((resolve) => {
      signal.addEventListener('abort', () => {
        sendRpc('chat.abort', { sessionKey })
        ws.close()
      })

      ws.on('message', (data) => {
        const frame = JSON.parse(data.toString())

        if (frame.type === 'event' && frame.event === 'chat.event') {
          const { state, message, usage } = frame.payload

          if (state === 'delta') {
            if (message?.content) stream.text(message.content)
            if (message?.toolUse) stream.toolUse(message.toolUse.name, message.toolUse.input)
            if (message?.toolResult) stream.toolResult(message.toolResult.name, message.toolResult.output, message.toolResult.success)
          } else if (state === 'final') {
            ws.close()
            resolve({
              taskId: task.id,
              status: 'completed',
              metrics: {
                inputTokens: usage?.inputTokens,
                outputTokens: usage?.outputTokens,
                totalCost: usage?.cost,
                model: usage?.model,
              }
            })
          } else if (state === 'error' || state === 'aborted') {
            ws.close()
            resolve({
              taskId: task.id,
              status: state === 'error' ? 'failed' : 'aborted',
              error: frame.payload.errorMessage,
            })
          }
        }
      })
    })
  }
}
```

#### OpenCode SDK Adapter

Replace CLI spawning with the `@opencode-ai/sdk` client:

```typescript
// packages/agent-runner/src/providers/opencode-sdk-adapter.ts

import { createClient } from '@opencode-ai/sdk'

export class OpenCodeSdkAdapter implements ProviderAdapter {
  readonly type = 'opencode'
  readonly name = 'OpenCode (SDK)'

  private baseUrl = 'http://localhost:4096'

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/config`)
      return res.ok
    } catch {
      return false
    }
  }

  async execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult> {
    const client = createClient({ baseUrl: this.baseUrl })

    // Create session
    const { data: session } = await client.session.create()
    stream.sessionInit(session.id, task.model)

    // Start SSE event listener for real-time observability
    const eventSource = new EventSource(`${this.baseUrl}/event`)
    const cleanup = () => eventSource.close()
    signal.addEventListener('abort', cleanup)

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      switch (data.type) {
        case 'message.part.updated': {
          const part = data.properties
          if (part.type === 'text') {
            stream.text(part.value)
          } else if (part.type === 'tool') {
            if (part.state.status === 'running') {
              stream.toolUse(part.tool, part.state.input)
            } else if (part.state.status === 'completed') {
              stream.toolResult(part.tool, part.state.output, true)
            } else if (part.state.status === 'error') {
              stream.toolResult(part.tool, part.state.output, false)
            }
          }
          break
        }
        case 'session.error':
          stream.status('failed', undefined, data.properties.error)
          break
      }
    }

    // Send prompt
    await client.session.prompt({
      path: { id: session.id },
      body: {
        parts: [{ type: 'text', text: task.prompt }],
      }
    })

    // Wait for completion by polling messages
    const { data: messages } = await client.session.messages({
      path: { id: session.id }
    })

    cleanup()

    // Extract metrics from last assistant message
    const lastMsg = messages?.[messages.length - 1]
    return {
      taskId: task.id,
      status: 'completed',
      metrics: {
        inputTokens: lastMsg?.tokens?.input,
        outputTokens: lastMsg?.tokens?.output,
        totalCost: lastMsg?.cost,
        model: lastMsg?.model,
      }
    }
  }
}
```

### 2. Astro CLI as an OpenClaw Plugin

The Astro CLI (`@astroanywhere/cli`) exports an `AstroClient` class with typed HTTP methods for all Astro API endpoints. This can be wrapped as an OpenClaw plugin, giving any OpenClaw user access to Astro's project management from within their AI chat sessions.

**What `AstroClient` provides:**
- `client.projects.list()`, `client.projects.create()`, `client.projects.get()`
- `client.plan.get()`, `client.plan.addNode()`, `client.plan.updateNode()`
- `client.dispatch.task()`, `client.dispatch.cancel()`, `client.dispatch.steer()`
- `client.activity.list()`, `client.trace.get()`
- SSE streaming for events and dispatch progress
- Auto token refresh on 401

**Plugin structure:**

```
astro-openclaw-plugin/
├── openclaw.plugin.json         # Plugin manifest
├── package.json
├── src/
│   ├── index.ts                 # Plugin entry point
│   ├── tools/                   # Agent tools wrapping AstroClient
│   │   ├── project-tools.ts     # astro_list_projects, astro_create_project
│   │   ├── plan-tools.ts        # astro_get_plan, astro_create_task
│   │   ├── dispatch-tools.ts    # astro_run_task, astro_cancel_task
│   │   └── status-tools.ts      # astro_task_status, astro_project_status
│   ├── commands/                # CLI subcommands
│   │   └── astro-commands.ts    # openclaw astro status, openclaw astro dispatch
│   └── gateway/                 # Gateway RPC methods
│       └── astro-methods.ts     # astro.projects.list, astro.dispatch.task
```

**Plugin manifest:**
```json
{
  "name": "astro-openclaw-plugin",
  "version": "1.0.0",
  "description": "Astro project management for OpenClaw",
  "main": "dist/index.js",
  "openclaw": {
    "minVersion": "0.50.0"
  }
}
```

**Plugin entry point:**
```typescript
// src/index.ts
import type { OpenClawPluginApi } from '@openclaw/plugin-sdk'
import { AstroClient } from '@astroanywhere/cli/client'

export default function register(api: OpenClawPluginApi) {
  const config = api.getConfig()
  const client = new AstroClient({
    baseUrl: config.get('astro.serverUrl') || 'http://localhost:3001',
    token: config.get('astro.authToken'),
  })

  // Register agent tools
  api.registerTool({
    name: 'astro_list_projects',
    description: 'List all Astro projects',
    parameters: {},
    handler: async () => {
      const projects = await client.projects.list()
      return JSON.stringify(projects, null, 2)
    }
  })

  api.registerTool({
    name: 'astro_get_plan',
    description: 'Get the plan graph for an Astro project',
    parameters: {
      projectId: { type: 'string', description: 'Project ID', required: true }
    },
    handler: async ({ projectId }) => {
      const plan = await client.plan.get(projectId)
      return JSON.stringify(plan, null, 2)
    }
  })

  api.registerTool({
    name: 'astro_run_task',
    description: 'Dispatch a task for execution on a connected machine',
    parameters: {
      projectId: { type: 'string', required: true },
      nodeId: { type: 'string', required: true },
      machineId: { type: 'string', description: 'Target machine (optional)' },
    },
    handler: async ({ projectId, nodeId, machineId }) => {
      const result = await client.dispatch.task(projectId, nodeId, { machineId })
      return JSON.stringify(result)
    }
  })

  api.registerTool({
    name: 'astro_task_status',
    description: 'Get status and output of a running or completed task',
    parameters: {
      taskId: { type: 'string', required: true }
    },
    handler: async ({ taskId }) => {
      const trace = await client.trace.get(taskId)
      return JSON.stringify(trace, null, 2)
    }
  })

  // Register gateway methods (accessible via WebSocket RPC)
  api.registerGatewayMethod({
    method: 'astro.projects.list',
    handler: async () => client.projects.list()
  })

  api.registerGatewayMethod({
    method: 'astro.dispatch.task',
    handler: async (params) => client.dispatch.task(params.projectId, params.nodeId, params)
  })

  // Register CLI commands
  api.registerCliCommand({
    command: 'astro',
    description: 'Astro project management',
    subcommands: {
      status: {
        description: 'Show project status',
        handler: async () => {
          const projects = await client.projects.list()
          console.table(projects.map(p => ({ name: p.name, status: p.status, tasks: p.taskCount })))
        }
      },
      dispatch: {
        description: 'Dispatch a task',
        args: ['projectId', 'nodeId'],
        handler: async (args) => {
          const result = await client.dispatch.task(args.projectId, args.nodeId)
          console.log(`Dispatched: ${result.executionId}`)
        }
      }
    }
  })
}
```

**User experience:**
```
# In any OpenClaw chat session (Telegram, Slack, CLI, etc.)
User: "List my Astro projects and show the plan for the API project"
OpenClaw: [calls astro_list_projects] [calls astro_get_plan]
         "You have 3 projects. The API project has 8 tasks, 3 completed..."

User: "Run the 'implement auth' task on my GPU machine"
OpenClaw: [calls astro_run_task]
         "Task dispatched to gpu-server-1. Execution ID: abc123..."

User: "What's the status?"
OpenClaw: [calls astro_task_status]
         "Task is in_progress. 12 tool calls, 3 files modified..."
```

### 3. OpenClaw Node Pairing for Remote Execution

OpenClaw's node/device system enables a powerful workflow: run OpenClaw locally (even without GPUs) and execute tasks on remote machines running Claude Code or other agents.

**Use case:** User has OpenClaw on their laptop and Claude Code on an HPC cluster.

```
Laptop (OpenClaw)                  HPC Cluster (Claude Code + astro-agent)
     │                                      │
     │ node.pair.request ──────────────────>│
     │<────────────────── node.pair.approve  │
     │                                      │
     │ chat.send("Train my model on 4xH100")│
     │        ↓                             │
     │ AI decides to use remote GPU         │
     │ node.invoke("bash", "sky jobs ...")──>│
     │<──────────── job submitted            │
     │                                      │
     │ User (on Telegram): "Job status?"    │
     │ node.invoke("bash", "sky jobs queue")>│
     │<──────────── 3 jobs running           │
```

**Integration approach:**

Since astro-agent already runs on remote machines and connects via the relay, we can bridge OpenClaw's node system with Astro's relay:

```typescript
// Bridge: OpenClaw node commands → Astro relay dispatch

// In the Astro OpenClaw plugin:
api.registerHook({
  event: 'node.invoke',
  handler: async (nodeId, command, args) => {
    // Instead of direct SSH, route through Astro's dispatch
    const machines = await client.machines.list()
    const target = machines.find(m => m.name === nodeId || m.id === nodeId)
    if (target) {
      return await client.dispatch.exec(target.id, command, args)
    }
  }
})
```

**Setup simplification:**

The biggest pain point with OpenClaw is initial setup. For the Astro integration, we simplify by:

1. **Astro manages the agent-runner** — already handles machine registration, auth, relay connection
2. **OpenClaw plugin connects to Astro** — uses AstroClient, no need to set up OpenClaw's own node system separately
3. **OpenClaw acts as the UI layer** — chat from Telegram/Slack/CLI, execution goes through Astro's dispatch

This means the user doesn't need to configure OpenClaw's agent runtime — they just need OpenClaw installed for the chat interface + messaging channels.

### 4. Observability Pipeline

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
    this.inner.text(data)
    this.collector.addSpan({
      taskId: this.taskId,
      type: 'text',
      provider: this.provider,
      data,
      timestamp: Date.now(),
    })
  }

  toolUse(toolName: string, toolInput: unknown) {
    this.inner.toolUse(toolName, toolInput)
    this.collector.addSpan({
      taskId: this.taskId,
      type: 'tool_use',
      provider: this.provider,
      toolName,
      toolInput,
      timestamp: Date.now(),
    })
  }

  toolResult(toolName: string, result: unknown, success: boolean) {
    this.inner.toolResult(toolName, result, success)
    this.collector.addSpan({
      taskId: this.taskId,
      type: 'tool_result',
      provider: this.provider,
      toolName,
      result,
      success,
      timestamp: Date.now(),
    })
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
  event_type VARCHAR(50) NOT NULL,
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

### 5. Social Media Integration via OpenClaw

OpenClaw's killer feature for Astro is its channel system. We can:

**A. Notifications via OpenClaw Channels**

Astro already has a channel notification system (`server/lib/channel/`). OpenClaw can be a channel backend:

```typescript
// server/lib/channel/adapters/openclaw-channel.ts

class OpenClawChannelAdapter implements ChannelAdapter {
  private ws: WebSocket

  constructor(gatewayUrl: string = 'ws://localhost:18789') {
    this.ws = new WebSocket(gatewayUrl)
  }

  async sendNotification(channel: string, recipientId: string, message: string) {
    this.ws.send(JSON.stringify({
      type: 'req',
      id: String(Date.now()),
      method: 'message.send',
      params: { channel, recipient: recipientId, text: message }
    }))
  }
}
```

**B. Two-Way Interaction**

Users can interact with Astro projects via messaging platforms:

```
User (Telegram): "/astro status"
  → OpenClaw Gateway → Astro plugin → Returns plan progress

User (Slack): "Run task 5 on my HPC cluster"
  → OpenClaw Gateway → Astro plugin → Task executed → Result sent back to Slack

User (WhatsApp): "What's the cost so far?"
  → OpenClaw Gateway → Astro plugin → Cost summary sent back
```

**C. Approval Flow via Messaging**

When an agent needs user approval (ask_user_question), route to the user's preferred channel:

```
Agent: needs approval → Astro server → OpenClaw gateway → Telegram
User receives: "Task 'deploy API' needs your approval. Options: [Approve] [Reject] [Modify]"
User replies: "Approve"
Telegram → OpenClaw → Astro → Agent resumes
```

### 6. Testing Strategy

#### Unit Tests (Adapter Event Parsing)

```typescript
// tests/providers/openclaw-adapter.test.ts

describe('OpenClawAdapter', () => {
  it('parses session.start event', () => {
    const adapter = new OpenClawAdapter()
    const stream = createMockStream()
    const artifacts: TaskArtifact[] = []

    adapter.handleStreamLine(
      '{"type":"session.start","session_id":"abc","model":"claude-opus-4-6"}',
      stream, artifacts
    )
    expect(stream.sessionInit).toHaveBeenCalledWith('abc', 'claude-opus-4-6')
  })

  it('parses tool_use.start/end events', () => {
    const adapter = new OpenClawAdapter()
    const stream = createMockStream()
    const artifacts: TaskArtifact[] = []

    adapter.handleStreamLine(
      '{"type":"tool_use.start","tool_name":"bash","tool_input":{"command":"ls"}}',
      stream, artifacts
    )
    expect(stream.toolUse).toHaveBeenCalledWith('bash', { command: 'ls' })

    adapter.handleStreamLine(
      '{"type":"tool_use.end","tool_name":"bash","result":"file1.txt\\nfile2.txt","success":true}',
      stream, artifacts
    )
    expect(stream.toolResult).toHaveBeenCalledWith('bash', 'file1.txt\nfile2.txt', true)
  })
})
```

#### Integration Tests (End-to-End)

```typescript
// tests/providers/integration/opencode-sdk-e2e.test.ts

describe('OpenCode SDK E2E', () => {
  it('executes via REST API', async () => {
    const adapter = new OpenCodeSdkAdapter()
    if (!(await adapter.isAvailable())) return // Skip if not running

    const stream = createMockStream()
    const task = { id: 'test-1', prompt: 'What is 2+2? Reply with just the number.' }

    const result = await adapter.execute(task, stream, new AbortController().signal)

    expect(result.status).toBe('completed')
    expect(result.metrics?.inputTokens).toBeGreaterThan(0)
    expect(stream.text).toHaveBeenCalled()
  })
})
```

#### Testing with OpenCode JS SDK directly

```typescript
import { createClient } from '@opencode-ai/sdk'

// Requires: opencode server running on port 4096
const client = createClient({ baseUrl: 'http://localhost:4096' })

// Create session
const { data: session } = await client.session.create()

// Send prompt
await client.session.prompt({
  path: { id: session.id },
  body: { parts: [{ type: 'text', text: 'What is 2+2?' }] }
})

// Get messages
const { data: messages } = await client.session.messages({
  path: { id: session.id }
})
console.log('Messages:', messages.length)

// Cleanup
await client.session.delete({ path: { id: session.id } })
```

#### Testing OpenClaw via Gateway

```typescript
import WebSocket from 'ws'

// Requires: openclaw gateway running on port 18789
const ws = new WebSocket('ws://localhost:18789')

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'req',
    id: '1',
    method: 'chat.send',
    params: { sessionKey: 'test', message: 'What is 2+2?' }
  }))
})

ws.on('message', (data) => {
  const frame = JSON.parse(data.toString())
  if (frame.type === 'event' && frame.event === 'chat.event') {
    console.log('State:', frame.payload.state, 'Content:', frame.payload.message?.content)
    if (frame.payload.state === 'final') ws.close()
  }
})
```

### 7. Future Provider Adoption Strategy

#### Enhanced Provider Interface

```typescript
export interface ProviderAdapter {
  readonly type: string
  readonly name: string

  // Existing
  isAvailable(): Promise<boolean>
  execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult>
  getStatus(): Promise<ProviderStatus>

  // New: capabilities declaration
  getCapabilities(): ProviderCapabilities

  // New: session management (for SDK-based providers)
  createSession?(task: Task): Promise<string>
  resumeSession?(sessionId: string): Promise<boolean>
  steer?(sessionId: string, message: string): Promise<void>

  // New: planning support
  generatePlan?(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult>
}

export interface ProviderCapabilities {
  streaming: boolean
  tools: boolean
  multiTurn: boolean
  steering: boolean
  approval: boolean
  mcp: boolean
  planning: boolean
  structuredOutput: boolean
  maxConcurrentTasks: number
  supportedModels: string[]
  executionMode: 'cli' | 'sdk' | 'api' | 'websocket'
}
```

#### Adding New Providers

To add a new provider (e.g., Google Agent Development Kit, Amazon Q, GitHub Copilot Workspace):

1. **Create adapter file**: `packages/agent-runner/src/providers/<name>-adapter.ts`
2. **Implement ProviderAdapter interface**: isAvailable, execute, getStatus
3. **Add detection**: `packages/agent-runner/src/lib/providers.ts`
4. **Register in factory**: `packages/agent-runner/src/providers/index.ts`
5. **Add tests**: Unit tests for event parsing + integration tests
6. **Document CLI args and event format**: In adapter file header comment

#### Provider Comparison Matrix (Current + Future)

| Provider | Execution | Tools | Streaming | MCP | Steering | Social | Planning |
|----------|-----------|-------|-----------|-----|----------|--------|----------|
| Claude SDK | In-process | 20+ | Full | Yes | Yes | No | Yes |
| Claude CLI | Child process | 20+ | JSONL | No | No | No | Yes |
| Codex | Child process | 10+ | JSONL | No | No | No | No |
| OpenClaw | **WebSocket** | 10+ | WS events | No | Partial | **Yes** | No |
| OpenCode | **REST API** | 46+ | SSE | Yes | No | No | Yes |
| *Gemini (future)* | REST API | Google tools | SSE | No | No | No | Yes |
| *Amazon Q (future)* | REST API | AWS tools | SSE | No | No | No | Yes |

## Implementation Phases

### Phase 1: Testing & Validation (1 week) — **Critical**

1. **Install and test OpenClaw and OpenCode locally**
   - Install both tools, verify CLI invocation works
   - Compare actual JSONL output with adapter expectations
   - Fix any event format mismatches
2. **Test OpenCode via `@opencode-ai/sdk`** — `npm install @opencode-ai/sdk`, verify JS SDK works
3. **Test OpenClaw via WebSocket** — connect to gateway, test `chat.send` RPC
4. **Write unit tests** for event parsing in both adapters
5. **Write integration tests** (auto-skip without provider installed)

### Phase 2: SDK Adapters (2 weeks) — **High**

1. **OpenCode SDK adapter** using `@opencode-ai/sdk` + SSE streaming
   - Replace CLI spawning with `createClient()` API calls
   - Add session management (create, abort, fork)
   - Wire SSE events to TaskOutputStream
2. **OpenClaw SDK adapter** using WebSocket gateway protocol
   - Connect to gateway, send `chat.send` RPC
   - Parse ChatEvent streaming (delta/final/error)
   - Handle session lifecycle
3. **Fallback logic**: SDK adapter preferred, CLI adapter as fallback

### Phase 3: Astro CLI Plugin for OpenClaw (1 week) — **High**

1. **Create `astro-openclaw-plugin` package** with `openclaw.plugin.json`
2. **Wrap AstroClient as OpenClaw tools**: astro_list_projects, astro_get_plan, astro_run_task, astro_task_status
3. **Register gateway methods**: astro.projects.list, astro.dispatch.task
4. **Register CLI commands**: `openclaw astro status`, `openclaw astro dispatch`
5. **Publish to npm**: `@astroanywhere/openclaw-plugin`

### Phase 4: Observability Pipeline (1 week) — **High**

1. **ObservableTaskStream wrapper** that persists all events to DB
2. **execution_traces table** migration
3. **Trace viewer UI** in task-detail page (already partially exists)
4. **Provider comparison dashboard** — cost/tokens/duration per provider

### Phase 5: OpenClaw Node Pairing + Remote Execution (1 week) — **Medium**

1. **Bridge OpenClaw node.invoke to Astro relay dispatch**
2. **Auto-register Astro machines as OpenClaw nodes** via plugin
3. **Test flow**: Chat on Telegram → OpenClaw → Astro dispatch → Remote Claude Code → Result back to Telegram

### Phase 6: Social Media Integration (2 weeks) — **Medium**

1. **OpenClaw channel adapter** for Astro's notification system
2. **Outbound notifications**: Task completion, approvals, cost alerts
3. **Inbound commands**: Basic status/approve/run commands via messaging
4. **Approval routing**: Agent approvals → user's messaging platform

### Phase 7: Planning Mode (1 week) — **Medium**

1. **Add `generatePlan` method** to ProviderAdapter interface
2. **OpenCode plan agent**: Use `--agent plan` flag for read-only mode
3. **OpenClaw planning**: Inject planning system prompt
4. **Test plan generation** quality across providers

### Phase 8: Provider Abstraction (1 week) — **Low**

1. **Enhanced ProviderCapabilities** declaration
2. **Provider marketplace** — discover and install new providers
3. **Custom provider config** (`~/.astro/providers.json`)
4. **Documentation** for adding new providers

## OpenClaw Setup Mitigation

### The Challenge

OpenClaw has a complex setup process: install the CLI, configure the gateway, set up messaging channels (each requires API tokens), configure the agent runtime, etc. This is the biggest barrier to adoption.

### Phased Approach

**Phase A: Minimal integration (no OpenClaw setup needed)**
- Astro's existing OpenClaw CLI adapter works if the user already has OpenClaw installed
- No gateway connection needed — just spawn the CLI

**Phase B: Gateway connection (user has OpenClaw running)**
- If OpenClaw is running locally (gateway on :18789), the SDK adapter connects automatically
- User gets richer observability and session management
- No special setup beyond having OpenClaw running

**Phase C: Plugin installation (user wants Astro tools in OpenClaw)**
- User installs `@astroanywhere/openclaw-plugin` into OpenClaw
- Gets Astro tools available in all OpenClaw sessions (including Telegram/Slack)
- One-time: `openclaw plugin install @astroanywhere/openclaw-plugin`

**Phase D: Full social media integration (user wants notifications)**
- User configures OpenClaw channels (Telegram bot token, Slack webhook, etc.)
- Astro routes notifications through OpenClaw's channel system
- Requires OpenClaw channel setup (documented, but user effort)

### One-Line Setup for Common Cases

```bash
# Case 1: User has OpenClaw, wants Astro tools
openclaw plugin install @astroanywhere/openclaw-plugin
openclaw config set astro.serverUrl http://localhost:3001
openclaw config set astro.authToken <token>

# Case 2: User has Astro, wants to add OpenClaw as a provider
# Nothing to configure if OpenClaw is already running — auto-detected
astro-agent config set providers.openclaw.enabled true

# Case 3: User wants Telegram notifications via OpenClaw
openclaw channel setup telegram  # Guided setup
openclaw config set astro.notificationChannel telegram
```

## Priority Summary

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| Phase 1: Testing & Validation | 1 week | Foundation | **Critical** |
| Phase 2: SDK Adapters | 2 weeks | Rich integration | **High** |
| Phase 3: Astro CLI Plugin | 1 week | Distribution channel | **High** |
| Phase 4: Observability Pipeline | 1 week | Debugging + analytics | **High** |
| Phase 5: Node Pairing | 1 week | Remote execution | **Medium** |
| Phase 6: Social Media | 2 weeks | User engagement | **Medium** |
| Phase 7: Planning Mode | 1 week | Multi-provider planning | **Medium** |
| Phase 8: Provider Abstraction | 1 week | Future-proofing | **Low** |

**Total: ~10 weeks for full implementation**
**MVP (Phase 1-4): ~5 weeks**

## Related Documents

- `docs/planning/02-SKILLS-ARCHITECTURE.md` — Skills that enable providers to use domain tools
- `docs/planning/10-DEFAULT-SKILL-LOADING.md` — Builtin skills loaded per provider
- `docs/planning/11-SKILLS-UI-AND-LIFECYCLE.md` — Skills UI for managing provider-specific skills
