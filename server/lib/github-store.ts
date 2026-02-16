/**
 * In-memory store for GitHub connections and repo selections
 * TODO: Replace with database persistence in production
 */

import type { GitHubConnection, GitHubRepoSelection } from '../types/github';

class GitHubStore {
  private connections = new Map<string, GitHubConnection>();
  private selections = new Map<string, GitHubRepoSelection>();
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
   * Store GitHub connection
   */
  setConnection(userId: string, connection: GitHubConnection): void {
    this.connections.set(userId, connection);
  }

  /**
   * Get GitHub connection
   */
  getConnection(userId: string): GitHubConnection | undefined {
    return this.connections.get(userId);
  }

  /**
   * Check if user has GitHub connected
   */
  isConnected(userId: string): boolean {
    return this.connections.has(userId);
  }

  /**
   * Disconnect GitHub
   */
  disconnect(userId: string): void {
    this.connections.delete(userId);
    this.selections.delete(userId);
  }

  /**
   * Store repo selection
   */
  setRepoSelection(userId: string, selection: GitHubRepoSelection): void {
    this.selections.set(userId, selection);
  }

  /**
   * Get repo selection
   */
  getRepoSelection(userId: string): GitHubRepoSelection | undefined {
    return this.selections.get(userId);
  }

  /**
   * Update selected repo IDs
   */
  updateSelectedRepos(userId: string, repoIds: number[]): void {
    const selection = this.selections.get(userId);
    if (selection) {
      selection.selectedRepoIds = repoIds;
      selection.lastSyncedAt = new Date().toISOString();
    }
  }
}

export const githubStore = new GitHubStore();
