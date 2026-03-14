# Monitoring & Alerting Setup Guide

How to monitor Astro's production services and get notified when things break. This guide covers three layers of monitoring, all free.

## What We Monitor

| Service | Hosted on | What can go wrong |
|---------|-----------|-------------------|
| Backend API | Fly.io | Crash, OOM, DB connection failure |
| WebSocket Relay | Fly.io (port 3002) | Port blocked, relay crash |
| Frontend | Cloudflare Pages | Build failure, DNS issue |
| Database | Supabase (Postgres) | Connection pool exhaustion, throttling |
| Auth (JWKS) | Supabase Auth | Throttling, key rotation failure |

## Three Layers of Monitoring

```
Layer 1: Fly.io Health Checks (automatic, already configured)
  |-- Pings GET /api/health every 10 seconds
  |-- Auto-restarts crashed machines
  |-- Cost: $0 (included with Fly.io)

Layer 2: UptimeRobot (external, independent)
  |-- Checks backend, frontend, Supabase from outside
  |-- Sends alerts via Telegram/email/Slack
  |-- Cost: $0 (free tier: 50 monitors, 5-min intervals)

Layer 3: Built-in Server Monitoring (internal, Telegram alerts)
  |-- Checks frontend + JWKS from within the Fly.io server
  |-- Sends Telegram alerts on startup/restart
  |-- Sends Telegram alerts when external services are degraded
  |-- Cost: $0 (runs on existing Fly.io machine)
```

Each layer catches different failure modes:
- **Layer 1** catches backend crashes (auto-recovery, no alert needed)
- **Layer 2** catches everything from an external perspective (most robust, detects Fly.io outages)
- **Layer 3** catches Supabase degradation and sends deploy/restart notifications

## Prerequisites: Telegram Bot Setup

All alerting goes through a Telegram group. Set this up first.

### Step 1: Create a Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name (e.g., "Astro Monitor") and username (e.g., `astro_monitor_bot`)
4. BotFather gives you a **bot token** like `7123456789:AAH...`. Save it.

### Step 2: Create a group and add the bot

1. Create a new Telegram group (e.g., "Astro Alerts")
2. Add the bot you just created
3. Add all team members who should receive alerts

### Step 3: Get the group chat ID

Send any message in the group, then run:

```bash
BOT_TOKEN="your-bot-token-here"
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates" | python3 -m json.tool
```

Look for `"chat": {"id": -XXXXXXXXXX}` in the response. The chat ID is a **negative number** for groups.

If you get an empty result, remove the bot from the group, add it back, send a message, and try again.

### Step 4: Test it

```bash
BOT_TOKEN="your-bot-token-here"
CHAT_ID="your-chat-id-here"

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": \"Astro monitoring test - if you see this, it works!\"}"
```

You should see the message appear in the Telegram group.

---

## Layer 1: Fly.io Health Checks (Already Configured)

This is already set up in `fly.toml`:

```toml
[[services]]
  [services.concurrency]
    type = "connections"
    hard_limit = 500
    soft_limit = 200

  [[services.http_checks]]
    interval = 10000        # Check every 10 seconds
    grace_period = "30s"    # Wait 30s after deploy before checking
    method = "get"
    path = "/api/health"
    protocol = "http"
    timeout = 5000
```

**What it does:** Fly.io pings `/api/health` every 10 seconds. If it fails, Fly.io automatically restarts the machine. No configuration needed.

**What it doesn't do:** It doesn't send you alerts. You won't know a restart happened unless you check `fly logs`. That's what the other layers are for.

---

## Layer 2: UptimeRobot (Free External Monitoring)

UptimeRobot monitors your services from external servers around the world. If Fly.io itself goes down, UptimeRobot still detects it.

### Setup (5 minutes)

