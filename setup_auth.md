# Supabase & Auth Setup Guide

## 1. Create a Supabase Project

Go to [supabase.com](https://supabase.com) and create a new project. Note down:
- **Project URL** (e.g., `https://xxxx.supabase.co`)
- **Anon key** (public, safe for frontend)
- **Service role key** (secret, backend only)

## 2. Run the Schema Migration

In the Supabase dashboard SQL Editor, paste and run the contents of:
```
supabase/migrations/20260209000000_initial_schema.sql
```

Or if using the Supabase CLI:
```bash
supabase db push
```

## 3. Set Environment Variables

**Frontend** — create `.env.local` in the project root:
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...your-anon-key
```

**Backend** — same `.env.local` or export in your shell:
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbG...your-anon-key
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...your-service-role-key
```

**WebAuthn** (for passkeys):
```
WEBAUTHN_RP_NAME=Nexus
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:5173
```

For production, change `WEBAUTHN_RP_ID` to your domain and `WEBAUTHN_ORIGIN` to `https://yourdomain.com`.

## 4. Enable Realtime

In Supabase Dashboard > Database > Replication, ensure these tables have Realtime enabled:
- `projects`
- `plan_nodes`
- `plan_edges`
- `task_executions`
- `registered_machines`

(The migration already adds them to `supabase_realtime`, but verify in the dashboard.)

## 5. Restart Dev Server

```bash
npm run dev
```

Now:
- The **AuthGuard** will enforce login (redirect to `/login` if no session)
- **Passkey sign-up**: Enter email + name -> browser creates a passkey -> stored in Supabase
- **Passkey sign-in**: Browser prompts for existing passkey -> verified server-side
- All stores read/write to **Supabase first**, with IndexedDB as offline cache
- **Realtime** subscriptions push changes across tabs/devices

## 6. First User Flow

1. Go to `/login` -> click "Sign up"
2. Enter email + name -> click "Create Passkey"
3. Browser shows passkey prompt -> confirm with biometrics/PIN
4. Supabase creates user + stores credential -> redirects to dashboard
5. All data now persists in PostgreSQL

## Optional: Local Supabase (no cloud)

```bash
npx supabase init   # if not already done
npx supabase start  # spins up local Docker containers
```

This gives you a local Supabase at `http://127.0.0.1:54321` with the anon/service keys printed in the terminal. Use those in your `.env.local`.
