# CLI JSONL Event Formats: OpenClaw & OpenCode

This document records the **actual** JSONL event formats produced by the OpenClaw and OpenCode
CLIs (as of their source code in March 2026), compares them against the formats the Astro
`agent-runner` adapters currently expect, and catalogues every gap.

> **Source repos examined:**
> - OpenClaw: `/tmp/openclaw` (commit on local disk)
> - OpenCode: `/tmp/opencode` (commit on local disk)
> - Astro adapters: `packages/agent-runner/src/providers/{openclaw,opencode}-adapter.ts`

---

## Table of Contents

1. [OpenClaw CLI — Actual Format](#1-openclaw-cli--actual-format)
2. [OpenCode CLI — Actual Format](#2-opencode-cli--actual-format)
3. [Astro Adapter — Expected Formats](#3-astro-adapter--expected-formats)
4. [Gap Analysis: OpenClaw](#4-gap-analysis-openclaw)
5. [Gap Analysis: OpenCode](#5-gap-analysis-opencode)
6. [Summary of Required Adapter Changes](#6-summary-of-required-adapter-changes)

---

## 1. OpenClaw CLI — Actual Format

### 1.1 Protocol Overview

OpenClaw **does not** have a `--mode rpc --json` flag that emits flat JSONL events. Instead, it
exposes an **ACP (Agent Client Protocol)** server via `openclaw acp`, which communicates using
**nd-JSON (newline-delimited JSON-RPC 2.0)** over stdio.

- **Entry point:** `src/acp/server.ts` → `serveAcpGateway()`
- **Transport:** `ndJsonStream` from `@agentclientprotocol/sdk` over stdin/stdout
- **Protocol:** JSON-RPC 2.0 with ACP method names

The `openclaw agent` command does **not** accept `--json` or `--mode rpc` flags. These flags
do not exist in the OpenClaw CLI.

### 1.2 ACP Wire Format

Each line is a JSON-RPC 2.0 message:

```jsonl
{"jsonrpc":"2.0","method":"<method>","params":{...}}
{"jsonrpc":"2.0","id":"<req-id>","result":{...}}
```

#### Session Updates (Server → Client)

All streaming output is delivered via `session/update` notifications:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "<uuid>",
    "update": {
      "sessionUpdate": "<tag>",
      // ... tag-specific fields
    }
  }
}
```

### 1.3 Session Update Tags (Event Types)

Source: `src/acp/runtime/types.ts` lines 5–16

```typescript
type AcpSessionUpdateTag =
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "usage_update"
  | "available_commands_update"
  | "current_mode_update"
  | "config_option_update"
  | "session_info_update"
  | "plan"
  | (string & {});
```

### 1.4 Detailed Event Structures

#### `agent_message_chunk` — Text output from the agent

```json
{
  "sessionUpdate": "agent_message_chunk",
  "content": {
    "type": "text",
    "text": "<incremental-text-delta>"
  }
}
```

Source: `src/acp/translator.ts` lines 455–461

#### `agent_thought_chunk` — Extended thinking output

Same structure as `agent_message_chunk` but for reasoning/thinking content.

#### `tool_call` — Tool invocation started

```json
{
  "sessionUpdate": "tool_call",
  "toolCallId": "<string>",
  "title": "<formatted-description>",
  "status": "in_progress",
  "rawInput": { /* tool arguments */ },
  "kind": "read" | "write" | "edit" | "delete" | "move" | "search" | "execute" | "fetch" | "other"
}
```

Source: `src/acp/translator.ts` lines 367–377

#### `tool_call_update` — Tool execution result

```json
{
  "sessionUpdate": "tool_call_update",
  "toolCallId": "<string>",
  "status": "completed" | "failed",
  "rawOutput": { /* tool result object */ }
}
```

Source: `src/acp/translator.ts` lines 383–392

#### `usage_update` — Token/context usage

```json
{
  "sessionUpdate": "usage_update",
  "used": 12,
  "size": 500
}
```

#### `available_commands_update` — Available slash commands

```json
{
  "sessionUpdate": "available_commands_update",
  "availableCommands": [
    { "name": "<string>", "description": "<string>" }
  ]
}
```

#### `session_info_update` — Session metadata

```json
{
  "sessionUpdate": "session_info_update",
  "summary": "<string>",
  "message": "<string>"
}
```

#### `plan` — Plan entries

```json
{
  "sessionUpdate": "plan",
  "entries": [
    { "content": "<string>" }
  ]
}
```

### 1.5 Runtime Event Types (Internal)

Source: `src/acp/runtime/types.ts` lines 78–109

These are the internal event types emitted by the ACP runtime and consumed by adapters:

```typescript
type AcpRuntimeEvent =
  | { type: "text_delta"; text: string; stream?: "output" | "thought"; tag?: AcpSessionUpdateTag }
  | { type: "status"; text: string; tag?: AcpSessionUpdateTag; used?: number; size?: number }
  | { type: "tool_call"; text: string; tag?: AcpSessionUpdateTag; toolCallId?: string; status?: string; title?: string }
  | { type: "done"; stopReason?: string }
  | { type: "error"; message: string; code?: string; retryable?: boolean }
```

### 1.6 Prompt Completion (Stop Reasons)

When a prompt finishes, `PromptResponse` is returned with `stopReason`:
- `"end_turn"` — Normal completion
- `"cancelled"` — User/system cancelled
- `"refusal"` — Agent refused

### 1.7 Complete Example Flow

```jsonl
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"I'll analyze "}}}}
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"the codebase."}}}}
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"tool_call","toolCallId":"call_1","title":"read: src/main.ts","status":"in_progress","rawInput":{"path":"src/main.ts"},"kind":"read"}}}
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_1","status":"completed","rawOutput":{"content":"file contents..."}}}}
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"usage_update","used":150,"size":8000}}}
```

### 1.8 Key Files

| File | Purpose |
|------|---------|
| `src/acp/server.ts` | ACP server entry point, stdio nd-JSON transport |
| `src/acp/translator.ts` | Gateway events → ACP session updates |
| `src/acp/runtime/types.ts` | `AcpRuntimeEvent`, `AcpSessionUpdateTag` type definitions |
| `src/acp/event-mapper.ts` | `formatToolTitle()`, `inferToolKind()` helpers |
| `src/acp/client.ts` | ACP client-side event printer |
| `extensions/acpx/src/runtime-internals/events.ts` | ACPX event parsing layer |

---

## 2. OpenCode CLI — Actual Format

### 2.1 Protocol Overview

OpenCode outputs JSONL when invoked with `--format json` flag on the `run` command.

**CLI invocation:**
```bash
opencode run --format json "<prompt>"
```

> **Note:** The flag is `--format json`, **not** `--output-format json` or `--print --output-format json`.
> There is no `--print` flag. The `--format` option accepts `"default"` or `"json"`.

Source: `packages/opencode/src/cli/cmd/run.ts` lines 263–268

### 2.2 Base Event Structure

All JSONL events share this structure:

```typescript
{
  type: string,            // Event type identifier
  timestamp: number,       // Milliseconds since epoch (Date.now())
  sessionID: string,       // Session identifier
  ...data                  // Type-specific payload
}
```

Source: `packages/opencode/src/cli/cmd/run.ts` lines 428–434

```typescript
function emit(type: string, data: Record<string, unknown>) {
  if (args.format === "json") {
    process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
    return true
  }
  return false
}
```

### 2.3 Event Types

#### `text` — Completed text output

Emitted when an assistant text part is finalized (has `time.end`).

```json
{
  "type": "text",
  "timestamp": 1704067200000,
  "sessionID": "session-abc123",
  "part": {
    "id": "part-1",
    "sessionID": "session-abc123",
    "messageID": "msg-1",
    "type": "text",
    "text": "I'll help you with that.",
    "synthetic": false,
    "ignored": false,
    "time": {
      "start": 1704067199000,
      "end": 1704067200000
    },
    "metadata": {}
  }
}
```

Source: `run.ts` lines 491–502

#### `tool_use` — Tool execution (completed or errored)

Emitted when a tool part reaches `completed` or `error` status.

```json
{
  "type": "tool_use",
  "timestamp": 1704067201000,
  "sessionID": "session-abc123",
  "part": {
    "id": "part-2",
    "sessionID": "session-abc123",
    "messageID": "msg-1",
    "type": "tool",
    "callID": "call-xyz",
    "tool": "bash",
    "state": {
      "status": "completed",
      "input": { "command": "ls -la" },
      "output": "total 42\n...",
      "title": "bash command",
      "metadata": {},
      "time": {
        "start": 1704067200500,
        "end": 1704067201000
      }
    },
    "metadata": {}
  }
}
```

Source: `run.ts` lines 459–460

**Tool State Variants:**

| Status | Fields |
|--------|--------|
| `pending` | `status`, `input`, `raw` |
| `running` | `status`, `input`, `title?`, `metadata?`, `time.start` |
| `completed` | `status`, `input`, `output`, `title`, `metadata`, `time.start`, `time.end`, `attachments?` |
| `error` | `status`, `input`, `error`, `metadata?`, `time.start`, `time.end` |

#### `step_start` — Agent turn/step begins

```json
{
  "type": "step_start",
  "timestamp": 1704067200000,
  "sessionID": "session-abc123",
  "part": {
    "id": "part-3",
    "sessionID": "session-abc123",
    "messageID": "msg-1",
    "type": "step-start",
    "snapshot": "<optional-encoded-state>"
  }
}
```

Source: `run.ts` lines 483–485

#### `step_finish` — Agent turn/step completes with metrics

```json
{
  "type": "step_finish",
  "timestamp": 1704067203000,
  "sessionID": "session-abc123",
  "part": {
    "id": "part-4",
    "sessionID": "session-abc123",
    "messageID": "msg-1",
    "type": "step-finish",
    "reason": "stop_reason",
    "snapshot": "<optional-encoded-state>",
    "cost": 0.0015,
    "tokens": {
      "total": 200,
      "input": 150,
      "output": 50,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  }
}
```

Source: `run.ts` lines 487–489

#### `reasoning` — Extended thinking output

Only emitted when `--thinking` flag is used and reasoning part is finalized.

```json
{
  "type": "reasoning",
  "timestamp": 1704067200500,
  "sessionID": "session-abc123",
  "part": {
    "id": "part-5",
    "sessionID": "session-abc123",
    "messageID": "msg-1",
    "type": "reasoning",
    "text": "Let me think about this...",
    "metadata": {},
    "time": {
      "start": 1704067200000,
      "end": 1704067200500
    }
  }
}
```

Source: `run.ts` lines 504–516

#### `error` — Session-level error

```json
{
  "type": "error",
  "timestamp": 1704067205000,
  "sessionID": "session-abc123",
  "error": {
    "name": "ProviderAuthError",
    "data": {
      "providerID": "anthropic",
      "message": "Invalid API key"
    }
  }
}
```

Source: `run.ts` lines 519–528

**Error types:** `ProviderAuthError`, `ApiError`, `MessageAbortedError`, `ContextOverflowError`,
`StructuredOutputError`, `MessageOutputLengthError`, `UnknownError`

### 2.4 Complete Example Session

```jsonl
{"type":"step_start","timestamp":1704067200000,"sessionID":"sess-001","part":{"id":"p1","sessionID":"sess-001","messageID":"m1","type":"step-start"}}
{"type":"text","timestamp":1704067201000,"sessionID":"sess-001","part":{"id":"p2","sessionID":"sess-001","messageID":"m1","type":"text","text":"I'll help you refactor this module.","time":{"start":1704067200500,"end":1704067201000}}}
{"type":"tool_use","timestamp":1704067202000,"sessionID":"sess-001","part":{"id":"p3","sessionID":"sess-001","messageID":"m1","type":"tool","callID":"c1","tool":"read","state":{"status":"completed","input":{"file_path":"src/main.ts"},"output":"// file contents...","title":"read file","metadata":{},"time":{"start":1704067201500,"end":1704067202000}}}}
{"type":"tool_use","timestamp":1704067204000,"sessionID":"sess-001","part":{"id":"p4","sessionID":"sess-001","messageID":"m1","type":"tool","callID":"c2","tool":"edit","state":{"status":"completed","input":{"file_path":"src/main.ts","old_string":"...","new_string":"..."},"output":"File edited","title":"edit file","metadata":{},"time":{"start":1704067203000,"end":1704067204000}}}}
{"type":"text","timestamp":1704067205000,"sessionID":"sess-001","part":{"id":"p5","sessionID":"sess-001","messageID":"m1","type":"text","text":"I've refactored the module successfully.","time":{"start":1704067204500,"end":1704067205000}}}
{"type":"step_finish","timestamp":1704067206000,"sessionID":"sess-001","part":{"id":"p6","sessionID":"sess-001","messageID":"m1","type":"step-finish","reason":"end_turn","cost":0.0032,"tokens":{"input":500,"output":200,"reasoning":0,"cache":{"read":100,"write":50}}}}
```

### 2.5 Key Files

| File | Purpose |
|------|---------|
| `packages/opencode/src/cli/cmd/run.ts` | JSONL emit function (lines 428–434), event loop (lines 442–537) |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | Part type definitions (TextPart, ToolPart, etc.) |
| `packages/opencode/src/session/message-v2.ts` | Message and part schema definitions |

---

## 3. Astro Adapter — Expected Formats

### 3.1 OpenClaw Adapter (`openclaw-adapter.ts`)

**Expected CLI invocation:** `openclaw agent --mode rpc --json --prompt "<task>"`

**Expected flat JSONL event types:**

| Expected Event | Expected Fields | Maps To |
|----------------|-----------------|---------|
| `session.start` | `session_id`, `model` | `stream.sessionInit()` |
| `message.start` | _(none)_ | `stream.status('running', …, 'Agent thinking...')` |
| `content.text` | `text` | `stream.text()` |
| `tool_use.start` | `tool_name`, `tool_input` | `stream.toolUse()` |
| `tool_use.end` | `tool_name`, `result`, `success` | `stream.toolResult()` |
| `file.change` | `path`, `action`, `lines_added`, `lines_removed` | `stream.fileChange()` |
| `message.end` | _(none)_ | `stream.status('running', …, 'Turn complete')` |
| `session.end` | `cost`, `input_tokens`, `output_tokens`, `turns`, `model`, `duration_ms` | Returns metrics |

Source: `packages/agent-runner/src/providers/openclaw-adapter.ts` lines 283–376

### 3.2 OpenCode Adapter (`opencode-adapter.ts`)

**Expected CLI invocation:** `opencode run --print --output-format json "<task>"`

**Expected flat JSONL event types:**

| Expected Event | Expected Fields | Maps To |
|----------------|-----------------|---------|
| `system` | `session_id`, `model` | `stream.sessionInit()` |
| `assistant` | `content[]` or `message.content[]` with `text` and `tool_use` blocks | `stream.text()`, `stream.toolUse()` |
| `tool_result` | `tool_name`, `content`, `is_error` — or content array | `stream.toolResult()` |
| `user` | `message.content[]` with `tool_result` blocks | `stream.toolResult()` |
| `result` | `total_cost_usd`/`cost_usd`/`cost`, `num_turns`/`turns`, `duration_ms`/`duration_api_ms`, `usage`/`tokens`, `model` | Status + metrics |

Source: `packages/agent-runner/src/providers/opencode-adapter.ts` lines 306–415

---

## 4. Gap Analysis: OpenClaw

### 4.1 CLI Invocation — INCOMPATIBLE

| Aspect | Adapter Expects | Actual CLI |
|--------|----------------|------------|
| Command | `openclaw agent --mode rpc --json` | `openclaw acp` |
| Flags | `--mode rpc`, `--json`, `--prompt` | `--url`, `--token`, `--session`, `--verbose` |
| Transport | Flat JSONL to stdout | nd-JSON JSON-RPC 2.0 over stdio (bidirectional) |
| Protocol | Fire-and-forget JSONL lines | Request/response ACP protocol with `initialize`, `newSession`, `prompt` |

**The `--mode rpc` and `--json` flags do not exist in OpenClaw.** The `agent` command does not
accept these arguments.

### 4.2 Event Types — COMPLETE MISMATCH

| Adapter Expects | OpenClaw Actually Produces | Match? |
|-----------------|--------------------------|--------|
| `session.start` | ACP `initialize` response + `newSession` response | ❌ No — Different protocol entirely |
| `content.text` | `session/update` → `agent_message_chunk` | ❌ No — Nested in JSON-RPC envelope |
| `tool_use.start` | `session/update` → `tool_call` | ❌ No — Different structure |
| `tool_use.end` | `session/update` → `tool_call_update` | ❌ No — Different structure |
| `file.change` | _(Not emitted as a separate event)_ | ❌ No — Not available |
| `message.start` | _(No equivalent)_ | ❌ No |
| `message.end` | `PromptResponse` with `stopReason` | ❌ No — Different protocol |
| `session.end` | _(No equivalent — usage via `usage_update`)_ | ❌ No — No cost/token aggregation |

### 4.3 Structural Differences

| Aspect | Adapter Expects | OpenClaw Actual |
|--------|----------------|-----------------|
| **Envelope** | `{"type":"event_name", ...fields}` | `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"...","update":{...}}}` |
| **Text delivery** | Single `text` field | Nested `update.content.type` + `update.content.text` |
| **Tool identification** | `tool_name` string | `toolCallId` + `title` (formatted description) |
| **Tool input** | `tool_input` object | `rawInput` object |
| **Tool result** | `result` + `success` boolean | `rawOutput` + `status` ("completed"/"failed") |
| **File changes** | Dedicated `file.change` event | Not tracked as separate events |
| **Cost/tokens** | `session.end` with `cost`, `input_tokens`, `output_tokens` | `usage_update` with only `used` and `size` (no cost) |
| **Session ID** | `session_id` in `session.start` event | `sessionId` in ACP `newSession` response |
| **Model** | `model` in `session.start` event | Not directly exposed in ACP events |

### 4.4 Missing in OpenClaw

- **No flat JSONL mode** — OpenClaw only speaks ACP protocol
- **No cost tracking** — `usage_update` has `used`/`size` (token counts) but no dollar cost
- **No file change events** — Must infer from tool calls
- **No aggregated session metrics** — No `session.end` equivalent with totals
- **No model field** — Not exposed in session updates

### 4.5 Integration Path

To integrate OpenClaw, the adapter must either:

1. **Speak ACP protocol** — Implement a JSON-RPC 2.0 client that calls `initialize` → `newSession` → `prompt` and processes `session/update` notifications, OR
2. **Use the ACPX runtime events** — If OpenClaw exposes a simplified event stream via the ACPX layer, parse `AcpRuntimeEvent` types (`text_delta`, `tool_call`, `done`, `error`, `status`)

---

## 5. Gap Analysis: OpenCode

### 5.1 CLI Invocation — PARTIALLY WRONG

| Aspect | Adapter Expects | Actual CLI |
|--------|----------------|------------|
| Command | `opencode run --print --output-format json "<prompt>"` | `opencode run --format json "<prompt>"` |
| `--print` flag | Expected | **Does not exist** |
| `--output-format` | Expected | **Does not exist** — use `--format` |

### 5.2 Event Types — COMPLETE MISMATCH

| Adapter Expects | OpenCode Actually Produces | Match? |
|-----------------|--------------------------|--------|
| `system` (session_id, model) | _(Not emitted)_ | ❌ No — No session init event |
| `assistant` (content blocks) | `text` (with part object) | ❌ No — Different structure |
| `tool_use` in assistant content | `tool_use` (with part object) | ❌ Partial — Same concept, wrong structure |
| `tool_result` / `user` | _(Not emitted)_ — tool results are in `tool_use` events | ❌ No — Results bundled in `tool_use` |
| `result` (cost, tokens) | `step_finish` (per-step metrics) | ❌ No — Per-step, not session-level |
| _(Not expected)_ | `step_start` | 🆕 New — Not handled |
| _(Not expected)_ | `reasoning` | 🆕 New — Not handled |
| _(Not expected)_ | `error` | 🆕 New — Not handled |

### 5.3 Structural Differences

| Aspect | Adapter Expects | OpenCode Actual |
|--------|----------------|-----------------|
| **Envelope** | `{"type":"system/assistant/result", ...}` | `{"type":"text/tool_use/step_finish/...", "timestamp": N, "sessionID": "...", "part": {...}}` |
| **Session init** | `{"type":"system","session_id":"...","model":"..."}` | **Not emitted** — `sessionID` is in every event but no init event |
| **Text delivery** | `content[{type:"text",text:"..."}]` inside `assistant` | `part.text` inside `text` event |
| **Tool use** | `content[{type:"tool_use",id:"...",name:"...",input:{}}]` inside `assistant` | `part.tool`, `part.callID`, `part.state.input` inside `tool_use` event |
| **Tool result** | Separate `tool_result`/`user` event with `tool_name`, `content`, `is_error` | **Bundled in `tool_use` event** — `part.state.status` + `part.state.output`/`part.state.error` |
| **Cost metrics** | Single `result` event: `total_cost_usd`, `usage.input_tokens`, `usage.output_tokens` | **Per-step** in `step_finish`: `part.cost`, `part.tokens.input`, `part.tokens.output` |
| **Model** | `model` in `system` or `result` event | **Not emitted** in JSONL events |
| **Turns** | `num_turns` in `result` event | Count `step_finish` events yourself |
| **Duration** | `duration_ms` in `result` event | **Not emitted** — compute from timestamps |
| **Tool ID correlation** | Adapter maintains `toolIdToName` map from `tool_use.id` → `tool_use.name` | **Not needed** — `tool_use` events include both `part.tool` (name) and result |

### 5.4 Missing in OpenCode JSONL

- **No session init event** — `sessionID` appears in every event but there's no dedicated init
- **No model field** — Not exposed in any JSONL event
- **No session-level aggregate metrics** — Must sum `step_finish.part.cost` and `step_finish.part.tokens` across all steps
- **No explicit session end event** — The CLI exits when the session goes idle
- **No file change events** — Must infer from tool calls (edit, write tools)

### 5.5 New Events Not Expected by Adapter

| OpenCode Event | Purpose | Adapter Impact |
|---------------|---------|----------------|
| `step_start` | Marks beginning of an LLM turn | Could map to `stream.status('running', …, 'Thinking...')` |
| `step_finish` | Marks end of turn with per-step cost/tokens | **Critical** — Only source of cost data |
| `reasoning` | Extended thinking content | Could map to `stream.text('[thinking] ' + text)` |
| `error` | Session errors with typed error objects | Could map to `stream.stderr()` or error handling |

---

## 6. Summary of Required Adapter Changes

### 6.1 OpenClaw Adapter — Needs Complete Rewrite

The current adapter is a **non-functional stub** that expects event types OpenClaw never emits.
Two integration strategies:

**Option A: ACP Protocol Client (Recommended)**
- Replace CLI spawning with an ACP client using `@agentclientprotocol/sdk`
- Implement the full ACP handshake: `initialize` → `newSession` → `prompt`
- Process `session/update` notifications and map to `TaskOutputStream`
- Mapping table:

  | ACP Event | → TaskOutputStream |
  |-----------|-------------------|
  | `agent_message_chunk` | `stream.text(update.content.text)` |
  | `tool_call` | `stream.toolUse(update.title, update.rawInput)` |
  | `tool_call_update` (completed) | `stream.toolResult(update.toolCallId, update.rawOutput, true)` |
  | `tool_call_update` (failed) | `stream.toolResult(update.toolCallId, update.rawOutput, false)` |
  | `usage_update` | `stream.status(…, update.used + '/' + update.size)` |
  | `PromptResponse` | Return metrics (no cost data available) |

**Option B: ACPX Runtime Event Layer**
- If a simplified stdio event stream can be extracted, parse `AcpRuntimeEvent`:
  - `text_delta` → `stream.text()`
  - `tool_call` → `stream.toolUse()`
  - `status` → `stream.status()`
  - `done` → Return result
  - `error` → Error handling

**Missing data regardless of approach:**
- Dollar cost (OpenClaw `usage_update` only has token counts)
- File change tracking (must infer from tool calls)
- Model identification

### 6.2 OpenCode Adapter — Needs Complete Rewrite

The current adapter expects Claude Code-style `system`/`assistant`/`tool_result`/`result` events.
OpenCode emits a completely different format.

**Required changes:**

1. **Fix CLI invocation:** `opencode run --format json "<prompt>"` (not `--print --output-format json`)
2. **Replace event handler** with new mapping:

   | OpenCode Event | → TaskOutputStream |
   |---------------|-------------------|
   | First event's `sessionID` | `stream.sessionInit(sessionID)` (no model available) |
   | `text` | `stream.text(part.text)` |
   | `tool_use` (completed) | `stream.toolUse(part.tool, part.state.input)` then `stream.toolResult(part.tool, part.state.output, true)` |
   | `tool_use` (error) | `stream.toolUse(part.tool, part.state.input)` then `stream.toolResult(part.tool, part.state.error, false)` |
   | `step_start` | `stream.status('running', …, 'Thinking...')` |
   | `step_finish` | Accumulate `part.cost` and `part.tokens` for final metrics |
   | `reasoning` | `stream.text('[thinking] ' + part.text)` (optional) |
   | `error` | `stream.stderr(error.data.message)` or error handling |

3. **Aggregate metrics from `step_finish` events:**
   ```typescript
   // Accumulate across all step_finish events:
   metrics.totalCost += part.cost;
   metrics.inputTokens += part.tokens.input;
   metrics.outputTokens += part.tokens.output;
   metrics.numTurns += 1;
   // Duration: last step_finish timestamp - first step_start timestamp
   ```

4. **Remove Claude Code assumptions:**
   - Remove `toolIdToName` map (not needed — tool_use events include the tool name)
   - Remove `content[]` block parsing (not used)
   - Remove `message.content[]` wrapper support (not used)
   - Remove `total_cost_usd`/`cost_usd`/`cost` field fallbacks (cost is in `step_finish.part.cost`)

### 6.3 Field-Level Mapping Reference

#### OpenClaw ACP → Astro `TaskOutputStream`

```
ACP sessionUpdate             Astro TaskOutputStream method
─────────────────             ──────────────────────────────
agent_message_chunk           text(update.content.text)
  .content.text

