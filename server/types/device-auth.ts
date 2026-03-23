/**
 * Device Authentication Flow Types
 *
 * Implements OAuth2 Device Authorization Grant (RFC 8628)
 * for registering machines with the platform.
 *
 * Flow:
 * 1. Agent runner requests device code → /api/device/authorize
 * 2. User visits verification URL and enters code
 * 3. Agent runner polls for authorization → /api/device/token
 * 4. On success, agent registers machine → /api/device/register
 */

import type { MachineInfo, ProviderType } from './relay';

// ============================================================================
// Device Authorization Types
// ============================================================================

/** Status of device authorization */
export type DeviceAuthStatus =
  | 'pending'           // Waiting for user authorization
  | 'authorized'        // User has authorized
  | 'denied'            // User denied authorization
  | 'expired'           // Code expired
  | 'used';             // Code already used

/** Request to initiate device authorization */
export interface DeviceAuthRequest {
  /** Client identifier (optional, for tracking) */
  clientId?: string;
  /** Requested scopes */
  scopes?: string[];
  /** Machine metadata for display */
  machineInfo?: {
    hostname?: string;
    platform?: string;
    environmentType?: string;
  };
}

/** Response from device authorization request */
export interface DeviceAuthResponse {
  /** The device verification code (user-facing, e.g., "ABCD-1234") */
  deviceCode: string;
  /** The user code (internal, for polling) */
  userCode: string;
  /** URL where user should authenticate */
  verificationUri: string;
  /** Complete URL with code pre-filled */
  verificationUriComplete: string;
  /** Seconds until code expires */
  expiresIn: number;
  /** Minimum polling interval in seconds */
  interval: number;
}

/** Request to poll for token */
export interface DeviceTokenRequest {
  /** The user code from authorization response */
  userCode: string;
  /** Grant type (always 'urn:ietf:params:oauth:grant-type:device_code') */
  grantType: 'urn:ietf:params:oauth:grant-type:device_code';
}

/** Token response on successful authorization */
export interface DeviceTokenResponse {
  /** Access token (JWT) */
  accessToken: string;
  /** Token type (always 'Bearer') */
  tokenType: 'Bearer';
  /** Seconds until access token expires */
  expiresIn: number;
  /** Refresh token for obtaining new access tokens */
  refreshToken: string;
  /** Granted scopes */
  scopes: string[];
  /** ECDSA P-256 dispatch signing public key (JWK format), if provided during authorization */
  dispatchPublicKey?: JsonWebKey;
}

/** Error response during polling */
export interface DeviceTokenError {
  /** Error code per RFC 8628 */
  error:
    | 'authorization_pending'  // User hasn't completed auth yet
    | 'slow_down'              // Polling too fast
    | 'access_denied'          // User denied
    | 'expired_token';         // Code expired
  /** Human-readable error description */
  errorDescription: string;
}

// ============================================================================
// Machine Registration Types
// ============================================================================

/** Request to register an authenticated machine */
export interface MachineRegisterRequest {
  /** Access token from device auth flow */
  accessToken: string;
  /** Machine information */
  machineInfo: MachineInfo;
}

/** Response after successful machine registration */
export interface MachineRegisterResponse {
  /** Unique machine ID assigned by platform */
  machineId: string;
  /** Display name for the machine */
  machineName: string;
  /** WebSocket URL for relay connection */
  relayUrl: string;
  /** JWT for WebSocket authentication */
  wsToken: string;
  /** User-friendly message */
  message: string;
  /** ECDSA P-256 dispatch signing public key (JWK format) */
  dispatchPublicKey?: JsonWebKey;
}

// ============================================================================
// Token Management Types
// ============================================================================

/** Refresh token request */
export interface TokenRefreshRequest {
  /** The refresh token */
  refreshToken: string;
  /** Grant type (always 'refresh_token') */
  grantType: 'refresh_token';
}

/** Refresh token response */
export interface TokenRefreshResponse {
  /** New access token */
  accessToken: string;
  /** Token type */
  tokenType: 'Bearer';
  /** Seconds until expiration */
  expiresIn: number;
  /** New refresh token (optional, if rotated) */
  refreshToken?: string;
  /** New WebSocket token for relay connection */
  wsToken?: string;
}

/** Token revocation request */
export interface TokenRevokeRequest {
  /** Token to revoke (access or refresh) */
  token: string;
  /** Token type hint */
  tokenTypeHint?: 'access_token' | 'refresh_token';
}

// ============================================================================
// Registered Machine Types
// ============================================================================

/** Provider configuration for a machine */
export interface ProviderConfig {
  /** Provider identifier (anthropic, openai, etc.) */
  provider: string;
  /** API key (encrypted/masked) */
  apiKey?: string;
  /** Default model for this provider */
  defaultModel?: string;
  /** Whether this provider is enabled */
  enabled: boolean;
  /** Additional provider-specific settings */
  settings?: Record<string, unknown>;
}

