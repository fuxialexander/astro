# Deep Dive: Agent Architecture, Tools, Context, and Storage Across the Claw Ecosystem

> A detailed comparison of design choices in OpenClaw, NanoClaw, HappyClaw, IronClaw, and Astro Agent Runner — with analysis of trade-offs and recommendations for what Astro should adopt.

---

## Part 1: Agent Architecture — How Each System Thinks

The most fundamental design choice in any agent system is: **who controls the reasoning loop?** Every other decision flows from this.

### 1.1 The Two Camps

There are exactly two patterns in these five systems:

**Camp A: "I own the loop"** — The system makes the LLM call itself, parses the response, dispatches tools, and feeds results back. It sees every token.

- **OpenClaw**: Embeds the Pi runtime in-process. The `run.ts` file (48KB) orchestrates the full cycle: model selection → API call → tool dispatch → result accumulation → retry/compaction → next turn.
- **IronClaw**: Implements `run_agentic_loop()` in Rust. A single function shared by three "delegates" (Chat, Job, Container) that differ in how they handle text responses and signals, but share the same core loop.

**Camp B: "I wrap a black box"** — The system spawns an external agent (Claude Code SDK, Codex CLI, etc.) and consumes its output stream. It cannot see or influence the agent's reasoning.

- **NanoClaw**: Spawns a Docker container, runs `query()` from the Claude Agent SDK inside it, reads stdout markers.
- **HappyClaw**: Same architecture as NanoClaw, but adds WebSocket streaming to a web UI.
- **Astro Runner**: Wraps four different agents (Claude SDK, Codex, OpenClaw, OpenCode) through provider adapters.

### 1.2 What "Owning the Loop" Actually Means

Let's trace a single turn through both camps to make the difference concrete.

#### OpenClaw: One Turn (Camp A)

```
User says: "Fix the login bug in auth.ts"
                    │
                    ▼
 ┌─────────────────────────────────────────────────────┐
 │  run.ts: runEmbeddedAttempt()                       │
 │                                                      │
 │  1. resolveModel()                                   │
 │     - Check auth profile rotation (12+ providers)    │
 │     - Apply failover order                           │
 │     - Plugin hook: before_model_resolve              │
 │     ─► Selected: claude-sonnet-4-6 via profile #2   │
 │                                                      │
 │  2. Build payload                                    │
 │     - System prompt (AGENTS.md + SOUL.md + TOOLS.md) │
 │     - Message history (from JSONL session file)      │
 │     - Tool definitions (45+ tools, policy-filtered)  │
 │     - Plugin hook: before_prompt_build               │
 │                                                      │
 │  3. Call Anthropic Messages API directly              │
 │     ─► Stream response token by token                │
 │     ─► Accumulate usage (input/output/cache tokens)  │
 │     ─► Track cost in real-time                       │
 │                                                      │
 │  4. Parse response                                   │
 │     ─► Text block: "I'll read auth.ts first"         │
 │     ─► Tool call: read(path="src/auth.ts")           │
 │                                                      │
 │  5. Execute tool                                     │
 │     - Resolve tool from registry                     │
 │     - Check tool policy (workspace → group → owner)  │
 │     - Plugin hook: before_tool_call                  │
 │     - Execute read() ─► returns file contents        │
 │     - Plugin hook: after_tool_call                   │
 │     - Sanitize output (image size limits, redaction)  │
 │                                                      │
 │  6. Append tool result to messages                   │
 │     ─► Go back to step 3 (next turn)                │
 └─────────────────────────────────────────────────────┘
```

At every step, OpenClaw can:
- Choose a different model based on task complexity
- Inject additional context from plugins
- Intercept and modify tool calls before execution
- Modify tool results before feeding back to the model
- Count exact tokens and enforce budgets
- Log structured telemetry per turn

#### NanoClaw: One Turn (Camp B)

