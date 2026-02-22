# API Reference

Complete reference for all Hono.js backend API endpoints.

## Base URL

- **Development**: `http://localhost:3001/api`
- **Production**: `https://astro-api.fuxialexander.work/api`
- **Via Vite proxy**: `/api` (automatically proxied to port 3001 in development)

## Authentication

Most endpoints require authentication via Supabase JWT token in the `Authorization` header:

```
Authorization: Bearer <supabase-access-token>
```

Machine endpoints use OAuth2-style bearer tokens:

```
Authorization: Bearer <machine-access-token>
```

## Health & Status

### `GET /api/health`

Check backend health and Claude SDK authentication.

**Response:**
```json
{
  "status": "ok",
  "claudeAuth": "valid" | "missing" | "invalid",
  "timestamp": "2026-02-21T12:00:00Z"
}
```

## Agent & AI

### `POST /api/agent/generate-plan`

Generate an AI plan from a project description. Streams results via Server-Sent Events (SSE).

**Request:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "description": "Build a task management API",
  "visionDoc": "Product vision...",
  "repository": "https://github.com/user/repo",
  "workingDirectory": "/path/to/repo"
}
```

**SSE Event Types:**
- `session_init` - Session created
- `text` - Streaming text chunk
- `tool_use` - Agent used a tool (Glob, Grep, Read)
- `tool_result` - Tool execution result
- `structured_output` - Final plan JSON
- `done` - Generation complete
- `error` - Error occurred

**Example SSE Event:**
```
event: structured_output
data: {"nodes": [...], "edges": [...]}

event: done
data: {"success": true}
```

### `POST /api/agent/chat`

Chat with AI about a plan. Streams via SSE.

**Request:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "sessionId": "sess-abc123",
  "message": "Add tests for the authentication module"
}
```

**SSE Event Types:** Same as `generate-plan`

### `POST /api/agent/abort`

Abort an active AI session.

**Request:**
```json
{
  "sessionId": "sess-abc123"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "sess-abc123"
}
```

## Task Dispatch & Execution

### `POST /api/dispatch/task`

Dispatch a task to an agent runner. Returns immediately; track progress via SSE events.

**Request:**
```json
{
  "nodeId": "node-abc123",
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Run unit tests",
  "description": "Execute pytest test suite",
  "environment": "local",
  "machineId": "machine-xyz789",
  "visionDoc": "Project context..."
}
```

**Response:**
```json
{
  "executionId": "exec-def456",
  "nodeId": "node-abc123",
  "status": "dispatched",
  "machineId": "machine-xyz789"
}
```

### `POST /api/dispatch/cancel`

Cancel a running task execution.

**Request:**
```json
{
  "executionId": "exec-def456"
}
```

**Response:**
```json
{
  "success": true,
  "executionId": "exec-def456"
}
```

### `POST /api/dispatch/steer`

Send a steering message to a running agent (mid-execution guidance).

**Request:**
```json
{
  "executionId": "exec-def456",
  "message": "Focus on testing edge cases"
}
```

**Response:**
```json
{
  "success": true
}
```

### `POST /api/dispatch/prune`

Prune a branch (cancel task + all downstream dependencies).

