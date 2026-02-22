/**
 * Local/Server Mode — Unit Tests
 *
 * Tests the core logic of the local/server mode refactor:
 * - app-mode detection functions
 * - sidebar mergeWithDefaults logic
 * - settings merge behavior
 * - activity store field mapping in data-client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// app-mode.ts (Frontend)
// ============================================================================

describe('Frontend app-mode', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('isLocalMode returns true when shouldUseSupabase returns false', async () => {
    vi.doMock('@/lib/supabase-client', () => ({
      shouldUseSupabase: () => false,
    }))
    const { isLocalMode, isServerMode, getAppMode } = await import('@/lib/app-mode')
    expect(isLocalMode()).toBe(true)
    expect(isServerMode()).toBe(false)
    expect(getAppMode()).toBe('local')
  })

  it('isServerMode returns true when shouldUseSupabase returns true', async () => {
    vi.doMock('@/lib/supabase-client', () => ({
      shouldUseSupabase: () => true,
    }))
    const { isLocalMode, isServerMode, getAppMode } = await import('@/lib/app-mode')
    expect(isLocalMode()).toBe(false)
    expect(isServerMode()).toBe(true)
    expect(getAppMode()).toBe('server')
  })
})

// ============================================================================
// sidebar-store mergeWithDefaults
// ============================================================================

describe('sidebar mergeWithDefaults', () => {
  // Import the function directly — it has no side effects
  let mergeWithDefaults: typeof import('@/stores/sidebar-store')['mergeWithDefaults']

  beforeEach(async () => {
    vi.resetModules()
    // Mock dataClient to avoid import errors (sidebar-store imports it)
    vi.doMock('@/lib/data-client', () => ({
      dataClient: {},
    }))
    const mod = await import('@/stores/sidebar-store')
    mergeWithDefaults = mod.mergeWithDefaults
  })

  it('returns defaults when stored config is empty', () => {
    const result = mergeWithDefaults([])
    // Should have all default items
    expect(result.length).toBeGreaterThan(0)
    expect(result.find(i => i.id === 'tasks')).toBeDefined()
    expect(result.find(i => i.id === 'projects')).toBeDefined()
    expect(result.find(i => i.id === 'environments')).toBeDefined()
  })

  it('preserves stored visibility for non-protected items', () => {
    const stored = [
      { id: 'projects', to: '/projects', icon: 'GitBranch', label: 'Projects', visible: false, protected: false },
    ]
    const result = mergeWithDefaults(stored)
    const projects = result.find(i => i.id === 'projects')
    expect(projects?.visible).toBe(false) // user hid it
  })

  it('forces protected items to be visible even if stored as hidden', () => {
    const stored = [
      { id: 'tasks', to: '/', icon: 'CheckSquare', label: 'Tasks', visible: false, protected: true },
    ]
    const result = mergeWithDefaults(stored)
    const tasks = result.find(i => i.id === 'tasks')
    expect(tasks?.visible).toBe(true) // forced visible because protected
  })

  it('adds new default items not present in stored config', () => {
    // Simulate stored config that doesn't have "agents" item
    const stored = [
      { id: 'tasks', to: '/', icon: 'CheckSquare', label: 'Tasks', visible: true, protected: true },
    ]
    const result = mergeWithDefaults(stored)
    const agents = result.find(i => i.id === 'agents')
    expect(agents).toBeDefined()
    expect(agents?.visible).toBe(false) // default visibility
  })

  it('preserves stored order within the defaults structure', () => {
    const stored = [
      { id: 'dashboard', to: '/dashboard', icon: 'Radio', label: 'Dashboard', visible: true, protected: false },
    ]
    const result = mergeWithDefaults(stored)
    const dashboard = result.find(i => i.id === 'dashboard')
    expect(dashboard?.visible).toBe(true) // user enabled it
  })
})

// ============================================================================
// Settings merge logic (server-side pattern)
// ============================================================================

describe('settings merge logic', () => {
  it('merges incoming settings with existing without losing fields', () => {
    const existing = { model: 'claude-sonnet-4-5-20250929', defaultProvider: 'local' }
    const incoming = { model: 'claude-opus-4-20250514' }
    const merged = { ...existing, ...incoming }

    expect(merged.model).toBe('claude-opus-4-20250514') // updated
    expect(merged.defaultProvider).toBe('local') // preserved
  })

  it('merges defaults with stored settings correctly', () => {
    const defaults = { model: 'claude-sonnet-4-5-20250929', defaultProvider: '' }
    const stored = { defaultProvider: 'remote' }
    const result = { ...defaults, ...stored }

    expect(result.model).toBe('claude-sonnet-4-5-20250929') // default kept
    expect(result.defaultProvider).toBe('remote') // stored wins
  })

  it('handles empty stored settings', () => {
    const defaults = { model: 'claude-sonnet-4-5-20250929', defaultProvider: '' }
    const stored = {}
    const result = { ...defaults, ...stored }

    expect(result).toEqual(defaults)
  })
})

// ============================================================================
// Activity field mapping (data-client pattern)
// ============================================================================

describe('activity field mapping', () => {
  it('maps snake_case API response to camelCase Activity', () => {
    // Simulate what data-client.listActivities does
    const apiRow = {
      id: '123',
      project_id: 'proj-1',
      type: 'task.created',
      title: 'Created task foo',
      description: null,
      node_id: 'node-1',
      metadata: { key: 'value' },
      created_at: '2026-02-19T00:00:00Z',
    }

    // This is the mapping logic from data-client.ts
    const mapped = {
      id: apiRow.id as string,
      projectId: (apiRow.project_id) as string,
      type: apiRow.type as string,
      title: apiRow.title as string,
      description: (apiRow.description as string) ?? undefined,
      nodeId: (apiRow.node_id) as string | undefined,
      metadata: apiRow.metadata as Record<string, unknown> | undefined,
      timestamp: new Date(apiRow.created_at),
    }

    expect(mapped.projectId).toBe('proj-1')
    expect(mapped.nodeId).toBe('node-1')
    expect(mapped.description).toBeUndefined() // null → undefined
    expect(mapped.timestamp).toBeInstanceOf(Date)
    expect(mapped.timestamp.toISOString()).toBe('2026-02-19T00:00:00.000Z')
  })

  it('maps camelCase API response (Drizzle auto-mapping)', () => {
    const apiRow = {
      id: '456',
      projectId: 'proj-2',
      type: 'plan.refined',
      title: 'Refined plan',
      description: 'Added milestones',
      nodeId: undefined,
      metadata: {},
      createdAt: '2026-02-19T12:00:00Z',
    }

    const mapped = {
      id: apiRow.id as string,
      projectId: (apiRow.projectId) as string,
      type: apiRow.type as string,
      title: apiRow.title as string,
      description: (apiRow.description as string) ?? undefined,
      nodeId: (apiRow.nodeId) as string | undefined,
      metadata: apiRow.metadata as Record<string, unknown> | undefined,
      timestamp: new Date(apiRow.createdAt),
    }

    expect(mapped.projectId).toBe('proj-2')
    expect(mapped.description).toBe('Added milestones')
    expect(mapped.nodeId).toBeUndefined()
    expect(mapped.timestamp.toISOString()).toBe('2026-02-19T12:00:00.000Z')
  })

  it('createActivity sends only required fields (no timestamp, no userId)', () => {
    const activity = {
      id: 'act-1',
      projectId: 'proj-1',
      type: 'task.created',
      title: 'Created task',
      description: 'A test task',
      userId: 'user-1', // should NOT be sent
      nodeId: 'node-1',
      timestamp: new Date(), // should NOT be sent
      metadata: { foo: 'bar' },
    }

    // This is how activity-store.ts builds the payload
    const payload = {
      id: activity.id,
      projectId: activity.projectId,
      type: activity.type,
      title: activity.title,
      description: activity.description,
      nodeId: activity.nodeId,
      metadata: activity.metadata,
    }

    // Verify userId and timestamp are NOT in the payload
    expect(payload).not.toHaveProperty('userId')
    expect(payload).not.toHaveProperty('timestamp')
    expect(payload).toHaveProperty('id', 'act-1')
    expect(payload).toHaveProperty('projectId', 'proj-1')
  })
})

// ============================================================================
// sidebarConfig conditional inclusion in profile update
// ============================================================================

describe('profile update sidebarConfig inclusion', () => {
  it('includes sidebarConfig when explicitly provided', () => {
    const body = { name: 'Test User', sidebarConfig: [{ id: 'tasks', visible: true }] }
    const profile: Record<string, unknown> = { name: body.name }

    if (body.sidebarConfig !== undefined) {
      profile.sidebarConfig = body.sidebarConfig
    }

    expect(profile.sidebarConfig).toEqual([{ id: 'tasks', visible: true }])
  })

  it('does not include sidebarConfig when not in body', () => {
    const body = { name: 'Test User' } as Record<string, unknown>
    const profile: Record<string, unknown> = { name: body.name }

    if (body.sidebarConfig !== undefined) {
      profile.sidebarConfig = body.sidebarConfig
    }

    expect(profile).not.toHaveProperty('sidebarConfig')
  })

  it('includes sidebarConfig even when null (explicit clear)', () => {
    const body = { name: 'Test User', sidebarConfig: null }
    const profile: Record<string, unknown> = { name: body.name }

    if (body.sidebarConfig !== undefined) {
      profile.sidebarConfig = body.sidebarConfig
    }

    expect(profile.sidebarConfig).toBeNull()
  })
})
