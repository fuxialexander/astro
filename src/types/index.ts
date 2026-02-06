export interface Project {
  id: string;
  name: string;
  description: string;
  visionDoc: string;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanNode {
  id: string;
  projectId: string;
  type: 'milestone' | 'task' | 'branch' | 'decision';
  title: string;
  description: string;
  status: 'planned' | 'dispatched' | 'in_progress' | 'auto_verified' | 'awaiting_judgment' | 'completed' | 'pruned';
  parentId: string | null;
  dependencies: string[];
  environment?: 'local' | 'hpc' | 'cloud';
  verification: 'auto' | 'human';
  position: { x: number; y: number };
  startDate?: string;
  endDate?: string;
  createdAt: Date;
  updatedAt: Date;
  // Execution metadata
  executionId?: string;
  executionOutput?: string;
  executionError?: string;
  executionStartedAt?: Date;
  executionCompletedAt?: Date;
}

// Execution state for tracking active task execution
export interface TaskExecution {
  nodeId: string;
  projectId: string;
  executionId: string;
  status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
  streamText: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

// Provider status for displaying in UI
export interface ProviderStatus {
  id: string;
  name: string;
  installed: boolean;
  authStatus: 'authenticated' | 'unauthenticated' | 'expired' | 'unknown';
  available: boolean;
}

export interface PlanEdge {
  id: string;
  source: string;
  target: string;
  type: 'dependency' | 'branch';
}
