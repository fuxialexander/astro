# CLI JSONL Format Analysis: OpenClaw and OpenCode

This document provides a comprehensive analysis of the actual JSONL event formats output by OpenClaw and OpenCode CLIs, based on source code analysis. It identifies gaps between the actual formats and what the Astro adapters currently expect.

**Last Updated:** 2025-03-02
**Status:** ✅ VERIFIED against source code

## Source Verification

| CLI | Source Files Examined | Verification Date |
|-----|----------------------|-------------------|
| OpenClaw | `/tmp/openclaw/src/acp/runtime/types.ts` | 2025-03-02 |
| OpenCode | `/tmp/opencode/packages/opencode/src/cli/cmd/run.ts` | 2025-03-02 |
| Astro Adapters | `packages/agent-runner/src/providers/openclaw-adapter.ts`, `opencode-adapter.ts` | 2025-03-02 |

---

## Executive Summary

| CLI | Actual Format | Adapter Expectation | Gaps |
|-----|---------------|---------------------|------|
| **OpenClaw** | ACP Runtime Events (`text_delta`, `tool_call`, `status`, `done`, `error`) | Legacy flat events (`session.start`, `content.text`, etc.) OR Gateway EventFrame | **Significant mismatch** — adapter supports legacy format but not ACP |
| **OpenCode** | Typed parts via SDK events (`text`, `tool_use`, `step_start`, `step_finish`, `reasoning`, `error`) with timestamp/sessionID | Claude-like events (`system`, `assistant`, `tool_result`, `result`) | **Partial mismatch** — event structure differs from expected |

---

## OpenClaw JSONL Format (ACP Protocol)

### Source: `/tmp/openclaw/src/acp/runtime/types.ts`

OpenClaw uses the **ACP (Agent Client Protocol)** format for streaming events. The `AcpRuntimeEvent` union type defines 5 core event types:

### Event Types

#### 1. `text_delta` — Text Output Streaming

```typescript
{
  type: "text_delta";
  text: string;                           // Text content to append
  stream?: "output" | "thought";          // Optional stream type indicator
  tag?: AcpSessionUpdateTag;              // Optional tag for categorization
}
```

**Example:**
```jsonl
{"type":"text_delta","text":"Hello ","stream":"output"}
{"type":"text_delta","text":"world","stream":"output","tag":"agent_message_chunk"}
```

#### 2. `status` — Status/Progress Updates

```typescript
{
  type: "status";
  text: string;                           // Status message
  tag?: AcpSessionUpdateTag;              // Optional tag for categorization
  used?: number;                          // Optional resource usage (e.g., tokens used)
  size?: number;                          // Optional size metric
}
```

**Example:**
```jsonl
{"type":"status","text":"Processing...","used":1000,"size":2048,"tag":"usage_update"}
```

#### 3. `tool_call` — Tool/Function Calls

```typescript
{
  type: "tool_call";
  text: string;                           // Tool description text
  tag?: AcpSessionUpdateTag;              // Optional tag for categorization
  toolCallId?: string;                    // Unique identifier for this tool call
  status?: string;                        // Tool execution status (e.g., "in_progress", "completed")
  title?: string;                         // Human-readable tool title
}
```

**Example:**
```jsonl
{"type":"tool_call","text":"Reading file","toolCallId":"call-123","title":"read_file: /path/to/file","status":"in_progress","tag":"tool_call"}
{"type":"tool_call","text":"File read complete","toolCallId":"call-123","status":"completed","tag":"tool_call_update"}
```

#### 4. `done` — Execution Completion

```typescript
{
  type: "done";
  stopReason?: string;                    // Reason for completion (e.g., "end_turn", "cancelled")
}
```

**Example:**
```jsonl
{"type":"done","stopReason":"end_turn"}
```

#### 5. `error` — Error Reporting

```typescript
{
  type: "error";
  message: string;                        // Error message
  code?: string;                          // Error code identifier
  retryable?: boolean;                    // Whether the operation can be retried
}
```

**Example:**
```jsonl
{"type":"error","message":"API rate limit exceeded","code":"rate_limit","retryable":true}
```

### AcpSessionUpdateTag Values

Tags provide additional categorization for events:

| Tag | Description |
|-----|-------------|
| `agent_message_chunk` | Agent response text fragment |
| `agent_thought_chunk` | Agent internal reasoning |
| `tool_call` | Tool execution started |
| `tool_call_update` | Tool execution updated |
| `usage_update` | Resource usage metrics |
| `available_commands_update` | Available commands list |
| `current_mode_update` | Session mode changed |
| `config_option_update` | Configuration changed |
| `session_info_update` | Session metadata updated |
| `plan` | Planning/decomposition output |
| Custom string | User-defined tags supported |

