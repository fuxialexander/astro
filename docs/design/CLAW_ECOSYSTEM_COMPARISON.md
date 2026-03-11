# Claw Ecosystem Comparison: OpenClaw, NanoClaw, HappyClaw, IronClaw, and Astro Agent Runner

> Comprehensive architectural comparison of five agent systems — four from the OpenClaw lineage and the Astro Agent Runner as an external reference point.

---

## 1. At a Glance

| | **OpenClaw** | **NanoClaw** | **HappyClaw** | **IronClaw** | **Astro Runner** |
|---|---|---|---|---|---|
| **Language** | TypeScript | TypeScript | TypeScript | Rust | TypeScript |
| **LOC** | ~743K | ~11.6K | ~35.7K | ~173K | ~29.8K |
| **Philosophy** | Everything platform | Small enough to understand | Team-first, enterprise-ready | Security-first, Rust-native | Planning-first orchestration |
| **Agent runtime** | Embedded Pi runtime (in-process) | Claude Agent SDK (container subprocess) | Claude Agent SDK (container subprocess) | Own agentic loop (Rust-native) | Wraps external agents (Claude SDK, Codex, OpenClaw, OpenCode) |
| **Isolation** | Workspace-level (optional Docker) | Container-level (Docker/Apple Container) | Container-level (Docker) | WASM sandbox + Docker | Git worktree-level |
| **Multi-user** | No (single-user) | No (single-user, per-group) | Yes (RBAC, per-user containers) | No (single-user) | Yes (via Astro platform) |
| **Channels** | 15+ (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, Matrix, Zalo...) | 6 (WhatsApp, Telegram, Slack, Discord, Gmail, Signal) | 3 (Feishu, Telegram, Web) | 6+ (CLI, HTTP, WebSocket, WASM channels for Telegram/Slack/Discord/WhatsApp) | WebSocket relay to Astro dashboard |
| **Database** | JSONL files | SQLite | SQLite | PostgreSQL + libSQL (dual) | Postgres/PGlite (via Astro server) |
| **LLM providers** | 12+ (Anthropic, OpenAI, Google, Groq, Bedrock, Ollama, Qwen, Doubao, Minimax...) | 1 (Anthropic, via credential proxy) | 1 (Anthropic, via relay/provider config) | 7 (NEAR AI, OpenAI, Anthropic, Ollama, Bedrock, Tinfoil, OpenAI-compatible) | 4 adapters (Claude SDK, Codex, OpenClaw, OpenCode) |
| **Version** | Calendar (vYYYY.M.D) | 1.2.12 | — | 0.17.0 | — |
| **License** | MIT | — | — | MIT / Apache-2.0 | — |

---

## 2. Lineage and Relationship

```
OpenClaw (743K LOC) ─── THE ORIGINAL ── "Everything platform"
    |
    |── NanoClaw (11.6K LOC) ── RADICAL SIMPLIFICATION
    |   "What if we threw away 98% and focused on
    |    understandability + container isolation?"
    |
    |── HappyClaw (35.7K LOC) ── TEAM / ENTERPRISE FORK
    |   "What if we added multi-user RBAC, Feishu,
    |    and a web dashboard?"
    |
    └── IronClaw (173K LOC) ── RUST REWRITE + SECURITY
        "What if we rebuilt in Rust with WASM sandboxing,
         own agentic loop, and defense-in-depth?"

Astro Agent Runner (29.8K LOC) ── DIFFERENT LINEAGE
    "Wrapper/orchestrator that can call OpenClaw (or others)
     as one of its provider adapters"
```

**OpenClaw** is the original full-featured platform. The three forks each make a different trade-off:

- **NanoClaw** trades breadth for auditability (98.4% smaller)
- **HappyClaw** adds multi-user enterprise features (Feishu, RBAC, web UI)
- **IronClaw** rewrites in Rust for security and performance (WASM sandbox, own loop)

**Astro Runner** is architecturally distinct — it sits above agents (including OpenClaw) as an orchestration layer, routing tasks from a planning DAG to whichever agent is configured.

---

## 3. Architecture Comparison

### 3.1 Agent Loop: Who Owns Reasoning?

