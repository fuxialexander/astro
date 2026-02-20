/**
 * Skills API Route
 *
 * Manages server-side skill lifecycle: listing, installing,
 * uninstalling, and configuring OpenClaw-compatible skills.
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
 * Install a skill from ClawHub (stub)
 *
 * POST /api/skills/install
 */
skillsRoute.post('/install', async (c) => {
  return c.json({ error: 'ClawHub integration not yet implemented' }, 501)
})

/**
 * Uninstall a skill
 *
 * DELETE /api/skills/:name
 */
skillsRoute.delete('/:name', async (c) => {
  try {
    const { name } = c.req.param()
    const removed = skillManager.uninstallSkill(name)

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
