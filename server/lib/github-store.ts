/**
 * GitHub Store — Database-backed persistence for GitHub OAuth connections
 *
 * OAuth states use HMAC-signed tokens (stateless) so they survive redeploys.
 * Connections and repo selections are persisted via Drizzle ORM.
 */

import { createHmac, randomBytes } from 'crypto';
import type { GitHubConnection, GitHubRepoSelection, GitHubRepo } from '../types/github';
import { db } from './db/index.js';
import { githubConnections, projects } from './db/schema.js';
import { eq, and } from 'drizzle-orm';

/** Secret used to sign OAuth state tokens. Falls back to a random per-process key. */
const STATE_SECRET = process.env.GITHUB_STATE_SECRET || process.env.RELAY_JWT_SECRET || randomBytes(32).toString('hex');

/**
 * Create an HMAC-signed OAuth state token encoding the userId and expiry.
 * Format: `nonce.userId.expiresAt.signature`
 */
function createSignedState(userId: string, ttlMs = 600_000): string {
  const nonce = randomBytes(16).toString('hex');
  const expiresAt = Date.now() + ttlMs;
  const payload = `${nonce}.${userId}.${expiresAt}`;
  const sig = createHmac('sha256', STATE_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/**
 * Verify and extract userId from an HMAC-signed state token.
 * Returns userId if valid and not expired, null otherwise.
 */
function verifySignedState(state: string): string | null {
  const parts = state.split('.');
  if (parts.length !== 4) return null;

  const [nonce, userId, expiresAtStr, sig] = parts;
  const payload = `${nonce}.${userId}.${expiresAtStr}`;
  const expectedSig = createHmac('sha256', STATE_SECRET).update(payload).digest('hex');

  // Timing-safe comparison
  if (sig.length !== expectedSig.length) return null;
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length) return null;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i];
  }
  if (mismatch !== 0) return null;

  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return null;

  return userId;
}

class GitHubStore {
  /**
   * Create a signed OAuth state token for CSRF protection.
   * Stateless — no server-side storage needed, survives redeploys.
   */
  setOAuthState(_state: string, userId: string, ttlMs = 600_000): string {
    // Ignore the passed-in state; generate a signed one instead.
    return createSignedState(userId, ttlMs);
  }

  /**
   * Verify and extract userId from a signed OAuth state token.
   */
  verifyOAuthState(state: string): string | null {
    return verifySignedState(state);
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
