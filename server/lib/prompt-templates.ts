/**
 * Prompt templates for AI plan generation and chat.
 *
 * Re-exports from @astro/core for backward compatibility.
 */
export {
  PLAN_GRAPH_SCHEMA,
  buildPlanSystemPrompt,
  buildChatSystemPrompt,
  buildTaskChatSystemPrompt,
  buildTaskExecutionPrompt,
  buildSummaryPrompt,
} from '../../packages/core/src/prompt-templates.js'

export type {
  RepoContextForPrompt,
  ChatPlanNode,
  ChatPlanEdge,
  TaskExecutionContext,
  TaskChatContext,
} from '../../packages/core/src/prompt-templates.js'
