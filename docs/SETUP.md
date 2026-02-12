# Nexus Setup Guide

## Prerequisites

### Required

- **Node.js**: v25.6.0 or higher
  - Recommended: Use [nvm](https://github.com/nvm-sh/nvm) for version management
  - The project includes `.nvmrc` for automatic version switching
- **npm**: v11.8.0 or higher (comes with Node.js)
- **Git**: Latest stable version
- **Claude CLI**: Authenticated via `claude login` (credentials are stored in `~/.claude/` and used automatically by the SDK)

### Optional

- **Redis**: For horizontal scaling across multiple relay instances (not needed for local dev)
- **Docker**: For containerized deployment
- **cloudflared**: For exposing your local server to remote agent runners

## Quick Start

```bash
# Clone the repository
git clone git@github.com:fuxialexander/nexus.git
cd nexus

# Use correct Node.js version (if using nvm)
nvm use

# Install dependencies
npm install

# Copy environment template (optional — no API keys needed)
cp .env.example .env

# Run verification
npm run verify

# Start development server
npm run dev
```

Your application should now be running:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001
- **WebSocket Relay**: ws://localhost:3002

The SQLite database (`.nexus/nexus.db`) is created automatically on first server start.

## Detailed Setup

### 1. Clone the Repository

```bash
git clone git@github.com:fuxialexander/nexus.git
cd nexus
```

### 2. Node.js Version Setup

The project uses Node.js v25.6.0. If you're using nvm:

```bash
# Install the correct version
nvm install 25.6.0

# Use it for this project
nvm use

# Optional: Set as default
nvm alias default 25.6.0
```

Verify your Node.js version:

```bash
node --version  # Should output: v25.6.0
npm --version   # Should output: 11.8.0 or higher
```

### 3. Install Dependencies

```bash
npm install
```

This will install all required dependencies and set up Husky git hooks.

### 4. Environment Configuration

Copy the example environment file (optional — no API keys needed):

```bash
cp .env.example .env
```

The Claude Agent SDK authenticates via `~/.claude/` credentials (from `claude login`). No API key environment variable is required. All other variables have sensible defaults for local development. See the full reference below.

### 5. Database

Nexus uses **Drizzle ORM + SQLite** for local persistence. The database file is created automatically at `.nexus/nexus.db` when the server starts. No manual setup required.

Migrations run automatically on server start. Migration files are in the `drizzle/` directory.

### 6. Verify Setup

Run the verification script to check your setup:

```bash
npm run verify
```

This checks:
- Node.js and npm versions
- Required files and directories
- Dependencies installation
- Port availability
- Configuration files

### 7. Start Development Server

```bash
# Start both frontend and backend
npm run dev

# Or start them separately
npm run dev:frontend  # Frontend only (port 5173)
npm run dev:backend   # Backend only (port 3001 + relay on 3002)
```

Vite proxies `/api` requests to `localhost:3001` automatically — no CORS issues in development.

## Environment Variables

### Complete Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | `development` | No |
| `PORT` | Backend server port | `3001` | No |
| `RELAY_PORT` | WebSocket relay port | `3002` | No |
| `NEXUS_BASE_URL` | Frontend base URL | `http://localhost:5173` | No |
| `API_BASE_URL` | Backend API base URL | `http://localhost:3001` | No |
| `RELAY_WS_URL` | WebSocket URL | `ws://localhost:3002` | No |
| `CORS_ORIGIN` | CORS allowed origin | `http://localhost:5173` | No |
| `AUTH_JWT_SECRET` | JWT signing secret | Auto-generated in dev | No (dev) |
| `AUTH_REFRESH_SECRET` | Refresh token secret | Auto-generated in dev | No (dev) |
| `DEVICE_AUTH_JWT_SECRET` | Device JWT secret | Auto-generated in dev | No (dev) |
| `DEVICE_AUTH_REFRESH_SECRET` | Device refresh secret | Auto-generated in dev | No (dev) |
| `REDIS_URL` | Redis connection URL | - | No |
| `CLOUDFLARED_DOMAIN` | Domain for Cloudflare tunnel | - | No |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | - | No |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | - | No |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | - | No |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret | - | No |

### Generate Secure JWT Secrets (Production)

For production, generate secure random strings:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# or
openssl rand -hex 64
```

## Docker Setup

### Development with Docker Compose

```bash
docker-compose up -d        # Build and start services
docker-compose logs -f nexus  # View logs
docker-compose down          # Stop services
```

### Production Docker Build

```bash
docker build -t nexus:latest .

docker run -d \
  -p 3001:3001 \
  -p 3002:3002 \
  --env-file .env \
  --name nexus \
  nexus:latest
```

## Redis Setup (Optional)

Redis is only needed for production deployments with multiple relay instances. Local development works without it.

```bash
# macOS (using Homebrew)
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis

# Docker
docker run -d -p 6379:6379 redis:7-alpine
```

Add to `.env`:

```bash
REDIS_URL=redis://localhost:6379
```

## Troubleshooting

### Port Already in Use

```bash
# Find and kill process on port 5173
lsof -ti:5173 | xargs kill -9

# Find and kill process on port 3001
lsof -ti:3001 | xargs kill -9
```

### Node Version Mismatch

```bash
rm -rf node_modules package-lock.json
nvm use
npm install
```

### Build Errors

```bash
rm -rf dist/
npm run build
```

### Database Issues

The SQLite database is stored at `.nexus/nexus.db`. To reset:

```bash
rm .nexus/nexus.db
npm run dev:backend  # Recreates with fresh migrations
```

### Husky Git Hooks Not Working

```bash
npm run prepare
chmod +x .husky/*
```

## Next Steps

After setup is complete:

1. Read the [CONTRIBUTING.md](../CONTRIBUTING.md) guide
2. Review the [Architecture documentation](./ARCHITECTURE.md)
3. Check the [Relay System docs](./architecture/relay-system.md)
4. Read the [Agent Runner Protocol](./guides/agent-runner-protocol.md)
