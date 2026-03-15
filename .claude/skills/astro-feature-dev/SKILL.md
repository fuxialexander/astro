---
name: astro-feature-dev
description: >-
  Guide for building new features safely in Astro. Ensures existing user
  experience is never broken by new feature code, even before the feature flag
  system is implemented. Enforces the "add, don't modify" principle: new features
  live in new files, new components, new routes -- existing code stays untouched.
  Trigger when the user says "build a new feature", "add a feature", "implement
  feature X", "start working on X", or when beginning significant new functionality
  that external users should not see yet.
---

# Astro Feature Development

Build new features on `main` without breaking anything for existing users.

## The Golden Rule

**Add new code. Do not change existing code.**

A feature flag only protects the entry point (route, sidebar item, button). If the
new feature modifies an existing function, component, store, or query, it can break
existing behavior even when the flag is off.

The safe pattern: the flag check is a fork in the road. One path (flag off) runs
100% original code. The other path (flag on) runs new code in new files. The two
paths do not share modified logic.

## Before You Write Code

Read these files to understand the current state:

1. `packages/core/src/db/schema.ts` — the Drizzle schema (source of truth)
2. `src/app.tsx` — frontend routing
3. `src/stores/sidebar-store.ts` — sidebar item definitions
4. `server/index.ts` — where backend routes are registered

Check if the feature flag system exists yet:

```bash
# If this file exists, feature flags are implemented
ls server/lib/feature-flags.ts 2>/dev/null && echo "FLAGS READY" || echo "FLAGS NOT READY"
```

If feature flags are NOT ready yet, see "Working Without Flags" below.

## How to Structure a New Feature

### 1. New files, not modified files

| Need | Do this | NOT this |
|------|---------|----------|
| New page | Create `src/pages/my-feature.tsx` | Edit `src/pages/dashboard.tsx` to add a section |
| New API | Create `server/routes/my-feature.ts` | Add handlers to an existing route file |
| New store | Create `src/stores/my-feature-store.ts` | Add fields to `project-store.ts` |
| New component | Create `src/components/my-feature/` | Modify existing components |
| New DB table | Add table to `schema.ts` (additive) | Alter existing table columns |

**New DB tables are safe** — they don't affect existing queries. Adding a column to an
existing table is also safe IF the column has a default value and existing code never
reads it.

### 2. Gate at the boundary, not deep inside

Good (gate at the entry point):

```typescript
// src/app.tsx — the flag check is at the route level
{useFeatureFlag('my-feature') && (
  <Route path="my-feature" element={<MyFeaturePage />} />
)}
```

Bad (gate deep inside shared code):

```typescript
// src/components/sidebar.tsx — flag check buried inside shared component
function Sidebar() {
  // This modifies the shared Sidebar component. If the flag logic has a bug,
  // ALL users see a broken sidebar, not just internal users.
  const items = useFeatureFlag('my-feature')
    ? [...existingItems, newItem]  // changed behavior for existing code path
    : existingItems
}
```

### 3. When you MUST touch existing code

Sometimes a new feature needs to extend shared infrastructure (a store, a type, a
utility). When this is unavoidable:

**Make the change backwards-compatible and minimal:**

- Adding a new optional field to a type: SAFE (existing code ignores it)
- Adding a new column with a default: SAFE (existing queries unaffected)
- Adding a new export to a module: SAFE (existing imports unaffected)
- Changing a function signature: DANGEROUS (all callers affected)
- Changing a store's initialization: DANGEROUS (affects every page load)
- Changing a component's props: DANGEROUS (all parents affected)

**If the change is dangerous, use a wrapper:**

```typescript
// WRONG — modifies existing function
function fetchProjects() {
  // ... existing logic ...
  if (featureEnabled) {
    // new logic mixed in — breaks if buggy
  }
}

// RIGHT — new function wraps the old one
function fetchProjectsWithMyFeature() {
  const projects = await fetchProjects()  // original untouched
  // new logic here — only called from the new feature page
  return enrichProjects(projects)
}
```

### 4. Self-test: "Is the flag-off path identical?"

