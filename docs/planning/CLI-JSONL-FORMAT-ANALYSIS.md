# CLI JSONL Format Analysis: OpenClaw vs OpenCode

This document analyzes the actual JSONL event formats output by the OpenClaw and OpenCode CLIs, compares them against what the Astro adapters currently expect, and documents gaps and recommendations.

## Overview

Both CLI tools output JSONL (newline-delimited JSON) for programmatic consumption. However, they use different event schemas and naming conventions:

- **OpenClaw** uses ACP (Agent Client Protocol) conventions with event types like `text_delta`, `tool_call`, `status`
- **OpenCode** uses Anthropic-style message formats with event types like `text`, `tool_use`, `step_start`, `step_finish`

---

## OpenClaw JSONL Format

### CLI Invocation
```bash
openclaw agent --mode rpc --json --prompt "<task>"
```

### Event Types

OpenClaw outputs events via its Gateway WebSocket protocol, which emits `chat` events with the following structure:

#### ChatEvent Schema (from `gateway/protocol/schema/logs-chat.ts`)
```typescript
{
  runId: string;           // Non-empty run identifier
  sessionKey: string;      // Non-empty session key
  seq: number;             // Sequence number (0+)
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;       // Message content for delta events
  errorMessage?: string;   // Error description for error state
  usage?: unknown;         // Usage metrics
  stopReason?: string;     // Reason for stopping
}
```

#### AgentEvent Schema (from `gateway/protocol/schema/agent.ts`)
```typescript
{
  runId: string;           // Non-empty run identifier
  seq: number;             // Sequence number (0+)
  stream: string;          // Event stream name (e.g., "tool")
  ts: number;              // Timestamp (milliseconds)
  data: Record<string, unknown>;  // Event payload
}
```

### What Astro Adapter Currently Expects

The `openclaw-adapter.ts` expects these event types:

| Event Type | Purpose | Expected Fields |
|------------|---------|-----------------|
| `session.start` | Session initialization | `session_id`, `model` |
| `message.start` | Agent thinking indicator | (none) |
| `content.text` | Text output streaming | `text` |
| `tool_use.start` | Tool invocation start | `tool_name`, `tool_input` |
| `tool_use.end` | Tool invocation complete | `tool_name`, `result`, `success` |
| `file.change` | File modification | `path`, `action`, `lines_added`, `lines_removed` |
| `message.end` | Turn completion | (none) |
| `session.end` | Session metrics | `cost`, `input_tokens`, `output_tokens`, `turns`, `model`, `duration_ms` |

### Actual OpenClaw Gateway Events

Based on the source code analysis, OpenClaw's Gateway actually emits:

#### Chat Events (`evt.event === "chat"`)
- `state: "delta"` - Contains message content updates with `content` array
- `state: "final"` - Session complete normally
- `state: "aborted"` - Session cancelled
- `state: "error"` - Session error

#### Agent Events (`evt.event === "agent"`, `stream === "tool"`)
- `phase: "start"` - Tool execution starting with `name`, `toolCallId`, `args`
- `phase: "result"` - Tool execution complete with `result`, `isError`, `toolCallId`

### Gap Analysis

| Expected (Adapter) | Actual (Gateway) | Gap |
|--------------------|------------------|-----|
| `session.start` | Not directly emitted | **MISSING** - Need to derive from session initialization |
| `content.text` | `delta` state with `message.content[].text` | **FORMAT MISMATCH** - Nested vs flat |
| `tool_use.start` | Agent event `phase: "start"` | **NAME MISMATCH** - Different field names |
| `tool_use.end` | Agent event `phase: "result"` | **NAME MISMATCH** - `isError` vs `success` |
| `file.change` | Not directly in protocol | **MISSING** - Need to extract from tool results |
| `session.end` | `final` state + `usage` field | **FORMAT MISMATCH** - Fields differ |

---

## OpenCode JSONL Format

### CLI Invocation
```bash
opencode run --format json "<message>"
# or
opencode run --print --output-format json "<message>"
```

### Event Types (from `cli/cmd/run.ts`)

When `--format json` is specified, OpenCode emits:

```typescript
{
  type: string;            // Event type
  timestamp: number;       // Date.now() milliseconds
  sessionID: string;       // Session identifier
  ...eventData             // Type-specific data
}
```

### Event Types Emitted

| Event Type | When Emitted | Data Structure |
|------------|--------------|----------------|
| `text` | Text content complete | `{ part: TextPart }` |
| `tool_use` | Tool completed/errored | `{ part: ToolPart }` |
| `step_start` | Step beginning | `{ part: StepStartPart }` |
| `step_finish` | Step ending | `{ part: StepFinishPart }` |
| `reasoning` | Reasoning/thinking content | `{ part: ReasoningPart }` |
| `error` | Session error | `{ error: ErrorObject }` |

### Part Structures (from SDK/session types)

#### TextPart
```typescript
{
  type: "text";
  text: string;
  time?: { start?: number; end?: number };
}
```

#### ToolPart
```typescript
{
  type: "tool";
  tool: string;           // Tool name
  id: string;             // Tool call ID
  state: {
    status: "pending" | "running" | "completed" | "error";
    input?: unknown;
    output?: unknown;
    error?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  };
}
```

#### ReasoningPart
```typescript
{
  type: "reasoning";
  text: string;
  time?: { start?: number; end?: number };
}
```

### What Astro Adapter Currently Expects