```
User says: "Fix the login bug in auth.ts"
                    │
                    ▼
 ┌─────────────────────────────────────────────────────┐
 │  index.ts: runContainerAgent()                       │
 │                                                      │
 │  1. Build volume mounts                              │
 │     - /workspace/group (writable)                    │
 │     - /workspace/global (read-only)                  │
 │     - /workspace/ipc (IPC namespace)                 │
 │     - /home/node/.claude (session data)              │
 │                                                      │
 │  2. docker run -i --rm ...                           │
 │     ─► Pass prompt via stdin (JSON)                  │
 │                                                      │
 │  3. ┌─────────── INSIDE CONTAINER ──────────────┐   │
 │     │  agent-runner/index.ts:                    │   │
 │     │                                            │   │
 │     │  query({                                   │   │
 │     │    prompt: "Fix the login bug...",         │   │
 │     │    model: 'claude-opus-4-1',              │   │
 │     │    allowedTools: [...],                    │   │
 │     │    mcpServers: { nanoclaw: ... }           │   │
 │     │  })                                        │   │
 │     │                                            │   │
 │     │  ═══════════════════════════════            │   │
 │     │  ║  BLACK BOX: Claude Agent SDK  ║         │   │
 │     │  ║  - Makes its own LLM calls    ║         │   │
 │     │  ║  - Picks its own model        ║         │   │
 │     │  ║  - Manages its own context    ║         │   │
 │     │  ║  - Dispatches its own tools   ║         │   │
 │     │  ║  - We cannot see inside       ║         │   │
 │     │  ═══════════════════════════════            │   │
 │     │                                            │   │
 │     │  ─► Write result to stdout markers         │   │
 │     └────────────────────────────────────────────┘   │
 │                                                      │
 │  4. Parse stdout markers                             │
 │     ─► Extract text between OUTPUT_START/END         │
 │     ─► Send to user via channel                      │
 └─────────────────────────────────────────────────────┘
```