tool_call                     toolUse(update.title, update.rawInput)
  .toolCallId
  .title
  .status = "in_progress"
  .rawInput
  .kind

tool_call_update              toolResult(toolCallId, update.rawOutput,
  .toolCallId                   update.status === "completed")
  .status
  .rawOutput

usage_update                  status("running", undefined,
  .used                         `Tokens: ${used}/${size}`)
  .size

(PromptResponse)              → { totalCost: undefined,
  .stopReason                     inputTokens: used,  // from last usage_update
                                  model: undefined }
```

#### OpenCode JSONL → Astro `TaskOutputStream`

```
OpenCode JSONL event          Astro TaskOutputStream method
────────────────────          ──────────────────────────────
(first event)                 sessionInit(event.sessionID)
  .sessionID

text                          text(part.text)
  .part.text

tool_use                      toolUse(part.tool, part.state.input)
  .part.tool                  toolResult(part.tool, part.state.output,
  .part.callID                  part.state.status === "completed")
  .part.state.status
  .part.state.input
  .part.state.output
  .part.state.error

step_start                    status("running", undefined, "Thinking...")
  .part.type = "step-start"

step_finish                   (accumulate metrics)
  .part.cost                  metrics.totalCost += part.cost
  .part.tokens.input          metrics.inputTokens += part.tokens.input
  .part.tokens.output         metrics.outputTokens += part.tokens.output
  .part.tokens.reasoning      (track reasoning tokens)
  .part.tokens.cache.read     (track cache usage)
  .part.tokens.cache.write
  .part.reason

