# Agent Runner Protocol Guide

This guide explains how to build an agent runner that connects to the Astro relay server, receives task dispatches, and streams results back.

## Connection

### WebSocket Endpoint
- Development: `ws://localhost:3002`
- Production: `wss://your-app.fly.dev:3002?token=JWT_TOKEN`

### Authentication
In production, pass a JWT token as a query parameter. The token must contain:
```json
{
  "sub": "machine-id",
  "machineId": "machine-id",
  "scopes": ["task:execute"],
  "iat": 1700000000,
  "exp": 1700086400
}
```

In development (no `RELAY_JWT_SECRET` configured), authentication is skipped.

## Protocol

All messages are JSON with a `type` field and a `timestamp` field (ISO date string).

### Step 1: Register

After connecting, send a registration message:

```json
{
  "type": "machine.register",
  "timestamp": "2026-02-06T10:00:00Z",
  "machineId": "my-laptop-001",
  "machineInfo": {
    "name": "My Laptop",
    "environmentType": "local",
    "hostname": "my-laptop.local",
    "platform": "darwin",
    "providers": [
      {
        "type": "claude-code",
        "version": "1.0.0",
        "status": "available",
        "maxConcurrentTasks": 2,
        "currentTasks": 0,
        "capabilities": ["code_generation", "code_review"]
      }
    ],
    "resources": {
      "cpuCores": 8,
      "memoryMB": 16384,
      "diskSpaceMB": 512000
    },
    "load": {
      "cpuPercent": 15,
      "memoryPercent": 45,
      "activeTasks": 0,
      "queuedTasks": 0
    }
  }
}
```

**Response** (from relay):
```json
{
  "type": "machine.register.ack",
  "timestamp": "2026-02-06T10:00:00Z",
  "machineId": "my-laptop-001",
  "sessionId": "session-abc-123",
  "success": true
}
```

### Step 2: Handle Heartbeats

The relay sends `heartbeat.ping` every 30 seconds. Respond with `heartbeat.pong`:

```json
// Received:
{ "type": "heartbeat.ping", "timestamp": "..." }

// Send back:
{
  "type": "heartbeat.pong",
  "timestamp": "2026-02-06T10:00:30Z",
  "machineId": "my-laptop-001"
}
```

Missing 3 consecutive heartbeats (90s) triggers automatic disconnection.

### Step 3: Receive Task Dispatch

```json
{
  "type": "task.dispatch",
  "timestamp": "2026-02-06T10:01:00Z",
  "correlationId": "exec-node1-1700000000",
  "task": {
    "taskId": "exec-node1-1700000000",
    "projectId": "project-123",
    "nodeId": "node1",
    "title": "Implement authentication module",
    "description": "Create OAuth2 login flow with Google and GitHub providers...",
    "visionDoc": "Project vision document content...",
    "environment": "local",
    "preferredProvider": "claude-code",
    "priority": 2,
    "timeout": 300000,
    "workingDirectory": "/home/user/project"
  }
}
```

When the `workingDirectory` is a Git repository, the Astro agent runner executes the task inside a
temporary Git worktree cloned from the repo root. The worktree is removed after the task finishes.

### Step 4: Stream Results

While executing, stream events back to the relay:

**Progress updates:**
```json
{
  "type": "task.progress",
  "timestamp": "2026-02-06T10:01:30Z",
  "taskId": "exec-node1-1700000000",
  "progress": 25,
  "message": "Setting up project structure"
}
```

**Stdout streaming:**
```json
{
  "type": "task.stdout",
  "timestamp": "2026-02-06T10:01:31Z",
  "output": {
    "taskId": "exec-node1-1700000000",
    "stream": "stdout",
    "data": "Creating auth module...\n",
    "timestamp": "2026-02-06T10:01:31Z"
  }
}
```

