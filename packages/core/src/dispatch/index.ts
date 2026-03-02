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

// Summary generation (direct Anthropic API call)
export { generateServerSideSummary, parseExecutiveSummaryFromOutput } from './summary-utils.js'
export type { SummaryInput, ExecutiveSummaryParsed } from './summary-utils.js'
