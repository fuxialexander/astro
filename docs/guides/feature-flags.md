# Feature Flags & Staged Rollouts

How to develop new features without exposing them to external users.

## The Problem

Astro is now live with external users. When developing new features, we need:
- Internal team members can see and test in-progress features on production
- External users see only stable, released features
- No separate deployment or infrastructure for staging

## Recommended Approach: Runtime Feature Flags

Use a simple runtime feature flag system. No separate "staging" copy of the website needed.

### Why NOT two copies of the website

| Approach | Pros | Cons |
|----------|------|------|
| Two deployments (staging + prod) | Complete isolation | Double infra cost, data divergence, different URLs for testing, two Supabase projects, hard to test with real data |
| Feature flags (single deployment) | Zero extra cost, test with real data, instant toggle, no URL confusion | Requires discipline to flag new features |

Two deployments sounds simple but creates real problems:
- Staging has different data, so bugs that depend on production data won't be caught
- You need to maintain two sets of env vars, two Supabase projects, two Fly.io apps
- Team members forget which URL is which
- OAuth callbacks, WebAuthn RP IDs, CORS origins all need separate configuration

Feature flags on a single deployment are simpler, cheaper, and more effective.

### Branch Deploys for Pre-Merge Testing

Cloudflare Pages already creates branch-specific preview URLs when you deploy from a non-main branch:

```
Production:    https://astro-app-3vo.pages.dev
Branch deploy: https://fix-xyz.astro-app-3vo.pages.dev
```

This is useful for **pre-merge code review** (test before merging to main). But it requires updating Fly.io CORS/WebAuthn secrets to allow the branch URL (see [Fly Deployment: Branch Deploys](../setup/fly-deployment.md)). Use this for PR review, not for ongoing feature development.

## Implementation

### Level 1: Simple flag object (start here)

Create a central feature flag configuration:

```typescript
// src/lib/feature-flags.ts

// Feature flags for staged rollout.
// Set flags to true to enable for all users.
// Use isInternalUser() for internal-only features.
const FLAGS = {
  // Example: new dashboard redesign
  newDashboard: false,

  // Example: experimental AI provider
  experimentalProvider: false,
} as const

export type FeatureFlag = keyof typeof FLAGS

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FLAGS[flag]
}
```

### Level 2: Internal user detection

Add a way to identify internal team members:

```typescript
// src/lib/feature-flags.ts

// Internal team member emails (or user IDs)
const INTERNAL_EMAILS = new Set([
  'you@example.com',
  'teammate@example.com',
])

// Or: check if user belongs to the "Astro Team" team
const INTERNAL_TEAM_ID = 'your-internal-team-uuid'

export function isInternalUser(user: { email?: string; teamIds?: string[] }): boolean {
  if (user.email && INTERNAL_EMAILS.has(user.email)) return true
  if (user.teamIds?.includes(INTERNAL_TEAM_ID)) return true
  return false
}

export function isFeatureEnabledForUser(
  flag: FeatureFlag,
  user: { email?: string; teamIds?: string[] }
): boolean {
  // Global flag takes precedence
  if (FLAGS[flag]) return true
  // Internal-only flags
  if (INTERNAL_FLAGS[flag] && isInternalUser(user)) return true
  return false
}

// Flags visible only to internal users
const INTERNAL_FLAGS: Partial<Record<FeatureFlag, boolean>> = {
  newDashboard: true,       // Internal team can see this
  experimentalProvider: true,
}
```

### Level 3: URL parameter override (for testing)

Allow enabling features via URL for quick testing:

```typescript
// Check URL params (only in development or for internal users)
export function isFeatureEnabledWithOverride(
  flag: FeatureFlag,
  user: { email?: string; teamIds?: string[] }
): boolean {
  // URL override: ?feature_newDashboard=true
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    const override = params.get(`feature_${flag}`)
    if (override === 'true' && isInternalUser(user)) return true
    if (override === 'false') return false
  }

  return isFeatureEnabledForUser(flag, user)
}
```

### Using flags in components

```tsx
// In a React component
import { isFeatureEnabledForUser } from '@/lib/feature-flags'
import { useSupabaseAuth } from '@/hooks/use-supabase-auth'

function Dashboard() {
  const { user } = useSupabaseAuth()

  return (
    <div>
      <ExistingDashboard />

      {isFeatureEnabledForUser('newDashboard', user) && (
        <NewDashboardSection />
      )}
    </div>
  )
}
```

### Using flags in backend routes

```typescript
// In a Hono route handler
import { isInternalUser } from '../lib/feature-flags.js'

app.get('/api/experimental/endpoint', requireAuth, async (c) => {
  const user = c.get('user')
  if (!isInternalUser(user)) {
    return c.json({ error: 'Not available' }, 404)
  }
  // ... experimental endpoint logic
})
```

## Rollout Workflow

1. **Develop**: Build the feature behind a flag. Set it to `false` globally, `true` in `INTERNAL_FLAGS`.
2. **Test on production**: Internal team tests with real data on the live site.
3. **Fix issues**: Iterate on the feature while it's invisible to external users.
4. **Release**: Set the global flag to `true`. Remove the flag check after the feature is stable.
5. **Clean up**: Delete the flag entry and remove conditional rendering.

## When to use what

| Scenario | Approach |
|----------|----------|
| Quick PR review | Cloudflare Pages branch deploy |
| Feature in development (days/weeks) | Feature flag (internal only) |
| A/B testing | Feature flag with percentage rollout (future) |
| Breaking redesign | Feature flag with internal-only toggle |
| Hotfix | Direct deploy to main (no flag needed) |

## Future Enhancements

If the project grows beyond a small team:

- **Database-backed flags**: Store flags in a `feature_flags` table, toggle via admin UI without redeploying
- **Percentage rollout**: Enable for X% of users (hash user ID, compare to threshold)
- **Third-party service**: LaunchDarkly, Flagsmith, or Unleash for enterprise-grade flag management
- **Server-side flags API**: Backend serves flag state to frontend, so flags can change without frontend redeploy

For now, the simple in-code approach is sufficient. It requires a deploy to change flags, but deploys are fast (< 3 minutes) and the team is small.

## Related Documentation

- [Fly Deployment](../setup/fly-deployment.md) -- Branch deploys, deploy commands
- [Authentication](../backend/authentication.md) -- User identity (for internal user detection)