**Tool traces:**
```json
{
  "type": "task.tool_trace",
  "timestamp": "2026-02-06T10:01:35Z",
  "taskId": "exec-node1-1700000000",
  "toolName": "Write",
  "toolInput": { "path": "src/auth/login.ts", "content": "..." },
  "toolResult": "File written successfully",
  "success": true,
  "duration": 45
}
```

**File changes:**
```json
{
  "type": "task.file_change",
  "timestamp": "2026-02-06T10:01:36Z",
  "taskId": "exec-node1-1700000000",
  "path": "src/auth/login.ts",
  "action": "created",
  "linesAdded": 42,
  "linesRemoved": 0
}
```

**Final result:**
```json
{
  "type": "task.result",
  "timestamp": "2026-02-06T10:05:00Z",
  "result": {
    "taskId": "exec-node1-1700000000",
    "status": "completed",
    "output": "Authentication module implemented successfully...",
    "duration": 240000,
    "artifacts": [
      { "name": "src/auth/login.ts", "type": "file", "path": "src/auth/login.ts" }
    ]
  }
}
```

### Step 5: Handle Steering (Optional)

While a task is running, the relay may send steering messages:

```json
{
  "type": "task.steer",
  "timestamp": "2026-02-06T10:02:00Z",
  "correlationId": "exec-node1-1700000000",
  "taskId": "exec-node1-1700000000",
  "message": "Focus on the Google OAuth provider first",
  "action": "guidance"
}
```

Acknowledge and inject into the running session:
```json
{
  "type": "task.steer.ack",
  "timestamp": "2026-02-06T10:02:01Z",
  "taskId": "exec-node1-1700000000",
  "accepted": true,
  "message": "Guidance received, adjusting approach"
}
```

**Actions**: `guidance` (soft hint), `redirect` (change direction), `pause`, `resume`

### Step 6: Handle Cancellation

```json
{
  "type": "task.cancel",
  "timestamp": "2026-02-06T10:03:00Z",
  "correlationId": "exec-node1-1700000000",
  "taskId": "exec-node1-1700000000",
  "reason": "User requested cancellation"
}
```

Abort the running task and send a result with `status: "cancelled"`.

### Step 7: Send Status Updates

Periodically send machine status:
```json
{
  "type": "machine.status",
  "timestamp": "2026-02-06T10:05:00Z",
  "machineId": "my-laptop-001",
  "load": {
    "cpuPercent": 65,
    "memoryPercent": 72,
    "activeTasks": 1,
    "queuedTasks": 0
  }
}
```

## Error Handling

- If the WebSocket disconnects, reconnect with exponential backoff
- If registration fails, check the error message in the `machine.register.ack`
- Rate limiting: max 1000 messages per minute per connection
- Stdout rate limiting: max 1MB/s per connection

## Minimal Example (Node.js)

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3002');

ws.on('open', () => {
  // Register
  ws.send(JSON.stringify({
    type: 'machine.register',
    timestamp: new Date(),
    machineId: 'my-runner-001',
    machineInfo: {
      name: 'My Runner',
      environmentType: 'local',
      providers: [{
        type: 'claude-code',
        status: 'available',
        maxConcurrentTasks: 1,
        currentTasks: 0,
      }],
      resources: { cpuCores: 4, memoryMB: 8192 },
      load: { cpuPercent: 0, memoryPercent: 0, activeTasks: 0, queuedTasks: 0 },
    },
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'heartbeat.ping':
      ws.send(JSON.stringify({
        type: 'heartbeat.pong',
        timestamp: new Date(),
        machineId: 'my-runner-001',
      }));
      break;

    case 'task.dispatch':
      console.log('Task received:', msg.task.title);
      // Execute task and stream results...
      break;

    case 'task.steer':
      console.log('Steering:', msg.message);
      ws.send(JSON.stringify({
        type: 'task.steer.ack',
        timestamp: new Date(),
        taskId: msg.taskId,
        accepted: true,
      }));
      break;
  }
});
```
