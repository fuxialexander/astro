# Environment Variables

Complete environment variable reference.

## Frontend (.env.local)

```bash
# Supabase (Server Mode only)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Local Mode (overrides Supabase)
ASTRO_LOCAL_MODE=true

# Backend URL (development)
VITE_API_URL=http://localhost:3001
```

## Backend (.env)

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres:...

# Claude API
ANTHROPIC_API_KEY=sk-ant-...

# Relay
RELAY_PORT=3002
RELAY_JWT_SECRET=your-secret
REDIS_URL=redis://localhost:6379  # Optional, for scaling

# GitHub OAuth (app-level integration, not login)
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret

# Supabase OAuth Providers (social login)
# Create OAuth apps and set these + enable in Supabase Dashboard → Auth → Providers
# Callback URL: https://<project-ref>.supabase.co/auth/v1/callback
SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID=your-github-oauth-client-id
SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET=your-github-oauth-secret
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=your-google-oauth-client-id
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=your-google-oauth-secret
```

## Agent Runner (.astro/config.json)

```json
{
  "ASTRO_SERVER_URL": "https://astro-api.your-domain.com",
  "ASTRO_AUTH_TOKEN": "machine-access-token",
  "ASTRO_MACHINE_NAME": "dev-laptop"
}
```

## Related Documentation
- [Developer Setup](./developer-setup.md)
- [Production Deployment](./production-deployment.md)
