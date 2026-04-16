/**
 * Skill Provider (Shared Interface)
 *
 * Abstracts skill discovery and management. Currently the only implementation
 * is WebSkillProvider, which talks to the Hono API (which may proxy to a relay
 * for remote machines). The desktop shell (Electron) reuses the same HTTP
 * provider against the bundled local server.
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
 * HTTP-backed skill provider. Used in both web and Electron desktop modes;
 * desktop just points at the bundled local server.
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
    // Skill installation from the renderer is not supported; the local server
    // owns the filesystem and exposes management endpoints separately.
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
 * Create the default skill provider for the current runtime.
 */
export function createSkillProvider(): SkillProvider {
  return new WebSkillProvider()
}
