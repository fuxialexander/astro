# Monitoring & Alerting

Strategy for monitoring Astro's production services and getting notified when things break.

## Services to Monitor

| Service | Hosted on | Health endpoint | What can go wrong |
|---------|-----------|----------------|-------------------|
| Backend API | Fly.io | `GET /api/health` | Crash, OOM, DB connection failure |
| WebSocket Relay | Fly.io (port 3002) | WebSocket handshake | Port blocked, relay crash |
| Frontend | Cloudflare Pages | HTTP 200 on root URL | Build failure, DNS issue |
| Database | Supabase (Postgres) | Backend health check includes DB | Connection pool exhaustion, throttling |
| Auth | Supabase Auth | JWKS endpoint availability | Throttling, key rotation failure |

## Approach: Lightweight Heartbeat Monitor

The simplest effective approach is a standalone process that periodically checks each service and sends alerts to a Telegram group when something is wrong.

### Why Telegram

- Free, no per-message cost
- Group chats notify all collaborators simultaneously
- Bot API is a single HTTP POST (no SDK needed)
- Works on all platforms (phone, desktop, web)

### Architecture options

| Option | Pros | Cons | Cost |
|--------|------|------|------|
| **Separate Fly.io machine** | Always on, independent of main app | Extra $3-5/month | Low |
| **Cron job on local machine** | Free, simple | Only runs when machine is on | Free |
| **GitHub Actions scheduled workflow** | Free (within limits), no infra | 5-min minimum interval, cold start | Free |
| **Built into Astro backend** | No extra infra | Can't monitor itself if it's down | Free |

**Recommended**: GitHub Actions for basic checks (free, reliable, independent). Upgrade to a dedicated Fly.io machine if you need sub-minute checks or log analysis.

### What to check

#### Health checks (every 5 minutes)

```bash
# Backend API
curl -sf https://<fly-app>.fly.dev/api/health | jq -e '.status == "ok"'

# Frontend (just check it loads)
curl -sf -o /dev/null https://<frontend-url>/

# JWKS endpoint (auth key availability)
curl -sf https://<supabase-url>/auth/v1/.well-known/jwks.json | jq -e '.keys | length > 0'

# Supabase DB (via backend health)
curl -sf https://<fly-app>.fly.dev/api/health | jq -e '.authenticated == true'
```

#### Usage checks (every hour or daily)

- Supabase egress: Check via Supabase Management API or dashboard
- Connected agent runners: `GET /api/health` returns runner count
- Error rate in logs: `fly logs --app <app> | grep -c "ERROR"`

### Telegram Bot Setup

1. **Create a bot**: Message `@BotFather` on Telegram, send `/newbot`, follow prompts. Save the bot token.

2. **Create a group**: Create a Telegram group, add the bot, add all collaborators.

3. **Get the chat ID**: Send a message in the group, then:
   ```bash
   curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getUpdates" | jq '.result[-1].message.chat.id'
   ```

4. **Send a test message**:
   ```bash
   curl -s -X POST "https://api.telegram.org/bot<BOT_TOKEN>/sendMessage" \
     -H "Content-Type: application/json" \
     -d '{"chat_id": "<CHAT_ID>", "text": "Astro monitoring bot is online.", "parse_mode": "Markdown"}'
   ```

5. **Store secrets**: Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to your monitoring environment (GitHub Actions secrets, Fly.io secrets, or local env).

### GitHub Actions Monitor (Recommended Starting Point)

Create `.github/workflows/monitor.yml`:

```yaml
name: Service Monitor
on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
  workflow_dispatch: {}      # Manual trigger

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check backend health
        id: backend
        continue-on-error: true
        run: |
          RESPONSE=$(curl -sf --max-time 10 "${{ secrets.BACKEND_URL }}/api/health" 2>&1) || {
            echo "status=down" >> $GITHUB_OUTPUT
            echo "error=$RESPONSE" >> $GITHUB_OUTPUT
            exit 0
          }
          STATUS=$(echo "$RESPONSE" | jq -r '.status')
          RUNNERS=$(echo "$RESPONSE" | jq -r '.relay.connectedRunners // 0')
          echo "status=$STATUS" >> $GITHUB_OUTPUT
          echo "runners=$RUNNERS" >> $GITHUB_OUTPUT

      - name: Check frontend
        id: frontend
        continue-on-error: true
        run: |
          curl -sf --max-time 10 -o /dev/null "${{ secrets.FRONTEND_URL }}" || {
            echo "status=down" >> $GITHUB_OUTPUT
            exit 0
          }
          echo "status=ok" >> $GITHUB_OUTPUT

      - name: Check JWKS endpoint
        id: jwks
        continue-on-error: true
        run: |
          curl -sf --max-time 10 "${{ secrets.SUPABASE_URL }}/auth/v1/.well-known/jwks.json" | jq -e '.keys | length > 0' > /dev/null || {
            echo "status=down" >> $GITHUB_OUTPUT
            exit 0
          }
          echo "status=ok" >> $GITHUB_OUTPUT

      - name: Alert on failure
        if: steps.backend.outputs.status != 'ok' || steps.frontend.outputs.status != 'ok' || steps.jwks.outputs.status != 'ok'
        run: |
          MSG="*Astro Alert*%0A"
          MSG+="Backend: ${{ steps.backend.outputs.status }}%0A"
          MSG+="Frontend: ${{ steps.frontend.outputs.status }}%0A"
          MSG+="JWKS: ${{ steps.jwks.outputs.status }}%0A"
          MSG+="Runners: ${{ steps.backend.outputs.runners }}%0A"
          MSG+="Time: $(date -u '+%Y-%m-%d %H:%M UTC')"

          curl -s -X POST "https://api.telegram.org/bot${{ secrets.TELEGRAM_BOT_TOKEN }}/sendMessage" \
            -H "Content-Type: application/json" \
            -d "{\"chat_id\": \"${{ secrets.TELEGRAM_CHAT_ID }}\", \"text\": \"$MSG\", \"parse_mode\": \"Markdown\"}"
```

Required GitHub Actions secrets:
- `BACKEND_URL` (e.g., `https://astro-backend-deploy.fly.dev`)
- `FRONTEND_URL` (e.g., `https://astro-app-3vo.pages.dev`)
- `SUPABASE_URL` (e.g., `https://sizwiiieeggeyhqvirtl.supabase.co`)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

### Deploy / Restart Notifications

Fly.io doesn't have built-in webhook notifications, but you can add deploy alerts to the deploy script.

Add to `scripts/deploy.sh` (after successful deploy):

```bash
# Send Telegram notification on successful deploy
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  DEPLOY_MSG="Astro deployed successfully.%0ABranch: $(git branch --show-current)%0ACommit: $(git log -1 --format='%h %s')%0ATime: $(date -u '+%Y-%m-%d %H:%M UTC')"
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"${TELEGRAM_CHAT_ID}\", \"text\": \"${DEPLOY_MSG}\", \"parse_mode\": \"Markdown\"}" > /dev/null
fi
```

### Log-Based Alerts (Future Enhancement)

For deeper monitoring (error patterns, trigger failures, slow queries), consider:

1. **Fly.io log drain** -> Datadog/Grafana Cloud (free tier available)
2. **Supabase log drain** (Pro plan) -> same destination
3. **Custom log parser** running on a small Fly.io machine, tailing `fly logs` and alerting on patterns like:
   - `[auth] JWKS fetch failed` (auth degradation)
   - `[db] error:` (database issues)
   - `[relay] connection error` (relay problems)
   - OOM kills in Fly.io machine events

### Supabase Usage Monitoring

Supabase doesn't have a public API for usage metrics on the free/Pro plan. Options:

1. **Manual check**: Dashboard -> Reports -> Usage (weekly review)
2. **Supabase Management API** (if available for your plan): Query usage programmatically
3. **Proxy metric**: Track egress indirectly by monitoring request volume via backend logs

### Alert Escalation

| Severity | Condition | Action |
|----------|-----------|--------|
| Critical | Backend health check fails 3x in a row | Telegram alert + check Fly.io dashboard |
| Warning | JWKS endpoint unreachable | Telegram alert (auth falls back to API calls, egress increases) |
| Warning | 0 connected runners | Telegram alert (users can't execute tasks) |
| Info | Successful deploy | Telegram notification |
| Weekly | Supabase usage report | Manual dashboard check |

## Related Documentation

- [Fly Deployment](../setup/fly-deployment.md) -- Debugging, logs, SSH
- [Supabase Production](../setup/supabase-production.md) -- Egress, billing, JWT
- [Security Checklist](../setup/security-checklist.md) -- Post-deployment monitoring
