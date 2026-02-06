/**
 * Nexus Agent Runner
 *
 * Main entry point for programmatic usage.
 * Uses the Claude Agent SDK for task execution.
 */

export { AgentRunner, type AgentRunnerOptions } from './runner.js'
export { detectSlurm, getPartitionInfo, type SlurmInfo } from './slurm-detect.js'
export { SlurmExecutor } from './slurm-executor.js'
export { loadConfig, saveConfig, generateMachineId, type AgentConfig } from './config.js'
