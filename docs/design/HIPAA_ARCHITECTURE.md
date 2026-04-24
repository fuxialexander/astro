# HIPAA Architecture

Canonical vendor-boundary and AWS deployment blueprint for Astro's HIPAA mode.

HIPAA mode is a **separate deployment** of Astro (not a tenant flag inside the shared SaaS), dedicated to a single covered-entity customer. The entire process runs with `ASTRO_HIPAA_MODE=true` and branches on `isHipaaMode()` rather than `teams.featureFlags`. Disallowed routes and middleware are **not registered at boot** (fail-closed).

Related design docs:
- [ARCHITECTURE.md](./ARCHITECTURE.md) — SaaS architecture reference.
- [PHI_INVENTORY.md](./PHI_INVENTORY.md) — the column-level PHI catalog this doc encloses.
- [BACKEND.md](./BACKEND.md), [DATA_MODEL.md](./DATA_MODEL.md) — shared substrate.

## 1. Context & Goals

Astro SaaS today depends on many vendors (Fly.io, Cloudflare, Supabase, Anthropic API, consumer messaging connectors) and its local mode skips auth entirely. None of that is acceptable for healthcare customers.

Goals for HIPAA mode:

1. **Single BAA surface.** Every vendor that touches PHI must be covered by the AWS BAA. No Anthropic-direct, no Fly.io, no Cloudflare, no Supabase, no consumer connectors (Slack/Telegram/Linear/community).
2. **Real auth, always.** No `LOCAL_USER_ID` bypass. WebAuthn/passkey only, backed by PGlite.
3. **Encryption at rest and in transit.** KMS-CMK-encrypted EBS for state; SSE-KMS S3 for blobs and audit export; TLS 1.2+ end to end; envelope encryption for PHI columns in application code.
4. **Fail-closed surface area.** Disallowed routes and middleware never register. No 403 fallback.
5. **Auditability.** Append-only `auditLogs` enforced in code; daily export to S3 Object Lock (WORM, 6-year retention).
6. **Dedicated tenancy.** One deployment = one covered entity. No HIPAA multi-tenancy in v1.

Non-goals: multi-device realtime collaboration (Supabase Realtime is dropped), customer self-hosting, mixing HIPAA and non-HIPAA tenants in one process.

## 2. Vendor Boundary

Everything PHI-touching runs inside a single AWS account under one AWS BAA.

### In scope (AWS BAA)

| Service | Use |
|---|---|
| EC2 (agent-runner host + ephemeral compute) | Execution of tasks, agent process |
| EBS (KMS-CMK encrypted) | Local persistent state, PGlite data file |
| S3 + SSE-KMS | Blob storage, audit log export, artifacts |
| KMS | Customer-managed CMK for envelope encryption |
| Bedrock | Claude model inference (Anthropic is a sub-processor under AWS BAA) |
| VPC, ALB, CloudFront + S3 (frontend) | Network ingress / static hosting |
| CloudWatch Logs, CloudTrail | Operational logs, control-plane audit |
| IAM, Secrets Manager / Parameter Store | Credentials, JWT secrets, KMS access |
| Route 53, ACM | DNS, TLS certs |

### Explicitly out of scope (forbidden in HIPAA boot)

| Vendor | SaaS use | HIPAA status |
|---|---|---|
| Fly.io | Backend hosting | Forbidden — replaced by EC2 + ALB |
| Cloudflare (Pages, Tunnel) | Frontend, dev tunnel | Forbidden — replaced by CloudFront + S3 |
| Supabase (DB, Auth, Realtime) | Prod data store + auth | Forbidden — replaced by PGlite + PGlite-native WebAuthn |
| Anthropic API (`api.anthropic.com`) | Direct Claude calls | Forbidden — replaced by Bedrock |
| Slack / Telegram / Linear / GitHub consumer webhooks | Connectors | Forbidden — routes not registered |
| Community marketplace | Plan sharing | Forbidden — direct PHI exfiltration vector |
| Any third-party telemetry (Sentry etc.) that sees request bodies | Observability | Forbidden unless under AWS BAA or scrubbed |