| System | Pattern | Who owns reasoning? |
|--------|---------|-------------------|
| **OpenClaw** | Embedded Pi runtime calls model API directly, dispatches tools in-process, streams events | Pi runtime (in-process, zero serialization) |
| **NanoClaw** | Spawns ephemeral Docker container, runs Claude Agent SDK `query()` inside, parses stdout markers | Claude Agent SDK (black box inside container) |
| **HappyClaw** | Same as NanoClaw: Docker container with Claude Agent SDK `query()`, stdout markers. Adds WebSocket streaming relay for web UI | Claude Agent SDK (black box inside container) |
| **IronClaw** | Own Rust `run_agentic_loop()` — calls LLM, dispatches tools, checks safety, loops until done. Three delegates: Chat, Job, Container | IronClaw itself (full ownership of every turn) |
| **Astro Runner** | Provider adapter pattern — each adapter wraps an external agent (Claude SDK in-process, or Codex/OpenClaw/OpenCode as subprocess). Runner controls worktrees + streaming but not reasoning | External agent (Claude Code, Codex, etc.) |

**Key insight**: OpenClaw and IronClaw **own the agent loop** — they control every LLM call and tool dispatch. NanoClaw, HappyClaw, and Astro Runner are **wrappers** around an external agent runtime (Claude Agent SDK or other CLIs).

This distinction matters for:
- **Mid-execution intervention** — only loop owners can inject knowledge or steer mid-turn
- **Token budget enforcement** — wrappers can only set limits at spawn time
- **Model routing** — wrappers use whatever model the wrapped agent selects
- **RL training** — collecting logprobs requires owning the LLM call

### 3.2 Agent Loop Detail

#### OpenClaw (Embedded Pi)

```
1. Message arrives via channel (WhatsApp, Telegram, etc.)
2. Route to session (main, group, subagent)
3. Queue in execution lane (concurrency control)
4. runEmbeddedPiAgent():
   a. Resolve model (auth profile rotation, failover order)
   b. Bootstrap files injected (first turn: AGENTS.md, SOUL.md, TOOLS.md)
   c. Build payload (system prompt, tools, history)
   d. Call model API directly (Anthropic, OpenAI, Gemini, etc.)
   e. Stream events (text, tool_use, tool_result)
   f. For each tool_use: dispatch to tool handler, execute, collect result
   g. Send tool_result back to model, loop
   h. Finalize (accumulate usage, handle overflows)
   i. Store session transcript (JSONL, append-only)
5. Format response per channel, chunk for message limits
6. Route back to originating channel
```

#### NanoClaw / HappyClaw (Container + Claude SDK)

```
1. Message arrives via channel
2. Store in SQLite, message loop wakes (2s polling)
3. Check trigger pattern, enqueue in GroupQueue
4. runContainerAgent():
   a. Build volume mounts (group workspace, IPC, sessions)
   b. docker run -i --rm ... node /app/entrypoint.sh
   c. Pass ContainerInput via stdin (prompt, sessionId, images)
   d. Inside container:
      - Read stdin JSON
      - query() from @anthropic-ai/claude-agent-sdk
      - SDK handles all reasoning, tool dispatch, session management
      - Poll /workspace/ipc/input/ for follow-up messages
      - Write output markers to stdout
   e. Parse stdout markers on host
5. Send response via channel
6. Container auto-removed (--rm)
```

#### IronClaw (Rust Native Loop)

```
1. Message arrives via channel (CLI, WebSocket, WASM channel)
2. ChannelManager merges streams, routes to session
3. run_agentic_loop() with appropriate delegate (Chat/Job/Container):
   a. Check signals (stop/cancel)
   b. Pre-LLM hook (refresh tools, enforce cost guard)
   c. Call LLM with available tools (via provider chain:
      Raw -> Retry -> SmartRouting -> Failover -> CircuitBreaker -> Cache -> Recording)
   d. If text response: handle via delegate, continue or return
   e. If tool calls: execute with safety wrapper
      - Validate schema + permissions
      - WASM tools: sandboxed (fuel metering, memory limits, capability-based)
      - Built-in tools: direct execution
      - MCP tools: forwarded to MCP server
      - Scan results for credential leakage
   f. Add results to messages, post-iteration hook
   g. Loop until text response or max_iterations (default: 50)
4. Compaction if approaching context limit:
   - 80-85%: MoveToWorkspace (write to daily log, keep 10 recent turns)
   - 85-95%: Summarize (LLM summary, remove old turns)
   - >95%: Truncate (drop oldest turns)
```

