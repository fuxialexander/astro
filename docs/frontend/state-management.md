# State Management

Zustand stores and IndexedDB persistence.

## Store Overview

See CLAUDE.md "State Stores (Zustand)" section for complete store reference.

## Key Stores
- `project-store.ts` - Projects CRUD
- `plan-store.ts` - Plan nodes/edges
- `execution-store.ts` - Task execution state
- `realtime-store.ts` - Real-time events

## Persistence
- IndexedDB via `idb-keyval`
- Automatic cache on state changes
- Cache invalidation on login/sync

## Related Documentation
- [Real-time Sync](./realtime-sync.md)
- [Database Schema](../backend/database-schema.md)
