/**
 * GitHub Integration Guide
 * Helps users understand when to use OAuth vs GitHub App installation
 */

import {
  Github,
  Users,
  Zap,
  CheckCircle2,
  Check,
} from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface GitHubIntegrationGuideProps {
  className?: string;
  onOAuthClick?: () => void;
  onAppClick?: () => void;
  oauthConnected?: boolean;
  appInstalled?: boolean;
}

interface GuidanceCard {
  title: string;
  description: string;
  icon: React.ElementType;
  features: string[];
  benefits: string[];
  recommended?: boolean;
  color: 'blue' | 'teal' | 'purple' | 'amber';
  buttonLabel: string;
  connected?: boolean;
  onButtonClick: () => void;
}

const colorBorder = {
  blue: 'border-blue-200',
  teal: 'border-teal-200',
  purple: 'border-purple-200',
  amber: 'border-amber-200',
};

const colorText = {
  blue: 'text-blue-600',
  teal: 'text-teal-600',
  purple: 'text-purple-600',
  amber: 'text-amber-600',
};

const colorBg = {
  blue: 'bg-blue-50',
  teal: 'bg-teal-50',
  purple: 'bg-purple-50',
  amber: 'bg-amber-50',
};

function GuidanceCard({ card }: { card: GuidanceCard }) {
  const Icon = card.icon;
  const bgColor = colorBg[card.color];
  const textColor = colorText[card.color];
  const borderColor = colorBorder[card.color];

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-lg border-2 p-6 transition-all hover:shadow-md',
        borderColor,
        bgColor
      )}
    >
      {/* Recommended badge */}
      {card.recommended && (
        <div className={cn(
          'absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold',
          'bg-gradient-to-r from-emerald-100 to-emerald-50 text-emerald-700 border border-emerald-200'
        )}>
          <CheckCircle2 className="h-3 w-3" />
          Recommended
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg shrink-0',
          bgColor
        )}>
          <Icon className={cn('h-5 w-5', textColor)} />
        </div>
        <div className="flex-1 pt-0.5">
          <h3 className="font-semibold text-sm">{card.title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
        </div>
      </div>

      {/* Features */}
      <div className="space-y-3">
        {/* Feature list */}
        <div>
          <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">Features</p>
          <ul className="space-y-1.5">
            {card.features.map((feature, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <div className={cn('mt-1 h-1.5 w-1.5 rounded-full shrink-0 mt-1', textColor)} />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Benefits */}
        <div>
          <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">Benefits</p>
          <ul className="space-y-1.5">
            {card.benefits.map((benefit, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <Zap className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Button */}
      {card.connected ? (
        <div className={cn(
          'mt-6 w-full flex items-center justify-center gap-1.5 rounded-md border-2 px-3 py-1.5 text-sm font-semibold',
          'border-emerald-200 bg-emerald-50 text-emerald-700'
        )}>
          <Check className="h-3.5 w-3.5" />
          Connected
        </div>
      ) : (
        <Button
          onClick={card.onButtonClick}
          variant="outline"
          size="sm"
          className={cn(
            'mt-6 w-full',
            card.recommended && 'border-2 font-semibold'
          )}
        >
          {card.buttonLabel}
        </Button>
      )}
    </div>
  );
}

export function GitHubIntegrationGuide({
  className,
  onOAuthClick = () => {},
  onAppClick = () => {},
  oauthConnected = false,
  appInstalled = false,
}: GitHubIntegrationGuideProps) {

  const cards: GuidanceCard[] = [
    {
      title: 'Personal Account',
      description: 'OAuth connection for your GitHub account',
      icon: Github,
      color: 'blue',
      recommended: false,
      connected: oauthConnected,
      features: [
        'Connect your personal GitHub account',
        'Browse all your accessible repositories',
        'Standard GitHub API rate limits',
        'Works immediately after authorization',
      ],
      benefits: [
        'Quick setup for personal projects',
        'No additional installation required',
        'Direct access to your repos',
      ],
      buttonLabel: 'Connect Personal Account',
      onButtonClick: onOAuthClick,
    },
    {
      title: 'GitHub App',
      description: 'Higher rate limits and team collaboration',
      icon: Users,
      color: 'teal',
      recommended: true,
      connected: appInstalled,
      features: [
        'Install app on organization or account',
        'Higher API rate limits (5,000 req/hr)',
        'Team-wide access without sharing tokens',
        'More granular permissions and controls',
      ],
      benefits: [
        'Better for teams and organizations',
        'Safer—no token sharing needed',
        'Better for heavily-used repositories',
      ],
      buttonLabel: 'Install GitHub App',
      onButtonClick: onAppClick,
    },
  ];

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold mb-1">Choose Your GitHub Integration</h3>
        <p className="text-[13px] text-muted-foreground">
          Select the option that best fits your workflow. You can use both personal and app connections simultaneously.
        </p>
      </div>

      {/* Comparison Grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <GuidanceCard key={card.title} card={card} />
        ))}
      </div>

      {/* Help Section (Collapsible) */}
      <details className="group">
        <summary className="cursor-pointer flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors py-2 px-3 rounded-md hover:bg-muted/50">
          <span className="group-open:hidden">→</span>
          <span className="hidden group-open:inline">↓</span>
          Learn more about the differences
        </summary>
        <div className="mt-3 space-y-3 text-[13px] text-muted-foreground">
          <div className="p-3 rounded-md bg-muted/30 space-y-2">
            <p className="font-medium text-foreground">When to use Personal Account:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Developing solo or on personal projects</li>
              <li>You only need access to your own repositories</li>
              <li>Quick setup without organization approval</li>
            </ul>
          </div>
          <div className="p-3 rounded-md bg-muted/30 space-y-2">
            <p className="font-medium text-foreground">When to use GitHub App:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Working in a team or organization</li>
              <li>You need to collaborate on shared repositories</li>
              <li>You want higher API rate limits</li>
              <li>You want to avoid sharing personal tokens</li>
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}
