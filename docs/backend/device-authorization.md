# Device Authorization

OAuth2 Device Authorization Grant (RFC 8628) for agent runner registration.

## Overview

Agent runners use the OAuth2 Device Authorization Grant to obtain access tokens without requiring a web browser on the machine.

**Flow:** Device code → User approves on web → Access + refresh tokens → Machine registers

**Use Cases:**
- Headless servers
- HPC login nodes
- SSH-only environments
- CLI tools

## Device Authorization Flow

```
1. Agent Runner: Request device code
   ↓ POST /api/device/authorize
2. Backend: Generate device code + user code
   ↓ Returns { device_code, user_code, verification_uri }
3. Agent Runner: Display user code
   └─ "Go to https://astro.your-domain.com/device and enter: BDWD-HQPK"
4. Agent Runner: Poll for token
   ↓ POST /api/device/token (every 5 seconds)
5. User: Opens browser → enters user code → approves
6. Backend: Marks device code as approved
7. Agent Runner: Poll succeeds → receives access + refresh tokens
8. Agent Runner: Register machine
   ↓ POST /api/device/register (with access token)
9. Backend: Creates registered_machines record
   └─ Returns { machineId, workspaceId }
```

## API Endpoints

See [API Reference](./api-reference.md#device-authorization-oauth2) for detailed endpoint documentation.

**Summary:**
- `POST /api/device/authorize` - Request device code
- `POST /api/device/token` - Poll/exchange for access token
- `POST /api/device/register` - Register machine after auth
- `POST /api/device/refresh` - Refresh access token
- `POST /api/device/revoke` - Revoke refresh token (logout)
- `GET /api/device/machines` - List registered machines
- `DELETE /api/device/machines/:id` - Revoke machine

## User Codes

**Format:** `XXXX-YYYY` (8 chars, alphanumeric, case-insensitive)

**Example:** `BDWD-HQPK`

**Generation:**
```typescript
function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // No ambiguous chars
  const code = Array.from({ length: 8 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('')
  return `${code.slice(0, 4)}-${code.slice(4)}`
}
```

## Device Codes

**Format:** Opaque string (UUID v4)

**Expiry:** 15 minutes

**Storage:** In-memory (for development) or Redis (for production)

## Polling

**Interval:** 5 seconds (enforced by `interval` in response)

**Errors:**
- `authorization_pending` - User hasn't approved yet (continue polling)
- `slow_down` - Polling too fast (back off to 10 seconds)
- `expired_token` - Device code expired (start over)
- `access_denied` - User denied approval

## Token Types

### Access Token

**Format:** JWT
**Expiry:** 1 hour
**Payload:**
```json
{
  "sub": "user-uuid",
  "device_code": "device-code-uuid",
  "scope": "dispatch report",
  "exp": 1234567890
}
```

### Refresh Token

**Format:** Cryptographically random string (32 bytes, hex)
**Expiry:** 30 days
**Storage:** Hashed (SHA256) in `refresh_tokens` table

**Security:** Refresh tokens are single-use in strict mode (rotate on each refresh).

## Machine Registration

After obtaining access token, agent runner registers:

**Request:**
```bash
curl -X POST https://astro-api.your-domain.com/api/device/register \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "HPC Login Node",
    "hostname": "login01.cluster.edu",
    "platform": "linux",
    "environmentType": "hpc",
    "providers": ["slurm"]
  }'
```

**Response:**
```json
{
  "machineId": "machine-abc123",
  "workspaceId": "ws-def456"
}
```

**Workspace Preparation:**
- Backend creates git worktree in `~/.astro/worktrees/{workspaceId}/`
- Agent runner clones into workspace on first task dispatch

## Token Refresh

Access tokens expire after 1 hour. Use refresh token to get new access token:

```bash
curl -X POST https://astro-api.your-domain.com/api/device/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "refresh_token",
    "refresh_token": "abc123..."
  }'
```

**Response:**
```json
{
  "access_token": "new-jwt-token",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Token Rotation (Strict Mode):**
In production, refresh tokens are single-use:
1. Validate refresh token
2. Revoke old refresh token
3. Issue new access + refresh tokens

## Revocation

### User-Initiated Revocation

From web UI (`/environments` page):
```typescript
await fetch(`/api/device/machines/${machineId}`, { method: 'DELETE' })
```

Backend:
1. Marks `registered_machines.isRevoked = true`
2. Revokes all refresh tokens for machine
3. Sends WebSocket message to disconnect machine (if connected)

### Machine-Initiated Revocation (Logout)

```bash
curl -X POST https://astro-api.your-domain.com/api/device/revoke \
  -H "Content-Type: application/json" \
  -d '{ "token": "refresh-token" }'
```

## Security

### Storage
- **Device codes**: In-memory or Redis (ephemeral)
- **Access tokens**: Never stored (stateless JWT)
- **Refresh tokens**: Hashed (SHA256) in database

### Scopes
- `dispatch` - Can receive task dispatches
- `report` - Can send task results/events
- `admin` - Can manage other machines (reserved)

### Rate Limiting
- Device code requests: 10/hour per IP
- Token polling: 1 req/5 seconds per device code
- Registration: 5/hour per user

## CLI Usage (Agent Runner)

```bash
# Install agent runner
npm install -g @astro/agent

# Authenticate
astro-agent auth login
# → Displays: "Go to https://astro.your-domain.com/device and enter: BDWD-HQPK"
# → Waits for user approval...
# → ✓ Authenticated! Machine registered as "macbook-pro"

# View status
astro-agent status
# → Machine ID: machine-abc123
# → Workspace: ~/.astro/worktrees/ws-def456
# → Connected: true

# Revoke (logout)
astro-agent auth logout
```

## Frontend Device Auth Page

**Route:** `/device`

**Component:** `src/pages/device-auth.tsx`

**Flow:**
1. User enters user code (e.g., `BDWD-HQPK`)
2. Backend validates code → returns machine info
3. User approves or denies
4. Backend marks device code as approved/denied
5. Agent runner poll succeeds/fails

## Related Documentation

- [API Reference](./api-reference.md#device-authorization-oauth2) - Complete endpoint docs
- [Database Schema](./database-schema.md) - `registered_machines`, `refresh_tokens` tables
- [Relay System](../relay/overview.md) - How machines connect after registration
- [Agent Runner Protocol](../guides/agent-runner-protocol.md) - Client implementation guide
