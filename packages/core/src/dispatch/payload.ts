/**
 * Dispatch Payload Builder
 *
 * Shared utility for building POST /api/dispatch/task payloads.
 * Used by frontend, CLI, and TUI to ensure consistent dispatch requests.
 */

import type { DeliveryMode, RemoteType, WorktreeStrategy } from '../types.js'
import type { DispatchOrigin, TelegramDispatchContext } from './types.js'

// ── Input types (loose — compatible with both core and CLI Project types) ──

/** Minimal project shape needed by resolveWorkingDirectory */
export interface WorkingDirProject {
  defaultMachineId?: string | null
  workingDirectory?: string | null
  repository?: string | null
  source?: { localPath?: string; remoteType?: string } | null
}

/** Minimal project shape needed by buildDispatchPayload */
export interface DispatchProject extends WorkingDirProject {
  visionDoc?: string | null
  deliveryMode?: string | null
  agentDir?: string | null
  worktreeStrategy?: string | null
}

/** Minimal plan node shape needed by buildDispatchPayload */
export interface DispatchNode {
  id: string
  projectId: string
  title: string
  description: string
  dependencies: string[]
  verification?: string | null
}

/** Minimal plan node shape needed by buildDependencyOutputs */
export interface DependencyNode {
  id: string
  projectId: string
  title: string
  executionOutput?: string | null
  status?: string | null
  type?: string | null
}

// ── Output types ────────────────────────────────────────────────────

export type WorkingDirSource = 'local' | 'repository' | 'remote-path' | 'auto-workspace'

export interface WorkingDirResult {
  ok: boolean
  dir?: string
  source?: WorkingDirSource
  message?: string
}

/** A secondary folder mounted into the agent session alongside the primary workingDirectory. */
export interface AdditionalFolder {
  /** Machine where the folder lives. Usually matches primary, but may differ. */
  machineId: string
  /** Path on that machine. */
  path: string
  /** 'working' = agent can edit (isolated via worktree); 'reference' = read-only context. */
  mode: 'working' | 'reference'
}

/** Options that callers can override per-dispatch */
export interface DispatchPayloadOptions {
  targetMachineId?: string
  model?: string
  maxTurns?: number
  force?: boolean
  computeBackend?: string
  useWorktree?: boolean
  preferredProvider?: string
  /** Explicit target branch for the primary worktree. Wins over project/detection defaults. */
  baseBranch?: string
  /** Extra folders to mount alongside the primary workingDirectory. */
  additionalFolders?: AdditionalFolder[]
  /** Origin of the dispatch request */
  dispatchOrigin?: DispatchOrigin
  /** Telegram context when dispatched from Telegram */
  telegramContext?: TelegramDispatchContext
}

/** The full payload shape accepted by POST /api/dispatch/task */
export interface DispatchTaskPayload {
  nodeId: string
  projectId: string
  title: string
  description: string
  dependencies?: string[]
  verification?: 'auto' | 'human'
  visionDoc?: string
  dependencyOutputs?: Array<{ nodeId: string; title: string; output: string }>
  preferredProvider?: string
  targetMachineId?: string
  model?: string
  maxTurns?: number
  workingDirectory: string
  computeBackend?: string
  deliveryMode?: DeliveryMode
  remoteType?: RemoteType
  agentDir?: string
  worktreeStrategy?: WorktreeStrategy
  useWorktree?: boolean
  force?: boolean
  /** Explicit target branch for the primary worktree. Wins over project/detection defaults. */
  baseBranch?: string
  /** Extra folders to mount alongside the primary workingDirectory. */
  additionalFolders?: AdditionalFolder[]
  /** Origin of the dispatch request */
  dispatchOrigin?: DispatchOrigin
  /** Telegram context when dispatched from Telegram */
  telegramContext?: TelegramDispatchContext
}

// ── resolveWorkingDirectory ──────────────────────────────────────────

/**
 * Resolve the working directory for a project.
 *
 * Priority:
 *   1. defaultMachineId + workingDirectory (no repository) → remote-path
 *   2. source.localPath or workingDirectory → local
 *   3. repository (git URL) → repository
 *   4. auto-workspace (agent-runner auto-provisions)
 */
