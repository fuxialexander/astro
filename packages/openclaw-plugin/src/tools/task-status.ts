/**
 * astro_task_status tool
 *
 * Returns the current execution status and output for a dispatched task by calling
 * GET /api/data/task-executions/:executionId on the Astro backend.
 *
 * Gateway method: astro.dispatch.taskStatus
 */

import type { AstroClient } from '../client.js';
import type { OpenClawToolDefinition, OpenClawToolResult } from '../types.js';

// ── API response shape ────────────────────────────────────────────────────────

export interface TaskExecution {
  id: string;
  nodeId: string;
  projectId: string;
  status: string;
  output: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  model: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  costUsd: number | null;
  turnCount: number | null;
  providerId: string | null;
  providerSessionId: string | null;
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const taskStatusToolDef: OpenClawToolDefinition = {
  name: 'astro_task_status',
  description:
    'Get the current execution status and output for a dispatched Astro task. ' +
    'Poll this tool after calling astro_run_task to track progress. ' +
    'When status is "completed" or "auto_verified", the output field contains the result. ' +
    'When status is "error", the error field describes what went wrong.',
  inputSchema: {
    type: 'object',
    required: ['executionId'],
    properties: {
      executionId: {
        type: 'string',
        description:
          'The executionId returned by astro_run_task, or the executionId stored on the plan node.',
      },
    },
    additionalProperties: false,
  },
};

// ── Status display helpers ────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planned (not yet started)',
  dispatched: 'Dispatched (waiting for agent runner)',
  in_progress: 'In Progress',
  auto_verified: 'Completed — auto-verified',
  awaiting_approval: 'Awaiting Approval',
  awaiting_judgment: 'Awaiting Human Judgment',
  completed: 'Completed',
  pruned: 'Pruned (cancelled)',
  error: 'Error',
};

function humanStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

// ── Tool handler ──────────────────────────────────────────────────────────────

export async function taskStatus(
  client: AstroClient,
  input: { executionId: string },
): Promise<OpenClawToolResult> {
  if (!input.executionId?.trim()) {
    return {
      content: [{ type: 'text', text: 'Error: executionId is required and must be non-empty.' }],
      isError: true,
    };
  }

  const execution = await client.get<TaskExecution>(
    `/api/data/task-executions/${encodeURIComponent(input.executionId)}`,
  );

  const lines: string[] = [
    `Execution: ${execution.id}`,
    `  Node ID    : ${execution.nodeId}`,
    `  Project ID : ${execution.projectId}`,
    `  Status     : ${humanStatus(execution.status)}`,
  ];

  if (execution.startedAt) {
    lines.push(`  Started    : ${execution.startedAt}`);
  }
  if (execution.completedAt) {
    lines.push(`  Completed  : ${execution.completedAt}`);
  }

  // Usage metrics
  if (execution.model) {
    lines.push(`  Model      : ${execution.model}`);
  }
  if (execution.turnCount !== null) {
    lines.push(`  Turns      : ${execution.turnCount}`);
  }
  if (execution.costUsd !== null) {
    lines.push(`  Cost       : $${execution.costUsd.toFixed(4)}`);
  }

  const isTerminal = ['auto_verified', 'completed', 'pruned', 'error'].includes(execution.status);

  if (execution.output) {
    lines.push('', 'Output:', execution.output);
  }

  if (execution.error) {
    lines.push('', 'Error:', execution.error);
  }

  if (!isTerminal) {
    lines.push('', `Task is still running. Poll again to check for updates.`);
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    metadata: {
      execution,
      isTerminal,
      isSuccess: ['auto_verified', 'completed'].includes(execution.status),
    },
  };
}
