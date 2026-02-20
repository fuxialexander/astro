import { create } from "zustand"
import { loadState, saveState } from "@/lib/db"
import type { OpenClawSkill } from "@/types/skill"

const IDB_KEY = "astro-skills"

/** Serializable skill data for IndexedDB (same as OpenClawSkill) */
type SkillPersistData = OpenClawSkill

interface SkillStore {
  skills: Map<string, OpenClawSkill>
  loaded: boolean

  // Lifecycle
  load: () => Promise<void>
  addSkill: (skill: OpenClawSkill) => void
  removeSkill: (name: string) => void
  enableSkill: (name: string) => void
  disableSkill: (name: string) => void
  updateSkillConfig: (name: string, config: Record<string, unknown>) => void

  // Accessors
  getEligibleSkills: () => OpenClawSkill[]
  getSkillPromptInjection: () => string
}

function serializeSkills(skills: Map<string, OpenClawSkill>): SkillPersistData[] {
  return Array.from(skills.values())
}

function deserializeSkills(data: SkillPersistData[]): Map<string, OpenClawSkill> {
  const map = new Map<string, OpenClawSkill>()
  for (const skill of data) {
    map.set(skill.name, skill)
  }
  return map
}

function persist(skills: Map<string, OpenClawSkill>) {
  saveState(IDB_KEY, serializeSkills(skills))
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: new Map(),
  loaded: false,

  load: async () => {
    try {
      const stored = await loadState<SkillPersistData[]>(IDB_KEY)
      if (stored && Array.isArray(stored)) {
        set({ skills: deserializeSkills(stored), loaded: true })
      } else {
        set({ loaded: true })
      }
    } catch (error) {
      console.error("[SkillStore] Failed to load:", error)
      set({ loaded: true })
    }
  },

  addSkill: (skill) => {
    const skills = new Map(get().skills)
    skills.set(skill.name, skill)
    set({ skills })
    persist(skills)
  },

  removeSkill: (name) => {
    const skills = new Map(get().skills)
    skills.delete(name)
    set({ skills })
    persist(skills)
  },

  enableSkill: (name) => {
    const skills = new Map(get().skills)
    const skill = skills.get(name)
    if (skill) {
      skills.set(name, { ...skill, enabled: true })
      set({ skills })
      persist(skills)
    }
  },

  disableSkill: (name) => {
    const skills = new Map(get().skills)
    const skill = skills.get(name)
    if (skill) {
      skills.set(name, { ...skill, enabled: false })
      set({ skills })
      persist(skills)
    }
  },

  updateSkillConfig: (name, config) => {
    const skills = new Map(get().skills)
    const skill = skills.get(name)
    if (skill) {
      skills.set(name, { ...skill, config })
      set({ skills })
      persist(skills)
    }
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
