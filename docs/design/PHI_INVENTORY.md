# PHI Inventory

Column-level catalog of PHI-bearing fields in the Astro schema, the target encryption plan for HIPAA mode, and the code sites that must be updated in Phase 4.

Source of truth for the schema: [packages/core/src/db/schema.ts](../../packages/core/src/db/schema.ts). Every row below was verified against that file.

Companion doc: [HIPAA_ARCHITECTURE.md](./HIPAA_ARCHITECTURE.md).

## Status

- **Phase 4 (shipped):** `streamingEvents.data` envelope-encrypted on hot write path.
- **Phase 4b (shipped):** remaining PHI columns encrypted at rest via per-table sanitizers in [server/lib/phi-encryption.ts](../../server/lib/phi-encryption.ts). All writes route through `encryptXWrite()` and reads route through `decryptXRow[s]()`. Encryption is gated on `isHipaaMode()` — non-HIPAA deployments are byte-identical to pre-4b. See Section 5 for the helper catalog.

## Legend

- **Risk** — `H` (free-form text that directly carries PHI), `M` (structured field that commonly contains PHI fragments), `L` (metadata that may incidentally reveal PHI via identifiers/paths).
- **Encryption** — `plaintext` (today), `planned` (Phase 4), `encrypted` (shipped). Envelope encryption via `server/lib/encryption.ts` (cached local DEK wrapped by KMS CMK).
- **Audit** — `yes` if reads/writes are recorded via the `auditLogs` pipeline; `no` otherwise.

## 1. PHI Column Catalog

| Table | Column | Type | Holds | Risk | Encryption | Audit |
|---|---|---|---|---|---|---|
| `projects` | `description` | text | User-authored project description; may reference patient scenarios | H | encrypted (Phase 4b) | no |
| `projects` | `visionDoc` | text | Long-form vision document injected into every agent session | H | encrypted (Phase 4b) | no |
| `planNodes` | `description` | text | Task description (plain text) | H | encrypted (Phase 4b) | no |
| `planNodes` | `content` | text | Rich-text (TipTap HTML) node body | H | encrypted (Phase 4b) | no |
| `planNodes` | `executionOutput` | text | Text output from the agent's execution of this node | H | encrypted (Phase 4b) | no |
| `sessions` | `streamText` | text | Accumulated assistant text for the session | H | encrypted (Phase 4b) | no |
| `sessions` | `messages` | jsonb | Full chat transcript (`{role, content, …}[]`) | H | encrypted (Phase 4b) | no |
| `sessions` | `activityEvents` | jsonb | Stream of activity events seen by the session | H | encrypted (Phase 4b) | no |
| `sessions` | `toolTraces` | jsonb | Per-session tool invocations with inputs/outputs | H | encrypted (Phase 4b) | no |
| `sessions` | `fileChanges` | jsonb | Per-session file-change descriptors (incl. paths/diffs) | H | encrypted (Phase 4b) | no |
| `taskExecutions` | `streamText` | text | Accumulated execution transcript | H | encrypted (Phase 4b) | no |
| `taskChatMessages` | `content` | text | Per-message body (legacy chat path) | H | encrypted (Phase 4b) | no |
| `observationEvents` | `input` | jsonb | Full input payload to an LLM/tool observation | H | encrypted (Phase 4b) | no |
| `observationEvents` | `output` | jsonb | Full output payload from an LLM/tool observation | H | encrypted (Phase 4b) | no |
| `streamingEvents` | `data` | jsonb | Every `text` / `tool_use` / `tool_result` / `file_change` / `progress` / `result` event payload. **Highest volume PHI store.** | H | encrypted (Phase 4, envelope, hot path) | no |
| `toolTraces` | `toolInput` | jsonb | Raw arguments passed into a tool call | H | encrypted (Phase 4b) | no |
| `toolTraces` | `toolResult` | jsonb | Raw result returned by a tool call | H | encrypted (Phase 4b) | no |
| `fileChanges` | `path` | text | Absolute-or-relative file path touched by an execution | M | encrypted (Phase 4b) | no |
| `machineInstructions` | `content` | text | Markdown instructions injected into agent context | M | encrypted (Phase 4b) | no |
| `skills` | `instructions` | text | Skill definition body injected into agent context | M | encrypted (Phase 4b) | no |
| `skills` | `config` | jsonb | Skill config (may contain endpoints, prompts referring to PHI) | M | encrypted (Phase 4b) | no |
| `blobs` | `data` | text | Base64-encoded file/image attachment payload | H | encrypted (Phase 4b) | no |
| `auditLogs` | `details` | jsonb | Audit context — **must never contain PHI by policy**; still listed so we treat it carefully | L | encrypted (Phase 4b, defensive) | n/a (is the audit log) |

### Related columns flagged by Phase 0 (not PHI but credential-grade)

