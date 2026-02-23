# Current Conflicts: Design Docs vs. Code/Technical Docs

This document tracks discrepancies between design documents (in `docs/design/`), technical documentation, CLAUDE.md, and the actual codebase. Last updated: 2026-02-22.

---

## Design Doc Issues

### 1. ~~Relay Protocol Gaps (RELAY.md Section 8)~~ ✅ RESOLVED

`docs/design/RELAY.md` §8 lists four "Protocol Gaps" as open — all four are resolved in `server/types/relay.ts` (`messages`, `systemPrompt`, `type`, `model` fields exist).

**Resolved (2026-02-22):** All gaps are resolved in code. RELAY.md §8 still needs updating to reflect this.

### 2. IMPLEMENTATION_PIPELINE.md Phase A Blocker

§3 states `isServerMode()` is missing from AI endpoints. Commit `a11b35e` added guards to all 7 endpoints. Phase A should be `✅ DONE`, not `[!] BLOCKER`.

**Resolution needed:** Update §3 evidence, Phase A status, and component percentages.

### 3. ~~ARCHITECTURE.md §1.3 — Backend AI Calls~~ ✅ RESOLVED

**Resolved (2026-02-22):** §1.3 rewritten to state that all AI execution flows through the relay to agent runners.

### 4. ~~`docs/SERVER_LOCAL_MODE_SEPARATION.md` — Missing~~ ✅ RESOLVED

**Resolved (2026-02-22):** The migration described in this plan has been completed by the Execution Path Unification.

### 5. ~~Agent Runner Config vs. Data Directory~~ ✅ RESOLVED

**Resolved (2026-02-22):** AGENT_RUNNER.md §14 now clearly separates runner config (`~/.config/astro-agent/`), global data (`~/.astro/`), and per-project agent dir (`{workingDir}/.astro/`). Aligned with WORKSPACE_V2.md.

### 7. ~~FRONTEND.md — Stale IndexedDB References~~ ✅ RESOLVED

**Resolved (2026-02-21):** FRONTEND.md rewritten — data flow and persistence sections updated for API/Drizzle path.

### 8. ~~BACKEND.md — Minor IndexedDB References~~ ✅ RESOLVED

**Resolved (2026-02-21):** BACKEND.md updated for PGlite/Drizzle architecture.

---

## Workspace V2 Conflicts (introduced 2026-02-22)

Workspace V2 design (`docs/design/WORKSPACE_V2.md`) and its implementation specs add new types and fields that the older design docs do not yet reflect.

### 9. ~~DATA_MODEL.md — `Project` type missing workspace V2 fields~~ ✅ RESOLVED

**Resolved (2026-02-22):** DATA_MODEL.md `Project` type updated with `agentDir`, `worktreeStrategy` fields. `references` field replaced. `DeliveryMode` union includes `'copy'`. `ProjectReference` marked as `@deprecated`.

### 10. ~~DATA_MODEL.md — `TaskExecution` missing workspace V2 fields~~ ✅ RESOLVED

**Resolved (2026-02-22):** DATA_MODEL.md `TaskDispatch` type updated with `deliveryMode`, `agentDir`, `worktreeStrategy`, `remoteType`, `baseBranch`, `sourceDirectory` fields. Agent runner `Task` type also updated.

### 11. ~~DATA_MODEL.md / RELAY.md — `TaskDispatch` missing workspace V2 fields~~ ✅ RESOLVED

**Resolved (2026-02-22):** DATA_MODEL.md `TaskDispatch` updated with all workspace V2 fields (`agentDir`, `worktreeStrategy`, `deliveryMode` with `'copy'`). RELAY.md `server/types/relay.ts` already includes these fields in code.

### 12. FRONTEND.md — Route table outdated, missing workspace V2 UI

FRONTEND.md route table is missing `/workflows` and `/team/invite/:token`. Does not describe directory detection hook or simplified project creation form.

**Resolution needed:** Update FRONTEND.md route table and project creation section.

### 13. ~~Worktree location: global vs. per-project~~ ✅ RESOLVED

