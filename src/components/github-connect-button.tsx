/**
 * GitHub connection button component
 * Displays connection status and initiates OAuth flow
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Github, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { useGitHubStore } from '@/stores/github-store';
import { cn } from '@/lib/utils';

interface GitHubConnectButtonProps {
  className?: string;
  onConnected?: () => void;
}

export function GitHubConnectButton({ className, onConnected }: GitHubConnectButtonProps) {
  const { t } = useTranslation('common');
  const {
    connected,
    user,
    loading,
    error,
    fetchStatus,
    connect,
    disconnect,
    clearError,
  } = useGitHubStore();

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Call onConnected callback when connection is established
  useEffect(() => {
    if (connected && onConnected) {
      onConnected();
    }
  }, [connected, onConnected]);

  const handleConnect = async () => {
    clearError();
    await connect();
  };

  const handleDisconnect = async () => {
    if (confirm('Disconnect from GitHub? Your repository selections will be cleared.')) {
      await disconnect();
    }
  };

  if (loading) {
    return (
      <Button variant="outline" disabled className={className}>
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        {t('loading')}
      </Button>
    );
  }

  if (connected && user) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <div className="flex items-center gap-2">
          <img
            src={user.avatarUrl}
            alt={user.login}
            className="h-6 w-6 rounded-full"
          />
          <div className="flex flex-col">
            <span className="text-sm font-medium">{user.name || user.login}</span>
            <span className="text-xs text-muted-foreground">@{user.login}</span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDisconnect}
        >
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Button
        onClick={handleConnect}
        variant="outline"
        className="w-full"
      >
        <Github className="h-4 w-4 mr-2" />
        Connect GitHub
      </Button>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}

/**
 * GitHub repository sync button
 * Shows last sync time and allows manual refresh
 */
export function GitHubSyncButton() {
  const { lastSyncedAt, loading, syncRepos } = useGitHubStore();

  const handleSync = async () => {
    await syncRepos();
  };

  const syncTime = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString()
    : 'Never';

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        Last synced: {syncTime}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleSync}
        disabled={loading}
      >
        <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
      </Button>
    </div>
  );
}
