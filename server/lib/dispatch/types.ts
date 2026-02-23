/**
 * Dispatch Engine Types
 *
 * Re-exports from @astro/core for backward compatibility.
 */
export type {
  TaskResult,
  VerificationHints,
  StreamEvent,
  DispatchStatus,
  VerificationResult,
  DispatchPriority,
  DispatchQueueEntry,
  AssembledContext,
  DependencyOutput,
  GraphPosition,
  DispatchRequest,
  DispatchResult,
  RoutingDecision,
  JudgmentContext,
  TaskArtifact,
  BranchPruneRequest,
  BranchPruneResult,
  DispatchEngineEventType,
  DispatchEngineEvent,
  TaskReadyEvent,
  TaskQueuedEvent,
  TaskDispatchedEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  BranchPrunedEvent,
  DispatchEngineConfig,
  PlanGraphSnapshot,
  DependencyResolution,
} from '../../../packages/core/src/dispatch/types.js'
export { DEFAULT_DISPATCH_CONFIG } from '../../../packages/core/src/dispatch/types.js'
