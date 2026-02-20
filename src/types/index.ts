export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type Estimate = 'XS' | 'S' | 'M' | 'L' | 'XL';

// Session types for unified chat/execution system
export type SessionType = 'plan-chat' | 'task-chat' | 'steer' | 'execution' | 'plan-generation';
export type SessionStatus = 'active' | 'streaming' | 'completed' | 'error' | 'cancelled';

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  appliedMutations?: {
    nodeUpdates: Array<{ nodeId: string; [key: string]: unknown }>;
    edgeOps: Array<{ action: 'add' | 'remove'; source: string; target: string; type?: string }>;
    newNodes: Array<{ id?: string; title: string; description: string; type?: string; milestoneId?: string; dependencies?: string[]; priority?: string; estimate?: string; environment?: string; verification?: string }>;
  };
}

export interface ExecutionSummary {
  workCompleted: string;
  filesChanged: string[];
  status: 'success' | 'partial' | 'failure';
  followUps: string[];
}

export interface SteerMessage {
  message: string;
  accepted?: boolean;
  ackMessage?: string;
  interrupted?: boolean;
  timestamp: Date;
}

export interface Session {
  id: string;
  type: SessionType;
  status: SessionStatus;
  projectId: string;
  nodeId?: string;
  providerSessionId?: string;
  providerId?: string;
  model?: string;
  messages: SessionMessage[];
  activityEvents?: TaskActivityEvent[];
  toolTraces?: ToolTrace[];
  fileChanges?: FileChange[];
  streamText?: string;
  summary?: ExecutionSummary;
  metrics?: UsageMetrics;
  steerMessages?: SteerMessage[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface Label {
  id: string;
  name: string;
  color: string;  // hex color
}

export interface Initiative {
  id: string;
  name: string;
  description: string;
  goal?: string;
  status: 'active' | 'on_hold' | 'completed' | 'cancelled';
  startDate?: string;     // ISO YYYY-MM-DD
  targetDate?: string;    // ISO YYYY-MM-DD
  lead?: string;
  color?: string;         // hex color for visual grouping
  icon?: string;          // emoji icon
  createdAt: Date;
  updatedAt: Date;
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
  initiativeId?: string;
  progress?: number;      // 0-100
  labels?: Label[];
  color?: string;         // hex color for visual grouping
  icon?: string;          // emoji icon
  workingDirectory?: string; // Absolute path for task execution (cwd for agents)
  repository?: string;       // Git clone URL (e.g., https://github.com/user/repo.git)
  fileTree?: string[];           // Cached git ls-files output (relative paths)
  fileTreeUpdatedAt?: string;    // ISO timestamp for staleness check
  fileTreeMachineId?: string;    // Which machine the cached fileTree belongs to ("local" or machineId)
  defaultEnvironment?: 'local' | 'remote' | 'hpc' | 'cloud'
  defaultMachineId?: string
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanNode {
  id: string;
  projectId: string;
  type: 'milestone' | 'task' | 'branch' | 'decision';
  title: string;
  description: string;
  status: 'planned' | 'dispatched' | 'in_progress' | 'auto_verified' | 'awaiting_judgment' | 'awaiting_approval' | 'completed' | 'pruned';
  parentId: string | null;
  dependencies: string[];
  environment?: 'local' | 'remote' | 'hpc' | 'cloud';
  machineId?: string;            // references a specific registered machine
  verification: 'auto' | 'human';
  position: { x: number; y: number };
  startDate?: string;
  endDate?: string;
  priority?: Priority;
  labelIds?: string[];
  dueDate?: string;       // ISO YYYY-MM-DD, distinct from startDate/endDate
  estimate?: Estimate;
  milestoneId?: string;   // references a PlanNode.id where type=milestone
  boardOrder?: number;    // manual sort order for board reorder (Cmd+drag)
  createdAt: Date;
  updatedAt: Date;
  // Execution metadata
  executionId?: string;
  executionOutput?: string;
  executionError?: string;
  executionStartedAt?: Date;
  executionCompletedAt?: Date;
  // Git PR metadata
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  // Soft-delete metadata
  deletedAt?: Date;
  deletionActionId?: string;
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
  diff?: string;
  timestamp: Date;
}

// Unified activity event for sequential timeline rendering
export type TaskActivityEvent =
  | { type: 'text'; content: string; timestamp: Date }
  | { type: 'tool_use'; id: string; toolName: string; toolInput: unknown; timestamp: Date }
  | { type: 'tool_result'; id: string; toolName: string; toolResult?: unknown; success?: boolean; duration?: number; timestamp: Date }
  | { type: 'steer'; message: string; accepted?: boolean; ackMessage?: string; interrupted?: boolean; timestamp: Date }
  | { type: 'chat_user'; message: string; timestamp: Date }
  | { type: 'chat_assistant'; content: string; timestamp: Date }
  | { type: 'file_change'; path: string; action: string; diff?: string; linesAdded?: number; linesRemoved?: number; timestamp: Date }
  | { type: 'error'; error: string; timestamp: Date }

// Usage metrics from provider execution
export interface UsageMetrics {
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  tokensUsed?: number
  estimatedCostUsd?: number
  model?: string
  turnsUsed?: number
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
  metrics?: UsageMetrics;
  // Unified activity timeline
  activityEvents: TaskActivityEvent[];
  // Git PR metadata
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  // Selected compute backend for execution
  computeBackend?: string;
  // Execution summary (generated post-completion)
  summary?: ExecutionSummary;
  // Subroutine pipeline progress
  subroutineProgress?: {
    name: string;
    index: number;
    total: number;
    status: 'running' | 'completed' | 'failed';
  };
  // Plan mode data (todos and questions from Claude Code plan mode)
  planTodos?: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
  planQuestions?: Array<{
    question: string;
    options: string[];
    answer?: string;
  }>;
}

// Provider status for displaying in UI
export interface ProviderStatus {
  id: string;
  name: string;
  installed: boolean;
  authStatus: 'authenticated' | 'unauthenticated' | 'expired' | 'unknown';
  available: boolean;
  capabilities?: {
    availableModels: string[];
    defaultModel: string;
  };
}

export type EdgeType = 'dependency' | 'branch';

export interface PlanEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  // Soft-delete metadata
  deletedAt?: Date;
  deletionActionId?: string;
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
export type PreferredEnvironment = 'local' | 'remote' | 'hpc' | 'cloud';

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
  // Sidebar configuration (synced via user profile)
  sidebarConfig?: Array<{
    id: string; to: string; icon: string; label: string; visible: boolean; protected: boolean
  }>;
  createdAt: Date;
  updatedAt: Date;
}

// GitHub integration types (re-exported from server types)
export type {
  GitHubRepo,
  GitHubUser,
  GitHubConnection,
  GitHubRepoSelection,
} from '../../server/types/github';

// Device auth and machine registry types (re-exported from server types)
export type {
  RegisteredMachine,
} from '../../server/types/device-auth';

// Command Palette types
export type CommandCategory =
  | 'recent'
  | 'navigation'
  | 'actions'
  | 'projects'
  | 'tasks'
  | 'settings'
  | 'search';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  category: CommandCategory;
  keywords?: string[];
  shortcut?: string;
  action?: () => void | Promise<void>;
  children?: CommandItem[];
  preview?: {
    title: string;
    content: string;
    metadata?: Record<string, string>;
  };
  metadata?: Record<string, unknown>;
}

export interface CommandHistory {
  commandId: string;
  executedAt: Date;
  frequency: number;
}

export interface CommandContext {
  breadcrumbs: CommandItem[];
  selectedItems: string[];
  searchQuery: string;
}
