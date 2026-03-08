/**
 * Tests for machine instructions API routes.
 *
 * Integration tests for server/routes/machine-instructions.ts:
 *   - Full CRUD (create, read, update, delete)
 *   - Assign/unassign instruction to machine
 *   - Auto-generate from backend templates
 *   - Validation (missing name, invalid types)
 *   - Scope filtering (owner + team)
 *   - Delete cascades (nullifies machine references)
 *
 * Uses PGlite (local mode) for database isolation.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  setupTestServer,
  request,
  postJson,
  putJson,
  del,
} from './helpers/test-server.js'

beforeAll(async () => {
  await setupTestServer()
}, 30000)

// Track created IDs for cross-test references
let instructionId: string

describe('POST /api/machine-instructions', () => {
  it('creates an instruction with all fields', async () => {
    const res = await postJson('/api/machine-instructions', {
      name: 'K8s Instructions',
      content: '# Kubernetes\n\nUse kubectl exec...',
      tags: ['kubernetes', 'k8s'],
    })

    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.id).toBeTruthy()
    expect(body.name).toBe('K8s Instructions')
    expect(body.content).toBe('# Kubernetes\n\nUse kubectl exec...')
    expect(body.tags).toEqual(['kubernetes', 'k8s'])
    expect(body.source).toBe('user')
    instructionId = body.id as string
  })

  it('creates with minimal fields (name only)', async () => {
    const res = await postJson('/api/machine-instructions', {
      name: 'Minimal',
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.name).toBe('Minimal')
    expect(body.content).toBe('')
    expect(body.tags).toEqual([])
  })

  it('rejects missing name', async () => {
    const res = await postJson('/api/machine-instructions', {
      content: 'some content',
    })
    expect(res.status).toBe(400)
  })

  it('rejects empty name', async () => {
    const res = await postJson('/api/machine-instructions', {
      name: '   ',
    })
    expect(res.status).toBe(400)
  })

  it('rejects non-string content', async () => {
    const res = await postJson('/api/machine-instructions', {
      name: 'Test',
      content: 123,
    })
    expect(res.status).toBe(400)
  })

  it('rejects non-array tags', async () => {
    const res = await postJson('/api/machine-instructions', {
      name: 'Test',
      tags: 'not-an-array',
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/machine-instructions', () => {
  it('lists all instructions', async () => {
    const res = await request('/api/machine-instructions')
    expect(res.status).toBe(200)
    const body = await res.json() as { instructions: unknown[] }
    expect(body.instructions.length).toBeGreaterThanOrEqual(2)
  })
})

describe('GET /api/machine-instructions/:id', () => {
  it('returns a single instruction', async () => {
    const res = await request(`/api/machine-instructions/${instructionId}`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.id).toBe(instructionId)
    expect(body.name).toBe('K8s Instructions')
  })

  it('returns 404 for nonexistent instruction', async () => {
    const res = await request('/api/machine-instructions/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/machine-instructions/:id', () => {
  it('updates name', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      name: 'Updated K8s Instructions',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.name).toBe('Updated K8s Instructions')
  })

  it('updates content', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      content: '# Updated content',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.content).toBe('# Updated content')
  })

  it('updates tags', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      tags: ['k8s', 'updated'],
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.tags).toEqual(['k8s', 'updated'])
  })

  it('rejects empty name', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      name: '',
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for nonexistent instruction', async () => {
    const res = await putJson('/api/machine-instructions/00000000-0000-0000-0000-000000000000', {
      name: 'Ghost',
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/machine-instructions/auto-generate', () => {
  it('generates K8s instruction from template', async () => {
    const res = await postJson('/api/machine-instructions/auto-generate', {
      backendId: 'k8s-exec',
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.name).toBe('Kubernetes Execution')
    expect(body.source).toBe('auto')
    expect(body.tags).toEqual(['kubernetes', 'k8s'])
    expect(typeof body.content).toBe('string')
    expect((body.content as string).length).toBeGreaterThan(100)
    // Should not contain YAML frontmatter
    expect((body.content as string)).not.toMatch(/^---/)
  })

  it('generates Slurm instruction from template', async () => {
    const res = await postJson('/api/machine-instructions/auto-generate', {
      backendId: 'slurm',
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.name).toBe('Slurm HPC Execution')
    expect(body.source).toBe('auto')
    expect(body.tags).toEqual(['slurm', 'hpc'])
  })

  it('rejects unsupported backend', async () => {
    const res = await postJson('/api/machine-instructions/auto-generate', {
      backendId: 'docker',
    })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/machine-instructions/assign/:machineId', () => {
  // We need a machine to test assignment. In local mode, we can create one directly.
  let testMachineId: string

  beforeAll(async () => {
    // Insert a test machine directly into DB for assignment tests
    const { db } = await import('../server/lib/db/index.js')
    const { registeredMachines } = await import('../server/lib/db/schema.js')
    const { LOCAL_USER_ID } = await import('../server/lib/db/bootstrap-local.js')

    testMachineId = `test-machine-${Date.now()}`
    await db.insert(registeredMachines).values({
      id: testMachineId,
      userId: LOCAL_USER_ID,
      name: 'Test Machine',
      hostname: 'test-host',
      platform: 'linux',
      providers: ['claude-code'],
      refreshTokenHash: 'test-hash',
      isConnected: true,
      isRevoked: false,
      registeredAt: new Date(),
      lastSeenAt: new Date(),
    })
  })

  it('assigns an instruction to a machine', async () => {
    const res = await putJson(`/api/machine-instructions/assign/${testMachineId}`, {
      instructionId,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.instructionId).toBe(instructionId)
  })

  it('clears assignment with null', async () => {
    const res = await putJson(`/api/machine-instructions/assign/${testMachineId}`, {
      instructionId: null,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.instructionId).toBeNull()
  })

  it('returns 404 for nonexistent machine', async () => {
    const res = await putJson('/api/machine-instructions/assign/nonexistent', {
      instructionId,
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 for nonexistent instruction', async () => {
    const res = await putJson(`/api/machine-instructions/assign/${testMachineId}`, {
      instructionId: '00000000-0000-0000-0000-000000000000',
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/machine-instructions/:id', () => {
  let deleteTargetId: string
  let machineForDeleteTest: string

  beforeAll(async () => {
    // Create an instruction to delete
    const res = await postJson('/api/machine-instructions', {
      name: 'To Be Deleted',
      content: 'Temporary content',
    })
    const body = await res.json() as Record<string, unknown>
    deleteTargetId = body.id as string

    // Create a machine that references it
    const { db } = await import('../server/lib/db/index.js')
    const { registeredMachines } = await import('../server/lib/db/schema.js')
    const { LOCAL_USER_ID } = await import('../server/lib/db/bootstrap-local.js')

    machineForDeleteTest = `delete-test-machine-${Date.now()}`
    await db.insert(registeredMachines).values({
      id: machineForDeleteTest,
      userId: LOCAL_USER_ID,
      name: 'Delete Test Machine',
      hostname: 'delete-host',
      platform: 'linux',
      providers: [],
      refreshTokenHash: 'test-hash',
      defaultInstructionId: deleteTargetId,
      isConnected: false,
      isRevoked: false,
      registeredAt: new Date(),
      lastSeenAt: new Date(),
    })
  })

  it('deletes an instruction and nullifies machine references', async () => {
    const res = await del(`/api/machine-instructions/${deleteTargetId}`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)

    // Verify instruction is gone
    const getRes = await request(`/api/machine-instructions/${deleteTargetId}`)
    expect(getRes.status).toBe(404)

    // Verify machine reference was nullified
    const { db } = await import('../server/lib/db/index.js')
    const { registeredMachines } = await import('../server/lib/db/schema.js')
    const { eq } = await import('drizzle-orm')
    const [machine] = await db.select({ defaultInstructionId: registeredMachines.defaultInstructionId })
      .from(registeredMachines).where(eq(registeredMachines.id, machineForDeleteTest))
    expect(machine.defaultInstructionId).toBeNull()
  })

  it('returns 404 for already-deleted instruction', async () => {
    const res = await del(`/api/machine-instructions/${deleteTargetId}`)
    expect(res.status).toBe(404)
  })
})