| Table | Column | Reason | Encryption |
|---|---|---|---|
| `connectedAccounts` | `credentials` | API tokens / OAuth secrets | encrypted (Phase 0) |
| `registeredMachines` | `providerConfigs` | Plaintext `apiKey` in jsonb | encrypted (Phase 0) |

## 2. Schema Discrepancies (flag-only, do not silently fix)

All entries from the plan match existing columns, **with three clarifications** a reader of the plan might misread:

1. **`sessions.toolTraces` and `sessions.fileChanges` vs. the standalone `toolTraces` / `fileChanges` tables.** The plan lists both sets. They are different columns in different tables and both exist:
   - `sessions.toolTraces` (jsonb) — per-session aggregate, schema.ts:382.
   - `sessions.fileChanges` (jsonb) — per-session aggregate, schema.ts:383.
   - `toolTraces.toolInput` / `toolTraces.toolResult` — separate table, schema.ts:546-557.
   - `fileChanges.path` — separate table, schema.ts:560-570.
   Both must be encrypted; one is not a substitute for the other.
2. **`taskChatMessages.content`** lives in a table (`taskChatMessages`, schema.ts:417) that is flagged "legacy, will be migrated to sessions" in the schema file. It still receives writes today (see Section 3) and must be encrypted until the migration lands.
3. **`auditLogs.details`** is included in the plan's list. Policy says it must never contain PHI; inclusion here is a belt-and-braces measure. Encrypting it adds cost but defends against bugs that accidentally dump request bodies into audit details. We also need a scrub/redact rule on the write path — see [server/middleware/audit.ts](../../server/middleware/audit.ts).

No column in the plan is missing from the schema. No name or location was silently adjusted.

## 3. Persistence Sites per High-Risk Column

Grep-verified write sites for every `H`-risk column. These are the concrete files Phase 4 must touch to integrate `server/lib/encryption.ts`. Drizzle column transforms are **not sufficient** on their own — several paths bulk-insert or write via raw SQL.

### `projects.description`, `projects.visionDoc`

- [server/routes/data.ts:171](../../server/routes/data.ts) — primary upsert (`tx.insert(projects) … onConflictDoUpdate`).
- [server/routes/community.ts:650](../../server/routes/community.ts) — community fork insert (should be route-gated off in HIPAA, but encrypt defensively).
- [server/routes/examples.ts:604](../../server/routes/examples.ts) — examples import.
- [server/routes/github-sync.ts:481](../../server/routes/github-sync.ts) — project create from GitHub sync.

### `planNodes.description`, `planNodes.content`, `planNodes.executionOutput`

- [server/routes/data.ts:883](../../server/routes/data.ts) — main plan-node upsert.
- [server/routes/data.ts:1045](../../server/routes/data.ts) — secondary plan-node insert path.
- [server/routes/community.ts:676](../../server/routes/community.ts) — bulk `insert(planNodes)` during fork.
- [server/routes/github-sync.ts:316](../../server/routes/github-sync.ts) — insert from GitHub issue/PR sync.
- [server/plugins/channel-github/github-webhook-handler.ts:166](../../server/plugins/channel-github/github-webhook-handler.ts) — webhook-driven insert.
- [server/lib/github-webhook-automation.ts:120](../../server/lib/github-webhook-automation.ts), [:199](../../server/lib/github-webhook-automation.ts) — automation-driven inserts.

### `sessions.streamText`, `sessions.messages`, `sessions.activityEvents`, `sessions.toolTraces`, `sessions.fileChanges`

- [server/routes/data.ts](../../server/routes/data.ts) — session CRUD (search for `sessions` write paths; includes update-by-id flows used by chat + execution).
- [server/routes/agent.ts](../../server/routes/agent.ts) — agent stream writer path.
- [server/lib/streaming-event-log.ts](../../server/lib/streaming-event-log.ts) — some session-level projection may share hooks.

(Audit: this area has no direct `.insert(sessions)` grep hit because writes go through query builders on `sessions` referenced from `data.ts`. Phase 4 must grep `sessions`-table writes, not just `.insert(sessions)`.)

### `taskExecutions.streamText`

- [server/routes/data.ts:2118](../../server/routes/data.ts) — insert on execution creation.
- [server/routes/agent.ts:242](../../server/routes/agent.ts) — agent-side creation.
- [server/routes/executions.ts:126](../../server/routes/executions.ts) — execution API.
- [server/routes/dispatch.ts:2479](../../server/routes/dispatch.ts), [:2950](../../server/routes/dispatch.ts) — dispatch creation paths.
- [server/lib/execution-watchdog.ts](../../server/lib/execution-watchdog.ts) — watchdog update path (update, not insert; still writes `streamText`).

### `taskChatMessages.content`

- [server/routes/data.ts:1845](../../server/routes/data.ts) — the single writer.

### `observationEvents.input`, `observationEvents.output`

- [server/lib/observability/observation-collector.ts:752](../../server/lib/observability/observation-collector.ts) — bulk `db.insert(observationEvents).values(rows)`. Only writer.

