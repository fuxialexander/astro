/**
 * Provider Abstraction Layer - Core Types
 *
 * This module defines the contract between the agent runner and individual providers.
 * All provider adapters (Claude Code, Codex, Gemini, etc.) implement against these interfaces.
 */

// ============================================================================
// Provider Detection & Capabilities
// ============================================================================

/**
 * Authentication status for a provider
 */
export type AuthStatus = 'authenticated' | 'unauthenticated' | 'expired' | 'unknown'

/**
 * Result of probing whether a provider is installed and available
 */
export interface ProviderDetectionResult {
  /** Whether the provider is installed and available */
  installed: boolean
  /** Provider version string if available */
  version?: string
  /** Authentication status */
  authStatus: AuthStatus
  /** Path to the provider binary/executable if applicable */
  executablePath?: string
  /** Human-readable status message */
  message?: string
  /** Timestamp of the detection */
  detectedAt: Date
}

/**
 * Task types that a provider can handle
 */
export type TaskType =
  | 'code_generation'
  | 'code_review'
  | 'code_analysis'
  | 'test_generation'
  | 'documentation'
  | 'refactoring'
  | 'bug_fix'
  | 'planning'
  | 'chat'
  | 'general'

/**
 * Context injection methods supported by a provider
 */
export type ContextInjectionMethod =
  | 'context_file'      // Provider supports --context-file or similar flag
  | 'system_prompt'     // Context injected via system prompt
  | 'prompt_prefix'     // Context prepended to user prompt
  | 'custom'            // Provider-specific mechanism

/**
 * Capabilities declared by a provider
 */
export interface ProviderCapabilities {
  /** Unique provider identifier */
  providerId: string
  /** Human-readable provider name */
  name: string
  /** Programming languages supported */
  languages: string[]
  /** Task types this provider can handle */
  taskTypes: TaskType[]
  /** Maximum context window (tokens) */
  maxContextTokens: number
  /** Whether the provider supports streaming output */
  supportsStreaming: boolean
  /** Whether the provider can be cancelled mid-execution */
  supportsCancellation: boolean
  /** Available models for this provider */
  availableModels: string[]
  /** Default model to use */
  defaultModel: string
  /** How context should be injected */
  contextInjectionMethod: ContextInjectionMethod
  /** Whether provider supports session resumption */
  supportsSessionResume: boolean
  /** Maximum number of turns in a single session */
  maxTurns?: number
}

// ============================================================================
// Task Execution
// ============================================================================

/**
 * Environment where a task should execute
 */
export type ExecutionEnvironment = 'local' | 'hpc' | 'cloud'

/**
 * Context provided for task execution
 */
export interface TaskContext {
  /** Project ID the task belongs to */
  projectId: string
  /** Vision document content (injected into context) */
  visionDoc?: string
  /** Working directory for the task */
  workingDirectory?: string
  /** Dependencies/prerequisites context */
  dependencyContext?: string
  /** Additional context files to include */
  contextFiles?: string[]
  /** Environment variables to set */
  environmentVariables?: Record<string, string>
  /** Target execution environment */
  environment?: ExecutionEnvironment
}

/**
 * Task dispatch request sent to a provider
 */
export interface TaskDispatch {
  /** Unique task ID */
  taskId: string
  /** Session ID (for multi-turn conversations) */
  sessionId?: string
  /** Task type */
  type: TaskType
  /** Main prompt/instruction for the task */
  prompt: string
  /** System prompt override (if provider supports it) */
  systemPrompt?: string
  /** Model to use (overrides provider default) */
  model?: string
  /** Maximum turns/iterations */
  maxTurns?: number
  /** Execution context */
  context: TaskContext
  /** Abort controller for cancellation */
  abortController?: AbortController
  /** JSON schema for structured output (forces provider to return structured data) */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }
}

// ============================================================================
// Task Results
// ============================================================================

/**
 * Status of a completed task
 */
export type TaskStatus = 'success' | 'failure' | 'error' | 'cancelled'

/**
 * File change reported by a provider
 */
export interface FileChange {
  path: string
  action: 'created' | 'modified' | 'deleted'
  diff?: string
  linesAdded?: number
  linesRemoved?: number
}

/**
 * Metrics reported by a provider
 */
export interface TaskMetrics {
  /** Total tokens used (input + output) */
  tokensUsed?: number
  /** Input tokens */
  inputTokens?: number
  /** Output tokens */
  outputTokens?: number
  /** Duration in milliseconds */
  durationMs: number
  /** Estimated cost in USD */
  estimatedCostUsd?: number
  /** Model used */
  model?: string
  /** Number of turns/iterations used */
  turnsUsed?: number
}

/**
 * Verification hints provided by the provider
 */
export interface VerificationHints {
  /** Whether tests were run */
  testsRun?: boolean
  /** Number of tests passed */
  testsPassed?: number
  /** Number of tests failed */
  testsFailed?: number
  /** Exit code of the process */
  exitCode?: number
  /** Build succeeded */
  buildSucceeded?: boolean
  /** Lint checks passed */
  lintPassed?: boolean
  /** Type checking passed */
  typeCheckPassed?: boolean
  /** Custom verification data */
  custom?: Record<string, unknown>
}

/**
 * Structured output from a task (e.g., plan graph, analysis results)
 */
export interface StructuredOutput {
  /** Type of structured output */
  type: string
  /** The structured data */
  data: unknown
}

/**
 * Unified task result format returned by all providers
 */
