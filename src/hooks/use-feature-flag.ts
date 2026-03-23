import { useTeamStore } from '@/stores/team-store'

/**
 * Global defaults — must match server/lib/feature-flags.ts GLOBAL_DEFAULTS.
 */
const GLOBAL_DEFAULTS: Record<string, boolean> = {
  'github-integration': false,
  'webhook-automation': false,
  'loop-nodes': false,
  'team-machines': true,
  'delivery-branches': false,
}

/**
 * Check if the current team has access to a feature.
 * Priority: team override > global default > false.
 */
export function useFeatureFlag(flag: string): boolean {
  const team = useTeamStore((s) => s.teams[0])
  const teamFlags = team?.featureFlags ?? {}
  return teamFlags[flag] ?? GLOBAL_DEFAULTS[flag] ?? false
}
