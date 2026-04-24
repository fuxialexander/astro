/**
 * HipaaRoute — wraps a route and redirects to /dashboard when the server is
 * in HIPAA mode. Intended for features that are hidden in HIPAA deployments
 * (connected accounts, community marketplace, non-AWS compute, etc.).
 *
 * Do NOT use this for per-tenant feature gating — use <FeatureFlagRoute> for
 * that. HIPAA mode is a deployment-level switch, not a team-level flag.
 */

import { Navigate } from 'react-router'
import { useIsHipaaMode } from '@/hooks/use-hipaa-mode'

interface HipaaRouteProps {
  /** When true, the route is HIDDEN in HIPAA mode (default). */
  hideInHipaa?: boolean
  /** Where to redirect when hidden. Defaults to /dashboard. */
  redirectTo?: string
  children: React.ReactNode
}

export function HipaaRoute({
  hideInHipaa = true,
  redirectTo = '/dashboard',
  children,
}: HipaaRouteProps) {
  const isHipaa = useIsHipaaMode()

  if (hideInHipaa && isHipaa) {
    return <Navigate to={redirectTo} replace />
  }

  return <>{children}</>
}
