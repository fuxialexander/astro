/**
 * Dispatch Module Exports (Core)
 *
 * Pure business logic for task dispatch.
 * Does NOT include dispatch-engine or dispatch-queue (those have server/DB deps).
 */

// Types
export * from './types.js'

// Pure components
export { ContextAssembler, createContextAssembler } from './context-assembler.js'
export { ResultRouter, createResultRouter, DEFAULT_ROUTER_CONFIG } from './result-router.js'
export type { ResultRouterConfig } from './result-router.js'
export { BranchManager, createBranchManager } from './branch-manager.js'
export type { BranchInfo } from './branch-manager.js'

// Connected component analysis for delivery branches
export {
  UnionFind,
  computeConnectedComponents,
  detectStructuralChanges,
  requiresRestart,
} from './connected-components.js'
export type {
  PlanComponent,
  DeliveryBranchRecord,
  DeliveryBranchReconciliation,
} from './connected-components.js'
export {
  selectMachine,
  resetRoundRobin,
} from './machine-selector.js'
export type {
  MachineSelectionPolicy,
  MachineSelectionContext,
  MachineSelectionResult,
} from './machine-selector.js'

// Payload builder
export {
  resolveWorkingDirectory,
  buildDispatchPayload,
  buildDependencyOutputs,
} from './payload.js'
export type {
  WorkingDirSource,
  WorkingDirResult,
  DispatchPayloadOptions,
  DispatchTaskPayload,
} from './payload.js'

// Summary generation
export {
  parseExecutiveSummaryFromOutput,
  runPrSummaryFallbackChain,
} from './summary-utils.js'
export type {
  ExecutiveSummaryParsed,
  PrSummarySource,
  PrSummaryResult,
  PrSummaryFallbackInput,
} from './summary-utils.js'
