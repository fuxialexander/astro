# Memory & Context Systems: Cross-Tool Comparison

> **Date:** 2026-03-16
> **Scope:** Aider, FORGE, Codex, IronClaw, OpenClaw, Confucius, Astro
> **Related:** [HIERARCHICAL_MEMORY.md](HIERARCHICAL_MEMORY.md), [KNOWLEDGE_SHARING.md](KNOWLEDGE_SHARING.md), [PRODUCTION-READINESS.md](../../docs/design/PRODUCTION-READINESS.md)

---

## Executive Summary

Seven agent platforms take fundamentally different approaches to the same problem: how does an AI coding agent remember things across turns, sessions, and projects? The spectrum runs from **no persistence** (Aider's default — context dies with the session) to **full hierarchical databases** (IronClaw/OpenClaw — Postgres-backed workspace with hybrid vector+FTS search).

Astro's proposed hierarchical memory sits in the middle-right of this spectrum: tree-structured, SQLite-local, with selective injection. This comparison validates the design and surfaces four concrete improvements we should steal from other tools.

---

## Comparison Matrix

| Dimension | Aider | FORGE | Codex | IronClaw | OpenClaw | Confucius | **Astro (proposed)** |
|---|---|---|---|---|---|---|---|
| **Language** | Python | Rust | Rust | Rust | TypeScript | Python | TypeScript |
| **Storage** | Markdown files | SQLite (Diesel ORM) | SQLite + JSONL | Postgres + libSQL | SQLite + JSONL | In-memory (session) | SQLite (local) + Postgres (server) |
| **Persistence** | Opt-in (`--restore-chat-history`) | Always (DB upsert after every turn) | Always (JSONL append + SQLite) | Always (Postgres) | Always (JSONL + SQLite) | Session-only (no cross-session) | Always (SQLite local, Postgres sync) |
| **Structure** | Flat (message log) | Flat (conversation + metrics) | Flat (thread history) | **Hierarchical** (filesystem paths) | Flat (session transcripts) | **Hierarchical** (tree nodes) | **Hierarchical** (tree with paths) |
| **Search** | None | Semantic (gRPC vector index) | None (memory extraction jobs) | **Hybrid** (BM25 + pgvector RRF) | **Hybrid** (BM25 + vector + MMR) | Path-based read/search | **FTS5** (local), planned hybrid |
| **Agent-writable** | No | No (context is read-only to LLM) | No (background extraction) | **Yes** (4 memory tools) | No (memory is infrastructure) | **Yes** (6 memory tools) | **Yes** (6 MCP tools) |
| **Cross-session** | Only if `--restore-chat-history` | Yes (resume conversation) | Yes (thread resume/fork) | Yes (workspace persists) | Yes (session transcripts indexed) | No | Yes (SQLite persists) |
| **Cross-project** | No | No (workspace-isolated) | No (thread-scoped) | Yes (user-level workspace) | Yes (agent-level workspace) | No | **Yes** (global scope) |
| **Context injection** | Full history replay | Full conversation context | Full thread + env diff | Identity files + on-demand search | Bootstrap files (150KB cap) | Selective tree injection | **Selective** (3K always + 8K relevant + pull) |
| **Compaction** | LLM summarization when token limit hit | LLM summarization with reasoning preservation | Item removal (oldest first) | Configurable max messages | LLM summarization preserving IDs | LLM summarization at 70K tokens | N/A (memory separate from chat) |

---

## Detailed Analysis by Tool

### 1. Aider — Markdown-First, No Persistent Memory

**Architecture:** Chat history stored as `.aider.chat.history.md`. Repo understanding via tree-sitter RepoMap with PageRank ranking. No persistent memory across sessions by default.

**Memory model:** None. Aider treats each session as stateless. Context comes from:
- RepoMap (tree-sitter tags + PageRank, cached in `.aider.tags.cache.v4/` SQLite)
- File contents (user adds files to chat)
- Optional chat history restoration (`--restore-chat-history`)

**Compaction:** `ChatSummary` class uses LLM to summarize old messages when context exceeds `--max-chat-history-tokens`. Summarization can use the main model or a weaker model.

**Key insight:** Aider's RepoMap is the best codebase understanding system in this comparison. It builds a graph of definitions → references, runs PageRank with chat-file boosting, and binary-searches the optimal number of tags to fit the token budget. This is orthogonal to memory — it's about knowing *what code exists*, not *what the agent learned*.

**Relevance to Astro:** We already use Aider's RepoMap in astro-assistant. The gap is that Aider has no persistent knowledge system at all — every session starts from scratch. Our hierarchical memory directly addresses this.

---

### 2. FORGE — Conversation Database + Semantic Index

**Architecture:** Rust monorepo with clean layered architecture (Domain → App → Repo → DB). Conversations stored in SQLite via Diesel ORM. Semantic search via gRPC workspace indexing server.

**Memory model:** Conversation-centric. Each conversation is a first-class entity with:
- Full message history (serialized as JSON in SQLite)
- Session metrics (file operations, todos, files accessed)
- Resumable from CLI (`conversation_selector.rs` lists past conversations)

**Compaction:** Sophisticated — preserves the *last reasoning chain* from compacted messages and injects it into the first post-compaction assistant message. Also accumulates token usage from compacted messages into the summary. This reasoning preservation is unique.

**Context engine:** gRPC-based semantic search:
- Uploads local files with content hashes to indexing server
- Detects changes via hash comparison
- Lazy-loads relevant file chunks via semantic search queries

**Agent writes:** No. FORGE's context is infrastructure-managed, not agent-managed. The agent doesn't have tools to write memory — the system tracks what happened automatically.

**Key insight:** FORGE's reasoning preservation during compaction is clever. When you summarize old messages, you lose the chain of thought. FORGE extracts the last reasoning block and re-injects it, maintaining the model's thinking continuity.

**Relevance to Astro:** We should consider reasoning preservation in our compaction strategy. Also, FORGE's conversation-as-entity model (DB-backed, resumable, metrics-tracked) aligns well with our streaming_events persistence.

---

### 3. Codex — Thread System + Background Memory Extraction

**Architecture:** Rust, session-based with "threads" (conversations). Triple storage: SQLite state DB, JSONL rollout files (append-only), session index.

**Memory model:** Two-phase background extraction:
- **Stage 1:** Per-thread memory extraction — extracts facts/context from completed threads, stores as `raw_memory` + `rollout_summary` in SQLite
- **Phase 2:** Global consolidation — selects top-N Stage-1 outputs, consolidates into unified knowledge base
- Tracks `usage_count` and `last_usage` for memory entries (LRU-like)

**Session persistence:** JSONL rollout files are append-only logs. Each event is one line. Threads can be resumed (load JSONL → hydrate ContextManager) or forked (clone history into new thread).

**Context injection:** Environment context with per-turn diffs:
- First turn: full environment (cwd, shell, date, network policy)
- Subsequent turns: only changed fields (`diff_from_turn_context_item()`)
- Three-tier instruction priority: config override → session meta → model default

**Key insight:** Codex's background memory extraction is the most sophisticated "automatic learning" system in this comparison. It doesn't ask the agent to write memory — it extracts it *after the fact* from completed threads, then consolidates across threads. This is zero-effort for the agent.

**Relevance to Astro:** Our auto-extraction (`extractKnowledgeFromSummary()`) is a primitive version of Codex's Stage-1. We should consider the two-phase approach: per-task extraction (we have this) + cross-task consolidation (we don't). The thread forking model is also interesting for plan branching.

