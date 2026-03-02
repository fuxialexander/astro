# CLI JSONL Event Formats: OpenClaw & OpenCode

This document describes the actual JSONL event formats output by the OpenClaw and OpenCode CLIs, based on source code analysis, and compares them against what the Astro adapters currently expect.

## Executive Summary

There are **significant mismatches** between what the CLIs actually output and what the Astro adapters expect:

| CLI | Actual Format | Adapter Expects | Gap Severity |
|-----|---------------|-----------------|--------------|
| OpenClaw | ACP protocol (delta/final/aborted/error) | session.start, content.text, tool_use.start, etc. | **HIGH** |
| OpenCode | text, tool_use, step_start, step_finish, reasoning, error | system, assistant, tool_result, result | **HIGH** |

---

## OpenClaw JSONL Format (Actual)

### Source Files Analyzed
- `src/acp/translator.ts` - ACP to Gateway translation
- `src/acp/event-mapper.ts` - Event mapping utilities
- `src/gateway/protocol/schema/logs-chat.ts` - ChatEvent schema
- `src/acp/client.ts` - ACP client implementation

### Protocol: ACP (Agent Client Protocol)

OpenClaw uses the `@agentclientprotocol/sdk` for its ACP mode. Communication happens over stdio using NDJSON.

#### ChatEvent Schema (Gateway Events)
```typescript
ChatEventSchema = {
  runId: string,           // Non-empty string
  sessionKey: string,      // Non-empty string
  seq: number,             // >= 0
  state: "delta" | "final" | "aborted" | "error",
  message?: unknown,       // Optional message data
  errorMessage?: string,   // Optional error message
  usage?: unknown,         // Optional usage data
  stopReason?: string,     // Optional stop reason
}
```

#### Session Update Types (ACP Protocol)
The ACP protocol emits session updates with these types:

```typescript
// Text streaming
{
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: string }
}

// Tool call started
{
  sessionUpdate: "tool_call",
  toolCallId: string,
  title: string,           // Formatted as "toolName: arg1: val1, arg2: val2"
  status: "in_progress" | "completed" | "failed",
  rawInput?: Record<string, unknown>,
  kind: "read" | "edit" | "delete" | "move" | "search" | "execute" | "fetch" | "other"
}

// Tool call result
{
  sessionUpdate: "tool_call_update",
  toolCallId: string,
  status: "completed" | "failed",
  rawOutput?: unknown
}

// Available commands
{
  sessionUpdate: "available_commands_update",
  availableCommands: Array<{ name: string, ... }>
}

// Usage update
{
  sessionUpdate: "usage_update",
  used: number,
  size: number,
  cost: { amount: number, currency: string }
}
```

#### AgentEvent Schema (Tool Streaming)
```typescript
AgentEventSchema = {
  runId: string,
  seq: number,             // >= 0
  stream: string,          // e.g., "tool"
  ts: number,              // Timestamp >= 0
  data: Record<string, unknown>  // Tool-specific data
}

// Tool events (stream: "tool")
{
  phase: "start" | "result",
  name: string,            // Tool name
  toolCallId: string,
  args?: Record<string, unknown>,  // For start phase
  result?: unknown,        // For result phase
  isError?: boolean        // For result phase
}
```

#### Stop Reasons
- `end_turn` - Normal completion
- `cancelled` - Aborted by user
- `refusal` - Error/refused

---

## OpenCode JSONL Format (Actual)

### Source Files Analyzed
- `packages/opencode/src/cli/cmd/run.ts` - CLI run command with `--format json`
- `packages/opencode/src/session/index.ts` - Session management
- `packages/opencode/src/acp/agent.ts` - ACP agent implementation

### CLI JSON Output (`--format json`)

When running with `--format json`, OpenCode emits JSONL to stdout:

```typescript
// Base structure for all events
{
  type: string,
  timestamp: number,       // Date.now() in milliseconds
  sessionID: string,
  ...eventData
}
```

#### Event Types