**Request:**
```json
{
  "nodeId": "node-abc123",
  "projectId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**
```json
{
  "success": true,
  "prunedNodes": ["node-abc123", "node-child1", "node-child2"]
}
```

## Real-time Events

### `GET /api/events/stream`

Server-Sent Events stream for real-time updates. Supports automatic reconnection with `Last-Event-ID` header.

**Query Parameters:**
- `projectId` (optional) - Filter events for a specific project
- `userId` (optional) - Filter events for a specific user

**SSE Event Types:**
- `machine.connected` - Machine connected to relay
- `machine.disconnected` - Machine disconnected
- `task.dispatched` - Task sent to agent
- `task.stdout` - Task output chunk
- `task.progress` - Progress update (0-100)
- `task.result` - Task completed
- `approval.requested` - Approval needed
- `activity.created` - Activity event created

**Example Usage:**
```javascript
const eventSource = new EventSource('/api/events/stream');
eventSource.addEventListener('task.stdout', (e) => {
  const data = JSON.parse(e.data);
  console.log(data.output);
});
```

## Machine & Relay

### `GET /api/relay/machines`

List all connected machines.

**Response:**
```json
{
  "machines": [
    {
      "id": "machine-abc123",
      "name": "Dev Laptop",
      "environmentType": "local",
      "providers": ["claude-code"],
      "isConnected": true,
      "load": {
        "cpuPercent": 25,
        "memoryPercent": 50,
        "activeTasks": 1,
        "queuedTasks": 0
      }
    }
  ]
}
```

### `GET /api/relay/machines/:id`

Get details for a specific machine.

**Response:**
```json
{
  "id": "machine-abc123",
  "name": "Dev Laptop",
  "hostname": "macbook-pro.local",
  "platform": "darwin",
  "environmentType": "local",
  "providers": [
    {
      "type": "claude-code",
      "status": "available",
      "maxConcurrentTasks": 3,
      "currentTasks": 1
    }
  ],
  "resources": {
    "cpuCores": 8,
    "memoryMB": 16384
  },
  "isConnected": true,
  "lastSeenAt": "2026-02-21T12:00:00Z"
}
```

### `GET /api/relay/best-machine`

Find the optimal machine for a task based on load and capabilities.

**Query Parameters:**
- `environment` - Required environment type
- `provider` - Required provider type

**Response:**
```json
{
  "machineId": "machine-abc123",
  "score": 0.85
}
```

### `GET /api/relay/status`

Detailed relay server status.

**Response:**
```json
{
  "uptime": 86400,
  "connectedMachines": 3,
  "activeConnections": 3,
  "taskQueue": {
    "pending": 2,
    "running": 5,
    "completed": 120
  },
  "redis": {
    "connected": true,
    "mode": "standalone"
  }
}
```

## Device Authorization (OAuth2)

OAuth2 Device Authorization Grant (RFC 8628) for machine registration.

### `POST /api/device/authorize`

Request a device code for machine registration.

**Request:**
```json
{
  "client_id": "astro-agent",
  "scope": "dispatch report"
}
```

**Response:**
```json
{
  "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
  "user_code": "BDWD-HQPK",
  "verification_uri": "https://astro.fuxialexander.work/device",
  "expires_in": 900,
  "interval": 5
}
```

### `POST /api/device/token`

Poll for token or exchange device code for access token.

**Request:**
```json
{
  "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
  "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
  "client_id": "astro-agent"
}
```

**Response (pending):**
```json
{
  "error": "authorization_pending",
  "error_description": "User has not yet authorized device"
}
```

**Response (success):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "def502004d8f7e4c...",
  "scope": "dispatch report"
}
```

### `POST /api/device/register`

Register machine after obtaining access token.

**Request:**
```json
{
  "name": "Dev Laptop",
  "hostname": "macbook-pro.local",
  "platform": "darwin",
  "environmentType": "local",
  "providers": ["claude-code"]
}
```

**Headers:**
```
Authorization: Bearer <access-token>
```

**Response:**
```json
{
  "machineId": "machine-abc123",
  "workspaceId": "ws-def456"
}
```

### `POST /api/device/refresh`

Refresh access token using refresh token.

