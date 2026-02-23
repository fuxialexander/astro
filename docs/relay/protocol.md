# Relay Protocol Specification

WebSocket message protocol for agent runner <-> relay server communication.

## Message Format

All messages are JSON objects with a `type` field:

```typescript
{
  type: string          // Message type identifier
  timestamp: string     // ISO 8601 timestamp
  // ... type-specific fields
}
```

## Message Types

### Machine → Relay

#### machine.register

Register machine with capabilities.

**Payload:**
```json
{
  "type": "machine.register",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123",
  "machineInfo": {
    "name": "Dev Laptop",
    "environmentType": "local",
    "providers": [{
      "type": "claude-code",
      "status": "available",
      "maxConcurrentTasks": 3,
      "currentTasks": 0
    }],
    "resources": {
      "cpuCores": 8,
      "memoryMB": 16384,
      "gpuDevices": []
    },
    "load": {
      "cpuPercent": 20,
      "memoryPercent": 45,
      "activeTasks": 0,
      "queuedTasks": 0
    }
  }
}
```

#### machine.unregister

Graceful disconnect.

```json
{
  "type": "machine.unregister",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123",
  "reason": "shutdown"  // Optional
}
```

#### machine.status

Load and resource update.

```json
{
  "type": "machine.status",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123",
  "load": {
    "cpuPercent": 35,
    "memoryPercent": 52,
    "activeTasks": 2,
    "queuedTasks": 1
  }
}
```

#### provider.status

Provider availability update.

```json
{
  "type": "provider.status",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123",
  "providerId": "claude-code",
  "status": "available" | "busy" | "unavailable",
  "currentTasks": 2,
  "maxConcurrentTasks": 3
}
```

#### task.result

Task completion with result.

```json
{
  "type": "task.result",
  "timestamp": "2026-02-21T12:00:00Z",
  "result": {
    "taskId": "exec-xyz789",
    "status": "success" | "failure" | "cancelled",
    "exitCode": 0,
    "output": "All tests passed",
    "error": null,
    "duration": 120000,
    "metrics": {
      "inputTokens": 1500,
      "outputTokens": 800,
      "estimatedCostUsd": 0.015
    }
  }
}
```

#### task.stdout

Streaming stdout/stderr.

```json
{
  "type": "task.stdout",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "output": "Running tests...\n",
  "stream": "stdout" | "stderr"
}
```

#### task.progress

Progress percentage update.

```json
{
  "type": "task.progress",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "progress": 65,  // 0-100
  "message": "Processing file 65/100"
}
```

#### task.steer.ack

Acknowledgment that agent runner received a steering message.

```json
{
  "type": "task.steer.ack",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "accepted": true,
  "message": "Guidance applied",
  "interrupted": false
}
```

#### task.text

Structured text output from agent (bypasses stdout throttle).

```json
{
  "type": "task.text",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "text": "Analysis complete. Found 3 issues.",
  "sequence": 1
}
```

#### task.session_init

Session initialization info from agent runner.

```json
{
  "type": "task.session_init",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "sessionId": "sess-abc123",
  "model": "claude-sonnet-4-20250514"
}
```

#### task.tool_trace

Detailed tool call information from agent.

```json
{
  "type": "task.tool_trace",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "toolName": "read_file",
  "toolInput": { "path": "/src/main.ts" },
  "toolResult": "file contents...",
  "success": true,
  "duration": 150
}
```

#### task.file_change

File modification by agent.

```json
{
  "type": "task.file_change",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "path": "src/lib/utils.ts",
  "action": "modified",
  "linesAdded": 10,
  "linesRemoved": 3,
  "diff": "@@ -1,3 +1,10 @@\n+import { cn } from './utils';\n..."
}
```

#### task.approval_request

Agent requesting a user decision (via `ask_user_question` MCP tool).

```json
{
  "type": "task.approval_request",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "requestId": "req-001",
  "question": "Should I refactor the auth module or keep the current approach?",
  "options": ["Refactor", "Keep current"]
}
```

#### file_list.response

Response to a file list request from relay.

