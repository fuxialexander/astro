/**
 * Provider Abstraction Layer
 *
 * This module exports the complete provider abstraction layer for Astro.
 * It defines the contract between the agent runner and individual providers,
 * including the AgentProvider interface, TaskResult format, and ProviderRegistry.
 */

// Core types and interfaces
export type {
  // Detection
  AuthStatus,
  ProviderDetectionResult,

  // Capabilities
  TaskType,
  ContextInjectionMethod,
  ProviderCapabilities,

  // Task Execution
  ExecutionEnvironment,
  TaskContext,
  TaskDispatch,

  // Task Results
  TaskStatus,
  FileChange,
  TaskMetrics,
  VerificationHints,
  StructuredOutput,
  TaskResult,

  // Streaming
  StreamEventType,
  BaseStreamEvent,
  InitStreamEvent,
  TextStreamEvent,
  ToolUseStreamEvent,
  ToolResultStreamEvent,
  StructuredOutputStreamEvent,
  FileChangeStreamEvent,
  ProgressStreamEvent,
  ResultStreamEvent,
  ErrorStreamEvent,
  AbortedStreamEvent,
  StreamEvent,

  // Provider Interface
  AgentProvider,
  PreparedContext,

  // Registry
  RegisteredProvider,
  MachineRegistration,
} from './types.js'

// Registry
export { providerRegistry, ProviderRegistry } from './registry.js'

// Context injection
export {
  ContextBuilder,
  prepareContext,
  injectContextIntoPrompt,
  getContextStrategy,
  SystemPromptStrategy,
  PromptPrefixStrategy,
  ContextFileStrategy,
} from './context.js'
export type { ContextInjectionStrategy } from './context.js'

// Provider adapters
export { ClaudeCodeProvider, claudeCodeProvider } from './adapters/claude-code.js'
export { CodexProvider, codexProvider } from './adapters/codex.js'
export { AnthropicDirectProvider, anthropicDirectProvider } from './adapters/anthropic-direct.js'

/**
 * Initialize the provider registry with all known providers.
 * Slurm is no longer a standalone provider — HPC is handled via
 * prompt injection in the agent runner's ClaudeSdkAdapter.
 */
export async function initializeProviders(): Promise<void> {
  const { providerRegistry } = await import('./registry.js')
  const { claudeCodeProvider } = await import('./adapters/claude-code.js')
  const { codexProvider } = await import('./adapters/codex.js')
  const { anthropicDirectProvider } = await import('./adapters/anthropic-direct.js')

  // Register built-in providers
  providerRegistry.register(claudeCodeProvider)
  providerRegistry.register(codexProvider)
  providerRegistry.register(anthropicDirectProvider)

  // Detect all providers
  await providerRegistry.detectAll()
}
