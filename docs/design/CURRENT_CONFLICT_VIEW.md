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

### 3. ARCHITECTURE.md §1.3 — Backend AI Calls

States the backend calls AI directly for several endpoints. Since `a11b35e`, server mode routes through relay.

**Resolution needed:** Clarify backend calls AI directly only in local mode.

### 4. `docs/SERVER_LOCAL_MODE_SEPARATION.md` — Missing

Referenced in `docs/design/README.md`, `ARCHITECTURE.md`, and `RELAY.md` but never created. Content partially covered by `IMPLEMENTATION_PIPELINE.md` §3-4.

**Resolution needed:** Create the file or update references to point to IMPLEMENTATION_PIPELINE.md.

### 5. Agent Runner Config vs. Data Directory

`AGENT_RUNNER.md` says `~/.config/astro-agent/` but doesn't mention `~/.astro/` for data. Both paths are correct but serve different purposes (config vs. data).

**Resolution needed:** Clarify in AGENT_RUNNER.md.

---

## Other Open Issues

### 6. Production Domain References

Inconsistent across docs: `astro.fuxialexander.work` (dev tunnel), `astroanywhere.com` (prod), `astro-backend-platform.fly.dev` (Fly default). Dev tunnel URLs are used in examples that should be generic.

**Resolution needed:** Clearly distinguish dev vs. prod URL references. Consider using placeholder domains in examples.

---

## Summary

| Category | Count |
|----------|-------|
| Design doc issues | 5 |
| Other open issues | 1 |
| **Total open** | **6** |
