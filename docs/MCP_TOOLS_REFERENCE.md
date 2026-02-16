# Nexus MCP Tools Reference

This document describes all MCP (Model Context Protocol) tools available to agents running within Nexus task execution.

## Overview

Agents executing tasks in Nexus have access to **18 comprehensive MCP tools** that enable them to:
- **Manage the plan** (create/update/delete tasks, dependencies)
- **Manage projects** (create/update projects, query project details)
- **Manage initiatives** (group related projects)
- **Access data** (user profile, execution history)
- **Interact with users** (ask questions, get approvals)

All tools automatically use the current execution context (project ID, auth token) when available, so agents don't need to manually specify these in most cases.

---

## User Interaction

### `ask_user_question`

Ask the user a clarifying question when you need to make a decision with multiple valid approaches.

**When to use:**
- Multiple implementation approaches are equally valid
- Architectural decisions depend on user preferences
- Trade-offs where user priorities matter

**When NOT to use:**
- Questions you can research yourself
- Standard best practices

**Parameters:**
- `question` (required): The question to ask (be clear and concise)
- `options` (required): Array of 2-5 options for the user to choose from

**Returns:** The user's selected option

**Example:**
```javascript
{
  "question": "Which state management library should I use?",
  "options": [
    "Zustand (lightweight, already in project)",
    "Redux Toolkit (more structured, better DevTools)",
    "React Context (native, no dependencies)"
  ]
}
```

**Response:**
```
User selected: Zustand (lightweight, already in project)
```

---

## Plan Management

### `query_plan`

Query the plan graph for the current project. Returns all nodes (tasks) and edges (dependencies).

**When to use:**
- Understand current plan structure
- Check task statuses
- Identify dependencies
- Find related work

**Parameters:**
- `projectId` (optional): Project ID to query (defaults to current project)

**Returns:** JSON with `nodes` (array of task objects) and `edges` (array of dependency objects)

**Example:**
```javascript
{
  "projectId": "proj-123" // optional
}
```

**Response:**
```json
{
  "nodes": [
    {
      "id": "node-abc",
      "title": "Setup database schema",
      "description": "Create migration files...",
      "status": "completed",
      "type": "task",
      "priority": "high",
      "estimate": "M",
      ...
    }
  ],
  "edges": [
    {
      "id": "edge-xyz",
      "source": "node-abc",
      "target": "node-def",
      "type": "dependency"
    }
  ]
}
```

---

### `create_task`

Create a new task node in the plan. Returns the created task with its assigned ID.

**When to use:**
- Add new tasks discovered during execution
- Break down work into subtasks
- Add follow-up work

**Parameters:**
- `title` (required): Task title (concise, actionable)
- `description` (required): Detailed task description
- `type` (optional): Task type - `task`, `milestone`, `branch`, `decision` (default: `task`)
- `status` (optional): Task status - `planned`, `dispatched`, `in_progress`, `completed`, etc. (default: `planned`)
- `parentId` (optional): Parent task ID for hierarchical organization
- `dependencies` (optional): Array of task IDs this task depends on
- `environment` (optional): Execution environment - `local`, `remote`, `hpc`, `cloud`
- `verification` (optional): Verification method - `auto`, `human` (default: `auto`)
- `priority` (optional): Priority - `critical`, `high`, `normal`, `low`
- `estimate` (optional): Size estimate - `XS`, `S`, `M`, `L`, `XL`
- `dueDate` (optional): Due date in YYYY-MM-DD format
- `projectId` (optional): Project ID (defaults to current project)

**Returns:** Success message with the created task ID

**Example:**
```javascript
{
  "title": "Add input validation",
  "description": "Add validation for user inputs using Zod schema",
  "type": "task",
  "status": "planned",
  "dependencies": ["node-abc"],
  "priority": "high",
  "estimate": "S"
}
```

**Response:**
```
Task created successfully with ID: node-1234567890-abc
```

---

### `update_task`

Update an existing task in the plan. You can update any task properties including status, priority, dates, etc.

**When to use:**
- Mark tasks as completed
- Update estimates or priorities
- Change task details
- Update status after execution