### CLI Invocation

```bash
# ACP mode (streaming)
openclaw acp --no-prefix-cwd

# Batch mode (fallback)
openclaw agent --json --message "<task>"
```

---

## OpenCode JSONL Format (SDK Events)

### Source: `/tmp/opencode/packages/opencode/src/cli/cmd/run.ts`

OpenCode emits **5 primary event types** when using `--format json`. Each event has a consistent wrapper structure:

### Base Event Structure

```typescript
{
  type: "<event_type>";           // Event type identifier
  timestamp: number;              // Unix timestamp in milliseconds (Date.now())
  sessionID: string;              // Session identifier
  ...additionalData               // Event-specific payload
}
```

### Event Types

#### 1. `text` — Completed Text Output

Emitted when a TextPart has a completion time (`part.time?.end`).

```typescript
{
  type: "text";
  timestamp: number;
  sessionID: string;
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: "text";
    text: string;
    synthetic?: boolean;
    ignored?: boolean;
    time?: {
      start: number;
      end: number;           // Required for event emission
    };
    metadata?: Record<string, unknown>;
  }
}
```

**Example:**
```jsonl
{"type":"text","timestamp":1709234567890,"sessionID":"sess-123","part":{"id":"p1","sessionID":"sess-123","messageID":"m1","type":"text","text":"Hello, world!","time":{"start":1709234567800,"end":1709234567890}}}
```

#### 2. `tool_use` — Tool Execution Results

Emitted when a ToolPart has status "completed" or "error".

```typescript
{
  type: "tool_use";
  timestamp: number;
  sessionID: string;
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: "tool";
    callID: string;
    tool: string;                       // Tool name (e.g., "bash", "read", "edit")
    state: ToolStateCompleted | ToolStateError;
    metadata?: Record<string, unknown>;
  }
}
```

**ToolStateCompleted:**
```typescript
{
  status: "completed";
  input: Record<string, unknown>;
  output: string;
  title: string;
  metadata: Record<string, unknown>;
  time: {
    start: number;
    end: number;
    compacted?: number;
  };
  attachments?: FilePart[];
}
```

**ToolStateError:**
```typescript
{
  status: "error";
  input: Record<string, unknown>;
  error: string;
  metadata?: Record<string, unknown>;
  time: {
    start: number;
    end: number;
  };
}
```

**Example:**
```jsonl
{"type":"tool_use","timestamp":1709234568000,"sessionID":"sess-123","part":{"id":"p2","sessionID":"sess-123","messageID":"m1","type":"tool","callID":"call-1","tool":"bash","state":{"status":"completed","input":{"command":"ls"},"output":"file1.txt\nfile2.txt","title":"List files","metadata":{},"time":{"start":1709234567900,"end":1709234568000}}}}
```

#### 3. `step_start` — Step Begins

Emitted when a StepStartPart is received.

```typescript
{
  type: "step_start";
  timestamp: number;
  sessionID: string;
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: "step-start";
    snapshot?: string;
  }
}
```

**Example:**
```jsonl
{"type":"step_start","timestamp":1709234567700,"sessionID":"sess-123","part":{"id":"p0","sessionID":"sess-123","messageID":"m1","type":"step-start"}}
```

#### 4. `step_finish` — Step Completes

Emitted when a StepFinishPart is received. Contains usage metrics.

```typescript
{
  type: "step_finish";
  timestamp: number;
  sessionID: string;
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: "step-finish";
    reason: string;
    snapshot?: string;
    cost: number;
    tokens: {
      total?: number;
      input: number;
      output: number;
      reasoning: number;
      cache: {
        read: number;
        write: number;
      };
    };
  }
}
```

**Example:**
```jsonl
{"type":"step_finish","timestamp":1709234569000,"sessionID":"sess-123","part":{"id":"p3","sessionID":"sess-123","messageID":"m1","type":"step-finish","reason":"end_turn","cost":0.0025,"tokens":{"input":150,"output":75,"reasoning":0,"cache":{"read":0,"write":0}}}}
```

#### 5. `reasoning` — Reasoning Output (Optional)

Emitted when a ReasoningPart has completion time AND `--thinking` flag is enabled.

```typescript
{
  type: "reasoning";
  timestamp: number;
  sessionID: string;
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: "reasoning";
    text: string;
    metadata?: Record<string, unknown>;
    time: {
      start: number;
      end: number;
    };
  }
}
```

