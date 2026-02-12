# Contributing to Nexus

Thank you for your interest in contributing to Nexus! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and collaborative environment. Be kind, constructive, and professional in all interactions.

## Getting Started

### Prerequisites

- Node.js 25.6.0 or higher (use `nvm` or check `.nvmrc`)
- npm 11.8.0 or higher
- Git
- A code editor (VS Code recommended)

### Initial Setup

1. **Fork and Clone**

   ```bash
   git clone git@github.com:YOUR_USERNAME/nexus.git
   cd nexus
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Create a Branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

4. **Start Development Server**

   ```bash
   npm run dev
   ```

   This starts both frontend (port 5173) and backend (port 3001) in watch mode.

## Development Workflow

### Project Structure

- **`src/`** - React frontend application
  - `components/` - Reusable UI components
  - `pages/` - Route page components
  - `lib/` - Client-side utilities
  - `stores/` - Zustand state management stores

- **`server/`** - Hono backend application
  - `routes/` - API endpoint handlers
  - `lib/providers/` - Execution provider adapters
  - `lib/dispatch/` - Task dispatch engine
  - `lib/slurm/` - HPC cluster management

- **`tests/`** - Test files

- **`packages/`** - Monorepo packages

### Key Patterns

1. **SSE Bridge Pattern**: Server events flow through EventEmitter → SSE endpoint → EventSource → Zustand store

2. **Provider Abstraction**: All execution providers implement a common interface in `server/lib/providers/`

3. **State Management**: Use Zustand stores for global state, React state for local component state

4. **Real-time Updates**: EventSource handles reconnection automatically; use `Last-Event-ID` for event replay

### Running Different Modes

```bash
# Run both frontend and backend
npm run dev

# Run only frontend
npm run dev:frontend

# Run only backend
npm run dev:backend

# Run linter
npm run lint

# Build for production
npm run build
```

## Coding Standards

### TypeScript

- Use TypeScript strict mode
- Prefer explicit types over `any`
- Use interfaces for object shapes
- Use type aliases for unions and complex types
- Export types/interfaces that are used across modules

### React

- Use functional components with hooks
- Prefer composition over inheritance
- Keep components small and focused
- Use meaningful component and prop names
- Destructure props in function parameters

Example:

```typescript
interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export function Button({ label, onClick, variant = 'primary' }: ButtonProps) {
  // Component implementation
}
```

### Styling

- Use Tailwind CSS utility classes (v4 with Vite plugin)
- Follow the existing design system in `src/components/ui/`
- Use `cn()` helper from `src/lib/utils` for conditional classes
- Avoid inline styles unless absolutely necessary

### State Management

- Use Zustand for global state
- Keep stores focused and single-purpose
- Use selectors to prevent unnecessary re-renders
- Document store structure and update patterns

### File Naming

- Components: `kebab-case.tsx` (e.g., `board-card.tsx`, `plan-canvas.tsx`)
- Utilities: `kebab-case.ts` (e.g., `date-utils.ts`, `graph-utils.ts`)
- Stores: `kebab-case-store.ts` (e.g., `realtime-store.ts`)
- Pages: `kebab-case.tsx` (e.g., `task-detail.tsx`, `plan-view.tsx`)

## Commit Guidelines

We follow conventional commit format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, missing semi-colons, etc.)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **chore**: Maintenance tasks (dependencies, build config, etc.)
- **ci**: CI/CD changes

### Examples

```bash
feat(dispatch): add SLURM provider adapter

Implement SLURM job submission and monitoring for HPC clusters.
Includes SBATCH script generation and job status polling.

Closes #42
```

```bash
fix(sse): handle reconnection with event replay

Use Last-Event-ID header to replay missed events after reconnection.
Prevents state inconsistencies in the UI.
```

## Pull Request Process

1. **Update Your Branch**

   ```bash
   git checkout main
   git pull origin main
   git checkout your-feature-branch
   git rebase main
   ```

2. **Run Linting**

   ```bash
   npm run lint
   ```

3. **Push Your Changes**

   ```bash
   git push origin your-feature-branch
   ```

4. **Create Pull Request**

   - Use the PR template
   - Link related issues
   - Add screenshots for UI changes
   - Request review from maintainers

5. **Address Review Comments**

   - Make requested changes
   - Push additional commits
   - Re-request review when ready

6. **Merge**

   - Maintainers will merge after approval
   - Delete your branch after merge

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Self-reviewed the code
- [ ] Added/updated comments for complex logic
- [ ] Updated documentation if needed
- [ ] No new warnings or errors
- [ ] Tested locally
- [ ] Added screenshots for UI changes

## Testing

### Writing Tests

- Place tests in the `tests/` directory
- Use descriptive test names
- Test edge cases and error conditions
- Mock external dependencies

### Running Tests

```bash
# Integration tests for relay server
npx tsx server/test/relay-server.test.ts

# Linting (primary code quality check)
npm run lint
```

> Note: A formal test framework is not yet configured. Use `npm run lint` and `npm run build` to verify correctness.

## Documentation

### Code Comments

- Document complex algorithms and business logic
- Explain "why" not "what" (code shows what)
- Keep comments up to date with code changes
- Use JSDoc for public APIs

### README and Docs

- Update README.md for new features
- Add documentation in `docs/` for complex topics
- Include examples and usage patterns
- Keep architecture diagrams current

## Known Issues and Gotcas

Please be aware of these existing issues:

- Pre-existing lint errors in `packages/agent-runner` - do not attempt to fix
- `@radix-ui/react-tabs` needs separate installation
- Tailwind v4 uses `@tailwindcss/vite` plugin (not PostCSS)
- React Router v7 uses `react-router` package (not `react-router-dom`)
- TaskNode data must include `executionId` for realtime progress tracking

## Questions?

- Open a discussion on GitHub
- Review existing issues and PRs
- Check documentation in `docs/`

Thank you for contributing to Nexus!
