# Agent Runner Adapters

This directory contains provider adapters for the Astro agent runner that integrate with various AI coding agents.

## OpenClaw Adapter

**File:** `openclaw-adapter.ts`

The OpenClaw adapter implements integration with OpenClaw's ACP (Agent Client Protocol) mode, enabling Astro to dispatch tasks to OpenClaw for execution.

### Protocol

OpenClaw uses ACP (Agent Client Protocol) over stdio (JSON-RPC 2.0 nd-JSON). This is different from simple JSONL streaming — it uses structured request/response messages.

**CLI invocation:**
```bash
openclaw acp --session <session-key>
```

### ACP Runtime Event Types

The adapter handles the following event types from OpenClaw's `src/acp/runtime/types.ts`:

| Event Type | Fields | Maps To |
|------------|--------|---------|
| `text_delta` | `text`, `stream?` ("output" or "thought"), `tag?` | `stream.text()` |
| `status` | `text`, `tag?`, `used?`, `size?` | `stream.status()` |
| `tool_call` | `text`, `tag?`, `toolCallId?`, `status?`, `title?` | `stream.toolUse()` / `stream.toolResult()` |
| `done` | `stopReason?` | Completion metrics |
| `error` | `message`, `code?`, `retryable?` | Error handling |

### Session Update Tags

When events arrive as `notifications/sessionUpdate`, the `sessionUpdate` field indicates the type:
- `agent_message_chunk` — Text content from agent response
- `agent_thought_chunk` — Reasoning/thinking content
- `tool_call` — Tool invocation started
- `tool_call_update` — Tool result received
- `done` — Session completed

### Integration Notes

1. **ACP Protocol Flow:**
   - Send `initialize` request on startup
   - Receive capabilities response
   - Send `prompt` request with task content
   - Receive streaming events via `notifications/sessionUpdate`
   - Handle `done` or `error` to complete

2. **Tool Tracking:**
   - Tool calls are tracked by `toolCallId` for proper pairing of use/result
   - Tool name is extracted from `title` field (format: "toolName: args...")

3. **Metrics:**
   - Duration tracked from start to `done` event
   - Model read from `~/.openclaw/config.json` if available

### Usage

```typescript
import { OpenClawAdapter } from './openclaw-adapter.js';

const adapter = new OpenClawAdapter();

if (await adapter.isAvailable()) {
  const result = await adapter.execute(task, stream, signal);
}
```

### Dependencies

- Node.js built-in modules only (no external dependencies)
- OpenClaw CLI must be installed and accessible in PATH or common installation locations
