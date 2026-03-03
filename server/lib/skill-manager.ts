/**
 * Skill Manager (Server-side, In-Memory Registry)
 *
 * Manages an in-memory registry of skills used for prompt injection.
 * The registry is synced from the DB on startup and after each API mutation
 * via syncSkillsFromDb() in bootstrap-skills.ts.
 *
 * IMPORTANT: Skills are team-scoped. Prompt injection methods require a teamId
 * parameter to ensure workspace skills from Team A are never leaked to Team B.
 * Built-in skills (teamId=null) are visible to all teams.
 *
 * Prompt injection logic lives in packages/core/src/skill-injector.ts.
 * DB persistence lives in server/routes/skills.ts (Drizzle ORM).
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
   * Get skills visible to a specific team.
   * Returns builtins (teamId=null) + team-owned skills.
   * Prevents cross-team data leakage of workspace skills.
   */
  getSkillsForTeam(teamId: string | null | undefined): OpenClawSkill[] {
    return this.getAllSkills().filter(s =>
      s.teamId == null || s.teamId === teamId
    )
  }

  /**
   * Get skills that pass gating requirements (enabled + not model-invocation-disabled),
   * scoped to a specific team. If no teamId is provided (e.g., local mode with no auth),
   * returns all eligible skills.
   */
  getEligibleSkills(teamId?: string | null): OpenClawSkill[] {
    const pool = teamId !== undefined ? this.getSkillsForTeam(teamId) : this.getAllSkills()
    return getEligibleSkills(pool)
  }

  /**
   * Build XML prompt injection for eligible skills, scoped to a team.
   * Pass the requesting user's teamId to ensure team isolation.
   * In local mode (no auth), pass undefined to include all skills.
   */
  getSkillPromptInjection(teamId?: string | null): string {
    return buildSkillPromptInjection(this.getEligibleSkills(teamId))
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
