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
 * Skills are keyed by a composite `${teamId||'global'}::${name}` to prevent
 * cross-team name collisions. Two teams can each have a skill named "docker-compose"
 * without overwriting each other in the Map.
 *
 * Prompt injection logic lives in packages/core/src/skill-injector.ts.
 * DB persistence lives in server/routes/skills.ts (Drizzle ORM).
 */

import type { OpenClawSkill } from '../../src/types/skill.js'
import { buildSkillPromptInjection, getEligibleSkills } from './skill-injector.js'

/** Build a composite key for the skills Map to prevent cross-team name collisions. */
function skillKey(skill: { name: string; teamId?: string | null }): string {
  return `${skill.teamId || 'global'}::${skill.name}`
}

export class SkillManager {
  private skills = new Map<string, OpenClawSkill>()

  /**
   * Add a skill programmatically (e.g., from a plugin or relay message).
   * Rejects skills missing required fields to prevent invalid prompt injection.
   */
  addSkill(skill: OpenClawSkill): void {
    if (!skill.name || !skill.instructions) {
      console.warn('[skill-manager] Rejecting invalid skill (missing name or instructions):', skill.name || '<unnamed>')
      return
    }
    this.skills.set(skillKey(skill), skill)
  }

  /**
   * Bulk-load skills (replaces current set).
   * Skills with missing required fields are skipped with a warning.
   */
  loadSkills(skills: OpenClawSkill[]): void {
    this.skills.clear()
    let skipped = 0
    for (const skill of skills) {
      if (!skill.name || !skill.instructions) {
        console.warn('[skill-manager] Skipping invalid skill (missing name or instructions):', skill.name || '<unnamed>')
        skipped++
        continue
      }
      this.skills.set(skillKey(skill), skill)
    }
    console.log(`[skill-manager] Loaded ${this.skills.size} skills${skipped > 0 ? ` (${skipped} skipped due to missing fields)` : ''}`)
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
   * Remove a skill by name and optional teamId.
   * Without teamId, removes the global/builtin skill with that name.
   */
  removeSkill(name: string, teamId?: string | null): boolean {
    return this.skills.delete(`${teamId || 'global'}::${name}`)
  }

  /**
   * Update a skill's configuration by name and optional teamId.
   * Without teamId, updates the global/builtin skill with that name.
   */
  updateSkillConfig(name: string, config: Record<string, unknown>, teamId?: string | null): boolean {
    const key = `${teamId || 'global'}::${name}`
    const skill = this.skills.get(key)
    if (!skill) return false
    skill.config = { ...skill.config, ...config }
    return true
  }
}

export const skillManager = new SkillManager()
