/**
 * Provider Abstraction Layer
 *
 * This module exports the complete provider abstraction layer for Nexus.
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
export { SlurmProvider, slurmProvider } from './adapters/slurm.js'

/**
 * Initialize the provider registry with all known providers.
 * This should be called on agent runner startup.
 */
export async function initializeProviders(): Promise<void> {
  const { providerRegistry } = await import('./registry.js')
  const { claudeCodeProvider } = await import('./adapters/claude-code.js')
  const { slurmProvider } = await import('./adapters/slurm.js')

  // Register built-in providers
  providerRegistry.register(claudeCodeProvider)
  providerRegistry.register(slurmProvider)

  // Note: Additional providers (Codex, Gemini, etc.) will be registered here
  // when their adapters are implemented (SUP-176, SUP-185)

  // Detect all providers
  await providerRegistry.detectAll()
}
