import { create } from "zustand"
import type { OpenClawSkill } from "@/types/skill"

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

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: new Map(),
  loaded: false,

  load: async () => {
    set({ loaded: true })
  },

  addSkill: (skill) => {
    const skills = new Map(get().skills)
    skills.set(skill.name, skill)
    set({ skills })
  },

  removeSkill: (name) => {
    const skills = new Map(get().skills)
    skills.delete(name)
    set({ skills })
  },

  enableSkill: (name) => {
    const skills = new Map(get().skills)
    const skill = skills.get(name)
    if (skill) {
      skills.set(name, { ...skill, enabled: true })
      set({ skills })
    }
  },

  disableSkill: (name) => {
    const skills = new Map(get().skills)
    const skill = skills.get(name)
    if (skill) {
      skills.set(name, { ...skill, enabled: false })
      set({ skills })
    }
  },

  updateSkillConfig: (name, config) => {
    const skills = new Map(get().skills)
    const skill = skills.get(name)
    if (skill) {
      skills.set(name, { ...skill, config })
      set({ skills })
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
