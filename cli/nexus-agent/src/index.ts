/**
 * Nexus Agent Runner
 *
 * Main entry point for programmatic usage.
 */

export { AgentRunner, type AgentRunnerOptions } from './runner.js'
export { detectSlurm, getPartitionInfo, type SlurmInfo } from './slurm-detect.js'
export { SlurmExecutor } from './slurm-executor.js'
export {
  ClaudeCodeExecutor,
  detectClaudeCode,
  type ClaudeCodeInfo,
  type TaskDispatch,
  type TaskExecutionResult,
  type ExecutionCallbacks,
} from './claude-code-executor.js'
export {
  createWorktree,
  type WorktreeOptions,
  type WorktreeSetup,
} from './worktree.js'
export { loadConfig, saveConfig, generateMachineId, type AgentConfig } from './config.js'