**Request:**
```json
{
  "grant_type": "refresh_token",
  "refresh_token": "def502004d8f7e4c..."
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### `POST /api/device/revoke`

Revoke a refresh token (logout machine).

**Request:**
```json
{
  "token": "def502004d8f7e4c..."
}
```

**Response:**
```json
{
  "success": true
}
```

### `GET /api/device/machines`

List user's registered machines.

**Headers:**
```
Authorization: Bearer <supabase-access-token>
```

**Response:**
```json
{
  "machines": [
    {
      "id": "machine-abc123",
      "name": "Dev Laptop",
      "hostname": "macbook-pro.local",
      "platform": "darwin",
      "isConnected": true,
      "registeredAt": "2026-02-20T10:00:00Z",
      "lastSeenAt": "2026-02-21T12:00:00Z"
    }
  ]
}
```

### `DELETE /api/device/machines/:id`

Revoke a machine (delete registration).

**Response:**
```json
{
  "success": true
}
```

## Data API (Supabase-backed)

### Projects

**`GET /api/data/projects`** - List user's projects
**`GET /api/data/projects/:id`** - Get project details
**`POST /api/data/projects`** - Create project
**`PATCH /api/data/projects/:id`** - Update project
**`DELETE /api/data/projects/:id`** - Delete project (soft delete)

### Plan Graph

**`GET /api/data/projects/:id/plan`** - Get nodes + edges for project
**`PUT /api/data/projects/:id/plan`** - Bulk update nodes + edges
**`POST /api/data/projects/:id/nodes`** - Create node
**`PATCH /api/data/projects/:id/nodes/:nodeId`** - Update node
**`DELETE /api/data/projects/:id/nodes/:nodeId`** - Delete node (soft delete)

### User Profile

**`GET /api/data/user-profile`** - Get current user profile
**`PUT /api/data/user-profile`** - Update user profile

### Settings

**`GET /api/data/settings`** - Get all settings
**`PUT /api/data/settings/:key`** - Update a setting

### Display Settings

**`GET /api/data/display-settings/:key`** - Get display settings for view
**`PUT /api/data/display-settings/:key`** - Update display settings

### Usage Metrics

**`GET /api/data/usage`** - Get usage metrics (daily/weekly/monthly)
**`POST /api/data/usage`** - Record usage (internal)

### Task Chat

**`GET /api/data/task-chat/:nodeId`** - Get chat messages for node
**`POST /api/data/task-chat/:nodeId`** - Add chat message

## GitHub Integration

### `POST /api/github/oauth/callback`

Handle GitHub OAuth callback.

**Query Parameters:**
- `code` - GitHub authorization code
- `state` - CSRF state token

**Response:** Redirects to frontend with auth result

### `GET /api/github/repos`

List user's GitHub repositories.

**Response:**
```json
{
  "repos": [
    {
      "id": 123456,
      "name": "my-repo",
      "full_name": "user/my-repo",
      "private": false,
      "clone_url": "https://github.com/user/my-repo.git"
    }
  ]
}
```

### `POST /api/github/create-pr`

Create a GitHub pull request.

**Request:**
```json
{
  "repo": "user/my-repo",
  "head": "feature-branch",
  "base": "main",
  "title": "Add new feature",
  "body": "## Summary\n..."
}
```

**Response:**
```json
{
  "prUrl": "https://github.com/user/my-repo/pull/42",
  "prNumber": 42
}
```

## Repository Management

### `POST /api/repo/clone`

Clone a repository for plan generation.

**Request:**
```json
{
  "url": "https://github.com/user/repo.git",
  "projectId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**
```json
{
  "success": true,
  "path": "/tmp/astro-repos/550e8400/repo"
}
```

### `POST /api/repo/file-tree`

Get file tree for a repository.

**Request:**
```json
{
  "path": "/tmp/astro-repos/550e8400/repo"
}
```

**Response:**
```json
{
  "tree": [
    { "path": "src/", "type": "directory" },
    { "path": "src/index.ts", "type": "file" },
    { "path": "package.json", "type": "file" }
  ]
}
```

## File System (Sandboxed)

### `GET /api/fs/read`

Read a file from a sandboxed project directory.

**Query Parameters:**
- `projectId` - Project ID
- `path` - Relative file path

**Response:** File contents (text or binary)

### `POST /api/fs/write`

Write a file to a sandboxed project directory.

**Request:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "path": "src/config.json",
  "content": "{\"key\": \"value\"}"
}
```

**Response:**
```json
{
  "success": true
}
```

## Authentication (WebAuthn)

### `POST /api/auth/webauthn/check-user`

Check if a user exists with the given email. Rate limited to prevent enumeration.

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "exists": true
}
```