Before committing, ask: **if I delete all my new files, does the existing code compile
and behave identically to before my changes?**

If yes: safe.
If no: you modified existing code and need to restructure.

Quick check:

```bash
# Stash your changes, build, and verify nothing broke
git stash
npm run build
# If build succeeds and tests pass, your changes are additive
git stash pop
```

## Feature Development Checklist

### Starting a new feature

1. **Create a feature branch** from `main` (e.g., `feat/my-feature`)
2. **Check if feature flags exist** (`server/lib/feature-flags.ts`)
3. **Add a flag entry** to `GLOBAL_DEFAULTS` (set to `false`) in both:
   - `server/lib/feature-flags.ts`
   - `src/hooks/use-feature-flag.ts`
4. **Create new files** for the feature:
   - New route file: `server/routes/my-feature.ts`
   - New page: `src/pages/my-feature.tsx`
   - New components: `src/components/my-feature/`
   - New store (if needed): `src/stores/my-feature-store.ts`
5. **Gate the entry points**:
   - Route: use `FeatureRoute` or conditional rendering in `app.tsx`
   - API: call `hasFeature()` at the top of the route handler
   - Sidebar: add `featureFlag: 'my-feature'` to the sidebar item
6. **Schema changes** (if any): update all three artifacts together:
   - `packages/core/src/db/schema.ts`
   - `npx drizzle-kit generate` → `drizzle/*.sql`
   - Hand-write `supabase/migrations/YYYYMMDD_description.sql`
7. **Build and verify**: `npm run build && npm run lint`

### Before merging to main

- [ ] All new feature code lives in new files
- [ ] Existing files have minimal, backwards-compatible changes only
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (or pre-existing failures only)
- [ ] Stash test: `git stash && npm run build` succeeds (proves additivity)
- [ ] Feature is invisible when flag is off (check in browser)
- [ ] Schema changes include both Drizzle and Supabase migrations

### Releasing to everyone

1. Change `GLOBAL_DEFAULTS['my-feature']` from `false` to `true` in both files
2. Merge to `main`, deploy
3. Later: remove all flag checks and `GLOBAL_DEFAULTS` entry (cleanup PR)

## Working Without Flags

If the feature flag system is not implemented yet, use these simpler techniques
that achieve the same isolation:

### Technique 1: Unlinked routes

Add the page and route, but don't add it to the sidebar or link to it from
anywhere. External users can't discover it. Internal developers navigate to
it directly by URL.

```typescript
// In app.tsx — route exists but no sidebar link, no navigation
<Route path="my-hidden-page" element={<MyHiddenPage />} />
```

This is not bulletproof (someone could guess the URL), but for internal-only
testing of a small team it is sufficient.

### Technique 2: New route files, registered but inert

Add the backend route file. Register it in `server/index.ts`. The API endpoints
exist but the frontend never calls them (because the UI doesn't exist for
external users). The backend code is exercised by internal developers using
the hidden frontend page.

### Technique 3: Separate components, lazy-loaded

For a new tab or section within an existing page:

```typescript
// Instead of modifying the existing page:
function ProjectView() {
  const showRepoTab = false // flip to true for internal testing
  return (
    <Tabs>
      <ExistingTab />
      {showRepoTab && <RepoExplorerTab />}  {/* new component, new file */}
    </Tabs>
  )
}
```

The only change to the existing file is a single conditional render of a new
component. The component itself is in a new file. The boolean can be flipped
to a feature flag call later.

## Schema Sync Reminder

Every PR that changes `packages/core/src/db/schema.ts` must also include:

1. Run `npx drizzle-kit generate` → creates migration in `drizzle/`
2. Write matching SQL in `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
3. Both files committed in the same PR

Missing the Drizzle migration breaks local mode (PGlite).
Missing the Supabase migration breaks production.

## What This Skill Does NOT Cover

- **Deploying**: Use `/deploy` skill
- **PR review**: Use `/pr-shepherd` skill
- **Writing docs**: Use `/wiki-docs` skill
- **Submodule changes**: Use `/submodule-pr` skill
