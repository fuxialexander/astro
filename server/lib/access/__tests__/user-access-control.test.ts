/**
 * User Access Control Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { UserAccessControl } from '../user-access-control.js'

describe('UserAccessControl', () => {
  let accessControl: UserAccessControl

  beforeEach(() => {
    accessControl = new UserAccessControl({ blockBehavior: 'silent' })
  })

  describe('Global Blocklist', () => {
    it('should block users on global blocklist', () => {
      accessControl.addGlobalBlocklist('blocked-user')

      const result = accessControl.checkAccess('blocked-user', 'user@example.com', 'proj-1')

      expect(result.allowed).toBe(false)
      expect(result.triggeredRule).toBe('global_blocklist')
      expect(result.reason).toBe('User is globally blocked')
    })

    it('should block by email', () => {
      accessControl.addGlobalBlocklist('blocked@example.com')

      const result = accessControl.checkAccess('user-123', 'blocked@example.com', 'proj-1')

      expect(result.allowed).toBe(false)
      expect(result.triggeredRule).toBe('global_blocklist')
    })
  })

  describe('Project Blocklist', () => {
    it('should block users from specific project', () => {
      accessControl.addProjectBlocklist('proj-1', 'user-123')

      const result = accessControl.checkAccess('user-123', 'user@example.com', 'proj-1')

      expect(result.allowed).toBe(false)
      expect(result.triggeredRule).toBe('project_blocklist')
    })

    it('should allow same user in other projects', () => {
      accessControl.addProjectBlocklist('proj-1', 'user-123')

      const result = accessControl.checkAccess('user-123', 'user@example.com', 'proj-2')

      expect(result.allowed).toBe(true)
    })
  })

  describe('Project Allowlist', () => {
    it('should allow users on project allowlist', () => {
      accessControl.addProjectAllowlist('proj-1', 'user-123')

      const result = accessControl.checkAccess('user-123', 'user@example.com', 'proj-1')

      expect(result.allowed).toBe(true)
      expect(result.triggeredRule).toBe('project_allowlist')
    })

    it('should block users not on project allowlist', () => {
      accessControl.addProjectAllowlist('proj-1', 'user-456')

      const result = accessControl.checkAccess('user-123', 'user@example.com', 'proj-1')

      expect(result.allowed).toBe(false)
      expect(result.triggeredRule).toBe('project_allowlist')
    })

    it('should override global allowlist', () => {
      accessControl.addGlobalAllowlist('user-456')
      accessControl.addProjectAllowlist('proj-1', 'user-123')

      // user-123 allowed via project allowlist
      const result1 = accessControl.checkAccess('user-123', 'user@example.com', 'proj-1')
      expect(result1.allowed).toBe(true)
      expect(result1.triggeredRule).toBe('project_allowlist')

      // user-456 not on project allowlist, even though on global allowlist
      const result2 = accessControl.checkAccess('user-456', 'user@example.com', 'proj-1')
      expect(result2.allowed).toBe(false)
      expect(result2.triggeredRule).toBe('project_allowlist')
    })
  })

  describe('Global Allowlist', () => {
    it('should allow users on global allowlist', () => {
      accessControl.addGlobalAllowlist('user-123')

      const result = accessControl.checkAccess('user-123', 'user@example.com', 'proj-1')

      expect(result.allowed).toBe(true)
      expect(result.triggeredRule).toBe('global_allowlist')
    })

    it('should block users not on global allowlist', () => {
      accessControl.addGlobalAllowlist('user-456')

      const result = accessControl.checkAccess('user-123', 'user@example.com', 'proj-1')

      expect(result.allowed).toBe(false)
      expect(result.triggeredRule).toBe('global_allowlist')
    })
  })

  describe('Hierarchical Priority', () => {
    it('should prioritize global blocklist over project allowlist', () => {
      accessControl.addGlobalBlocklist('blocked-user')
      accessControl.addProjectAllowlist('proj-1', 'blocked-user')

      const result = accessControl.checkAccess('blocked-user', 'user@example.com', 'proj-1')

      expect(result.allowed).toBe(false)
      expect(result.triggeredRule).toBe('global_blocklist')
    })

    it('should prioritize project blocklist over global allowlist', () => {
      accessControl.addGlobalAllowlist('user-123')
      accessControl.addProjectBlocklist('proj-1', 'user-123')

      const result = accessControl.checkAccess('user-123', 'user@example.com', 'proj-1')

      expect(result.allowed).toBe(false)
      expect(result.triggeredRule).toBe('project_blocklist')
    })
  })

  describe('Default Behavior', () => {
    it('should allow all users by default', () => {
      const result = accessControl.checkAccess('any-user', 'any@example.com', 'any-project')

      expect(result.allowed).toBe(true)
      expect(result.triggeredRule).toBeUndefined()
    })
  })

  describe('Management Operations', () => {
    it('should remove users from global allowlist', () => {
      accessControl.addGlobalAllowlist('user-123')
      accessControl.removeGlobalAllowlist('user-123')

      // No global allowlist, so default allow
      const result = accessControl.checkAccess('user-123', 'user@example.com', 'proj-1')
      expect(result.allowed).toBe(true)
    })

    it('should remove users from global blocklist', () => {
      accessControl.addGlobalBlocklist('user-123')
      accessControl.removeGlobalBlocklist('user-123')

      const result = accessControl.checkAccess('user-123', 'user@example.com', 'proj-1')
      expect(result.allowed).toBe(true)
    })

    it('should provide summary', () => {
      accessControl.addGlobalAllowlist('user-1')
      accessControl.addGlobalAllowlist('user-2')
      accessControl.addGlobalBlocklist('user-3')
      accessControl.addProjectAllowlist('proj-1', 'user-4')
      accessControl.addProjectBlocklist('proj-2', 'user-5')

      const summary = accessControl.getSummary()

      expect(summary.globalAllowlistCount).toBe(2)
      expect(summary.globalBlocklistCount).toBe(1)
      expect(summary.projectAllowlistsCount).toBe(1)
      expect(summary.projectBlocklistsCount).toBe(1)
    })
  })
})