### `POST /api/auth/webauthn/register-options`

Generate WebAuthn registration options for a new passkey. Rate limited.

**Request:**
```json
{
  "email": "user@example.com",
  "name": "Jane Doe"
}
```

**Response:**
```json
{
  "options": { "...WebAuthn PublicKeyCredentialCreationOptions..." },
  "email": "user@example.com",
  "existingUser": false
}
```

### `POST /api/auth/webauthn/register-verify`

Verify registration attestation and create/update user.

**Request:**
```json
{
  "email": "user@example.com",
  "name": "Jane Doe",
  "credential": { "...RegistrationResponseJSON..." }
}
```

**Response:**
```json
{
  "verified": true,
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "session": { "...Supabase session data..." }
}
```

### `POST /api/auth/webauthn/login-options`

Generate authentication options for passkey login. Rate limited.

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "options": { "...WebAuthn PublicKeyCredentialRequestOptions..." },
  "challengeKey": "auth:user@example.com"
}
```

### `POST /api/auth/webauthn/login-verify`

Verify authentication assertion and return session tokens.

**Request:**
```json
{
  "credential": { "...AuthenticationResponseJSON..." },
  "challengeKey": "auth:user@example.com"
}
```

**Response:**
```json
{
  "verified": true,
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "user": { "...user profile..." },
  "session": { "...Supabase session data..." }
}
```

### `GET /api/auth/session`

Check current session status. Returns dev user in local mode.

**Headers:**
```
Authorization: Bearer <supabase-access-token>
```

**Response:**
```json
{
  "authenticated": true,
  "user": { "id": "550e8400-...", "email": "user@example.com" }
}
```

### `DELETE /api/auth/delete-account`

Permanently delete user account and all associated data. Revokes machine tokens, deletes user data from all tables, and removes the auth user.

**Headers:**
```
Authorization: Bearer <supabase-access-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Account and all data permanently deleted"
}
```

## Audio Transcription

### `POST /api/transcribe`

Transcribe audio using OpenAI's Whisper API. Accepts multipart/form-data with an `audio` file field. Maximum file size is 25MB.

**Request:** `multipart/form-data` with `audio` file field

**Response:**
```json
{
  "text": "Transcribed text content..."
}
```

### `GET /api/transcribe/status`

Check if the transcription service is available (OpenAI API key configured).

**Response:**
```json
{
  "available": true,
  "provider": "openai",
  "model": "whisper-1"
}
```

## System Info

### `GET /api/system/hostname`

Returns the hostname of the machine running the server. Used by the browser to determine if it is on the same machine as a remote agent.

**Response:**
```json
{
  "hostname": "macbook-pro.local"
}
```

### `GET /api/system/info`

Returns additional system information for debugging.

**Response:**
```json
{
  "hostname": "macbook-pro.local",
  "platform": "darwin",
  "arch": "arm64",
  "release": "24.0.0",
  "uptime": 86400
}
```

## Plan & Bundle Sharing

### `POST /api/share`

Store an Astro export bundle and return a share ID. Bundles are stored in-memory.

**Request:**
```json
{
  "$schema": "astro-export",
  "...bundle data..."
}
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### `GET /api/share/:id`

Retrieve a shared bundle by ID.

**Response:** The original bundle JSON

## Skill Management

### `GET /api/skills`

List all loaded skills with eligibility status.

**Response:**
```json
{
  "skills": [
    {
      "name": "code-review",
      "description": "Review code changes",
      "source": "builtin",
      "enabled": true,
      "eligible": true,
      "userInvocable": true,
      "pluginId": null,
      "config": {}
    }
  ],
  "total": 1
}
```

### `POST /api/skills/install`

Install a skill from ClawHub. Currently returns `501 Not Implemented`.

### `DELETE /api/skills/:name`

Uninstall a skill by name.

**Response:**
```json
{
  "success": true,
  "name": "code-review"
}
```

