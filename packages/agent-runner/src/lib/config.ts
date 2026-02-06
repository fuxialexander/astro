/**
 * Configuration management using conf (electron-conf compatible)
 */

import Conf from 'conf';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { StoredConfig, ProviderType } from '../types.js';

const DEFAULT_RELAY_URL = 'wss://relay.nexus.dev';

interface ConfigSchema {
  runnerId: string;
  machineId: string;
  deviceToken?: string;
  relayUrl: string;
  providers: ProviderType[];
  autoStart: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  lastConnected?: string;
  setupCompleted: boolean;
}

class ConfigManager {
  private conf: Conf<ConfigSchema>;

  constructor() {
    this.conf = new Conf<ConfigSchema>({
      projectName: 'nexus-agent',
      projectVersion: '0.1.0',
      defaults: {
        runnerId: '',
        machineId: '',
        deviceToken: undefined,
        relayUrl: DEFAULT_RELAY_URL,
        providers: [],
        autoStart: false,
        logLevel: 'info',
        lastConnected: undefined,
        setupCompleted: false,
      },
    });
  }

  /**
   * Check if initial setup has been completed
   */
  isSetupComplete(): boolean {
    return this.conf.get('setupCompleted');
  }

  /**
   * Get all stored configuration
   */
  getConfig(): StoredConfig {
    return {
      runnerId: this.conf.get('runnerId'),
      machineId: this.conf.get('machineId'),
      deviceToken: this.conf.get('deviceToken'),
      relayUrl: this.conf.get('relayUrl'),
      providers: this.conf.get('providers'),
      autoStart: this.conf.get('autoStart'),
      logLevel: this.conf.get('logLevel'),
    };
  }

  /**
   * Get runner ID, generating one if not set
   */
  getRunnerId(): string {
    let runnerId = this.conf.get('runnerId');
    if (!runnerId) {
      runnerId = `runner-${randomUUID().slice(0, 8)}`;
      this.conf.set('runnerId', runnerId);
    }
    return runnerId;
  }

  /**
   * Get machine ID, generating one if not set
   */
  getMachineId(): string {
    let machineId = this.conf.get('machineId');
    if (!machineId) {
      // Use hostname + random suffix for machine ID
      machineId = `${hostname()}-${randomUUID().slice(0, 8)}`;
      this.conf.set('machineId', machineId);
    }
    return machineId;
  }

  /**
   * Get relay URL
   */
  getRelayUrl(): string {
    return this.conf.get('relayUrl');
  }

  /**
   * Set relay URL
   */
  setRelayUrl(url: string): void {
    this.conf.set('relayUrl', url);
  }

  /**
   * Get device token
   */
  getDeviceToken(): string | undefined {
    return this.conf.get('deviceToken');
  }

  /**
   * Set device token
   */
  setDeviceToken(token: string): void {
    this.conf.set('deviceToken', token);
  }

  /**
   * Get configured providers
   */
  getProviders(): ProviderType[] {
    return this.conf.get('providers');
  }

  /**
   * Set configured providers
   */
  setProviders(providers: ProviderType[]): void {
    this.conf.set('providers', providers);
  }

  /**
   * Get auto-start setting
   */
  getAutoStart(): boolean {
    return this.conf.get('autoStart');
  }

  /**
   * Set auto-start setting
   */
  setAutoStart(autoStart: boolean): void {
    this.conf.set('autoStart', autoStart);
  }

  /**
   * Get log level
   */
  getLogLevel(): 'debug' | 'info' | 'warn' | 'error' {
    return this.conf.get('logLevel');
  }

  /**
   * Set log level
   */
  setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    this.conf.set('logLevel', level);
  }

  /**
   * Update last connected timestamp
   */
  updateLastConnected(): void {
    this.conf.set('lastConnected', new Date().toISOString());
  }

  /**
   * Get last connected timestamp
   */
  getLastConnected(): string | undefined {
    return this.conf.get('lastConnected');
  }

  /**
   * Mark setup as complete
   */
  completeSetup(): void {
    this.conf.set('setupCompleted', true);
  }

  /**
   * Reset all configuration
   */
  reset(): void {
    this.conf.clear();
  }

  /**
   * Get the configuration file path
   */
  getConfigPath(): string {
    return this.conf.path;
  }
}

// Export singleton instance
export const config = new ConfigManager();

// Also export class for testing
export { ConfigManager };
