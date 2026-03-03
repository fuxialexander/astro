import { create } from "zustand"
import type { OpenClawSkill } from "@/types/skill"
import { buildSkillPromptInjection } from "@astro/core/skill-injector"
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
  /** Skills keyed by id (UUID) for consistent lookups */
  skills: Map<string, SkillRow>
  loaded: boolean
  loading: boolean
  error: string | null

  // Lifecycle
  load: () => Promise<void>
  addSkill: (skill: OpenClawSkill) => void
  updateSkill: (id: string, updates: Partial<OpenClawSkill>) => void
  removeSkill: (id: string) => void
  toggleSkill: (id: string) => void

  /** @deprecated Use toggleSkill instead */
  enableSkill: (id: string) => void
  /** @deprecated Use toggleSkill instead */
  disableSkill: (id: string) => void
  updateSkillConfig: (id: string, config: Record<string, unknown>) => void

  // Accessors
  findByName: (name: string) => SkillRow | undefined
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
        skills.set(row.id, row)
      }
      set({ skills, loaded: true, loading: false })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load skills'
      // Server may not be ready yet — mark loaded so app doesn't block
      set({
        loaded: true,
        loading: false,
        error: errorMsg,
      })
      // Show toast notification for the error
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to load skills',
        description: errorMsg,
      })
    }
  },

  addSkill: (skill) => {
    // Optimistic: add to local state immediately
    const skills = new Map(get().skills)
    const tempId = `temp-${crypto.randomUUID()}`
    const row: SkillRow = { ...skill, id: tempId }
    skills.set(tempId, row)
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
      // Surface sync cache warning to user if present
      if ('_warning' in created && created._warning) {
        useToastStore.getState().add({ type: 'warning', title: 'Skill saved with warning', description: created._warning as string })
      }
      // Replace temp entry with server response and sweep orphaned temp entries
      const current = new Map(get().skills)
      current.delete(tempId)
      // Clean up any orphaned temp entries from previous failed addSkill() calls
      for (const key of [...current.keys()]) {
        if (key.startsWith('temp-')) current.delete(key)
      }
      current.set(created.id, created)
      set({ skills: current })
    }).catch((err) => {
      console.error('[skill-store] Failed to sync addSkill:', err)
      // Remove optimistic entry on failure (identified by temp- prefix)
      const current = new Map(get().skills)
      if (tempId.startsWith('temp-')) current.delete(tempId)
      set({ skills: current, error: err instanceof Error ? err.message : 'Failed to save skill' })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to save skill',
        description: 'Skill may be lost on refresh.',
      })
    })
  },

  updateSkill: (id, updates) => {
    const skills = new Map(get().skills)
    const existing = skills.get(id)
    if (!existing) return

    // Snapshot for rollback
    const originalSkill = { ...existing }

    // Optimistic: merge updates locally
    const updated: SkillRow = { ...existing, ...updates }
    skills.set(id, updated)
    set({ skills })

    // Sync to backend using the DB id
    dataClient.updateSkill(id, updates).then((serverRow) => {
      if ('_warning' in serverRow && serverRow._warning) {
        useToastStore.getState().add({ type: 'warning', title: 'Skill updated with warning', description: serverRow._warning as string })
      }
      const current = new Map(get().skills)
      current.set(serverRow.id, serverRow)
      set({ skills: current })
    }).catch((err) => {
      console.error('[skill-store] Failed to sync updateSkill:', err)
      // Revert to original state
      const current = new Map(get().skills)
      current.set(id, originalSkill)
      set({ skills: current, error: err instanceof Error ? err.message : 'Failed to update skill' })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to update skill',
        description: 'Changes have been reverted.',
      })
    })
  },

  removeSkill: (id) => {
    const skills = new Map(get().skills)
    const existing = skills.get(id)
    if (!existing) return

    // Optimistic: remove locally
    skills.delete(id)
    set({ skills })

    // Sync to backend
    dataClient.deleteSkill(id).catch((err) => {
      console.error('[skill-store] Failed to sync removeSkill:', err)
      // Revert on failure
      const current = new Map(get().skills)
      current.set(id, existing)
      set({ skills: current, error: err instanceof Error ? err.message : 'Failed to remove skill' })
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to remove skill',
        description: 'The skill has been restored.',
      })
    })
  },

  toggleSkill: (id) => {
    const skills = new Map(get().skills)
    const existing = skills.get(id)
    if (!existing) return

    // Optimistic: toggle locally
    const toggled: SkillRow = { ...existing, enabled: !existing.enabled }
    skills.set(id, toggled)
    set({ skills })

    // Sync to backend
    dataClient.toggleSkill(id).then((serverRow) => {
      if ('_warning' in serverRow && serverRow._warning) {
        useToastStore.getState().add({ type: 'warning', title: 'Skill toggled with warning', description: serverRow._warning as string })
      }
      const current = new Map(get().skills)
      current.set(id, serverRow)
      set({ skills: current })
    }).catch((err) => {
      console.error('[skill-store] Failed to sync toggleSkill:', err)
      // Revert on failure
      const current = new Map(get().skills)
      current.set(id, existing)
      set({ skills: current, error: err instanceof Error ? err.message : 'Failed to toggle skill' })
    })
  },

  enableSkill: (id) => {
    const skills = new Map(get().skills)
    const existing = skills.get(id)
    if (!existing || existing.enabled) return

    // Optimistic: enable locally
    skills.set(id, { ...existing, enabled: true })
    set({ skills })

    // Sync via toggle if currently disabled
    dataClient.toggleSkill(id).then((serverRow) => {
      const current = new Map(get().skills)
      current.set(id, serverRow)
      set({ skills: current })
    }).catch((err) => {
      console.error('[skill-store] Failed to sync enableSkill:', err)
      const current = new Map(get().skills)
      current.set(id, existing)
      set({ skills: current })
    })
  },

  disableSkill: (id) => {
    const skills = new Map(get().skills)
    const existing = skills.get(id)
    if (!existing || !existing.enabled) return

    // Optimistic: disable locally
    skills.set(id, { ...existing, enabled: false })
    set({ skills })

    // Sync via toggle if currently enabled
    dataClient.toggleSkill(id).then((serverRow) => {
      const current = new Map(get().skills)
      current.set(id, serverRow)
      set({ skills: current })
    }).catch((err) => {
      console.error('[skill-store] Failed to sync disableSkill:', err)
      const current = new Map(get().skills)
      current.set(id, existing)
      set({ skills: current })
    })
  },

  updateSkillConfig: (id, config) => {
    const skills = new Map(get().skills)
    const existing = skills.get(id)
    if (!existing) return

    // Optimistic: update config locally
    const updated: SkillRow = { ...existing, config }
    skills.set(id, updated)
    set({ skills })

    // Sync to backend
    dataClient.updateSkill(id, { config } as Partial<SkillRow>).catch((err) => {
      console.error('[skill-store] Failed to sync updateSkillConfig:', err)
    })
  },

  findByName: (name) => {
    for (const [, skill] of get().skills) {
      if (skill.name === name) {
        return skill
      }
    }
    return undefined
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
    return buildSkillPromptInjection(eligible)
  },
}))
