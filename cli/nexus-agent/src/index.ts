/**
 * Nexus Agent Runner
 *
 * Main entry point for programmatic usage.
 */

export { AgentRunner, type AgentRunnerOptions } from './runner.js'
export { detectSlurm, getPartitionInfo, type SlurmInfo } from './slurm-detect.js'
export { SlurmExecutor } from './slurm-executor.js'
export { loadConfig, saveConfig, generateMachineId, type AgentConfig } from './config.js'
