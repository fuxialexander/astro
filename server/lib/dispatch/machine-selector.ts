/**
 * Machine Selection Policy
 *
 * Re-exports from @astro/core for backward compatibility.
 */
export {
  selectMachine,
  resetRoundRobin,
} from '../../../packages/core/src/dispatch/machine-selector.js'
export type {
  MachineSelectionPolicy,
  MachineSelectionContext,
  MachineSelectionResult,
} from '../../../packages/core/src/dispatch/machine-selector.js'
