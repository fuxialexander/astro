/**
 * Dispatch Engine Types
 *
 * Core types for the task execution dispatch framework.
 * The dispatch engine bridges the plan graph and agent execution.
 */

import type { PlanNode, PlanEdge } from '../types.js'
import type { ProviderType } from '../types/relay.js'

/** Minimal task result interface (formerly from providers/types.ts) */
export interface TaskResult {
  taskId: string
  status: 'success' | 'failure' | 'cancelled'
  stdout?: string
  stderr?: string
  errorMessage?: string
  sessionId?: string
  metrics?: {
    durationMs?: number
    inputTokens?: number
    outputTokens?: number
    totalCost?: number
    estimatedCostUsd?: number  // Alias for totalCost, used by observation collector & usage hooks
    tokensUsed?: number        // inputTokens + outputTokens, used by usage-metrics-hook
    turnsUsed?: number         // Alias for numTurns, used by usage-metrics-hook
    model?: string
    numTurns?: number
  }
  verification?: Record<string, unknown>
  branchName?: string
  prUrl?: string
  prNumber?: number
  /** Git SHA of the project branch before this task's PR was merged */
  commitBeforeSha?: string
  /** Git SHA of the project branch after this task's PR was merged */
  commitAfterSha?: string
  /** Delivery outcome — separate from execution status */
  deliveryStatus?: 'success' | 'failed' | 'skipped'
  /** Error message when deliveryStatus is 'failed' */
  deliveryError?: string
  filesChanged?: Array<{ path: string; diff?: string }>
  /** Structured execution summary (generated via follow-up structured output turn) */
  summary?: {
    status: 'success' | 'partial' | 'failure'
    workCompleted: string
    keyFindings: string[]
    filesChanged: string[]
    followUps: string[]
    prUrl?: string | null
    prNumber?: number | null
    branchName?: string | null
  }
}

/** Verification hints from task execution (structured form of verification field) */
export interface VerificationHints {
  testsRun?: boolean
  testsPassed?: number
  testsFailed?: number
  buildSucceeded?: boolean
  lintPassed?: boolean
  typeCheckPassed?: boolean
  exitCode?: number
}

/** Stream event interface (formerly from providers/types.ts) */
export interface StreamEvent {
  type: 'init' | 'text' | 'tool_use' | 'tool_result' | 'file_change' | 'progress' | 'result' | 'error' | 'aborted'
  [key: string]: unknown
}

// ============================================================================
// Dispatch State
// ============================================================================

/**
 * Status of a task in the dispatch lifecycle
 */
export type DispatchStatus =
  | 'pending'       // Waiting for dependencies
  | 'ready'         // Dependencies met, awaiting dispatch
  | 'queued'        // In dispatch queue
  | 'dispatched'    // Sent to provider/machine
  | 'in_progress'   // Executing
  | 'completed'     // Successfully finished
  | 'failed'        // Execution failed
  | 'cancelled'     // Cancelled by user or branch prune

/**
 * Verification result after task completion
 */
export type VerificationResult =
  | 'auto_verified'     // Automatically verified (tests passed, build succeeded)
  | 'awaiting_judgment' // Requires human judgment
  | 'skipped'           // Verification skipped

/**
 * Priority levels for task dispatch
 */
export type DispatchPriority = 'critical' | 'high' | 'normal' | 'low'

// ============================================================================
// Dispatch Queue Entry
// ============================================================================

/**
 * Entry in the dispatch queue
 */
export interface DispatchQueueEntry {
  /** Unique entry ID */
  id: string
  /** Reference to the plan node */
  nodeId: string
  /** Project this task belongs to */
  projectId: string
  /** Current dispatch status */
  status: DispatchStatus
  /** Dispatch priority */
  priority: DispatchPriority
  /** Target execution environment (legacy, unused) */
  environment?: string
  /** Preferred provider (if any) */
  preferredProvider?: ProviderType
  /** Target machine ID (if specified) */
  targetMachineId?: string
  /** Retry count */
  retryCount: number
  /** Maximum retries allowed */
  maxRetries: number
  /** When this entry was created */
  createdAt: Date
  /** When dispatch was last attempted */
  lastDispatchAttempt?: Date
  /** Error from last attempt (if any) */
  lastError?: string
  /** Execution ID once dispatched */
  executionId?: string
  /** Session ID for resumption */
  sessionId?: string
}

// ============================================================================
// Context Assembly
// ============================================================================

/**
 * Assembled context for task execution
 */
