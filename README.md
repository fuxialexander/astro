# Nexus

> A distributed task planning and execution system for AI-powered development workflows

Nexus is a sophisticated orchestration platform that enables teams to plan, execute, and monitor complex development tasks across multiple environments. It features intelligent task decomposition, distributed execution, and real-time progress tracking.

## Features

- **Smart Task Planning**: AI-powered task breakdown with dependency management
- **Multi-Environment Execution**: Support for local, remote, and HPC cluster execution
- **Real-time Monitoring**: Live task progress tracking via SSE streams
- **Provider Abstraction**: Pluggable execution adapters (Claude Code, Codex, SLURM)
- **Device Authentication**: Secure OAuth2-based machine registration
- **Visual Planning**: Interactive task graph visualization with React Flow
- **Context-Aware Execution**: Automatic injection of project vision and dependency context

## Architecture

Nexus follows a client-server architecture with the following key components:

- **Frontend**: React 19 + React Router v7 + Zustand for state management
- **Backend**: Hono server with SSE streaming and WebSocket support
- **Execution Layer**: Multi-provider dispatch system with queue management
- **Storage**: Redis for session management, event buffering, and real-time state

### Key Patterns

- **SSE Bridge Pattern**: Relay server events → EventEmitter → SSE endpoint → EventSource → Zustand store
- **Dual Dispatch**: Local (direct provider SSE) vs relay (WebSocket → SSE bridge)
- **Provider Abstraction**: Pluggable adapters in `server/lib/providers/`
- **Context Assembly**: Vision doc + dependency context injection per task

## Prerequisites

- Node.js 25.6.0 or higher (managed via `.nvmrc`)
- npm 11.8.0 or higher
- Redis (for production deployment)
- Git

## Getting Started

### Installation

```bash
# Clone the repository
git clone git@github.com:fuxialexander/nexus.git
cd nexus

# Install dependencies
npm install
```

### Development

Run both frontend and backend in development mode:

```bash
npm run dev
```

Or run them separately:

```bash
# Terminal 1 - Frontend (Vite dev server on port 5173)
npm run dev:frontend

# Terminal 2 - Backend (Hono server on port 3001)
npm run dev:backend
```

### Building for Production

```bash
npm run build
```

This will:
1. Compile TypeScript files
2. Build the frontend with Vite
3. Output production files to `dist/`

### Deployment

Deploy to Cloudflare Pages:

```bash
npm run deploy
```

## Project Structure

```
nexus/
├── src/                      # Frontend React application
│   ├── components/           # React components
│   ├── pages/               # Route pages
│   ├── lib/                 # Client utilities
│   └── stores/              # Zustand state stores
├── server/                   # Backend Hono application
│   ├── routes/              # API routes
│   ├── lib/                 # Server utilities
│   │   ├── providers/       # Execution provider adapters
│   │   ├── dispatch/        # Task dispatch engine
│   │   └── slurm/          # HPC cluster management
├── packages/                 # Monorepo packages
├── tests/                    # Test files
├── docs/                     # Documentation
└── public/                   # Static assets
```

## Key Files

- `server/routes/events.ts` - SSE bridge for real-time events
- `server/routes/device-auth.ts` - OAuth2 device authentication flow
- `server/lib/event-buffer.ts` - Ring buffer for connection replay
- `server/lib/providers/` - Provider adapters (Claude Code, Codex, SLURM)
- `server/lib/dispatch/` - Dispatch engine and queue management
- `src/lib/realtime-client.ts` - EventSource wrapper for client
- `src/stores/realtime-store.ts` - Real-time state management
- `src/pages/task-detail.tsx` - Task execution detail view
- `src/pages/environments.tsx` - Machine/environment management

## Development Guidelines

### Code Style

- Follow the ESLint configuration
- Use TypeScript strict mode
- Prefer functional components with hooks
- Use Zustand for global state management
- Use Tailwind CSS for styling (v4 with Vite plugin)

### Git Workflow

1. Create a feature branch from `main`
2. Make your changes with clear, descriptive commits
3. Run linting: `npm run lint`
4. Submit a pull request

### Testing

```bash
# Run tests (when available)
npm test
```

## Known Issues & Gotchas

- Pre-existing lint errors in `packages/agent-runner` - do not attempt to fix
- `@radix-ui/react-tabs` must be installed separately
- Tailwind v4 uses `@tailwindcss/vite` plugin (not PostCSS)
- React Router v7 uses `react-router` package (not `react-router-dom`)
- TaskNode data must include `executionId` for realtime progress tracking

## API Endpoints

### Authentication
- `POST /api/device/authorize` - Initiate device authentication
- `POST /api/device/token` - Exchange device code for token
- `POST /api/device/register` - Register new machine
- `POST /api/device/refresh` - Refresh access token
- `POST /api/device/revoke` - Revoke token

### Real-time Events
- `GET /api/events` - SSE stream for real-time updates

### Task Management
- Task CRUD endpoints (see API documentation)

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For questions or issues, please open an issue on GitHub or contact the development team.

## Acknowledgments

Built with:
- [React](https://react.dev/) - UI framework
- [Vite](https://vite.dev/) - Build tool
- [Hono](https://hono.dev/) - Web framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [React Flow](https://reactflow.dev/) - Graph visualization
- [Zustand](https://zustand-demo.pmnd.rs/) - State management
- [Anthropic Claude](https://www.anthropic.com/) - AI capabilities