The `opencode-adapter.ts` expects these event types:

| Event Type | Purpose | Expected Fields |
|------------|---------|-----------------|
| `system` | Session initialization | `session_id`, `model` |
| `assistant` | Text + tool_use blocks | `content[]` or `message.content[]` |
| `user` / `tool_result` | Tool results | `content[].tool_use_id`, `content[].content`, `content[].is_error` |
| `result` | Final metrics | `total_cost_usd`, `num_turns`, `duration_ms`, `usage`, `model` |

### Actual OpenCode Output Format

Based on `run.ts` line 428-535:

```typescript
// When --format json is used
emit(type: string, data: Record<string, unknown>) {
  process.stdout.write(JSON.stringify({
    type,
    timestamp: Date.now(),
    sessionID,
    ...data
  }) + EOL)
}
```

Actual emitted types:
- `text` - with `{ part: TextPart }`
- `tool_use` - with `{ part: ToolPart }`
- `step_start` - with `{ part: StepStartPart }`
- `step_finish` - with `{ part: StepFinishPart }`
- `reasoning` - with `{ part: ReasoningPart }`
- `error` - with `{ error: ErrorObject }`

### Gap Analysis

| Expected (Adapter) | Actual (CLI) | Gap |
|--------------------|--------------|-----|
| `system` | Not emitted | **MISSING** - Session init not in JSON format |
| `assistant` with content blocks | `text`, `tool_use` separate | **FORMAT MISMATCH** - Flat vs nested |
| `user` / `tool_result` | `tool_use` with state.output | **FORMAT MISMATCH** - Different structure |
| `result` | Not emitted (process exit) | **MISSING** - No final metrics event |

---

## Summary of Gaps

### OpenClaw Gaps

1. **Session Lifecycle Events**
   - No explicit `session.start` event in RPC mode
   - Session events are embedded in Gateway WebSocket protocol

2. **Event Name Misalignment**
   - Adapter expects `tool_use.start/end`, Gateway emits `agent` events with `phase`
   - Adapter expects `content.text`, Gateway emits `delta` state with nested content

3. **File Change Detection**
   - No native `file.change` events; must be inferred from tool results

4. **Metrics Location**
   - Final metrics in `usage` field of `final` state, not separate `session.end` event

### OpenCode Gaps

1. **Session Init Missing**
   - No `system` event emitted in JSON format mode

2. **Event Structure Mismatch**
   - Emits flat events (`text`, `tool_use`) with `part` wrapper
   - Adapter expects nested `assistant.content[]` blocks

3. **Tool Result Format**
   - Emits as `tool_use` with `state.status === "completed"`
   - Adapter expects `user` or `tool_result` events

4. **Final Metrics Missing**
   - No `result` event emitted in JSON format
   - Metrics only available at process exit

5. **New Event Types Not Handled**
   - `step_start` / `step_finish` not mapped in adapter
   - `reasoning` events not mapped

---

## Recommendations

### For OpenClaw Adapter

1. **Refactor to handle Gateway WebSocket protocol directly**
   - Parse `chat` events with `state` field
   - Extract text from `message.content[].text`

2. **Handle Agent tool events**
   - Map `stream: "tool"` + `phase: "start"` → `toolUse`
   - Map `stream: "tool"` + `phase: "result"` → `toolResult`

3. **Add ACP session event mapping**
   - Use ACP SDK events (`agent_message_chunk`, `tool_call`, `tool_call_update`)

### For OpenCode Adapter

1. **Update to handle actual JSON format**
   - Accept `type: "text"` + `part.text` format
   - Accept `type: "tool_use"` + `part.tool` + `part.state` format

2. **Add new event handlers**
   - `step_start` → session status update
   - `step_finish` → turn completion
   - `reasoning` → thinking indicator (optional)

3. **Handle missing session init**
   - Generate synthetic `sessionInit` on first event
   - Use `sessionID` from event timestamp as session identifier

4. **Handle missing final metrics**
   - Track metrics incrementally from tool events
   - Emit final metrics on process exit

---

## Reference: Complete Event Type Mapping

### OpenClaw
```
Gateway Protocol             →  Adapter Expected
─────────────────────────────────────────────────
chat.state="delta"           →  content.text
agent.stream="tool".start    →  tool_use.start
agent.stream="tool".result   →  tool_use.end
chat.state="final"           →  session.end
chat.state="aborted"         →  cancelled
chat.state="error"           →  error
```

### OpenCode
```
CLI JSON Format              →  Adapter Expected
─────────────────────────────────────────────────
(none - first event)         →  system (session init)
text + part                  →  assistant.content[type=text]
tool_use + part              →  assistant.content[type=tool_use]
tool_use + state.completed   →  user.content[type=tool_result]
step_start                   →  (not mapped)
step_finish                  →  (not mapped)
reasoning                    →  (not mapped)
error                        →  error
(process exit)               →  result
```

---

## Appendix: CLI Source File Locations

### OpenClaw
- Protocol schema: `src/gateway/protocol/schema/`
- ACP translator: `src/acp/translator.ts`
- Event mapper: `src/acp/event-mapper.ts`
- Server chat: `src/gateway/server-chat.ts`

### OpenCode
- CLI run command: `packages/opencode/src/cli/cmd/run.ts`
- Session types: `packages/opencode/src/session/index.ts`
- Message types: `packages/opencode/src/session/message-v2.ts`
- Provider transform: `packages/opencode/src/provider/transform.ts`
