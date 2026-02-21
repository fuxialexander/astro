# Cloudflare Tunnel

Local HTTPS tunneling for development.

## Setup

```bash
bash scripts/start-tunnel.sh
```

This creates a Cloudflare Tunnel and routes all `astro.*` subdomains to local ports.

## Routes

- `astro.fuxialexander.work` → localhost:5173 (Vite)
- `astro-api.fuxialexander.work` → localhost:3001 (Hono)
- `astro-relay.fuxialexander.work` → localhost:3002 (Relay)
- `astro-supabase.fuxialexander.work` → localhost:54321 (Supabase)

## Related Documentation
- [Developer Setup](./developer-setup.md)
- [Environment Variables](./environment-variables.md)