`assertHipaaStartupConfig()` aborts boot if any forbidden env var (`SUPABASE_URL`, Cloudflare tokens, Fly tokens) is present.

## 3. Target AWS Architecture

```
                        ┌─────────────────────────────┐
                        │         Route 53            │
                        │   app.customer.hipaa.tld    │
                        └──────────────┬──────────────┘
                                       │ TLS (ACM)
                      ┌────────────────┼─────────────────┐
                      ▼                                  ▼
          ┌────────────────────┐            ┌────────────────────────┐
          │    CloudFront      │            │       ALB (HTTPS)      │
          │  (frontend cache)  │            │   SG: 443 from CF/VPN  │
          └─────────┬──────────┘            └───────────┬────────────┘
                    │                                   │
                    ▼                                   ▼
          ┌────────────────────┐            ┌────────────────────────┐
          │  S3 (static SPA)   │            │    EC2 Agent Runner    │
          │  SSE-KMS, private  │            │  (private subnet, no   │
          │   via OAC only     │            │   public IP, IMDSv2)   │
          └────────────────────┘            │  Hono API + WS relay   │
                                            │  PGlite on EBS (CMK)   │
                                            └───────────┬────────────┘
                                                        │
              ┌─────────────────────────────────────────┼────────────────────────┐
              │                    │                    │                        │
              ▼                    ▼                    ▼                        ▼
      ┌──────────────┐     ┌──────────────┐     ┌──────────────┐        ┌──────────────┐
      │  Bedrock     │     │ Ephemeral    │     │  S3 Blobs    │        │ S3 Audit     │
      │  (Claude)    │     │ EC2 compute  │     │  SSE-KMS     │        │ Object Lock  │
      │  VPC endpt   │     │ (KMS EBS,    │     │  VPC endpt   │        │ WORM, 6 yr   │
      │              │     │ auto-term)   │     │              │        │              │
      └──────────────┘     └──────────────┘     └──────────────┘        └──────────────┘
                                   ▲
                                   │ provisioned by
                                   │ AwsProvisioner (hipaaProfile)
                                   │
                            ┌──────┴───────┐
                            │   KMS CMK    │ envelope DEK for PHI columns
                            └──────────────┘
```

### Component details

- **Frontend** — Vite SPA built with the HIPAA feature set disabled; deployed to S3, served through CloudFront with Origin Access Control. No Cloudflare.
- **Backend** — The existing Hono server + WebSocket relay, running on a long-lived EC2 instance in a private subnet behind an ALB. Stateless except for WebSocket machine registry (live handles only; authoritative state in PGlite / Redis-on-ElastiCache if horizontal scaling is enabled).
- **Data store** — PGlite on KMS-encrypted EBS. Source of truth is `packages/core/src/db/schema.ts`. No Supabase client is imported at runtime (verified by startup assertion).
- **Ephemeral compute** — `AwsProvisioner.hipaaProfile` launches EC2 workers: KMS-CMK EBS, private subnet only, no public IP, IMDSv2-only, default-deny SG (egress only to Bedrock and S3 VPC endpoints), auto-terminate after N hours. See [server/lib/remote-compute/cloud-provisioner.ts](../../server/lib/remote-compute/cloud-provisioner.ts).
- **Claude inference** — Routed through Bedrock by setting `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION`, `ANTHROPIC_MODEL=<bedrock-model-id>` on the agent-runner machine. This is Claude Code's native Bedrock support; no custom adapter. Verified at agent-runner startup.
- **Blob storage** — S3 with SSE-KMS, accessed via VPC gateway endpoint. Replaces any external object storage.
- **Audit export** — Nightly dump of `auditLogs` to a separate S3 bucket with Object Lock (compliance mode, 6-year retention).
- **Secrets** — AWS Secrets Manager / SSM Parameter Store for `RELAY_JWT_SECRET`, KMS CMK ARN, Bedrock model id. No `.env` files in production images.