#### Astro Runner (Adapter Pattern)

```
1. Task arrives via WebSocket from Astro relay
2. TaskExecutor validates safety, creates git worktree
3. Select provider adapter based on task.provider:
   - claude-sdk: in-process SDK query()
   - codex: spawn codex CLI subprocess
   - openclaw: spawn openclaw CLI subprocess
   - opencode: spawn opencode CLI subprocess
4. Adapter executes:
   - Assembles prompt (vision doc + dependency context + task description)
   - Invokes wrapped agent
   - Streams events via TaskOutputStream (text, tool_use, tool_result, file_change)
   - All events forwarded over WebSocket to relay
5. On completion:
   - Generate execution summary
   - Create PR / push branch / merge (per delivery mode)
   - Report metrics (tokens, cost, duration)
   - Clean up worktree
```

### 3.3 Tool Systems

| System | Built-in Tools | Extension Mechanism | Unique Tools |
|--------|---------------|--------------------|----|
| **OpenClaw** | 45+ (read, write, exec, browser, canvas, cron, sessions, nodes, web_search, web_fetch, image, memory, tts, discord_actions, slack_actions...) | Plugin SDK + Skills (3 tiers: bundled/managed/workspace) | Browser CDP control, A2UI canvas, device node invocation, multi-channel message routing |
| **NanoClaw** | Inherits Claude Code tools (bash, read, write, edit, glob, grep, web) + 6 MCP tools | Skills via git branches | Agent browser skill (container), credential proxy for secret isolation |
| **HappyClaw** | Inherits Claude Code tools + 10 MCP tools | Skills via volume mounts (no rebuild) | Memory system (date-based + global), web terminal (xterm.js), Feishu rich cards |
| **IronClaw** | 20+ built-in (file, shell, memory, job, routine, secrets, image, html) + WASM tools (GitHub, Gmail, Google suite, Slack, Telegram) + MCP | WASM plugins (sandboxed) + MCP servers | WASM-sandboxed tool execution, dynamic tool building, hybrid search (FTS + vector) |
| **Astro Runner** | 0 own tools (delegates to wrapped agents). Provides MCP bridge for approvals | Via wrapped agent's native tools | Git worktree isolation, PR automation, multi-env dispatch (SLURM, Docker, K8s, SSH) |

### 3.4 Isolation Models

```
OpenClaw:     [Workspace sandbox] --- optional Docker
                Low isolation, high performance (in-process)

NanoClaw:     [Docker/Apple Container per message] --- mount allowlist --- credential proxy
                High isolation, ephemeral (container destroyed after each run)

HappyClaw:    [Docker per user] --- mount whitelist --- AES-256-GCM config encryption
                Medium isolation (persistent per-user containers)

IronClaw:     [WASM sandbox per tool] + [Docker per job] --- leak detection --- credential encryption
                Highest isolation (multi-layer: WASM fuel/memory + Docker + scanning)

Astro Runner: [Git worktree per task] --- workdir safety tiers --- dispatch signature verification
                Logical isolation (git-level, not OS-level)
```

**Depth of isolation** (most to least): IronClaw > NanoClaw > HappyClaw > Astro Runner > OpenClaw

IronClaw has the deepest isolation: WASM fuel metering, memory limits, capability-based permissions, AND output scanning for credential leakage. NanoClaw and HappyClaw rely on Docker as the primary boundary. Astro Runner isolates at the git level (worktrees). OpenClaw runs tools in-process with optional sandboxing.

### 3.5 Credential Security

