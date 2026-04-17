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
  buildUnifiedPlaygroundPrompt,
  buildImportFromHistoryPrompt,
  sanitizeGitHubName,
  sanitizeGitBranch,
  formatMachineInstruction,
  DEFAULT_MACHINE_INSTRUCTION_NAME,
  MACHINE_INSTRUCTION_PRESET_META,
  GENERATIVE_UI_HINT,
  DISCOVERY_MODE_INSTRUCTIONS,
} from '../../packages/core/src/prompt-templates.js'

export type {
  GitHubContextForPrompt,
  ChatPlanNode,
  ChatPlanEdge,
  TaskExecutionContext,
  TaskChatContext,
  RefinementInput,
  ImportedSessionEntry,
} from '../../packages/core/src/prompt-templates.js'
