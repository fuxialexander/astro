# Multi-User Setup Guide (Self-Hosted Supabase)

This guide sets up Nexus with self-hosted Supabase for multi-user authentication and makes it accessible outside your local network via Cloudflare Tunnel.

> **About Database Modes**
>
> Nexus supports two operational modes:
>
> | Mode | Auth | Users | Storage | Best For |
> |------|------|-------|---------|----------|
> | **IndexedDB** | None | Single | Browser only | Local dev, prototyping |
> | **Supabase** (this guide) | WebAuthn | Multi | PostgreSQL + cache | Production, teams |
>
> **Switching Modes:**
> - IndexedDB: `npm run dev:indexeddb` (no setup needed)
> - Supabase: Follow this guide
>
> See [README.md - Database Modes](README.md#database-modes) for detailed comparison.

## Prerequisites

- **Docker Desktop** running (for Supabase containers)
- **cloudflared** installed and authenticated
  ```bash
  brew install cloudflared  # macOS
  cloudflared tunnel login  # One-time authentication
  ```
- **CLOUDFLARED_DOMAIN** configured in `.env`
  ```bash
  echo "CLOUDFLARED_DOMAIN=yourdomain.com" >> .env
  ```
- **jq** installed (for parsing JSON)
  ```bash
  brew install jq  # macOS
  ```

## Step 1: Set Up Self-Hosted Supabase

Run the automated setup script:

```bash
bash ./scripts/setup-supabase-local.sh
```

This will:
1. ✅ Install Supabase CLI (if needed)
2. ✅ Initialize Supabase in your project
3. ✅ Start Supabase Docker containers (PostgreSQL, PostgREST, Auth, etc.)
4. ✅ Run the database migration (creates all tables + RLS policies)
5. ✅ Update `.env.local` with Supabase credentials
6. ✅ Configure WebAuthn for passkey authentication

**What gets installed:**
- PostgreSQL database (port 54322)
- PostgREST API server (port 54321)
- Supabase Auth server (handles passkey authentication)
- Supabase Studio (web dashboard at http://localhost:54323)
- Realtime server (for live updates)

After setup completes, you'll see:
```
Studio (Dashboard): http://localhost:54323
API URL: http://localhost:54321
Anon Key (public): eyJhbGciOiJIUzI1...
Service Role Key (secret): eyJhbGciOiJIUzI1...
```

## Step 2: Start Nexus Backend

In a new terminal:

```bash
npm run dev:backend
```

This starts:
- Hono API server (port 3001)
- WebSocket relay (port 3002)

## Step 3: Expose Services via Cloudflare Tunnel

In another terminal:

```bash
bash ./scripts/start-tunnel-with-supabase.sh
```

This exposes:
- `https://nexus.yourdomain.com` → Frontend app (port 5173)
- `https://nexus-api.yourdomain.com` → Nexus backend (port 3001)
- `https://nexus-relay.yourdomain.com` → WebSocket relay (port 3002)
- `https://nexus-supabase.yourdomain.com` → Supabase API (port 54321)

The script automatically updates `.env.local` with external URLs:
```
VITE_SUPABASE_URL=https://nexus-supabase.yourdomain.com
WEBAUTHN_RP_ID=yourdomain.com
WEBAUTHN_ORIGIN=https://nexus-api.yourdomain.com
```

## Step 4: Start Frontend

In yet another terminal:

```bash
npm run dev:frontend
```

Frontend runs at http://localhost:5173

## Step 5: Create First User

1. Visit http://localhost:5173
2. You'll be redirected to `/login`
3. Click **"Sign up"**
4. Enter:
   - **Name**: Your name
   - **Email**: your@email.com
5. Click **"Create Passkey"**
6. Browser will prompt for biometric/PIN
7. Passkey is created and stored in Supabase
8. You're logged in and redirected to dashboard!

## Step 6: External Access (for other users)

Share this URL with external users: **`https://nexus.yourdomain.com`**

They can:
1. Create their own account (passkey sign-up)
2. Create projects (isolated by user)
3. Connect their own machines via device auth
4. Everything is properly scoped by `user_id`

**Note**: They access the same app as you, but see only their own data thanks to Row Level Security.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    External Users                            │
│            https://nexus-api.yourdomain.com                  │
└────────────────────────┬─────────────────────────────────────┘
                         │ Cloudflare Tunnel (TLS)
┌────────────────────────┴─────────────────────────────────────┐
│                    Your Local Machine                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Frontend   │  │    Backend   │  │   Supabase   │       │
│  │  :5173       │  │   :3001      │  │   :54321     │       │
│  │  (Vite)      │  │   (Hono)     │  │  (Docker)    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                         │                    │                │
│                         │                    │                │
│                    ┌────┴────────────────────┴───┐            │
│                    │      PostgreSQL DB          │            │
│                    │  (User data, Projects)      │            │
│                    └─────────────────────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

## User Isolation

Row Level Security (RLS) policies ensure users only see their own data:

```sql
-- Users can only view their own projects
create policy "Users can view own/member projects"
  on projects for select using (user_has_project_access(id));

-- Users can only see their own machines
create policy "Users can view own machines"
  on registered_machines for select using (user_id = auth.uid());
```

Each user gets:
- ✅ Isolated projects
- ✅ Isolated machines
- ✅ Isolated task executions
- ✅ Isolated chat history
- ✅ Isolated usage metrics

**Project Sharing** (coming soon):
- Add team members to projects (owner/editor/viewer roles)
- Shared project access via `project_members` table

## Managing Supabase

```bash
# View status
supabase status

# Stop all services
supabase stop

# Start services
supabase start

# View logs
supabase logs

# Access database directly
supabase db diff

# Access Studio (dashboard)
open http://localhost:54323
```

## Troubleshooting

### "Docker is not running"
Start Docker Desktop and try again.

### "Supabase is not running on localhost:54321"
Run: `supabase start`

### "cloudflared tunnel login" not working
Make sure you have a Cloudflare account and run:
```bash
cloudflared tunnel login
```

### WebAuthn passkey creation fails
Check that `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` are correct in `.env.local`:
- For local: `localhost` and `http://localhost:5173`
- For external: `yourdomain.com` and `https://nexus-api.yourdomain.com`

### Users can't create passkeys from external domain
The tunnel script automatically updates WebAuthn config. Restart the backend after running the tunnel script:
```bash
# Stop backend (Ctrl+C)
npm run dev:backend  # Restart
```

## Cost

**Self-hosted Supabase**: $0 (runs on your machine)
- Uses ~500MB RAM
- ~2GB disk space for Docker images
- Free indefinitely

**Cloudflare Tunnel**: $0 (included in free tier)

**Total**: $0 for unlimited users! 🎉

## Production Deployment

For true production (not running on your local machine), consider:
1. **Deploy Supabase to cloud**: Use Supabase Cloud (free tier available)
2. **Deploy backend to Fly.io**: ~$5/month
3. **Deploy frontend to Cloudflare Pages**: Free

See [`README.md`](README.md) "Deployment Considerations" section for details.

## Next Steps

- [ ] Create your first user
- [ ] Create a project with AI planning
- [ ] Connect remote machines via device auth
- [ ] Invite team members (share the domain)
- [ ] Test project isolation between users
- [ ] Set up backups (`supabase db dump`)
