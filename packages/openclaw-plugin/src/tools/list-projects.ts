/**
 * astro_list_projects tool
 *
 * Lists all Astro projects visible to the configured user/team by calling
 * GET /api/data/projects on the Astro backend.
 *
 * Gateway method: astro.projects.list
 */

import type { AstroClient } from '../client.js';
import type { OpenClawToolDefinition, OpenClawToolResult } from '../types.js';

// ── API response shape ────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  repository: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  teamId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const listProjectsToolDef: OpenClawToolDefinition = {
  name: 'astro_list_projects',
  description:
    'List all Astro projects visible to the authenticated user or team. ' +
    'Returns project metadata including name, description, repository URL, and status.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

// ── Tool handler ──────────────────────────────────────────────────────────────

export async function listProjects(
  client: AstroClient,
): Promise<OpenClawToolResult> {
  const projects = await client.get<ProjectSummary[]>('/api/data/projects');

  if (projects.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No projects found. Create a project in the Astro UI to get started.',
        },
      ],
    };
  }

  const lines: string[] = [
    `Found ${projects.length} project(s):\n`,
    ...projects.map((p) => {
      const repoInfo = p.repository
        ? ` — ${p.repository}`
        : p.githubOwner && p.githubRepo
          ? ` — github.com/${p.githubOwner}/${p.githubRepo}`
          : '';
      return `• [${p.id}] ${p.name}${repoInfo}${p.description ? `\n  ${p.description}` : ''}`;
    }),
  ];

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    metadata: { projects },
  };
}
