/**
 * Prompt templates for AI plan generation and chat.
 *
 * Re-exports from @astro/core for backward compatibility.
 */
export {
  PLAN_GRAPH_SCHEMA,
  buildChatSystemPrompt,
  buildTaskChatSystemPrompt,
  buildTaskExecutionPrompt,
  buildTitleGenerationPrompt,
  buildRefinementPrompt,
  buildLabelSuggestionPrompt,
  buildSummaryPrompt,
  buildInteractivePlanPrompt,
  buildCompactionPrompt,
  sanitizeGitHubName,
  sanitizeGitBranch,
  formatMachineInstruction,
  DEFAULT_MACHINE_INSTRUCTION_NAME,
  MACHINE_INSTRUCTION_PRESET_META,
} from '../../packages/core/src/prompt-templates.js'

export type {
  GitHubContextForPrompt,
  ChatPlanNode,
  ChatPlanEdge,
  TaskExecutionContext,
  TaskChatContext,
  RefinementInput,
} from '../../packages/core/src/prompt-templates.js'