```json
{
  "type": "file_list.response",
  "timestamp": "2026-02-21T12:00:00Z",
  "correlationId": "corr-abc123",
  "files": ["src/main.ts", "src/lib/utils.ts", "package.json"]
}
```

#### slash_commands.response

Response to a slash commands request from relay.

```json
{
  "type": "slash_commands.response",
  "timestamp": "2026-02-21T12:00:00Z",
  "correlationId": "corr-def456",
  "commands": [
    { "name": "test", "description": "Run unit tests" },
    { "name": "lint", "description": "Run linter" }
  ]
}
```

#### heartbeat.pong

Response to ping.

```json
{
  "type": "heartbeat.pong",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123"
}
```

### Relay → Machine

#### machine.register.ack

Registration confirmation.

```json
{
  "type": "machine.register.ack",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123",
  "sessionId": "sess-1234567890-abcdef",
  "success": true
}
```

#### task.dispatch

New task to execute.

```json
{
  "type": "task.dispatch",
  "timestamp": "2026-02-21T12:00:00Z",
  "correlationId": "exec-xyz789",
  "task": {
    "taskId": "exec-xyz789",
    "projectId": "550e8400-e29b-41d4-a716-446655440000",
    "nodeId": "node-456",
    "title": "Run unit tests",
    "description": "Execute pytest on the test suite",
    "environment": "local",
    "preferredProvider": "claude-code",
    "executionStrategy": "direct",
    "priority": 2,
    "timeout": 300000,
    "workingDirectory": "/path/to/repo",
    "visionDoc": "Project vision context...",
    "dependencies": ["exec-abc123"],
    "metadata": { "repo": "user/repo" },
    "prompt": "Run all unit tests and report failures",
    "maxTurns": 10,
    "type": "execution",
    "systemPrompt": "You are a testing agent...",
    "messages": [
      { "role": "user", "content": "Run the tests" },
      { "role": "assistant", "content": "I'll run pytest now." }
    ],
    "model": "claude-sonnet-4-20250514",
    "outputFormat": {
      "type": "json_schema",
      "schema": { "type": "object", "properties": { "passed": { "type": "boolean" } } }
    }
  }
}
```

**TaskDispatch fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | Yes | Unique execution identifier |
| `projectId` | string | Yes | Parent project ID |
| `nodeId` | string | Yes | Reference to PlanNode |
| `title` | string | Yes | Human-readable task title |
| `description` | string | Yes | Task description |
| `environment` | EnvironmentType | Yes | `"local"` \| `"remote"` \| `"hpc"` \| `"cloud"` |
| `type` | TaskDispatchType | No | `"execution"` \| `"plan"` \| `"chat"` \| `"summarize"`. Defaults to `"execution"` |
| `visionDoc` | string | No | Project vision context injected into agent session |
| `preferredProvider` | ProviderType | No | `"claude-code"` \| `"claude-sdk"` \| `"codex"` \| `"aws"` \| `"gcp"` \| `"custom"` |
| `executionStrategy` | string | No | `"direct"` \| `"slurm"` \| `"docker"` \| `"k8s-exec"` \| `"skypilot"` |
| `priority` | number | No | Task priority |
| `timeout` | number | No | Timeout in milliseconds |
| `workingDirectory` | string | No | Working directory on the machine |
| `dependencies` | string[] | No | Task IDs that must complete first |
| `metadata` | Record | No | Arbitrary key-value metadata |
| `prompt` | string | No | Pre-built prompt (bypasses automatic prompt construction) |
| `maxTurns` | number | No | Override agent runner's default maxTurns |
| `outputFormat` | object | No | Force structured JSON output matching a schema |
| `systemPrompt` | string | No | System-level instruction for the AI session |
| `messages` | ConversationMessage[] | No | Multi-turn conversation history for chat tasks |
| `model` | string | No | Explicit model selection (e.g., `"claude-sonnet-4-20250514"`) |

#### task.cancel

Cancel running task.

```json
{
  "type": "task.cancel",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "reason": "user_requested" | "timeout" | "branch_pruned"
}
```

#### task.steer

Inject guidance into a running agent.

