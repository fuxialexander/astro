/**
 * Skill Provider (Shared Interface)
 *
 * Abstracts skill discovery and management across runtimes:
 * - WebSkillProvider: fetches from HTTP API (server/relay)
 * - TauriSkillProvider: invokes Tauri IPC commands (direct filesystem)
 *
 * The frontend uses createSkillProvider() to get the right implementation.
 */

import type { OpenClawSkill } from '@/types/skill'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  const token = await getAccessToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

/**
 * Abstract interface for skill discovery and management.
 * Implemented by runtime-specific providers.
 */
export interface SkillProvider {
  /** Discover all available skills */
  scanSkills(): Promise<OpenClawSkill[]>

  /** Install a skill (returns the installed skill) */
  installSkill(name: string, content: string): Promise<OpenClawSkill>

  /** Uninstall a skill by name */
  uninstallSkill(name: string): Promise<boolean>

  /** Update skill configuration */
  updateSkillConfig(name: string, config: Record<string, unknown>): Promise<boolean>
}

/**
 * Web-mode skill provider.
 * Fetches skills from the Hono API (which may proxy to relay for remote machines).
 */
export class WebSkillProvider implements SkillProvider {
  async scanSkills(): Promise<OpenClawSkill[]> {
    try {
      const headers = await authHeaders()
      const res = await fetch(apiUrl('/api/skills'), { headers })
      if (!res.ok) return []
      const data = await res.json()
      return (data.skills ?? []).map((s: Record<string, unknown>) => ({
        name: s.name as string,
        description: (s.description as string) ?? '',
        instructions: (s.instructions as string) ?? '',
        source: (s.source as OpenClawSkill['source']) ?? 'builtin',
        enabled: (s.enabled as boolean) ?? true,
        userInvocable: (s.userInvocable as boolean) ?? true,
        pluginId: s.pluginId as string | undefined,
        config: s.config as Record<string, unknown> | undefined,
      }))
    } catch {
      return []
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async installSkill(_name: string, _content: string): Promise<OpenClawSkill> {
    // Web mode: skill installation not supported (no filesystem access)
    throw new Error('Skill installation requires the desktop app')
  }

  async uninstallSkill(name: string): Promise<boolean> {
    try {
      const headers = await authHeaders()
      const res = await fetch(apiUrl(`/api/skills/${encodeURIComponent(name)}`), { method: 'DELETE', headers })
      return res.ok
    } catch {
      return false
    }
  }

  async updateSkillConfig(name: string, config: Record<string, unknown>): Promise<boolean> {
    try {
      const hdrs = await authHeaders()
      const res = await fetch(apiUrl(`/api/skills/${encodeURIComponent(name)}/config`), {
        method: 'PUT',
        headers: { ...hdrs, 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      return res.ok
    } catch {
      return false
    }
  }
}

/**
 * Tauri-mode skill provider (stub).
 * Will invoke Tauri IPC commands for direct filesystem access.
 * Implementation lives in src-tauri/src/commands/skills.rs.
 */
export class TauriSkillProvider implements SkillProvider {
  async scanSkills(): Promise<OpenClawSkill[]> {
    // Will be: return invoke<OpenClawSkill[]>('scan_skills', { workdir })
    throw new Error('Tauri skill provider not yet implemented')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async installSkill(_name: string, _content: string): Promise<OpenClawSkill> {
    // Will be: return invoke<OpenClawSkill>('install_skill', { name, content })
    throw new Error('Tauri skill provider not yet implemented')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async uninstallSkill(_name: string): Promise<boolean> {
    // Will be: return invoke<boolean>('uninstall_skill', { name })
    throw new Error('Tauri skill provider not yet implemented')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async updateSkillConfig(_name: string, _config: Record<string, unknown>): Promise<boolean> {
    // Will be: return invoke<boolean>('update_skill_config', { name, config })
    throw new Error('Tauri skill provider not yet implemented')
  }
}

/**
 * Detect if running inside a Tauri webview
 */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI__' in window

/**
 * Create the appropriate skill provider for the current runtime
 */
export function createSkillProvider(): SkillProvider {
  if (isTauri()) {
    return new TauriSkillProvider()
  }
  return new WebSkillProvider()
}
