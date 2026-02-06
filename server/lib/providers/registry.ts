/**
 * Provider Registry
 *
 * Manages registration, detection, and lookup of agent providers.
 * On startup, probes all known providers and maintains an inventory
 * that can be reported to the relay server.
 */

import type {
  AgentProvider,
  RegisteredProvider,
  ProviderDetectionResult,
  MachineRegistration,
  AuthStatus,
  TaskType,
} from './types.js'
import { randomUUID } from 'crypto'
import { hostname } from 'os'

/**
 * Singleton registry that manages all provider instances.
 */
class ProviderRegistry {
  private providers: Map<string, RegisteredProvider> = new Map()
  private machineId: string
  private initialized: boolean = false

  constructor() {
    // Generate a stable machine ID (in production, this should be persisted)
    this.machineId = randomUUID()
  }

  /**
   * Register a provider with the registry.
   * Does not automatically detect - call detectAll() or detectProvider() separately.
   */
  register(provider: AgentProvider): void {
    const capabilities = provider.capabilities()

    this.providers.set(provider.id, {
      provider,
      detection: {
        installed: false,
        authStatus: 'unknown',
        detectedAt: new Date(),
      },
      capabilities,
      lastDetection: new Date(0), // Never detected
      available: false,
    })
  }

  /**
   * Unregister a provider from the registry.
   */
  unregister(providerId: string): boolean {
    return this.providers.delete(providerId)
  }

  /**
   * Detect a specific provider's availability.
   */
  async detectProvider(providerId: string): Promise<ProviderDetectionResult | null> {
    const registered = this.providers.get(providerId)
    if (!registered) {
      return null
    }

    try {
      const detection = await registered.provider.detect()

      // Update the registration
      registered.detection = detection
      registered.lastDetection = new Date()
      registered.available = detection.installed && detection.authStatus === 'authenticated'

      return detection
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      registered.detection = {
        installed: false,
        authStatus: 'unknown',
        message: `Detection failed: ${message}`,
        detectedAt: new Date(),
      }
      registered.lastDetection = new Date()
      registered.available = false

      return registered.detection
    }
  }

  /**
   * Probe all registered providers and update their availability.
   * This is typically called on agent runner startup.
   */
  async detectAll(): Promise<Map<string, ProviderDetectionResult>> {
    const results = new Map<string, ProviderDetectionResult>()

    // Detect all providers in parallel
    const detectionPromises = Array.from(this.providers.keys()).map(async (id) => {
      const result = await this.detectProvider(id)
      if (result) {
        results.set(id, result)
      }
    })

    await Promise.all(detectionPromises)
    this.initialized = true

    return results
  }

  /**
   * Get a provider by ID.
   */
  getProvider(providerId: string): AgentProvider | null {
    return this.providers.get(providerId)?.provider ?? null
  }

  /**
   * Get a registered provider with all metadata.
   */
  getRegisteredProvider(providerId: string): RegisteredProvider | null {
    return this.providers.get(providerId) ?? null
  }

  /**
   * Get all available (installed and authenticated) providers.
   */
  getAvailableProviders(): AgentProvider[] {
    return Array.from(this.providers.values())
      .filter((r) => r.available)
      .map((r) => r.provider)
  }

  /**
   * Get all registered providers (regardless of availability).
   */
  getAllProviders(): RegisteredProvider[] {
    return Array.from(this.providers.values())
  }

  /**
   * Find providers that can handle a specific task type.
   */
  findProvidersForTaskType(taskType: TaskType): AgentProvider[] {
    return Array.from(this.providers.values())
      .filter((r) => r.available && r.capabilities.taskTypes.includes(taskType))
      .map((r) => r.provider)
  }

  /**
   * Find providers that support a specific language.
   */
  findProvidersForLanguage(language: string): AgentProvider[] {
    const normalizedLanguage = language.toLowerCase()
    return Array.from(this.providers.values())
      .filter((r) => {
        if (!r.available) return false
        // Check if provider supports the language or supports 'all'
        return r.capabilities.languages.some(
          (l) => l.toLowerCase() === normalizedLanguage || l === '*'
        )
      })
      .map((r) => r.provider)
  }

  /**
   * Find the best provider for a task based on type and language.
   * Returns the first available provider that matches.
   */
  findBestProvider(taskType: TaskType, language?: string): AgentProvider | null {
    let candidates = this.findProvidersForTaskType(taskType)

    if (language && candidates.length > 1) {
      const languageMatches = candidates.filter((p) => {
        const caps = p.capabilities()
        return caps.languages.some(
          (l) => l.toLowerCase() === language.toLowerCase() || l === '*'
        )
      })
      if (languageMatches.length > 0) {
        candidates = languageMatches
      }
    }

    return candidates[0] ?? null
  }

  /**
   * Get the default provider (first available, or first registered).
   */
  getDefaultProvider(): AgentProvider | null {
    const available = this.getAvailableProviders()
    if (available.length > 0) {
      return available[0]
    }

    // Fall back to first registered even if not available
    const all = Array.from(this.providers.values())
    return all[0]?.provider ?? null
  }

  /**
   * Check if the registry has been initialized (detectAll called).
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Build a machine registration payload for the relay server.
   */
  getMachineRegistration(): MachineRegistration {
    const providers = Array.from(this.providers.values()).map((r) => ({
      providerId: r.provider.id,
      name: r.provider.name,
      version: r.detection.version,
      authStatus: r.detection.authStatus,
      capabilities: r.capabilities,
    }))

    return {
      machineId: this.machineId,
      hostname: hostname(),
      providers,
      registeredAt: new Date(),
    }
  }

  /**
   * Get summary of provider statuses.
   */
  getStatusSummary(): {
    total: number
    available: number
    installed: number
    authenticated: number
    providers: Array<{
      id: string
      name: string
      installed: boolean
      authStatus: AuthStatus
      available: boolean
    }>
  } {
    const all = Array.from(this.providers.values())

    return {
      total: all.length,
      available: all.filter((r) => r.available).length,
      installed: all.filter((r) => r.detection.installed).length,
      authenticated: all.filter((r) => r.detection.authStatus === 'authenticated').length,
      providers: all.map((r) => ({
        id: r.provider.id,
        name: r.provider.name,
        installed: r.detection.installed,
        authStatus: r.detection.authStatus,
        available: r.available,
      })),
    }
  }

  /**
   * Clear all registrations (useful for testing).
   */
  clear(): void {
    this.providers.clear()
    this.initialized = false
  }

  /**
   * Set machine ID (useful for persistence).
   */
  setMachineId(id: string): void {
    this.machineId = id
  }

  /**
   * Get machine ID.
   */
  getMachineId(): string {
    return this.machineId
  }
}

// Export singleton instance
export const providerRegistry = new ProviderRegistry()

// Also export the class for testing
export { ProviderRegistry }