```json
{
  "type": "task.steer",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "message": "Focus on the auth module first",
  "action": "guidance",
  "interrupt": false
}
```

**Fields:**
- `action` (optional): `"guidance"` | `"redirect"` | `"pause"` | `"resume"`
- `interrupt` (optional): If `true`, interrupt the agent's current turn to inject the message immediately.

#### task.approval_response

Relay forwards the user's decision to an agent's approval request.

```json
{
  "type": "task.approval_response",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "requestId": "req-001",
  "answered": true,
  "answer": "Refactor",
  "message": "User chose to refactor"
}
```

#### file_list.request

Request the agent runner to list files in a directory.

```json
{
  "type": "file_list.request",
  "timestamp": "2026-02-21T12:00:00Z",
  "correlationId": "corr-abc123",
  "path": "/home/user/project/src"
}
```

#### slash_commands.request

Request available slash commands from the agent runner.

```json
{
  "type": "slash_commands.request",
  "timestamp": "2026-02-21T12:00:00Z",
  "correlationId": "corr-def456",
  "workingDirectory": "/home/user/project"
}
```

#### heartbeat.ping

Connection health check.

```json
{
  "type": "heartbeat.ping",
  "timestamp": "2026-02-21T12:00:00Z"
}
```

#### error

Error notification.

```json
{
  "type": "error",
  "timestamp": "2026-02-21T12:00:00Z",
  "code": "INVALID_MESSAGE" | "RATE_LIMIT" | "UNAUTHORIZED",
  "message": "Human-readable error message",
  "details": {}
}
```

### Session / MCP Bridge Messages

These messages support session attachment from the MCP bridge, allowing real-time observation of agent sessions.

#### session.attach (MCP Bridge → Relay)

Attach to a running agent session.

```json
{
  "type": "session.attach",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "sessionId": "sess-abc123",
  "machineId": "machine-abc123"
}
```

#### session.attach.ack (Relay → MCP Bridge)

Acknowledgment of session attachment.

```json
{
  "type": "session.attach.ack",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "sessionId": "sess-abc123",
  "success": true,
  "error": null
}
```

#### session.detach (MCP Bridge → Relay)

Detach from a session.

```json
{
  "type": "session.detach",
  "timestamp": "2026-02-21T12:00:00Z",
  "sessionId": "sess-abc123",
  "reason": "user_navigated_away"
}
```

#### session.event (MCP Bridge → Relay → Platform)

Session event forwarded from the MCP bridge.

```json
{
  "type": "session.event",
  "timestamp": "2026-02-21T12:00:00Z",
  "sessionId": "sess-abc123",
  "taskId": "exec-xyz789",
  "event": {
    "type": "tool_call",
    "timestamp": "2026-02-21T12:00:00Z",
    "sessionId": "sess-abc123",
    "taskId": "exec-xyz789",
    "toolName": "read_file",
    "input": { "path": "/src/main.ts" }
  }
}
```

**Session event types:** `"tool_call"` | `"tool_result"` | `"file_change"` | `"message"` | `"error"`

### Slurm/HPC Extension Messages

These messages extend the protocol for HPC cluster support.

#### slurm.job.submitted (Agent → Relay)

Slurm job was submitted.

```json
{
  "type": "slurm.job.submitted",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "slurmJobId": "12345",
  "scriptPath": "/tmp/astro-job-12345.sh",
  "outputPath": "/tmp/astro-job-12345.out",
  "errorPath": "/tmp/astro-job-12345.err"
}
```

#### slurm.job.status (Agent → Relay)

Slurm job status update.

```json
{
  "type": "slurm.job.status",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "slurmJobId": "12345",
  "jobInfo": {
    "jobId": "12345",
    "name": "astro-task",
    "state": "RUNNING",
    "user": "researcher",
    "partition": "gpu",
    "nodes": 1,
    "cpus": 4,
    "timeLimit": "01:00:00",
    "timeUsed": "00:05:32"
  }
}
```

