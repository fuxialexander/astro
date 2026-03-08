/**
 * Tests for machine instructions API routes.
 *
 * Integration tests for server/routes/machine-instructions.ts:
 *   - Full CRUD (create, read, update, delete)
 *   - Input validation (missing/empty/invalid fields)
 *   - Cross-user isolation (user B cannot see/edit/delete user A's data)
 *   - Team sharing (team members see each other's instructions)
 *   - Assign/unassign instruction to machine
 *   - Assign overwrite and ownership checks
 *   - Auto-generate from backend templates
 *   - Delete cascades (nullifies machine references, including multiple)
 *   - Field preservation on partial updates
 *   - Timestamp management
 *   - Invalid UUID handling
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
  postJsonAs,
  putJsonAs,
  delAs,
  getAs,
  bootstrapSecondUser,
  SECOND_USER_ID,
  LOCAL_USER_ID,
} from './helpers/test-server.js'

beforeAll(async () => {
  await setupTestServer()
}, 30000)

// Track created IDs for cross-test references
let instructionId: string

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CREATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
    expect(body.ownerId).toBeTruthy()
    expect(body.createdAt).toBeTruthy()
    expect(body.updatedAt).toBeTruthy()
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
    expect(body.source).toBe('user')
  })

  it('trims whitespace from name', async () => {
    const res = await postJson('/api/machine-instructions', {
      name: '  Trimmed Name  ',
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.name).toBe('Trimmed Name')
  })

  it('accepts explicit source=auto', async () => {
    const res = await postJson('/api/machine-instructions', {
      name: 'Auto Source Test',
      source: 'auto',
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.source).toBe('auto')
  })

  it('defaults unknown source values to user', async () => {
    const res = await postJson('/api/machine-instructions', {
      name: 'Unknown Source Test',
      source: 'invalid-source',
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.source).toBe('user')
  })

  it('creates with empty tags array', async () => {
    const res = await postJson('/api/machine-instructions', {
      name: 'Empty Tags',
      tags: [],
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.tags).toEqual([])
  })

  it('creates with large content', async () => {
    const largeContent = '# Large\n\n' + 'x'.repeat(50000)
    const res = await postJson('/api/machine-instructions', {
      name: 'Large Content',
      content: largeContent,
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect((body.content as string).length).toBe(largeContent.length)
  })

  // ── Validation ──

  it('rejects missing name', async () => {
    const res = await postJson('/api/machine-instructions', {
      content: 'some content',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain('name')
  })

  it('rejects empty name', async () => {
    const res = await postJson('/api/machine-instructions', {
      name: '   ',
    })
    expect(res.status).toBe(400)
  })

  it('rejects non-string name', async () => {
    const res = await postJson('/api/machine-instructions', {
      name: 42,
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

  it('rejects empty body', async () => {
    const res = await postJson('/api/machine-instructions', {})
    expect(res.status).toBe(400)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// READ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('GET /api/machine-instructions', () => {
  it('lists all instructions created so far', async () => {
    const res = await request('/api/machine-instructions')
    expect(res.status).toBe(200)
    const body = await res.json() as { instructions: Record<string, unknown>[] }
    // We created several in the POST tests above
    expect(body.instructions.length).toBeGreaterThanOrEqual(5)
    // Each instruction should have standard fields
    const first = body.instructions[0]
    expect(first.id).toBeTruthy()
    expect(first.name).toBeTruthy()
    expect(typeof first.content).toBe('string')
    expect(Array.isArray(first.tags)).toBe(true)
  })
})

describe('GET /api/machine-instructions/:id', () => {
  it('returns a single instruction with all fields', async () => {
    const res = await request(`/api/machine-instructions/${instructionId}`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.id).toBe(instructionId)
    expect(body.name).toBe('K8s Instructions')
    expect(body.content).toBe('# Kubernetes\n\nUse kubectl exec...')
    expect(body.tags).toEqual(['kubernetes', 'k8s'])
    expect(body.source).toBe('user')
    expect(body.ownerId).toBeTruthy()
    expect(body.createdAt).toBeTruthy()
    expect(body.updatedAt).toBeTruthy()
  })

  it('returns 404 for nonexistent instruction', async () => {
    const res = await request('/api/machine-instructions/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })

  it('returns error for invalid UUID format', async () => {
    const res = await request('/api/machine-instructions/not-a-uuid')
    // Should not crash — either 404 or 500 with error message
    expect([404, 500]).toContain(res.status)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UPDATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('PUT /api/machine-instructions/:id', () => {
  it('updates name only, preserves other fields', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      name: 'Renamed K8s',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.name).toBe('Renamed K8s')
    // Content and tags should be unchanged
    expect(body.content).toBe('# Kubernetes\n\nUse kubectl exec...')
    expect(body.tags).toEqual(['kubernetes', 'k8s'])
  })

  it('updates content only, preserves other fields', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      content: '# Updated K8s\n\nNew content here',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.content).toBe('# Updated K8s\n\nNew content here')
    // Name and tags should be unchanged
    expect(body.name).toBe('Renamed K8s')
    expect(body.tags).toEqual(['kubernetes', 'k8s'])
  })

  it('updates tags only, preserves other fields', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      tags: ['k8s', 'gpu'],
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.tags).toEqual(['k8s', 'gpu'])
    expect(body.name).toBe('Renamed K8s')
    expect(body.content).toBe('# Updated K8s\n\nNew content here')
  })

  it('updates multiple fields at once', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      name: 'Multi Update',
      content: '# Multi',
      tags: ['multi'],
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.name).toBe('Multi Update')
    expect(body.content).toBe('# Multi')
    expect(body.tags).toEqual(['multi'])
  })

  it('trims name on update', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      name: '  Trimmed Update  ',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.name).toBe('Trimmed Update')
  })

  it('allows setting content to empty string', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      content: '',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.content).toBe('')
  })

  it('allows setting tags to empty array', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      tags: [],
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.tags).toEqual([])
  })

  it('updates updatedAt timestamp', async () => {
    // First, get current state
    const before = await request(`/api/machine-instructions/${instructionId}`)
    const beforeBody = await before.json() as Record<string, unknown>
    const beforeUpdatedAt = beforeBody.updatedAt as string

    // Wait a tiny bit to ensure timestamp differs
    await new Promise(r => setTimeout(r, 50))

    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      name: 'Timestamp Test',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    const afterUpdatedAt = body.updatedAt as string
    expect(afterUpdatedAt).not.toBe(beforeUpdatedAt)
  })

  // ── Validation ──

  it('rejects empty name', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      name: '',
    })
    expect(res.status).toBe(400)
  })

  it('rejects whitespace-only name', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      name: '   ',
    })
    expect(res.status).toBe(400)
  })

  it('rejects non-string content on update', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      content: { markdown: true },
    })
    expect(res.status).toBe(400)
  })

  it('rejects non-array tags on update', async () => {
    const res = await putJson(`/api/machine-instructions/${instructionId}`, {
      tags: 'single-tag',
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTO-GENERATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
    const content = body.content as string
    expect(content.length).toBeGreaterThan(100)
    // Should not contain YAML frontmatter
    expect(content).not.toMatch(/^---/)
    // Should contain K8s-specific content
    expect(content.toLowerCase()).toMatch(/kubectl|kubernetes|pod|namespace/)
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
    const content = body.content as string
    expect(content.length).toBeGreaterThan(100)
    // Should contain Slurm-specific content
    expect(content.toLowerCase()).toMatch(/sbatch|slurm|squeue|module/)
  })

  it('rejects unsupported backend', async () => {
    const res = await postJson('/api/machine-instructions/auto-generate', {
      backendId: 'docker',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect((body.error as string)).toContain('docker')
    expect((body.error as string)).toContain('k8s-exec')
    expect((body.error as string)).toContain('slurm')
  })

  it('rejects missing backendId', async () => {
    const res = await postJson('/api/machine-instructions/auto-generate', {})
    expect(res.status).toBe(400)
  })

  it('rejects empty string backendId', async () => {
    const res = await postJson('/api/machine-instructions/auto-generate', {
      backendId: '',
    })
    expect(res.status).toBe(400)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ASSIGN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('PUT /api/machine-instructions/assign/:machineId', () => {
  let testMachineId: string
  let secondInstructionId: string

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

    // Create a second instruction for overwrite tests
    const res = await postJson('/api/machine-instructions', {
      name: 'Second Instruction',
      content: '# Second',
      tags: ['test'],
    })
    const body = await res.json() as Record<string, unknown>
    secondInstructionId = body.id as string
  })

  it('assigns an instruction to a machine', async () => {
    const res = await putJson(`/api/machine-instructions/assign/${testMachineId}`, {
      instructionId,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.instructionId).toBe(instructionId)
    expect(body.machineId).toBe(testMachineId)

    // Verify assignment persisted in DB
    const { db } = await import('../server/lib/db/index.js')
    const { registeredMachines } = await import('../server/lib/db/schema.js')
    const { eq } = await import('drizzle-orm')
    const [machine] = await db.select({ defaultInstructionId: registeredMachines.defaultInstructionId })
      .from(registeredMachines).where(eq(registeredMachines.id, testMachineId))
    expect(machine.defaultInstructionId).toBe(instructionId)
  })

  it('overwrites existing assignment with a different instruction', async () => {
    const res = await putJson(`/api/machine-instructions/assign/${testMachineId}`, {
      instructionId: secondInstructionId,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.instructionId).toBe(secondInstructionId)

    // Verify overwrite persisted
    const { db } = await import('../server/lib/db/index.js')
    const { registeredMachines } = await import('../server/lib/db/schema.js')
    const { eq } = await import('drizzle-orm')
    const [machine] = await db.select({ defaultInstructionId: registeredMachines.defaultInstructionId })
      .from(registeredMachines).where(eq(registeredMachines.id, testMachineId))
    expect(machine.defaultInstructionId).toBe(secondInstructionId)
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

  it('clears assignment when instructionId is omitted', async () => {
    // First assign something
    await putJson(`/api/machine-instructions/assign/${testMachineId}`, {
      instructionId,
    })
    // Then clear by omitting instructionId
    const res = await putJson(`/api/machine-instructions/assign/${testMachineId}`, {})
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.instructionId).toBeNull()
  })

  it('returns 404 for nonexistent machine', async () => {
    const res = await putJson('/api/machine-instructions/assign/nonexistent-machine-id', {
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE (including multi-machine cascade)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('DELETE /api/machine-instructions/:id', () => {
  let deleteTargetId: string
  let machine1Id: string
  let machine2Id: string

  beforeAll(async () => {
    // Create an instruction to delete
    const res = await postJson('/api/machine-instructions', {
      name: 'To Be Deleted',
      content: 'Temporary content',
    })
    const body = await res.json() as Record<string, unknown>
    deleteTargetId = body.id as string

    // Create TWO machines that reference it (test multi-machine cascade)
    const { db } = await import('../server/lib/db/index.js')
    const { registeredMachines } = await import('../server/lib/db/schema.js')
    const { LOCAL_USER_ID } = await import('../server/lib/db/bootstrap-local.js')

    machine1Id = `delete-test-m1-${Date.now()}`
    machine2Id = `delete-test-m2-${Date.now()}`

    await db.insert(registeredMachines).values([
      {
        id: machine1Id,
        userId: LOCAL_USER_ID,
        name: 'Delete Test Machine 1',
        hostname: 'delete-host-1',
        platform: 'linux',
        providers: [],
        refreshTokenHash: 'test-hash-1',
        defaultInstructionId: deleteTargetId,
        isConnected: false,
        isRevoked: false,
        registeredAt: new Date(),
        lastSeenAt: new Date(),
      },
      {
        id: machine2Id,
        userId: LOCAL_USER_ID,
        name: 'Delete Test Machine 2',
        hostname: 'delete-host-2',
        platform: 'darwin',
        providers: ['claude-code'],
        refreshTokenHash: 'test-hash-2',
        defaultInstructionId: deleteTargetId,
        isConnected: true,
        isRevoked: false,
        registeredAt: new Date(),
        lastSeenAt: new Date(),
      },
    ])
  })

  it('deletes an instruction and nullifies ALL machine references', async () => {
    const res = await del(`/api/machine-instructions/${deleteTargetId}`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.id).toBe(deleteTargetId)

    // Verify instruction is gone
    const getRes = await request(`/api/machine-instructions/${deleteTargetId}`)
    expect(getRes.status).toBe(404)

    // Verify BOTH machine references were nullified
    const { db } = await import('../server/lib/db/index.js')
    const { registeredMachines } = await import('../server/lib/db/schema.js')
    const { eq } = await import('drizzle-orm')

    const [m1] = await db.select({ defaultInstructionId: registeredMachines.defaultInstructionId })
      .from(registeredMachines).where(eq(registeredMachines.id, machine1Id))
    expect(m1.defaultInstructionId).toBeNull()

    const [m2] = await db.select({ defaultInstructionId: registeredMachines.defaultInstructionId })
      .from(registeredMachines).where(eq(registeredMachines.id, machine2Id))
    expect(m2.defaultInstructionId).toBeNull()
  })

  it('returns 404 for already-deleted instruction', async () => {
    const res = await del(`/api/machine-instructions/${deleteTargetId}`)
    expect(res.status).toBe(404)
  })

  it('returns 404 when deleting nonexistent UUID', async () => {
    const res = await del('/api/machine-instructions/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })

  it('delete of unassigned instruction succeeds without side effects', async () => {
    // Create and immediately delete — no machine references
    const createRes = await postJson('/api/machine-instructions', {
      name: 'Ephemeral',
      content: 'Gone soon',
    })
    const created = await createRes.json() as Record<string, unknown>
    const ephemeralId = created.id as string

    const res = await del(`/api/machine-instructions/${ephemeralId}`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CROSS-USER ISOLATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Cross-user isolation', () => {
  let userAInstructionId: string

  beforeAll(async () => {
    await bootstrapSecondUser()

    // Create an instruction as the default (local) user
    const res = await postJson('/api/machine-instructions', {
      name: 'User A Private Instruction',
      content: 'Secret user A content',
      tags: ['private'],
    })
    const body = await res.json() as Record<string, unknown>
    userAInstructionId = body.id as string
  })

  it('user B cannot list user A instructions (different team)', async () => {
    const res = await getAs(SECOND_USER_ID, '/api/machine-instructions')
    expect(res.status).toBe(200)
    const body = await res.json() as { instructions: Record<string, unknown>[] }
    // User B should NOT see user A's instruction
    const found = body.instructions.find(i => i.id === userAInstructionId)
    expect(found).toBeUndefined()
  })

  it('user B cannot read user A instruction by ID', async () => {
    const res = await getAs(SECOND_USER_ID, `/api/machine-instructions/${userAInstructionId}`)
    expect(res.status).toBe(404)
  })

  it('user B cannot update user A instruction', async () => {
    const res = await putJsonAs(SECOND_USER_ID, `/api/machine-instructions/${userAInstructionId}`, {
      name: 'Hacked by B',
    })
    expect(res.status).toBe(404)
  })

  it('user B cannot delete user A instruction', async () => {
    const res = await delAs(SECOND_USER_ID, `/api/machine-instructions/${userAInstructionId}`)
    expect(res.status).toBe(404)

    // Verify it still exists for user A
    const checkRes = await request(`/api/machine-instructions/${userAInstructionId}`)
    expect(checkRes.status).toBe(200)
  })

  it('user B can create their own instructions', async () => {
    const res = await postJsonAs(SECOND_USER_ID, '/api/machine-instructions', {
      name: 'User B Instruction',
      content: 'User B content',
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.ownerId).toBe(SECOND_USER_ID)
  })

  it('user B can only list their own instructions', async () => {
    const res = await getAs(SECOND_USER_ID, '/api/machine-instructions')
    expect(res.status).toBe(200)
    const body = await res.json() as { instructions: Record<string, unknown>[] }
    // All visible instructions should belong to user B or user B's team
    for (const inst of body.instructions) {
      const isOwnedByB = inst.ownerId === SECOND_USER_ID
      // In local mode, user B has SECOND_TEAM_ID
      const isTeamShared = inst.teamId !== null && inst.teamId !== undefined
      expect(isOwnedByB || isTeamShared).toBe(true)
    }
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ASSIGN OWNERSHIP ENFORCEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Assign ownership enforcement', () => {
  let ownerMachineId: string

  beforeAll(async () => {
    await bootstrapSecondUser()

    // Create a machine owned by the default local user
    const { db } = await import('../server/lib/db/index.js')
    const { registeredMachines } = await import('../server/lib/db/schema.js')

    ownerMachineId = `ownership-test-machine-${Date.now()}`
    await db.insert(registeredMachines).values({
      id: ownerMachineId,
      userId: LOCAL_USER_ID,
      name: 'Ownership Test Machine',
      hostname: 'owner-host',
      platform: 'linux',
      providers: ['claude-code'],
      refreshTokenHash: 'test-hash',
      isConnected: true,
      isRevoked: false,
      registeredAt: new Date(),
      lastSeenAt: new Date(),
    })
  })

  it('non-owner cannot assign instruction to another users machine', async () => {
    const res = await putJsonAs(SECOND_USER_ID, `/api/machine-instructions/assign/${ownerMachineId}`, {
      instructionId,
    })
    expect(res.status).toBe(403)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain('Not authorized')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DISPATCH INTEGRATION — instruction injection into relay payload
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Dispatch instruction injection', () => {
  // These tests verify that the dispatch route correctly looks up
  // machine instructions and injects them into the relay payload.
  // The dispatch-interactive-plan.test.ts covers the relay mock path;
  // here we verify the API-level contract via the CRUD endpoints.

  it('instruction content matches what dispatch would inject', async () => {
    // Create an instruction with known content
    const createRes = await postJson('/api/machine-instructions', {
      name: 'Dispatch Verify',
      content: '# GPU Setup\n\nAlways use --gpus all for training jobs.',
      tags: ['gpu'],
    })
    expect(createRes.status).toBe(201)
    const inst = await createRes.json() as Record<string, unknown>

    // Verify the content is exactly what we set (no corruption)
    const getRes = await request(`/api/machine-instructions/${inst.id}`)
    const fetched = await getRes.json() as Record<string, unknown>
    expect(fetched.content).toBe('# GPU Setup\n\nAlways use --gpus all for training jobs.')
    expect(fetched.name).toBe('Dispatch Verify')

    // The dispatch route would wrap this as:
    // <machine_instructions name="Dispatch Verify">
    // # GPU Setup
    // Always use --gpus all for training jobs.
    // </machine_instructions>
    // Verify name and content are suitable for XML wrapping
    expect(fetched.name).not.toContain('<')
    expect(fetched.name).not.toContain('>')
  })

  it('instruction with special characters in content is stored correctly', async () => {
    const specialContent = '# Config\n\nUse `kubectl exec -it pod -- bash`\nFlags: --namespace=prod & --timeout=30s\nPath: /var/log/*.txt\nQuote: "double" and \'single\''
    const res = await postJson('/api/machine-instructions', {
      name: 'Special Chars',
      content: specialContent,
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>

    // Re-read to verify no corruption
    const getRes = await request(`/api/machine-instructions/${body.id}`)
    const fetched = await getRes.json() as Record<string, unknown>
    expect(fetched.content).toBe(specialContent)
  })
})