| System | Approach | Secrets visible to agent? |
|--------|---------|--------------------------|
| **OpenClaw** | Config file (`openclaw.json`), optional keychain | Yes (in-process runtime) |
| **NanoClaw** | Credential proxy (port 3001) injects auth headers; container gets `ANTHROPIC_API_KEY=placeholder` | No (proxy intercepts, container never sees real keys) |
| **HappyClaw** | AES-256-GCM encrypted config (`data/config/claude-provider.json`), injected as env vars into containers | Partially (env vars inside container) |
| **IronClaw** | AES-256-GCM encrypted storage + OS keychain integration; WASM tools get secrets injected at host boundary; leak detector scans all outputs | No (injected at boundary, scanned on output) |
| **Astro Runner** | API keys in config, dispatch signatures (ECDSA P-256) for tamper detection | Yes (provider adapters have access) |

---

## 4. Feature Matrix

### 4.1 Messaging Channels

| Channel | OpenClaw | NanoClaw | HappyClaw | IronClaw | Astro |
|---------|----------|----------|-----------|----------|-------|
| WhatsApp | Yes (Baileys) | Yes (fork) | No | Yes (WASM) | No |
| Telegram | Yes (grammY) | Yes | Yes (grammY) | Yes (WASM) | No |
| Slack | Yes (Bolt) | Yes | No | Yes (WASM) | No |
| Discord | Yes (discord.js) | Yes | No | Yes (WASM) | No |
| Signal | Yes (signal-cli) | Yes (RFS) | No | No | No |
| Feishu/Lark | Yes (plugin) | No | Yes (WebSocket) | No | No |
| iMessage | Yes (BlueBubbles) | No | No | No | No |
| Google Chat | Yes | No | No | No | No |
| Microsoft Teams | Yes (plugin) | No | No | No | No |
| Matrix | Yes (plugin) | No | No | No | No |
| Gmail | No | Yes | No | Yes (WASM) | No |
| Web UI | Yes (WebChat) | No | Yes (React PWA) | Yes (Gateway) | Yes (Dashboard) |
| CLI/REPL | Yes | No | No | Yes (Ratatui TUI) | Yes |

### 4.2 LLM Provider Support

| Provider | OpenClaw | NanoClaw | HappyClaw | IronClaw | Astro Runner |
|----------|----------|----------|-----------|----------|-------------|
| Anthropic | Yes | Yes (only) | Yes (only) | Yes | Yes (Claude SDK) |
| OpenAI | Yes | No | No | Yes | Yes (Codex adapter) |
| Google Gemini | Yes | No | No | No | No |
| Ollama (local) | Yes | Via proxy | No | Yes | No |
| AWS Bedrock | Yes | No | No | Yes | No |
| Groq | Yes | No | No | No | No |
| NEAR AI | No | No | No | Yes (default) | No |
| Qwen/Doubao/Minimax | Yes | No | No | No | No |
| OpenAI-compatible | Yes | No | No | Yes | No |
| OpenClaw CLI | No | No | No | No | Yes (adapter) |
| OpenCode CLI | No | No | No | No | Yes (adapter) |

### 4.3 Scheduling & Automation

| Feature | OpenClaw | NanoClaw | HappyClaw | IronClaw | Astro |
|---------|----------|----------|-----------|----------|-------|
| Cron scheduling | Yes | Yes | Yes | Yes (routines) | Via plan graph |
| Interval scheduling | No | Yes | Yes | Yes | No |
| One-time scheduling | Yes | Yes | Yes | Yes | Yes (task dispatch) |
| Event-triggered | Yes (webhooks) | No | No | Yes (event triggers) | Yes (dependency completion) |
| Background jobs | No | No | No | Yes (parallel scheduler) | Yes (async task dispatch) |
| Heartbeat monitoring | No | No | No | Yes | Yes (WebSocket heartbeat) |

### 4.4 Memory & Persistence

| Feature | OpenClaw | NanoClaw | HappyClaw | IronClaw | Astro |
|---------|----------|----------|-----------|----------|-------|
| Session persistence | JSONL files | SQLite + Claude sessions | SQLite + Claude sessions | PostgreSQL + libSQL | streaming_events table |
| Long-term memory | Session-specific memory tool | CLAUDE.md per group | User-global + session + date-based CLAUDE.md | Workspace filesystem (MEMORY.md, daily logs) + hybrid search | Vision doc + dependency context |
| Search | No | No | Full-text search | Hybrid FTS + vector (RRF) | No (planned) |
| Conversation archival | Session compaction | No | PreCompact hook archives | MoveToWorkspace + Summarize compaction | streaming_events hydration |
| Cross-session memory | No | Shared CLAUDE.md (global, read-only for non-main) | User-global CLAUDE.md | Workspace files (always available) | Plan graph (dependency outputs) |

