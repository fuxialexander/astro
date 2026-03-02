/**
 * Astro Event Transport - Type Definitions
 *
 * Events emitted by task execution lifecycle for post-execution hooks.
 */

import type { PlanNode, Project } from '../../../src/types/index.js'
import type { TaskResult } from '../dispatch/types.js'

/**
 * Events emitted by task execution lifecycle
 */
export type AstroEvent =
  | TaskStartedEvent
  | TaskProgressEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCancelledEvent
  | BranchPrunedEvent
  | ApprovalRequestedEvent
  | ApprovalRespondedEvent
  | MergeQueueFailedEvent
  | MergeQueueSucceededEvent
  | ProjectCompletedEvent

export interface TaskStartedEvent {
  type: 'task.started'
  taskId: string
  nodeId: string
  projectId: string
  executionId: string
  timestamp: Date
  node: PlanNode
  project?: Project
}

export interface TaskProgressEvent {
  type: 'task.progress'
  taskId: string
  nodeId: string
  projectId: string
  executionId: string
  percentage?: number
  message: string
  timestamp: Date
}

export interface TaskCompletedEvent {
  type: 'task.completed'
  taskId: string
  nodeId: string
  projectId: string
  executionId: string
  result: TaskResult
  node: PlanNode
  project?: Project
  timestamp: Date
}

export interface TaskFailedEvent {
  type: 'task.failed'
  taskId: string
  nodeId: string
  projectId: string
  executionId: string
  error: string
  node: PlanNode
  project?: Project
  timestamp: Date
}

export interface TaskCancelledEvent {
  type: 'task.cancelled'
  taskId: string
  nodeId: string
  projectId: string
  executionId: string
  reason?: string
  timestamp: Date
}

export interface BranchPrunedEvent {
  type: 'branch.pruned'
  branchNodeId: string
  projectId: string
  prunedNodes: string[]
  cancelledTasks: string[]
  reason?: string
  timestamp: Date
}

export interface ApprovalRequestedEvent {
  type: 'approval.requested'
  approvalId: string
  nodeId: string
  projectId: string
  executionId: string
  subroutine?: { name: string; approvalMessage?: string; approvalOptions?: string[] } // Optional for dynamic approvals
  message: string
  options?: string[] // If present, multi-choice; if absent, binary approve/reject
  timestamp: Date
}

export interface ApprovalRespondedEvent {
  type: 'approval.responded'
  approvalId: string
  nodeId: string
  projectId: string
  executionId: string
  approved: boolean
  selectedOption?: string // For multi-choice approvals
  timestamp: Date
}

export interface MergeQueueFailedEvent {
  type: 'merge_queue.failed'
  nodeId: string
  projectId: string
  prNumber: number
  reason: 'conflicts' | 'ci_failure' | 'removed' | 'unknown'
  branchName: string
  timestamp: Date
}

export interface MergeQueueSucceededEvent {
  type: 'merge_queue.succeeded'
  nodeId: string
  projectId: string
  prNumber: number
  branchName: string
  mergedSha?: string
  timestamp: Date
}

export interface ProjectCompletedEvent {
  type: 'project.completed'
  projectId: string
  project: Project
  projectBranch: string
  projectPrUrl?: string
  projectPrNumber?: number
  timestamp: Date
}

/**
 * EventEmitter interface for AstroEventTransport
 */
export interface AstroEventTransportEvents {
  event: (event: AstroEvent) => void
  error: (error: Error) => void
}

/**
 * Hook handler signature for post-execution actions
 */
export type EventHook = (event: AstroEvent) => Promise<void> | void
