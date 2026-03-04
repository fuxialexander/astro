/**
 * Dispatch Module Exports
 *
 * Central export point for the task execution dispatch framework.
 */

// Types
export * from './types.js'

// Core components
export { DispatchEngine, createDispatchEngine, dispatchEngine } from './dispatch-engine.js'
export { DispatchQueue, createDispatchQueue } from './dispatch-queue.js'
export { ContextAssembler, createContextAssembler } from './context-assembler.js'
export { ResultRouter, createResultRouter, DEFAULT_ROUTER_CONFIG } from './result-router.js'
export { BranchManager, createBranchManager, type BranchInfo } from './branch-manager.js'

// Re-export key types for convenience
export type {
  NodeUpdateCallback,
  PlanGraphProvider,
  KnowledgeProvider,
  ExecutionCallback,
} from './dispatch-engine.js'
