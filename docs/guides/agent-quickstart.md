# Astro Agent Quickstart

You are an AI agent. This guide explains how to use Astro for complex task orchestration.

## What is Astro?

Astro is a planning-first platform that helps you decompose complex goals into executable task graphs, dispatch work across multiple compute environments (local machines, HPC/Slurm clusters, cloud), and manage multi-step workflows with dependency tracking.

## Prerequisites

Astro requires a human to set up authentication. You cannot self-register.

1. **Human installs the CLI:**
   ```bash
   npm install -g @astroanywhere/cli
   ```

2. **Human authenticates (requires biometric/passkey):**
   ```bash
   astro-cli auth login
   ```

3. **You're ready.** The CLI is now authenticated on this machine. You can call `astro-cli` commands directly.

## Core Workflow

### 1. Create a Project

```bash
astro-cli project create "RNA-seq analysis pipeline"
```

### 2. Generate a Plan

Astro decomposes your goal into a directed task graph with dependencies:

```bash
astro-cli plan generate --project <project-id> --goal "Analyze RNA-seq dataset from GEO, perform differential expression, pathway enrichment, and generate publication figures"
```

### 3. Review and Dispatch Tasks

```bash
# View the plan
astro-cli plan show --project <project-id>

# Dispatch a specific task
astro-cli task dispatch <node-id>

# Monitor execution
astro-cli task status <node-id>
```

### 4. Register Compute (Optional)

Register additional machines for multi-environment dispatch:

```bash
# On the target machine (requires human to approve device code)
astro-cli machine register
```

## MCP Tools Integration

For richer integration, Astro provides an MCP (Model Context Protocol) tools server with 17 tools:

### Setup

```json
{
  "mcpServers": {
    "astro": {
      "command": "astro-agent",
      "args": ["mcp"],
      "transport": "stdio"
    }
  }
}
```

### Available Tools

| Category | Tools |
|----------|-------|
| **Plan Management** | `query_plan`, `create_task`, `update_task`, `create_dependency`, `delete_task` |
| **Project Management** | `query_projects`, `get_project`, `create_project`, `update_project` |
| **Initiative Management** | `query_initiatives`, `create_initiative`, `update_initiative` |
| **Data Access** | `get_user_profile`, `query_executions` |
| **Knowledge Store** | `store_knowledge`, `query_knowledge` |
| **User Interaction** | `ask_user_question` |

## Key Concepts

- **Plan Graph**: Tasks are nodes in a directed graph with explicit dependencies, not a flat list
- **Multi-environment Dispatch**: Tasks can run on local machines, HPC clusters (Slurm), or cloud
- **Tiered Verification**: Auto-close for verifiable tasks (tests pass, build succeeds), human judgment for strategic decisions
- **Branch Pruning**: Killing a branch auto-cancels all downstream tasks
- **Vision Injection**: A persistent document describing your goal is injected into every agent session

## Task Statuses

| Status | Meaning |
|--------|---------|
| `planned` | Ready to be dispatched |
| `dispatched` | Sent to a machine, waiting to start |
| `in_progress` | Currently executing |
| `auto_verified` | Completed and automatically verified |
| `awaiting_approval` | Needs human approval |
| `awaiting_judgment` | Needs human judgment |
| `completed` | Done |
| `pruned` | Cancelled (branch killed) |

## Separation of Concerns

By default, your work appears under your human's account. If you want separate tracking:

- Ask your human to register a second account with a different email
- Set up a separate CLI profile for the agent account

## Discovery

- **Manifest**: `GET /.well-known/astro.json` — machine-readable capabilities and setup info
- **This doc**: `GET /api/docs/agent-quickstart` — this quickstart guide (Markdown or JSON)
- **Agent protocol**: See `docs/guides/agent-runner-protocol.md` for low-level WebSocket protocol details

## Authentication Details

Astro uses RFC 8628 (OAuth2 Device Authorization Grant) for machine authentication. The flow:

1. CLI requests a device code from the server
2. Human opens a browser URL and approves with their passkey
3. CLI polls for the token and stores it locally
4. All subsequent CLI and MCP calls use this token automatically

No separate agent tokens or API keys are needed. The agent inherits the human's authenticated session.