**Example:**
```jsonl
{"type":"reasoning","timestamp":1709234567850,"sessionID":"sess-123","part":{"id":"r1","sessionID":"sess-123","messageID":"m1","type":"reasoning","text":"Let me think about this...","time":{"start":1709234567800,"end":1709234567850}}}
```

#### 6. `error` — Session Errors

Emitted when `session.error` event is received.

```typescript
{
  type: "error";
  timestamp: number;
  sessionID: string;
  error: SessionError;
}
```

**SessionError types:**
- `ProviderAuthError` — Provider authentication failed
- `UnknownError` — Generic error
- `MessageOutputLengthError` — Output too long
- `MessageAbortedError` — Message aborted
- `StructuredOutputError` — Structured output parsing failed
- `ContextOverflowError` — Context window exceeded
- `APIError` — API call failed

**Example:**
```jsonl
{"type":"error","timestamp":1709234570000,"sessionID":"sess-123","error":{"name":"APIError","data":{"message":"Rate limit exceeded","statusCode":429,"isRetryable":true}}}
```

### CLI Invocation

```bash
opencode run --format json "your prompt"

# With thinking/reasoning output
opencode run --format json --thinking "your prompt"
```

---

## Current Adapter Implementation Status

### Summary of Adapter vs CLI Format Compatibility

| Adapter | CLI Invocation Used | Format CLI Outputs | Format Adapter Expects | Status |
|---------|--------------------|--------------------|------------------------|--------|
| OpenClaw | `openclaw agent --json --message "..."` | Batch JSON response OR Gateway EventFrame | ✅ Gateway EventFrame, ✅ Legacy flat, ✅ Batch | **PARTIAL** — ACP format not supported |
| OpenCode | `opencode run --print --output-format json "..."` | SDK wrapper events (`text`, `tool_use`, `step_*`) | ❌ Claude-like events (`system`, `assistant`, `result`) | **BROKEN** — Complete mismatch |

### Key Finding: OpenCode CLI Flag Discrepancy

**The current OpenCode adapter uses incorrect CLI flags:**
- Adapter invokes: `opencode run --print --output-format json`
- Correct invocation: `opencode run --format json`

The `--print` flag does not exist in OpenCode CLI. The `--format` flag (not `--output-format`) controls JSON output.

---

## Current Adapter Expectations vs Actual Formats

### OpenClaw Adapter (`openclaw-adapter.ts`)

**Current CLI invocation (from adapter source):**
```bash
openclaw agent --json --message "<task>"
```

**Formats the adapter handles (lines 327-359):**

1. **Gateway EventFrame format:** ✅ Supported
   ```typescript
   { type: "event", event: "chat"|"agent", payload: {...} }
   ```

2. **Legacy flat format:** ✅ Supported
   ```typescript
   { type: "session.start"|"content.text"|"tool_use.start"|"tool_use.end"|"file.change"|"session.end" }
   ```

3. **Batch response format:** ✅ Supported
   ```typescript
   { runId, status, summary, result: { payloads: [...], meta } }
   ```

4. **ACP Runtime format:** ❌ NOT SUPPORTED
   ```typescript
   { type: "text_delta"|"status"|"tool_call"|"done"|"error", ... }
   ```

**Important:** The OpenClaw ACP runtime format (used by `openclaw acp --no-prefix-cwd`) is documented in the adapter header comments but **not actually handled** by any code path in `handleStreamLine()`.

**Actual ACP format from source (`src/acp/runtime/types.ts`):**
```typescript
export type AcpRuntimeEvent =
  | { type: "text_delta"; text: string; stream?: "output" | "thought"; tag?: AcpSessionUpdateTag; }
  | { type: "status"; text: string; tag?: AcpSessionUpdateTag; used?: number; size?: number; }
  | { type: "tool_call"; text: string; tag?: AcpSessionUpdateTag; toolCallId?: string; status?: string; title?: string; }
  | { type: "done"; stopReason?: string; }
  | { type: "error"; message: string; code?: string; retryable?: boolean; };
```

### Gap Analysis — OpenClaw

| Adapter Expectation | Actual ACP Format | Gap |
|---------------------|-------------------|-----|
| `session.start` → sessionInit | Not present | **MISSING** — Need to emit sessionInit on first event |
| `content.text` → text | `text_delta` | **NAME MISMATCH** — Different event type name |
| `tool_use.start` → toolUse | `tool_call` (status: in_progress) | **STRUCTURE DIFFERENT** — ACP uses status field |
| `tool_use.end` → toolResult | `tool_call` (status: completed) | **STRUCTURE DIFFERENT** — No separate result field |
| `session.end` → metrics | `done` | **MISSING METRICS** — `done` has no usage data |
| N/A | `status` | **NEW** — Progress updates not mapped |
| N/A | `error` | **PARTIALLY MAPPED** — Only in Gateway format |

