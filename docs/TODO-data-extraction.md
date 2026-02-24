# TODO: Systematic Data Extraction for SFT Training

## Current State

`scripts/extract-trajectories.ts` extracts trajectory data from the `observation_events` table only (tool traces from agent execution sessions). This covers execution-level data but misses the conversational data that captures human planning decisions.

## Gap

The `sessions` table stores three types of conversational data that are not currently extracted:

- **plan-chat**: Plan refinement conversations (user asks questions, AI suggests plan mutations)
- **task-chat**: Per-task discussions about implementation approach and results
- **steer**: Mid-execution steering messages where users redirect running agents

These sessions contain high-signal human decision-making data (decomposition choices, priority overrides, scope adjustments, context injection) that would be valuable for SFT training.

## Future Work

1. **Enrich extraction to cover all session types**
   - Extract `plan-chat` sessions as multi-turn conversation trajectories with applied plan mutations
   - Extract `task-chat` sessions paired with task context (title, description, execution output)
   - Extract `steer` messages paired with before/after execution behavior

2. **Unified export format**
   - Define a common trajectory format that covers both tool-trace data (from `observation_events`) and conversational data (from `sessions`)
   - Include provenance metadata: project ID, session type, model used, timestamp

3. **Refactor into a data management package**
   - Move extraction logic out of `scripts/` into a dedicated package for data management
   - Support both PGlite (local) and Supabase (server) as data sources
   - Add filtering by date range, project, session type, quality signals (e.g., sessions where mutations were applied vs. pure Q&A)