reasoning                     text("[thinking] " + part.text)
  .part.text                  (or: skip / log only)

error                         stderr(error.data.message)
  .error.name
  .error.data.message
```

---

## Appendix A: Event Format Quick Comparison

| Feature | OpenClaw (ACP) | OpenCode (JSONL) | Adapter (Expected) |
|---------|---------------|-----------------|-------------------|
| Protocol | JSON-RPC 2.0 nd-JSON | Flat JSONL | Flat JSONL |
| Transport | Bidirectional stdio | Unidirectional stdout | Unidirectional stdout |
| Text event | `agent_message_chunk` | `text` | `content.text` / `assistant` |
| Tool start | `tool_call` | _(bundled in `tool_use`)_ | `tool_use.start` / `assistant.content[tool_use]` |
| Tool result | `tool_call_update` | _(bundled in `tool_use`)_ | `tool_use.end` / `tool_result` |
| File changes | Not tracked | Not tracked | `file.change` |
| Cost data | Token counts only (`usage_update`) | Per-step (`step_finish.part.cost`) | Session-level (`session.end` / `result`) |
| Session init | ACP handshake | None (sessionID in every event) | `session.start` / `system` |
| Session end | `PromptResponse` | Process exit | `session.end` / `result` |
| Model info | Not exposed | Not exposed | Expected in init/result |

## Appendix B: Test Coverage Status

The existing test files in the agent-runner test against the **expected** (incorrect) formats:

- `packages/agent-runner/tests/openclaw-jsonl-parser.test.ts` — Tests `session.start`, `content.text`, etc. (all fictional)
- `packages/agent-runner/tests/opencode-jsonl-parser.test.ts` — Tests `system`, `assistant`, `tool_result`, `result` (all fictional)

**Both test suites will need to be rewritten** alongside the adapter changes to test against the
actual event formats documented above.
