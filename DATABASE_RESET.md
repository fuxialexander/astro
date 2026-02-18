# Database Reset Guide

This guide explains how to completely reset your Astro database and start with a clean slate.

## Overview

Astro supports **two database modes**:

1. **IndexedDB Mode** (default for local dev)
   - Data stored in browser IndexedDB
   - No authentication required
   - Single-user only

2. **Supabase Mode** (multi-user production)
   - PostgreSQL database with RLS
   - WebAuthn/passkey authentication
   - Multi-user with data isolation

## Quick Reset Commands

### Reset Everything (Recommended for Clean Start)

```bash
npm run db:reset
```

This will:
- Reset Supabase database (if running)
- Show instructions to clear browser IndexedDB

### Reset Only Supabase Database

```bash
npm run db:reset:supabase
```

Drops and recreates the PostgreSQL database, re-running all migrations.

### Show IndexedDB Reset Instructions

```bash
npm run db:reset:indexeddb
```

Displays step-by-step instructions to clear browser storage.

## Detailed Reset Methods

### Method 1: Browser-Based Reset (IndexedDB Only)

#### Option A: Visual Interface (Easiest)

1. **Start your dev server:**
   ```bash
   npm run dev
   ```

2. **Navigate to the reset page:**
   ```
   http://localhost:5173/reset-indexeddb.html
   ```

3. **Click "Reset Everything"**
   - View storage statistics
   - One-click database deletion
   - Automatic redirect after completion

#### Option B: Browser DevTools

1. Open http://localhost:5173
2. Open DevTools:
   - **Chrome/Edge:** `F12` or `Cmd+Option+I` (Mac) / `Ctrl+Shift+I` (Windows/Linux)
   - **Firefox:** `F12` or `Cmd+Option+I` (Mac) / `Ctrl+Shift+I` (Windows/Linux)
   - **Safari:** `Cmd+Option+C` (Mac, enable Develop menu first)

3. Go to **Application** tab (Chrome/Edge) or **Storage** tab (Firefox)

4. In the left sidebar:
   - Expand **IndexedDB**
   - Right-click on the Astro database
   - Click **Delete database**

5. Expand **Local Storage** → `http://localhost:5173`
   - Click **Clear All** or delete individual keys

6. Refresh the page (`Cmd+R` / `Ctrl+R`)

#### Option C: Browser Console (Quick)

1. Open http://localhost:5173
2. Open Console (`F12` → Console tab)
3. Paste and run this code:

```javascript
// Delete all IndexedDB databases
indexedDB.databases().then(dbs => {
  dbs.forEach(db => {
    indexedDB.deleteDatabase(db.name);
    console.log('Deleted:', db.name);
  });
});

// Clear localStorage
localStorage.clear();
console.log('localStorage cleared');

// Reload page
setTimeout(() => location.reload(), 500);
```

4. The page will refresh automatically with clean storage

#### Option D: Incognito/Private Window (Testing)

1. Open a new Incognito/Private window
2. Navigate to http://localhost:5173
3. This starts with completely fresh storage (no reset needed)

### Method 2: Supabase Database Reset

#### Prerequisites

- Supabase CLI installed (`brew install supabase/tap/supabase`)
- Docker Desktop running

#### Reset Commands

**Full reset (drops all tables, re-runs migrations):**
```bash
supabase db reset
```

**Or use the npm script:**
```bash
npm run db:reset:supabase
```

#### What This Does

1. Stops the local Supabase instance
2. Destroys the PostgreSQL database
3. Creates a fresh database
4. Re-applies all migrations from `supabase/migrations/`
5. Restarts Supabase services

#### Manual Alternative

If the automated reset fails, you can manually:

```bash
# Stop Supabase
supabase stop

# Remove all Docker volumes (DANGER: deletes ALL data)
docker volume prune -f

# Start fresh
bash scripts/setup-supabase-local.sh
```

### Method 3: Complete Clean Start

For a **completely fresh environment** (including dependencies):

```bash
bash scripts/clean-start.sh
```

This script will:
1. Stop all running processes
2. Clean agent runner cache (`~/.astro-agent`)
3. Remove and reinstall node_modules
4. Clean build artifacts
5. Rebuild the project
6. Reset Supabase database