### OpenCode Adapter (`opencode-adapter.ts`)

**Current CLI invocation (from adapter source, line 149-155):**
```bash
opencode run --print --output-format json "<task>"
```

**⚠️ CRITICAL: These flags are WRONG.** The actual OpenCode CLI uses:
```bash
opencode run --format json "your prompt"
```

**What the adapter expects (lines 306-415):**

```typescript
{ type: "system"|"assistant"|"tool_result"|"result" }
```

- `system` → sessionInit (session_id, model)
- `assistant` → text + tool_use content blocks
- `tool_result` → toolResult
- `result` → final metrics

**What OpenCode CLI actually outputs (from `run.ts` lines 428-527):**

```typescript
{ type: "text"|"tool_use"|"step_start"|"step_finish"|"reasoning"|"error", timestamp, sessionID, part: {...} }
```

The `emit()` function in OpenCode (line 428-434) produces this format:
```typescript
function emit(type: string, data: Record<string, unknown>) {
  if (args.format === "json") {
    process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
    return true
  }
  return false
}
```

**Actual format from source (`packages/opencode/src/cli/cmd/run.ts`):**

1. `text` event (line 491-492): `{ type: "text", timestamp, sessionID, part: TextPart }`
2. `tool_use` event (line 460): `{ type: "tool_use", timestamp, sessionID, part: ToolPart }`
3. `step_start` event (line 484): `{ type: "step_start", timestamp, sessionID, part: StepStartPart }`
4. `step_finish` event (line 488): `{ type: "step_finish", timestamp, sessionID, part: StepFinishPart }`
5. `reasoning` event (line 505): `{ type: "reasoning", timestamp, sessionID, part: ReasoningPart }`
6. `error` event (line 527): `{ type: "error", timestamp, sessionID, error: SessionError }`

### Gap Analysis — OpenCode

| Adapter Expectation | Actual Format | Gap |
|---------------------|---------------|-----|
| `type: "system"` | Not present | **MISSING** — No init event, sessionID in wrapper |
| `type: "assistant"` (content blocks) | `type: "text"`, `type: "tool_use"` | **STRUCTURE DIFFERENT** — Separate events, not blocks |
| `type: "tool_result"` | `type: "tool_use"` (status: completed) | **MERGED** — Tool use and result in same event |
| `type: "result"` | `type: "step_finish"` | **NAME MISMATCH** — Different name, same purpose |
| N/A | `type: "step_start"` | **NEW** — Step lifecycle not mapped |
| N/A | `type: "reasoning"` | **NEW** — Reasoning output not mapped |
| `event.model` | `part.tokens`, `part.cost` | **LOCATION DIFFERENT** — Metrics in part, not root |

---

## Recommended Adapter Changes

### OpenClaw Adapter Changes

1. **Add ACP format handler:**
   ```typescript
   handleAcpEvent(event: AcpRuntimeEvent, stream: TaskOutputStream): void {
     switch (event.type) {
       case 'text_delta':
         stream.text(event.text);
         break;
       case 'tool_call':
         if (event.status === 'in_progress' || !event.status) {
           stream.toolUse(event.title || 'unknown', { toolCallId: event.toolCallId });
         } else if (event.status === 'completed') {
           stream.toolResult(event.title || 'unknown', event.text, true);
         }
         break;
       case 'status':
         stream.status('running', undefined, event.text);
         break;
       case 'done':
         stream.status('running', 100, event.stopReason || 'Completed');
         break;
       case 'error':
         stream.status('running', undefined, `Error: ${event.message}`);
         break;
     }
   }
   ```

2. **Detect format on first event:**
   - If event has `type: "text_delta"`, use ACP handler
   - If event has `type: "event"`, use Gateway EventFrame handler
   - If event has `type.includes('.')`, use legacy handler

3. **Handle missing session init:**
   - Emit `sessionInit('acp-session')` on first event in ACP mode

4. **Handle missing metrics:**
   - Track token usage from `status` events with `tag: "usage_update"`
   - Accumulate and return in final result

### OpenCode Adapter Changes

