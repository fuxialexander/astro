/**
 * astro_run_task tool
 *
 * Dispatches a plan task for execution by calling
 * POST /api/dispatch/task on the Astro backend.
 *
 * The Astro dispatch system routes the task through its queue → machine
 * selection → agent runner execution pipeline.
 *
 * Gateway method: astro.dispatch.task
 */

import type { AstroClient } from '../client.js';
import type { OpenClawToolDefinition, OpenClawToolResult } from '../types.js';

// ── API response shape ────────────────────────────────────────────────────────

export interface DispatchTaskResponse {
  executionId: string;
  nodeId: string;
  projectId: string;
  status: 'dispatched' | 'queued' | string;
  message?: string;
}

// ── Input type ────────────────────────────────────────────────────────────────

export interface RunTaskInput {
  nodeId: string;
  projectId: string;
  title?: string;
  description?: string;
  visionDoc?: string;
  dependencies?: string[];
  verification?: 'auto' | 'human';
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const runTaskToolDef: OpenClawToolDefinition = {
  name: 'astro_run_task',
  description:
    'Dispatch an Astro plan task for execution on a registered agent runner. ' +
    'Returns an executionId that can be used with astro_task_status to poll for results. ' +
    'The task must already exist as a plan node in the specified project.',
  inputSchema: {
    type: 'object',
    required: ['nodeId', 'projectId'],
    properties: {
      nodeId: {
        type: 'string',
        description: 'UUID of the plan node (task) to execute.',
      },
      projectId: {
        type: 'string',
        description: 'UUID of the project the task belongs to.',
      },
      title: {
        type: 'string',
        description: 'Task title override. If omitted, the stored node title is used.',
      },
      description: {
        type: 'string',
        description: 'Task description / instructions override.',
      },
      visionDoc: {
        type: 'string',
        description:
          'Vision document content to inject into the agent context. ' +
          'Overrides the project-level vision doc when provided.',
      },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of upstream node IDs whose outputs should be injected as context.',
      },
      verification: {
        type: 'string',
        enum: ['auto', 'human'],
        description:
          '"auto" — task is auto-closed if verifiable (tests pass/build succeeds). ' +
          '"human" — task waits for manual approval. Defaults to the node\'s stored setting.',
      },
    },
    additionalProperties: false,
  },
};

// ── Tool handler ──────────────────────────────────────────────────────────────

export async function runTask(
  client: AstroClient,
  input: RunTaskInput,
): Promise<OpenClawToolResult> {
  if (!input.nodeId?.trim()) {
    return {
      content: [{ type: 'text', text: 'Error: nodeId is required and must be non-empty.' }],
      isError: true,
    };
  }
  if (!input.projectId?.trim()) {
    return {
      content: [{ type: 'text', text: 'Error: projectId is required and must be non-empty.' }],
      isError: true,
    };
  }

  const payload: Record<string, unknown> = {
    nodeId: input.nodeId,
    projectId: input.projectId,
  };

  if (input.title !== undefined) payload['title'] = input.title;
  if (input.description !== undefined) payload['description'] = input.description;
  if (input.visionDoc !== undefined) payload['visionDoc'] = input.visionDoc;
  if (input.dependencies !== undefined) payload['dependencies'] = input.dependencies;
  if (input.verification !== undefined) payload['verification'] = input.verification;

  const result = await client.post<DispatchTaskResponse>('/api/dispatch/task', payload);

  const text = [
    `Task dispatched successfully.`,
    `  Execution ID : ${result.executionId}`,
    `  Node ID      : ${result.nodeId}`,
    `  Project ID   : ${result.projectId}`,
    `  Status       : ${result.status}`,
    result.message ? `  Message      : ${result.message}` : '',
    '',
    `Use astro_task_status with executionId="${result.executionId}" to poll for results.`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    content: [{ type: 'text', text }],
    metadata: { executionId: result.executionId, nodeId: result.nodeId, status: result.status },
  };
}
