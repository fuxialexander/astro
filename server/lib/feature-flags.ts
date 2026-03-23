/**
 * Feature Flags
 *
 * Minimal team-level feature gating. Flags are stored as a JSONB column on
 * the `teams` table. Each flag has a global default in code; per-team
 * overrides take precedence.
 *
 * To add a new flag:
 *   1. Add it to GLOBAL_DEFAULTS below (set to false)
 *   2. Add the same entry to src/hooks/use-feature-flag.ts GLOBAL_DEFAULTS
 *   3. Gate your feature with hasFeature() (backend) or useFeatureFlag() (frontend)
 *   4. Set {"flag": true} on your internal team record in the DB
 *
 * To release a flag:
 *   1. Change its GLOBAL_DEFAULTS value to true (both files)
 *   2. Merge + deploy — everyone sees the feature
 *
 * To clean up:
 *   1. Remove all hasFeature() / useFeatureFlag() checks
 *   2. Remove the entry from GLOBAL_DEFAULTS (both files)
 */

/**
 * Global defaults for feature flags.
 * - true  = GA (everyone gets it)
 * - false = gated (only teams with explicit override see it)
 */
export const GLOBAL_DEFAULTS: Record<string, boolean> = {
  'github-integration': false,
  'webhook-automation': false,
  'loop-nodes': false,
  'team-machines': true,
  'delivery-branches': false,
  'parallel-execution': false,
}

/**
 * Check if a team has access to a feature.
 * Priority: team override > global default > false.
 */
export function hasFeature(
  teamFlags: Record<string, boolean> | null | undefined,
  flag: string,
): boolean {
  return (teamFlags ?? {})[flag] ?? GLOBAL_DEFAULTS[flag] ?? false
}
