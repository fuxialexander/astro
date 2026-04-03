/**
 * Desktop frontend type definitions.
 *
 * These are standalone types mirroring the key shapes from @astro/core
 * so the desktop frontend can remain independent of the monorepo's
 * build graph. Keep in sync with packages/core/src/db/schema.ts and
 * packages/core/src/types.ts as needed.
 */

// ── Project ──────────────────────────────────────────────────────────

export interface Project {
  id: string
  ownerId: string
  name: string
  description: string
  visionDoc: string
  status: 'active' | 'archived' | 'deleted'
  startDate?: string | null
  targetDate?: string | null
  lead?: string | null
  health?: 'on_track' | 'at_risk' | 'off_track' | null
  teamId: string
  progress?: number
  labels: Array<{ id: string; name: string; color: string }>
  color?: string
  icon?: string
  workingDirectory?: string | null
  repository?: string | null
  defaultEnvironment?: string | null
  defaultMachineId?: string | null
  deliveryMode?: string | null
  projectType?: 'default' | 'playground' | 'github'
  createdAt: string
  updatedAt: string
}

// ── Plan Node ────────────────────────────────────────────────────────

export type PlanNodeStatus =
  | 'planned'
  | 'dispatched'
  | 'in_progress'
  | 'auto_verified'
  | 'awaiting_approval'
  | 'awaiting_judgment'
  | 'completed'
  | 'pruned'

export interface PlanNode {
  id: string
  projectId: string
  title: string
  description: string
  content?: string | null
  status: PlanNodeStatus
  type?: string | null
  priority?: string | null
  estimate?: string | null
  startDate?: string | null
  endDate?: string | null
  dueDate?: string | null
  milestoneId?: string | null
  executionId?: string | null
  executionOutput?: string | null
  executionError?: string | null
  executionStartedAt?: string | null
  executionCompletedAt?: string | null
  verification?: string | null
  position: { x: number; y: number }
  teamId: string
  createdAt: string
  updatedAt: string
}

// ── Plan Edge ────────────────────────────────────────────────────────

export interface PlanEdge {
  id: string
  projectId: string
  source: string
  target: string
  type?: string | null
  teamId: string
  createdAt: string
}

// ── Task Execution ───────────────────────────────────────────────────

export type ExecutionStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'

export interface TaskExecution {
  id: string
  projectId: string
  nodeId: string
  status: ExecutionStatus
  machineId?: string | null
  userId?: string | null
  summary?: string | null
  deliveryStatus?: string | null
  deliveryError?: string | null
  computeBackend?: string | null
  teamId: string
  createdAt: string
  updatedAt: string
}

// ── Sidecar Status ───────────────────────────────────────────────────

export interface SidecarStatus {
  running: boolean
  pid?: number
  version?: string
  uptime?: number
}

// ── File System Types ────────────────────────────────────────────────

export interface FileEntry {
  path: string
  name: string
  isDir: boolean
  isFile: boolean
  size?: number
  modifiedAt?: number
}

export interface WatcherEvent {
  type: 'create' | 'modify' | 'remove' | 'rename'
  paths: string[]
}

// ── Git Types ─────────────────────────────────────────────────────────

export interface GitStatus {
  staged: string[]
  modified: string[]
  untracked: string[]
  branch: string
}
