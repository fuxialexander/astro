/**
 * Slurm Batch Script Generator
 *
 * Generates SBATCH scripts from Nexus task configurations.
 */

import type {
  SlurmJobConfig,
  SlurmResourceRequirements,
  SlurmResourceHints,
  SlurmArraySpec,
  SlurmJobDependency,
} from './types.js'

// ============================================================================
// Script Generation
// ============================================================================

/**
 * Generate a Slurm batch script from job configuration
 */
export function generateBatchScript(config: SlurmJobConfig): string {
  const lines: string[] = []

  // Shebang
  lines.push('#!/bin/bash')
  lines.push('')

  // Job name
  lines.push(`#SBATCH --job-name=${escapeValue(config.name)}`)

  // Working directory
  if (config.workdir) {
    lines.push(`#SBATCH --chdir=${config.workdir}`)
  }

  // Output files
  if (config.output) {
    lines.push(`#SBATCH --output=${config.output}`)
  } else {
    lines.push(`#SBATCH --output=${config.name}_%j.out`)
  }

  if (config.error) {
    lines.push(`#SBATCH --error=${config.error}`)
  } else {
    lines.push(`#SBATCH --error=${config.name}_%j.err`)
  }

  // Resource requirements
  lines.push(...generateResourceDirectives(config.resources))

  // Job array
  if (config.array) {
    lines.push(generateArrayDirective(config.array))
  }

  // Dependencies
  if (config.dependencies && config.dependencies.length > 0) {
    lines.push(generateDependencyDirective(config.dependencies))
  }

  // Email notifications
  if (config.mailUser) {
    lines.push(`#SBATCH --mail-user=${config.mailUser}`)
    const mailTypes = config.mailType?.join(',') || 'FAIL'
    lines.push(`#SBATCH --mail-type=${mailTypes}`)
  }

  lines.push('')

  // Script body
  lines.push('# Exit on error')
  lines.push('set -e')
  lines.push('')

  // Print job info
  lines.push('# Print job info')
  lines.push('echo "Job ID: $SLURM_JOB_ID"')
  lines.push('echo "Job Name: $SLURM_JOB_NAME"')
  lines.push('echo "Node: $SLURMD_NODENAME"')
  lines.push('echo "Start time: $(date)"')
  lines.push('echo "Working directory: $(pwd)"')
  lines.push('')

  // Environment setup
  if (config.modules && config.modules.length > 0) {
    lines.push('# Load modules')
    for (const mod of config.modules) {
      lines.push(`module load ${mod}`)
    }
    lines.push('')
  }

  // Environment variables
  if (config.environment && Object.keys(config.environment).length > 0) {
    lines.push('# Set environment variables')
    for (const [key, value] of Object.entries(config.environment)) {
      lines.push(`export ${key}="${escapeValue(value)}"`)
    }
    lines.push('')
  }

  // Commands
  lines.push('# Execute commands')
  for (const cmd of config.commands) {
    lines.push(cmd)
  }

  lines.push('')
  lines.push('# Print completion info')
  lines.push('echo "End time: $(date)"')
  lines.push('echo "Exit code: $?"')

  return lines.join('\n')
}

/**
 * Generate SBATCH directives for resource requirements
 */
function generateResourceDirectives(resources: SlurmResourceRequirements): string[] {
  const directives: string[] = []

  if (resources.partition) {
    directives.push(`#SBATCH --partition=${resources.partition}`)
  }

  if (resources.nodes) {
    directives.push(`#SBATCH --nodes=${resources.nodes}`)
  }

  if (resources.ntasks) {
    directives.push(`#SBATCH --ntasks=${resources.ntasks}`)
  }

  if (resources.ntasksPerNode) {
    directives.push(`#SBATCH --ntasks-per-node=${resources.ntasksPerNode}`)
  }

  if (resources.cpusPerTask) {
    directives.push(`#SBATCH --cpus-per-task=${resources.cpusPerTask}`)
  }

  if (resources.mem) {
    directives.push(`#SBATCH --mem=${resources.mem}`)
  } else if (resources.memPerCpu) {
    directives.push(`#SBATCH --mem-per-cpu=${resources.memPerCpu}`)
  }

  if (resources.gpu) {
    const gpuSpec = resources.gpu.type
      ? `${resources.gpu.type}:${resources.gpu.count}`
      : resources.gpu.count.toString()
    directives.push(`#SBATCH --gres=gpu:${gpuSpec}`)
  }

  if (resources.time) {
    directives.push(`#SBATCH --time=${resources.time}`)
  }

  if (resources.qos) {
    directives.push(`#SBATCH --qos=${resources.qos}`)
  }

  if (resources.account) {
    directives.push(`#SBATCH --account=${resources.account}`)
  }

  if (resources.constraint) {
    directives.push(`#SBATCH --constraint=${resources.constraint}`)
  }

  if (resources.exclude) {
    directives.push(`#SBATCH --exclude=${resources.exclude}`)
  }

  if (resources.nodelist) {
    directives.push(`#SBATCH --nodelist=${resources.nodelist}`)
  }

  return directives
}