### 4.5 Multi-Environment Dispatch

| Target | OpenClaw | NanoClaw | HappyClaw | IronClaw | Astro Runner |
|--------|----------|----------|-----------|----------|-------------|
| Local host | Yes | Via container | Via container/host | Yes | Yes (DirectStrategy) |
| Docker | Optional | Primary | Primary | Yes (orchestrator) | Yes (DockerStrategy) |
| Remote SSH | No | No | No | No | Yes (SSHStrategy) |
| SLURM HPC | No | No | No | No | Yes (SlurmStrategy) |
| Kubernetes | No | No | No | No | Yes (K8sExecStrategy) |
| iOS/Android | Yes (device nodes) | No | No | No | No |

---

## 5. What Each System Excels At

### OpenClaw — The Feature-Complete Platform

- **15+ messaging channels** — more than any other by far
- **Embedded agent runtime** — zero-overhead tool dispatch (no subprocess)
- **Plugin ecosystem** — public SDK, workspace/managed/bundled skill layers
- **Multi-model routing** — 12+ providers with auth profile rotation, circuit breaker, failover
- **A2UI canvas** — agent-driven visual workspace (unique to OpenClaw)
- **Device nodes** — invoke camera, screen record, location on iOS/Android

**Best for**: Power users who want a single AI assistant controlling everything across all their devices and messaging platforms.

### NanoClaw — The Auditable Minimalist

- **11.6K LOC** — entire codebase readable in an afternoon
- **True OS isolation** — every message spawns a fresh ephemeral container
- **No configuration files** — all customization via Claude Code modifying the code itself
- **Skills as git branches** — features survive upstream updates via three-way merge
- **Credential proxy** — containers never see real API keys (not even in env vars)

**Best for**: Privacy-conscious individuals who want a personal assistant they can fully understand, audit, and trust.

### HappyClaw — The Team Platform

- **Multi-user RBAC** — admin (host mode) + members (container mode), 5 permissions x 4 roles
- **Feishu/Lark integration** — first-class support for Chinese enterprise messaging
- **Web UI + PWA** — React dashboard with real-time streaming, extended thinking panels, web terminal
- **Per-user IM channels** — each team member configures their own Feishu/Telegram
- **Memory system** — user-global + session + date-based + conversation archival
- **Login security** — bcrypt, HMAC cookies, account lockout, 18 audit event types

**Best for**: Chinese enterprise teams who need a self-hosted Claude assistant with Feishu integration, multi-user isolation, and a polished web interface.

### IronClaw — The Security-Hardened Engine

- **Native Rust binary** — single static binary, no Node.js runtime
- **WASM sandbox** — untrusted tools run with fuel metering, memory limits, capability-based permissions, leak detection
- **Own agentic loop** — full control of every LLM call and tool dispatch
- **Dual database** — PostgreSQL for production, libSQL/Turso for edge
- **Hybrid memory search** — FTS + vector search with Reciprocal Rank Fusion
- **Provider resilience** — circuit breaker, failover, retry with jitter, response cache
- **Always-on architecture** — heartbeat system, background jobs, routine scheduling
- **Dynamic tool building** — agent can request new WASM tools to be synthesized at runtime

**Best for**: Security-conscious deployments, privacy-first workflows, and users who want a self-expanding AI assistant that owns its entire reasoning chain.

### Astro Agent Runner — The Orchestration Layer

- **Planning-first** — sits below Astro's DAG-based plan graph, executes individual tasks
- **Multi-agent routing** — routes tasks to Claude Code, Codex, OpenClaw, or OpenCode
- **Multi-environment dispatch** — local, SSH, SLURM HPC, Docker, Kubernetes
- **Git-native workflow** — worktree isolation, automated PR creation, merge conflict resolution
- **Real-time streaming** — all events flow through WebSocket relay to Astro dashboard
- **Approval system** — dynamic blocking approvals routed through Astro UI
- **Mid-execution steering** — inject guidance into running Claude Code sessions

