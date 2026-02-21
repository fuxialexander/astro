# Astro Documentation

Welcome to the Astro documentation. This index organizes all documentation into four main sections: Backend, Frontend, Relay Server, and System Setup.

## Quick Start

- **New to Astro?** Start with [Developer Setup](./setup/developer-setup.md)
- **Setting up local development?** See [Local Mode Setup](./setup/local-mode.md)
- **Deploying to production?** Check [Production Setup](./setup/production-setup.md)
- **Understanding the architecture?** Read [Architecture Overview](./ARCHITECTURE.md)

## Documentation Sections

### 1. Backend

Backend documentation covers the Hono.js server, database schema, API endpoints, and data flows.

**Core Documentation:**
- [Database Schema](./backend/database-schema.md) - Drizzle schema, tables, and relationships
- [API Reference](./backend/api-reference.md) - Complete API endpoint documentation
- [RLS Policies](./backend/rls-policies.md) - Row-level security policies for Supabase
- [Data Flows](./backend/data-flows.md) - How data moves through the system
- [User Behavior Tracking](./backend/user-behavior-tracking.md) - Activity logging and analytics

**Specialized Topics:**
- [Authentication](./backend/authentication.md) - WebAuthn/passkey implementation
- [Device Authorization](./backend/device-authorization.md) - OAuth2 device code flow for agent runners
- [MCP Integration](./MCP_TOOLS_REFERENCE.md) - Model Context Protocol tools for agents
- [Observability](./OBSERVABILITY_AND_SAFETY.md) - Logging, metrics, and safety

### 2. Frontend

Frontend documentation covers React components, routing, state management, and user workflows.

**Core Documentation:**
- [Page Structure](./frontend/page-structure.md) - All pages and their routes
- [Component Architecture](./frontend/component-architecture.md) - UI component organization
- [State Management](./frontend/state-management.md) - Zustand stores and IndexedDB persistence
- [Routing](./frontend/routing.md) - React Router v7 setup and protected routes
- [User Workflows](./frontend/user-workflows.md) - Common user journeys

**Specialized Topics:**
- [Plugin System](./PLUGIN_SYSTEM.md) - Plugin architecture and API
- [Real-time Sync](./frontend/realtime-sync.md) - Supabase Realtime integration
- [Plan Graph](./frontend/plan-graph.md) - React Flow graph visualization
- [UI Screens Reference](./ui_screen_list.md) - Complete screen inventory

### 3. Relay Server

Relay server documentation covers WebSocket communication, agent dispatch, and workspace management.

**Core Documentation:**
- [Relay Overview](./relay/overview.md) - WebSocket hub architecture
- [Protocol Specification](./relay/protocol.md) - Message types and flows
- [Machine Registry](./relay/machine-registry.md) - Connected machine tracking
- [Dispatch System](./relay/dispatch-system.md) - Task routing and execution
- [Workspace Preparation](./relay/workspace-preparation.md) - Git worktree management

**Specialized Topics:**
- [Agent Runner Protocol](./guides/agent-runner-protocol.md) - Client implementation guide
- [Horizontal Scaling](./relay/scaling.md) - Redis pub/sub for multi-instance
- [Security](./relay/security.md) - Authentication and rate limiting

### 4. System Setup

Setup documentation covers development modes, deployment, and infrastructure configuration.

**Core Documentation:**
- [Developer Setup](./setup/developer-setup.md) - Getting started with local development
- [Local Mode](./setup/local-mode.md) - IndexedDB-only single-user mode
- [Server Mode](./setup/server-mode.md) - Supabase multi-user mode
- [Production Deployment](./setup/production-deployment.md) - Fly.io + Cloudflare Pages
- [Supabase Local Development](./setup/supabase-local-dev.md) - Running Supabase locally

**Specialized Topics:**
- [Docker Setup](./setup/docker-setup.md) - Docker Compose configuration
- [Environment Variables](./setup/environment-variables.md) - Complete env var reference
- [Cloudflare Tunnel](./setup/cloudflare-tunnel.md) - Local HTTPS tunneling
- [Fly.io Deployment](./FLY_DEPLOYMENT.md) - Fly.io deployment guide

## Feature-Specific Documentation