**Parameters:**
- `taskId` (required): ID of the task to update
- `title` (optional): Updated title
- `description` (optional): Updated description
- `status` (optional): Updated status
- `priority` (optional): Updated priority
- `estimate` (optional): Updated size estimate
- `environment` (optional): Updated execution environment
- `verification` (optional): Updated verification method
- `dueDate` (optional): Updated due date (YYYY-MM-DD) or null to clear
- `startDate` (optional): Updated start date (YYYY-MM-DD) or null to clear
- `endDate` (optional): Updated end date (YYYY-MM-DD) or null to clear

**Returns:** Success message

**Example:**
```javascript
{
  "taskId": "node-abc",
  "status": "completed",
  "estimate": "S"
}
```

**Response:**
```
Task node-abc updated successfully
```

---

### `create_dependency`

Create a dependency edge between two tasks. Task B depends on Task A means B cannot start until A completes.

**When to use:**
- Establish task ordering
- Define dependencies between tasks
- Control execution flow

**Parameters:**
- `sourceTaskId` (required): ID of the task that must complete first (dependency)
- `targetTaskId` (required): ID of the task that depends on the source
- `type` (optional): Edge type - `dependency`, `branch` (default: `dependency`)
- `projectId` (optional): Project ID (defaults to current project)

**Returns:** Success message

**Example:**
```javascript
{
  "sourceTaskId": "node-abc",
  "targetTaskId": "node-def",
  "type": "dependency"
}
```

**Response:**
```
Dependency created: node-abc → node-def
```

---

### `delete_task`

Delete a task from the plan. This will also delete all edges connected to this task.

**⚠️ Warning:** This cannot be undone. Use with caution.

**Parameters:**
- `taskId` (required): ID of the task to delete

**Returns:** Success message

**Example:**
```javascript
{
  "taskId": "node-abc"
}
```

**Response:**
```
Task node-abc deleted successfully
```

---

## Project Management

### `query_projects`

Query all projects accessible to the current user. Returns project details including status, health, progress, and metadata.

**When to use:**
- Discover projects
- Check project status
- Find related work

**Parameters:** None

**Returns:** Array of project objects

**Example:**
```javascript
{}
```

**Response:**
```json
[
  {
    "id": "proj-123",
    "name": "User Authentication System",
    "description": "Build secure auth flow with OAuth2",
    "status": "active",
    "health": "on_track",
    "progress": 65,
    "visionDoc": "...",
    "workingDirectory": "/path/to/repo",
    "createdAt": "2026-02-15T10:00:00Z",
    ...
  }
]
```

---

### `get_project`

Get detailed information about a specific project including its vision document, status, health, and configuration.

**When to use:**
- Understand project context
- Access vision document
- Check project configuration

**Parameters:**
- `projectId` (optional): Project ID to retrieve (defaults to current project)

**Returns:** Project object

**Example:**
```javascript
{
  "projectId": "proj-123" // optional
}
```

**Response:**
```json
{
  "id": "proj-123",
  "name": "User Authentication System",
  "description": "Build secure auth flow with OAuth2",
  "visionDoc": "# Vision\n\nCreate a production-ready authentication system...",
  "status": "active",
  "health": "on_track",
  "progress": 65,
  ...
}
```

---

### `create_project`

Create a new project. Returns the created project with its assigned ID.

**When to use:**
- Organize work into a new project scope
- Start a new initiative
- Separate concerns

**Parameters:**
- `name` (required): Project name (concise, descriptive)
- `description` (required): Project description
- `visionDoc` (optional): Vision document (markdown, describes goals and context)
- `status` (optional): Project status - `active`, `archived` (default: `active`)
- `workingDirectory` (optional): Working directory or repository URL
- `defaultEnvironment` (optional): Default execution environment - `local`, `remote`, `hpc`, `cloud`
- `initiativeId` (optional): Initiative ID to group this project under

**Returns:** Success message with project ID and created project object

**Example:**
```javascript
{
  "name": "Payment Integration",
  "description": "Integrate Stripe payment processing",
  "visionDoc": "# Goal\n\nAdd secure payment processing...",
  "workingDirectory": "https://github.com/user/repo.git",
  "defaultEnvironment": "local"
}
```

**Response:**
```
Project created successfully with ID: 550e8400-e29b-41d4-a716-446655440000

{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Payment Integration",
  ...
}
```

