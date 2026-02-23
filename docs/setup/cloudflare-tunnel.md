# Cloudflare Tunnel

Local HTTPS tunneling for development.

## Setup

```bash
bash scripts/start-tunnel.sh
```

This creates a Cloudflare Tunnel and routes all `astro.*` subdomains to local ports.

## Routes

- `astro.your-domain.com` → localhost:5173 (Vite)
- `astro-api.your-domain.com` → localhost:3001 (Hono)
- `astro-relay.your-domain.com` → localhost:3002 (Relay)
- `astro-supabase.your-domain.com` → localhost:54321 (Supabase)

## Related Documentation
- [Developer Setup](./developer-setup.md)
- [Environment Variables](./environment-variables.md)