export interface AssembledContext {
  /** The plan node being executed */
  node: PlanNode
  /** Project ID */
  projectId: string
  /** Vision document content */
  visionDoc?: string
  /** Outputs from completed dependencies */
  dependencyOutputs: DependencyOutput[]
  /** Position in the plan graph */
  graphPosition: GraphPosition
  /** Working directory for execution */
  workingDirectory?: string
  /** Original project directory (for data access from worktrees) */
  originalProjectDirectory?: string
  /** Additional resource folders (data, configs, docs) */
  resourcePaths?: string[]
  /** Additional environment variables */
  environmentVariables?: Record<string, string>
}

/**
 * Output from a completed dependency
 */
export interface DependencyOutput {
  /** Node ID of the dependency */
  nodeId: string
  /** Title of the dependency task */
  title: string
  /** Output/result from the task */
  output: string
  /** Whether the output was truncated */
  truncated: boolean
  /** Status of the dependency */
  status: PlanNode['status']
}

/**
 * Position of a task in the plan graph
 */
export interface GraphPosition {
  /** Depth from root (0 = root) */
  depth: number
  /** Number of upstream dependencies */
  upstreamCount: number
  /** Number of downstream dependents */
  downstreamCount: number
  /** Whether this is on a branch */
  isOnBranch: boolean
  /** Branch name/ID if applicable */
  branchId?: string
  /** Number of parallel siblings at this level */
  parallelSiblings: number
}

// ============================================================================
// Dispatch Request
// ============================================================================

/**
 * Request to dispatch a task
 */
export interface DispatchRequest {
  /** Node ID to dispatch */
  nodeId: string
  /** Project ID */
  projectId: string
  /** Target environment (legacy, unused) */
  environment?: string
  /** Preferred provider */
  preferredProvider?: ProviderType
  /** Target machine (for relay dispatch) */
  targetMachineId?: string
  /** Priority override */
  priority?: DispatchPriority
  /** Model override */
  model?: string
  /** Max turns override */
  maxTurns?: number
  /** Working directory override */
  workingDirectory?: string
  /** Force dispatch even if dependencies not met (for manual override) */
  force?: boolean
  /** Dry run - don't actually dispatch, just validate */
  dryRun?: boolean
}

/**
 * Result of a dispatch request
 */
export interface DispatchResult {
  /** Whether dispatch was successful */
  success: boolean
  /** Queue entry if successful */
  queueEntry?: DispatchQueueEntry
  /** Error message if failed */
  error?: string
  /** Validation issues if dry run */
  validationIssues?: string[]
  /** Execution ID if dispatched immediately */
  executionId?: string
}

// ============================================================================
// Result Routing
// ============================================================================

/**
 * Routing decision for a completed task
 */
export interface RoutingDecision {
  /** Whether to auto-close the task */
  autoClose: boolean
  /** Target status for the node */
  targetStatus: PlanNode['status']
  /** Reason for the decision */
  reason: string
  /** Whether to surface to judgment queue */
  surfaceToJudgment: boolean
  /** Judgment context if surfacing */
  judgmentContext?: JudgmentContext
  /** Whether to trigger downstream dispatch */
  triggerDownstream: boolean
  /** Downstream nodes to evaluate */
  downstreamNodes?: string[]
}

/**
 * Context for judgment queue entry
 */
export interface JudgmentContext {
  /** Summary of the task output */
  summary: string
  /** Key points to review */
  keyPoints: string[]
  /** Suggested action */
  suggestedAction: 'approve' | 'retry' | 'reject' | 'modify'
  /** Confidence in suggestion (0-1) */
  confidence: number
  /** Related artifacts */
  artifacts?: TaskArtifact[]
}

/**
 * Artifact from task execution
 */
export interface TaskArtifact {
  /** Artifact name */
  name: string
  /** Type of artifact */
  type: 'file' | 'log' | 'report' | 'preview' | 'diff'
  /** Path or URL */
  path?: string
  /** Content preview */
  preview?: string
  /** Size in bytes */
  size?: number
}

// ============================================================================
// Branch Operations
// ============================================================================

/**
 * Request to prune a branch
 */
export interface BranchPruneRequest {
  /** ID of the branch point node */
  branchNodeId: string
  /** Project ID */
  projectId: string
  /** Reason for pruning */
  reason?: string
}

/**
 * Result of a branch prune operation
 */
export interface BranchPruneResult {
  /** Whether the prune was successful */
  success: boolean
  /** Nodes that were pruned */
  prunedNodes: string[]
  /** Tasks that were cancelled */
  cancelledTasks: string[]
  /** Error if failed */
  error?: string
}

// ============================================================================
// Engine Events
// ============================================================================

/**
 * Events emitted by the dispatch engine
 */