### `PUT /api/skills/:name/config`

Update configuration for a specific skill.

**Request:**
```json
{
  "key": "value"
}
```

**Response:**
```json
{
  "success": true,
  "name": "code-review"
}
```

## Push Notifications

### `POST /api/notifications/register`

Register an APNs/FCM device token for push notifications.

**Request:**
```json
{
  "deviceToken": "abc123...",
  "userId": "550e8400-...",
  "platform": "ios",
  "preferences": {}
}
```

**Response:**
```json
{
  "success": true
}
```

### `DELETE /api/notifications/unregister`

Unregister a device token.

**Request:**
```json
{
  "deviceToken": "abc123...",
  "userId": "550e8400-..."
}
```

**Response:**
```json
{
  "success": true
}
```

### `PATCH /api/notifications/preferences`

Update notification preferences for a registered device.

**Request:**
```json
{
  "deviceToken": "abc123...",
  "userId": "550e8400-...",
  "preferences": { "taskCompleted": true, "approvalRequired": true }
}
```

**Response:**
```json
{
  "success": true
}
```

### `GET /api/notifications/tokens`

List registered tokens for a user (debug endpoint).

**Query Parameters:**
- `userId` - User ID (defaults to `dev-user`)

**Response:**
```json
{
  "tokens": [ { "...token data..." } ],
  "count": 1
}
```

## Observations (Observability)

### `GET /api/observations`

List observation events with filters.

**Query Parameters:**
- `executionId` - Filter by trace/execution ID
- `projectId` - Filter by project
- `type` - Filter by type (`span`, `generation`, `tool`, `event`)
- `level` - Filter by level (`debug`, `default`, `warning`, `error`)
- `name` - Filter by observation name
- `startAfter` - ISO timestamp lower bound
- `startBefore` - ISO timestamp upper bound
- `limit` - Max results (default 100, max 1000)
- `offset` - Pagination offset (default 0)

**Response:**
```json
{
  "data": [ { "...observation event..." } ],
  "limit": 100,
  "offset": 0
}
```

### `GET /api/observations/stats`

Aggregate statistics across observations.

**Query Parameters:**
- `executionId` - Scope to a single execution
- `projectId` - Scope to a project

**Response:**
```json
{
  "totalEvents": 150,
  "totalSpans": 50,
  "totalGenerations": 30,
  "totalTools": 60,
  "totalEventType": 10,
  "errorCount": 2,
  "warningCount": 5,
  "totalCostUsd": 0.0523,
  "totalInputTokens": 12500,
  "totalOutputTokens": 8300
}
```

### `GET /api/observations/:traceId`

Get all observations for a specific execution trace, ordered by start time.

**Response:**
```json
{
  "data": [ { "...observation events..." } ],
  "traceId": "exec-abc123"
}
```

### `GET /api/observations/:traceId/summary`

Get a markdown summary for an execution. Returns pre-generated summary from task executions if available, otherwise generates one from observations.

**Response:** `text/plain` markdown summary

## Connected Accounts

Manages per-user external service integrations (Slack, Telegram, GitHub Webhooks, Linear). Requires authentication.

### `GET /api/connected-accounts`

List user's connected accounts. Credentials are returned masked.

**Response:**
```json
[
  {
    "id": "550e8400-...",
    "channel": "slack",
    "label": "My Workspace",
    "maskedCredentials": { "botToken": "xoxb...ab12" },
    "mappings": {},
    "settings": {},
    "externalId": "T12345",
    "enabled": true,
    "connectedAt": "2026-02-20T10:00:00Z"
  }
]
```

### `POST /api/connected-accounts`

Add a new connected account.

**Request:**
```json
{
  "channel": "slack",
  "label": "My Workspace",
  "credentials": { "botToken": "xoxb-...", "signingSecret": "abc..." },
  "mappings": {},
  "settings": {}
}
```

**Valid channels:** `slack`, `telegram`, `github_webhook`, `linear`

**Response:** `201` with the created account (credentials masked)

### `PUT /api/connected-accounts/:id`

