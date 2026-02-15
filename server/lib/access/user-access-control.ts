/**
 * User Access Control
 *
 * Multi-user access control with global and per-project allowlists/blocklists.
 * Pattern from Cyrus edge-worker/src/UserAccessControl.ts
 */

export interface AccessControlConfig {
  /** Global allowlist - if set, only these users can access ANY project */
  globalAllowlist?: string[]

  /** Global blocklist - these users are blocked from ALL projects */
  globalBlocklist?: string[]

  /** Per-project allowlists - Map<projectId, allowedUserIds[]> */
  projectAllowlists?: Map<string, string[]>

  /** Per-project blocklists - Map<projectId, blockedUserIds[]> */
  projectBlocklists?: Map<string, string[]>

  /** Block behavior: 'silent' = no logging, 'log' = log blocks */
  blockBehavior?: 'silent' | 'log'
}

export interface AccessCheckResult {
  /** Whether access is allowed */
  allowed: boolean

  /** Reason for denial (if not allowed) */
  reason?: string

  /** Which rule triggered the decision */
  triggeredRule?: 'global_allowlist' | 'global_blocklist' | 'project_allowlist' | 'project_blocklist'
}

/**
 * User Access Control Manager
 *
 * Implements hierarchical access control:
 * 1. Global blocklist (highest priority - always blocks)
 * 2. Project blocklist (project-specific blocks)
 * 3. Project allowlist (project-specific allows, overrides global allowlist)
 * 4. Global allowlist (if set, only listed users can access)
 * 5. Default: allow if no restrictions
 */
export class UserAccessControl {
  private config: AccessControlConfig

  constructor(config: AccessControlConfig = {}) {
    this.config = {
      blockBehavior: 'log',
      ...config,
    }
  }

  /**
   * Check if a user has access to a project
   *
   * @param userId - User ID to check
   * @param userEmail - User email to check (for email-based rules)
   * @param projectId - Project ID to check access for
   * @returns Access check result
   */
  checkAccess(userId: string, userEmail: string, projectId: string): AccessCheckResult {
    // 1. Check global blocklist (highest priority)
    if (this.config.globalBlocklist) {
      if (
        this.config.globalBlocklist.includes(userId) ||
        this.config.globalBlocklist.includes(userEmail)
      ) {
        this.logBlock(userId, projectId, 'global_blocklist')
        return {
          allowed: false,
          reason: 'User is globally blocked',
          triggeredRule: 'global_blocklist',
        }
      }
    }

    // 2. Check project-specific blocklist
    const projectBlocklist = this.config.projectBlocklists?.get(projectId)
    if (projectBlocklist) {
      if (projectBlocklist.includes(userId) || projectBlocklist.includes(userEmail)) {
        this.logBlock(userId, projectId, 'project_blocklist')
        return {
          allowed: false,
          reason: `User is blocked from project ${projectId}`,
          triggeredRule: 'project_blocklist',
        }
      }
    }

    // 3. Check project-specific allowlist (overrides global allowlist)
    const projectAllowlist = this.config.projectAllowlists?.get(projectId)
    if (projectAllowlist) {
      if (projectAllowlist.includes(userId) || projectAllowlist.includes(userEmail)) {
        return {
          allowed: true,
          triggeredRule: 'project_allowlist',
        }
      }
      // Project has allowlist but user not on it
      this.logBlock(userId, projectId, 'project_allowlist')
      return {
        allowed: false,
        reason: `User not on project ${projectId} allowlist`,
        triggeredRule: 'project_allowlist',
      }
    }

    // 4. Check global allowlist
    if (this.config.globalAllowlist && this.config.globalAllowlist.length > 0) {
      if (
        this.config.globalAllowlist.includes(userId) ||
        this.config.globalAllowlist.includes(userEmail)
      ) {
        return {
          allowed: true,
          triggeredRule: 'global_allowlist',
        }
      }
      // Global allowlist exists but user not on it
      this.logBlock(userId, projectId, 'global_allowlist')
      return {
        allowed: false,
        reason: 'User not on global allowlist',
        triggeredRule: 'global_allowlist',
      }
    }

    // 5. Default: allow if no restrictions
    return {
      allowed: true,
    }
  }

  /**
   * Add user to global allowlist
   */
  addGlobalAllowlist(userId: string): void {
    if (!this.config.globalAllowlist) {
      this.config.globalAllowlist = []
    }
    if (!this.config.globalAllowlist.includes(userId)) {
      this.config.globalAllowlist.push(userId)
    }
  }

  /**
   * Add user to global blocklist
   */
  addGlobalBlocklist(userId: string): void {
    if (!this.config.globalBlocklist) {
      this.config.globalBlocklist = []
    }
    if (!this.config.globalBlocklist.includes(userId)) {
      this.config.globalBlocklist.push(userId)
    }
  }

  /**
   * Add user to project allowlist
   */
  addProjectAllowlist(projectId: string, userId: string): void {
    if (!this.config.projectAllowlists) {
      this.config.projectAllowlists = new Map()
    }
    const allowlist = this.config.projectAllowlists.get(projectId) ?? []
    if (!allowlist.includes(userId)) {
      allowlist.push(userId)
    }
    this.config.projectAllowlists.set(projectId, allowlist)
  }

  /**
   * Add user to project blocklist
   */
  addProjectBlocklist(projectId: string, userId: string): void {
    if (!this.config.projectBlocklists) {
      this.config.projectBlocklists = new Map()
    }
    const blocklist = this.config.projectBlocklists.get(projectId) ?? []
    if (!blocklist.includes(userId)) {
      blocklist.push(userId)
    }
    this.config.projectBlocklists.set(projectId, blocklist)
  }

  /**
   * Remove user from global allowlist
   */
  removeGlobalAllowlist(userId: string): void {
    if (this.config.globalAllowlist) {
      this.config.globalAllowlist = this.config.globalAllowlist.filter((id) => id !== userId)
    }
  }

  /**
   * Remove user from global blocklist
   */
  removeGlobalBlocklist(userId: string): void {
    if (this.config.globalBlocklist) {
      this.config.globalBlocklist = this.config.globalBlocklist.filter((id) => id !== userId)
    }
  }

  /**
   * Get access control summary
   */
  getSummary(): {
    globalAllowlistCount: number
    globalBlocklistCount: number
    projectAllowlistsCount: number
    projectBlocklistsCount: number
  } {
    return {
      globalAllowlistCount: this.config.globalAllowlist?.length ?? 0,
      globalBlocklistCount: this.config.globalBlocklist?.length ?? 0,
      projectAllowlistsCount: this.config.projectAllowlists?.size ?? 0,
      projectBlocklistsCount: this.config.projectBlocklists?.size ?? 0,
    }
  }

  /**
   * Log access block (if block behavior is 'log')
   */
  private logBlock(userId: string, projectId: string, rule: string): void {
    if (this.config.blockBehavior === 'log') {
      console.log(`[access-control] Blocked user ${userId} from project ${projectId} (rule: ${rule})`)
    }
  }
}

// Singleton instance with default config
export const userAccessControl = new UserAccessControl()
