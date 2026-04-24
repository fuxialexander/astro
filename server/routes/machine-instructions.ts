/**
 * Machine Instructions API Route
 *
 * CRUD for machine instruction documents — shared markdown documents
 * that tell AI agents how to run computation on specific environments.
 * Instructions are team-owned standalone resources. Reads use the current
 * team context as a filter; writes accept an explicit teamId payload.
 */

import { Hono } from 'hono'
import { eq, and, or, desc } from 'drizzle-orm'
import { db } from '../lib/db/index.js'
import { machineInstructions, registeredMachines } from '../lib/db/schema.js'
import { errorMessage } from '../lib/error-utils.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { MACHINE_INSTRUCTION_PRESETS } from '../lib/machine-instruction-presets.js'
import { resolveWritableTeamId } from '../lib/team-utils.js'
import {
  encryptMachineInstructionWrite,
  decryptMachineInstructionRow,
} from '../lib/phi-encryption.js'

const machineInstructionsRoute = new Hono()

machineInstructionsRoute.use('/*', requireAuth)

/**
 * Build a scope filter: owner's own instructions + team-shared instructions.
 */
function scopeFilter(user: AuthUser) {
  return or(
    eq(machineInstructions.ownerId, user.id),
    user.teamId ? eq(machineInstructions.teamId, user.teamId) : undefined,
  )!
}

/**
 * GET /api/machine-instructions/presets
 * List built-in machine instruction presets (read-only, loaded from markdown files).
 */
machineInstructionsRoute.get('/presets', async (c) => {
  return c.json({ presets: MACHINE_INSTRUCTION_PRESETS })
})

/**
 * GET /api/machine-instructions
 * List all instructions visible to the user.
 */