1. Go to [https://uptimerobot.com](https://uptimerobot.com) and create a free account

2. **Add monitors** (click "Add New Monitor" for each):

   | Monitor name | Type | URL | Interval |
   |---|---|---|---|
   | Astro Backend | HTTP(s) | `https://astro-backend-deploy.fly.dev/api/health` | 5 min |
   | Astro Frontend | HTTP(s) | `https://your-frontend-url.com` | 5 min |
   | Supabase Auth | HTTP(s) | `https://your-project.supabase.co/auth/v1/.well-known/jwks.json` | 5 min |

   For each monitor:
   - Type: `HTTP(s)`
   - Monitoring Interval: `5 minutes` (free tier minimum)
   - Monitor Timeout: `30 seconds`

3. **Set up Telegram alerts:**

   Go to **My Settings** -> **Alert Contacts** -> **Add Alert Contact**:
   - Type: `Telegram`
   - Follow the instructions to connect your Telegram bot

   Alternatively, use the **Webhook** alert type:
   - URL: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/sendMessage`
   - POST body: `{"chat_id":"<YOUR_CHAT_ID>","text":"*monitorFriendlyName* is *alertTypeFriendlyName*","parse_mode":"Markdown"}`

4. **Assign alerts to monitors:** Edit each monitor and check the alert contact you just created.

### What you get for free

- 50 monitors (you only need 3)
- 5-minute check interval
- Email alerts (always free)
- Telegram/webhook alerts (always free)
- 2-month log history
- Public status page (optional)

### Optional: Public status page

UptimeRobot can create a free status page (e.g., `https://stats.uptimerobot.com/your-page`). Useful to share with users or embed in your docs.

---

## Layer 3: Built-in Server Monitoring (Telegram Alerts)

The Astro backend has a built-in monitoring module (`server/lib/monitoring.ts`) that runs inside the Fly.io machine. It:

1. Sends a **startup notification** every time the server starts (deploys, restarts, crashes)
2. Checks **frontend** and **JWKS** availability every 5 minutes
3. Sends **Telegram alerts** on failure (with dedup to avoid alert storms)
4. Sends a **recovery notification** when services come back

### Setup

Add two secrets to Fly.io:

```bash
fly secrets set \
  TELEGRAM_BOT_TOKEN="your-bot-token" \
  TELEGRAM_CHAT_ID="your-chat-id" \
  --app astro-backend-deploy
```

That's it. On next deploy, the server will start sending Telegram notifications.

### What it sends

| Event | When | Example message |
|-------|------|-----------------|
| Server started | Every deploy/restart | "Astro Server Started - Mode: supabase, Host: Fly.io (sjc)" |
| Health check failed | Frontend or JWKS down | "Astro Health Check Failed - Auth (JWKS): down" |
| Recovery | Services back after outage | "Astro Recovered - All services are back online" |
| Status report | Every 8 hours | "Astro Status Report - All systems operational, Uptime: 100.0%" |

### Alert deduplication

To avoid flooding the group chat:
- First failure: alert immediately
- Consecutive failures: alert once per hour (every 12th check at 5-min interval)
- Recovery: one notification when all services are back
- Status report: every 8 hours with uptime percentage, even when everything is healthy

### Limitations

The built-in monitor **cannot detect its own outage**. If the Fly.io machine is down, this monitor is also down. That's why Layer 2 (UptimeRobot) is important — it monitors from outside.

### How to verify it's working

```bash
# Check server logs for monitoring startup
fly logs --app astro-backend-deploy | grep "\[monitor\]"

# Expected:
# [monitor] Health check monitor started (every 5 min, status report every 8 hrs)

# If you see this instead, Telegram is not configured:
# [monitor] Telegram not configured (...) — monitoring disabled
```

### Configuration

The monitoring module reads these env vars:

| Variable | Required | Purpose |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Telegram group chat ID |
| `FRONTEND_URL` or `ASTRO_BASE_URL` | Optional | Frontend URL to health-check (skipped if unset) |
| `SUPABASE_URL` | Optional | Used to check JWKS endpoint (skipped if unset) |

---

## Layer 4 (Backup): GitHub Actions Monitor

A GitHub Actions workflow is included at `.github/workflows/monitor.yml` as a backup option. It runs every 5 minutes and checks the same services.

**Cost:** Free for public repos. For private repos, uses ~1,500 of 2,000 free minutes/month. Only enable this if you need an independent external check and don't want to use UptimeRobot.

### Setup (if you want to enable it)

Add these as GitHub repo secrets (Settings -> Secrets and variables -> Actions):

| Secret | Value |
|--------|-------|
| `MONITOR_BACKEND_URL` | `https://astro-backend-deploy.fly.dev` |
| `MONITOR_FRONTEND_URL` | `https://your-frontend-url.com` |
| `MONITOR_SUPABASE_URL` | `https://your-project.supabase.co` |
| `TELEGRAM_BOT_TOKEN` | Your bot token |
| `TELEGRAM_CHAT_ID` | Your chat ID |

The workflow will start running automatically on the next 5-minute cron tick.

### Disabling it

The workflow won't run unless all secrets are set. To explicitly disable it, delete the workflow file or comment out the `schedule` trigger.

---

## Deploy Notifications

Add Telegram deploy notifications by setting `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in your `.env` (or `.env.prod`). The deploy script can be extended to send a notification, but the built-in server monitoring already sends a "Server Started" message on every deploy — so you get deploy notifications for free.

---

## Supabase Usage Monitoring

Supabase doesn't expose egress metrics via API on the Pro plan. Monitor usage manually:

1. **Weekly check**: Go to Supabase Dashboard -> Reports -> Usage
2. **What to look for**:
   - Egress: Should be well under 250 GB/month (Pro) after the ES256 JWT fix
   - Auth requests: Should be low (most auth is now local JWT verification)
   - Database size: Monitor growth over time

If auth requests spike (>5,000/hour), it likely means JWKS verification is failing and the server is falling back to Supabase API calls. Check `fly logs | grep "[auth] JWKS"`.

---

## Alert Escalation

| Severity | Condition | Who detects it | Action |
|----------|-----------|---------------|--------|
| Auto-recovery | Backend crash | Fly.io health check | Auto-restart (no action needed) |
| Critical | Backend down >1 min | UptimeRobot | Telegram alert -> check Fly.io dashboard |
| Critical | Frontend down | UptimeRobot | Telegram alert -> check Cloudflare Pages |
| Warning | JWKS unreachable | Built-in monitor | Telegram alert (auth falls back to API, egress rises) |
| Info | Server restart | Built-in monitor | Telegram notification (informational) |
| Weekly | Supabase usage | Manual | Check dashboard |

---

## Quick Reference

### Minimum setup (5 minutes)

1. Create Telegram bot + group (see Prerequisites above)
2. Add `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` to Fly.io secrets
3. Deploy — you now get startup/restart and health check alerts

### Recommended setup (15 minutes)

1. Everything in minimum setup
2. Create UptimeRobot account, add 3 monitors (backend, frontend, JWKS)
3. Connect UptimeRobot to Telegram alerts

### Full setup (30 minutes)

1. Everything in recommended setup
2. Add GitHub Actions secrets (backup monitor)
3. Set up UptimeRobot public status page

---

## Rotating the Bot Token

If your bot token is ever leaked (e.g., shared in a chat log, committed to git), rotate it immediately:

1. Message **@BotFather** on Telegram
2. Send `/revoke`
3. Select your bot
4. BotFather gives you a new token

Then update the Fly.io secret:

```bash
fly secrets set TELEGRAM_BOT_TOKEN="new-token-here" --app astro-backend-deploy
```

Fly.io restarts the machine automatically. The new token takes effect immediately.

## Switching from DM to Group Alerts

If you initially set up alerts to your personal DM and later want a group so teammates see alerts too:

1. Create a Telegram group (e.g., "Astro Alerts")
2. Add the bot to the group
3. Add all teammates
4. Disable bot privacy mode: message @BotFather -> `/setprivacy` -> select bot -> `Disable`
5. Send any message in the group
6. Get the group chat ID:

   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | python3 -m json.tool
   # Look for "chat": {"id": -XXXXXXXXXX} — group IDs are negative numbers
   ```

7. Update the Fly.io secret:

   ```bash
   fly secrets set TELEGRAM_CHAT_ID="-XXXXXXXXXX" --app astro-backend-deploy
   ```

Both DM and group alerts work — the only difference is who sees them. You can switch at any time by updating `TELEGRAM_CHAT_ID`.

---

## Troubleshooting

### "Telegram not configured" in server logs

Check that `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in Fly.io secrets:

```bash
fly secrets list --app astro-backend-deploy | grep TELEGRAM
```

### Bot doesn't send messages

1. Make sure the bot is added to the group
2. Verify the chat ID is correct (negative number for groups)
3. Test manually with curl (see Step 4 in Prerequisites)
4. Check if the bot was kicked from the group

### UptimeRobot shows "down" but the site works

UptimeRobot checks from external servers. Possible causes:
- Transient network issue (wait for next check)
- Fly.io is doing a rolling deploy (brief downtime during machine swap)
- DNS propagation issue

### Health checks pass but users can't log in

The health endpoint (`/api/health`) doesn't test the full auth flow. Check:
- JWKS endpoint availability: `curl -s https://<supabase-url>/auth/v1/.well-known/jwks.json`
- Supabase dashboard for throttling or outage notices
- `fly logs --app <app> | grep "[auth]"` for JWT verification errors

## Related Documentation

- [Fly Deployment](../setup/fly-deployment.md) -- Debugging, logs, SSH
- [Supabase Production](../setup/supabase-production.md) -- Egress, billing, JWT
- [Security Checklist](../setup/security-checklist.md) -- Post-deployment monitoring
