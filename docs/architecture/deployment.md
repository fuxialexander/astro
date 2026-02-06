# Deployment Architecture

## Topology

```
┌─────────────────────┐     ┌──────────────────────┐
│  Cloudflare Pages   │     │      Fly.io App       │
│  (Static Frontend)  │────>│  Port 3001: HTTP API  │
│  *.pages.dev        │     │  Port 3002: WebSocket │
└─────────────────────┘     └──────────┬───────────┘
                                       │
                            ┌──────────v───────────┐
                            │   Upstash Redis      │
                            │   (Pub/Sub + Cache)  │
                            └──────────────────────┘
```

## Frontend: Cloudflare Pages

- Static Vite build deployed via `wrangler pages deploy`
- API proxy configured to point to Fly.io backend
- Zero-config CDN, automatic SSL

### Build & Deploy
```bash
npm run build           # Vite production build
npm run deploy          # wrangler pages deploy
```

## Backend: Fly.io

### Configuration (`fly.toml`)

The backend runs as a single Fly.io app with two services:
- **HTTP API** on port 3001 (internal port, mapped to 443 externally)
- **WebSocket relay** on port 3002

### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `REDIS_URL` | Production | Upstash Redis URL for pub/sub |
| `RELAY_JWT_SECRET` | Production | JWT secret for machine auth |
| `RELAY_PORT` | No | WebSocket port (default: 3002) |
| `NODE_ENV` | No | Set to "production" |

### Scaling Strategy

1. **Single instance** (default): Sufficient for most teams
2. **Multi-instance**: Enable Redis for horizontal scaling
   - Each instance runs both HTTP + WS servers
   - Machine registry shared via Redis pub/sub
   - Fly.io handles load balancing for HTTP
   - WebSocket connections are sticky per instance

### Health Checks
- HTTP: `GET /api/health` on port 3001
- WebSocket: Internal heartbeat mechanism (30s interval)

## Redis: Upstash

- Serverless Redis (pay-per-request)
- Used for: Machine registry sync, task routing, pub/sub
- Optional in development (single instance works without Redis)

### Setup
1. Create Upstash Redis instance
2. Set `REDIS_URL` in Fly.io secrets
3. Redis pub/sub channels:
   - `nexus:machines` - Machine state changes
   - `nexus:tasks` - Task state changes
   - `nexus:dispatch` - Cross-instance task dispatch

## SSL/TLS

- Cloudflare Pages: Automatic SSL
- Fly.io HTTP: Automatic SSL via Fly proxy
- Fly.io WebSocket: WSS via Fly proxy (automatic)
- Agent runners connect via `wss://your-app.fly.dev:3002`

## CORS Configuration

Production CORS in `server/index.ts`:
- Allow origin: `https://your-app.pages.dev`
- Allow methods: GET, POST
- Allow headers: Content-Type, Authorization, Last-Event-ID

## CI/CD

### GitHub Actions Pipeline
1. On push to `main`:
   - `npm run build` (TypeScript check + Vite build)
   - `npm run lint` (ESLint)
   - Deploy frontend to Cloudflare Pages
   - Deploy backend to Fly.io

### Manual Deploy
```bash
# Frontend
npm run deploy

# Backend
fly deploy
```

## Cost Estimates

| Service | Tier | Est. Monthly |
|---------|------|-------------|
| Cloudflare Pages | Free | $0 |
| Fly.io | 1x shared-cpu-1x, 256MB | ~$5 |
| Upstash Redis | Pay-per-request | ~$1-5 |
| **Total** | | **~$6-10** |
