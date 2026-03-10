/**
 * GitHub App Installation Manager
 *
 * Shows all GitHub App installations linked to the current user / team,
 * with controls to link/unlink them and view repo access.
 */

import { useEffect, useState } from 'react';
import {
  Github,
  Loader2,
  Trash2,
  Building2,
  User,
  ChevronDown,
  ChevronUp,
  Link as LinkIcon,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { useGitHubAppStore, type GitHubAppInstallation } from '@/stores/github-app-store';
import { useTeamStore } from '@/stores/team-store';
import { GitHubAppInstallButton } from './github-app-install-button';
import { cn } from '@/lib/utils';

function InstallationRow({
  installation,
}: {
  installation: GitHubAppInstallation;
}) {
  const { teams } = useTeamStore();
  const { linkToTeam, unlink } = useGitHubAppStore();
  const [expanded, setExpanded] = useState(false);
  const [linking, setLinking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const handleLinkTeam = async (teamId: string) => {
    setLinking(true);
    setRowError(null);
    try {
      await linkToTeam(installation.installationId, teamId === '__personal' ? null : teamId);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to link team');
    } finally {
      setLinking(false);
    }
  };

  const handleRemove = async () => {
    setConfirmRemoveOpen(false);
    setRemoving(true);
    setRowError(null);
    try {
      await unlink(installation.installationId);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to remove installation');
    } finally {
      setRemoving(false);
    }
  };

  const linkedTeam = teams.find((t) => t.id === installation.teamId);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          {installation.accountAvatarUrl ? (
            <img
              src={installation.accountAvatarUrl}
              alt={installation.accountLogin}
              className="h-8 w-8 rounded-full"
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
              {installation.accountType === 'Organization' ? (
                <Building2 className="h-4 w-4 text-muted-foreground" />
              ) : (
                <User className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          )}
          <div>
            <p className="text-sm font-medium">{installation.accountLogin}</p>
            <p className="text-xs text-muted-foreground">
              {installation.accountType} ·{' '}
              {installation.repositorySelection === 'all'
                ? 'All repositories'
                : `${installation.repos.length} repositories`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {installation.teamId ? (
            <Badge variant="success" className="gap-1 text-xs">
              <CheckCircle2 className="h-3 w-3" />
              {linkedTeam?.name ?? 'Team linked'}
            </Badge>
          ) : installation.accountType === 'User' ? (
            <Badge variant="secondary" className="text-xs">Personal</Badge>
          ) : null}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => setConfirmRemoveOpen(true)}
            disabled={removing}
            aria-label="Remove installation"
          >
            {removing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <Dialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove installation</DialogTitle>
            <DialogDescription>
              Remove GitHub App installation for &ldquo;{installation.accountLogin}&rdquo;?
              This only removes it from Astro &mdash; the app stays installed on GitHub.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemoveOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 flex flex-col gap-3 bg-muted/30">
          {/* Team link */}
          {teams.length > 0 && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">Link to team</p>
                <p className="text-xs text-muted-foreground">
                  Team members can use this installation for their projects.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={installation.teamId ?? '__personal'}
                  onValueChange={handleLinkTeam}
                  disabled={linking}
                >
                  <SelectTrigger className="h-7 text-xs w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__personal">Personal only</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {linking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </div>
            </div>
          )}

          {/* Row error */}
          {rowError && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {rowError}
            </div>
          )}

          {/* Repository list */}
          {installation.repos.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1.5">Repositories</p>
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {installation.repos.map((repo) => (
                  <div
                    key={repo.id}
                    className="flex items-center justify-between px-2 py-1 rounded bg-background text-xs"
                  >
                    <span className="font-mono">{repo.full_name}</span>
                    {repo.private && (
                      <Badge variant="outline" className="text-[10px] h-4">Private</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {installation.repositorySelection === 'all' && installation.repos.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Access to all repositories in this account.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface GitHubAppInstallationManagerProps {
  className?: string;
}

export function GitHubAppInstallationManager({
  className,
}: GitHubAppInstallationManagerProps) {
  const { installations, loading, error, fetchInstallations } = useGitHubAppStore();
  const { teams, loaded: teamsLoaded, load: loadTeams } = useTeamStore();

  useEffect(() => {
    fetchInstallations();
  }, [fetchInstallations]);

  useEffect(() => {
    if (!teamsLoaded) loadTeams();
  }, [teamsLoaded, loadTeams]);

  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">GitHub App</h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Install the Astro GitHub App to grant repository access to your team without
            sharing personal OAuth tokens.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg',
              installations.length > 0 ? 'bg-primary/10' : 'bg-muted'
            )}>
              <Github className={cn(
                'h-5 w-5',
                installations.length > 0 ? 'text-primary' : 'text-muted-foreground'
              )} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">GitHub App Installations</span>
              <span className="text-[13px] text-muted-foreground">
                {loading
                  ? 'Loading…'
                  : error && installations.length === 0
                    ? 'Failed to load installations'
                    : installations.length === 0
                      ? 'No installations yet'
                      : `${installations.length} installation${installations.length !== 1 ? 's' : ''}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {installations.length > 0 && (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Active
              </Badge>
            )}
          </div>
        </div>

        {/* Error state */}
        {error && !loading && (
          <div className="px-4 py-3 flex items-center gap-2 text-sm text-destructive border-b border-border">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs shrink-0"
              onClick={() => fetchInstallations()}
            >
              Retry
            </Button>
          </div>
        )}

        {/* Installation list */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : installations.length > 0 ? (
          <div className="p-4 flex flex-col gap-2">
            {installations.map((inst) => (
              <InstallationRow key={inst.id} installation={inst} />
            ))}
          </div>
        ) : null}

        {/* Install button */}
        <div className="px-4 py-4 border-t border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">
                {installations.length > 0 ? 'Add another installation' : 'Install GitHub App'}
              </span>
              <span className="text-[13px] text-muted-foreground">
                Grant Astro access to repositories in your GitHub account or organization.
              </span>
            </div>
            <GitHubAppInstallButton className="shrink-0" />
          </div>
        </div>

        {/* Team link info */}
        {installations.length > 0 && teams.length > 0 && (
          <div className="px-4 py-3 border-t border-border bg-muted/30">
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <LinkIcon className="h-3.5 w-3.5 shrink-0" />
              <span>
                Expand an installation to link it to a team so teammates can access those repos.
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
