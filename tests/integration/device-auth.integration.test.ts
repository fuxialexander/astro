/**
 * Integration test: Device authorization lifecycle
 *
 * Tests the OAuth2 Device Authorization Grant (RFC 8628) flow:
 * authorize → poll (pending) → approve → poll (tokens) → stats
 * Also tests the denial flow.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestServer, db, LOCAL_USER_ID, SECOND_USER_ID, bootstrapSecondUser } from '../helpers/test-server.js'
import { deviceCodes, registeredMachines } from '../../server/lib/db/schema.js'
import { eq } from 'drizzle-orm'
import { registerMachine, getMachine } from '../../server/lib/registered-machines-store.js'
import type { Hono } from 'hono'

let app: Hono

beforeAll(async () => {
  app = await setupTestServer()
})

beforeEach(async () => {
  await db.delete(deviceCodes)
})

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function get(path: string) {
  return app.request(path)
}

describe('POST /api/device/authorize', () => {
  it('returns deviceCode, userCode, and verification URIs', async () => {
    const res = await post('/api/device/authorize', {
      machineInfo: {
        environmentType: 'local',
        hostname: 'test-machine',
        platform: 'darwin',
      },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deviceCode).toBeTruthy()
    expect(body.userCode).toBeTruthy()
    expect(body.verificationUri).toContain('/device')
    expect(body.expiresIn).toBeGreaterThan(0)
    expect(body.interval).toBeGreaterThan(0)
  })

  it('returns 400 when machineInfo.environmentType is missing', async () => {
    const res = await post('/api/device/authorize', {
      machineInfo: {},
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_request')
  })
})

describe('Device code approval flow', () => {
  it('polls pending, approves, then gets access token', async () => {
    // Step 1: Authorize
    const authRes = await post('/api/device/authorize', {
      machineInfo: {
        environmentType: 'local',
        hostname: 'flow-test',
        platform: 'linux',
      },
    })
    const { deviceCode, userCode } = await authRes.json()

    // Step 2: Poll — should be pending
    const pendingRes = await post('/api/device/token', {
      grantType: 'urn:ietf:params:oauth:grant-type:device_code',
      userCode,
    })
    expect(pendingRes.status).toBe(400)
    const pendingBody = await pendingRes.json()
    expect(pendingBody.error).toBe('authorization_pending')

    // Step 3: Approve the device code
    const approveRes = await post(`/api/device/code/${deviceCode}/authorize`, {
      userId: LOCAL_USER_ID,
    })
    expect(approveRes.status).toBe(200)
    const approveBody = await approveRes.json()
    expect(approveBody.success).toBe(true)

    // Reset lastPolledAt to avoid poll-rate throttle
    await db.update(deviceCodes)
      .set({ lastPolledAt: null })
      .where(eq(deviceCodes.userCode, userCode))

    // Step 4: Poll again — should get access token
    const tokenRes = await post('/api/device/token', {
      grantType: 'urn:ietf:params:oauth:grant-type:device_code',
      userCode,
    })
    expect(tokenRes.status).toBe(200)
    const tokenBody = await tokenRes.json()
    expect(tokenBody.accessToken).toBeTruthy()
    expect(tokenBody.tokenType).toBe('Bearer')
    expect(tokenBody.expiresIn).toBeGreaterThan(0)
  })
})

describe('Device code denial flow', () => {
  it('returns access_denied after denial', async () => {
    // Step 1: Authorize
    const authRes = await post('/api/device/authorize', {
      machineInfo: {
        environmentType: 'local',
        hostname: 'deny-test',
        platform: 'linux',
      },
    })
    const { deviceCode, userCode } = await authRes.json()

    // Step 2: Deny the device code
    const denyRes = await post(`/api/device/code/${deviceCode}/deny`, {})
    expect(denyRes.status).toBe(200)
    const denyBody = await denyRes.json()
    expect(denyBody.success).toBe(true)

    // Step 3: Poll — should get access_denied
    const tokenRes = await post('/api/device/token', {
      grantType: 'urn:ietf:params:oauth:grant-type:device_code',
      userCode,
    })
    expect(tokenRes.status).toBe(400)
    const tokenBody = await tokenRes.json()
    expect(tokenBody.error).toBe('access_denied')
  })
})

describe('GET /api/device/stats', () => {
  it('returns device auth statistics', async () => {
    const res = await get('/api/device/stats')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.pendingDeviceCodes).toBe('number')
  })

  it('counts pending codes correctly', async () => {
    // Create a pending device code
    await post('/api/device/authorize', {
      machineInfo: { environmentType: 'local' },
    })

    const res = await get('/api/device/stats')
    const body = await res.json()
    expect(body.pendingDeviceCodes).toBeGreaterThanOrEqual(1)
  })
})

describe('POST /api/device/token — invalid grant type', () => {
  it('returns unsupported_grant_type error', async () => {
    const res = await post('/api/device/token', {
      grantType: 'invalid',
      userCode: 'ABC',
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('unsupported_grant_type')
  })
})

describe('GET /api/device/code/:code', () => {
  it('returns device code info for pending code', async () => {
    const authRes = await post('/api/device/authorize', {
      machineInfo: {
        environmentType: 'local',
        hostname: 'info-test',
        platform: 'darwin',
      },
    })
    const { deviceCode } = await authRes.json()

    const res = await get(`/api/device/code/${deviceCode}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deviceCode).toBe(deviceCode)
    expect(body.machineInfo).toBeDefined()
  })

  it('returns 404 for invalid device code', async () => {
    const res = await get('/api/device/code/invalid-code')
    expect(res.status).toBe(404)
  })
})

// ── Machine registration ownership transfer ─────────────────────────
describe('machine registration ownership transfer', () => {
  const MACHINE_ID = 'ownership-test-machine-001'

  beforeAll(async () => {
    await bootstrapSecondUser()
  })

  beforeEach(async () => {
    // Clean up any machines from previous test runs
    await db.delete(registeredMachines).where(eq(registeredMachines.id, MACHINE_ID))
  })

  const baseMachineParams = {
    id: MACHINE_ID,
    name: 'test-machine',
    hostname: 'test-host',
    platform: 'darwin',
    environmentType: 'local' as const,
    providers: ['claude-code' as const],
    refreshTokenHash: 'hash-abc',
  }

  it('transfers ownership when same hardware ID registers under different user', async () => {
    // Register machine under User A (LOCAL_USER_ID)
    const machineA = await registerMachine({
      ...baseMachineParams,
      userId: LOCAL_USER_ID,
    })
    expect(machineA.id).toBe(MACHINE_ID)
    expect(machineA.userId).toBe(LOCAL_USER_ID)

    // Register same machine ID under User B (SECOND_USER_ID)
    const machineB = await registerMachine({
      ...baseMachineParams,
      userId: SECOND_USER_ID,
      refreshTokenHash: 'hash-def',
    })
    expect(machineB.id).toBe(MACHINE_ID)
    expect(machineB.userId).toBe(SECOND_USER_ID)

    // Verify in DB that the machine now belongs to User B
    const dbMachine = await getMachine(MACHINE_ID)
    expect(dbMachine).not.toBeNull()
    expect(dbMachine!.userId).toBe(SECOND_USER_ID)
    expect(dbMachine!.refreshTokenHash).toBe('hash-def')
  })

  it('re-registration un-revokes a previously revoked machine', async () => {
    // Register machine
    await registerMachine({
      ...baseMachineParams,
      userId: LOCAL_USER_ID,
    })

    // Revoke it directly in DB
    await db.update(registeredMachines)
      .set({ isRevoked: true })
      .where(eq(registeredMachines.id, MACHINE_ID))

    // Confirm it is revoked
    const revokedMachine = await getMachine(MACHINE_ID)
    expect(revokedMachine!.isRevoked).toBe(true)

    // Re-register with same ID and same user
    const reRegistered = await registerMachine({
      ...baseMachineParams,
      userId: LOCAL_USER_ID,
      refreshTokenHash: 'hash-new',
    })

    expect(reRegistered.id).toBe(MACHINE_ID)
    expect(reRegistered.isRevoked).toBe(false)

    // Verify in DB
    const dbMachine = await getMachine(MACHINE_ID)
    expect(dbMachine!.isRevoked).toBe(false)
    expect(dbMachine!.refreshTokenHash).toBe('hash-new')
  })

  it('preserves custom name on same-user re-registration', async () => {
    // Register machine with default name
    await registerMachine({
      ...baseMachineParams,
      userId: LOCAL_USER_ID,
    })

    // Simulate user renaming the machine via DB update
    const customName = 'My Workstation'
    await db.update(registeredMachines)
      .set({ name: customName })
      .where(eq(registeredMachines.id, MACHINE_ID))

    // Re-register with same user — the custom name should be preserved
    const reRegistered = await registerMachine({
      ...baseMachineParams,
      userId: LOCAL_USER_ID,
      refreshTokenHash: 'hash-updated',
    })

    expect(reRegistered.id).toBe(MACHINE_ID)
    expect(reRegistered.name).toBe(customName)

    // Verify in DB
    const dbMachine = await getMachine(MACHINE_ID)
    expect(dbMachine!.name).toBe(customName)
  })
})