**Slurm job states:** `"PENDING"` | `"RUNNING"` | `"SUSPENDED"` | `"COMPLETING"` | `"COMPLETED"` | `"FAILED"` | `"CANCELLED"` | `"TIMEOUT"` | `"PREEMPTED"` | `"NODE_FAIL"` | `"OUT_OF_MEMORY"` | `"UNKNOWN"`

#### slurm.job.output (Agent → Relay)

Slurm job stdout/stderr streaming.

```json
{
  "type": "slurm.job.output",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "slurmJobId": "12345",
  "stream": "stdout",
  "data": "Epoch 1/10: loss=0.523\n"
}
```

## Connection Lifecycle

```
1. Machine opens WebSocket connection
   └─ wss://astro-relay.your-domain.com

2. Machine sends machine.register
   └─ Relay validates JWT, registers machine

3. Relay sends machine.register.ack
   └─ Machine is now active

4. Relay starts heartbeat.ping (every 30s)
   └─ Machine responds with heartbeat.pong

5. Relay dispatches tasks via task.dispatch
   └─ Machine sends task.session_init (session started)
   └─ Machine streams task.stdout, task.text, task.tool_trace, task.file_change
   └─ Machine may send task.approval_request (needs user decision)
       └─ Relay responds with task.approval_response
   └─ Relay may send task.steer (inject guidance)
       └─ Machine responds with task.steer.ack

6. Machine sends task.result on completion

7. On disconnect:
   - If graceful: machine.unregister
   - If abrupt: Relay detects missing pongs → marks disconnected
```

## Heartbeat Mechanism

**Interval:** 30 seconds

**Timeout:** 90 seconds (3 missed pongs)

**Purpose:** Detect dead connections, clean up stale machines

**Example:**
```
t=0s:   Relay → machine.register.ack
t=30s:  Relay → heartbeat.ping
t=30.5s: Machine → heartbeat.pong
t=60s:  Relay → heartbeat.ping
t=60.5s: Machine → heartbeat.pong
t=90s:  Relay → heartbeat.ping
t=120s: No pong → Relay marks machine disconnected
```

## Rate Limiting

Per-machine limits:

| Action | Limit |
|--------|-------|
| Messages/min | 1000 |
| Task dispatch acks/min | 100 |
| Stdout bytes/sec | 1 MB |
| Heartbeat pongs | 1/30s |

**Exceeded:** Relay sends `error` message with `RATE_LIMIT` code, may disconnect repeat offenders.

## Error Handling

### Invalid Message

Machine sends malformed JSON or missing required fields:

```json
{
  "type": "error",
  "code": "INVALID_MESSAGE",
  "message": "Missing required field: machineId",
  "details": { "field": "machineId" }
}
```

### Unauthorized

Machine not authenticated or token expired:

```json
{
  "type": "error",
  "code": "UNAUTHORIZED",
  "message": "Invalid or expired token"
}
```

### Task Not Found

Machine sends task.result for unknown task:

```json
{
  "type": "error",
  "code": "TASK_NOT_FOUND",
  "message": "Task exec-xyz789 not found or already completed"
}
```

## Compression

**Protocol:** Per-message deflate (WebSocket extension)

**Enabled by default** for messages >1KB

**Threshold:** Compress if message size > 1024 bytes

## Reconnection

Machines should implement exponential backoff:

```
Attempt 1: Reconnect immediately
Attempt 2: Wait 1 second
Attempt 3: Wait 2 seconds
Attempt 4: Wait 4 seconds
...
Max wait: 60 seconds
```

**Persistent state:** Relay remembers machine registration across reconnects (24-hour TTL).

**Re-registration:** If machine reconnects with same machineId, Relay restores previous state.

## Protocol Versioning

**Current version:** `v1`

**Negotiation:** Via WebSocket subprotocol:

```javascript
const ws = new WebSocket('wss://astro-relay.your-domain.com', 'astro-relay-v1')
```

**Future versions:** `astro-relay-v2`, etc.

## Related Documentation

- [Relay Overview](./overview.md) - Architecture and components
- [Machine Registry](./machine-registry.md) - How machines are tracked
- [Dispatch System](./dispatch-system.md) - Task routing
- [Agent Runner Protocol](../guides/agent-runner-protocol.md) - Client implementation guide
