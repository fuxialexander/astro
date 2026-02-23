# Local Mode

IndexedDB-only single-user development mode.

## Overview

Local Mode uses IndexedDB as the sole data store. No authentication, no Supabase, no Docker.

## Enabling Local Mode

Set `ASTRO_LOCAL_MODE=true` or omit Supabase env vars.

## Limitations
- Single-user only
- No multi-device sync
- Data is per-browser-origin

## Related Documentation
- [Server Mode](./server-mode.md)
- [Developer Setup](./developer-setup.md)