machineInstructionsRoute.get('/', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const rows = await db.select().from(machineInstructions).where(scopeFilter(user)).orderBy(desc(machineInstructions.updatedAt))
    return c.json({ instructions: rows.map(decryptMachineInstructionRow) })
  } catch (e) {
    console.error('[machine-instructions] GET / error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * GET /api/machine-instructions/:id
 * Get a single instruction by ID.
 */
machineInstructionsRoute.get('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')
    const [row] = await db.select().from(machineInstructions).where(
      and(eq(machineInstructions.id, id), scopeFilter(user))
    )
    if (!row) return c.json({ error: 'Instruction not found' }, 404)
    return c.json(decryptMachineInstructionRow(row))
  } catch (e) {
    console.error('[machine-instructions] GET /:id error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * POST /api/machine-instructions
 * Create a new instruction document.
 */
machineInstructionsRoute.post('/', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const body = await c.req.json()
    const teamTarget = resolveWritableTeamId(user, body.teamId)
    if ('error' in teamTarget) return c.json({ error: teamTarget.error }, 400)

    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return c.json({ error: 'name is required' }, 400)
    }
    if (body.name.length > 500) {
      return c.json({ error: 'name must be at most 500 characters' }, 400)
    }
    if (body.content !== undefined && typeof body.content !== 'string') {
      return c.json({ error: 'content must be a string' }, 400)
    }
    if (typeof body.content === 'string' && body.content.length > 200000) {
      return c.json({ error: 'content must be at most 200000 characters' }, 400)
    }
    if (body.tags !== undefined && !Array.isArray(body.tags)) {
      return c.json({ error: 'tags must be an array' }, 400)
    }
    if (Array.isArray(body.tags) && !body.tags.every((t: unknown) => typeof t === 'string')) {
      return c.json({ error: 'tags must be an array of strings' }, 400)
    }

    const now = new Date()
    const [row] = await db.insert(machineInstructions).values(encryptMachineInstructionWrite({
      ownerId: user.id,
      teamId: teamTarget.teamId,
      name: body.name.trim(),
      content: body.content ?? '',
      tags: body.tags ?? [],
      source: body.source === 'auto' ? 'auto' : 'user',
      createdAt: now,
      updatedAt: now,
    })).returning()

    return c.json(decryptMachineInstructionRow(row), 201)
  } catch (e) {
    console.error('[machine-instructions] POST / error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * PUT /api/machine-instructions/assign/:machineId
 * Assign a default instruction to a machine (or clear it with null).
 * NOTE: Must be registered BEFORE the generic PUT /:id route so Hono
 * matches the specific `/assign/...` path first.
 */
machineInstructionsRoute.put('/assign/:machineId', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const machineId = c.req.param('machineId')
    const body = await c.req.json()
    const instructionId: string | null = body.instructionId ?? null

    // Verify machine ownership
    const [machine] = await db.select({ id: registeredMachines.id, userId: registeredMachines.userId })
      .from(registeredMachines).where(eq(registeredMachines.id, machineId)).limit(1)
    if (!machine) return c.json({ error: 'Machine not found' }, 404)
    if (machine.userId !== user.id) return c.json({ error: 'Not authorized' }, 403)

    // If setting an instruction, verify it exists and user has access
    if (instructionId) {
      // Builtin presets (e.g. "builtin:local-with-slurm") are not stored in DB
      const isBuiltin = instructionId.startsWith('builtin:')
      if (isBuiltin) {
        const validPreset = MACHINE_INSTRUCTION_PRESETS.find((p) => p.id === instructionId)
        if (!validPreset) return c.json({ error: 'Unknown builtin preset' }, 404)
      } else {
        const [instruction] = await db.select({ id: machineInstructions.id })
          .from(machineInstructions).where(
            and(eq(machineInstructions.id, instructionId), scopeFilter(user))
          ).limit(1)
        if (!instruction) return c.json({ error: 'Instruction not found' }, 404)
      }
    }

    await db.update(registeredMachines)
      .set({ defaultInstructionId: instructionId })
      .where(eq(registeredMachines.id, machineId))

    return c.json({ ok: true, machineId, instructionId })
  } catch (e) {
    console.error('[machine-instructions] PUT /assign/:machineId error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * PUT /api/machine-instructions/:id
 * Update an existing instruction.
 */
machineInstructionsRoute.put('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    const [existing] = await db.select().from(machineInstructions).where(
      and(eq(machineInstructions.id, id), scopeFilter(user))
    )
    if (!existing) return c.json({ error: 'Instruction not found' }, 404)

    const body = await c.req.json()
    const patch: Record<string, unknown> = { updatedAt: new Date() }

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return c.json({ error: 'name must be a non-empty string' }, 400)
      }
      if (body.name.length > 500) {
        return c.json({ error: 'name must be at most 500 characters' }, 400)
      }
      patch.name = body.name.trim()
    }
    if (body.content !== undefined) {
      if (typeof body.content !== 'string') {
        return c.json({ error: 'content must be a string' }, 400)
      }
      if (body.content.length > 200000) {
        return c.json({ error: 'content must be at most 200000 characters' }, 400)
      }
      patch.content = body.content
    }
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) {
        return c.json({ error: 'tags must be an array' }, 400)
      }
      if (!body.tags.every((t: unknown) => typeof t === 'string')) {
        return c.json({ error: 'tags must be an array of strings' }, 400)
      }
      patch.tags = body.tags
    }
    if (body.teamId !== undefined) {
      const teamTarget = resolveWritableTeamId(user, body.teamId)
      if ('error' in teamTarget) return c.json({ error: teamTarget.error }, 400)
      patch.teamId = teamTarget.teamId
    }

    await db.update(machineInstructions).set(encryptMachineInstructionWrite(patch)).where(eq(machineInstructions.id, id))
    const [updated] = await db.select().from(machineInstructions).where(eq(machineInstructions.id, id))
    return c.json(decryptMachineInstructionRow(updated))
  } catch (e) {
    console.error('[machine-instructions] PUT /:id error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * DELETE /api/machine-instructions/:id
 * Delete an instruction. Also nullifies any machine references to it.
 */
machineInstructionsRoute.delete('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    const [existing] = await db.select().from(machineInstructions).where(
      and(eq(machineInstructions.id, id), scopeFilter(user))
    )
    if (!existing) return c.json({ error: 'Instruction not found' }, 404)

    // Nullify machine references and delete in a single transaction
    await db.transaction(async (tx) => {
      await tx.update(registeredMachines)
        .set({ defaultInstructionId: null })
        .where(eq(registeredMachines.defaultInstructionId, id))
      await tx.delete(machineInstructions).where(eq(machineInstructions.id, id))
    })
    return c.json({ ok: true, id })
  } catch (e) {
    console.error('[machine-instructions] DELETE /:id error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * POST /api/machine-instructions/auto-generate
 * Auto-generate an instruction from a compute backend default template.
 * Used when a machine connects with K8s/Slurm detected.
 * Supported backends: 'k8s-exec', 'slurm'
 */
machineInstructionsRoute.post('/auto-generate', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const body = await c.req.json()
    const { backendId } = body
    const teamTarget = resolveWritableTeamId(user, body.teamId)
    if ('error' in teamTarget) return c.json({ error: teamTarget.error }, 400)

    const BACKEND_TEMPLATES: Record<string, { name: string; dir: string; tags: string[] }> = {
      'k8s-exec': { name: 'Kubernetes Execution', dir: 'k8s-exec', tags: ['kubernetes', 'k8s'] },
      'slurm': { name: 'Slurm HPC Execution', dir: 'slurm', tags: ['slurm', 'hpc'] },
    }

    const template = BACKEND_TEMPLATES[backendId]
    if (!template) {
      return c.json({ error: `No default template for backend: ${backendId}. Supported: ${Object.keys(BACKEND_TEMPLATES).join(', ')}` }, 400)
    }

    // Read the seed SKILL.md file
    const fs = await import('fs/promises')
    const path = await import('path')
    const { fileURLToPath } = await import('url')

    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const repoRoot = path.resolve(__dirname, '../..')
    const seedPath = path.join(repoRoot, 'skills', 'compute_backend_default', template.dir, 'SKILL.md')

    let content: string
    try {
      const raw = await fs.readFile(seedPath, 'utf-8')
      // Strip YAML frontmatter — only keep the markdown content
      content = raw.replace(/^---[\s\S]*?---\s*\n?/, '')
    } catch {
      return c.json({ error: `Seed template not found for backend: ${template.dir}` }, 500)
    }

    const now = new Date()
    const [row] = await db.insert(machineInstructions).values(encryptMachineInstructionWrite({
      ownerId: user.id,
      teamId: teamTarget.teamId,
      name: template.name,
      content,
      tags: template.tags,
      source: 'auto',
      createdAt: now,
      updatedAt: now,
    })).returning()

    return c.json(decryptMachineInstructionRow(row), 201)
  } catch (e) {
    console.error('[machine-instructions] POST /auto-generate error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

export { machineInstructionsRoute }
