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

## Visual Indicator

The sidebar displays a "Local Mode" badge when running in local mode.

## Related Documentation

- [Server Mode](./server-mode.md)
- [Developer Setup](./developer-setup.md)
- [Database Schema](../backend/database-schema.md)
