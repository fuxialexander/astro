/**
 * GitHub Integration Guide
 * Personal Account (OAuth) is the default for all users.
 * GitHub App is an optional team setup for orgs that want webhook automation
 * and separate rate limits.
 */

import {
  Github,
  Users,
  Check,
  ChevronRight,
  Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface GitHubIntegrationGuideProps {
  className?: string;
  onOAuthClick?: () => void;
  onAppClick?: () => void;
  oauthConnected?: boolean;
  appInstalled?: boolean;
}

export function GitHubIntegrationGuide({
  className,
  onOAuthClick = () => {},
  onAppClick = () => {},
  oauthConnected = false,
  appInstalled = false,
}: GitHubIntegrationGuideProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Primary: Personal Account (OAuth) */}
      <button
        onClick={oauthConnected ? undefined : onOAuthClick}
        disabled={oauthConnected}
        className={cn(
          'group flex items-center gap-4 rounded-xl border px-5 py-5 text-left transition-all',
          oauthConnected
            ? 'border-emerald-500/30 bg-emerald-500/5 cursor-default'
            : 'border-primary/40 bg-primary/[0.03] hover:border-primary/60 hover:bg-primary/[0.06] cursor-pointer'
        )}
      >
        <div className={cn(
          'flex h-11 w-11 items-center justify-center rounded-xl shrink-0',
          oauthConnected ? 'bg-emerald-500/10' : 'bg-primary/10'
        )}>
          {oauthConnected
            ? <Check className="h-5 w-5 text-emerald-500" />
            : <Github className="h-5 w-5 text-primary" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Connect your GitHub account</span>
            {oauthConnected && (
              <span className="text-[11px] font-medium text-emerald-500">Connected</span>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Sign in with GitHub to browse repos, import issues and PRs, and let agents push code — across all your orgs.
          </p>
        </div>
        {!oauthConnected && (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
        )}
      </button>

      {/* Secondary: GitHub App (team setup) */}
      {!appInstalled ? (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 px-4 py-3">
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="flex-1 text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground/80">Team setup:</span>{' '}
            Install the <button onClick={onAppClick} className="font-medium text-primary hover:underline">GitHub App</button> on
            your organization for webhook automation, separate rate limits, and no personal token sharing.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <Users className="h-4 w-4 shrink-0 text-emerald-500" />
          <p className="flex-1 text-[12px] text-muted-foreground">
            <span className="font-medium text-emerald-500">GitHub App installed</span>{' '}
            — webhook automation and team-wide access are active.
          </p>
        </div>
      )}
    </div>
  );
}