export type DispatchEngineEventType =
  | 'task:ready'           // Task dependencies met, ready for dispatch
  | 'task:queued'          // Task added to dispatch queue
  | 'task:dispatched'      // Task sent to provider
  | 'task:started'         // Execution started
  | 'task:progress'        // Progress update
  | 'task:completed'       // Execution completed
  | 'task:failed'          // Execution failed
  | 'task:cancelled'       // Task cancelled
  | 'task:routed'          // Result routed (auto-close or judgment)
  | 'branch:pruned'        // Branch was pruned
  | 'queue:updated'        // Queue state changed
  | 'engine:error'         // Engine-level error

/**
 * Base event from dispatch engine
 */
export interface DispatchEngineEvent {
  type: DispatchEngineEventType
  timestamp: Date
  projectId?: string
  nodeId?: string
  metadata?: Record<string, unknown>
}

/**
 * Task ready event
 */
export interface TaskReadyEvent extends DispatchEngineEvent {
  type: 'task:ready'
  nodeId: string
  projectId: string
  autoDispatch: boolean
}

/**
 * Task queued event
 */
export interface TaskQueuedEvent extends DispatchEngineEvent {
  type: 'task:queued'
  nodeId: string
  projectId: string
  queueEntry: DispatchQueueEntry
}

/**
 * Task dispatched event
 */
export interface TaskDispatchedEvent extends DispatchEngineEvent {
  type: 'task:dispatched'
  nodeId: string
  projectId: string
  executionId: string
  environment?: string
  providerId?: string
  machineId?: string
}

/**
 * Task completed event
 */
export interface TaskCompletedEvent extends DispatchEngineEvent {
  type: 'task:completed'
  nodeId: string
  projectId: string
  result: TaskResult
  routingDecision: RoutingDecision
}

/**
 * Task failed event
 */
export interface TaskFailedEvent extends DispatchEngineEvent {
  type: 'task:failed'
  nodeId: string
  projectId: string
  error: string
  retryable: boolean
  retryCount: number
}

/**
 * Branch pruned event
 */
export interface BranchPrunedEvent extends DispatchEngineEvent {
  type: 'branch:pruned'
  branchNodeId: string
  projectId: string
  prunedNodes: string[]
  cancelledTasks: string[]
  reason?: string
}

// ============================================================================
// Engine Configuration
// ============================================================================

/**
 * Configuration for the dispatch engine
 */
export interface DispatchEngineConfig {
  /** Enable auto-dispatch when dependencies are met */
  autoDispatch: boolean
  /** Maximum concurrent tasks per project */
  maxConcurrentPerProject: number
  /** Maximum concurrent tasks total */
  maxConcurrentTotal: number
  /** Default task priority */
  defaultPriority: DispatchPriority
  /** Default max retries */
  defaultMaxRetries: number
  /** Retry delay base (ms) */
  retryDelayBase: number
  /** Retry delay max (ms) */
  retryDelayMax: number
  /** Enable dry run mode (log but don't execute) */
  dryRunMode: boolean
  /** Maximum output size per dependency (chars) */
  maxDependencyOutputSize: number
  /** Poll interval for ready tasks (ms) */
  pollIntervalMs: number
  /** Machine selection policy for multi-machine environments */
  machineSelectionPolicy: 'round-robin' | 'priority' | 'least-loaded' | 'manual'
}

/**
 * Default dispatch engine configuration
 */
export const DEFAULT_DISPATCH_CONFIG: DispatchEngineConfig = {
  autoDispatch: true,
  maxConcurrentPerProject: 1,
  maxConcurrentTotal: 20,
  defaultPriority: 'normal',
  defaultMaxRetries: 2,
  retryDelayBase: 5000,
  retryDelayMax: 60000,
  dryRunMode: false,
  maxDependencyOutputSize: 10000,
  pollIntervalMs: 2000,
  machineSelectionPolicy: 'priority',
}

// ============================================================================
// Plan Graph Snapshot
// ============================================================================

/**
 * Snapshot of plan graph state for dispatch calculations
 */
export interface PlanGraphSnapshot {
  /** Project ID */
  projectId: string
  /** All nodes in the graph */
  nodes: PlanNode[]
  /** All edges in the graph */
  edges: PlanEdge[]
  /** Nodes that are ready for dispatch */
  readyNodes: string[]
  /** Nodes currently in progress */
  inProgressNodes: string[]
  /** Nodes completed */
  completedNodes: string[]
  /** Snapshot timestamp */
  timestamp: Date
}

/**
 * Dependency resolution result
 */
export interface DependencyResolution {
  /** Whether all dependencies are met */
  allMet: boolean
  /** Completed dependencies */
  completed: string[]
  /** Pending dependencies */
  pending: string[]
  /** Failed dependencies (blocks this task) */
  failed: string[]
  /** Pruned dependencies (may block or allow based on config) */
  pruned: string[]
}