---

### `update_project`

Update an existing project. You can update any project properties including name, description, vision, status, etc.

**When to use:**
- Maintain project metadata
- Update goals and vision
- Change configuration
- Update project health/progress

**Parameters:**
- `projectId` (optional): Project ID to update (defaults to current project)
- `name` (optional): Updated name
- `description` (optional): Updated description
- `visionDoc` (optional): Updated vision document
- `status` (optional): Updated status - `active`, `archived`
- `health` (optional): Updated health - `on_track`, `at_risk`, `off_track`
- `progress` (optional): Updated progress percentage (0-100)
- `workingDirectory` (optional): Updated working directory or repository URL
- `defaultEnvironment` (optional): Updated default execution environment

**Returns:** Success message

**Example:**
```javascript
{
  "health": "on_track",
  "progress": 75
}
```

**Response:**
```
Project proj-123 updated successfully
```

---

## Initiative Management

### `query_initiatives`

Query all initiatives accessible to the current user. Initiatives group related projects together.

**When to use:**
- Discover initiatives
- Find where to organize new projects

**Parameters:** None

**Returns:** Array of initiative objects

**Example:**
```javascript
{}
```

**Response:**
```json
[
  {
    "id": "init-456",
    "name": "Q1 2026 Platform Improvements",
    "description": "Modernize core platform features",
    "goal": "Improve developer experience and performance",
    "status": "active",
    "lead": "Alice Smith",
    "color": "#3b82f6",
    ...
  }
]
```

---

### `create_initiative`

Create a new initiative to group related projects. Returns the created initiative with its assigned ID.

**When to use:**
- Organize multiple related projects
- Create a common goal for related work

**Parameters:**
- `name` (required): Initiative name
- `description` (required): Initiative description
- `goal` (optional): Initiative goal or objective
- `status` (optional): Status - `active`, `on_hold`, `completed`, `cancelled` (default: `active`)
- `lead` (optional): Initiative lead (name or ID)
- `color` (optional): Color hex code for UI (default: `#3b82f6`)

**Returns:** Success message with initiative ID and created initiative object

**Example:**
```javascript
{
  "name": "Q2 2026 Mobile Launch",
  "description": "Ship iOS and Android apps",
  "goal": "Reach mobile users with native apps",
  "lead": "Bob Johnson",
  "color": "#10b981"
}
```

**Response:**
```
Initiative created successfully with ID: 660e8400-e29b-41d4-a716-446655440000

{
  "id": "660e8400-e29b-41d4-a716-446655440000",
  "name": "Q2 2026 Mobile Launch",
  ...
}
```

---

### `update_initiative`

Update an existing initiative. You can update any initiative properties including name, description, status, etc.

**Parameters:**
- `initiativeId` (required): Initiative ID to update
- `name` (optional): Updated name
- `description` (optional): Updated description
- `goal` (optional): Updated goal
- `status` (optional): Updated status - `active`, `on_hold`, `completed`, `cancelled`
- `lead` (optional): Updated initiative lead

**Returns:** Success message

**Example:**
```javascript
{
  "initiativeId": "init-456",
  "status": "completed"
}
```

**Response:**
```
Initiative init-456 updated successfully
```

---

## Data Access

### `get_user_profile`

Get the current user profile including name, email, domains of expertise, experience level, and preferences.

**When to use:**
- Understand user context
- Tailor your work to user expertise
- Check user preferences

**Parameters:** None

**Returns:** User profile object

**Example:**
```javascript
{}
```

**Response:**
```json
{
  "id": "user-789",
  "name": "Jane Developer",
  "email": "jane@example.com",
  "domains": ["backend", "infrastructure", "databases"],
  "experienceLevel": "senior",
  "preferredEnvironments": ["local", "cloud"],
  "notificationsEnabled": true,
  ...
}
```

---

### `query_executions`

Query execution history. Returns information about past task executions including status, output, metrics, and timestamps.

**When to use:**
- Learn from previous executions
- Understand execution patterns
- Debug issues
- Check task completion status

**Parameters:** None

**Returns:** Object mapping node IDs to execution objects

**Example:**
```javascript
{}
```

