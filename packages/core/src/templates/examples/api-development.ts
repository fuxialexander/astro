/**
 * Example: REST/GraphQL API Development Template
 *
 * Demonstrates API-focused planning with OpenAPI/GraphQL schema design,
 * endpoint grouping, authentication middleware, and API testing strategies.
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const apiDevelopmentTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro/api-development',
  name: 'API Development',
  description:
    'Backend API development covering endpoint design, data models, authentication, validation, error handling, and comprehensive API testing. Supports REST with OpenAPI specification or GraphQL with schema-first design.',
  category: 'software-development',
  version: '1.0.0',
  icon: '🔌',
  tags: ['api', 'rest', 'graphql', 'backend', 'openapi'],
  maturity: 'stable',

  // ── Parameters ────────────────────────────────────────────────────────
  requiredParameters: [
    {
      id: 'apiName',
      name: 'API Name',
      description: 'Name for the API service (used in package name, docs, etc.)',
      type: 'string',
      required: true,
      placeholder: 'user-service-api',
      validation: {
        pattern: '^[a-z][a-z0-9-]*$',
        message: 'Lowercase with hyphens (e.g., user-service-api)',
      },
      group: 'basics',
      order: 0,
    },
    {
      id: 'apiDescription',
      name: 'API Description',
      description: 'What does this API do? What domain does it serve?',
      type: 'string',
      required: true,
      placeholder: 'User management API for authentication, profiles, and permissions',
      validation: { min: 20, max: 500 },
      group: 'basics',
      order: 1,
    },
    {
      id: 'apiStyle',
      name: 'API Style',
      description: 'Architecture style for the API',
      type: 'select',
      required: true,
      default: 'rest',
      options: [
        { label: 'REST', value: 'rest', description: 'RESTful API with OpenAPI 3.1 specification' },
        { label: 'GraphQL', value: 'graphql', description: 'GraphQL API with schema-first design' },
        { label: 'tRPC', value: 'trpc', description: 'End-to-end typesafe API with tRPC' },
        { label: 'gRPC', value: 'grpc', description: 'Protocol Buffers-based RPC API' },
      ],
      group: 'architecture',
      order: 0,
    },
  ],

  optionalParameters: [
    {
      id: 'framework',
      name: 'Backend Framework',
      description: 'Framework for implementing the API',
      type: 'select',
      required: false,
      default: 'hono',
      options: [
        { label: 'Hono', value: 'hono', description: 'Lightweight, edge-ready framework' },
        { label: 'Fastify', value: 'fastify', description: 'High-performance Node.js framework' },
        { label: 'Express', value: 'express', description: 'Classic Node.js framework' },
        { label: 'NestJS', value: 'nestjs', description: 'Enterprise TypeScript framework' },
      ],
      visibleWhen: {
        parameterId: 'apiStyle',
        operator: 'not-equals',
        value: 'grpc',
      },
      group: 'architecture',
      order: 1,
    },
    {
      id: 'database',
      name: 'Database',
      description: 'Primary data storage',
      type: 'select',
      required: false,
      default: 'postgres',
      options: [
        { label: 'PostgreSQL', value: 'postgres', description: 'With Drizzle ORM' },
        { label: 'MySQL', value: 'mysql', description: 'With Drizzle ORM' },
        { label: 'MongoDB', value: 'mongodb', description: 'With Mongoose' },
        { label: 'SQLite', value: 'sqlite', description: 'Embedded database' },
        { label: 'None', value: 'none', description: 'No database (external data source)' },
      ],
      group: 'architecture',
      order: 2,
    },
    {
      id: 'auth',
      name: 'Authentication',
      description: 'Authentication mechanism',
      type: 'select',
      required: false,
      default: 'jwt',
      options: [
        { label: 'JWT Bearer', value: 'jwt', description: 'Stateless JWT tokens' },
        { label: 'API Keys', value: 'apikey', description: 'Header-based API keys' },
        { label: 'OAuth 2.0', value: 'oauth', description: 'OAuth 2.0 with PKCE' },
        { label: 'None', value: 'none', description: 'Public API (no auth)' },
      ],
      group: 'security',
      order: 0,
    },
    {
      id: 'rateLimiting',
      name: 'Rate Limiting',
      description: 'Include rate limiting middleware?',
      type: 'boolean',
      required: false,
      default: true,
      group: 'security',
      order: 1,
    },
    {
      id: 'resources',
      name: 'API Resources',
      description: 'Comma-separated list of main resources/entities (e.g., users, posts, comments)',
      type: 'string',
      required: false,
      placeholder: 'users, posts, comments',
      group: 'design',
      order: 0,
    },
    {
      id: 'versioning',
      name: 'API Versioning',
      description: 'How to version the API',
      type: 'select',
      required: false,
      default: 'url',
      options: [
        { label: 'URL Path', value: 'url', description: '/v1/users, /v2/users' },
        { label: 'Header', value: 'header', description: 'Accept-Version header' },
        { label: 'None', value: 'none', description: 'No versioning' },
      ],
      group: 'design',
      order: 1,
    },
    {
      id: 'documentation',
      name: 'Documentation',
      description: 'API documentation approach',
      type: 'select',
      required: false,
      default: 'swagger',
      options: [
        { label: 'Swagger UI', value: 'swagger', description: 'Interactive Swagger UI' },
        { label: 'Redoc', value: 'redoc', description: 'Redoc API documentation' },
        { label: 'GraphQL Playground', value: 'playground', description: 'GraphQL Playground/Apollo Studio' },
        { label: 'None', value: 'none', description: 'No interactive docs' },
      ],
      group: 'documentation',
      order: 0,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────
  prompts: {
    planGeneration: `You are a senior backend engineer planning an API development project.

## API Specification
- Name: {{apiName}}
- Description: {{apiDescription}}
- Style: {{apiStyle}}
- Framework: {{framework}}
- Database: {{database}}
- Auth: {{auth}}
- Rate Limiting: {{rateLimiting}}
- Resources: {{resources}}
- Versioning: {{versioning}}
- Documentation: {{documentation}}

## Planning Guidelines

Decompose this API project into a DAG of tasks and milestones:

1. **Milestone Structure**:
   - API Foundation (project setup, schema/spec definition, database models)
   - Core Endpoints (CRUD operations for main resources)
   - Security & Middleware (auth, rate limiting, validation, error handling)
   - Testing & Documentation (API tests, OpenAPI/GraphQL docs)

2. **Task Granularity**:
   - Schema/spec definition as one task (OpenAPI spec or GraphQL schema)
   - Database models and migrations as one task
   - One task per resource group's endpoints (e.g., "User CRUD endpoints")
   - Auth middleware as a dedicated task
   - Validation and error handling as a separate task
   - Each test suite (unit, integration, e2e) as a separate task

3. **Parallelism**:
   - Schema and database tasks must complete before endpoint implementation
   - Different resource endpoints can be developed in parallel
   - Auth middleware can be developed in parallel with initial endpoints
   - Testing depends on implementation being complete
   - Documentation can start after schema is defined

4. **Labels**: Use l2=Backend for all API code, l3=Testing for test suites.

5. **Verification**: Use "auto" for endpoints with tests. Use "human" for schema design decisions.`,

    taskExecution: `You are implementing part of the {{apiName}} API.

Stack: {{apiStyle}} API using {{framework}}, {{database}} database, {{auth}} authentication.

Follow these API development standards:
- Define request/response schemas with Zod or TypeBox
- Use proper HTTP status codes (201 for create, 204 for delete, etc.)
- Return consistent error responses with error codes
- Log all requests with correlation IDs
- Validate all inputs before processing
- Use database transactions for multi-step operations
- Write OpenAPI/GraphQL documentation inline with code

Error response format:
\`\`\`json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "User with ID 123 not found",
    "details": {}
  }
}
\`\`\``,

    sharedContext: `API development best practices:
- Use plural nouns for REST resource names (/users, not /user)
- Use HTTP methods semantically (GET=read, POST=create, PUT=replace, PATCH=update, DELETE=remove)
- Include pagination for list endpoints (limit, offset, cursor)
- Support filtering and sorting where appropriate
- Return Location header for created resources
- Use ETags for caching and optimistic concurrency
- Document all endpoints with request/response examples`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'free',
    description: 'API code, schema definitions, tests, and documentation as file system changes.',
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
    maxTurns: 35,
    maxBudgetPerTask: 5.0,
    deliveryMode: 'pr',
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 6, max: 12 },
    defaultEstimate: 'S',
    suggestedMilestones: [
      { title: 'API Foundation', description: 'Project setup, schema definition, database models' },
      { title: 'Core Endpoints', description: 'CRUD operations for all resources' },
      { title: 'Security Complete', description: 'Auth, validation, rate limiting, error handling' },
      { title: 'API Ready', description: 'Tests passing, documentation complete' },
    ],
    commonLabels: ['l2', 'l3'],
    preferParallelTasks: true,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['web-development', 'data-engineering'],
  recommendedSkills: ['github'],
  source: 'builtin',
  enabled: true,
}
