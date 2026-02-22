# Current Conflicts: Design Docs vs. Code/Technical Docs

This document tracks discrepancies between design documents (in `docs/design/`), technical documentation, CLAUDE.md, and the actual codebase. Last updated: 2026-02-21.

---

## Design Doc Issues

### 1. Relay Protocol Gaps (RELAY.md Section 8)

`docs/design/RELAY.md` §8 lists four "Protocol Gaps" as open — all four are resolved in `server/types/relay.ts` (`messages`, `systemPrompt`, `type`, `model` fields exist).

**Resolution needed:** Mark all gaps as resolved in RELAY.md §8.

### 2. IMPLEMENTATION_PIPELINE.md Phase A Blocker

§3 states `isServerMode()` is missing from AI endpoints. Commit `a11b35e` added guards to all 7 endpoints. Phase A should be `✅ DONE`, not `[!] BLOCKER`.

**Resolution needed:** Update §3 evidence, Phase A status, and component percentages.

### 3. ~~ARCHITECTURE.md §1.3 — Backend AI Calls~~ ✅ RESOLVED

~~States the backend calls AI directly for several endpoints.~~

**Resolved (2026-02-22):** §1.3 rewritten to state that all AI execution flows through the relay to agent runners. The backend never calls AI directly. This was achieved by the Execution Path Unification — see `EXECUTION_PATH_DUPLICATION.md` §9.

### 4. ~~`docs/SERVER_LOCAL_MODE_SEPARATION.md` — Missing~~ ✅ RESOLVED

~~Referenced in docs but never created.~~

**Resolved (2026-02-22):** The migration described in this plan has been **completed** by the Execution Path Unification. ARCHITECTURE.md §1.3 now documents the completed state. The reference in ARCHITECTURE.md has been updated to mark the plan as COMPLETE.

### 5. Agent Runner Config vs. Data Directory

`AGENT_RUNNER.md` says `~/.config/astro-agent/` but doesn't mention `~/.astro/` for data. Both paths are correct but serve different purposes (config vs. data).

**Resolution needed:** Clarify in AGENT_RUNNER.md.

### 7. ~~FRONTEND.md — Stale IndexedDB References~~ ✅ RESOLVED

~~`FRONTEND.md` extensively describes the old dual-source architecture.~~

**Resolved (2026-02-21):** FRONTEND.md rewritten — §2 data flow diagram updated to show API/Drizzle path, §6 persistence section rewritten to describe two-layer pattern (Zustand + API), §6.3 IndexedDB Keys deleted and replaced with Drizzle ORM persistence description.

### 8. ~~BACKEND.md — Minor IndexedDB References~~ ✅ RESOLVED

~~`BACKEND.md` §2 mentions IndexedDB, §11 mentions IndexedDB-only mode.~~

**Resolved (2026-02-21):** BACKEND.md updated — §2 now describes dual-driver architecture (PGlite + postgres-js), §5.1 expanded with PGlite/migration/bootstrap details, §11 says "local mode" instead of "IndexedDB-only mode", auth middleware section updated with teamId resolution.

---

## Other Open Issues

### 6. Production Domain References

Inconsistent across docs: `astro.fuxialexander.work` (dev tunnel), `astroanywhere.com` (prod), `astro-backend-platform.fly.dev` (Fly default). Dev tunnel URLs are used in examples that should be generic.

**Resolution needed:** Clearly distinguish dev vs. prod URL references. Consider using placeholder domains in examples.

---

## Summary

| Category | Count |
|----------|-------|
| Design doc issues (open) | 3 |
| Design doc issues (resolved) | 4 |
| Other open issues | 1 |
| **Total open** | **4** |
| **Total resolved** | **4** |
