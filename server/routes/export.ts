import { Hono } from 'hono'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { db } from '../lib/db/index.js'
import { teamReferences, planNodes, projects } from '../lib/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { generateDocx } from '../lib/export/docx-generator.js'
import type { Reference } from '@astro/core/types'

function extractCiteKeys(text: string): string[] {
  const keys: string[] = []
  const re = /\[(@[\w-]+(?:\s*;\s*@[\w-]+)*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    for (const part of m[1].split(';')) {
      const k = part.trim().replace(/^@/, '')
      if (k) keys.push(k)
    }
  }
  return keys
}

const exportRoute = new Hono()
exportRoute.use('/*', requireAuth)

/**
 * POST /api/export/docx
 * Body: { projectId: string, citationStyle?: string }
 */
exportRoute.post('/docx', async (c) => {
  const user = c.get('user')! as AuthUser
  const teamId = user.teamId
  if (!teamId) return c.json({ error: 'No active team' }, 400)

  const body = await c.req.json().catch(() => null) as {
    projectId?: string
    citationStyle?: string
  } | null

  const projectId = body?.projectId
  const citationStyle = body?.citationStyle ?? 'apa'

  let title = 'Document'
  let description: string | undefined
  let refs: Reference[] = []

  if (projectId) {
    const [project] = await db.select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)))

    if (!project) return c.json({ error: 'Project not found' }, 404)

    title = project.name ?? 'Untitled'
    description = project.description ?? undefined

    const nodes = await db.select({ description: planNodes.description, content: planNodes.content })
      .from(planNodes)
      .where(and(eq(planNodes.projectId, projectId), eq(planNodes.teamId, teamId)))

    const keys = new Set<string>()
    for (const k of extractCiteKeys(project.description ?? '')) keys.add(k)
    for (const node of nodes) {
      for (const k of extractCiteKeys(node.description ?? '')) keys.add(k)
      for (const k of extractCiteKeys(node.content ?? '')) keys.add(k)
    }

    if (keys.size > 0) {
      const allRows = await db.select().from(teamReferences).where(eq(teamReferences.teamId, teamId))
      refs = allRows
        .map(r => ({ ...r.data, id: r.citeKey } as Reference))
        .filter(r => keys.has(r.id))
    }
  } else {
    // Export full library with no body text
    const rows = await db.select().from(teamReferences).where(eq(teamReferences.teamId, teamId))
    refs = rows.map(r => ({ ...r.data, id: r.citeKey } as Reference))
  }

  const buffer = await generateDocx({ title, description, citationStyle, references: refs })
  const filename = `${title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'document'}.docx`

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})

export { exportRoute }