---

### 4. IronClaw — Full Workspace with Hybrid Search (Most Mature)

**Architecture:** Rust, Postgres + libSQL dual backend. OpenClaw-inspired workspace system. The most feature-complete memory implementation in this comparison.

**Memory model:** Database-backed filesystem:
- `memory_documents` table: flexible paths (e.g., `MEMORY.md`, `daily/2024-01-15.md`, `projects/alpha/notes.md`)
- `memory_chunks` table: chunked documents with FTS index (`content_tsv` tsvector) and vector embeddings (pgvector, 1536-dim)
- Self-documenting with README.md files

**Search:** Hybrid search via Reciprocal Rank Fusion (RRF):
- Full-text search (BM25 via PostgreSQL tsvector or libSQL FTS5)
- Vector semantic search (pgvector, 1536-dim embeddings)
- Score = Sum(1/(k + rank)) across both methods
- Chunking: 800-word chunks, 15% overlap, 50-word minimum

**Agent tools (4):**
- `memory_search` — hybrid search, **MUST be called before answering questions about prior work**
- `memory_write` — persist to memory.md, daily logs, custom paths
- `memory_read` — read any file by path
- `memory_tree` — view workspace structure with depth control

**Identity injection:** Protected files injected into system prompt:
- `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `USER.md`, `TOOLS.md`
- Protected from tool overwrite (prompt injection defense)

**Heartbeat system:** Proactive periodic execution (default 30 min). Reads `HEARTBEAT.md` checklist, runs agent turn, notifies if findings.

**Key insights:**
1. **"Memory is database, not RAM"** — explicit philosophy that if you want to remember, write it to DB
2. **Mandatory search before answering** — `memory_search` description says "MUST be called before answering questions about prior work"
3. **Identity file protection** — prevents prompt injection from overwriting agent identity
4. **Heartbeat** — proactive memory check is unique; agent periodically reviews its workspace

**Relevance to Astro:** IronClaw's workspace is the closest analog to our proposed system. Key differences:
- IronClaw uses flat filesystem paths; we propose tree-structured nodes with typed hierarchy
- IronClaw has vector search; we start with FTS5 only (simpler, no embedding dependency)
- IronClaw mandates memory_search before answers; we should consider similar prompting
- IronClaw's identity file protection is important — we should protect global preferences from agent overwrite

---

### 5. OpenClaw — Session Transcripts + Semantic Memory Index

**Architecture:** TypeScript, session-based with JSONL transcripts. SQLite memory index with optional vector search. Gateway/agent separation.

**Memory model:** Two sources indexed into one search layer:
- **"memory" source:** Static workspace files (AGENTS.md, SOUL.md, TOOLS.md, etc.)
- **"sessions" source:** Session transcripts (conversational history as JSONL, redacted)

**Search:** Configurable hybrid search:
- Vector search (semantic similarity — OpenAI, Gemini, Voyage, Mistral, or local embeddings)
- BM25 keyword search (FTS5)
- Hybrid weights: configurable (default 0.7 vector, 0.3 text)
- MMR (Maximal Marginal Relevance) for diversity
- **Temporal decay** (30-day half-life — penalizes old results)
- Query expansion and keyword extraction

**Session persistence:** Three-layer:
- `sessions.json` — metadata + file path mapping
- `sessions/{id}.jsonl` — append-only event log (messages, tool calls, usage)
- `memory/{agentId}.sqlite` — vector embeddings, FTS5, embedding cache

**Context assembly:** Rich pipeline:
1. Load session transcript → parse message history
2. Bootstrap injection: workspace files (20KB per file, 150KB total cap)
3. History assembly: recent messages + tool results
4. Compaction: if over budget, summarize oldest messages (preserving opaque identifiers)
5. System prompt: tools, skills, runtime metadata

**Key insights:**
1. **Temporal decay** — old memory results are penalized with a 30-day half-life. This prevents stale knowledge from dominating search results.
2. **Session transcript as searchable memory** — past conversations are automatically indexed and searchable. No explicit "save to memory" step needed.
3. **Bootstrap cap (150KB)** — hard limit on workspace file injection prevents context explosion.
4. **Identifier preservation during compaction** — UUIDs, API keys, ticket IDs survive summarization.

**Relevance to Astro:** OpenClaw's temporal decay is a great idea we should adopt. Old findings about a deprecated API shouldn't rank as high as recent architecture decisions. The session-transcript-as-memory approach is interesting but different from our explicit write model — we could index streaming_events similarly as a supplementary source.

---

### 6. Confucius — In-Session Hierarchical Memory (SWE-bench Proven)

**Architecture:** Python + LangChain, Anthropic-first. The memory system that inspired our design. 54.3% SWE-Bench-Pro.

**Memory model:** Tree-structured nodes, in-session only:
- Read, write, edit, delete, search, import operations
- Used to store plans and intermediate state during execution
- **Does NOT persist across sessions** — this is the critical limitation

**TodoReminder extension:** Before first file edit, injects:
> "If this is a complex task, write a todo.md in memory to plan systematically."

**Context management:** LLMPlannerExtension triggers summarization when context exceeds 70K tokens. Not proactive planning — reactive compression.

**Key insight:** Confucius proves that in-session hierarchical memory is sufficient for SWE-bench (54.3%). The memory isn't about cross-session learning — it's about **structured thinking within a task**. The agent uses memory as a scratchpad for plans, findings, and progress tracking.

**Relevance to Astro:** Our `task` scope directly mirrors Confucius's approach. The addition of `project` and `global` scopes is our differentiation — cross-session learning that Confucius lacks. The TodoReminder pattern (prompt agent to plan before editing) is cheap and effective — we should add it.

---

## What to Steal

Based on this analysis, four specific improvements for our hierarchical memory design:

### 1. Temporal Decay (from OpenClaw)

Add a decay factor to memory search ranking. Old entries should rank lower unless they have high priority.

```typescript
function decayScore(node: MemoryNode, baseScore: number): number {
  const ageMs = Date.now() - new Date(node.updatedAt).getTime()
  const halfLifeMs = 30 * 24 * 60 * 60 * 1000 // 30 days
  const decay = Math.pow(0.5, ageMs / halfLifeMs)
  // Priority offsets decay: critical nodes decay 4x slower
  const priorityMultiplier = 1 + node.priority * 3
  return baseScore * decay * priorityMultiplier
}
```

### 2. Reasoning Preservation in Compaction (from FORGE)

When chat history is compacted (separate from memory), extract the last reasoning/thinking block and re-inject it. This maintains the model's chain of thought across compaction boundaries.

### 3. Mandatory Memory Search Prompting (from IronClaw)

Add to the `memory_search` tool description:
> "MUST be called before answering questions about prior work or making decisions that depend on project history."

This behavioral nudge ensures the agent actually uses memory instead of hallucinating from stale context.

### 4. TodoReminder / Pre-Edit Planning (from Confucius)

Before the agent's first file edit in a task, inject a reminder:
> "Before editing files, check if this is a complex task. If so, write a plan to `task/plan` in memory."

This is the cheapest intervention with the highest impact on multi-step task completion.

---

## Architecture Positioning

```
No Memory ──────────────────────────────────── Full Knowledge Graph
   │                                                    │
   Aider        Codex       FORGE      Astro    OpenClaw    IronClaw
   (stateless)  (background (conv DB)  (tree +  (hybrid     (workspace +
                extraction)            FTS)     vector+FTS) vector+FTS)
                                  ▲
                                  │
                              Confucius
                              (in-session
                               tree only)