Update account settings (label, mappings, settings, enabled). Does not update credentials.

**Request:**
```json
{
  "label": "Updated Name",
  "enabled": false
}
```

**Response:** Updated account (credentials masked)

### `DELETE /api/connected-accounts/:id`

Remove a connected account.

**Response:**
```json
{
  "success": true
}
```

### `POST /api/connected-accounts/:id/test`

Test the connection for a connected account. Verifies credentials by calling the external service API.

**Response:**
```json
{
  "success": true,
  "message": "Connected to Slack workspace: My Team",
  "details": { "...service-specific data..." }
}
```

## Apple App Site Association

### `GET /.well-known/apple-app-site-association`

Serves the Apple App Site Association file for passkey sync with iOS. Returns the JSON file from `public/.well-known/apple-app-site-association`.

**Response:** `application/json` with Apple AASA content

## Team Management

Requires authentication. Not available in local mode.

### `POST /api/teams/invite`

Create an invitation token and send email to invitee. Requires admin or owner role.

**Request:**
```json
{
  "teamId": "550e8400-...",
  "email": "invitee@example.com",
  "role": "member"
}
```

**Response:**
```json
{
  "success": true,
  "invite": {
    "id": "550e8400-...",
    "email": "invitee@example.com",
    "role": "member",
    "expiresAt": "2026-02-28T12:00:00Z",
    "emailSent": true
  }
}
```

### `GET /api/teams/:teamId/invites`

List all pending invites for a team. Requires admin or owner role.

**Response:**
```json
{
  "invites": [
    {
      "id": "550e8400-...",
      "email": "invitee@example.com",
      "role": "member",
      "expires_at": "2026-02-28T12:00:00Z",
      "created_at": "2026-02-21T12:00:00Z",
      "invited_by": "550e8400-...",
      "inviter": { "id": "...", "name": "Admin", "email": "admin@example.com" }
    }
  ]
}
```

### `DELETE /api/teams/invites/:inviteId`

Revoke (delete) a pending invitation. Requires admin or owner role.

**Response:**
```json
{
  "success": true
}
```

### `GET /api/teams/invite/:token`

Get invitation details by token. Public endpoint for the invite acceptance page.

**Response:**
```json
{
  "invite": {
    "email": "invitee@example.com",
    "role": "member",
    "teamName": "My Team",
    "expiresAt": "2026-02-28T12:00:00Z",
    "userExists": false
  }
}
```

### `POST /api/teams/accept/:token`

Accept a team invitation. Requires authentication. The authenticated user's email must match the invitation email.

**Response:**
```json
{
  "success": true,
  "team": { "id": "550e8400-...", "name": "My Team", "description": "..." }
}
```

### `GET /api/teams/:teamId/members`

List all members of a team. Requires team membership.

**Response:**
```json
{
  "members": [
    {
      "user_id": "550e8400-...",
      "role": "owner",
      "joined_at": "2026-02-20T10:00:00Z",
      "user": { "id": "...", "name": "Jane Doe", "email": "jane@example.com", "avatar_url": null }
    }
  ]
}
```

### `DELETE /api/teams/:teamId/members/:memberId`

Remove a member from a team. Requires admin or owner role, or self-removal. Cannot remove the last owner.

**Response:**
```json
{
  "success": true
}
```

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message",
  "details": {} // Optional additional context
}
```

**Common Error Codes:**
- `UNAUTHORIZED` - Missing or invalid auth token
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Invalid request data
- `INTERNAL_ERROR` - Server error

## Rate Limiting

**Authenticated requests:** 1000 req/min per user
**SSE connections:** 10 concurrent per user
**Task dispatch:** 100 tasks/min per user

## Related Documentation

- [Database Schema](./database-schema.md) - Database tables and relationships
- [Data Flows](./data-flows.md) - How data moves through the system
- [Authentication](./authentication.md) - Auth implementation details
- [Real-time Sync](../../REALTIME_SYNC.md) - Supabase Realtime integration
