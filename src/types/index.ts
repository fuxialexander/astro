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
}

export interface PlanEdge {
  id: string;
  source: string;
  target: string;
  type: 'dependency' | 'branch';
}
