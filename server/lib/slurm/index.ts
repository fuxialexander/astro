/**
 * Slurm HPC Integration Module
 *
 * This module provides utilities for submitting, monitoring, and managing
 * Slurm jobs from Nexus agent runners on HPC cluster login nodes.
 */

// Types
export * from './types.js'

// Parsers
export * from './parser.js'

// Script generation
export * from './script-generator.js'

// Job management
export {
  checkSlurmAvailable,
  getSlurmVersion,
  getClusterInfo,
  getSlurmMachineCapabilities,
  submitJob,
  submitScriptFile,
  getJobStatus,
  getJobStatusFromSacct,
  getUserJobs,
  getPendingJobs,
  cancelJob,
  cancelJobsByName,
  JobOutputStreamer,
  JobWatcher,
  NexusSlurmJobRegistry,
  nexusSlurmJobRegistry,
} from './job-manager.js'
