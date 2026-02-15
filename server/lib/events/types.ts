/**
 * Nexus Event Transport - Type Definitions
 *
 * Events emitted by task execution lifecycle for post-execution hooks.
 */

import type { PlanNode, Project } from '../../../src/types/index.js'
import type { TaskResult } from '../providers/types.js'

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
