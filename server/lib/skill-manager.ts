/**
 * Skill Manager (Server-side, In-Memory Registry)
 *
 * Manages an in-memory registry of skills. Skills are populated from:
 * - Relay messages (agent runner reports machine-local skills)
 * - API calls (frontend sends skills discovered via Tauri or relay)
 * - Programmatic registration (server plugins contribute skills)
 *
 * NO filesystem access. Parsing logic lives in src/lib/skill-parser.ts.
 * Prompt injection logic lives in server/lib/skill-injector.ts.
 */

import type { OpenClawSkill } from '../../src/types/skill.js'
import { buildSkillPromptInjection, getEligibleSkills } from './skill-injector.js'

export class SkillManager {
  private skills = new Map<string, OpenClawSkill>()

  /**
   * Add a skill programmatically (e.g., from a plugin or relay message)
   */
  addSkill(skill: OpenClawSkill): void {
    this.skills.set(skill.name, skill)
  }

  /**
   * Bulk-load skills (replaces current set)
   */
  loadSkills(skills: OpenClawSkill[]): void {
    this.skills.clear()
    for (const skill of skills) {
      this.skills.set(skill.name, skill)
    }
    console.log(`[skill-manager] Loaded ${this.skills.size} skills`)
  }

  /**
   * Get all loaded skills
   */
  getAllSkills(): OpenClawSkill[] {
    return Array.from(this.skills.values())
  }

  /**
   * Get skills that pass gating requirements (enabled + not model-invocation-disabled)
   */
  getEligibleSkills(): OpenClawSkill[] {
    return getEligibleSkills(this.getAllSkills())
  }

  /**
   * Build XML prompt injection for eligible skills
   */
  getSkillPromptInjection(): string {
    return buildSkillPromptInjection(this.getAllSkills())
  }

  /**
   * Remove a skill by name
   */
  removeSkill(name: string): boolean {
    return this.skills.delete(name)
  }

  /**
   * Update a skill's configuration
   */
  updateSkillConfig(name: string, config: Record<string, unknown>): boolean {
    const skill = this.skills.get(name)
    if (!skill) return false
    skill.config = { ...skill.config, ...config }
    return true
  }
}

export const skillManager = new SkillManager()