## 4. Network Topology

- **VPC** with two AZs, public subnets (ALB + NAT only) and private subnets (agents, ephemeral compute, VPC endpoints).
- **No public IPs** on any EC2 that touches PHI. Egress via NAT gateway or — preferred — VPC endpoints for Bedrock, S3, KMS, Secrets Manager.
- **Security Groups** default-deny; explicit allow:
  - ALB → agent-runner on 443 (intra-VPC).
  - agent-runner → Bedrock endpoint (443), S3 endpoint (443), KMS endpoint (443).
  - ephemeral compute → agent-runner WebSocket relay (443).
- **IMDSv2 required** on all EC2 (blocks SSRF credential theft).
- **TLS 1.2+** everywhere; ALB terminates with an ACM cert, re-encrypts to the agent on a private cert.
- **CloudFront** serves the SPA with OAC to S3; SPA origin is not publicly listable.
- **VPN / SSO** (optional but recommended) for admin access to the agent-runner; no SSH exposed to the internet.

## 5. Data Flow (text diagram)

End-to-end flow for a user prompt that hits Claude and writes a streaming event:

```
[Browser]
   │  HTTPS (TLS 1.2+)
   ▼
[CloudFront] ── static SPA assets ◄── [S3 (SSE-KMS, OAC)]
   │
   │  /api/* (origin: ALB)
   ▼
[ALB (HTTPS, ACM cert)]
   │  re-encrypt, private cert
   ▼
[EC2 Agent Runner — Hono]
   │  requireAuth (WebAuthn/passkey, PGlite-backed, JWT session)
   │  audit-log entry (append-only)
   │
   ├── read/write ───► [PGlite on KMS-CMK EBS]
   │                     (PHI columns: envelope encryption
   │                      local DEK cached; DEK wrapped by KMS CMK)
   │
   ├── dispatch ────► [Ephemeral EC2 compute (private subnet)]
   │                     │
   │                     │  Claude CLI with CLAUDE_CODE_USE_BEDROCK=1
   │                     ▼
   │                  [Bedrock VPC endpoint]
   │                     │
   │                     ▼
   │                  [AWS Bedrock — Claude model]
   │                     (Anthropic sub-processor under AWS BAA)
   │
   ├── stream events ──► streamingEvents.data (encrypted, envelope)
   │                     flushed by streaming-event-log.ts
   │
   └── blob upload ───► [S3 blobs (SSE-KMS, VPC endpoint)]

Nightly:  auditLogs  ──► [S3 audit bucket, Object Lock, 6yr]
```

Key invariants:
- No request payload leaves the VPC to a non-AWS destination.
- PHI-bearing columns are ciphertext on disk (see [PHI_INVENTORY.md](./PHI_INVENTORY.md)).
- Every request passes through `requireAuth` (no `LOCAL_USER_ID` bypass).
- `X-Internal-Dispatch` header is honored only with a valid signature and is always audit-logged.

## 6. Deployment Differences from SaaS

