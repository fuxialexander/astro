/**
 * GitHub App install button
 * Opens the GitHub App installation page in a popup and refreshes installations on close.
 */

import { Github, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { useGitHubAppStore } from '@/stores/github-app-store';
import { cn } from '@/lib/utils';

interface GitHubAppInstallButtonProps {
  className?: string;
}

export function GitHubAppInstallButton({ className }: GitHubAppInstallButtonProps) {
  const { loading, error, install, clearError } = useGitHubAppStore();

  const handleInstall = async () => {
    clearError();
    await install();
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Button
        onClick={handleInstall}
        variant="outline"
        disabled={loading}
        className="w-full"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Opening…
          </>
        ) : (
          <>
            <Github className="h-4 w-4 mr-2" />
            Install GitHub App
          </>
        )}
      </Button>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
