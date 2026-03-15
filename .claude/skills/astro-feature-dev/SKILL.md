---
name: astro-feature-dev
description: >-
  Guide for building new features safely in Astro. Enforces the "add, don't
  modify" principle and uses the feature flag system to hide unreleased features
  from external users. Trigger when the user says "build a new feature", "add a
  feature", "implement feature X", "start working on X", or when beginning
  significant new functionality that external users should not see yet.
---

# Astro Feature Development

Build new features on `main` without breaking anything for existing users.

## The Rule

**New logic goes in new files. Existing files get at most 1-2 lines added.**

A feature flag hides the entry point (route, sidebar link, API). But if you
edit an existing component and introduce a bug, ALL users see it — the flag
cannot protect shared code you modified.

## Step-by-Step: How to Add a New Feature

### 1. Register the flag

Add one line to each of these three files:

**`server/lib/feature-flags.ts`** — backend knows about the flag:
```typescript
export const GLOBAL_DEFAULTS: Record<string, boolean> = {
  // ... existing flags ...
  'my-feature': false,    // <-- add (false = hidden by default)
}
```

**`src/hooks/use-feature-flag.ts`** — frontend knows about the flag:
```typescript
const GLOBAL_DEFAULTS: Record<string, boolean> = {
  // ... existing flags ...
  'my-feature': false,    // <-- same flag, same default
}
```

**`scripts/sync-feature-flags.ts`** — internal teams get it enabled:
```typescript
const INTERNAL_FLAGS: Record<string, boolean> = {
  // ... existing flags ...
  'my-feature': true,     // <-- true = your internal team sees it
}
```

### 2. Create new files (do NOT edit existing pages)

```
src/pages/my-feature.tsx           <-- NEW FILE: page component
server/routes/my-feature.ts        <-- NEW FILE: API route
src/components/my-feature/         <-- NEW FOLDER: sub-components
src/stores/my-feature-store.ts     <-- NEW FILE: store (if needed)
```

### 3. Gate the entry points (minimal edits to existing files)

**`src/app.tsx`** (EXISTING FILE — add conditional route):
```tsx
{useFeatureFlag('my-feature') && (
  <Route path="my-feature" element={<MyFeaturePage />} />
)}
```

**`src/stores/sidebar-store.ts`** (EXISTING FILE — add sidebar item):
```typescript
{ id: "my-feature", to: "/my-feature", icon: "Icon", label: "My Feature",
  visible: true, protected: false, featureFlag: "my-feature" },
```

**`server/index.ts`** (EXISTING FILE — mount the route):
```typescript
import { myFeatureRoute } from './routes/my-feature.js'
app.route('/api/my-feature', myFeatureRoute)
```

**`server/routes/my-feature.ts`** (YOUR NEW FILE — add the gate):
```typescript
import { hasFeature } from '../lib/feature-flags.js'

app.get('/data', async (c) => {
  const team = c.get('team')
  if (!hasFeature(team?.featureFlags, 'my-feature')) {
    return c.json({ error: 'Not available' }, 404)
  }
  // handler logic here
})
```

### 4. Enable the flag for internal teams

```bash
npm run flags          # writes flags to internal teams in the DB
npm run flags:status   # verify: shows all teams and their flags
npm run flags:dry-run  # preview what would change (no writes)
```

### 5. Build, merge, deploy

```bash
npm run build && npm run lint && npm test
```

External users see nothing. Internal team sees the feature.

## How to Find Your Internal Teams

The sync script identifies internal teams **by name**. Team names are configured
in `scripts/sync-feature-flags.ts` in the `INTERNAL_TEAMS` array:

```typescript
const INTERNAL_TEAMS: string[] = [
  'Local',           // local-mode default team (auto-created)
  // Add your production team names here:
  // 'Astro Core',
  // 'Research Lab',
]
```

To see all teams in your database and their current flags:

```bash
npm run flags:status
```

This prints every team name, whether it is in `INTERNAL_TEAMS`, and what flags
it has. Use this output to find your team names and add them to the array.

## Releasing to Everyone

Change `false` to `true` in `GLOBAL_DEFAULTS` (both backend and frontend files).
Remove from `INTERNAL_FLAGS` in the sync script. Run `npm run flags`. Merge, deploy.

```diff
 // server/lib/feature-flags.ts AND src/hooks/use-feature-flag.ts
-  'my-feature': false,
+  'my-feature': true,
```

## Killing a Broken Feature

Change `true` back to `false` in `GLOBAL_DEFAULTS`. Merge, deploy. Feature
disappears for external users instantly. Internal team still sees it (their
team override is still `true`).

## Cleanup (After Feature is Stable)

Remove all `hasFeature()` / `useFeatureFlag()` checks. Remove `featureFlag`
from the sidebar item. Remove from `GLOBAL_DEFAULTS`. The feature is always on.

## Adding a Section to an Existing Page

Do NOT edit the existing component. Create a new component in a new file,
then add ONE conditional render line to the existing page:

```tsx
// src/components/settings/github-settings.tsx  <-- NEW FILE
export function GitHubSettings() { /* ... */ }

// src/pages/settings.tsx  <-- EXISTING FILE, add one line:
{useFeatureFlag('github-integration') && <GitHubSettings />}
```

## Schema Changes

If your feature needs a new DB table or column, update three files together:

1. Edit `packages/core/src/db/schema.ts` (source of truth)
2. Run `npx drizzle-kit generate` (creates `drizzle/*.sql` for local mode)
3. Write matching SQL in `supabase/migrations/YYYYMMDDHHMMSS_description.sql`

Missing Drizzle migration breaks `npm run dev:local`.
Missing Supabase migration breaks production.

## Safety Check

Before merging: **if I delete all my new files, does the existing code compile?**

```bash
git stash && npm run build   # must pass
git stash pop
```

## Checklist

- [ ] Flag registered in `GLOBAL_DEFAULTS` (both files) + `INTERNAL_FLAGS`
- [ ] All new logic in new files
- [ ] Existing files: only conditional renders, imports, and route mounts
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Schema changes include both Drizzle and Supabase migrations
- [ ] `npm run flags` run to enable for internal team
- [ ] Feature invisible when flag is off (verify in browser)

## Reference

- **Wiki**: See [[Feature Development Lifecycle]] for full system design and diagrams
- **Flag management**: `npm run flags` / `flags:status` / `flags:dry-run`
- **Deploying**: Use `/deploy` skill
- **PR review**: Use `/pr-shepherd` skill