**Text Event**
```json
{
  "type": "text",
  "timestamp": 1709345678000,
  "sessionID": "session_abc123",
  "part": {
    "type": "text",
    "text": "...",
    "time": { "start": 123, "end": 456 }
  }
}
```

**Tool Use Event**
```json
{
  "type": "tool_use",
  "timestamp": 1709345678000,
  "sessionID": "session_abc123",
  "part": {
    "type": "tool",
    "tool": "bash",
    "id": "part_xyz",
    "state": {
      "status": "completed" | "running" | "error",
      "input": { ... },
      "output": "...",
      "error": "...",
      "metadata": { ... }
    }
  }
}
```

**Step Start Event**
```json
{
  "type": "step_start",
  "timestamp": 1709345678000,
  "sessionID": "session_abc123",
  "part": {
    "type": "step-start",
    ...
  }
}
```

**Step Finish Event**
```json
{
  "type": "step_finish",
  "timestamp": 1709345678000,
  "sessionID": "session_abc123",
  "part": {
    "type": "step-finish",
    ...
  }
}
```

**Reasoning Event** (requires `--thinking` flag)
```json
{
  "type": "reasoning",
  "timestamp": 1709345678000,
  "sessionID": "session_abc123",
  "part": {
    "type": "reasoning",
    "text": "...",
    "time": { "start": 123, "end": 456 }
  }
}
```

**Error Event**
```json
{
  "type": "error",
  "timestamp": 1709345678000,
  "sessionID": "session_abc123",
  "error": {
    "name": "ErrorName",
    "data": { "message": "..." }
  }
}
```

### Bus Events (Internal)

OpenCode uses a bus-based event system internally:

```typescript
// Session events
"session.created" | "session.updated" | "session.deleted" | "session.diff" | "session.error"

// Message events
"message.updated" | "message.part.updated" | "message.part.removed"

// Permission events
"permission.asked"

// Session status
"session.status" // with status.type: "idle" | "running" | etc.
```

---

## Astro Adapter Expectations (Current)

### OpenClaw Adapter (`openclaw-adapter.ts`)

**Expected Event Types:**
```typescript
switch (type) {
  case 'session.start':     // → sessionInit(session_id, model)
  case 'message.start':     // → status('running', undefined, 'Agent thinking...')
  case 'content.text':      // → text(text)
  case 'tool_use.start':    // → toolUse(tool_name, tool_input)
  case 'tool_use.end':      // → toolResult(tool_name, result, success)
  case 'file.change':       // → fileChange(path, action, linesAdded, linesRemoved)
  case 'message.end':       // → status('running', undefined, 'Turn complete')
  case 'session.end':       // → metrics extraction
}
```

**Expected Fields:**
- `session_id`, `model` (session.start)
- `text` (content.text)
- `tool_name`, `tool_input`, `result`, `success` (tool events)
- `path`, `action`, `lines_added`, `lines_removed` (file.change)
- `cost`, `input_tokens`, `output_tokens`, `turns`, `model`, `duration_ms` (session.end)

### OpenCode Adapter (`opencode-adapter.ts`)

**Expected Event Types:**
```typescript
switch (type) {
  case 'system':       // → sessionInit(session_id, model)
  case 'assistant':    // → text + tool_use content blocks
  case 'tool_result':  // → toolResult(tool_name, content, !is_error)
  case 'user':         // → tool_result content blocks
  case 'result':       // → metrics extraction
}
```

**Expected `assistant` Block Structure:**
```typescript
{
  type: "assistant",
  content: [
    { type: "text", text: string },
    { type: "tool_use", id: string, name: string, input: unknown }
  ]
}
// Or with message wrapper:
{
  type: "assistant",
  message: { content: [...] }
}
```

**Expected `result` Fields:**
- `total_cost_usd` | `cost_usd` | `cost`
- `num_turns` | `turns`
- `duration_ms` | `duration_api_ms`
- `usage.input_tokens`, `usage.output_tokens`
- `tokens.input`, `tokens.output`
- `model`

---

## Gap Analysis

### OpenClaw Gaps

