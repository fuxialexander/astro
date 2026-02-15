# Multi-User Setup - Quick Start

Get Nexus running with multi-user authentication in 5 minutes.

> **Note**: Nexus supports two modes:
> - **IndexedDB Mode** (default): No authentication, local-only, perfect for rapid development
> - **Supabase Mode** (this guide): Multi-user with authentication, server-backed storage
>
> To run in IndexedDB mode instead: `npm run dev:indexeddb`
>
> See [README.md - Database Modes](README.md#database-modes) for comparison.

## Prerequisites

```bash
# Install dependencies
brew install cloudflared jq  # macOS

# Start Docker Desktop
open -a Docker

# Authenticate cloudflared (one-time)
cloudflared tunnel login

# Set your domain
echo "CLOUDFLARED_DOMAIN=yourdomain.com" >> .env
```

## Setup (3 commands)

### 1. Set up Supabase
```bash
bash ./scripts/setup-supabase-local.sh
```
⏱️ Takes 2-3 minutes on first run (downloads Docker images)

### 2. Start Nexus backend
```bash
npm run dev:backend
```
Keep this terminal open

### 3. Start Cloudflare tunnel (new terminal)
```bash
bash ./scripts/start-tunnel-with-supabase.sh
```
Keep this terminal open

### 4. Start frontend (new terminal)
```bash
npm run dev:frontend
```

## Done! 🎉

- **Local**: http://localhost:5173
- **External**: https://nexus.yourdomain.com
- **Admin**: http://localhost:54323 (Supabase Studio)

## Create Your First User

1. Visit http://localhost:5173
2. Click "Sign up"
3. Enter name + email
4. Click "Create Passkey"
5. Use Touch ID / Face ID / PIN
6. Start creating projects!

## Share with Others

Send them: **`https://nexus.yourdomain.com`**

They can:
- Create their own account (passkey)
- See only their own projects/data (RLS enforced)
- Connect their own machines
- Use the full app just like you!

## Stop Services

```bash
# Stop backend/frontend (Ctrl+C in each terminal)
# Stop tunnel (Ctrl+C)
# Stop Supabase
supabase stop
```

## Restart Later

```bash
# Start Supabase
supabase start

# Start everything else
npm run dev:backend    # Terminal 1
bash ./scripts/start-tunnel-with-supabase.sh  # Terminal 2
npm run dev:frontend   # Terminal 3
```

## Need Help?

See full guide: [SETUP_MULTI_USER.md](SETUP_MULTI_USER.md)
