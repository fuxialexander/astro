#!/usr/bin/env node
/**
 * Astro MCP Tools Server
 *
 * Provides comprehensive tools for Claude Agent SDK to interact with Astro platform:
 * - Plan management (create/update tasks, dependencies, query)
 * - Project management (create/update/query projects)
 * - Initiative management (create/update/query initiatives)
 * - Data access (user profile, executions, sessions)
 * - User interaction (ask questions, approvals)
 */

import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// ────────────────────────────────────────────────────────────────────────────
// HTTP Client for Astro API
// ────────────────────────────────────────────────────────────────────────────

const serverUrl = process.env.ASTRO_SERVER_URL || 'http://localhost:3001'
const authToken = process.env.ASTRO_AUTH_TOKEN || ''
const executionId = process.env.ASTRO_EXECUTION_ID || ''
const projectId = process.env.ASTRO_PROJECT_ID || ''
const nodeId = process.env.ASTRO_NODE_ID || ''

/**
 * Make authenticated HTTP request to Astro API
 */
async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `API request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

// ────────────────────────────────────────────────────────────────────────────
// MCP Server Definition
// ────────────────────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'astro-tools',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// ────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ────────────────────────────────────────────────────────────────────────────

const TOOLS = [
  // ── User Interaction ──────────────────────────────────────────────────────
  {
    name: 'ask_user_question',
    description:
      'Ask the user a clarifying question when you need to make a decision with multiple valid approaches. ' +
      'The user will see the question and options in the UI and select their preferred choice. ' +
      'Use this when: (1) Multiple implementation approaches are equally valid, (2) Architectural decisions depend on user preferences, ' +
      '(3) Trade-offs where user priorities matter. DO NOT use for questions you can research yourself or for standard best practices.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user (be clear and concise)',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 5,
          description: 'Array of 2-5 options for the user to choose from. Each should be a complete, self-contained choice.',
        },
      },
      required: ['question', 'options'],
    },
  },

  // ── Plan Management ───────────────────────────────────────────────────────
  {
    name: 'query_plan',
    description:
      'Query the plan graph for the current project. Returns all nodes (tasks) and edges (dependencies) in the plan. ' +
      'Use this to understand the current plan structure, check task statuses, and identify dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to query (optional, defaults to current project)',
        },
      },
    },
  },

  {
    name: 'create_task',
    description:
      'Create a new task node in the plan. Returns the created task with its assigned ID. ' +
      'Use this to add new tasks to the plan during execution.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title (concise, actionable)',
        },
        description: {
          type: 'string',
          description: 'Detailed task description',
        },
        type: {
          type: 'string',
          enum: ['task', 'milestone', 'branch', 'decision'],
          description: 'Task type (default: task)',
        },
        status: {
          type: 'string',
          enum: ['planned', 'dispatched', 'in_progress', 'auto_verified', 'awaiting_approval', 'awaiting_judgment', 'completed', 'pruned'],
          description: 'Task status (default: planned)',
        },
        parentId: {
          type: 'string',
          description: 'Parent task ID (optional)',
        },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of task IDs this task depends on',
        },
        verification: {
          type: 'string',
          enum: ['auto', 'human'],
          description: 'Verification method (default: auto)',
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'normal', 'low'],
          description: 'Task priority',
        },
        estimate: {
          type: 'string',
          enum: ['XS', 'S', 'M', 'L', 'XL'],
          description: 'Size estimate',
        },
        dueDate: {
          type: 'string',
          description: 'Due date (YYYY-MM-DD)',
        },
        projectId: {
          type: 'string',
          description: 'Project ID (optional, defaults to current project)',
        },
      },
      required: ['title', 'description'],
    },
  },

  {
    name: 'update_task',
    description:
      'Update an existing task in the plan. You can update any task properties including status, priority, dates, etc. ' +
      'Use this to mark tasks as completed, update estimates, change priorities, or modify task details.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'ID of the task to update',
        },
        title: {
          type: 'string',
          description: 'Updated task title',
        },
        description: {
          type: 'string',
          description: 'Updated task description',
        },
        status: {
          type: 'string',
          enum: ['planned', 'dispatched', 'in_progress', 'auto_verified', 'awaiting_approval', 'awaiting_judgment', 'completed', 'pruned'],
          description: 'Updated task status',
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'normal', 'low'],
          description: 'Updated priority',
        },
        estimate: {
          type: 'string',
          enum: ['XS', 'S', 'M', 'L', 'XL'],
          description: 'Updated size estimate',
        },
        verification: {
          type: 'string',
          enum: ['auto', 'human'],
          description: 'Updated verification method',
        },
        dueDate: {
          type: 'string',
          description: 'Updated due date (YYYY-MM-DD) or null to clear',
        },
        startDate: {
          type: 'string',
          description: 'Updated start date (YYYY-MM-DD) or null to clear',
        },
        endDate: {
          type: 'string',
          description: 'Updated end date (YYYY-MM-DD) or null to clear',
        },
      },
      required: ['taskId'],
    },
  },

  {
    name: 'create_dependency',
    description:
      'Create a dependency edge between two tasks. Task B depends on Task A means B cannot start until A completes. ' +
      'Use this to establish task ordering and dependencies in the plan.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceTaskId: {
          type: 'string',
          description: 'ID of the task that must complete first (dependency)',
        },
        targetTaskId: {
          type: 'string',
          description: 'ID of the task that depends on the source',
        },
        type: {
          type: 'string',
          enum: ['dependency', 'branch'],
          description: 'Edge type (default: dependency)',
        },
        projectId: {
          type: 'string',
          description: 'Project ID (optional, defaults to current project)',
        },
      },
      required: ['sourceTaskId', 'targetTaskId'],
    },
  },

  {
    name: 'delete_task',
    description:
      'Delete a task from the plan. This will also delete all edges connected to this task. ' +
      'Use with caution - this cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'ID of the task to delete',
        },
      },
      required: ['taskId'],
    },
  },

  // ── Project Management ────────────────────────────────────────────────────
  {
    name: 'query_projects',
    description:
      'Query all projects accessible to the current user. Returns project details including status, health, progress, and metadata. ' +
      'Use this to discover projects, check project status, or find related work.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'get_project',
    description:
      'Get detailed information about a specific project including its vision document, status, health, and configuration. ' +
      'Use this to understand project context, goals, and setup.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to retrieve (optional, defaults to current project)',
        },
      },
    },
  },

  {
    name: 'create_project',
    description:
      'Create a new project. Returns the created project with its assigned ID. ' +
      'Use this when you need to organize work into a new project scope.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Project name (concise, descriptive)',
        },
        description: {
          type: 'string',
          description: 'Project description',
        },
        visionDoc: {
          type: 'string',
          description: 'Vision document (markdown, describes goals and context)',
        },
        status: {
          type: 'string',
          enum: ['active', 'archived'],
          description: 'Project status (default: active)',
        },
        workingDirectory: {
          type: 'string',
          description: 'Working directory or repository URL',
        },
        initiativeId: {
          type: 'string',
          description: 'Initiative ID to group this project under',
        },
      },
      required: ['name', 'description'],
    },
  },

  {
    name: 'update_project',
    description:
      'Update an existing project. You can update any project properties including name, description, vision, status, etc. ' +
      'Use this to maintain project metadata, update goals, or change configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to update (optional, defaults to current project)',
        },
        name: {
          type: 'string',
          description: 'Updated project name',
        },
        description: {
          type: 'string',
          description: 'Updated project description',
        },
        visionDoc: {
          type: 'string',
          description: 'Updated vision document',
        },
        status: {
          type: 'string',
          enum: ['active', 'archived'],
          description: 'Updated project status',
        },
        health: {
          type: 'string',
          enum: ['on_track', 'at_risk', 'off_track'],
          description: 'Updated project health',
        },
        progress: {
          type: 'number',
          description: 'Updated progress percentage (0-100)',
        },
        workingDirectory: {
          type: 'string',
          description: 'Updated working directory or repository URL',
        },
      },
    },
  },

  // ── Initiative Management ─────────────────────────────────────────────────
  {
    name: 'query_initiatives',
    description:
      'Query all initiatives accessible to the current user. Initiatives group related projects together. ' +
      'Use this to discover initiatives or find where to organize new projects.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'create_initiative',
    description:
      'Create a new initiative to group related projects. Returns the created initiative with its assigned ID. ' +
      'Use this to organize multiple related projects under a common goal.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Initiative name',
        },
        description: {
          type: 'string',
          description: 'Initiative description',
        },
        goal: {
          type: 'string',
          description: 'Initiative goal or objective',
        },
        status: {
          type: 'string',
          enum: ['active', 'on_hold', 'completed', 'cancelled'],
          description: 'Initiative status (default: active)',
        },
        lead: {
          type: 'string',
          description: 'Initiative lead (name or ID)',
        },
        color: {
          type: 'string',
          description: 'Color hex code for UI (default: #3b82f6)',
        },
      },
      required: ['name', 'description'],
    },
  },

  {
    name: 'update_initiative',
    description:
      'Update an existing initiative. You can update any initiative properties including name, description, status, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        initiativeId: {
          type: 'string',
          description: 'Initiative ID to update',
        },
        name: {
          type: 'string',
          description: 'Updated initiative name',
        },
        description: {
          type: 'string',
          description: 'Updated initiative description',
        },
        goal: {
          type: 'string',
          description: 'Updated initiative goal',
        },
        status: {
          type: 'string',
          enum: ['active', 'on_hold', 'completed', 'cancelled'],
          description: 'Updated initiative status',
        },
        lead: {
          type: 'string',
          description: 'Updated initiative lead',
        },
      },
      required: ['initiativeId'],
    },
  },

  // ── Data Access ───────────────────────────────────────────────────────────
  {
    name: 'get_user_profile',
    description:
      'Get the current user profile including name, email, domains of expertise, experience level, and preferences. ' +
      'Use this to understand user context and tailor your work accordingly.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'query_executions',
    description:
      'Query execution history. Returns information about past task executions including status, output, metrics, and timestamps. ' +
      'Use this to learn from previous executions or understand execution patterns.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ── Knowledge Store ──────────────────────────────────────────────────────
  {
    name: 'store_knowledge',
    description:
      'Store a key piece of knowledge that other tasks in this project would benefit from knowing. ' +
      'Use semantic keys like db_schema, api_endpoints, architecture_decisions, blockers. ' +
      'Value should be concise (under 2000 chars) factual information. ' +
      'If a key already exists for this project, the value will be updated.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            'Semantic key for this knowledge entry (e.g., db_schema, api_endpoints, architecture_decisions, blockers, tech_stack)',
        },
        value: {
          type: 'string',
          description:
            'The knowledge content to store. Should be concise (under 2000 chars), factual, and useful for other tasks.',
        },
      },
      required: ['key', 'value'],
    },
  },

  {
    name: 'query_knowledge',
    description:
      'Query all stored knowledge entries for the current project. Returns key-value pairs of knowledge ' +
      'previously stored by any task in this project. Use this at the start of your work to check what ' +
      'is already known about the project (architecture, schemas, decisions, blockers, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to query (optional, defaults to current project)',
        },
      },
    },
  },
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}))

// ────────────────────────────────────────────────────────────────────────────
// Tool Handlers
// ────────────────────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name
  const args = request.params.arguments as Record<string, unknown>

  try {
    // ── User Interaction ────────────────────────────────────────────────────
    if (toolName === 'ask_user_question') {
      const { question, options } = args as { question: string; options: string[] }

      if (!question || typeof question !== 'string') {
        throw new Error('question must be a non-empty string')
      }

      if (!Array.isArray(options) || options.length < 2 || options.length > 5) {
        throw new Error('options must be an array of 2-5 strings')
      }

      if (!executionId) {
        throw new Error('Execution ID not provided by server')
      }

      const selectedOption = await apiRequest<{ selectedOption: string }>(
        'POST',
        '/api/dispatch/request-dynamic-approval',
        { executionId, question, options }
      )

      return {
        content: [
          {
            type: 'text',
            text: `User selected: ${selectedOption.selectedOption}`,
          },
        ],
      }
    }

    // ── Plan Management ─────────────────────────────────────────────────────
    if (toolName === 'query_plan') {
      const targetProjectId = (args.projectId as string) || projectId
      if (!targetProjectId) {
        throw new Error('No project ID available. Specify projectId or ensure ASTRO_PROJECT_ID is set.')
      }

      const plan = await apiRequest<{ nodes: unknown[]; edges: unknown[] }>(
        'GET',
        `/api/data/plan/${targetProjectId}`
      )

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(plan, null, 2),
          },
        ],
      }
    }

    if (toolName === 'create_task') {
      const targetProjectId = (args.projectId as string) || projectId
      if (!targetProjectId) {
        throw new Error('No project ID available. Specify projectId or ensure ASTRO_PROJECT_ID is set.')
      }

      const nodeId = randomUUID()

      const taskData = {
        id: nodeId,
        projectId: targetProjectId,
        type: args.type || 'task',
        title: args.title,
        description: args.description,
        status: args.status || 'planned',
        parentId: args.parentId || null,
        verification: args.verification || 'auto',
        priority: args.priority || null,
        estimate: args.estimate || null,
        dueDate: args.dueDate || null,
        position: { x: 0, y: 0 }, // Default position, UI will auto-layout
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await apiRequest('POST', '/api/data/plan/nodes', taskData)

      // Create dependency edges if specified
      if (Array.isArray(args.dependencies) && args.dependencies.length > 0) {
        for (const depId of args.dependencies) {
          const edgeId = randomUUID()
          await apiRequest('POST', '/api/data/plan/edges', {
            id: edgeId,
            projectId: targetProjectId,
            source: depId,
            target: nodeId,
            type: 'dependency',
          })
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Task created successfully with ID: ${nodeId}`,
          },
        ],
      }
    }

    if (toolName === 'update_task') {
      const { taskId, ...updates } = args

      if (!taskId) {
        throw new Error('taskId is required')
      }

      await apiRequest('PATCH', `/api/data/plan/nodes/${taskId}`, updates)

      return {
        content: [
          {
            type: 'text',
            text: `Task ${taskId} updated successfully`,
          },
        ],
      }
    }

    if (toolName === 'create_dependency') {
      const targetProjectId = (args.projectId as string) || projectId
      if (!targetProjectId) {
        throw new Error('No project ID available. Specify projectId or ensure ASTRO_PROJECT_ID is set.')
      }

      const edgeId = randomUUID()

      await apiRequest('POST', '/api/data/plan/edges', {
        id: edgeId,
        projectId: targetProjectId,
        source: args.sourceTaskId,
        target: args.targetTaskId,
        type: args.type || 'dependency',
      })

      return {
        content: [
          {
            type: 'text',
            text: `Dependency created: ${args.sourceTaskId} → ${args.targetTaskId}`,
          },
        ],
      }
    }

    if (toolName === 'delete_task') {
      const { taskId } = args

      if (!taskId) {
        throw new Error('taskId is required')
      }

      await apiRequest('DELETE', `/api/data/plan/nodes/${taskId}`)

      return {
        content: [
          {
            type: 'text',
            text: `Task ${taskId} deleted successfully`,
          },
        ],
      }
    }

    // ── Project Management ──────────────────────────────────────────────────
    if (toolName === 'query_projects') {
      const projects = await apiRequest<unknown[]>('GET', '/api/data/projects')

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(projects, null, 2),
          },
        ],
      }
    }

    if (toolName === 'get_project') {
      const targetProjectId = (args.projectId as string) || projectId
      if (!targetProjectId) {
        throw new Error('No project ID available. Specify projectId or ensure ASTRO_PROJECT_ID is set.')
      }

      const project = await apiRequest<unknown>('GET', `/api/data/projects/${targetProjectId}`)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(project, null, 2),
          },
        ],
      }
    }

    if (toolName === 'create_project') {
      const projectIdNew = crypto.randomUUID()

      const projectData = {
        id: projectIdNew,
        name: args.name,
        description: args.description,
        visionDoc: args.visionDoc || '',
        status: args.status || 'active',
        workingDirectory: args.workingDirectory || null,
        initiativeId: args.initiativeId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const created = await apiRequest<unknown>('POST', '/api/data/projects', projectData)

      return {
        content: [
          {
            type: 'text',
            text: `Project created successfully with ID: ${projectIdNew}\n\n${JSON.stringify(created, null, 2)}`,
          },
        ],
      }
    }

    if (toolName === 'update_project') {
      const targetProjectId = (args.projectId as string) || projectId
      if (!targetProjectId) {
        throw new Error('No project ID available. Specify projectId or ensure ASTRO_PROJECT_ID is set.')
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { projectId: _, ...updates } = args

      await apiRequest('PATCH', `/api/data/projects/${targetProjectId}`, updates)

      return {
        content: [
          {
            type: 'text',
            text: `Project ${targetProjectId} updated successfully`,
          },
        ],
      }
    }

    // ── Initiative Management ───────────────────────────────────────────────
    if (toolName === 'query_initiatives') {
      const initiatives = await apiRequest<unknown[]>('GET', '/api/data/initiatives')

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(initiatives, null, 2),
          },
        ],
      }
    }

    if (toolName === 'create_initiative') {
      const initiativeId = crypto.randomUUID()

      const initiativeData = {
        id: initiativeId,
        name: args.name,
        description: args.description,
        goal: args.goal || null,
        status: args.status || 'active',
        lead: args.lead || null,
        color: args.color || '#3b82f6',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const created = await apiRequest<unknown>('POST', '/api/data/initiatives', initiativeData)

      return {
        content: [
          {
            type: 'text',
            text: `Initiative created successfully with ID: ${initiativeId}\n\n${JSON.stringify(created, null, 2)}`,
          },
        ],
      }
    }

    if (toolName === 'update_initiative') {
      const { initiativeId, ...updates } = args

      if (!initiativeId) {
        throw new Error('initiativeId is required')
      }

      await apiRequest('PATCH', `/api/data/initiatives/${initiativeId}`, updates)

      return {
        content: [
          {
            type: 'text',
            text: `Initiative ${initiativeId} updated successfully`,
          },
        ],
      }
    }

    // ── Data Access ─────────────────────────────────────────────────────────
    if (toolName === 'get_user_profile') {
      const profile = await apiRequest<unknown>('GET', '/api/data/profile')

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(profile, null, 2),
          },
        ],
      }
    }

    if (toolName === 'query_executions') {
      const executions = await apiRequest<unknown>('GET', '/api/data/executions')

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(executions, null, 2),
          },
        ],
      }
    }

    // ── Knowledge Store ─────────────────────────────────────────────────────
    if (toolName === 'store_knowledge') {
      const targetProjectId = projectId
      if (!targetProjectId) {
        throw new Error('No project ID available. Ensure ASTRO_PROJECT_ID is set.')
      }

      const { key, value } = args as { key: string; value: string }

      if (!key || typeof key !== 'string') {
        throw new Error('key must be a non-empty string')
      }
      if (!value || typeof value !== 'string') {
        throw new Error('value must be a non-empty string')
      }
      if (value.length > 2000) {
        throw new Error(`Value too long (${value.length} chars). Keep it under 2000 characters.`)
      }

      const entry = {
        id: randomUUID(),
        projectId: targetProjectId,
        key,
        value,
        sourceNodeId: nodeId || null,
        sourceExecutionId: executionId || null,
      }

      await apiRequest('POST', '/api/data/knowledge', entry)

      return {
        content: [
          {
            type: 'text',
            text: `Knowledge stored: "${key}" (${value.length} chars)`,
          },
        ],
      }
    }

    if (toolName === 'query_knowledge') {
      const targetProjectId = (args.projectId as string) || projectId
      if (!targetProjectId) {
        throw new Error('No project ID available. Specify projectId or ensure ASTRO_PROJECT_ID is set.')
      }

      const entries = await apiRequest<Array<{ key: string; value: string; sourceNodeId: string | null; updatedAt: string }>>(
        'GET',
        `/api/data/knowledge?projectId=${encodeURIComponent(targetProjectId)}`
      )

      if (!Array.isArray(entries) || entries.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No knowledge entries found for this project.',
            },
          ],
        }
      }

      // Format as a readable summary
      const formatted = entries.map((e) =>
        `## ${e.key}\n${e.value}\n(updated: ${e.updatedAt}${e.sourceNodeId ? `, from task: ${e.sourceNodeId}` : ''})`
      ).join('\n\n')

      return {
        content: [
          {
            type: 'text',
            text: `Found ${entries.length} knowledge entries:\n\n${formatted}`,
          },
        ],
      }
    }

    // Unknown tool
    throw new Error(`Unknown tool: ${toolName}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    }
  }
})

// ────────────────────────────────────────────────────────────────────────────
// Server Startup
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Astro MCP Tools Server v2.0 running on stdio')
  console.error(`  Server URL: ${serverUrl}`)
  console.error(`  Auth: ${authToken ? 'Configured' : 'Not configured'}`)
  console.error(`  Execution ID: ${executionId || 'Not set'}`)
  console.error(`  Project ID: ${projectId || 'Not set'}`)
  console.error(`  Node ID: ${nodeId || 'Not set'}`)
  console.error(`  Tools available: ${TOOLS.length}`)
}

// Only run if executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Server error:', error)
    process.exit(1)
  })
}

export { server }
