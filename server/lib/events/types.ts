/**
 * Nexus Event Transport - Type Definitions
 *
 * Events emitted by task execution lifecycle for post-execution hooks.
 */

import type { PlanNode, Project } from '../../../src/types/index.js'
import type { TaskResult } from '../providers/types.js'
import type { SubroutineDefinition } from '../dispatch/procedure-types.js'

/**
 * Events emitted by task execution lifecycle
 */
export type NexusEvent =
  | TaskStartedEvent
  | TaskProgressEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCancelledEvent
  | BranchPrunedEvent
  | ApprovalRequestedEvent
  | ApprovalRespondedEvent

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
  subroutine?: SubroutineDefinition // Optional for dynamic approvals from MCP tool
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

/**
 * EventEmitter interface for NexusEventTransport
 */
export interface NexusEventTransportEvents {
  event: (event: NexusEvent) => void
  error: (error: Error) => void
}

/**
 * Hook handler signature for post-execution actions
 */
export type EventHook = (event: NexusEvent) => Promise<void> | void
