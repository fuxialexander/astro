/**
 * Transport-agnostic command layer.
 *
 * This module provides the business logic for all Astro commands,
 * decoupled from any specific transport (CLI, Telegram, web, etc.).
 *
 * Usage:
 *   import { commands } from '@astro/core'
 *   // or
 *   import { listProjects, getPlanTree } from '@astro/core/commands'
 *
 * Each command function takes a `CommandClient` (the API abstraction)
 * and returns a structured result. Transports are responsible for:
 *   1. Implementing `CommandClient` (HTTP client, direct DB, etc.)
 *   2. Formatting the result for their output medium (terminal, Telegram markdown, HTML)
 *
 * Adding a new command:
 *   1. Add the result type to `types.ts`
 *   2. Implement the function in the appropriate domain file
 *   3. Re-export from this index
 *   4. Add CLI formatter in `packages/cli/`
 *   5. Add Telegram formatter in the Telegram adapter
 */

// Types
export type {
  // Client interface
  CommandClient,
  // Data types
  ProjectData,
  PlanNodeData,
  PlanEdgeData,
  ExecutionData,
  MachineData,
  ActivityEventData,
  FileChangeData,
  SearchResultsData,
  RelayStatusData,
  ClusterData,
  // Result types
  ProjectListResult,
  ProjectDetailResult,
  ProjectCreateResult,
  ProjectUpdateResult,
  ProjectDeleteResult,
  ProjectStatsResult,
  TaskListResult,
  TaskDetailResult,
  TaskCancelResult,
  TaskSteerResult,
  TaskStatusUpdateResult,
  PlanTreeNode,
  PlanTreeResult,
  PlanNodeListResult,
  MachineListResult,
  MachineDetailResult,
  ProviderListResult,
  RelayStatusResult,
  ClusterListResult,
  SearchCommandResult,
  ActivityListResult,
  // Filter types
  TaskListFilters,
  SearchFilters,
  ActivityListFilters,
} from './types.js'

// Project commands
export {
  resolveProject,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getProjectStats,
} from './projects.js'

// Plan commands
export {
  buildPlanTree,
  renderTreeLines,
  listPlanNodes,
  getPlanTree,
  getPlanNode,
  validateNodeIds,
} from './plan.js'

// Task commands
export {
  listTasks,
  getTask,
  cancelTask,
  steerTask,
  updateTaskStatus,
} from './tasks.js'

// Environment/machine commands
export {
  resolveMachine,
  listMachines,
  getMachine,
  removeMachine,
  listProviders,
  getRelayStatus,
  listClusters,
} from './env.js'

// Search & activity commands
export {
  searchAll,
  listActivities,
} from './search.js'