| Component | SaaS | HIPAA |
|---|---|---|
| Backend host | Fly.io (2 instances, round-robin) | EC2 behind ALB, single or HA pair within VPC |
| Frontend host | Cloudflare Pages | CloudFront + S3 (OAC) |
| Dev ingress | Cloudflare Tunnel | VPN / SSO only (no public dev path) |
| Auth store | Supabase (`supabase.auth`, `passkey_credentials`) | PGlite (`passkey_credentials` table), self-signed JWT via `RELAY_JWT_SECRET` |
| Data store | Supabase Postgres | PGlite on KMS-CMK EBS |
| Realtime sync | Supabase Realtime | Disabled — stub in `src/lib/realtime-sync.ts`; UI surfaces "Multi-device collaboration unavailable" |
| Claude inference | Anthropic API | Bedrock (env vars on agent-runner) |
| Blob storage | Supabase Storage / external | S3 + SSE-KMS (VPC endpoint) |
| Secrets | Fly secrets, `.env` | AWS Secrets Manager / SSM |
| Route registration | All routes | `connectedAccountsRoute`, `telegramRoute`, `githubAppWebhookRoute`, `remoteComputeRoute` (non-AWS), `storageMountsRoute` (non-S3), `communityRoute`, Slack/Linear not registered |
| Feature-flag gating | `teams.featureFlags` | Not used; branches on `isHipaaMode()` only |
| Local bypass (`LOCAL_USER_ID`) | Allowed in local mode | Disabled |
| Audit-write failure | `console.warn`, continue | Escalate; HIPAA mode always logs, request fails if audit fails |
| `auditLogs` append-only | Postgres role revoke | Code-enforced wrapper + SaaS migration (also revokes in Postgres) |
| PHI column encryption | Plaintext (many) | Envelope encryption, local DEK, KMS CMK |
| CLI (`astro-cli`) | Any `ASTRO_SERVER_URL` | Refuses non-HIPAA server when `ASTRO_HIPAA_MODE=true`; pins `/api/config { hipaa: true }` |
| Community / plan sharing | Enabled | Removed — not registered and hidden in UI |
| `X-Internal-Dispatch` | Trusted with JWT | Always audit-logged; refuses empty `RELAY_JWT_SECRET` |
| Frontend route wrapper | `FeatureFlagRoute` | Dedicated `HipaaRoute` wrapper |

## 6a. Vendor Boundary Extensions (Phase 7)

Phase 7 implements the provisioner-level and client-level enforcement of the vendor boundary described above.

### AWS provisioner HIPAA profile

When `isHipaaMode()` is true, `AwsProvisioner` (`server/lib/remote-compute/cloud-provisioner.ts`) enforces the following on every `RunInstancesCommand`:

- **KMS-CMK EBS encryption.** Root volume mapped via `BlockDeviceMappings` with `Ebs.Encrypted=true` and `KmsKeyId=ASTRO_KMS_KEY_ARN`. Startup fails if the env var is unset — never falls back to SSE-S3 or unencrypted volumes.
- **Private subnet, no public IP.** Subnet and security groups are passed via `NetworkInterfaces` (not the flat `SubnetId`/`SecurityGroupIds`), which lets us set `AssociatePublicIpAddress=false`. The AWS connected account must supply `subnetId` + `securityGroupIds`; otherwise the provisioner refuses the request.
- **Security group with default-deny ingress.** Ingress hardening is an ops-side responsibility — the provisioner does not create SGs, only references them, so the customer's Terraform must ensure no `0.0.0.0/0` rules. (Not enforced by code; captured in the compliance checklist.)
- **IMDSv2-only.** `MetadataOptions: { HttpTokens: 'required', HttpEndpoint: 'enabled', HttpPutResponseHopLimit: 2 }` — SSRF into the metadata service must present a session token.
- **Auto-terminate.** UserData appends a background `sleep N*3600 && shutdown -h now`. Combined with `InstanceInitiatedShutdownBehavior=terminate`, this guarantees PHI-bearing runners do not linger past the session. Default N=4 hours, tunable via `ASTRO_HIPAA_AUTO_TERMINATE_HOURS`.
- **Compliance tags.** Every instance is tagged with `HipaaCompliance=true` and `Customer=${ASTRO_CUSTOMER_ID}` for inventory and billing audit.

Non-AWS providers (`daytona`, `runloop`, `gcp`) are rejected at two layers: the `/api/remote-compute/pools` route returns a 400 with an explanatory error before invoking the provisioner, and the `getCloudProvisioner` factory throws. Defense in depth.

### Storage mount HIPAA restrictions

In HIPAA mode, `storage-mounts.ts` + `routes/storage-mounts.ts` enforce:

