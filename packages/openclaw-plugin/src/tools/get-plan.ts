/**
 * astro_get_plan tool
 *
 * Returns the full plan graph (nodes + edges) for a given project by calling:
 *   GET /api/data/plan-nodes?projectId=<id>
 *   GET /api/data/plan-edges?projectId=<id>
 *
 * Gateway method: astro.projects.getPlan
 */

import type { AstroClient } from '../client.js';
import type { OpenClawToolDefinition, OpenClawToolResult } from '../types.js';

// ── API response shapes ───────────────────────────────────────────────────────

export interface PlanNode {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  type: string | null;
  priority: string | null;
  estimate: string | null;
  verification: string | null;
  assigneeId: string | null;
  milestoneId: string | null;
  startDate: string | null;
  endDate: string | null;
  dueDate: string | null;
  executionId: string | null;
  executionOutput: string | null;
  executionError: string | null;
  executionStartedAt: string | null;
  executionCompletedAt: string | null;
  number: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanEdge {
  id: string;
  projectId: string;
  source: string;
  target: string;
  type: string | null;
}

export interface PlanGraph {
  projectId: string;
  nodes: PlanNode[];
  edges: PlanEdge[];
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const getPlanToolDef: OpenClawToolDefinition = {
  name: 'astro_get_plan',
  description:
    'Retrieve the full plan graph (nodes and edges) for a given Astro project. ' +
    'Nodes represent tasks with status, priority, estimates, and execution output. ' +
    'Edges encode dependencies between tasks.',
  inputSchema: {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: {
        type: 'string',
        description: 'The UUID of the project whose plan to retrieve.',
      },
    },
    additionalProperties: false,
  },
};

// ── Tool handler ──────────────────────────────────────────────────────────────

export async function getPlan(
  client: AstroClient,
  input: { projectId: string },
): Promise<OpenClawToolResult> {
  if (!input.projectId?.trim()) {
    return {
      content: [{ type: 'text', text: 'Error: projectId is required and must be non-empty.' }],
      isError: true,
    };
  }

  const qs = `?projectId=${encodeURIComponent(input.projectId)}`;
  const [nodes, edges] = await Promise.all([
    client.get<PlanNode[]>(`/api/data/plan-nodes${qs}`),
    client.get<PlanEdge[]>(`/api/data/plan-edges${qs}`),
  ]);

  const graph: PlanGraph = { projectId: input.projectId, nodes, edges };

  if (nodes.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `Project ${input.projectId} has no plan nodes yet. Generate a plan from the Astro UI first.`,
        },
      ],
      metadata: { graph },
    };
  }

  // Build a human-readable summary
  const statusGroups: Record<string, PlanNode[]> = {};
  for (const node of nodes) {
    const s = node.status ?? 'unknown';
    (statusGroups[s] ??= []).push(node);
  }

  const statusSummary = Object.entries(statusGroups)
    .map(([s, ns]) => `  ${s}: ${ns.length}`)
    .join('\n');

  const nodeLines = nodes.map((n) => {
    const depCount = edges.filter((e) => e.target === n.id).length;
    const status = n.status ?? 'unknown';
    return (
      `• [${n.id}] #${n.number ?? '?'} ${n.title}` +
      ` (${status}${n.estimate ? `, ${n.estimate}` : ''}${depCount ? `, ${depCount} dep(s)` : ''})`
    );
  });

  const summary = [
    `Plan for project ${input.projectId}:`,
    `  ${nodes.length} node(s), ${edges.length} edge(s)`,
    `Status breakdown:\n${statusSummary}`,
    '',
    'Nodes:',
    ...nodeLines,
  ].join('\n');

  return {
    content: [{ type: 'text', text: summary }],
    metadata: { graph },
  };
}
