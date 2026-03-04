/**
 * GitHub Store — Database-backed persistence for GitHub OAuth connections
 *
 * OAuth states remain in-memory (ephemeral, 10-min TTL).
 * Connections and repo selections are persisted via Drizzle ORM.
 */

import type { GitHubConnection, GitHubRepoSelection, GitHubRepo } from '../types/github';
import { db } from './db/index.js';
import { githubConnections, projects } from './db/schema.js';
import { eq, and } from 'drizzle-orm';

class GitHubStore {
  // OAuth states are ephemeral — in-memory is fine for single-instance.
  // TODO: migrate to DB-backed state for multi-instance deployment
  private oauthStates = new Map<string, { userId: string; expiresAt: number }>();

  /**
   * Store OAuth state for CSRF protection
   */
  setOAuthState(state: string, userId: string, ttlMs = 600000): void {
    this.oauthStates.set(state, {
      userId,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Verify and consume OAuth state
   */
  verifyOAuthState(state: string): string | null {
    const data = this.oauthStates.get(state);
    if (!data || data.expiresAt < Date.now()) {
      this.oauthStates.delete(state);
      return null;
    }
    this.oauthStates.delete(state);
    return data.userId;
  }

  /**
   * Store GitHub connection (upsert)
   */
  async setConnection(userId: string, connection: GitHubConnection): Promise<void> {
    await db.insert(githubConnections).values({
      userId,
      accessToken: connection.accessToken,
      scope: connection.scope,
      connectedAt: new Date(connection.connectedAt),
      ghUserId: connection.user.id,
      ghLogin: connection.user.login,
      ghName: connection.user.name,
      ghEmail: connection.user.email,
      ghAvatarUrl: connection.user.avatarUrl,
    }).onConflictDoUpdate({
      target: githubConnections.userId,
      set: {
        accessToken: connection.accessToken,
        scope: connection.scope,
        connectedAt: new Date(connection.connectedAt),
        ghUserId: connection.user.id,
        ghLogin: connection.user.login,
        ghName: connection.user.name,
        ghEmail: connection.user.email,
        ghAvatarUrl: connection.user.avatarUrl,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get GitHub connection
   */
  async getConnection(userId: string): Promise<GitHubConnection | undefined> {
    const [row] = await db.select().from(githubConnections).where(eq(githubConnections.userId, userId)).limit(1);
    if (!row) return undefined;
    return this.rowToConnection(row);
  }

  /**
   * Check if user has GitHub connected
   */
  async isConnected(userId: string): Promise<boolean> {
    const [row] = await db.select({ userId: githubConnections.userId })
      .from(githubConnections).where(eq(githubConnections.userId, userId)).limit(1);
    return !!row;
  }

  /**
   * Disconnect GitHub
   */
  async disconnect(userId: string): Promise<void> {
    await db.delete(githubConnections).where(eq(githubConnections.userId, userId));
  }

  /**
   * Store repo selection
   */
  async setRepoSelection(userId: string, selection: GitHubRepoSelection): Promise<void> {
    await db.update(githubConnections).set({
      repos: selection.repos as unknown[],
      selectedRepoIds: selection.selectedRepoIds,
      lastSyncedAt: selection.lastSyncedAt ? new Date(selection.lastSyncedAt) : new Date(),
      updatedAt: new Date(),
    }).where(eq(githubConnections.userId, userId));
  }

  /**
   * Get repo selection
   */
  async getRepoSelection(userId: string): Promise<GitHubRepoSelection | undefined> {
    const [row] = await db.select().from(githubConnections).where(eq(githubConnections.userId, userId)).limit(1);
    if (!row) return undefined;
    return {
      userId: row.userId,
      selectedRepoIds: (row.selectedRepoIds ?? []) as number[],
      repos: (row.repos ?? []) as GitHubRepo[],
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? '',
    };
  }

  /**
   * Update selected repo IDs
   */
  async updateSelectedRepos(userId: string, repoIds: number[]): Promise<void> {
    await db.update(githubConnections).set({
      selectedRepoIds: repoIds,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(githubConnections.userId, userId));
  }

  private rowToConnection(row: typeof githubConnections.$inferSelect): GitHubConnection {
    return {
      userId: row.userId,
      accessToken: row.accessToken,
      scope: row.scope,
      connectedAt: row.connectedAt.toISOString(),
      user: {
        id: row.ghUserId ?? 0,
        login: row.ghLogin ?? '',
        name: row.ghName ?? null,
        email: row.ghEmail ?? null,
        avatarUrl: row.ghAvatarUrl ?? '',
      },
    };
  }
}

export const githubStore = new GitHubStore();

/**
 * Lookup a GitHub-linked project by repo full name (owner/repo).
 * Returns the project ID if found, undefined otherwise.
 */
export async function lookupGitHubProject(repoFullName: string): Promise<string | undefined> {
  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo) return undefined;
  const [row] = await db.select({ id: projects.id })
    .from(projects)
    .where(and(
      eq(projects.githubOwner, owner),
      eq(projects.githubRepo, repo),
      eq(projects.projectType, 'github')
    ))
    .limit(1);
  return row?.id;
}