NanoClaw cannot:
- Change the model mid-execution
- Inject context between turns
- See individual tool calls as they happen (only NanoClaw's own 6 MCP tools are visible)
- Count tokens or enforce budgets
- Collect logprobs for training

**But it gets something critical in return**: the full power of Claude Code (multi-file editing, search, test running, git operations, etc.) without having to implement any of those tools. Every SDK upgrade is a free capability upgrade.

### 1.3 IronClaw's Loop: The Most Sophisticated

IronClaw's loop is worth examining in detail because it demonstrates what "full ownership" looks like in practice.

**The Delegate Pattern:**

IronClaw has a single `run_agentic_loop()` function, but three different "delegates" that customize its behavior:

```
                    run_agentic_loop()
                    ┌──────────────┐
                    │  1. check_signals()     ─── delegate decides
                    │  2. before_llm_call()   ─── delegate decides
                    │  3. call_llm()          ─── delegate owns
                    │  4. handle response:
                    │     text? ─► handle_text_response() ─── delegate decides
                    │     tools? ─► execute_tool_calls()  ─── delegate decides
                    │  5. after_iteration()   ─── delegate observes
                    └──────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ChatDelegate  JobDelegate  ContainerDelegate
         ────────────  ───────────  ──────────────────
         Interactive    Background   Docker worker
         Session lock   Planning     Sequential tools
         Turn tracking  Independent  LLM proxy
         Skill inject   execution    Bearer token auth
```

**ChatDelegate** handles interactive conversations — it acquires a session lock (preventing two concurrent chats), tracks turn counts, and injects skill context.

**JobDelegate** handles background tasks — it runs independently, supports a planning phase, and reports status to the job tracker.

**ContainerDelegate** handles Docker workers — it runs inside a container with bearer token auth and proxies LLM calls through the orchestrator (the container never talks to the LLM directly).

All three share the same tool dispatch, safety checks, and iteration logic. This is elegant because adding a new execution mode (say, SLURM) only requires a new delegate — not a new loop.

**Tool Intent Nudge:**

A unique IronClaw feature: when the LLM says "Let me search for that file..." but doesn't actually call any tool, IronClaw detects this and injects a nudge: "I notice you mentioned using a tool but didn't call one. Please use the available tools." This prevents the LLM from getting stuck in a reasoning-only loop. Max 2 nudges per execution to avoid infinite loops.

### 1.4 What Astro Does Today (and What It Cannot Do)

Astro's agent-runner uses the **Adapter + Strategy** dual pattern:

```
               ┌── Provider Adapter ──┐   ┌── Execution Strategy ──┐
               │  WHAT agent to use   │   │  WHERE to run it       │
               │                      │   │                        │
               │  claude-sdk-adapter  │   │  DirectStrategy        │
               │  codex-adapter       │ × │  SlurmStrategy         │
               │  openclaw-adapter    │   │  DockerStrategy        │
               │  opencode-adapter    │   │  K8sExecStrategy       │
               └──────────────────────┘   │  SSHStrategy           │
                                          └────────────────────────┘
```

Any provider can run on any strategy — this is orthogonal and powerful. But the **provider adapters are thin wrappers**:

- `ClaudeSdkAdapter` calls `query()` from the Claude Agent SDK in-process
- `CodexAdapter` spawns `codex` as a subprocess and parses JSONL output
- `OpenClawAdapter` spawns `openclaw` CLI and parses output
- `OpenCodeAdapter` spawns `opencode` CLI and parses output

The runner adds real value around the execution: worktree isolation, streaming events, PR automation, approval routing, merge conflict resolution. But it cannot influence the agent's reasoning in any way except:
- The initial prompt (via `ContextAssembler`)
- Mid-execution steering (Claude SDK only, via `Query.streamInput()`)

---

## Part 2: Tool Systems — How Each System Acts on the World

### 2.1 The Spectrum of Tool Ownership

```
Fully owned tools ◄──────────────────────────────────────► Fully delegated tools

IronClaw          OpenClaw          HappyClaw    NanoClaw    Astro Runner
(20+ built-in     (45+ built-in     (10 MCP      (6 MCP      (0 own tools,
 + WASM sandbox   + Plugin SDK)     + Claude      + Claude    delegates to
 + MCP servers)                      Code tools)  Code tools) wrapped agent)
```

### 2.2 IronClaw: Three-Tier Tool Architecture

IronClaw has the most sophisticated tool system. Tools come from three sources, all unified under a single `Tool` trait:

**Tier 1: Built-in Tools (Rust, 20+)**

These run in the host process with full system access:

| Tool | What It Does | Approval Required? |
|------|-------------|-------------------|
| `read_file` | Read up to 1MB, supports offset/limit | Never |
| `write_file` | Write up to 5MB, blocks workspace special paths | UnlessAutoApproved |
| `list_dir` | List up to 500 entries | Never |
| `shell` | Execute shell commands with security layers | UnlessAutoApproved |
| `memory_search` | Hybrid FTS + vector search across workspace | Never |
| `memory_write` | Persist facts, blocks identity files | Never |
| `create_job` | Spawn background tasks | Never |
| `http` | Make HTTP requests with endpoint allowlisting | Always (if auth) |

The `shell` tool has four security layers before executing anything:
1. **Exact match blocklist**: `rm -rf /`, fork bombs
2. **Substring patterns**: `sudo`, `eval`, `$(curl`
3. **Injection detection**: base64-piped-to-sh, DNS exfiltration, netcat
4. **Sandbox enforcement**: if Docker is available, runs inside container

**Tier 2: WASM Tools (Sandboxed, Dynamic)**

This is IronClaw's most distinctive feature. Third-party tools run in a WebAssembly sandbox with:

- **Fuel metering**: Each WASM instruction costs fuel. When fuel runs out (default 10M units), execution traps. This prevents infinite loops and enforces compute budgets.
- **Memory limits**: 10MB default. WASM cannot allocate beyond this.
- **Capability-based permissions**: A tool gets exactly the capabilities it needs, nothing more:

```
capabilities.json for a "GitHub Issues" WASM tool:
{
  "http": {
    "allowed_domains": ["api.github.com"],
    "auth_header": "Authorization: Bearer {SECRET:github_token}"
  },
  "secrets": {
    "allowed": ["github_token"]
  },
  "workspace_read": {
    "allowed_prefixes": ["context/"]
  }
}
```

The tool can call `api.github.com` (and nothing else), read secrets by name (but not by value — the host injects the actual token), and read workspace files under `context/`. It cannot make arbitrary HTTP requests, read other secrets, write to workspace, or call other tools.

- **Leak detection**: Before any HTTP request leaves the sandbox, and after any response comes back, IronClaw scans for credential patterns (API keys, JWTs, SSH keys, database URLs). If a WASM tool tries to exfiltrate a secret via a URL parameter or HTTP body, the request is blocked.

**Tier 3: MCP Servers (External, Full Trust)**

Standard Model Context Protocol servers connect via HTTP, stdio, or Unix sockets. These have full system access (no WASM sandbox) — the trade-off is ecosystem breadth vs. security.

**Why three tiers?** Because different tools need different trust levels:
- File operations → built-in (trusted, fast)
- GitHub API → WASM (sandboxed, can't exfiltrate tokens)
- Postgres queries → MCP (needs full network access, trusted)

### 2.3 OpenClaw: Plugin-Driven Tool Ecosystem

OpenClaw's tools use **TypeBox schemas** for type-safe parameter definitions. The key pattern:

```typescript
// TypeBox schema (flattened, not union — Vertex AI rejects nested anyOf)
const BrowserActSchema = Type.Object({
  kind: stringEnum(['click', 'type', 'navigate', ...]),
  targetId: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  // All action params flattened into one object
});

// Tool implementation
export function createBrowserTool(): AnyAgentTool {
  return {
    name: "browser",
    description: "Control a browser via Chrome DevTools Protocol",
    parameters: BrowserToolSchema,
    execute: async (_toolCallId, args) => {
      // Dispatch based on args.kind
    }
  };
}
```

**Tool Policy Pipeline** — OpenClaw's most interesting tool-level feature. Tools pass through a multi-step filter:

```
All registered tools (45+ built-in + plugin tools)
    │
    ▼
Step 1: Profile-specific policy (tools.profile)
    │   "Only allow read/write/exec for this agent profile"
    ▼
Step 2: Provider profile policy (tools.byProvider.profile)
    │   "When using Anthropic, also allow browser"
    ▼
Step 3: Global allowlist (tools.allow)
    │   "Allow these tools for all sessions"
    ▼
Step 4: Agent-specific policy (agents.{id}.tools.allow)
    │   "This specific agent also gets canvas"
    ▼
Step 5: Group policy (group tools.allow)
    │   "In this Slack channel, restrict to read-only tools"
    ▼
Step 6: Owner-only filter
    │   "cron, gateway tools only available to device owner"
    ▼
Final: Filtered tool list sent to LLM
```

This pipeline means the same agent running in a WhatsApp DM vs. a public Discord channel gets different tools — automatically. An agent helping in a read-only research channel cannot modify files.

**Plugin tools** are contributed by external packages:

```typescript
// A plugin registers tools via factory
pluginApi.registerTools((ctx) => {
  return createMyCustomTool(ctx.workspaceDir);
}, { name: "my-tool" });
```

Plugins also get **23 lifecycle hooks** (before_model_resolve, before_tool_call, after_tool_call, message_received, etc.) — making OpenClaw's tool system the most extensible of the five.

### 2.4 NanoClaw / HappyClaw: Thin MCP Layer Over Claude Code

Both NanoClaw and HappyClaw take the opposite approach: delegate almost all tool execution to the Claude Agent SDK inside the container, and only add a thin MCP layer for system-level operations.

**NanoClaw's 6 MCP tools:**
```
send_message     ─── Send a message to the user/group mid-execution
schedule_task    ─── Create a cron/interval/once scheduled task
list_tasks       ─── List scheduled tasks
update_task      ─── Modify a task
delete_task      ─── Cancel a task
register_group   ─── Register a new group (main group only)
```

**HappyClaw adds 3 more:**
```
memory_append    ─── Append to date-stamped memory file (max 16KB/append, 512KB/file)
memory_search    ─── Full-text search across memory + CLAUDE.md + conversations
memory_get       ─── Read a specific memory file or line range
```

Everything else — file editing, bash execution, web search, glob, grep — comes from Claude Code's built-in tools running inside the container.

**The IPC protocol** is filesystem-based. The agent writes a JSON file to `/workspace/ipc/messages/` to send a message; the host process polls that directory and delivers it. This is simple and robust — no sockets, no serialization libraries — but it's also slow (polling interval) and one-directional per channel.

### 2.5 What This Means for Astro

Astro currently has **zero own tools**. Everything is delegated to the wrapped agent. This is the furthest point on the "delegation" spectrum.

The Native Agent Core design proposes ~8 built-in tools. Comparing with the reference implementations:

| Tool | IronClaw | OpenClaw | Difficulty | Notes |
|------|----------|---------|-----------|-------|
| `file_read` | `ReadFileTool` (1MB limit, offset/limit) | `read` (pi-coding-agent) | Low | Straightforward |
| `file_write` | `WriteFileTool` (5MB limit, path validation) | `write` (pi-coding-agent) | Low | Block sensitive paths |
| `file_edit` | `ApplyPatch` (git diff format) | `edit` (pi-coding-agent) | **Very High** | Fuzzy matching is the hardest tool to build correctly |
| `bash` | `ShellTool` (4 security layers, 120s timeout) | `exec` (pi-coding-agent) | Medium | Security is the challenge, not execution |
| `glob` | `ListDirTool` (500 entry limit) | Native in Pi | Low | Pattern matching library |
| `grep` | Part of memory search | Native in Pi | Low | Regex library |
| `git` | Not standalone (part of workspace) | Not standalone | Medium | Status, diff, commit, push |
| `ask_user` | `JobPromptTool` (approval during execution) | Not needed (in-process) | Low | Reuse existing MCP bridge |

**Key lesson**: `file_edit` is the hardest tool. IronClaw sidesteps it by using git-style patch format (`ApplyPatch`). OpenClaw delegates to the Pi coding agent's edit tool. Both avoid building fuzzy-match search/replace from scratch. Astro should start with exact-match or patch-based editing and only add fuzzy matching after benchmarking.

---

## Part 3: Context Management — How Each System Handles Memory Limits

### 3.1 The Problem

LLMs have finite context windows. A complex coding task might involve:
- System prompt with vision doc, dependencies, instructions (~5K tokens)
- 50 turns of conversation (~3K tokens each = 150K tokens)
- Tool results with file contents, command output (~2K-50K each)

Without management, a moderately complex task blows through even a 200K context window. Each system handles this differently.

### 3.2 IronClaw: Three-Tier Progressive Compaction

IronClaw monitors context usage continuously via a `ContextMonitor` that estimates tokens (~1.3 tokens/word + 4 overhead/message) and applies progressively more aggressive strategies:

```
Context usage:    0%          80%           85%           95%        100%
                  │            │             │             │           │
                  │  Normal    │  Archive    │  Summarize  │ Truncate  │
                  │  operation │  to daily   │  via LLM    │ (drop     │
                  │            │  log file   │  (temp=0.3) │  oldest)  │
                  │            │             │             │           │
                  ▼            ▼             ▼             ▼           ▼

Tier 1: MoveToWorkspace (80-85% usage)
  - Format old turns preserving metadata (tool calls, turn numbers)
  - Write full transcript to workspace/daily/YYYY-MM-DD.md
  - Keep 10 most recent turns in memory
  - Agent can later search daily logs via memory_search
  - If workspace write fails: KEEP turns (never lose context on storage failure)

Tier 2: Summarize (85-95% usage)
  - Extract old turns (before threshold)
  - Call LLM to summarize: temperature=0.3, max_tokens=1024
  - Write summary to daily log
  - Keep 5 most recent turns verbatim
  - More aggressive: loses detail but preserves key decisions

Tier 3: Truncate (>95% usage, emergency)
  - Simply drop oldest turns, keep 3 recent
  - No summarization (too close to limit for another LLM call)
  - Last resort — detail loss is significant
```

**Critical safety property**: If the workspace write fails during archival, turns are preserved in memory. Context is never lost due to a storage error. This is a thoughtful design — many systems would silently drop context on write failure.

**The daily log pattern**: Archived turns go to `workspace/daily/2026-03-11.md`. The agent can later search these via `memory_search` (hybrid FTS + vector). So "forgotten" context isn't truly lost — it's moved from working memory to long-term searchable storage.

### 3.3 OpenClaw: Compaction with Diagnostic Tracking

OpenClaw's compaction (`compact.ts`, 29KB) is the most instrumented:

```
1. Generate diagnostic ID: cmp-{timestamp}-{secureToken}
2. Calculate per-role metrics:
   - Character counts per role (user, assistant, tool)
   - Token estimates via estimateTokens()
   - Top 3 contributors by character count
3. Check guards:
   - Is compaction already in progress?
   - Was last compaction too recent?
   - Is context below threshold?
4. Execute compaction:
   - Remove old turns, generate summary
   - Retry with exponential backoff on failure
5. Classify outcome:
   - no_compactable_entries | below_threshold | already_compacted_recently
   - guard_blocked | summary_failed | timeout
   - provider_error_4xx | provider_error_5xx | unknown
```

**Token counting subtlety**: OpenClaw discovered that naively accumulating token counts across multi-tool-call turns gives wrong results. Each API call reports `cacheRead ≈ current_context_size`. If a turn has 5 tool calls, summing gives `5 × context_size`, which is 5x too high. The fix:

```typescript
// WRONG: accumulate all API calls
totalTokens += apiCall.cacheRead;  // Inflated by N tool calls per turn

// RIGHT: use only the LAST API call's cache fields
usageAccumulator.lastCacheRead = apiCall.cacheRead;  // Accurate context size
usageAccumulator.output += apiCall.output;  // Output does accumulate
```

This is a real-world bug that any system building its own loop will encounter.

**Auto-compaction on overflow**: When an API call fails with a context overflow error (`isLikelyContextOverflowError()`), OpenClaw tries up to 3 recovery attempts:
1. Truncate oversized tool results (`truncateOversizedToolResultsInSession()`)
2. Run full compaction
3. Retry the API call

### 3.4 HappyClaw: Memory Flush on Compaction

HappyClaw adds a unique pattern: when the Claude Agent SDK triggers its own compaction (via the PreCompact hook), HappyClaw runs a **memory flush** — a separate short agent query with restricted tools that writes important information to persistent memory files before context is lost.

```
Context approaching limit
         │
         ▼
Claude SDK PreCompact hook fires
         │
         ▼
HappyClaw intercepts:
  1. Archive conversation to conversations/ directory
  2. If this is an admin home container:
     - Run a short query with restricted tools
     - "Save any important information from this session to memory"
     - Agent writes to memory/YYYY-MM-DD.md
  3. SDK proceeds with its own compaction
```

This means HappyClaw's agent actively decides what's worth remembering before context is compressed. It's like giving the agent a moment to write notes before its short-term memory is wiped.

### 3.5 NanoClaw: Fully Delegated

NanoClaw delegates all context management to the Claude Agent SDK. It registers a PreCompact hook that archives transcripts, but does not intervene in the compaction itself. This is the simplest approach — and it works because Claude Code's context management is already quite good.

### 3.6 Astro Runner: Not Managed

Astro's runner does not manage context at all. Each provider adapter handles context internally:
- Claude SDK adapter: SDK manages its own context
- Codex/OpenClaw/OpenCode adapters: those CLIs manage their own

The Native Agent Core design proposes a compaction system similar to IronClaw's three-tier approach but with DAG awareness — when a sibling task completes, its output can be injected as new context.

### 3.7 Comparison Summary

```
                     Awareness     Compaction    Recovery      Memory
                     of tokens     strategy      from loss     persistence
                     ─────────     ──────────    ──────────    ──────────
IronClaw             Continuous    3-tier        Daily logs    Hybrid search
                     monitoring    (archive →    (searchable   (FTS + vector)
                     (~1.3 tok/w)  summarize →   via memory
                                   truncate)     tools)

OpenClaw             Per-API-call  Diagnostic    Retry with    Session JSONL
                     tracking      compaction    truncation    (append-only)
                     (cache field  (instrumented + compaction
                     correction)   with failure  up to 3x
                                   classification)

HappyClaw            Delegated     SDK-managed   Memory flush  Date-based
                     to SDK        + memory      before        memory files
                                   flush hook    compaction    + global CLAUDE.md

NanoClaw             Delegated     SDK-managed   Transcript    Per-group
                     to SDK                      archival      CLAUDE.md

Astro Runner         Delegated     Delegated     None          streaming_events
                     to agent      to agent                    table (append-only)
```

---

## Part 4: Storage — How Each System Persists State

### 4.1 The Design Space

Each system makes a different trade-off between simplicity, queryability, and durability:

### 4.2 OpenClaw: JSONL Session Files

OpenClaw stores everything in the filesystem — no database.

**Session files**: `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`

Each line is a JSON object:
```json
{"type":"message","message":{"role":"user","content":"Fix the login bug"}}
{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"I'll read..."},{"type":"tool_use","id":"call_1","name":"read","input":{"path":"auth.ts"}}]}}
{"type":"message","message":{"role":"tool","content":"// file contents..."}}
```

**Advantages**:
- Append-only (crash-safe — a partial write loses one line, not the whole file)
- Human-readable (you can `cat` a session to see what happened)
- No database dependency (works on any filesystem)
- Line mapping: each output line maps back to its source JSONL line for reconstruction

**Disadvantages**:
- No indexing (searching across sessions requires reading every file)
- No cross-session queries (e.g., "which sessions used the browser tool?")
- No concurrent access safety (single-user assumption)
- No TTL/eviction built in

**Config store**: A JSON file with TTL-based in-memory cache (45s default, invalidated on writes). Normalizes session keys to lowercase with legacy mixed-case migration.

### 4.3 IronClaw: Dual-Backend Relational Database

IronClaw supports two database backends behind a single trait:

**PostgreSQL** (production):
- Connection pool via Deadpool
- pgvector extension for embedding storage
- Full-text search via `tsvector` + `ts_rank_cd`
- Proper transactions and concurrent access

**libSQL/Turso** (edge/development):
- SQLite fork with replication support
- Local embedded mode (file-based)
- Cloud replica with sync
- In-memory mode for testing
- 3x retry with exponential backoff for concurrency

**Key tables**:

```sql
-- Chat history
conversations (id, created_at, updated_at, metadata)
conversation_messages (id, conversation_id, role, content, created_at)

-- Job execution trace
agent_jobs (id, status, prompt, result, created_at, completed_at, cost, tokens)
job_actions (id, job_id, tool_name, input, output_raw, output_sanitized,
             cost, duration_ms, error_message, created_at)

-- LLM call tracking
llm_calls (id, model, provider, prompt_tokens, completion_tokens, cost, latency_ms)

-- Workspace memory with embeddings
memory_documents (id, path, content, updated_at)
memory_chunks (id, document_id, content, content_tsv TSVECTOR,
               embedding VECTOR(1536), chunk_index)

-- Scheduled tasks
routines (id, name, schedule, trigger_type, last_run, next_run, status)
routine_runs (id, routine_id, started_at, completed_at, status, result)

-- Dynamic tools
dynamic_tools (id, name, wasm_binary, capabilities_json, created_at)
```

**Hybrid search** on memory_chunks:
```
Score = RRF(FTS_rank, vector_cosine_similarity)
      = 1/(k + fts_rank) + 1/(k + vector_rank)
```
Where `k=60` (standard RRF constant). Documents appearing in both FTS and vector results get boosted.

**Why dual-backend?** PostgreSQL is the right choice for production (indexing, transactions, pgvector), but it's heavy for development or edge deployments. libSQL provides SQLite compatibility with Turso replication for globally distributed read replicas.

### 4.4 NanoClaw / HappyClaw: SQLite

Both use `better-sqlite3` (synchronous, WAL mode) for operational state:

**NanoClaw tables**:
```sql
chats (jid, name, channel, is_group)
messages (id, chat_jid, sender, content, timestamp, is_from_me)
registered_groups (jid, name, folder, trigger_pattern, container_config)
scheduled_tasks (id, group_folder, prompt, schedule_type, schedule_value, next_run)
task_run_logs (task_id, run_at, duration_ms, status, result, error)
sessions (group_folder, session_id)
```

**HappyClaw adds**:
```sql
users (id, username, password_hash, role, status, created_at)
user_sessions (token, user_id, expires_at, last_active_at)
audit_log (id, user_id, event_type, details, ip, created_at)
-- Schema evolved from v1 to v13 via migration functions
```

Session data (the actual Claude conversation history) is stored on the **filesystem** in `data/sessions/{folder}/.claude/`, not in SQLite. SQLite is for operational metadata only.

### 4.5 Astro Runner: Server-Side Persistence

Astro's runner is stateless — all persistence happens server-side:

- **streaming_events table** (Postgres/PGlite): Append-only log of all execution events (text, tool_use, tool_result, file_change, progress, etc.). Seq-indexed for efficient catch-up.
- **plan_nodes table**: Task status, execution metadata, summaries
- **Hydration on refresh**: `useRestoredExecution` reconstructs UI state from `streaming_events` — the runner doesn't need to persist anything locally.

The runner keeps only a small config file (`~/.astro/config.json`) with machine ID, auth tokens, and provider list.

### 4.6 Comparison

```
                Database       Session Storage     Search          Durability
                ──────────     ───────────────     ──────          ──────────
OpenClaw        None (files)   JSONL files         None            Append-only
                                                   (scan all       (crash-safe
                                                    files)          per-line)

IronClaw        Postgres       DB tables           Hybrid FTS      Full ACID
                + libSQL       (conversations,     + vector        transactions
                (dual)         job_actions)        (pgvector)

NanoClaw        SQLite         Filesystem          None            WAL mode
                               (.claude/ dirs)

HappyClaw       SQLite         Filesystem          Full-text       WAL mode
                               (.claude/ dirs)     (memory tools)  + migrations

Astro Runner    None (local)   Server-side         Via Astro       streaming_events
                               (streaming_events)  server          (append-only,
                                                                    seq-indexed)
```

---

## Part 5: What Astro Should Borrow

Based on the detailed analysis above, here are specific patterns worth adopting, ordered by impact:

### 5.1 From IronClaw: The Delegate Pattern for the Agent Loop

**What**: A single `agentLoop()` function with a `LoopDelegate` trait that customizes behavior per execution context.

**Why**: Astro already has three execution contexts (task execution, chat, plan generation). Rather than building three separate loops, build one loop with three delegates. This is exactly what IronClaw does with Chat/Job/Container delegates.

**Concrete benefit**: When adding a new execution context (e.g., benchmark evaluation), you write a new delegate, not a new loop.

### 5.2 From IronClaw: Three-Tier Context Compaction

**What**: Continuous token monitoring with progressive strategies (archive → summarize → truncate), where archived content goes to searchable long-term storage.

**Why**: The "archive to daily log, then search later" pattern means context is never truly lost — just moved from working memory to long-term memory. Astro's `streaming_events` table already provides the storage layer; adding a compaction middleware that writes summaries back to the DB would be straightforward.

**Key detail to copy**: The safety property that archival failures preserve turns in memory. Never drop context due to storage errors.

### 5.3 From OpenClaw: Tool Policy Pipeline

**What**: A composable, multi-step tool filter that restricts available tools based on workspace, group, agent, and owner context.

**Why**: In Astro, different task types should get different tools. An XS cleanup task doesn't need browser automation. A research task shouldn't have git push. A tool policy pipeline lets you configure this declaratively rather than in code.

**Astro adaptation**: Filter tools based on task estimate (XS/S/M/L/XL), task type (execution/chat/plan), and project settings.

### 5.4 From OpenClaw: Token Counting Correction

**What**: Use only the last API call's cache fields for context size estimation, not accumulated totals.

**Why**: This is a subtle but critical bug that any system building its own agent loop will hit. When a single turn involves multiple tool calls, each API call reports `cacheRead ≈ current_context_size`. Naively summing gives `N × context_size`. OpenClaw discovered this the hard way.

### 5.5 From IronClaw: WASM Tool Sandboxing (Future)

**What**: Untrusted tools run in WASM with fuel metering, memory limits, capability-based permissions, and leak detection.

**Why**: As Astro's tool ecosystem grows, not all tools should be trusted equally. WASM provides a lightweight sandbox (much faster than Docker) with precise resource control. The capability-based permission model (this tool can call `api.github.com` and nothing else) is exactly right for a multi-tenant system.

**When**: Phase 2-3 of the Native Agent Core. Not needed immediately, but the architecture should allow for it.

### 5.6 From IronClaw: LLM Provider Decorator Chain

**What**: Layer providers with Retry → SmartRouting → Failover → CircuitBreaker → Cache → Recording.

**Why**: The circuit breaker pattern is particularly valuable — if an API is down, stop hammering it (5 consecutive failures → open circuit → wait 30s → probe). This prevents cascading failures and reduces cost from wasted retries.

**Smart routing** is also interesting: a 13-dimension complexity scorer routes simple queries to cheap models and complex ones to expensive models. Astro already has task estimates (XS-XL) which is a simpler but effective signal for the same purpose.

### 5.7 From HappyClaw: Memory Flush Before Compaction

**What**: Before context is compressed, give the agent a moment to write important information to persistent memory.

**Why**: This is cheap (one short agent query) but high-value. The agent knows what's important in its current context better than any heuristic. Letting it save notes before compression preserves key decisions, discovered bugs, and partial progress that would otherwise be lost.

**Astro adaptation**: Before compaction, have the agent update the task's `executionOutput` field with a structured summary of progress so far.

### 5.8 From NanoClaw: Credential Proxy

**What**: A dedicated HTTP proxy that injects API credentials at the network boundary. The agent process never sees real keys.

**Why**: When Astro dispatches tasks to remote machines or containers, credential isolation becomes critical. NanoClaw's approach (container gets `ANTHROPIC_API_KEY=placeholder`, proxy swaps it for the real key on every request) is the cleanest solution. The agent literally cannot leak credentials because it never has them.

**Astro adaptation**: The ContainerDelegate (for Docker/K8s execution strategies) should use this pattern.

### 5.9 From IronClaw: Tool Intent Nudge

**What**: When the LLM says "Let me search for that file" but doesn't actually call a tool, inject a nudge message to encourage tool use.

**Why**: This is a common failure mode — the LLM describes what it would do instead of doing it. A simple nudge (max 2 per execution) recovers most of these cases without complex prompt engineering.

### 5.10 Priority Ranking for Astro

| Priority | Pattern | Source | Phase |
|----------|---------|--------|-------|
| **P0** | Delegate pattern for agent loop | IronClaw | Phase 1 |
| **P0** | Token counting correction (last-call cache) | OpenClaw | Phase 1 |
| **P0** | Tool intent nudge | IronClaw | Phase 1 |
| **P1** | Three-tier context compaction | IronClaw | Phase 3 |
| **P1** | Tool policy pipeline | OpenClaw | Phase 2 |
| **P1** | Memory flush before compaction | HappyClaw | Phase 3 |
| **P1** | LLM provider decorator chain | IronClaw | Phase 2 |
| **P2** | Credential proxy for containers | NanoClaw | Phase 2 (Docker strategy) |
| **P2** | WASM tool sandboxing | IronClaw | Phase 4+ |
| **P2** | Smart routing (complexity scoring) | IronClaw | Phase 2 |

---

## Appendix: Terminology Reference

| Term | Meaning |
|------|---------|
| **Agent loop** | The core cycle: call LLM → parse response → execute tools → feed results back → repeat |
| **Turn** | One LLM call + its tool executions (a turn may involve multiple tool calls) |
| **Compaction** | Reducing context window usage by summarizing or removing old turns |
| **Context window** | The maximum number of tokens an LLM can process in a single call |
| **Token** | The atomic unit of text for an LLM (~0.75 words for English) |
| **Logprobs** | Per-token log probabilities from the LLM — needed for RL training |
| **Delegate** | An interface that customizes loop behavior without changing the loop itself |
| **MCP** | Model Context Protocol — a standard for connecting external tools to LLMs |
| **WASM** | WebAssembly — a sandboxed execution format for running untrusted code |
| **Fuel metering** | WASM technique to limit compute: each instruction costs fuel, execution stops when fuel runs out |
| **Circuit breaker** | Pattern that stops calling a failing service: Closed → Open (after N failures) → HalfOpen (probe) → Closed |
| **RRF** | Reciprocal Rank Fusion — combines results from multiple ranking systems by `1/(k+rank)` |
| **FTS** | Full-Text Search — keyword-based search with stemming and ranking |
| **TypeBox** | TypeScript library for defining JSON Schema at the type level |
| **Baileys** | Open-source WhatsApp Web protocol library |
| **Pi runtime** | OpenClaw's embedded agent runtime (from Mario Zechner's pi-mono project) |

---

*Generated 2026-03-11. Based on source code analysis of all five repositories.*