/**
 * Generate job array directive
 */
function generateArrayDirective(array: SlurmArraySpec): string {
  let spec = array.range
  if (array.maxConcurrent) {
    spec += `%${array.maxConcurrent}`
  }
  return `#SBATCH --array=${spec}`
}

/**
 * Generate dependency directive
 */
function generateDependencyDirective(dependencies: SlurmJobDependency[]): string {
  const depSpecs = dependencies.map(dep => {
    return `${dep.type}:${dep.jobIds.join(':')}`
  })
  return `#SBATCH --dependency=${depSpecs.join(',')}`
}

/**
 * Escape value for SBATCH directive or shell variable
 */
function escapeValue(value: string): string {
  // Escape special characters
  return value.replace(/"/g, '\\"').replace(/\$/g, '\\$')
}

// ============================================================================
// Resource Hint Parsing
// ============================================================================

/**
 * Parse resource hints from task description
 * Looks for patterns like "GPU: 4", "Memory: 32GB", "Time: 2 hours", etc.
 */
export function parseResourceHints(description: string): SlurmResourceHints {
  const hints: SlurmResourceHints = {}

  // Parse GPU requirements
  const gpuMatch = description.match(/(?:gpu|GPU)[s:]?\s*(\d+)/i)
  if (gpuMatch) {
    hints.gpus = parseInt(gpuMatch[1])
  }

  // Parse GPU type
  const gpuTypeMatch = description.match(/(?:gpu|GPU)\s+type[s:]?\s*([a-zA-Z0-9]+)/i)
  if (gpuTypeMatch) {
    hints.gpuType = gpuTypeMatch[1].toLowerCase()
  }

  // Parse specific GPU types mentioned
  const specificGpuMatch = description.match(/\b(a100|v100|h100|rtx\s*\d+|tesla)\b/i)
  if (specificGpuMatch && !hints.gpuType) {
    hints.gpuType = specificGpuMatch[1].toLowerCase().replace(/\s/g, '')
  }

  // Parse memory requirements
  const memMatch = description.match(/(?:memory|mem|ram)[:]?\s*(\d+)\s*(gb|g|mb|m)?/i)
  if (memMatch) {
    let memMB = parseInt(memMatch[1])
    const unit = (memMatch[2] || 'g').toLowerCase()
    if (unit === 'g' || unit === 'gb') {
      memMB *= 1024
    }
    hints.memoryMB = memMB
  }

  // Parse time limit
  const timeMatch = description.match(/(?:time|duration|wall\s*time)[:]?\s*(\d+)\s*(hour|hr|h|min|m|day|d)?/i)
  if (timeMatch) {
    let minutes = parseInt(timeMatch[1])
    const unit = (timeMatch[2] || 'h').toLowerCase()
    if (unit === 'h' || unit === 'hr' || unit === 'hour') {
      minutes *= 60
    } else if (unit === 'd' || unit === 'day') {
      minutes *= 60 * 24
    }
    hints.timeLimitMinutes = minutes
  }

  // Parse CPU requirements
  const cpuMatch = description.match(/(?:cpu|cpus|cores)[:]?\s*(\d+)/i)
  if (cpuMatch) {
    hints.cpus = parseInt(cpuMatch[1])
  }

  // Parse node count
  const nodeMatch = description.match(/(?:nodes|node)[:]?\s*(\d+)/i)
  if (nodeMatch) {
    hints.nodes = parseInt(nodeMatch[1])
  }

  // Parse partition preference
  const partitionMatch = description.match(/(?:partition|queue)[:]?\s*([a-zA-Z0-9_-]+)/i)
  if (partitionMatch) {
    hints.partition = partitionMatch[1]
  }

  // Extract SBATCH directives directly from description
  const sbatchMatches = description.match(/#SBATCH\s+[^\n]+/g)
  if (sbatchMatches) {
    hints.sbatchDirectives = sbatchMatches
  }

  return hints
}

/**
 * Merge resource hints with default requirements
 */
export function mergeResourceHints(
  defaults: SlurmResourceRequirements,
  hints: SlurmResourceHints
): SlurmResourceRequirements {
  const merged: SlurmResourceRequirements = { ...defaults }

  if (hints.partition) {
    merged.partition = hints.partition
  }

  if (hints.nodes) {
    merged.nodes = hints.nodes
  }

  if (hints.cpus) {
    merged.cpusPerTask = hints.cpus
  }

  if (hints.memoryMB) {
    merged.mem = `${hints.memoryMB}M`
  }

  if (hints.timeLimitMinutes) {
    merged.time = formatTimeLimit(hints.timeLimitMinutes)
  }

  if (hints.gpus) {
    merged.gpu = {
      count: hints.gpus,
      type: hints.gpuType,
    }
  }

  return merged
}

/**
 * Format time limit in Slurm format (HH:MM:SS or D-HH:MM:SS)
 */
export function formatTimeLimit(minutes: number): string {
  const days = Math.floor(minutes / (60 * 24))
  const hours = Math.floor((minutes % (60 * 24)) / 60)
  const mins = minutes % 60

  if (days > 0) {
    return `${days}-${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`
  }
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`
}

// ============================================================================
// Task to Job Config Conversion
// ============================================================================

/**
 * Default resource requirements for different task types
 */
export const DEFAULT_RESOURCES: Record<string, SlurmResourceRequirements> = {
  default: {
    nodes: 1,
    ntasks: 1,
    cpusPerTask: 4,
    mem: '8G',
    time: '02:00:00',
  },
  gpu: {
    nodes: 1,
    ntasks: 1,
    cpusPerTask: 8,
    mem: '32G',
    time: '08:00:00',
    gpu: { count: 1 },
  },
  multiGpu: {
    nodes: 1,
    ntasks: 1,
    cpusPerTask: 16,
    mem: '64G',
    time: '24:00:00',
    gpu: { count: 4 },
  },
  distributed: {
    nodes: 4,
    ntasksPerNode: 1,
    cpusPerTask: 8,
    mem: '32G',
    time: '12:00:00',
    gpu: { count: 1 },
  },
  interactive: {
    nodes: 1,
    ntasks: 1,
    cpusPerTask: 2,
    mem: '4G',
    time: '01:00:00',
  },
}

/**
 * Infer resource profile from task description
 */
export function inferResourceProfile(description: string): keyof typeof DEFAULT_RESOURCES {
  const lower = description.toLowerCase()

  // Check for distributed training keywords
  if (lower.includes('distributed') || lower.includes('multi-node') || lower.includes('ddp')) {
    return 'distributed'
  }

  // Check for multi-GPU keywords
  if (lower.match(/\d+\s*gpu/i) && parseInt(lower.match(/(\d+)\s*gpu/i)![1]) > 1) {
    return 'multiGpu'
  }

  // Check for GPU keywords
  if (
    lower.includes('gpu') ||
    lower.includes('cuda') ||
    lower.includes('training') ||
    lower.includes('deep learning') ||
    lower.includes('neural network') ||
    lower.includes('pytorch') ||
    lower.includes('tensorflow')
  ) {
    return 'gpu'
  }

  // Check for interactive keywords
  if (lower.includes('interactive') || lower.includes('debug') || lower.includes('test')) {
    return 'interactive'
  }

  return 'default'
}

/**
 * Convert Nexus task dispatch to Slurm job config
 */
export interface TaskToJobOptions {
  taskId: string
  title: string
  description: string
  workingDirectory?: string
  environment?: Record<string, string>
  modules?: string[]
  defaultAccount?: string
  defaultPartition?: string
  commands: string[]
}

export function taskToJobConfig(options: TaskToJobOptions): SlurmJobConfig {
  const hints = parseResourceHints(options.description)
  const profile = inferResourceProfile(options.description)
  const baseResources = DEFAULT_RESOURCES[profile]
  const resources = mergeResourceHints(baseResources, hints)

  // Add account and partition from defaults if not specified
  if (options.defaultAccount && !resources.account) {
    resources.account = options.defaultAccount
  }
  if (options.defaultPartition && !resources.partition) {
    resources.partition = options.defaultPartition
  }

  // Create job config
  const config: SlurmJobConfig = {
    name: sanitizeJobName(options.title),
    workdir: options.workingDirectory,
    output: options.workingDirectory
      ? `${options.workingDirectory}/nexus_${options.taskId}_%j.out`
      : `nexus_${options.taskId}_%j.out`,
    error: options.workingDirectory
      ? `${options.workingDirectory}/nexus_${options.taskId}_%j.err`
      : `nexus_${options.taskId}_%j.err`,
    resources,
    environment: {
      NEXUS_TASK_ID: options.taskId,
      ...options.environment,
    },
    modules: options.modules,
    commands: options.commands,
  }

  // Add SBATCH directives from hints if any
  if (hints.sbatchDirectives && hints.sbatchDirectives.length > 0) {
    // These would need to be parsed and integrated into resources
    // For now, we can add them as a comment
    config.commands.unshift(
      '# Additional SBATCH directives from task description:',
      ...hints.sbatchDirectives.map(d => `# ${d}`)
    )
  }

  return config
}

/**
 * Sanitize job name for Slurm (alphanumeric, underscore, dash only)
 */
function sanitizeJobName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 64) // Slurm job name limit
}