**Best for**: Teams using Astro's planning layer who need to dispatch coding/research tasks across diverse computing environments with full observability.

---

## 6. NanoClaw: Typical Use Cases

Based on its architecture (container-isolated, multi-channel, scheduled tasks, 11.6K LOC codebase):

### 6.1 Personal AI Butler

Always-on assistant in your WhatsApp self-chat. Ask questions, get reminders, schedule tasks. The agent runs in a fresh container each time, so it cannot accidentally mess up your host machine. Trigger with `@Andy` (configurable), get a response in the same chat thread.

### 6.2 Family/Friend Group Agent

Register a WhatsApp/Telegram group, set a trigger pattern, and the group gets a shared AI assistant with its own persistent memory (`CLAUDE.md`). Each group is fully isolated — family chat cannot see work chat. Group memory persists across sessions.

### 6.3 Scheduled Reporting

Cron-scheduled tasks that run in isolated containers: daily news summaries, portfolio updates, code repository health checks, weather briefings. Results delivered to your preferred messaging channel at the scheduled time.

```
schedule_task({
  prompt: "Check my GitHub repos for open PRs and summarize",
  schedule_type: "cron",
  schedule_value: "0 9 * * 1-5",   // 9 AM weekdays
  context_mode: "group"
})
```

### 6.4 Research Automation

Mount research data directories into containers via extra mounts configuration, schedule recurring analysis tasks, and get results pushed to Telegram/Slack. The agent has full shell access inside the container but zero access to anything outside its mounts.

### 6.5 Customizable Personal Infrastructure

Because all customization happens via code changes (skills as git branches), NanoClaw becomes a base for building your own personalized AI infrastructure. Fork it, add skills via Claude Code, and you have a bespoke system. Skills survive upstream updates via three-way merge.

### 6.6 Privacy-Sensitive Workflows

The credential proxy ensures API keys never enter the container. The mount allowlist blocks `.ssh`, `.gnupg`, `.aws`, and credential files. The agent literally cannot exfiltrate secrets because it never has access to them. Ideal for users in regulated industries or with heightened privacy requirements.

### 6.7 Agent Swarms (Experimental)

The main group's agent can spawn subagent teams via Claude Agent SDK's experimental agent teams feature. Subagents inherit MCP + mount context, enabling task decomposition across multiple parallel containers.

---

## 7. Architectural Trade-offs

### 7.1 Wrapper vs. Loop Owner

```
              Wrapper (NanoClaw, HappyClaw, Astro)     Loop Owner (OpenClaw, IronClaw)
              ─────────────────────────────────────     ──────────────────────────────────
Ease of build      High (leverage existing agent)           Low (build tools, context mgmt)
Maintenance        Low (SDK updates = free upgrades)        High (own every bug in every tool)
Customizability    Low (can't change agent behavior)        High (control every turn)
Mid-turn steering  Limited/None                             Full
Token budgets      Set at spawn time only                   Enforce per-turn
Model routing      Fixed per session                        Dynamic per turn
RL training        Not possible (no logprobs)               Possible (own the LLM call)
Observability      Post-hoc (parse output)                  Per-turn (inspect reasoning)
```

### 7.2 Container vs. In-Process Execution

```
              Container (NanoClaw, HappyClaw)            In-Process (OpenClaw, IronClaw)
              ──────────────────────────────              ────────────────────────────────
Security           High (OS-level isolation)                 Low-Medium (workspace sandbox)
Startup latency    High (~2-5s per container)                None
Resource overhead  Medium (Docker daemon, images)            Low
Secret isolation   Excellent (credential proxy)              Requires discipline
Debugging          Hard (agent runs inside container)        Easy (attach debugger)
Streaming          Stdout parsing (lossy)                    Native events (lossless)
```

### 7.3 Single-User vs. Multi-User

