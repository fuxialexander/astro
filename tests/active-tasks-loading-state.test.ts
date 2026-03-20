import { describe, expect, it } from 'vitest'

import { getActiveTasksContentState } from '@/lib/active-tasks'

describe('Active Tasks content state', () => {
  it('shows loading while execution data is still hydrating', () => {
    expect(getActiveTasksContentState(0, {
      executionsLoaded: false,
      sessionsLoaded: true,
    })).toBe('loading')
  })

  it('shows loading while session data is still hydrating', () => {
    expect(getActiveTasksContentState(0, {
      executionsLoaded: true,
      sessionsLoaded: false,
    })).toBe('loading')
  })

  it('shows empty only after both active sources are loaded', () => {
    expect(getActiveTasksContentState(0, {
      executionsLoaded: true,
      sessionsLoaded: true,
    })).toBe('empty')
  })

  it('shows list when active tasks exist', () => {
    expect(getActiveTasksContentState(2, {
      executionsLoaded: false,
      sessionsLoaded: false,
    })).toBe('list')
  })
})
