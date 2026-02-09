# Nexus Setup Guide

This guide provides comprehensive instructions for setting up the Nexus development environment.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
- [Docker Setup](#docker-setup)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Redis Setup](#redis-setup)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have the following installed:

### Required

- **Node.js**: v25.6.0 or higher
  - Recommended: Use [nvm](https://github.com/nvm-sh/nvm) for version management
  - The project includes `.nvmrc` file for automatic version switching
- **npm**: v11.8.0 or higher (comes with Node.js)
- **Git**: Latest stable version
- **Redis**: v7.0 or higher (for production deployment)

### Optional

- **Docker**: For containerized development and deployment
- **Docker Compose**: For multi-container orchestration
- **VS Code**: Recommended editor with extensions listed in `.vscode/extensions.json`

## Quick Start

For a fast setup, run these commands:

```bash
# Clone the repository
git clone git@github.com:fuxialexander/nexus.git
cd nexus

# Use correct Node.js version (if using nvm)
nvm use

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# Required: Set ANTHROPIC_API_KEY and database credentials

# Run verification script
npm run verify

# Start development server
npm run dev
```

Your application should now be running:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

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

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and configure the following variables:

#### Essential Configuration

```bash
# Server Configuration
NODE_ENV=development
PORT=3001
RELAY_PORT=3002

# Base URLs
NEXUS_BASE_URL=http://localhost:5173
API_BASE_URL=http://localhost:3001
RELAY_WS_URL=ws://localhost:3002

# CORS
CORS_ORIGIN=http://localhost:5173

# JWT Secrets (CHANGE THESE!)
AUTH_JWT_SECRET=your-secret-key-here-change-in-production
AUTH_REFRESH_SECRET=your-refresh-secret-key-here-change-in-production
DEVICE_AUTH_JWT_SECRET=your-device-secret-key-here-change-in-production
DEVICE_AUTH_REFRESH_SECRET=your-device-refresh-secret-key-here-change-in-production

# Anthropic API
ANTHROPIC_API_KEY=your-anthropic-api-key
```

#### Generate Secure JWT Secrets

For production, generate secure random strings:

```bash
# On macOS/Linux
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Or use openssl
openssl rand -hex 64
```

### 5. Database Setup (Supabase)

The project uses Supabase for authentication and data storage.

#### Option A: Use Supabase Cloud

1. Create a Supabase project at https://supabase.com
2. Get your project URL and anon key from Settings > API
3. Add to `.env`:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

#### Option B: Self-hosted Supabase

```bash
# Start Supabase locally
cd supabase
supabase start
```

### 6. Redis Setup (Optional)

Redis is required for production deployment but optional for development.

#### For Development

The application will use in-memory storage if Redis is not available.

#### For Production

Install Redis:

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

### 7. Verify Setup

Run the verification script to check your setup:

```bash
npm run verify
```

This will check:
- Node.js and npm versions
- Required files and directories
- Dependencies installation
- Port availability
- Configuration files

### 8. Start Development Server

```bash
# Start both frontend and backend
npm run dev

# Or start them separately
npm run dev:frontend  # Frontend only (port 5173)
npm run dev:backend   # Backend only (port 3001)
```

## Docker Setup

### Development with Docker Compose

```bash
# Build and start services
docker-compose up -d

# View logs
docker-compose logs -f nexus

# Stop services
docker-compose down
```

### Production Docker Build

```bash
# Build image
docker build -t nexus:latest .

# Run container
docker run -d \
  -p 3001:3001 \
  -p 3002:3002 \
  --env-file .env \
  --name nexus \
  nexus:latest
```

## Environment Variables

### Complete Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | `development` | No |
| `PORT` | Backend server port | `3001` | No |
| `RELAY_PORT` | WebSocket relay port | `3002` | No |
| `NEXUS_BASE_URL` | Frontend base URL | `http://localhost:5173` | Yes |
| `API_BASE_URL` | Backend API base URL | `http://localhost:3001` | Yes |
| `RELAY_WS_URL` | WebSocket URL | `ws://localhost:3002` | Yes |
| `CORS_ORIGIN` | CORS allowed origin | `http://localhost:5173` | Yes |
| `AUTH_JWT_SECRET` | JWT signing secret | - | Yes |
| `AUTH_REFRESH_SECRET` | Refresh token secret | - | Yes |
| `DEVICE_AUTH_JWT_SECRET` | Device JWT secret | - | Yes |
| `DEVICE_AUTH_REFRESH_SECRET` | Device refresh secret | - | Yes |
| `ANTHROPIC_API_KEY` | Anthropic API key | - | Yes |
| `SUPABASE_URL` | Supabase project URL | - | Yes |
| `SUPABASE_ANON_KEY` | Supabase anon key | - | Yes |
| `REDIS_URL` | Redis connection URL | - | No (dev) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | - | No |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | - | No |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | - | No |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret | - | No |

## Troubleshooting

### Port Already in Use

If you see "Port already in use" errors:

```bash
# Find and kill process on port 5173
lsof -ti:5173 | xargs kill -9

# Find and kill process on port 3001
lsof -ti:3001 | xargs kill -9
```

### Node Version Mismatch

If you encounter version-related issues:

```bash
# Remove node_modules and reinstall
rm -rf node_modules package-lock.json
nvm use
npm install
```

### Build Errors

If you encounter build errors:

```bash
# Clear cache and rebuild
npm run clean  # If available
rm -rf dist/
npm run build
```

### Redis Connection Issues

If Redis connection fails in production:

```bash
# Check Redis status
redis-cli ping  # Should return PONG

# Check Redis connection
redis-cli
> INFO server
```

### Database Migration Issues

```bash
# Reset local database (CAUTION: This will delete all data)
cd supabase
supabase db reset

# Run migrations manually
supabase migration up
```

### VS Code Issues

If VS Code doesn't recognize TypeScript or imports:

1. Open Command Palette (Cmd/Ctrl + Shift + P)
2. Run "TypeScript: Restart TS Server"
3. Ensure workspace TypeScript version is used

### Husky Git Hooks Not Working

```bash
# Reinstall Husky
npm run prepare

# Make hooks executable
chmod +x .husky/*
```

## Next Steps

After setup is complete:

1. Read the [CONTRIBUTING.md](../CONTRIBUTING.md) guide
2. Explore the [API documentation](./API.md)
3. Review the [Architecture documentation](./ARCHITECTURE.md)
4. Check out [example tasks](./EXAMPLES.md)

## Getting Help

- Open an issue: https://github.com/fuxialexander/nexus/issues
- Check existing issues and discussions
- Review the documentation in the `docs/` directory

## Additional Resources

- [React Documentation](https://react.dev/)
- [Vite Documentation](https://vite.dev/)
- [Hono Documentation](https://hono.dev/)
- [Supabase Documentation](https://supabase.com/docs)
- [Redis Documentation](https://redis.io/docs/)
