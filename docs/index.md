# Astro Documentation

Welcome to the Astro documentation. Documents are organized into design docs (the canonical reference) and technical docs (implementation details).

## Quick Start

- **New to Astro?** Start with [Developer Setup](./setup/developer-setup.md)
- **Setting up local development?** See [Local Mode](./setup/local-mode.md)
- **Understanding the architecture?** Read [Design Docs](./design/README.md)

## Design Documents (Canonical Reference)

The design docs in `docs/design/` are the authoritative reference for the system. Always consult these first.

| Document | Description |
|----------|-------------|
| [ARCHITECTURE](./design/ARCHITECTURE.md) | System structure, processes, modes, tech stack, protocols |
| [FRONTEND](./design/FRONTEND.md) | React app: routing, stores, components, data flow |
| [BACKEND](./design/BACKEND.md) | Hono server: routes, middleware, storage, dispatch, providers |
| [AGENT_RUNNER](./design/AGENT_RUNNER.md) | Agent runner: CLI, providers, strategies, safety, worktree |
| [RELAY](./design/RELAY.md) | WebSocket relay: protocol, registry, scaling |
| [DATA_MODEL](./design/DATA_MODEL.md) | All types: Project, PlanNode, PlanEdge, etc. |
| [USER_WORKFLOWS](./design/USER_WORKFLOWS.md) | End-to-end data flows for all user journeys |
| [IMPLEMENTATION_PIPELINE](./design/IMPLEMENTATION_PIPELINE.md) | Implementation priorities and pipeline |
| [COLLABORATION](./design/COLLABORATION.md) | Teams, public projects, content model, community review |
| [FRONTEND_EPHEMERAL_CACHE](./design/FRONTEND_EPHEMERAL_CACHE.md) | Ephemeral auto-fetch for machine-derived metadata (file trees, skills) |
| [PACKAGE_ARCHITECTURE](./design/PACKAGE_ARCHITECTURE.md) | Monorepo package structure: core, cli, server, agent-runner, desktop |
| [TAURI_APP](./design/TAURI_APP.md) | Tauri desktop app vision, plugin system architecture, migration path |
| [CURRENT_CONFLICT_VIEW](./design/CURRENT_CONFLICT_VIEW.md) | Known conflicts between design and code |

## Technical Documentation

### Backend

- [API Reference](./backend/api-reference.md) - API endpoint documentation
- [Database Schema](./backend/database-schema.md) - Drizzle schema, tables, relationships (includes Teams schema)
- [RLS Policies](./backend/rls-policies.md) - Row-level security policies
- [Data Flows](./backend/data-flows.md) - How data moves through the system
- [Authentication](./backend/authentication.md) - WebAuthn/passkey implementation
- [Device Authorization](./backend/device-authorization.md) - OAuth2 device code flow
- [Observability](./backend/observability-and-safety.md) - Logging, metrics, safety
- [User Behavior Tracking](./backend/user-behavior-tracking.md) - Activity and analytics
- [Machine Names](./backend/machine-names.md) - Machine naming conventions
- [Prompt Caching](./backend/prompt-caching.md) - Claude prompt caching
- [Workspace V2 Data Model](./backend/workspace-v2-data-model.md) - Type, schema, and storage changes
- [Workspace V2 Backend](./backend/workspace-v2-backend.md) - API, dispatch, and context assembly changes

### Frontend

- [Page Structure](./frontend/page-structure.md) - Pages and routes
- [Component Architecture](./frontend/component-architecture.md) - UI component organization
- [State Management](./frontend/state-management.md) - Zustand stores
- [Routing](./frontend/routing.md) - React Router v7 setup
- [Plan Graph](./frontend/plan-graph.md) - React Flow graph visualization
- [Keyboard Navigation](./frontend/keyboard-navigation.md) - Keyboard nav system
- [UI Screen List](./frontend/ui-screen-list.md) - Complete screen inventory
- [Workspace V2 Frontend](./frontend/workspace-v2-frontend.md) - Store, component, and page changes

### Relay Server