```

**Astro's position:** We're to the right of FORGE and Codex (explicit tree structure, agent-writable tools) but to the left of IronClaw/OpenClaw (no vector search initially, simpler storage). This is intentional — we optimize for:

1. **Zero external dependencies** (SQLite, no embedding server)
2. **Offline-capable** (works on HPC nodes without internet)
3. **Agent-writable** (unlike FORGE/Codex where memory is infrastructure)
4. **Cross-project** (unlike Confucius which is session-scoped)

The upgrade path to vector search (Phase 6) is straightforward: add `sqlite-vss` or switch to the server's pgvector.

---

## Feature Matrix Summary

| Feature | Aider | FORGE | Codex | IronClaw | OpenClaw | Confucius | **Astro** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Persistent across sessions | opt-in | yes | yes | yes | yes | **no** | yes |
| Structured (not flat) | no | no | no | **yes** | no | **yes** | **yes** |
| Agent can write memory | no | no | no | **yes** | no | **yes** | **yes** |
| Agent can search memory | no | semantic | no | **hybrid** | no | path-based | **FTS** |
| Cross-project knowledge | no | no | no | yes | yes | no | **yes** |
| Selective context injection | no | no | env diff | identity files | bootstrap cap | tree-scoped | **budget-scoped** |
| Background auto-extraction | no | no | **yes** | no | **yes** | no | **yes** |
| Vector search | no | **yes** | no | **yes** | **yes** | no | planned |
| Temporal decay | no | no | no | no | **yes** | no | planned |
| Identity protection | no | no | no | **yes** | no | no | planned |
| Compaction with reasoning | no | **yes** | no | no | yes | yes | planned |
| Pre-edit planning nudge | no | no | no | no | no | **yes** | planned |

---

## Implementation Priority (Updated)

Based on this comparison, the implementation order from [HIERARCHICAL_MEMORY.md](HIERARCHICAL_MEMORY.md) is validated with these additions:

| Phase | Feature | Informed By |
|---|---|---|
| 1 | Local SQLite memory store + 6 MCP tools | Confucius (tree), IronClaw (tools) |
| 1.5 | **Pre-edit planning nudge** | Confucius TodoReminder |
| 1.5 | **Mandatory search prompting** | IronClaw memory_search |
| 2 | Auto-extraction into tree | Existing system + Codex Stage-1 |
| 3 | Server-side Postgres + sync | IronClaw (Postgres), FORGE (conversation DB) |
| 4 | Web UI tree view | IronClaw memory_tree |
| 5 | Selective injection with budgets | OpenClaw (bootstrap cap), Confucius (scoped) |
| 5.5 | **Temporal decay** | OpenClaw (30-day half-life) |
| 6 | Vector search (sqlite-vss or pgvector) | IronClaw (RRF), OpenClaw (hybrid) |
| 6 | **Identity/preference protection** | IronClaw (protected files) |