1. **Update event type mapping:**
   ```typescript
   handleStreamLine(line: string, stream: TaskOutputStream): void {
     const event = JSON.parse(line);

     // Extract sessionID from wrapper for sessionInit
     if (!this.sessionInitEmitted && event.sessionID) {
       stream.sessionInit(event.sessionID);
       this.sessionInitEmitted = true;
     }

     switch (event.type) {
       case 'text':
         stream.text(event.part.text);
         break;
       case 'tool_use':
         if (event.part.state.status === 'completed') {
           stream.toolResult(event.part.tool, event.part.state.output, true);
         } else if (event.part.state.status === 'error') {
           stream.toolResult(event.part.tool, event.part.state.error, false);
         }
         // Note: tool_use emission happens when status is 'running' — need separate tracking
         break;
       case 'step_start':
         stream.status('running', undefined, 'Step started');
         break;
       case 'step_finish':
         this.lastResultMetrics = {
           inputTokens: event.part.tokens.input,
           outputTokens: event.part.tokens.output,
           totalCost: event.part.cost,
         };
         break;
       case 'reasoning':
         // Optional: emit as thought/status
         stream.status('running', undefined, `Thinking: ${event.part.text}`);
         break;
       case 'error':
         stream.status('running', undefined, `Error: ${event.error.name}`);
         break;
     }
   }
   ```

2. **Track tool invocations separately:**
   - `tool_use` events come with status = "running" first, then "completed"
   - Need to emit `stream.toolUse()` on "running", `stream.toolResult()` on "completed"

3. **Handle sessionID from wrapper:**
   - OpenCode puts `sessionID` in the event wrapper, not in a separate init event
   - Emit sessionInit on first event received

---

## Testing Recommendations

### Unit Tests

1. **OpenClaw ACP format parsing:**
   ```typescript
   it('parses text_delta event', () => {
     adapter.handleStreamLine('{"type":"text_delta","text":"Hello"}', stream, []);
     expect(stream.text).toHaveBeenCalledWith('Hello');
   });

   it('parses tool_call with status', () => {
     adapter.handleStreamLine('{"type":"tool_call","title":"read_file","status":"completed","text":"content"}', stream, []);
     expect(stream.toolResult).toHaveBeenCalledWith('read_file', 'content', true);
   });
   ```

2. **OpenCode wrapper format parsing:**
   ```typescript
   it('emits sessionInit from first event wrapper', () => {
     adapter.handleStreamLine('{"type":"text","timestamp":123,"sessionID":"s1","part":{...}}', stream);
     expect(stream.sessionInit).toHaveBeenCalledWith('s1');
   });

   it('parses step_finish for metrics', () => {
     adapter.handleStreamLine('{"type":"step_finish","sessionID":"s1","part":{"cost":0.01,"tokens":{"input":100,"output":50}}}', stream);
     expect(adapter.lastResultMetrics).toEqual({ totalCost: 0.01, inputTokens: 100, outputTokens: 50 });
   });
   ```

### Integration Tests

1. **Real CLI output capture:**
   - Run actual CLIs with known prompts
   - Capture JSONL output
   - Verify adapter produces expected TaskOutputStream calls

2. **Format detection:**
   - Test adapter auto-detects ACP vs Gateway vs legacy format (OpenClaw)
   - Test adapter handles OpenCode's wrapper format

---

## Appendix: Complete Type Definitions

### OpenClaw AcpRuntimeEvent (TypeScript)

```typescript
export type AcpRuntimeEvent =
  | {
      type: "text_delta";
      text: string;
      stream?: "output" | "thought";
      tag?: AcpSessionUpdateTag;
    }
  | {
      type: "status";
      text: string;
      tag?: AcpSessionUpdateTag;
      used?: number;
      size?: number;
    }
  | {
      type: "tool_call";
      text: string;
      tag?: AcpSessionUpdateTag;
      toolCallId?: string;
      status?: string;
      title?: string;
    }
  | {
      type: "done";
      stopReason?: string;
    }
  | {
      type: "error";
      message: string;
      code?: string;
      retryable?: boolean;
    };

export type AcpSessionUpdateTag =
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

### OpenCode Part Types (TypeScript)

```typescript
// From @opencode-ai/sdk/v2
export type Part =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart;

export type TextPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
  time?: { start: number; end?: number };
  metadata?: Record<string, unknown>;
};

export type ToolPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state: ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError;
  metadata?: Record<string, unknown>;
};

export type StepStartPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-start";
  snapshot?: string;
};

export type StepFinishPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason: string;
  snapshot?: string;
  cost: number;
  tokens: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
};

export type ReasoningPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;
  metadata?: Record<string, unknown>;
  time: { start: number; end?: number };
};
```

---

## Related Documents

- `docs/planning/12-PROVIDER-ADOPTION-OPENCLAW-OPENCODE.md` — Overall provider adoption strategy
- `packages/agent-runner/src/providers/openclaw-adapter.ts` — Current OpenClaw adapter implementation
- `packages/agent-runner/src/providers/opencode-adapter.ts` — Current OpenCode adapter implementation