**Resolved (2026-02-22):** Code now uses per-project `{projectDir}/.astro/worktrees/` location as specified in WORKSPACE_V2.md. AGENT_RUNNER.md status table updated to reflect implementation completion. ARCHITECTURE.md §4.5 still references global path — should be updated in a future pass.

---

## Execution Unification Conflicts

ARCHITECTURE.md was updated for the execution path unification, but BACKEND.md was not.

### 14. BACKEND.md — Still documents local dispatch path

ARCHITECTURE.md §1.3 says the backend never calls AI directly (relay-only). BACKEND.md §3.1 still documents both `dispatchLocal()` (~480 lines) and `dispatchViaRelay()` as dual paths.

**Resolution needed:** Remove or mark the local dispatch path as deleted in BACKEND.md. Update to describe relay-only dispatch.

### 15. BACKEND.md — Still documents procedure pipeline

ARCHITECTURE.md §15 marks the procedure pipeline as deleted. BACKEND.md §7.2 still documents the full procedure pipeline system (classifiers, validation loops, etc.).

**Resolution needed:** Remove or mark the procedure pipeline section as deleted in BACKEND.md.

### 16. BACKEND.md — Still documents server-side provider adapters

ARCHITECTURE.md says provider adapters were deleted from the server. BACKEND.md §8 still documents the full provider system (registry, adapters).

**Resolution needed:** Remove or mark the provider adapter section as deleted in BACKEND.md. Note: CLAUDE.md still lists provider adapter files in the project structure — verify whether the files still exist or were actually deleted.

---

## Other Open Issues

### 6. Production Domain References

Inconsistent across docs: `astro.your-domain.com` (dev tunnel), `astroanywhere.com` (prod), `astro-backend-platform.fly.dev` (Fly default). Dev tunnel URLs are used in examples that should be generic.

**Resolution needed:** Clearly distinguish dev vs. prod URL references.

### 17. Database table count inconsistency

DATA_MODEL.md says "32+ tables", ARCHITECTURE.md says "28 tables". With Phase 3 additions the actual count is 32+.

**Resolution needed:** Update table counts in DATA_MODEL.md and ARCHITECTURE.md to match the actual Drizzle schema.

### 18. Local data path inconsistency

ARCHITECTURE.md §2.4 says `~/.astro/data/`, §3.1 says `~/.astro/pglite/`. BACKEND.md §5.1 says `~/.astro/pglite/`.

**Resolution needed:** Standardize on one path (`~/.astro/pglite/`) across all docs.

---

## Aspirational Design Docs (Proposals, Low Implementation)

The following design documents in `docs/design/` are forward-looking proposals with little to no implementation in the codebase. They should be treated as aspirational references, not descriptions of current behavior.

| Document | Implementation | Notes |
|----------|---------------|-------|
| `AGENT_PERFORMANCE.md` | 0% | No implementation exists. Pure proposal for future agent performance optimization. |
| `ATTENTION_TRIAGE.md` | ~5% | Minimal scaffolding only. Core triage logic and UI are not implemented. |
| `COST_TRACKING.md` | ~20% | Basic usage tracking exists (`usage-store.ts`, `UsageMetrics` type, usage metrics hook), but the full cost tracking, budgeting, and alerting system described in the doc is not built. |
| `CROSS_PROJECT_REFERENCES.md` | ~5% | Minimal cross-project awareness exists (e.g., initiative grouping), but the reference resolution system described in the doc is not implemented. |

---

## Summary

| Category | Count |
|----------|-------|
| Design doc issues (open) | 1 (#2) |
| Design doc issues (resolved) | 6 (#1, #3, #4, #5, #7, #8) |
| Workspace V2 conflicts (open) | 1 (#12) |
| Workspace V2 conflicts (resolved) | 4 (#9, #10, #11, #13) |
| Execution unification conflicts (open) | 3 (#14, #15, #16) |
| Other open issues | 3 (#6, #17, #18) |
| Aspirational docs (low implementation) | 4 (AGENT_PERFORMANCE, ATTENTION_TRIAGE, COST_TRACKING, CROSS_PROJECT_REFERENCES) |
| **Total open** | **8** |
| **Total resolved** | **10** |
