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
  buildTitleGenerationPrompt,
  buildRefinementPrompt,
  buildLabelSuggestionPrompt,
  buildSummaryPrompt,
  buildInteractivePlanPrompt,
  sanitizeGitHubName,
  sanitizeGitBranch,
} from '../../packages/core/src/prompt-templates.js'

export type {
  RepoContextForPrompt,
  GitStateForPrompt,
  GitHubContextForPrompt,
  ChatPlanNode,
  ChatPlanEdge,
  TaskExecutionContext,
  TaskChatContext,
  RefinementInput,
} from '../../packages/core/src/prompt-templates.js'
