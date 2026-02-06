/**
 * Core types for the Nexus Agent Runner CLI
 */

// ============================================================================
// Provider Types
// ============================================================================

export type ProviderType = 'claude-code' | 'codex' | 'custom';

export interface ProviderInfo {
  type: ProviderType;
  name: string;
  version: string | null;
  path: string;
  available: boolean;
  capabilities: ProviderCapabilities;
}

export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  multiTurn: boolean;
  maxConcurrentTasks: number;
}

// ============================================================================
// Machine Resource Types
// ============================================================================

export interface MachineResources {
  hostname: string;
  platform: NodeJS.Platform;
  arch: string;
  cpu: CpuInfo;
  memory: MemoryInfo;
  gpu: GpuInfo[];
}

export interface CpuInfo {
  model: string;
  cores: number;
  speed: number; // MHz
  loadAvg: number[]; // 1, 5, 15 minute averages
}

export interface MemoryInfo {
  total: number; // bytes
  free: number; // bytes
  used: number; // bytes
  usedPercent: number;
}

export interface GpuInfo {
  name: string;
  vendor: string;
  memoryTotal: number; // bytes
  memoryFree: number; // bytes
  utilization: number; // percent
}

// ============================================================================
// Task Types
// ============================================================================

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface Task {
  id: string;
  projectId: string;
  planNodeId: string;
  provider: ProviderType;
  prompt: string;
  workingDirectory: string;
  environment?: Record<string, string>;
  timeout?: number; // ms
  createdAt: string;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  exitCode?: number;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  artifacts?: TaskArtifact[];
}

export interface TaskArtifact {
  type: 'file' | 'log' | 'metric';
  name: string;
  path?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// WebSocket Protocol Types
// ============================================================================

export type WSMessageType =
  // Client -> Server
  | 'register'
  | 'heartbeat'
  | 'task_status'
  | 'task_output'
  | 'task_result'
  | 'resource_update'
  // Server -> Client
  | 'registered'
  | 'heartbeat_ack'
  | 'task_dispatch'
  | 'task_cancel'
  | 'config_update'
  | 'error';

export interface WSMessage {
  type: WSMessageType;
  timestamp: string;
  payload: unknown;
}

// Client -> Server Messages

export interface RegisterMessage extends WSMessage {
  type: 'register';
  payload: {
    runnerId: string;
    machineId: string;
    providers: ProviderInfo[];
    resources: MachineResources;
    version: string;
  };
}

export interface HeartbeatMessage extends WSMessage {
  type: 'heartbeat';
  payload: {
    runnerId: string;
    activeTasks: string[];
    resources: MachineResources;
  };
}

export interface TaskStatusMessage extends WSMessage {
  type: 'task_status';
  payload: {
    taskId: string;
    status: TaskStatus;
    progress?: number; // 0-100
    message?: string;
  };
}

export interface TaskOutputMessage extends WSMessage {
  type: 'task_output';
  payload: {
    taskId: string;
    stream: 'stdout' | 'stderr';
    data: string;
    sequence: number;
  };
}

export interface TaskResultMessage extends WSMessage {
  type: 'task_result';
  payload: TaskResult;
}

export interface ResourceUpdateMessage extends WSMessage {
  type: 'resource_update';
  payload: {
    runnerId: string;
    resources: MachineResources;
  };
}

// Server -> Client Messages

export interface RegisteredMessage extends WSMessage {
  type: 'registered';
  payload: {
    runnerId: string;
    serverTime: string;
    config: RunnerConfig;
  };
}

export interface HeartbeatAckMessage extends WSMessage {
  type: 'heartbeat_ack';
  payload: {
    serverTime: string;
  };
}

export interface TaskDispatchMessage extends WSMessage {
  type: 'task_dispatch';
  payload: Task;
}

export interface TaskCancelMessage extends WSMessage {
  type: 'task_cancel';
  payload: {
    taskId: string;
    reason?: string;
  };
}

export interface ConfigUpdateMessage extends WSMessage {
  type: 'config_update';
  payload: Partial<RunnerConfig>;
}

export interface ErrorMessage extends WSMessage {
  type: 'error';
  payload: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface RunnerConfig {
  relayUrl: string;
  maxConcurrentTasks: number;
  heartbeatInterval: number; // ms
  reconnectMaxRetries: number;
  reconnectBaseDelay: number; // ms
  reconnectMaxDelay: number; // ms
  taskTimeout: number; // ms
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface StoredConfig {
  runnerId: string;
  machineId: string;
  deviceToken?: string;
  relayUrl: string;
  providers: ProviderType[];
  autoStart: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// ============================================================================
// SSH Config Types
// ============================================================================

export interface SSHHost {
  name: string;
  hostname: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
}

export interface DiscoveredHost extends SSHHost {
  source: 'ssh-config' | 'vscode-tunnel' | 'known-hosts';
  agentInstalled?: boolean;
  lastChecked?: string;
}

// ============================================================================
// Device Auth Types
// ============================================================================

/** @deprecated Use DeviceAuthServerResponse instead */
export interface DeviceAuthRequest {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** @deprecated Use DeviceTokenServerResponse instead */
export interface DeviceAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  runnerId: string;
}

/** Response from POST /api/device/authorize */
export interface DeviceAuthServerResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

/** Successful token response from POST /api/device/token */
export interface DeviceTokenServerResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshToken: string;
  scopes: string[];
}

/** Error response from POST /api/device/token (RFC 8628) */
export interface DeviceTokenError {
  error: 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token';
  errorDescription: string;
}

/** Response from POST /api/device/register */
export interface MachineRegisterResponse {
  machineId: string;
  machineName: string;
  relayUrl: string;
  wsToken: string;
  message: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ============================================================================
// Event Types
// ============================================================================

export type RunnerEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'reconnecting'; attempt: number }
  | { type: 'task_received'; task: Task }
  | { type: 'task_started'; taskId: string }
  | { type: 'task_completed'; result: TaskResult }
  | { type: 'task_cancelled'; taskId: string }
  | { type: 'error'; error: Error };

export type RunnerEventHandler = (event: RunnerEvent) => void;