- **S3-only.** GCS mounts fail `validateStorageMount` synchronously.
- **SSE-KMS required.** `validateHipaaBucketCompliance` calls `GetBucketEncryption`. Only `aws:kms` and `aws:kms:dsse` pass; `AES256` (SSE-S3) is rejected because it uses AWS-managed keys outside our CMK.
- **No public ACLs.** `GetBucketAcl` is inspected; any grantee URI matching `AllUsers` or `AuthenticatedUsers` fails the mount.
- **Explicit account required.** HIPAA mounts must reference an `accountId` so the live bucket check can run. Mounts without credentials are rejected.

### CLI pinning

`packages/cli/src/hipaa-pin.ts` runs before every CLI command (via a Commander `preAction` hook). It fetches `${serverUrl}/api/config` and compares:

- `ASTRO_HIPAA_MODE=true` on host **+** `hipaa: false` from server → refuse. Prevents PHI from being sent to a general-purpose deployment.
- `ASTRO_HIPAA_MODE` unset **+** `hipaa: true` from server → refuse. Surfaces misconfiguration early; the server would otherwise reject authenticated operations.
- `ASTRO_HIPAA_MODE=true` on host **+** `/api/config` unreachable → refuse. In HIPAA, unreachable ≠ safe fallback.

Match is silent. Mismatch aborts the command with an actionable error before any authenticated request is made.

## 7. Risks & Open Questions

1. **Bedrock model availability.** `ANTHROPIC_MODEL` must map to a Bedrock model id whose version is approved for the customer's region. Open question: do we pin a specific model version per HIPAA deployment, or follow the SaaS upgrade cadence?
2. **Envelope-encryption hot path.** `streamingEvents.data` is the highest-volume PHI store. Per-row KMS calls are infeasible; plan uses a cached local DEK wrapped by KMS, rotated periodically. **Benchmark required** before rollout; headroom must be documented.
3. **Realtime replacement.** v1 drops multi-device collaboration entirely. If a customer requires it, we need SSE fan-out via the existing relay — non-trivial; punted.
4. **Supabase-free auth is the critical-path blocker.** Phase 2 rewrites `server/routes/auth.ts` and `src/stores/auth-store.ts`. Until this lands, HIPAA has no working login.
5. **OpenClaw channel config dependency.** `connectedAccountsRoute` currently bundles channel config; must be extracted to its own route before we can gate connected accounts off in HIPAA.
6. **CLI exfiltration.** The CLI trusts `ASTRO_SERVER_URL`. Mitigation (pinning via `/api/config`) assumes the server side is trustworthy; a compromised agent machine could still exfiltrate. Accepted residual risk; mitigated by IMDSv2, SG egress restrictions, CloudTrail.
7. **Append-only audit in PGlite.** PGlite has no roles. Enforcement is purely code-side (wrapper + lint/grep guard). A rogue developer with DB file access can still edit rows offline — accepted, since HIPAA mode runs on controlled EC2 with disk encryption and no interactive access.
8. **Audit-write failure semantics.** If the audit write fails mid-request, do we fail the user request or queue locally and retry? Plan says fail; need UX for the error surface.
9. **Ghost machines in Redis.** If multi-instance HA is used, the existing `MACHINE_INSTANCE` TTL / `relay:machines` ghost-cleanup logic must survive the move to ElastiCache. Not HIPAA-specific but must be verified for the new deployment.
10. **Backup and restore.** EBS snapshots carry PHI; snapshot sharing must be disabled, snapshots encrypted with the same CMK, and restore procedures documented under the compliance program (Phase 8).
11. **Breach notification tooling.** CloudTrail + S3 Object Lock gives us forensics; human process for 72h internal / 60d external notification lives in policy, not code.
12. **BAA scope of Bedrock sub-processors.** We assume Anthropic-via-Bedrock is covered by the AWS BAA. Legal must confirm per-customer before GA.
