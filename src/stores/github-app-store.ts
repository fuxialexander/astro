/**
 * GitHub App installation store
 * Manages the list of GitHub App installations for the current user / team.
 */

import { create } from 'zustand';
import { apiUrl } from '@/lib/api-url';
import { authHeaders } from '@/lib/auth-headers';

export interface GitHubAppInstallation {
  id: string;
  installationId: number;
  userId: string;
  teamId: string | null;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string | null;
  appId: number | null;
  repositorySelection: string;
  repos: { id: number; name: string; full_name: string; private: boolean }[];
  permissions: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface GitHubAppState {
  installations: GitHubAppInstallation[];
  /** True only while the install popup is open or a fetch is in flight. */
  loading: boolean;
  error: string | null;

  fetchInstallations: () => Promise<void>;
  install: () => Promise<void>;
  linkToTeam: (installationId: number, teamId: string | null) => Promise<void>;
  unlink: (installationId: number) => Promise<void>;
  clearError: () => void;
}

// Module-level so we can clear any stale interval if install() is called again.
let installPollInterval: ReturnType<typeof setInterval> | null = null;

export const useGitHubAppStore = create<GitHubAppState>((set, get) => ({
  installations: [],
  loading: false,
  error: null,

  fetchInstallations: async () => {
    try {
      set({ loading: true, error: null });
      const headers = await authHeaders();
      const res = await fetch(apiUrl('/api/github-app/installations'), { headers });
      if (!res.ok) throw new Error('Failed to fetch GitHub App installations');
      const data = await res.json() as { installations: GitHubAppInstallation[] };
      set({ installations: data.installations, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch installations',
        loading: false,
      });
    }
  },

  install: async () => {
    // Clear any stale poll from a previous call
    if (installPollInterval) {
      clearInterval(installPollInterval);
      installPollInterval = null;
    }

    try {
      set({ loading: true, error: null });
      const headers = await authHeaders();
      const res = await fetch(apiUrl('/api/github-app/install-url'), { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Failed to get install URL');
      }
      const { installUrl } = await res.json() as { installUrl: string };

      // Open in a centered popup window
      const width = 1024;
      const height = 768;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        installUrl,
        'GitHub App Installation',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site and try again.');
      }

      // Keep loading:true while popup is open — prevents duplicate installs.
      // fetchInstallations() will clear it when it completes.
      // Max timeout of 5 minutes to prevent indefinite polling.
      const MAX_POLL_MS = 5 * 60 * 1000;
      const pollStart = Date.now();
      installPollInterval = setInterval(() => {
        if (popup.closed || Date.now() - pollStart > MAX_POLL_MS) {
          clearInterval(installPollInterval!);
          installPollInterval = null;
          if (!popup.closed) {
            try { popup.close(); } catch { /* ignore */ }
          }
          get().fetchInstallations();
        }
      }, 500);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to start installation',
        loading: false,
      });
    }
  },

  // linkToTeam and unlink do not set global loading — the caller manages
  // per-row loading state via local component state.
  linkToTeam: async (installationId: number, teamId: string | null) => {
    try {
      set({ error: null });
      const headers = await authHeaders();
      const res = await fetch(apiUrl(`/api/github-app/installations/${installationId}/link`), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Failed to link installation to team');
      }
      await get().fetchInstallations();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to link installation' });
      throw err;  // Re-throw so caller can show per-row error
    }
  },

  unlink: async (installationId: number) => {
    try {
      set({ error: null });
      const headers = await authHeaders();
      const res = await fetch(apiUrl(`/api/github-app/installations/${installationId}`), {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error('Failed to remove installation');
      set((state) => ({
        installations: state.installations.filter(
          (i) => i.installationId !== installationId
        ),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to remove installation' });
      throw err;  // Re-throw so caller can show per-row error
    }
  },

  clearError: () => set({ error: null }),
}));
