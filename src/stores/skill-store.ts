import { create } from "zustand"
import type { OpenClawSkill } from "@/types/skill"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"
import { useToastStore } from "@/stores/toast-store"

interface SkillStore {
  skills: Map<string, OpenClawSkill>
  loaded: boolean
  loading: boolean
  error: string | null

  // Lifecycle
  load: () => Promise<void>

  // CRUD operations with API integration
  addSkill: (skill: OpenClawSkill) => Promise<void>
  updateSkill: (name: string, updates: Partial<OpenClawSkill>) => Promise<void>
  removeSkill: (name: string) => Promise<void>
  toggleSkill: (name: string) => Promise<void>

  // Legacy aliases (call the new methods)
  enableSkill: (name: string) => Promise<void>
  disableSkill: (name: string) => Promise<void>
  updateSkillConfig: (name: string, config: Record<string, unknown>) => Promise<void>

  // Accessors
  getEligibleSkills: () => OpenClawSkill[]
  getSkillPromptInjection: () => string
}

/**
 * Get auth headers for API requests
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }
  return headers
}

/**
 * Parse skill response from API into OpenClawSkill
 */
function parseSkillResponse(s: Record<string, unknown>): OpenClawSkill {
  return {
    name: s.name as string,
    description: (s.description as string) ?? '',
    instructions: (s.instructions as string) ?? '',
    source: (s.source as OpenClawSkill['source']) ?? 'builtin',
    enabled: (s.enabled as boolean) ?? true,
    userInvocable: (s.userInvocable as boolean) ?? true,
    pluginId: s.pluginId as string | undefined,
    config: s.config as Record<string, unknown> | undefined,
    disableModelInvocation: s.disableModelInvocation as boolean | undefined,
    commandDispatch: s.commandDispatch as 'tool' | undefined,
    commandTool: s.commandTool as string | undefined,
    homepage: s.homepage as string | undefined,
    metadata: s.metadata as OpenClawSkill['metadata'],
  }
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: new Map(),
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/skills'), { headers })
      if (res.ok) {
        const data = await res.json()
        const skills = new Map<string, OpenClawSkill>()
        for (const s of data.skills ?? []) {
          skills.set(s.name, parseSkillResponse(s))
        }
        set({ skills, loaded: true, loading: false })
      } else {
        // Server error but mark as loaded so app doesn't block
        set({ loaded: true, loading: false, error: `Failed to load skills: ${res.status}` })
      }
    } catch (err) {
      // Server may not be ready yet — mark loaded so app doesn't block
      const errorMsg = err instanceof Error ? err.message : 'Failed to load skills'
      set({ loaded: true, loading: false, error: errorMsg })
    }
  },

  addSkill: async (skill) => {
    // Optimistic update: add to local state immediately
    const skills = new Map(get().skills)
    skills.set(skill.name, skill)
    set({ skills })

    // Sync to backend
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/skills/register'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          skills: [{
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
            source: skill.source,
            enabled: skill.enabled,
          }],
        }),
      })

      if (!res.ok) {
        throw new Error(`Failed to register skill: ${res.status}`)
      }
    } catch (err) {
      console.error('[skill-store] Failed to sync skill to backend:', err)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to save skill',
        description: 'Skill may be lost on refresh. Check your connection.',
      })
    }
  },

  updateSkill: async (name, updates) => {
    const skills = new Map(get().skills)
    const existing = skills.get(name)
    if (!existing) {
      console.warn(`[skill-store] Skill '${name}' not found for update`)
      return
    }

    // Optimistic update: apply changes locally
    const updated = { ...existing, ...updates }
    skills.set(name, updated)
    set({ skills })

    // Sync to backend via config endpoint
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/skills/${encodeURIComponent(name)}/config`), {
        method: 'PUT',
        headers,
        body: JSON.stringify(updates),
      })

      if (!res.ok) {
        throw new Error(`Failed to update skill: ${res.status}`)
      }
    } catch (err) {
      console.error('[skill-store] Failed to sync skill update:', err)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to update skill',
        description: 'Changes may be lost on refresh.',
      })
    }
  },

  removeSkill: async (name) => {
    // Optimistic update: remove from local state
    const skills = new Map(get().skills)
    const hadSkill = skills.delete(name)
    set({ skills })

    if (!hadSkill) {
      console.warn(`[skill-store] Skill '${name}' not found for removal`)
      return
    }

    // Sync to backend
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/skills/${encodeURIComponent(name)}`), {
        method: 'DELETE',
        headers,
      })

      if (!res.ok && res.status !== 404) {
        throw new Error(`Failed to remove skill: ${res.status}`)
      }
    } catch (err) {
      console.error('[skill-store] Failed to sync skill removal:', err)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to remove skill',
        description: 'Skill may reappear on refresh.',
      })
    }
  },

  toggleSkill: async (name) => {
    const skills = new Map(get().skills)
    const skill = skills.get(name)
    if (!skill) {
      console.warn(`[skill-store] Skill '${name}' not found for toggle`)
      return
    }

    // Optimistic update: toggle enabled state
    const newEnabled = !skill.enabled
    skills.set(name, { ...skill, enabled: newEnabled })
    set({ skills })

    // Sync to backend via config endpoint
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/skills/${encodeURIComponent(name)}/config`), {
        method: 'PUT',
        headers,
        body: JSON.stringify({ enabled: newEnabled }),
      })

      if (!res.ok) {
        throw new Error(`Failed to toggle skill: ${res.status}`)
      }
    } catch (err) {
      console.error('[skill-store] Failed to sync skill toggle:', err)
      // Revert optimistic update
      const revertSkills = new Map(get().skills)
      const revertSkill = revertSkills.get(name)
      if (revertSkill) {
        revertSkills.set(name, { ...revertSkill, enabled: !newEnabled })
        set({ skills: revertSkills })
      }
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to toggle skill',
        description: 'Please try again.',
      })
    }
  },

  // Legacy aliases that call the new API-integrated methods
  enableSkill: async (name) => {
    const skill = get().skills.get(name)
    if (skill && !skill.enabled) {
      await get().toggleSkill(name)
    }
  },

  disableSkill: async (name) => {
    const skill = get().skills.get(name)
    if (skill && skill.enabled) {
      await get().toggleSkill(name)
    }
  },

  updateSkillConfig: async (name, config) => {
    await get().updateSkill(name, { config })
  },

  getEligibleSkills: () => {
    const result: OpenClawSkill[] = []
    for (const [, skill] of get().skills) {
      if (skill.enabled && !skill.disableModelInvocation) {
        result.push(skill)
      }
    }
    return result
  },

  getSkillPromptInjection: () => {
    const eligible = get().getEligibleSkills()
    if (eligible.length === 0) return ""

    const skillEntries = eligible
      .map(
        (s) =>
          `  <skill name="${s.name}" description="${s.description}">\n${s.instructions}\n  </skill>`
      )
      .join("\n")

    return `<skills>\n${skillEntries}\n</skills>`
  },
}))
