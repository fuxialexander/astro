# Nexus Architecture

This document provides a comprehensive overview of the Nexus system architecture, design patterns, and technical decisions.

## Table of Contents

- [System Overview](#system-overview)
- [Architecture Diagram](#architecture-diagram)
- [Core Components](#core-components)
- [Design Patterns](#design-patterns)
- [Data Flow](#data-flow)
- [Technology Stack](#technology-stack)
- [Deployment Architecture](#deployment-architecture)

## System Overview

Nexus is a distributed task planning and execution system that enables teams to break down complex development tasks, execute them across multiple environments, and monitor progress in real-time.

### Key Capabilities

- **Intelligent Task Planning**: AI-powered task decomposition with dependency tracking
- **Multi-Environment Execution**: Support for local machines, remote servers, and HPC clusters
- **Real-time Monitoring**: Live progress tracking via Server-Sent Events (SSE)
- **Context-Aware Execution**: Automatic injection of project context and dependencies
- **Provider Abstraction**: Pluggable execution adapters for different environments

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   UI Layer   │  │  State Mgmt  │  │   Routing (RRv7)    │  │
│  │  (Components)│  │  (Zustand)   │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                  │                     │               │
│         └──────────────────┴─────────────────────┘               │
│                            │                                     │
│                    ┌───────▼────────┐                           │
│                    │  API Client    │                           │
│                    │  (EventSource) │                           │
│                    └───────┬────────┘                           │
└────────────────────────────┼──────────────────────────────────┘
                             │ HTTP/SSE
┌────────────────────────────┼──────────────────────────────────┐
│                    ┌───────▼────────┐                          │
│                    │  Hono Server   │                          │
│                    │  (API Layer)   │                          │
│                    └───────┬────────┘                          │
│                            │                                    │
│         Backend (Node.js)  │                                   │
│  ┌─────────────────────────┴──────────────────────┐           │
│  │                                                  │           │
│  │  ┌────────────────┐       ┌──────────────────┐ │           │
│  │  │  SSE Bridge    │       │  WebSocket       │ │           │
│  │  │  (EventEmitter)│       │  Relay           │ │           │
│  │  └────────┬───────┘       └──────┬───────────┘ │           │
│  │           │                       │             │           │
│  │  ┌────────▼───────────────────────▼──────────┐ │           │
│  │  │       Dispatch Engine                     │ │           │
│  │  │  ┌──────────┐  ┌──────────┐  ┌─────────┐ │ │           │
│  │  │  │  Queue   │  │  Branch  │  │ Result  │ │ │           │
│  │  │  │  Manager │  │  Manager │  │ Router  │ │ │           │
│  │  │  └──────────┘  └──────────┘  └─────────┘ │ │           │
│  │  └────────────────┬───────────────────────── │ │           │
│  │                   │                           │ │           │
│  │  ┌────────────────▼─────────────────────────┐ │           │
│  │  │       Provider Abstraction Layer         │ │           │
│  │  │  ┌──────────┐  ┌──────────┐  ┌────────┐ │ │           │
│  │  │  │  Claude  │  │  Codex   │  │ SLURM  │ │ │           │
│  │  │  │   Code   │  │          │  │  (HPC) │ │ │           │
│  │  │  └──────────┘  └──────────┘  └────────┘ │ │           │
│  │  └──────────────────────────────────────────┘ │           │
│  └─────────────────────────────────────────────── │           │
│                                                    │           │
│  ┌────────────────┐       ┌────────────────────┐ │           │
│  │  Redis Cache   │       │  Supabase DB       │ │           │
│  │  (Sessions,    │       │  (Auth, Projects,  │ │           │
│  │   Events)      │       │   Tasks)           │ │           │
│  └────────────────┘       └────────────────────┘ │           │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### Frontend Layer

#### 1. React Application
- **Framework**: React 19 with hooks-based components
- **Routing**: React Router v7 for declarative navigation
- **State Management**: Zustand for global state
- **Styling**: Tailwind CSS v4 with Vite plugin

#### 2. State Stores (Zustand)
- **realtime-store**: Manages SSE connections and live updates
- **project-store**: Project data and operations
- **plan-store**: Task graph and planning state
- **machines-store**: Registered execution environments
- **user-profile-store**: User identity and preferences
- **display-settings-store**: UI preferences per view
- **usage-store**: Session usage tracking

#### 3. Real-time Client
- EventSource wrapper for SSE connections
- Automatic reconnection with exponential backoff
- Last-Event-ID header for event replay
- Type-safe event handling

### Backend Layer

#### 1. Hono Server
- Lightweight, fast web framework
- Built-in middleware support
- Type-safe routing
- SSE streaming support via `streamSSE`

#### 2. SSE Bridge Pattern
- EventEmitter-based event bus
- Ring buffer for event replay (`event-buffer.ts`)
- Handles reconnection and missed events
- Routes events from providers → clients

#### 3. Dispatch Engine
- **Queue Manager**: Task queue with priority scheduling
- **Branch Manager**: Parallel execution branch tracking
- **Result Router**: Routes execution results to consumers
- **Context Assembler**: Injects project vision and dependencies

#### 4. Provider Abstraction
Each provider implements a common interface:

```typescript
interface Provider {
  execute(task: Task, context: Context): AsyncIterator<ExecutionEvent>
  cancel(executionId: string): Promise<void>
  getStatus(executionId: string): Promise<ExecutionStatus>
}
```

**Providers:**
- **Claude Code Provider**: Local execution via Claude agent
- **Codex Provider**: Remote execution on registered machines
- **SLURM Provider**: HPC cluster job submission

### Data Layer

#### 1. Supabase (PostgreSQL)
- User authentication and profiles
- Project and task metadata
- Vision documents and context
- Machine registration

#### 2. Redis
- Session management
- Event buffer (last N events per client)
- Real-time state cache
- Rate limiting

## Design Patterns

### 1. SSE Bridge Pattern

**Problem**: Need reliable real-time updates from server to multiple clients with reconnection support.

**Solution**:
```
Provider Events → EventEmitter → SSE Endpoint → EventSource → Zustand Store
```

**Benefits**:
- Native browser reconnection
- Event replay on reconnect
- Multiple clients per session
- Lower overhead than WebSocket

### 2. Dual Dispatch Pattern

**Problem**: Support both local and remote execution with different transport mechanisms.

**Solution**:
- **Local Dispatch**: Direct SSE stream from provider
- **Relay Dispatch**: WebSocket → Server → SSE bridge

**Benefits**:
- Unified interface for consumers
- Flexibility in execution location
- Transparent to frontend

### 3. Provider Abstraction Pattern

**Problem**: Multiple execution environments with different APIs and capabilities.

**Solution**: Common provider interface with adapters for each environment.

**Benefits**:
- Easy to add new providers
- Consistent error handling
- Centralized resource management

### 4. Context Assembly Pattern

**Problem**: Execution needs project context without manual injection.

**Solution**: Automatic assembly of:
- Vision document (project goals, constraints)
- Dependency context (related tasks, files)
- Environment configuration

**Benefits**:
- Consistent context across executions
- Reduced manual work
- Better execution quality

### 5. Event Sourcing (Partial)

**Problem**: Need to replay events for reconnecting clients.

**Solution**: Ring buffer stores last N events per client session.

**Benefits**:
- Missed events can be replayed
- State consistency after reconnect
- Debugging support

## Data Flow

### Task Execution Flow

1. **User creates task** in frontend
   - UI sends POST request to `/api/tasks`
   - Server validates and stores in database
   - Returns task ID

2. **Task planning** (if needed)
   - Request sent to planning service
   - AI breaks down task into subtasks
   - Dependency graph created
   - Stored in plan-store

3. **Task dispatch**
   - Dispatch engine selects provider
   - Provider-specific context assembled
   - Execution request sent to provider
   - Execution ID returned

4. **Real-time updates**
   - Provider streams events
   - Events flow through SSE bridge
   - EventSource receives events
   - Zustand stores updated
   - UI re-renders

5. **Completion**
   - Final result event emitted
   - State updated in database
   - Cleanup performed
   - Next task dispatched (if any)

### Authentication Flow

1. **User login**
   - User submits credentials
   - Supabase authenticates
   - JWT tokens issued
   - Stored in auth-store

2. **Device registration** (for agents)
   - Device requests authorization
   - User code displayed
   - User authorizes on web
   - Device tokens issued
   - Machine registered in database

3. **Token refresh**
   - Automatic before expiration
   - Refresh token exchanged
   - New access token issued
   - State updated

## Technology Stack

### Frontend
- **React 19**: UI framework with concurrent features
- **React Router v7**: Client-side routing
- **Zustand**: Lightweight state management
- **Tailwind CSS v4**: Utility-first styling
- **Vite**: Fast build tool and dev server
- **React Flow**: Graph visualization
- **Radix UI**: Accessible component primitives

### Backend
- **Node.js 25.6.0**: Runtime environment
- **Hono**: Web framework
- **TypeScript 5.9**: Type safety
- **Supabase**: Auth and database
- **Redis**: Caching and sessions
- **WebSocket (ws)**: Real-time relay

### Infrastructure
- **Cloudflare Pages**: Frontend hosting
- **Fly.io**: Backend hosting (optional)
- **Docker**: Containerization
- **GitHub Actions**: CI/CD

### Development
- **ESLint**: Code linting
- **Husky**: Git hooks
- **Concurrently**: Multi-process dev server
- **tsx**: TypeScript execution

## Deployment Architecture

### Development
```
Local Machine
├── Vite Dev Server (port 5173) - Frontend with HMR
├── Hono Server (port 3001) - Backend API
├── Relay Server (port 3002) - WebSocket relay
└── Redis (optional) - In-memory fallback
```

### Production (Serverless)
```
Cloudflare Pages
├── Static frontend assets
└── Edge functions (optional)

Fly.io / Docker
├── Hono API server
├── WebSocket relay
└── Redis instance

Supabase Cloud
└── PostgreSQL database + Auth
```

### Production (Self-hosted)
```
Docker Compose
├── Nexus Container
│   ├── Frontend (served via Node)
│   ├── Backend API
│   └── WebSocket relay
├── Redis Container
└── Supabase (self-hosted)
    ├── PostgreSQL
    ├── Auth
    └── Storage
```

## Scalability Considerations

### Horizontal Scaling
- **Stateless API servers**: Can run multiple instances
- **Redis sessions**: Shared session store
- **Event buffer**: Per-client, stored in Redis
- **Load balancer**: Distribute requests

### Vertical Scaling
- **Redis memory**: Adjust based on concurrent clients
- **Database connections**: Pool size tuning
- **Event buffer size**: Balance memory vs replay capability

### Performance Optimizations
- **SSE compression**: Reduce bandwidth
- **Event batching**: Combine multiple events
- **Lazy loading**: Load data on demand
- **Memoization**: Cache expensive computations
- **Database indexing**: Optimize queries

## Security Architecture

### Authentication
- JWT tokens with short expiration
- Refresh tokens stored securely
- Device-specific tokens for agents
- Supabase Row Level Security (RLS)

### Authorization
- Role-based access control (RBAC)
- Project-level permissions
- Machine ownership validation
- API rate limiting

### Data Protection
- HTTPS everywhere
- Environment variables for secrets
- No sensitive data in logs
- Input validation and sanitization

## Monitoring and Observability

### Logging
- Structured JSON logs
- Log levels (debug, info, warn, error)
- Request/response logging
- Provider execution logs

### Metrics
- API response times
- SSE connection count
- Task execution duration
- Provider success/failure rates

### Tracing
- Request ID propagation
- Execution ID tracking
- Event chain visualization

## Future Improvements

### Short-term
- [ ] Add WebSocket fallback for SSE
- [ ] Implement request batching
- [ ] Add metrics dashboard
- [ ] Improve error recovery

### Long-term
- [ ] Multi-region deployment
- [ ] GraphQL API option
- [ ] Advanced task scheduling
- [ ] Machine learning for task routing
- [ ] Collaborative editing

## References

- [Hono Documentation](https://hono.dev/)
- [React Flow Documentation](https://reactflow.dev/)
- [Zustand Documentation](https://zustand-demo.pmnd.rs/)
- [Server-Sent Events Spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
