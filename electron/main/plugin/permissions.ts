/**
 * Plugin permission gating.
 *
 * Every host-API call routes through `gate()` with the plugin's manifest
 * permission list. Calls for permissions not declared in the manifest are
 * rejected with a structured error — fail fast, no silent degradation.
 *
 * Phase 4 ships static gating only. Phase 4B will add an interactive approval
 * UI (modal in the main window) for permissions that need user consent at
 * install time.
 */

import type { PluginPermission } from './types.js'

export class PermissionDeniedError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly permission: PluginPermission,
    public readonly op: string,
  ) {
    super(
      `plugin "${pluginId}" attempted host-api op "${op}" without permission "${permission}"`,
    )
    this.name = 'PermissionDeniedError'
  }
}

export function gate(
  pluginId: string,
  granted: readonly PluginPermission[] | undefined,
  required: PluginPermission,
  op: string,
): void {
  if (!granted || !granted.includes(required)) {
    throw new PermissionDeniedError(pluginId, required, op)
  }
}