```
              Single-User (OpenClaw, NanoClaw, IronClaw)    Multi-User (HappyClaw, Astro)
              ─────────────────────────────────────────      ─────────────────────────────
Setup complexity   Low                                          Medium-High
Resource sharing   N/A                                          Concurrency limits needed
Auth               Optional                                     Required (RBAC, sessions)
Privacy            Implicit (one user)                           Explicit (per-user isolation)
Collaboration      No                                            Yes (shared projects/groups)
```

---

## 8. Provider Resilience Patterns

Each system handles LLM provider failures differently:

| System | Retry | Failover | Circuit Breaker | Rate Limit Handling | Response Cache |
|--------|-------|----------|----------------|-------------------|---------------|
| **OpenClaw** | Auth profile rotation | Model downgrade on overflow | No | Billing/rate-limit detection + pause | No |
| **NanoClaw** | 5 retries, exponential backoff | No (single provider) | No | No | No |
| **HappyClaw** | 5 retries, exponential backoff | No (single provider) | No | Context overflow detection | No |
| **IronClaw** | Exponential backoff (1s base, jitter, max 3) | Primary + fallback model with cooldown | Yes (5 failures = open, half-open probe) | Per-provider cooldown | SHA-256 keyed, TTL 1h, LRU |
| **Astro Runner** | Delegated to wrapped agent | Delegated to wrapped agent | No | No | No |

IronClaw has the most sophisticated provider resilience: a full decorator chain of `Raw -> Retry -> SmartRouting -> Failover -> CircuitBreaker -> ResponseCache -> Recording`.

---

## 9. Context Window Management

| System | Approach | Compaction Strategy |
|--------|---------|-------------------|
| **OpenClaw** | Session compaction on overflow | Remove old turns, keep summary |
| **NanoClaw** | PreCompact hook archives transcripts | Delegated to Claude SDK |
| **HappyClaw** | PreCompact hook + context overflow detection (skips retry) | Archive to `conversations/`, delegate compaction to SDK |
| **IronClaw** | Token monitoring with 3-tier strategy | 80-85%: MoveToWorkspace (daily log, keep 10 recent). 85-95%: LLM Summarize. >95%: Truncate oldest |
| **Astro Runner** | Not managed (delegated to wrapped agent) | N/A |

IronClaw's approach is the most granular — it monitors token usage continuously and applies progressively more aggressive compaction. The wrapper-based systems (NanoClaw, HappyClaw, Astro) delegate this entirely to the wrapped agent SDK.

---

## 10. Comparison with Astro's Native Agent Core Design

The [Native Agent Core design document](docs/design/NATIVE_AGENT_CORE.md) proposes building a system that synthesizes patterns from these codebases:

| Design Decision | Closest Reference | Why |
|----------------|-------------------|-----|
| Core loop (~400 LOC, turn-based) | IronClaw (`run_agentic_loop`) | IronClaw demonstrates a clean loop with delegate pattern for different execution contexts |
| Multi-provider abstraction | IronClaw (7 providers + decorator chain) | Most sophisticated provider resilience; OpenClaw has more providers but simpler routing |
| Tool registry + MCP bridge | IronClaw (built-in + WASM + MCP unified) | Three-tier tool system with unified dispatch |
| Context compaction | IronClaw (3-tier token monitoring) | Most granular approach to context management |
| OpenAI-compatible proxy for RL | OpenClaw-RL (from design doc) | Decouples training from agent loop |
| Middleware composition | DeepAgents (from design doc) | Neither claw system uses this pattern explicitly |
| Workspace isolation | Astro Runner (git worktrees) | Existing infrastructure worth preserving |
| Streaming events | Astro Runner (TaskOutputStream) | Existing infrastructure worth preserving |
| Approval routing | Astro Runner (MCP bridge) | Existing infrastructure worth preserving |
| Skill evolution | MetaClaw (from design doc) | IronClaw has dynamic tool building but not skill evolution |

---

## 11. Key Differentiators Summary

