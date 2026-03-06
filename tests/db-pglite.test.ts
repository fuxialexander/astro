/**
 * Unit tests for the dual-driver DB module (server/lib/db/index.ts)
 *
 * Verifies:
 * - PGlite is used in local mode
 * - postgres-js is used in server mode
 * - Proxy throws if DB is not initialized
 * - initDb() is idempotent (returns same instance on second call)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test the core logic by mocking the drivers and mode detection.

describe('db/index.ts — dual-driver factory', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('initializes PGlite driver in local mode', async () => {
    let pgliteCallCount = 0

    vi.doMock('../packages/core/src/app-mode.js', () => ({
      isLocalMode: () => true,
    }))
    vi.doMock('../server/lib/app-mode.js', () => ({
      isLocalMode: () => true,
    }))
    vi.doMock('@electric-sql/pglite', () => ({
      PGlite: class MockPGlite { constructor() { pgliteCallCount++ } },
    }))
    vi.doMock('drizzle-orm/pglite', () => ({
      drizzle: vi.fn().mockReturnValue({ $client: 'pglite-mock' }),
    }))
    vi.doMock('../packages/core/src/db/schema.js', () => ({}))
    vi.doMock('../server/lib/db/schema.js', () => ({}))
    vi.doMock('../packages/core/src/db/run-migrations.js', () => ({ runMigrations: vi.fn() }))

    const { initDb } = await import('../server/lib/db/index.js')
    const db = await initDb()

    expect(db).toBeDefined()
    expect(pgliteCallCount).toBe(1)
  })

  it('initializes postgres-js driver in server mode', async () => {
    const mockPostgres = vi.fn().mockReturnValue({})

    vi.doMock('../packages/core/src/app-mode.js', () => ({
      isLocalMode: () => false,
    }))
    vi.doMock('../server/lib/app-mode.js', () => ({
      isLocalMode: () => false,
    }))
    vi.doMock('postgres', () => ({
      default: mockPostgres,
    }))
    vi.doMock('drizzle-orm/postgres-js', () => ({
      drizzle: vi.fn().mockReturnValue({ $client: 'postgres-mock' }),
    }))
    vi.doMock('../packages/core/src/db/schema.js', () => ({}))
    vi.doMock('../server/lib/db/schema.js', () => ({}))
    vi.doMock('../packages/core/src/db/run-migrations.js', () => ({ runMigrations: vi.fn() }))

    const { initDb } = await import('../server/lib/db/index.js')
    const db = await initDb()

    expect(db).toBeDefined()
    expect(mockPostgres).toHaveBeenCalledTimes(1)
  })

  it('initDb returns same instance on subsequent calls', async () => {
    const mockDrizzle = vi.fn().mockReturnValue({ $client: 'pglite-mock' })
    let pgliteCallCount = 0

    vi.doMock('../packages/core/src/app-mode.js', () => ({
      isLocalMode: () => true,
    }))
    vi.doMock('../server/lib/app-mode.js', () => ({
      isLocalMode: () => true,
    }))
    vi.doMock('@electric-sql/pglite', () => ({
      PGlite: class MockPGlite { constructor() { pgliteCallCount++ } },
    }))
    vi.doMock('drizzle-orm/pglite', () => ({
      drizzle: mockDrizzle,
    }))
    vi.doMock('../packages/core/src/db/schema.js', () => ({}))
    vi.doMock('../server/lib/db/schema.js', () => ({}))
    vi.doMock('../packages/core/src/db/run-migrations.js', () => ({ runMigrations: vi.fn() }))

    const { initDb } = await import('../server/lib/db/index.js')

    const db1 = await initDb()
    const db2 = await initDb()

    expect(db1).toBe(db2)
    // PGlite constructor should only be called once
    expect(pgliteCallCount).toBe(1)
  })

  it('db proxy throws descriptive error if not initialized', async () => {
    vi.doMock('../packages/core/src/app-mode.js', () => ({
      isLocalMode: () => true,
    }))
    vi.doMock('../server/lib/app-mode.js', () => ({
      isLocalMode: () => true,
    }))
    vi.doMock('../packages/core/src/db/schema.js', () => ({}))
    vi.doMock('../server/lib/db/schema.js', () => ({}))
    vi.doMock('../packages/core/src/db/run-migrations.js', () => ({ runMigrations: vi.fn() }))

    const { db } = await import('../server/lib/db/index.js')

    expect(() => (db as Record<string, unknown>).select).toThrow(
      /Database not initialized/
    )
  })

  it('PGlite uses PGLITE_DATA_DIR env var when set', async () => {
    const mockDrizzle = vi.fn().mockReturnValue({})
    let capturedDataDir = ''

    process.env.PGLITE_DATA_DIR = '/tmp/test-pglite'

    vi.doMock('../packages/core/src/app-mode.js', () => ({
      isLocalMode: () => true,
    }))
    vi.doMock('../server/lib/app-mode.js', () => ({
      isLocalMode: () => true,
    }))
    vi.doMock('@electric-sql/pglite', () => ({
      PGlite: class MockPGlite { constructor(dir: string) { capturedDataDir = dir } },
    }))
    vi.doMock('drizzle-orm/pglite', () => ({
      drizzle: mockDrizzle,
    }))
    vi.doMock('../packages/core/src/db/schema.js', () => ({}))
    vi.doMock('../server/lib/db/schema.js', () => ({}))
    vi.doMock('../packages/core/src/db/run-migrations.js', () => ({ runMigrations: vi.fn() }))

    const { initDb } = await import('../server/lib/db/index.js')
    await initDb()

    expect(capturedDataDir).toBe('/tmp/test-pglite')

    delete process.env.PGLITE_DATA_DIR
  })

  it('PGlite uses default data dir (homedir/.astro/pglite) when env not set', async () => {
    const mockDrizzle = vi.fn().mockReturnValue({})
    let capturedDataDir = ''

    // Ensure the env var is not set
    delete process.env.PGLITE_DATA_DIR

    vi.doMock('../packages/core/src/app-mode.js', () => ({
      isLocalMode: () => true,
    }))
    vi.doMock('../server/lib/app-mode.js', () => ({
      isLocalMode: () => true,
    }))
    vi.doMock('@electric-sql/pglite', () => ({
      PGlite: class MockPGlite { constructor(dir: string) { capturedDataDir = dir } },
    }))
    vi.doMock('drizzle-orm/pglite', () => ({
      drizzle: mockDrizzle,
    }))
    vi.doMock('../packages/core/src/db/schema.js', () => ({}))
    vi.doMock('../server/lib/db/schema.js', () => ({}))
    vi.doMock('../packages/core/src/db/run-migrations.js', () => ({ runMigrations: vi.fn() }))

    const { initDb } = await import('../server/lib/db/index.js')
    await initDb()

    // Should use homedir/.astro/pglite as the default
    const { join } = await import('node:path')
    const { homedir } = await import('node:os')
    const expectedDir = join(homedir(), '.astro', 'pglite')
    expect(capturedDataDir).toBe(expectedDir)
  })

  it('postgres-js uses DATABASE_URL env var when set', async () => {
    const mockDrizzle = vi.fn().mockReturnValue({})
    let capturedUrl = ''
    const mockPostgres = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url
      return {}
    })

    process.env.DATABASE_URL = 'postgresql://user:pass@remote-host:5432/mydb'

    vi.doMock('../packages/core/src/app-mode.js', () => ({
      isLocalMode: () => false,
    }))
    vi.doMock('../server/lib/app-mode.js', () => ({
      isLocalMode: () => false,
    }))
    vi.doMock('postgres', () => ({
      default: mockPostgres,
    }))
    vi.doMock('drizzle-orm/postgres-js', () => ({
      drizzle: mockDrizzle,
    }))
    vi.doMock('../packages/core/src/db/schema.js', () => ({}))
    vi.doMock('../server/lib/db/schema.js', () => ({}))
    vi.doMock('../packages/core/src/db/run-migrations.js', () => ({ runMigrations: vi.fn() }))

    const { initDb } = await import('../server/lib/db/index.js')
    await initDb()

    expect(capturedUrl).toBe('postgresql://user:pass@remote-host:5432/mydb')

    delete process.env.DATABASE_URL
  })

  it('postgres-js uses default URL when DATABASE_URL not set', async () => {
    const mockDrizzle = vi.fn().mockReturnValue({})
    let capturedUrl = ''
    const mockPostgres = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url
      return {}
    })

    // Ensure DATABASE_URL is not set
    delete process.env.DATABASE_URL

    vi.doMock('../packages/core/src/app-mode.js', () => ({
      isLocalMode: () => false,
    }))
    vi.doMock('../server/lib/app-mode.js', () => ({
      isLocalMode: () => false,
    }))
    vi.doMock('postgres', () => ({
      default: mockPostgres,
    }))
    vi.doMock('drizzle-orm/postgres-js', () => ({
      drizzle: mockDrizzle,
    }))
    vi.doMock('../packages/core/src/db/schema.js', () => ({}))
    vi.doMock('../server/lib/db/schema.js', () => ({}))
    vi.doMock('../packages/core/src/db/run-migrations.js', () => ({ runMigrations: vi.fn() }))

    const { initDb } = await import('../server/lib/db/index.js')
    await initDb()

    expect(capturedUrl).toBe('postgresql://postgres:postgres@127.0.0.1:54322/postgres')
  })
})