/** Registered machine entry in the database */
export interface RegisteredMachine {
  /** Unique machine ID */
  id: string;
  /** User-friendly name */
  name: string;
  /** Hostname of the machine */
  hostname: string;
  /** Platform (darwin, linux, win32) */
  platform: string;
  /** Environment type (legacy, unused) */
  environmentType?: string;
  /** Available providers */
  providers: ProviderType[];
  /** Provider configurations (API keys, models, settings) */
  providerConfigs?: ProviderConfig[];
  /** User ID who registered this machine */
  userId: string;
  /** @deprecated Use teamIds instead — kept for backward compat */
  teamId?: string;
  /** Team IDs this machine is shared with */
  teamIds?: string[];
  /** Workspace ID (if applicable) */
  workspaceId?: string;
  /** Registration timestamp */
  registeredAt: Date;
  /** Last connection timestamp */
  lastSeenAt: Date;
  /** Whether machine is currently connected */
  isConnected: boolean;
  /** Refresh token hash (for revocation) */
  refreshTokenHash: string;
  /** Token revoked flag */
  isRevoked: boolean;
  /** Default machine instruction ID for prompt injection */
  defaultInstructionId?: string | null;
  /** Machine-specific metadata */
  metadata?: Record<string, string>;
  /** ECDSA P-256 dispatch signing public key (JWK format) */
  dispatchPublicKey?: JsonWebKey;
}

// ============================================================================
// Internal Storage Types
// ============================================================================

/** Device code entry (stored during auth flow) */
export interface DeviceCodeEntry {
  /** User-facing device code */
  deviceCode: string;
  /** Internal user code for polling */
  userCode: string;
  /** Requested scopes */
  scopes: string[];
  /** Machine info provided during request */
  machineInfo?: DeviceAuthRequest['machineInfo'];
  /** Current status */
  status: DeviceAuthStatus;
  /** Expiration timestamp */
  expiresAt: Date;
  /** Created timestamp */
  createdAt: Date;
  /** User ID who authorized (if authorized) */
  authorizedBy?: string;
  /** Authorization timestamp */
  authorizedAt?: Date;
  /** Last poll timestamp (for rate limiting) */
  lastPolledAt?: Date;
  /** ECDSA P-256 dispatch signing public key (JWK format) */
  dispatchPublicKey?: JsonWebKey;
}

/** Refresh token entry (stored for validation) */
export interface RefreshTokenEntry {
  /** Token hash (never store raw token) */
  tokenHash: string;
  /** Associated machine ID */
  machineId: string;
  /** User ID */
  userId: string;
  /** Workspace ID */
  workspaceId?: string;
  /** Granted scopes */
  scopes: string[];
  /** Expiration timestamp */
  expiresAt: Date;
  /** Created timestamp */
  createdAt: Date;
  /** Whether token is revoked */
  isRevoked: boolean;
}

// ============================================================================
// JWT Payload Types
// ============================================================================

/** Access token JWT payload */
export interface AccessTokenPayload {
  /** Subject (machine ID) */
  sub: string;
  /** Issued at */
  iat: number;
  /** Expiration */
  exp: number;
  /** Token type */
  type: 'access';
  /** Machine ID */
  machineId: string;
  /** User ID */
  userId: string;
  /** Workspace ID */
  workspaceId?: string;
  /** Granted scopes */
  scopes: string[];
}

/** Refresh token JWT payload */
export interface RefreshTokenPayload {
  /** Subject (token ID) */
  sub: string;
  /** Issued at */
  iat: number;
  /** Expiration */
  exp: number;
  /** Token type */
  type: 'refresh';
  /** Machine ID */
  machineId: string;
  /** User ID */
  userId: string;
}

// ============================================================================
// API Response Types
// ============================================================================

/** Generic success response */
export interface DeviceAuthSuccess<T = unknown> {
  success: true;
  data: T;
}

/** Generic error response */
export interface DeviceAuthError {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

/** Combined response type */
export type DeviceAuthResult<T = unknown> = DeviceAuthSuccess<T> | DeviceAuthError;

// ============================================================================
// Constants
// ============================================================================

/** Default token expiration times */
export const TOKEN_EXPIRY = {
  /** Device code expires in 15 minutes */
  DEVICE_CODE: 15 * 60,
  /** Access token expires in 1 hour */
  ACCESS_TOKEN: 60 * 60,
  /** Refresh token expires in 30 days */
  REFRESH_TOKEN: 30 * 24 * 60 * 60,
} as const;

/** Default polling interval in seconds */
export const DEFAULT_POLL_INTERVAL = 5;

/** Available scopes for machine tokens */
export const MACHINE_SCOPES = {
  /** Basic connection and task execution */
  CONNECT: 'machine:connect',
  /** Execute tasks */
  EXECUTE: 'machine:execute',
  /** Read task results */
  READ: 'machine:read',
  /** Full machine access */
  ALL: 'machine:*',
} as const;

/** Default scopes granted to machines */
export const DEFAULT_MACHINE_SCOPES = [
  MACHINE_SCOPES.CONNECT,
  MACHINE_SCOPES.EXECUTE,
  MACHINE_SCOPES.READ,
];

// ============================================================================
// Machine Usage Tracking Types
// ============================================================================

/** Machine usage log entry */
export interface MachineUsageLog {
  /** Log entry ID */
  id: string;
  /** Machine ID */
  machineId: string;
  /** User who executed the task */
  userId: string;
  /** Project ID */
  projectId: string;
  /** Plan node ID */
  nodeId: string;
  /** Execution ID */
  executionId: string;
  /** Task started timestamp */
  startedAt: Date;
  /** Task completed timestamp */
  completedAt?: Date;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Execution status */
  status: 'success' | 'failure' | 'cancelled';
  /** Created timestamp */
  createdAt: Date;
}

/** Extended machine info with team context */
export interface MachineWithTeamInfo extends RegisteredMachine {
  /** Whether this is a team-shared machine */
  isTeamMachine: boolean;
  /** @deprecated Use teamNames instead */
  teamName?: string;
  /** Team names if shared with multiple teams */
  teamNames?: string[];
}