**⚠️ Warning:** This is a heavy operation (~2-5 minutes) and requires re-downloading all npm packages.

## Verification

### IndexedDB Mode

After resetting IndexedDB:

1. Visit http://localhost:5173
2. You should see the Welcome screen (if configured)
3. Or an empty dashboard with no projects

### Supabase Mode

After resetting Supabase:

1. Visit http://localhost:5173
2. You should be redirected to `/login`
3. Register a new user with WebAuthn/passkey
4. Create your first project

## Troubleshooting

### "Database is blocked" Error

**Problem:** IndexedDB deletion fails with "blocked" error

**Solution:** Close ALL browser tabs/windows accessing Astro, then try again

### Supabase Reset Hangs

**Problem:** `supabase db reset` hangs or times out

**Solution:**
```bash
# Force stop
supabase stop

# Start fresh
supabase start

# Try reset again
supabase db reset
```

### "Permission Denied" on Scripts

**Problem:** Script execution fails with permission error

**Solution:**
```bash
chmod +x scripts/reset-database.sh
chmod +x scripts/clean-start.sh
```

### Data Still Appears After Reset

**Problem:** Old data still shows after IndexedDB reset

**Cause:** Multiple browser profiles or service workers caching data

**Solution:**
1. Hard refresh: `Cmd+Shift+R` (Mac) / `Ctrl+Shift+F5` (Windows/Linux)
2. Clear browser cache in DevTools → Application → Clear storage
3. Try incognito/private mode to verify

### Migrations Fail After Reset

**Problem:** Supabase migrations fail to apply

**Solution:**
```bash
# Check migration files
ls -la supabase/migrations/

# Verify migration syntax
supabase db lint

# Reset with verbose logging
supabase db reset --debug
```

## Best Practices

### Development Workflow

1. **Use IndexedDB mode** for rapid iteration:
   ```bash
   npm run dev:indexeddb
   ```

2. **Reset via browser** when you need a clean slate:
   - Visit http://localhost:5173/reset-indexeddb.html
   - Click "Reset Everything"

3. **Test multi-user features** in Supabase mode:
   ```bash
   npm run dev:supabase
   ```

### Before Sharing

Before sharing your development environment or screenshots:

1. Reset the database to remove test data
2. Create clean sample projects
3. Verify no sensitive information remains

### Testing Migrations

When testing new Supabase migrations:

1. Create a new migration:
   ```bash
   supabase migration new my_feature
   ```

2. Edit the migration file in `supabase/migrations/`

3. Test it:
   ```bash
   supabase db reset  # Applies all migrations fresh
   ```

4. Verify the schema:
   ```bash
   supabase db diff  # Check for drift
   ```

## Recovery

### I Accidentally Deleted Important Data

**IndexedDB Mode:**
- **No recovery available** — browser storage has no backup
- Consider committing to version control or exporting projects regularly

**Supabase Mode:**
- If using production Supabase (cloud), check the Supabase dashboard for backups
- Local development database has no automatic backups

**Prevention:**
- Use git to version control important project configurations
- Export critical data before major resets
- Consider running tests in incognito mode

## Environment-Specific Notes

### macOS

- Supabase CLI: `brew install supabase/tap/supabase`
- Chrome/Edge IndexedDB location: `~/Library/Application Support/Google/Chrome/Default/IndexedDB/`
- Safari IndexedDB location: `~/Library/Safari/Databases/`

### Linux

- Supabase CLI: Download from https://github.com/supabase/cli/releases
- Chrome IndexedDB location: `~/.config/google-chrome/Default/IndexedDB/`
- Firefox IndexedDB location: `~/.mozilla/firefox/<profile>/storage/default/`

### Windows

- Supabase CLI: Download from https://github.com/supabase/cli/releases
- Chrome IndexedDB location: `%LocalAppData%\Google\Chrome\User Data\Default\IndexedDB\`
- Edge IndexedDB location: `%LocalAppData%\Microsoft\Edge\User Data\Default\IndexedDB\`

## Additional Resources

- [IndexedDB API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [Supabase CLI Documentation](https://supabase.com/docs/guides/cli)
- [Astro Setup Guide](./README.md)
- [Testing Documentation](./scripts/README.md)
