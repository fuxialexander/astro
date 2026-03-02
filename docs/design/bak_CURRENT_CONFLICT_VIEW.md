# Current Conflicts: Design Docs vs. Code/Technical Docs

This document tracks discrepancies between design documents (in `docs/design/`), technical documentation, CLAUDE.md, and the actual codebase. Last updated: 2026-03-01.

---

## Documentation Consolidation (2026-02-23)

The following consolidation work has been completed:

### Superseded Design Docs Moved to `docs/deprecated/`
- `SERVER_ARCHITECTURE_V2.md` — Consolidated into ARCHITECTURE.md
- `LOCAL_SERVER_REFACTOR.md` — Implementation complete, historical reference only
- `SERVER_LOCAL_MODE_SEPARATION.md` — Core goals achieved
- `EXECUTION_PATH_DUPLICATION.md` — Resolved, historical reference only

### Duplicate Docs Removed
- `docs/testing/approval-testing-guide.md` — Merged into `approval-testing.md`
- `docs/backend/teams-schema.md` — Content already in `database-schema.md`
- `docs/architecture/deployment.md` — Redundant with `fly-deployment.md`; moved to deprecated

### Proposal Banners Added
Added clear "PROPOSED — Not yet implemented" banners to:
- `AGENT_PERFORMANCE.md` (0% implemented)
- `ATTENTION_TRIAGE.md` (~5% implemented)
- `COST_TRACKING.md` (~20% implemented)
- `CROSS_PROJECT_REFERENCES.md` (~5% implemented)

---

## Design Doc Issues

### 1. ~~Relay Protocol Gaps (RELAY.md Section 8)~~ ✅ RESOLVED

`docs/design/RELAY.md` §8 lists four "Protocol Gaps" as open — all four are resolved in `server/types/relay.ts` (`messages`, `systemPrompt`, `type`, `model` fields exist).

**Resolved (2026-02-22):** All gaps are resolved in code. RELAY.md §8 still needs updating to reflect this.

### 2. ~~IMPLEMENTATION_PIPELINE.md Phase A Blocker~~ ✅ RESOLVED

**Resolved (2026-02-24):** IMPLEMENTATION_PIPELINE.md updated to reflect Phase A and Phase B completion. Commit `a11b35e` added `isServerMode()` guards, commit `01772cb` unified execution paths (deleted ~3500 lines of provider code). §3 evidence updated, Phase A/B marked as DONE, component percentages updated.

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

### 12. ~~FRONTEND.md — Route table outdated, missing workspace V2 UI~~ ✅ RESOLVED

**Resolved (2026-02-27):** FRONTEND.md routes table completely rewritten with all 22 current routes (public + authenticated). Project creation section rewritten to describe the new `project-new-plan.tsx` two-phase interactive experience with inline directory detection (Workspace V2). Stores updated to 29, components expanded from 4 to 13 subsections, hooks and libraries promoted to full sections.

### 13. ~~Worktree location: global vs. per-project~~ ✅ RESOLVED

**Resolved (2026-02-22):** Code now uses per-project `{projectDir}/.astro/worktrees/` location as specified in WORKSPACE_V2.md. AGENT_RUNNER.md status table updated to reflect implementation completion. ARCHITECTURE.md §4.5 still references global path — should be updated in a future pass.

---

## Execution Unification Conflicts

ARCHITECTURE.md was updated for the execution path unification, but BACKEND.md was not.

### 14. ~~BACKEND.md — Still documents local dispatch path~~ ✅ RESOLVED

**Resolved (2026-02-27):** BACKEND.md §3.1 dispatch section completely rewritten. Removed `dispatchLocal()` documentation. Now describes relay-only execution model with dispatch-queue → machine-selector → relay → agent-runner → result-router flow.

### 15. ~~BACKEND.md — Still documents procedure pipeline~~ ✅ RESOLVED

**Resolved (2026-02-27):** BACKEND.md §7.2 (Procedure Pipeline) removed entirely. Startup sequence references to procedure classification also removed.

### 16. ~~BACKEND.md — Still documents server-side provider adapters~~ ✅ RESOLVED

**Resolved (2026-02-27):** BACKEND.md §8 (Provider System) removed entirely. CLAUDE.md project structure updated to remove `server/lib/providers/` directory listing (directory does not exist). CLAUDE.md now documents `packages/core/` and `packages/cli/` in the monorepo structure.

---

## Other Open Issues

### 6. Production Domain References

Inconsistent across docs: `astro.your-domain.com` (dev tunnel), `astroanywhere.com` (prod), `astro-backend-platform.fly.dev` (Fly default). Dev tunnel URLs are used in examples that should be generic.

**Resolution needed:** Clearly distinguish dev vs. prod URL references.

### 17. ~~Database table count inconsistency~~ ✅ RESOLVED

