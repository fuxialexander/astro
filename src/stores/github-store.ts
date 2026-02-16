/**
 * GitHub integration store
 * Manages GitHub connection, repositories, and selections
 */

import { create } from 'zustand';
import type { GitHubRepo, GitHubUser } from '../../server/types/github';

interface GitHubState {
  // Connection state
  connected: boolean;
  user: GitHubUser | null;
  connectedAt: string | null;
  loading: boolean;
  error: string | null;

  // Repository data
  repos: GitHubRepo[];
  selectedRepoIds: number[];
  lastSyncedAt: string | null;

  // Actions
  fetchStatus: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  fetchRepos: () => Promise<void>;
  syncRepos: () => Promise<void>;
  selectRepos: (repoIds: number[]) => Promise<void>;
  toggleRepoSelection: (repoId: number) => void;
  clearError: () => void;
}

export const useGitHubStore = create<GitHubState>((set, get) => ({
  // Initial state
  connected: false,
  user: null,
  connectedAt: null,
  loading: false,
  error: null,
  repos: [],
  selectedRepoIds: [],
  lastSyncedAt: null,

  // Fetch connection status
  fetchStatus: async () => {
    try {
      set({ loading: true, error: null });

      const response = await fetch('/api/github/status');
      if (!response.ok) throw new Error('Failed to fetch GitHub status');

      const data = await response.json();
      set({
        connected: data.connected,
        user: data.user,
        connectedAt: data.connectedAt,
        loading: false,
      });
    } catch (error) {
      console.error('GitHub status fetch error:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch status',
        loading: false,
      });
    }
  },

  // Initiate OAuth connection
  connect: async () => {
    try {
      set({ loading: true, error: null });

      const response = await fetch('/api/github/connect', { method: 'POST' });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to initiate GitHub connection');
      }

      const data = await response.json();

      // Open OAuth flow in new window
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        data.authUrl,
        'GitHub OAuth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site and try again.');
      }

      // Poll for completion
      const pollInterval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollInterval);
          // Refresh status after OAuth completes
          get().fetchStatus();
        }
      }, 500);

      set({ loading: false });
    } catch (error) {
      console.error('GitHub connect error:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to connect to GitHub',
        loading: false,
      });
    }
  },

  // Disconnect GitHub
  disconnect: async () => {
    try {
      set({ loading: true, error: null });

      const response = await fetch('/api/github/disconnect', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to disconnect GitHub');

      set({
        connected: false,
        user: null,
        connectedAt: null,
        repos: [],
        selectedRepoIds: [],
        lastSyncedAt: null,
        loading: false,
      });
    } catch (error) {
      console.error('GitHub disconnect error:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to disconnect',
        loading: false,
      });
    }
  },

  // Fetch repositories
  fetchRepos: async () => {
    try {
      set({ loading: true, error: null });

      const response = await fetch('/api/github/repos');
      if (!response.ok) {
        if (response.status === 401) {
          set({ connected: false, loading: false });
          throw new Error('GitHub not connected');
        }
        throw new Error('Failed to fetch repositories');
      }

      const data = await response.json();

      // Also fetch selected repos
      const selectedResponse = await fetch('/api/github/repos/selected');
      const selectedData = await selectedResponse.json();

      set({
        repos: data.repos,
        selectedRepoIds: selectedData.selectedRepoIds || [],
        lastSyncedAt: new Date().toISOString(),
        loading: false,
      });
    } catch (error) {
      console.error('GitHub repos fetch error:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch repositories',
        loading: false,
      });
    }
  },

  // Manually sync repositories
  syncRepos: async () => {
    try {
      set({ loading: true, error: null });

      const response = await fetch('/api/github/repos/sync', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to sync repositories');

      const data = await response.json();
      set({
        repos: data.repos,
        lastSyncedAt: data.syncedAt,
        loading: false,
      });
    } catch (error) {
      console.error('GitHub repos sync error:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to sync repositories',
        loading: false,
      });
    }
  },

  // Update selected repositories
  selectRepos: async (repoIds: number[]) => {
    try {
      set({ loading: true, error: null });

      const response = await fetch('/api/github/repos/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoIds }),
      });

      if (!response.ok) throw new Error('Failed to update selection');

      const data = await response.json();
      set({
        selectedRepoIds: data.selectedRepoIds,
        loading: false,
      });
    } catch (error) {
      console.error('GitHub repo selection error:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to update selection',
        loading: false,
      });
    }
  },

  // Toggle single repo selection (optimistic update)
  toggleRepoSelection: (repoId: number) => {
    const { selectedRepoIds } = get();
    const newSelection = selectedRepoIds.includes(repoId)
      ? selectedRepoIds.filter((id) => id !== repoId)
      : [...selectedRepoIds, repoId];

    set({ selectedRepoIds: newSelection });

    // Sync to backend
    get().selectRepos(newSelection);
  },

  // Clear error state
  clearError: () => set({ error: null }),
}));
