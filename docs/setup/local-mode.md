# Local Mode

PGlite-based single-user development mode.

## Overview

Local Mode uses PGlite (Postgres-in-WASM) as the data store, running inside the backend process. No authentication, no Supabase, no Docker required. All data persists to disk via PGlite's filesystem backend.

The full stack runs locally: Vite (port 5173) + Hono API (port 3001) + WebSocket relay (port 3002). The frontend communicates with the backend via `dataClient` calling `/api/data/*` endpoints, which use Drizzle ORM over PGlite — the same schema used in server mode with Postgres.

## Enabling Local Mode

```bash
npm run dev:local
```

This command switches the environment to local mode and starts the full stack. It is equivalent to:

```bash
npm run env:local && npm run dev
```

Local mode is auto-detected when Supabase environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are absent.

### Mode Detection in Code

```typescript
import { isLocalMode } from '@/lib/app-mode'       // frontend
import { isLocalMode } from 'server/lib/app-mode'   // backend
import { isLocalMode } from '@astro/core/app-mode'   // shared
```

## Data Persistence

PGlite stores data on disk at `~/.astro/pglite/`. The database uses the same Drizzle ORM schema as the server mode Postgres database (source of truth: `packages/core/src/db/schema.ts`).

Data flows: Frontend stores → `dataClient` → `POST /api/data/*` → Drizzle ORM → PGlite.

## Limitations

- Single-user only (no authentication)
- No multi-device sync (no Supabase Realtime)
- No Row-Level Security (RLS)
- No team features
- No Community features (browse, publish, fork, star, comment)

## Feature Guards

Server-only features are gated at the UI layer using `isLocalMode()` / `isServerMode()` checks. All guards are component-level — there are no route-level redirects.

```
                        User navigates to feature
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   isLocalMode() check   │
                    └────────┬───────────────┘
                             │
                 ┌───────────┴───────────┐
                 │                       │
            local = true            local = false
                 │                       │
                 ▼                       ▼
        ┌────────────────┐     ┌─────────────────┐
        │   EmptyState   │     │  Normal render   │
        │  "Requires     │     │  (full feature)  │
        │  server mode"  │     └─────────────────┘
        └────────────────┘
```

### Guard Locations

| Surface                          | File                              | Guard            |
|----------------------------------|-----------------------------------|------------------|
| Sidebar "Community" link         | `src/components/layout/sidebar.tsx`| `isServerMode()` — hidden |
| `/community` page (direct URL)   | `src/pages/community.tsx`         | `isLocalMode()` → EmptyState |
| `/community/:id` detail page     | `src/pages/community-plan-detail.tsx` | `isLocalMode()` → EmptyState |
| "Publish to Community" button    | `src/pages/plan-view.tsx`         | `isServerMode()` — hidden |
| Dashboard "Browse Community" CTA | `src/pages/dashboard.tsx`         | `isServerMode()` — hidden |

## Guided Product Tour

On first visit, a driver.js guided tour highlights sidebar navigation items. In local mode the tour has 4 steps (Community step is skipped). The tour fires once per browser (`localStorage` key: `astro-tour-completed`).

```
 Local mode tour steps:          Server mode tour steps:

 1. Environments                  1. Environments
 2. Examples                      2. Examples
 3. Plan                          3. Plan
 4. Projects                      4. Projects
                                  5. Community
```

## Visual Indicator

The sidebar displays a "Local Mode" badge when running in local mode.

## Related Documentation

- [Server Mode](./server-mode.md)
- [Developer Setup](./developer-setup.md)
- [Database Schema](../backend/database-schema.md)
