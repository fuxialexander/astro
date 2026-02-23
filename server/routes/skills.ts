/**
 * Skills API Route
 *
 * Manages server-side skill registry: listing, removing,
 * and configuring skills. Skills are populated via relay
 * messages or programmatic registration — not filesystem.
 *
 * Install/uninstall from disk is handled by:
 * - Tauri commands (desktop app)
 * - Agent runner (relay messages)
 */

import { Hono } from 'hono'
import { skillManager } from '../lib/skill-manager.js'
import { errorMessage } from '../lib/error-utils.js'

const skillsRoute = new Hono()

/**
 * List all loaded skills with eligibility status
 *
 * GET /api/skills
 */
skillsRoute.get('/', async (c) => {
  try {
    const all = skillManager.getAllSkills()
    const eligible = new Set(skillManager.getEligibleSkills().map((s) => s.name))

    const skills = all.map((s) => ({
      name: s.name,
      description: s.description,
      source: s.source,
      enabled: s.enabled,
      eligible: eligible.has(s.name),
      userInvocable: s.userInvocable ?? true,
      pluginId: s.pluginId,
      config: s.config,
    }))

    return c.json({ skills, total: skills.length })
  } catch (e) {
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Register skills (bulk load from relay or Tauri)
 *
 * POST /api/skills/register
 */
skillsRoute.post('/register', async (c) => {
  try {
    const { skills } = await c.req.json<{ skills: Array<{ name: string; description: string; instructions: string; source?: string; enabled?: boolean }> }>()
    if (!Array.isArray(skills)) {
      return c.json({ error: 'skills must be an array' }, 400)
    }

    for (const s of skills) {
      skillManager.addSkill({
        name: s.name,
        description: s.description ?? '',
        instructions: s.instructions ?? '',
        source: (s.source as 'builtin' | 'workspace' | 'clawhub' | 'plugin') ?? 'workspace',
        enabled: s.enabled ?? true,
      })
    }

    return c.json({ success: true, total: skills.length })
  } catch (e) {
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Install a skill from ClawHub (stub)
 *
 * POST /api/skills/install
 */
skillsRoute.post('/install', async (c) => {
  return c.json({ error: 'ClawHub integration not yet implemented' }, 501)
})

/**
 * Remove a skill from the in-memory registry
 *
 * DELETE /api/skills/:name
 */
skillsRoute.delete('/:name', async (c) => {
  try {
    const { name } = c.req.param()
    const removed = skillManager.removeSkill(name)

    if (!removed) {
      return c.json({ error: `Skill '${name}' not found` }, 404)
    }

    return c.json({ success: true, name })
  } catch (e) {
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Update skill configuration
 *
 * PUT /api/skills/:name/config
 */
skillsRoute.put('/:name/config', async (c) => {
  try {
    const { name } = c.req.param()
    const config = await c.req.json<Record<string, unknown>>()

    const updated = skillManager.updateSkillConfig(name, config)

    if (!updated) {
      return c.json({ error: `Skill '${name}' not found` }, 404)
    }

    return c.json({ success: true, name })
  } catch (e) {
    return c.json({ error: errorMessage(e) }, 500)
  }
})

export { skillsRoute }
