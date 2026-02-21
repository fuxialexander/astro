# Astro Design Documentation

Comprehensive design documentation for the Astro platform. Use these documents as reference when making changes to the codebase.

## Documents

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Global system structure: three processes, two operating modes, package layout, tech stack, communication protocols, event system |
| [FRONTEND.md](./FRONTEND.md) | React app: routing, 18 Zustand stores, data persistence, API client, key components, data flow for user journeys |
| [BACKEND.md](./BACKEND.md) | Hono server: startup sequence, 22 routes, middleware, data storage (Postgres schema), event system, dispatch engine, procedure pipeline, provider system, prompt templates, observability |
| [AGENT_RUNNER.md](./AGENT_RUNNER.md) | Agent runner package: CLI commands, WebSocket client, task executor, 4 provider adapters, 5 execution strategies, safety system, worktree/PR management, MCP integration, configuration |
| [RELAY.md](./RELAY.md) | WebSocket relay: protocol messages, machine registry, authentication (local vs server), horizontal scaling, event flow, protocol gaps |
| [DATA_MODEL.md](./DATA_MODEL.md) | All data types: Project, PlanNode, PlanEdge, TaskExecution, Session, and more. Entity relationships, Postgres schema, IndexedDB keys |
| [USER_WORKFLOWS.md](./USER_WORKFLOWS.md) | End-to-end data flows: project creation, plan generation, task execution, chat, steering, approvals, batch execution, branch pruning, device auth, procedure pipeline |

## How to Use

- **Before modifying a component**: Read the relevant document to understand its responsibilities, data flow, and interactions.
- **Before adding a feature**: Check USER_WORKFLOWS.md to understand how similar features flow through the system.
- **Before refactoring**: Check DATA_MODEL.md for type definitions and ARCHITECTURE.md for the target architecture.
- **Quick type lookup**: DATA_MODEL.md has all type definitions with field descriptions.
- **Understanding the relay protocol**: RELAY.md has the complete WebSocket message catalog.

## Related Documents

- `docs/SERVER_LOCAL_MODE_SEPARATION.md` — Migration plan: moving AI execution from server to agent runner
- `CLAUDE.md` — Project-level instructions for Claude Code
- `vision.md` — Product vision document