export interface TaskResult {
  /** Task ID this result belongs to */
  taskId: string
  /** Session ID (for session resumption) */
  sessionId?: string
  /** Task completion status */
  status: TaskStatus
  /** Structured output (if applicable) */
  output?: StructuredOutput
  /** Files changed during execution */
  filesChanged?: FileChange[]
  /** Raw stdout from the provider */
  stdout?: string
  /** Raw stderr from the provider */
  stderr?: string
  /** Execution metrics */
  metrics: TaskMetrics
  /** Provider-reported verification hints */
  verification?: VerificationHints
  /** Error message (if status is 'error' or 'failure') */
  errorMessage?: string
  /** Provider that executed the task */
  providerId: string
  /** Timestamp of completion */
  completedAt: Date
}

// ============================================================================
// Streaming Events
// ============================================================================

/**
 * Event types emitted during streaming execution
 */
export type StreamEventType =
  | 'init'
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'structured_output'
  | 'file_change'
  | 'progress'
  | 'result'
  | 'error'
  | 'aborted'

/**
 * Base stream event interface
 */
export interface BaseStreamEvent {
  type: StreamEventType
  taskId: string
  timestamp: Date
}

/**
 * Initialization event (start of execution)
 */
export interface InitStreamEvent extends BaseStreamEvent {
  type: 'init'
  model: string
  sessionId: string
}

/**
 * Text chunk event (streaming text output)
 */
export interface TextStreamEvent extends BaseStreamEvent {
  type: 'text'
  text: string
}

/**
 * Tool use event (provider invoked a tool)
 */
export interface ToolUseStreamEvent extends BaseStreamEvent {
  type: 'tool_use'
  toolName: string
  toolInput: unknown
}

/**
 * Tool result event (tool completed)
 */
export interface ToolResultStreamEvent extends BaseStreamEvent {
  type: 'tool_result'
  toolName: string
  result: unknown
  success: boolean
}

/**
 * Structured output event
 */
export interface StructuredOutputStreamEvent extends BaseStreamEvent {
  type: 'structured_output'
  output: StructuredOutput
}

/**
 * File change event
 */
export interface FileChangeStreamEvent extends BaseStreamEvent {
  type: 'file_change'
  change: FileChange
}

/**
 * Progress event (for long-running tasks)
 */
export interface ProgressStreamEvent extends BaseStreamEvent {
  type: 'progress'
  message: string
  percentage?: number
}

/**
 * Result event (task completed)
 */
export interface ResultStreamEvent extends BaseStreamEvent {
  type: 'result'
  result: TaskResult
}

/**
 * Error event
 */
export interface ErrorStreamEvent extends BaseStreamEvent {
  type: 'error'
  error: string
  recoverable: boolean
}

/**
 * Aborted event
 */
export interface AbortedStreamEvent extends BaseStreamEvent {
  type: 'aborted'
  reason?: string
}

/**
 * Union type for all stream events
 */
export type StreamEvent =
  | InitStreamEvent
  | TextStreamEvent
  | ToolUseStreamEvent
  | ToolResultStreamEvent
  | StructuredOutputStreamEvent
  | FileChangeStreamEvent
  | ProgressStreamEvent
  | ResultStreamEvent
  | ErrorStreamEvent
  | AbortedStreamEvent

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Main interface that all provider adapters must implement.
 * This is the contract between the agent runner and individual providers.
 */
export interface AgentProvider {
  /** Unique identifier for this provider */
  readonly id: string

  /** Human-readable name */
  readonly name: string

  /**
   * Probe whether this provider is installed and available.
   * Returns version and auth status.
   */
  detect(): Promise<ProviderDetectionResult>

  /**
   * Declare what this provider can do.
   * Returns languages, task types, max context, streaming support, etc.
   */
  capabilities(): ProviderCapabilities

  /**
   * Execute a task and return a structured result.
   * This is the main entry point for task execution.
   *
   * @param task - The task dispatch request
   * @returns Promise resolving to the task result
   */
  execute(task: TaskDispatch): Promise<TaskResult>

  /**
   * Execute a task with streaming output.
   * Yields events as they arrive (text chunks, tool use, progress, etc.)
   *
   * @param task - The task dispatch request
   * @yields Stream events as they arrive
   */
  stream(task: TaskDispatch): AsyncGenerator<StreamEvent, TaskResult, undefined>

  /**
   * Cancel a running task.
   *
   * @param taskId - The task ID to cancel
   * @returns Whether the cancellation was successful
   */
  cancel(taskId: string): Promise<boolean>

  /**
   * Build the context injection for this provider.
   * Returns the prepared context in the provider's preferred format.
   *
   * @param context - The task context
   * @returns Prepared context (may be a file path, prompt text, or custom format)
   */
  prepareContext(context: TaskContext): Promise<PreparedContext>
}

/**
 * Prepared context ready for injection into the provider
 */
export interface PreparedContext {
  /** How the context should be injected */
  method: ContextInjectionMethod
  /** File path (for context_file method) */
  filePath?: string
  /** Prompt content (for system_prompt or prompt_prefix methods) */
  promptContent?: string
  /** Custom data (for custom method) */
  customData?: unknown
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Provider registration in the registry
 */
export interface RegisteredProvider {
  /** The provider instance */
  provider: AgentProvider
  /** Detection result (cached) */
  detection: ProviderDetectionResult
  /** Capabilities (cached) */
  capabilities: ProviderCapabilities
  /** Last detection timestamp */
  lastDetection: Date
  /** Whether provider is currently available */
  available: boolean
}

/**
 * Machine registration payload for relay server
 */
export interface MachineRegistration {
  /** Unique machine identifier */
  machineId: string
  /** Machine hostname */
  hostname: string
  /** Available providers on this machine */
  providers: Array<{
    providerId: string
    name: string
    version?: string
    authStatus: AuthStatus
    capabilities: ProviderCapabilities
  }>
  /** Registration timestamp */
  registeredAt: Date
}