**Response:**
```json
{
  "node-abc": {
    "nodeClientId": "node-abc",
    "executionId": "exec-abc-123",
    "status": "completed",
    "streamText": "Task completed successfully...",
    "startedAt": "2026-02-15T10:00:00Z",
    "completedAt": "2026-02-15T10:05:00Z",
    "durationMs": 300000,
    "model": "claude-sonnet-4-5-20250929",
    "inputTokens": 5000,
    "outputTokens": 2000,
    "estimatedCostUsd": 0.05,
    ...
  }
}
```

---

## Usage Examples

### Example 1: Agent discovers new work and creates tasks

```javascript
// During execution, agent realizes additional work is needed

// First, query the current plan to understand context
query_plan()

// Create a new task for the discovered work
create_task({
  title: "Add error handling for API failures",
  description: "Implement retry logic and error boundaries for API calls",
  priority: "high",
  estimate: "M",
  dependencies: ["node-current-task"]
})

// Create another related task
create_task({
  title: "Add integration tests for error scenarios",
  description: "Test retry logic and error handling",
  priority: "normal",
  estimate: "S",
  dependencies: ["node-error-handling-task"]
})
```

---

### Example 2: Agent needs user decision

```javascript
// Agent encounters a choice with multiple valid approaches

ask_user_question({
  question: "Which database migration strategy should I use?",
  options: [
    "Blue-green deployment (zero downtime, requires duplicate resources)",
    "Rolling migration (gradual, lower resource cost, brief degradation)",
    "Maintenance window (fastest, requires scheduled downtime)"
  ]
})

// User selects: "Rolling migration"
// Agent proceeds with rolling migration approach
```

---

### Example 3: Agent creates a new project for separate work

```javascript
// Agent realizes this work should be a separate project

create_project({
  name: "API Rate Limiting Service",
  description: "Standalone microservice for rate limiting across all APIs",
  visionDoc: "# Vision\n\nCreate a centralized rate limiting service...",
  workingDirectory: "https://github.com/org/rate-limiter.git",
  defaultEnvironment: "cloud"
})

// Then create tasks in the new project
create_task({
  projectId: "new-project-id",
  title: "Design rate limiting algorithm",
  description: "Choose between token bucket, leaky bucket, or fixed window",
  type: "decision"
})
```

---

### Example 4: Agent updates task status after work

```javascript
// After completing work, update the task status

update_task({
  taskId: "node-current",
  status: "completed",
  estimate: "M" // actual estimate vs original
})

// If work revealed new requirements, create follow-up tasks
create_task({
  title: "Refactor error handling based on learnings",
  description: "Apply patterns discovered during implementation",
  priority: "normal",
  dependencies: ["node-current"]
})
```

---

## Environment Variables

The MCP server automatically receives these environment variables from the provider:

- `NEXUS_EXECUTION_ID`: Current execution/task ID
- `NEXUS_PROJECT_ID`: Current project ID (used as default for tools)
- `NEXUS_SERVER_URL`: Nexus API server URL (default: http://localhost:3001)
- `NEXUS_AUTH_TOKEN`: Authentication token for API requests

Most tools use these automatically, so you don't need to specify `projectId` in most cases.

---

## Error Handling

All tools return errors in a consistent format:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: No project ID available. Specify projectId or ensure NEXUS_PROJECT_ID is set."
    }
  ],
  "isError": true
}
```

Common error scenarios:
- Missing required parameters
- Invalid project/task IDs
- API authentication failures
- Network/server errors

---

## Best Practices

1. **Query before creating**: Use `query_plan` to understand the existing plan before creating new tasks
2. **Use dependencies**: Always specify task dependencies to ensure correct execution order
3. **Provide context**: Include detailed descriptions in tasks to help future agents/humans understand the work
4. **Update status**: Mark tasks as completed when done to keep the plan accurate
5. **Ask when uncertain**: Use `ask_user_question` for decisions that depend on user preferences
6. **Check user profile**: Use `get_user_profile` to tailor your approach to the user's expertise level
7. **Group related work**: Use projects and initiatives to organize related tasks
8. **Be specific**: Use priority and estimate fields to help with planning and resource allocation

---

## Version

MCP Tools Server: v2.0.0
Last Updated: 2026-02-15
