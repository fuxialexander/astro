/**
 * @astroanywhere/openclaw-plugin — Plugin entry point
 *
 * Registers Astro's project/plan/task management as OpenClaw gateway tools:
 *
 *   astro_list_projects  → astro.projects.list
 *   astro_get_plan       → astro.projects.getPlan
 *   astro_run_task       → astro.dispatch.task
 *   astro_task_status    → astro.dispatch.taskStatus
 *
 * Usage (OpenClaw gateway auto-loads this via openclaw.plugin.json):
 *
 *   import { createPlugin } from '@astroanywhere/openclaw-plugin'
 *   const plugin = createPlugin({ serverUrl: 'http://localhost:3001', authToken: '' })
 *   const result = await plugin.invoke('astro_list_projects', {})
 */

export { AstroClient, AstroApiError } from './client.js';
export type { AstroClientConfig } from './client.js';

export type {
  OpenClawPlugin,
  OpenClawToolDefinition,
  OpenClawToolResult,
  PluginConfig,
  RegisteredTool,
  ToolHandler,
} from './types.js';

export { listProjectsToolDef, listProjects } from './tools/list-projects.js';
export type { ProjectSummary } from './tools/list-projects.js';

export { getPlanToolDef, getPlan } from './tools/get-plan.js';
export type { PlanGraph, PlanNode, PlanEdge } from './tools/get-plan.js';

export { runTaskToolDef, runTask } from './tools/run-task.js';
export type { DispatchTaskResponse, RunTaskInput } from './tools/run-task.js';

export { taskStatusToolDef, taskStatus } from './tools/task-status.js';
export type { TaskExecution } from './tools/task-status.js';

import { AstroClient } from './client.js';
import type { PluginConfig, OpenClawPlugin, RegisteredTool, OpenClawToolResult } from './types.js';
import { listProjectsToolDef, listProjects } from './tools/list-projects.js';
import { getPlanToolDef, getPlan } from './tools/get-plan.js';
import { runTaskToolDef, runTask } from './tools/run-task.js';
import { taskStatusToolDef, taskStatus } from './tools/task-status.js';

/**
 * Create and return a fully configured Astro OpenClaw plugin instance.
 *
 * The returned plugin exposes four tools that call the Astro backend API
 * using the provided `serverUrl` and `authToken`.
 *
 * @param config - Connection config (serverUrl, authToken, optional teamId)
 */
export function createPlugin(config: PluginConfig): OpenClawPlugin {
  const client = new AstroClient({
    serverUrl: config.serverUrl,
    authToken: config.authToken,
    teamId: config.teamId,
  });

  // Register all tools
  const tools = new Map<string, RegisteredTool>([
    [
      listProjectsToolDef.name,
      {
        definition: listProjectsToolDef,
        handler: () => listProjects(client),
      },
    ],
    [
      getPlanToolDef.name,
      {
        definition: getPlanToolDef,
        handler: (input) => getPlan(client, input as { projectId: string }),
      },
    ],
    [
      runTaskToolDef.name,
      {
        definition: runTaskToolDef,
        handler: (input) =>
          runTask(client, input as { nodeId: string; projectId: string; [k: string]: unknown }),
      },
    ],
    [
      taskStatusToolDef.name,
      {
        definition: taskStatusToolDef,
        handler: (input) => taskStatus(client, input as { executionId: string }),
      },
    ],
  ]);

  return {
    id: 'astro',
    name: 'Astro Planning Platform',
    version: '0.1.0',
    tools,

    async invoke(
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<OpenClawToolResult> {
      const tool = tools.get(toolName);
      if (!tool) {
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: "${toolName}". Available tools: ${[...tools.keys()].join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      try {
        return await tool.handler(input);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Tool "${toolName}" failed: ${message}` }],
          isError: true,
        };
      }
    },
  };
}
