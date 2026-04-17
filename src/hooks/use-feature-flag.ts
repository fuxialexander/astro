import { useTeamStore } from '@/stores/team-store'

/**
 * Global defaults — must match server/lib/feature-flags.ts GLOBAL_DEFAULTS.
 */
const GLOBAL_DEFAULTS: Record<string, boolean> = {
  'github-integration': true,
  'loop-nodes': false,
  'team-machines': true,
  'delivery-branches': true,
  'parallel-execution': false,
  'inbox-home': true,
  'import-from-history': true,
}

/**
 * Check if the current team has access to a feature.
 * Priority: team override > global default > false.
 */
export function useFeatureFlag(flag: string): boolean {
  const activeTeamId = useTeamStore((s) => s.activeTeamId)
  const teams = useTeamStore((s) => s.teams)
  const team = teams.find((t) => t.id === activeTeamId) ?? teams[0]
  const teamFlags = team?.featureFlags ?? {}
  return teamFlags[flag] ?? GLOBAL_DEFAULTS[flag] ?? false
}