- [Relay Overview](./relay/overview.md) - WebSocket hub architecture
- [Protocol Specification](./relay/protocol.md) - Message types and flows
- [Workspace V2 Relay](./relay/workspace-v2-relay.md) - Relay and agent runner changes for Workspace V2

### Setup & Deployment

- [Developer Setup](./setup/developer-setup.md) - Getting started guide
- [Local Mode](./setup/local-mode.md) - IndexedDB-only single-user mode
- [Server Mode](./setup/server-mode.md) - Supabase multi-user mode
- [Environment Variables](./setup/environment-variables.md) - Complete env var reference
- [Fly Deployment](./setup/fly-deployment.md) - Fly.io deployment guide
- [Deployment & Testing](./setup/deployment-and-testing.md) - Pre-deployment testing
- [Cloudflare Tunnel](./setup/cloudflare-tunnel.md) - Local HTTPS tunneling
- [Docker Setup](./setup/docker-setup.md) - Docker Compose configuration
- [Supabase Local Dev](./setup/supabase-local-dev.md) - Running Supabase locally
- [HPC SSH Setup](./setup/hpc-ssh-setup.md) - HPC cluster connection
- [Security Checklist](./setup/security-checklist.md) - Security checklist

### Features

- [Approval System](./features/approval-system.md) - Approval architecture
- [Activity Feed](./features/activity-feed.md) - Activity tracking system
- [Realtime Sync](./features/realtime-sync.md) - Supabase Realtime integration
- [Plugin System](./features/plugin-system.md) - Plugin architecture and API

### MCP Tools

- [Tools Reference](./mcp/tools-reference.md) - Complete MCP tool catalog
- [Installation](./mcp/installation.md) - MCP installation and setup

### Integrations

- [GitHub Integration](./integrations/github.md) - GitHub OAuth and API
- [GitHub OAuth Local Setup](./integrations/github-oauth-local-setup.md) - Local OAuth setup
- [Merge Queue](./integrations/merge-queue-setup.md) - GitHub merge queue
- [Overleaf & Zotero](./integrations/overleaf-zotero.md) - Research tool integrations

### Guides

- [Agent Runner Protocol](./guides/agent-runner-protocol.md) - Client implementation guide
- [Git Pull Hook](./guides/git-pull-hook.md) - Git hooks for Claude Code

### Testing

- [Testing Guide](./testing/testing.md) - Testing strategy and tools
- [Approval Testing](./testing/approval-testing.md) - Approval system tests (consolidated)
- [Approval Quickstart](./testing/approval-quickstart.md) - Approval developer guide

### Deprecated

Historical documents kept for context. Do not reference for current implementation.

- [Architecture v1](./deprecated/architecture-v1.md) - Old architecture doc (SQLite era)
- [Cyrus Integration](./deprecated/cyrus-integration.md) - Legacy integration
- [Local Server Mode Changes](./deprecated/local-server-mode-changes.md) - Migration notes
- [Sidebar Supabase Sync](./deprecated/sidebar-supabase-sync.md) - Old sync approach
- [Frontend User Workflows](./deprecated/frontend-user-workflows.md) - Superseded by design/USER_WORKFLOWS.md
- [SERVER_ARCHITECTURE_V2](./deprecated/SERVER_ARCHITECTURE_V2.md) - Consolidated into ARCHITECTURE.md
- [LOCAL_SERVER_REFACTOR](./deprecated/LOCAL_SERVER_REFACTOR.md) - Implementation complete
- [SERVER_LOCAL_MODE_SEPARATION](./deprecated/SERVER_LOCAL_MODE_SEPARATION.md) - Core goals achieved
- [EXECUTION_PATH_DUPLICATION](./deprecated/EXECUTION_PATH_DUPLICATION.md) - Resolved
- [Deployment Architecture](./deprecated/deployment.md) - Superseded by fly-deployment.md

## Root Documents

These files remain at the project root by convention:

- `README.md` - Project overview
- `CLAUDE.md` - AI assistant instructions
- `CONTRIBUTING.md` - Contribution guidelines
- `CHANGELOG.md` - Release notes
- `ROADMAP.md` - Feature roadmap
- `vision.md` - Product vision

## Other

- `scripts/README.md` - Test scripts documentation