**Resolved (2026-02-27):** Both ARCHITECTURE.md and DATA_MODEL.md updated to 37 tables (the actual count in `packages/core/src/db/schema.ts`). ARCHITECTURE.md §4.2 now lists all 37 tables by category.

**Updated (2026-03-01):** Count updated to 38 tables across ARCHITECTURE.md and DATA_MODEL.md after `streaming_events` table was added to documentation.

### 18. ~~Local data path inconsistency~~ ✅ RESOLVED

**Resolved (2026-02-27):** All occurrences of `~/.astro/data/` in ARCHITECTURE.md replaced with `~/.astro/pglite/`. Three occurrences fixed (§2.4, §4.1 x2).

---

## Refresh Robustness Documentation (2026-03-01)

The following documentation gaps were identified and resolved related to the page-refresh recovery system:

### 19. ~~`streaming_events` table undocumented in design docs~~ ✅ RESOLVED

**Resolved (2026-03-01):** The `streaming_events` table (append-only SSE event log for page-refresh recovery) was present in `packages/core/src/db/schema.ts` but missing from all design documents. Fixed:
- ARCHITECTURE.md §4.2: Added `streaming_events` to "Execution detail" table listing, updated count to 38
- DATA_MODEL.md §15.7: Added `streamingEvents` row to Activity & Audit Tables

### 20. ~~FRONTEND.md — `use-restored-execution.ts` description outdated~~ ✅ RESOLVED

**Resolved (2026-03-01):** The hook description said it "reconstructs from persisted observation data via `reconstructActivityFromTrace()`" but the actual implementation uses a two-path recovery: (1) fast `streaming_events` catch-up via `hydrateFromCatchUp()`, (2) slower observation fallback. Updated description and added `streaming-event-hydrator.ts` to library utilities section.

### 21. ~~Missing REFRESH_ROBUSTNESS.md design document~~ ✅ RESOLVED

**Resolved (2026-03-01):** Created `docs/design/REFRESH_ROBUSTNESS.md` documenting the three-layer refresh recovery architecture (live SSE → streaming_events DB → observation fallback), data lifecycle on reset, store initialization flow, and scenario matrix.

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

## Major Documentation Refresh (2026-02-27)

All 5 core design documents and CLAUDE.md were comprehensively updated to match the current implementation:

- **BACKEND.md**: Removed 3 deleted sections (local dispatch, procedure pipeline, provider adapters). Rewrote dispatch/execution for relay-only model. Updated routes, startup sequence, and addendum.
- **FRONTEND.md**: Routes table rewritten (22 routes), stores updated to 29, components expanded from 4 to 13 subsections, hooks/libraries promoted to full sections. Project creation flow rewritten for Workspace V2.
- **ARCHITECTURE.md**: Fixed data paths (3 occurrences), updated table count to 37, added monorepo structure section, corrected store/route counts.
- **DATA_MODEL.md**: Updated table count to 37, added 14 new type sections, updated all existing type definitions to match `packages/core/src/types.ts`.
- **RELAY.md**: Added 3 new protocol sections (File/Repo Ops, Session Attachment, Slurm/HPC). Rewrote protocol gaps as implemented extensions. Added complete message type reference (50+ types).
- **CLAUDE.md**: Updated project structure tree (removed non-existent files, added `packages/core/`, `packages/cli/`, new pages/stores/components/libs). Updated routes table, package names, tech stack references.

## Refresh Robustness Documentation Pass (2026-03-01)

Addressed documentation gaps around the page-refresh recovery system:

- **REFRESH_ROBUSTNESS.md** (new): Created comprehensive design document covering the three-layer refresh recovery architecture, data lifecycle on reset, store initialization, and scenario matrix.
- **FRONTEND.md**: Fixed outdated `use-restored-execution.ts` description (now documents streaming events catch-up as primary path). Added `streaming-event-hydrator.ts` to library utilities.
- **ARCHITECTURE.md**: Added `streaming_events` to table listing. Updated table count from 37 to 38 (3 occurrences).
- **DATA_MODEL.md**: Added `streamingEvents` table to §15.7 Activity & Audit Tables. Updated table count from 37 to 38 (2 occurrences).

---

## Summary

| Category | Count |
|----------|-------|
| Design doc issues (resolved) | 7 (#1, #2, #3, #4, #5, #7, #8) |
| Workspace V2 conflicts (resolved) | 5 (#9, #10, #11, #12, #13) |
| Execution unification conflicts (resolved) | 3 (#14, #15, #16) |
| Other issues (resolved) | 2 (#17, #18) |
| Refresh robustness documentation (resolved) | 3 (#19, #20, #21) |
| Other issues (open) | 1 (#6 — production domain references) |
| Aspirational docs (low implementation) | 4 (AGENT_PERFORMANCE, ATTENTION_TRIAGE, COST_TRACKING, CROSS_PROJECT_REFERENCES) |
| **Total open** | **1** |
| **Total resolved** | **20** |