| Expected by Adapter | Actual CLI Output | Gap |
|---------------------|-------------------|-----|
| `session.start` | ACP `sessionUpdate` with init data | Format mismatch |
| `content.text` | ACP `agent_message_chunk` | Different structure |
| `tool_use.start` | ACP `tool_call` | Different field names |
| `tool_use.end` | ACP `tool_call_update` | Different field names |
| `file.change` | Not emitted in ACP | **Missing** |
| `message.start/end` | Gateway `delta`/`final` states | Different pattern |
| `session.end` | ACP completion with stop_reason | Different structure |

**Recommendation:** The adapter should be rewritten to handle ACP protocol events directly:
- Listen for `agent_message_chunk` for text streaming
- Listen for `tool_call`/`tool_call_update` for tool events
- Track session state from `delta`/`final`/`aborted`/`error` states
- Extract metrics from usage updates

### OpenCode Gaps

| Expected by Adapter | Actual CLI Output | Gap |
|---------------------|-------------------|-----|
| `system` | Not emitted | **Missing** |
| `assistant` (content blocks) | `text` (flat part structure) | Format mismatch |
| `tool_result` | `tool_use` with `state.output` | Different structure |
| `result` | Not emitted | **Missing** |

**Actual CLI Events:**
- `text` - Text output with `part.text`
- `tool_use` - Tool usage with `part.state.input/output`
- `step_start` - Step started
- `step_finish` - Step finished
- `reasoning` - Reasoning output
- `error` - Error event

**Recommendation:** The adapter should be rewritten to handle actual CLI output:
- Listen for `text` events and extract `part.text`
- Listen for `tool_use` events with `state.status === "completed"`
- Extract metrics from session completion (may need to track internally)
- Handle `error` events for failure cases

---

## Migration Path

### Option 1: Update Adapters to Match CLI Output

Rewrite `openclaw-adapter.ts`:
```typescript
case 'delta': // ACP state
  if (event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'text') stream.text(block.text);
    }
  }
  break;
```

Rewrite `opencode-adapter.ts`:
```typescript
case 'text':
  if (event.part?.text) stream.text(event.part.text);
  break;
case 'tool_use':
  if (event.part?.state?.status === 'completed') {
    stream.toolResult(event.part.tool, event.part.state.output, true);
  } else if (event.part?.state?.status === 'running') {
    stream.toolUse(event.part.tool, event.part.state.input);
  }
  break;
```

### Option 2: Request CLI Changes

Work with OpenClaw/OpenCode maintainers to add a compatibility output mode that matches the expected format.

### Option 3: Add Translation Layer

Create intermediate parsers that translate actual CLI output to the expected format before passing to adapters.

---

## References

- OpenClaw ACP: `@agentclientprotocol/sdk` v0.13.x
- OpenCode SDK: `@opencode-ai/sdk/v2`
- Astro Adapters: `packages/agent-runner/src/providers/`

---

## Appendix: Full Schema Definitions

### OpenClaw ChatEvent (TypeBox)
```typescript
const ChatEventSchema = Type.Object({
  runId: NonEmptyString,
  sessionKey: NonEmptyString,
  seq: Type.Integer({ minimum: 0 }),
  state: Type.Union([
    Type.Literal("delta"),
    Type.Literal("final"),
    Type.Literal("aborted"),
    Type.Literal("error"),
  ]),
  message: Type.Optional(Type.Unknown()),
  errorMessage: Type.Optional(Type.String()),
  usage: Type.Optional(Type.Unknown()),
  stopReason: Type.Optional(Type.String()),
}, { additionalProperties: false });
```

### OpenCode Part Types
```typescript
// From MessageV2 in session/message-v2.ts
type Part =
  | { type: "text", text: string, time: { start?: number, end?: number } }
  | { type: "tool", tool: string, id: string, state: ToolState }
  | { type: "step-start", ... }
  | { type: "step-finish", ... }
  | { type: "reasoning", text: string, time: { start?: number, end?: number } }

type ToolState = {
  status: "running" | "completed" | "error",
  input: unknown,
  output?: string,
  error?: string,
  metadata?: Record<string, unknown>
}
```