### `streamingEvents.data` — highest-volume, hot path

- [server/lib/streaming-event-log.ts](../../server/lib/streaming-event-log.ts) — **the** writer. Envelope encryption must be integrated here with an in-process DEK cache; per-row KMS calls are infeasible. Benchmark before and after per Phase 4.
- [server/routes/dispatch.ts](../../server/routes/dispatch.ts) — also references `streamingEvents`; verify write vs. read usage.
- [server/routes/data.ts](../../server/routes/data.ts) — read-side catch-up + possibly write of synthetic events.

### `toolTraces.toolInput`, `toolTraces.toolResult`

No direct `db.insert(toolTraces)` grep hit in `server/`. Writes arrive via `streamingEvents.data` payloads that are later projected, or via [server/lib/observability/observation-collector.ts](../../server/lib/observability/observation-collector.ts). Phase 4 must confirm the projection path and encrypt at whichever hop materializes `toolTraces` rows.

### `fileChanges.path`

Same pattern as `toolTraces`: populated indirectly via streaming-event projection / observation collection. Encrypt at the materialization site.

### `blobs.data`

- [server/routes/data.ts:2574](../../server/routes/data.ts) — blob upload (`db.insert(blobs)`). Only writer. Phase 4 should additionally migrate the actual bytes off the DB to S3 SSE-KMS for HIPAA deployments, but that is scope-adjacent.

### `machineInstructions.content`

- [server/routes/machine-instructions.ts:106](../../server/routes/machine-instructions.ts), [:300](../../server/routes/machine-instructions.ts) — the two writers.

### `skills.instructions`, `skills.config`

- [server/routes/skills.ts:285](../../server/routes/skills.ts), [:412](../../server/routes/skills.ts) — user/catalog insert paths.
- [packages/core/src/db/bootstrap-skills.ts](../../packages/core/src/db/bootstrap-skills.ts) — bootstrap seeder (low PHI risk, but encrypted fields still need to round-trip).

### `auditLogs.details`

- [server/middleware/audit.ts:33](../../server/middleware/audit.ts) — the single writer (`db.insert(auditLogs).values(...)`). Phase 4 integrates (a) encryption and (b) a scrub rule that strips anything resembling a request body before write.

## 4. Phase 4 Integration Checklist

Per column, the work is:

1. Add a Drizzle column transform (or a write-time helper) that runs `encryption.encrypt()` on write and `encryption.decrypt()` on read.
2. For every site listed in Section 3, verify the write path goes through the transform. Raw inserts and bulk inserts (`.values(rows)`) must be audited individually.
3. Add a round-trip test that inserts a row, then reads the raw PGlite file and asserts the column is ciphertext (see Verification in the plan).
4. For `streamingEvents.data`, benchmark write throughput before/after; document the headroom.
5. Add `PHI_ACCESS` audit events on read paths that return decrypted PHI to a user.

## 5. Phase 4b Helper Catalog

Per-table sanitizers exported from [server/lib/phi-encryption.ts](../../server/lib/phi-encryption.ts):

| Table | Write helper | Read helper(s) |
|---|---|---|
| `projects` | `encryptProjectWrite` | `decryptProjectRow`, `decryptProjectRows` |
| `planNodes` | `encryptPlanNodeWrite` | `decryptPlanNodeRow`, `decryptPlanNodeRows` |
| `sessions` | `encryptSessionWrite` | `decryptSessionRow`, `decryptSessionRows` |
| `taskExecutions` | `encryptTaskExecutionWrite` | `decryptTaskExecutionRow`, `decryptTaskExecutionRows` |
| `taskChatMessages` | `encryptTaskChatMessageWrite` | `decryptTaskChatMessageRow`, `decryptTaskChatMessageRows` |
| `observationEvents` | `encryptObservationWrite` | `decryptObservationRow`, `decryptObservationRows` |
| `toolTraces` | `encryptToolTraceWrite` | `decryptToolTraceRow`, `decryptToolTraceRows` |
| `fileChanges` | `encryptFileChangeWrite` | `decryptFileChangeRow`, `decryptFileChangeRows` |
| `machineInstructions` | `encryptMachineInstructionWrite` | `decryptMachineInstructionRow`, `decryptMachineInstructionRows` |
| `skills` | `encryptSkillWrite` | `decryptSkillRow`, `decryptSkillRows` |
| `blobs` | `encryptBlobWrite` | `decryptBlobRow` |
| `auditLogs` | `encryptAuditLogWrite` | `decryptAuditLogRow` |

Rules:

- All helpers are no-ops when `isHipaaMode()` is false — the row passes through unchanged.
- Text columns use `enc:v1:…` ciphertext strings; jsonb columns use `{ encrypted: "enc:v1:…" }` wrappers so the column type stays valid.
- Helpers are idempotent on read (already-decrypted rows pass through).
- Unit tests: [server/lib/__tests__/phi-encryption.test.ts](../../server/lib/__tests__/phi-encryption.test.ts).