| Dimension | Winner | Why |
|-----------|--------|-----|
| **Smallest / most auditable** | NanoClaw | 11.6K LOC, single Node.js process |
| **Most channels** | OpenClaw | 15+ messaging platforms |
| **Best security** | IronClaw | WASM sandbox + leak detection + credential encryption + circuit breaker |
| **Best for teams** | HappyClaw | Multi-user RBAC, Feishu, web UI, audit logging |
| **Most LLM providers** | OpenClaw | 12+ providers with auth rotation and failover |
| **Owns the agent loop** | IronClaw | Full Rust agentic loop, no black-box subprocess |
| **Best multi-env dispatch** | Astro Runner | Local + SSH + SLURM + Docker + K8s |
| **Best planning integration** | Astro Runner | DAG-aware context, dependency injection, plan graph |
| **Most production-ready (individual)** | OpenClaw | Calendar versioning, macOS app, auto-update, 743K LOC |
| **Best credential isolation** | NanoClaw | Credential proxy — agent never sees real keys |
| **Best memory search** | IronClaw | Hybrid FTS + vector with Reciprocal Rank Fusion |
| **Best RL training path** | IronClaw | Owns loop + multi-provider + can collect logprobs |
| **Fastest startup** | IronClaw | Single Rust binary, no container overhead |
| **Best extensibility** | OpenClaw | Plugin SDK + 3-tier skills + 45+ tools |

---

## 12. Appendix: LOC Breakdown

### OpenClaw (~743K LOC)
```
src/gateway/           ~15K   (WebSocket control plane)
src/agents/            ~25K   (Pi embedded runtime + tools)
src/channels/          ~20K   (15+ messaging platform adapters)
src/plugins/           ~8K    (Plugin SDK + loading)
src/config/            ~5K    (Config management)
src/cli/               ~10K   (CLI commands)
extensions/            ~30K   (Plugin channel implementations)
(+ pi-* dependencies)  ~600K+ (Pi runtime, coding agent, AI, TUI)
```

### NanoClaw (~11.6K LOC)
```
src/                   7,293  (Main orchestrator)
  index.ts               599  (Core loop)
  container-runner.ts    556  (Container spawning)
  db.ts                  662  (SQLite)
  group-queue.ts         367  (Concurrency control)
  ipc.ts                 497  (Task/message IPC)
  task-scheduler.ts      280  (Cron tasks)
container/agent-runner/  1,000+ (Agent loop inside container)
tests/                   2,000+ (Vitest)
```

### HappyClaw (~35.7K LOC)
```
src/                   12,308  (Backend: Hono server)
  index.ts              2,061  (Main loop)
  container-runner.ts   1,494  (Docker spawn)
  db.ts                 2,091  (SQLite schema v1-v13)
  group-queue.ts          810  (Concurrency)
  runtime-config.ts     1,266  (AES-256-GCM config)
  routes/               ~3K    (10 API modules)
web/src/                ~7,000 (React 19 frontend)
container/agent-runner/ ~39K   (Agent runner inside container)
```

### IronClaw (~173K LOC)
```
src/agent/              ~8K    (Agentic loop + delegates)
src/llm/                ~12K   (7 providers + decorator chain)
src/tools/              ~15K   (20+ built-in tools)
src/channels/           ~6K    (CLI, HTTP, WebSocket, WASM channels)
src/workspace/          ~5K    (Memory + hybrid search)
src/sandbox/            ~4K    (Docker execution)
src/safety/             ~3K    (Prompt injection defense, leak detection)
src/orchestrator/       ~4K    (Container lifecycle)
src/db/                 ~6K    (Dual-backend: Postgres + libSQL)
tools-src/              ~30K   (WASM tool source: GitHub, Gmail, Google, Slack, Telegram)
channels-src/           ~15K   (WASM channel implementations)
tests/                  ~20K   (48 integration + E2E tests)
(remaining modules)     ~45K   (worker, scheduler, routines, config, CLI, etc.)
```

### Astro Agent Runner (~29.8K LOC)
```
src/providers/          3,645  (4 AI agent adapters)
src/execution/          1,257  (5 deployment strategies)
src/lib/               11,230  (Task executor, WebSocket, worktree, git, safety)
src/commands/           2,769  (CLI: setup, start, stop, status, logs)
src/mcp/                1,093  (Claude Code bridge)
src/types.ts            1,134  (Core type definitions)
(remaining)             ~8.6K  (CLI entry, config, utils)
```

---

*Generated 2026-03-11. Sources: local filesystem analysis of all five repositories.*
