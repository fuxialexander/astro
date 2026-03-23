/**
 * Device authentication types (shared subset)
 *
 * Only the types needed by frontend/core. Full device auth types
 * (JWT payloads, internal storage, etc.) remain in server/types/device-auth.ts.
 */

import type { ProviderType } from './relay.js'

/** Provider configuration for a machine */
export interface ProviderConfig {
  provider: string;
  apiKey?: string;
  defaultModel?: string;
  enabled: boolean;
  settings?: Record<string, unknown>;
}

/** Registered machine entry */
export interface RegisteredMachine {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  environmentType?: string;
  providers: ProviderType[];
  providerConfigs?: ProviderConfig[];
  userId: string;
  /** @deprecated Use teamIds instead */
  teamId?: string;
  teamIds?: string[];
  workspaceId?: string;
  registeredAt: Date;
  lastSeenAt: Date;
  isConnected: boolean;
  refreshTokenHash: string;
  isRevoked: boolean;
  metadata?: Record<string, string>;
}

/** Extended machine info with team context */
export interface MachineWithTeamInfo extends RegisteredMachine {
  isTeamMachine: boolean;
  /** @deprecated Use teamNames instead */
  teamName?: string;
  teamNames?: string[];
}
