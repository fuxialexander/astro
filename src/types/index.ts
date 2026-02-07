export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type Estimate = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface Label {
  id: string;
  name: string;
  color: string;  // hex color
}

export interface Project {
  id: string;
  name: string;
  description: string;
  visionDoc: string;
  status: 'active' | 'archived';
  startDate?: string;     // ISO YYYY-MM-DD
  targetDate?: string;    // ISO YYYY-MM-DD
  lead?: string;
  health?: 'on_track' | 'at_risk' | 'off_track';
  initiative?: string;
  progress?: number;      // 0-100
  labels?: Label[];
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
  priority?: Priority;
  labelIds?: string[];
  dueDate?: string;       // ISO YYYY-MM-DD, distinct from startDate/endDate
  estimate?: Estimate;
  milestoneId?: string;   // references a PlanNode.id where type=milestone
  createdAt: Date;
  updatedAt: Date;
  // Execution metadata
  executionId?: string;
  executionOutput?: string;
  executionError?: string;
  executionStartedAt?: Date;
  executionCompletedAt?: Date;
}

// Tool trace for execution detail view
export interface ToolTrace {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown> | unknown;
  toolResult?: unknown;
  success?: boolean;
  duration?: number;
  timestamp: Date;
}

// File change for execution detail view
export interface FileChange {
  path: string;
  action: 'create' | 'modify' | 'delete';
  linesAdded?: number;
  linesRemoved?: number;
  timestamp: Date;
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
  // Rich execution data
  toolTraces: ToolTrace[];
  fileChanges: FileChange[];
  sessionId?: string;
  machineId?: string;
  providerId?: string;
  providerName?: string;
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

// Domain expertise options for planning personalization
export type DomainExpertise =
  | 'computational-biology'
  | 'web-development'
  | 'data-engineering'
  | 'ml-ai'
  | 'devops-infrastructure'
  | 'mobile-development'
  | 'systems-programming'
  | 'scientific-computing'
  | 'security'
  | 'other';

// Experience level for calibrating plan granularity
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

// Preferred environment for task dispatch
export type PreferredEnvironment = 'local' | 'hpc' | 'cloud';

// API key entry for agent providers
export interface ApiKey {
  id: string;
  provider: string;
  name: string;
  maskedKey: string;  // Only store masked version for display
  createdAt: Date;
}

// User profile for identity and domain context
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  // Domain expertise for planning personalization (Vision Section 5)
  domains: DomainExpertise[];
  experienceLevel: ExperienceLevel;
  // Preferences
  preferredEnvironments: PreferredEnvironment[];
  notificationsEnabled: boolean;
  emailNotifications: boolean;
  // API keys for agent providers
  apiKeys: ApiKey[];
  createdAt: Date;
  updatedAt: Date;
}