### Approvals
- [Approval System](../APPROVAL_SYSTEM.md) - Complete approval architecture
- [Approval Quickstart](./APPROVAL_QUICKSTART.md) - Getting started with approvals
- [Approval Testing](../scripts/TESTING_APPROVAL.md) - Testing guide

### Activity & Events
- [Activity Feed](../ACTIVITY_FEED.md) - Activity tracking system
- [Real-time Sync](../REALTIME_SYNC.md) - Supabase Realtime implementation
- [Real-time Examples](./realtime-sync-example.md) - Usage examples
- [Real-time Quick Reference](./realtime-sync-quick-reference.md) - Quick reference guide

### Integrations
- [GitHub Integration](./GITHUB_INTEGRATION.md) - GitHub OAuth and API integration
- [GitHub Quickstart](./GITHUB_QUICKSTART.md) - Getting started with GitHub
- [GitHub OAuth Local Setup](./GITHUB_OAUTH_LOCAL_SETUP.md) - Local OAuth setup
- [Merge Queue Setup](./MERGE_QUEUE_SETUP.md) - GitHub merge queue integration
- [Git Pull Hook](./git-pull-hook.md) - Git hooks for Claude Code

### MCP Tools
- [MCP Tools Reference](./MCP_TOOLS_REFERENCE.md) - Complete tool catalog
- [MCP Tools Implementation](./MCP_TOOLS_IMPLEMENTATION.md) - Implementation details
- [MCP Installation](./MCP_INSTALLATION.md) - Installation and setup

### Testing
- [Testing Guide](../TESTING.md) - Testing strategy and tools
- [Approval Testing](../scripts/TESTING_APPROVAL.md) - Approval system tests
- [Deployment Testing](./DEPLOYMENT_AND_TESTING.md) - Pre-deployment testing
- [Scripts README](../scripts/README.md) - Testing scripts documentation

## Architecture Documentation

- [Architecture Overview](./ARCHITECTURE.md) - Complete system architecture
- [Information Flow](./architecture/information-flow.md) - Data flow diagrams
- [Relay System](./architecture/relay-system.md) - Relay server architecture
- [Deployment Architecture](./architecture/deployment.md) - Production infrastructure

## Additional Resources

### Project Management
- [Vision Document](../vision.md) - Product vision and roadmap
- [CLAUDE.md](../CLAUDE.md) - AI assistant instructions
- [Roadmap](../ROADMAP.md) - Feature roadmap
- [Changelog](../CHANGELOG.md) - Release notes
- [Contributing](../CONTRIBUTING.md) - Contribution guidelines

### Security & Operations
- [Deployment Security Checklist](../DEPLOYMENT_SECURITY_CHECKLIST.md) - Security checklist
- [Machine Names](./MACHINE_NAMES.md) - Machine naming conventions
- [Observability](./OBSERVABILITY_AND_SAFETY.md) - Monitoring and safety

### Performance
- [Prompt Caching](../PROMPT_CACHING.md) - Claude prompt caching
- [Caching Quick Start](../CACHING_QUICK_START.md) - Getting started with caching

### Legacy/Deprecated
- [Cyrus Integration](../CYRUS_INTEGRATION.md) - Legacy integration (deprecated)
- [Sidebar Supabase Sync](../SIDEBAR_SUPABASE_SYNC.md) - Old sync approach (deprecated)
- [Local Server Mode Changes](./LOCAL_SERVER_MODE_CHANGES.md) - Migration notes

## Documentation Conventions

### File Organization
- `docs/backend/` - Backend implementation details
- `docs/frontend/` - Frontend implementation details
- `docs/relay/` - Relay server documentation
- `docs/setup/` - Setup and deployment guides
- `docs/architecture/` - High-level architecture docs
- `docs/guides/` - How-to guides and tutorials
- Root directory - Feature-specific documentation (APPROVAL_SYSTEM.md, ACTIVITY_FEED.md, etc.)

### Cross-References
- Use relative paths for all links
- Link to the most specific documentation available
- Keep examples up-to-date with current implementation

### Updating Documentation
When adding new features:
1. Create feature-specific documentation in the root if it's a major feature
2. Add implementation details to the appropriate section (backend/frontend/relay/setup)
3. Update this index with links to new documentation
4. Update CLAUDE.md with any new patterns or conventions