export function resolveWorkingDirectory(
  project: WorkingDirProject | undefined | null,
): WorkingDirResult {
  if (!project) {
    return { ok: false, message: 'No project provided.' }
  }

  // Remote-path case: code only exists on a specific machine
  if (project.defaultMachineId && project.workingDirectory && !project.repository) {
    return { ok: true, dir: project.workingDirectory, source: 'remote-path' }
  }

  // Local path (source.localPath preferred, then workingDirectory)
  const localPath = project.source?.localPath ?? project.workingDirectory
  if (localPath) {
    return { ok: true, dir: localPath, source: 'local' }
  }

  // Git URL fallback — server will clone/resolve
  if (project.repository) {
    return { ok: true, dir: project.repository, source: 'repository' }
  }

  // No explicit dir — agent-runner will auto-provision a workspace
  return {
    ok: true,
    dir: undefined,
    source: 'auto-workspace',
  }
}

// ── buildDispatchPayload ─────────────────────────────────────────────

/**
 * Build the full dispatch payload from a plan node and project.
 *
 * Throws if the working directory cannot be resolved.
 */
export function buildDispatchPayload(
  node: DispatchNode,
  project: DispatchProject,
  options?: DispatchPayloadOptions,
): DispatchTaskPayload {
  const dirResult = resolveWorkingDirectory(project)
  if (!dirResult.ok) {
    throw new Error(dirResult.message || 'Cannot resolve working directory')
  }

  return {
    nodeId: node.id,
    projectId: node.projectId,
    title: node.title,
    description: node.description || node.title,
    dependencies: node.dependencies,
    verification: (node.verification as 'auto' | 'human') || undefined,
    visionDoc: project.visionDoc || undefined,
    workingDirectory: dirResult.dir || '',
    deliveryMode: (project.deliveryMode as DeliveryMode) || undefined,
    remoteType: (project.source?.remoteType as RemoteType) || undefined,
    agentDir: project.agentDir || undefined,
    worktreeStrategy: (project.worktreeStrategy as WorktreeStrategy) || undefined,
    ...(options?.targetMachineId && { targetMachineId: options.targetMachineId }),
    ...(options?.model && { model: options.model }),
    ...(options?.maxTurns != null && { maxTurns: options.maxTurns }),
    ...(options?.force && { force: options.force }),
    ...(options?.computeBackend && { computeBackend: options.computeBackend }),
    ...(options?.useWorktree != null && { useWorktree: options.useWorktree }),
    ...(options?.preferredProvider && { preferredProvider: options.preferredProvider }),
    ...(options?.baseBranch && { baseBranch: options.baseBranch }),
    ...(options?.additionalFolders && options.additionalFolders.length > 0 && { additionalFolders: options.additionalFolders }),
    ...(options?.dispatchOrigin && { dispatchOrigin: options.dispatchOrigin }),
    ...(options?.telegramContext && { telegramContext: options.telegramContext }),
  }
}

// ── buildDependencyOutputs ───────────────────────────────────────────

/**
 * Build the dependencyOutputs array from completed dependency nodes.
 * Filters to same project to avoid cross-project ID collisions.
 */
export function buildDependencyOutputs(
  dependencyIds: string[],
  allNodes: DependencyNode[],
  projectId?: string,
): Array<{ nodeId: string; title: string; output: string }> {
  const searchNodes = projectId
    ? allNodes.filter((n) => n.projectId === projectId)
    : allNodes

  const outputs: Array<{ nodeId: string; title: string; output: string }> = []
  for (const depId of dependencyIds) {
    const depNode = searchNodes.find((n) => n.id === depId)
    if (depNode?.executionOutput) {
      outputs.push({
        nodeId: depNode.id,
        title: depNode.title,
        output: depNode.executionOutput,
      })
    } else if (depNode && (depNode.status === 'completed' || depNode.status === 'auto_verified')) {
      // Milestones and tasks without output but with completed status
      // still satisfy dependencies
      outputs.push({
        nodeId: depNode.id,
        title: depNode.title,
        output: `[${depNode.type || 'node'} ${depNode.status}]`,
      })
    }
  }
  return outputs
}
