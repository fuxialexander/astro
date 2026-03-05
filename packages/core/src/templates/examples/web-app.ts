/**
 * Example: Web Application Development Template
 *
 * A full-featured example demonstrating all schema capabilities for a
 * typical web application project (React + Node.js backend).
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const webAppTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro--web-app',
  name: 'Web Application',
  description:
    'Full-stack web application development with frontend (React/Vue/Svelte), backend API, database integration, and deployment configuration. Generates a plan covering UI components, API endpoints, data models, authentication, testing, and CI/CD setup.',
  category: 'software-development',
  version: '1.0.0',
  icon: '🌐',
  tags: ['web', 'fullstack', 'react', 'api', 'database'],
  maturity: 'stable',

  // ── Parameters ────────────────────────────────────────────────────────
  requiredParameters: [
    {
      id: 'appName',
      name: 'Application Name',
      description: 'Name of the web application (used for project directory, package.json, etc.)',
      type: 'string',
      required: true,
      placeholder: 'my-awesome-app',
      validation: {
        pattern: '^[a-z][a-z0-9-]*$',
        message: 'Must be lowercase with hyphens (e.g., my-app)',
      },
      group: 'basics',
      order: 0,
    },
    {
      id: 'appDescription',
      name: 'Application Description',
      description: 'Brief description of what the application does and who it serves',
      type: 'string',
      required: true,
      placeholder: 'A project management dashboard for small teams',
      validation: { min: 20, max: 500, message: 'Provide a meaningful description (20-500 chars)' },
      group: 'basics',
      order: 1,
    },
    {
      id: 'framework',
      name: 'Frontend Framework',
      description: 'UI framework for the frontend',
      type: 'select',
      required: true,
      default: 'react',
      options: [
        { label: 'React', value: 'react', description: 'React 19 with hooks and TypeScript' },
        { label: 'Vue', value: 'vue', description: 'Vue 3 with Composition API and TypeScript' },
        { label: 'Svelte', value: 'svelte', description: 'SvelteKit with TypeScript' },
        { label: 'Next.js', value: 'nextjs', description: 'Next.js 15 with App Router' },
      ],
      group: 'stack',
      order: 0,
    },
  ],

  optionalParameters: [
    {
      id: 'backend',
      name: 'Backend Framework',
      description: 'Server-side framework for API endpoints',
      type: 'select',
      required: false,
      default: 'hono',
      options: [
        { label: 'Hono', value: 'hono', description: 'Lightweight, fast web framework for edge and Node.js' },
        { label: 'Express', value: 'express', description: 'Classic Node.js web framework' },
        { label: 'Fastify', value: 'fastify', description: 'High-performance Node.js web framework' },
        { label: 'tRPC', value: 'trpc', description: 'End-to-end typesafe APIs' },
      ],
      group: 'stack',
      order: 1,
    },
    {
      id: 'database',
      name: 'Database',
      description: 'Primary database for persistent storage',
      type: 'select',
      required: false,
      default: 'postgres',
      options: [
        { label: 'PostgreSQL', value: 'postgres', description: 'Relational database with Drizzle ORM' },
        { label: 'SQLite', value: 'sqlite', description: 'Embedded database with Drizzle ORM' },
        { label: 'MongoDB', value: 'mongodb', description: 'Document database with Mongoose' },
        { label: 'None', value: 'none', description: 'No database (stateless API or external data source)' },
      ],
      group: 'stack',
      order: 2,
    },
    {
      id: 'auth',
      name: 'Authentication',
      description: 'Authentication strategy',
      type: 'select',
      required: false,
      default: 'session',
      options: [
        { label: 'Session-based', value: 'session', description: 'Server-side sessions with cookies' },
        { label: 'JWT', value: 'jwt', description: 'JSON Web Tokens (stateless)' },
        { label: 'OAuth', value: 'oauth', description: 'OAuth 2.0 with social providers' },
        { label: 'None', value: 'none', description: 'No authentication (public app)' },
      ],
      group: 'features',
      order: 0,
    },
    {
      id: 'styling',
      name: 'Styling Approach',
      description: 'CSS framework or methodology',
      type: 'select',
      required: false,
      default: 'tailwind',
      options: [
        { label: 'Tailwind CSS', value: 'tailwind', description: 'Utility-first CSS framework' },
        { label: 'CSS Modules', value: 'css-modules', description: 'Scoped CSS with module syntax' },
        { label: 'Styled Components', value: 'styled', description: 'CSS-in-JS with tagged template literals' },
      ],
      group: 'features',
      order: 1,
    },
    {
      id: 'testing',
      name: 'Testing Strategy',
      description: 'Level of test coverage to include in the plan',
      type: 'select',
      required: false,
      default: 'standard',
      options: [
        { label: 'Standard', value: 'standard', description: 'Unit tests + integration tests for key flows' },
        { label: 'Comprehensive', value: 'comprehensive', description: 'Unit + integration + E2E tests' },
        { label: 'Minimal', value: 'minimal', description: 'Only critical path tests' },
      ],
      group: 'quality',
      order: 0,
    },
    {
      id: 'deployment',
      name: 'Deployment Target',
      description: 'Where the application will be deployed',
      type: 'select',
      required: false,
      default: 'docker',
      options: [
        { label: 'Docker', value: 'docker', description: 'Containerized deployment with Dockerfile' },
        { label: 'Vercel', value: 'vercel', description: 'Serverless deployment on Vercel' },
        { label: 'Fly.io', value: 'fly', description: 'Edge deployment on Fly.io' },
        { label: 'Manual', value: 'manual', description: 'No deployment config (deploy manually)' },
      ],
      group: 'quality',
      order: 1,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────
  prompts: {
    planGeneration: `You are a senior full-stack engineer planning a web application project.

## Project Specification
- Application: {{appName}} — {{appDescription}}
- Frontend: {{framework}}
- Backend: {{backend}}
- Database: {{database}}
- Authentication: {{auth}}
- Styling: {{styling}}
- Testing: {{testing}}
- Deployment: {{deployment}}

## Planning Guidelines

Decompose this project into a DAG of tasks and milestones. Follow these principles:

1. **Milestone Structure**: Create 2-4 milestones reflecting natural development phases:
   - Foundation (project setup, config, data models)
   - Core Features (main UI + API endpoints)
   - Quality & Polish (testing, error handling, performance)
   - Deployment (CI/CD, containerization, documentation)

2. **Task Granularity**: Each task should be ~20 minutes of expert work, touching a single concern:
   - One API endpoint or route group per task
   - One UI page or component group per task
   - Database schema and migrations as a separate task
   - Auth setup as a dedicated task

3. **Parallelism**: Frontend and backend tasks at the same feature level can run in parallel.
   Testing tasks depend on the features they test. Deployment depends on all features.

4. **Labels**: Use l1=Frontend, l2=Backend, l3=Testing, l4=Infrastructure.

5. **Verification**: Use "auto" for tasks with testable outputs (API endpoints, components with tests).
   Use "human" for design/UX decisions and architecture choices.`,

    taskExecution: `You are implementing part of a web application called {{appName}}.

Tech stack: {{framework}} frontend, {{backend}} backend, {{database}} database, {{styling}} styling.

Follow these standards:
- Write TypeScript with strict types (no \`any\`)
- Use functional components and hooks (React) or Composition API (Vue)
- Follow the repository's existing code style and patterns
- Write tests alongside implementation when the test framework is set up
- Use meaningful commit messages

If you encounter a design decision not covered by the project spec, make the simplest choice that works and document it in a code comment.`,

    sharedContext: `This is a modern web application project. Prefer:
- ES modules over CommonJS
- Async/await over callbacks
- Type safety over convenience
- Composition over inheritance
- Small, focused functions over large ones`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'free',
    description: 'Tasks produce code files, configuration, and documentation as standard file system changes.',
  },

  // ── Parallelization ───────────────────────────────────────────────────
  parallelization: {
    maxConcurrentTasks: 3,
    autoDispatch: true,
    defaultPriority: 'normal',
    retry: {
      maxRetries: 2,
      retryDelayMs: 5000,
      exponentialBackoff: true,
    },
    machineSelectionPolicy: 'priority',
  },

  // ── Execution ─────────────────────────────────────────────────────────
  execution: {
    maxTurns: 30,
    maxBudgetPerTask: 5.0,
    deliveryMode: 'pr',
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 8, max: 15 },
    defaultEstimate: 'S',
    suggestedMilestones: [
      { title: 'Project Foundation', description: 'Project scaffolding, config, and data models' },
      { title: 'Core Features', description: 'Main UI pages and API endpoints' },
      { title: 'Quality & Testing', description: 'Test coverage, error handling, and polish' },
      { title: 'Deployment Ready', description: 'CI/CD, Docker, and documentation' },
    ],
    commonLabels: ['l1', 'l2', 'l3', 'l4'],
    preferParallelTasks: true,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['web-development'],
  recommendedSkills: ['github'],
  source: 'builtin',
  enabled: true,
}
