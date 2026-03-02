import { create } from "zustand"
import type { OpenClawSkill } from "@/types/skill"
import { dataClient } from "@/lib/data-client"
import { useToastStore } from "@/stores/toast-store"

/**
 * SkillRow extends OpenClawSkill with the DB fields returned by the API.
 * The `id` is the server-assigned UUID primary key used for CRUD operations.
 */
export interface SkillRow extends OpenClawSkill {
  id: string
  version?: string
  category?: string
  tags?: string[]
  allowedTools?: string[]
  sourceUrl?: string
  createdAt?: Date
  updatedAt?: Date
}

interface SkillStore {
  skills: Map<string, SkillRow>
  loaded: boolean
  loading: boolean
  error: string | null

  // Lifecycle
  load: () => Promise<void>
  addSkill: (skill: OpenClawSkill) => void
  updateSkill: (name: string, updates: Partial<OpenClawSkill>) => void
  removeSkill: (name: string) => void
  toggleSkill: (name: string) => void

  /** @deprecated Use toggleSkill instead */
  enableSkill: (name: string) => void
  /** @deprecated Use toggleSkill instead */
  disableSkill: (name: string) => void
  updateSkillConfig: (name: string, config: Record<string, unknown>) => void

  // Accessors
  getEligibleSkills: () => OpenClawSkill[]
  getSkillPromptInjection: () => string
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: new Map(),
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const rows = await dataClient.listSkills()
      const skills = new Map<string, SkillRow>()
      for (const row of rows) {
        skills.set(row.name, row)
      }
      set({ skills, loaded: true, loading: false })
    } catch (err) {
      // Server may not be ready yet — mark loaded so app doesn't block
      set({
        loaded: true,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load skills',
      })
    }
  },

  addSkill: (skill) => {
    // Optimistic: add to local state immediately
    const skills = new Map(get().skills)
    const tempId = crypto.randomUUID()
    const row: SkillRow = { ...skill, id: tempId }
    skills.set(skill.name, row)
    set({ skills })

    // Sync to backend
    dataClient.createSkill({
      id: tempId,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      source: skill.source,
      enabled: skill.enabled,
      config: skill.config,
    }).then((created) => {
      // Merge server response (may have different id or additional fields)
      const current = new Map(get().skills)
      if (current.has(skill.name)) {
        current.set(skill.name, created)
        set({ skills: current })
      }
    }).catch((err) => {
      console.error('[skill-store] Failed to sync addSkill:', err)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to save skill',
        description: 'Skill may be lost on refresh.',
      })
    })
  },

  updateSkill: (name, updates) => {
    const skills = new Map(get().skills)
    const existing = skills.get(name)
    if (!existing) return

    // Optimistic: merge updates locally
    const updated: SkillRow = { ...existing, ...updates }
    // If name changed, re-key the map
    if (updates.name && updates.name !== name) {
      skills.delete(name)
      skills.set(updates.name, updated)
    } else {
      skills.set(name, updated)
    }
    set({ skills })

    // Sync to backend using the DB id
    dataClient.updateSkill(existing.id, updates).then((serverRow) => {
      const current = new Map(get().skills)
      const key = serverRow.name
      current.set(key, serverRow)
      // Clean up old key if name changed
      if (updates.name && updates.name !== name) {
        current.delete(name)
      }
      set({ skills: current })
    }).catch((err) => {
      console.error('[skill-store] Failed to sync updateSkill:', err)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to update skill',
        description: 'Changes may be lost on refresh.',
      })
    })
  },

  removeSkill: (name) => {
    const skills = new Map(get().skills)
    const existing = skills.get(name)
    if (!existing) return

    // Optimistic: remove locally
    skills.delete(name)
    set({ skills })

    // Sync to backend
    dataClient.deleteSkill(existing.id).catch((err) => {
      console.error('[skill-store] Failed to sync removeSkill:', err)
      // Revert on failure
      const current = new Map(get().skills)
      current.set(name, existing)
      set({ skills: current })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to remove skill',
        description: 'The skill has been restored.',
      })
    })
  },

  toggleSkill: (name) => {
    const skills = new Map(get().skills)
    const existing = skills.get(name)
    if (!existing) return

    // Optimistic: toggle locally
    const toggled: SkillRow = { ...existing, enabled: !existing.enabled }
    skills.set(name, toggled)
    set({ skills })

    // Sync to backend
    dataClient.toggleSkill(existing.id).then((serverRow) => {
      const current = new Map(get().skills)
      current.set(name, serverRow)
      set({ skills: current })
    }).catch((err) => {
      console.error('[skill-store] Failed to sync toggleSkill:', err)
      // Revert on failure
      const current = new Map(get().skills)
      current.set(name, existing)
      set({ skills: current })
    })
  },

  enableSkill: (name) => {
    const skills = new Map(get().skills)
    const existing = skills.get(name)
    if (!existing || existing.enabled) return

    // Optimistic: enable locally
    skills.set(name, { ...existing, enabled: true })
    set({ skills })

    // Sync via toggle if currently disabled
    dataClient.toggleSkill(existing.id).then((serverRow) => {
      const current = new Map(get().skills)
      current.set(name, serverRow)
      set({ skills: current })
    }).catch((err) => {
      console.error('[skill-store] Failed to sync enableSkill:', err)
      const current = new Map(get().skills)
      current.set(name, existing)
      set({ skills: current })
    })
  },

  disableSkill: (name) => {
    const skills = new Map(get().skills)
    const existing = skills.get(name)
    if (!existing || !existing.enabled) return

    // Optimistic: disable locally
    skills.set(name, { ...existing, enabled: false })
    set({ skills })

    // Sync via toggle if currently enabled
    dataClient.toggleSkill(existing.id).then((serverRow) => {
      const current = new Map(get().skills)
      current.set(name, serverRow)
      set({ skills: current })
    }).catch((err) => {
      console.error('[skill-store] Failed to sync disableSkill:', err)
      const current = new Map(get().skills)
      current.set(name, existing)
      set({ skills: current })
    })
  },

  updateSkillConfig: (name, config) => {
    const skills = new Map(get().skills)
    const existing = skills.get(name)
    if (!existing) return

    // Optimistic: update config locally
    const updated: SkillRow = { ...existing, config }
    skills.set(name, updated)
    set({ skills })

    // Sync to backend
    dataClient.updateSkill(existing.id, { config } as Partial<SkillRow>).catch((err) => {
      console.error('[skill-store] Failed to sync updateSkillConfig:', err)
    })
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
