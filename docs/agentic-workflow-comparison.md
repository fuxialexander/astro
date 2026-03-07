# Agentic Workflow Comparison: Astro vs OpenCode vs OpenClaw

A deep analysis of the agentic workflow logic, prompt engineering, and architectural patterns across three AI agent platforms.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Diagrams](#2-architecture-diagrams)
3. [Astro: Planning-First Orchestration](#3-astro-planning-first-orchestration)
4. [OpenCode: Terminal-First AI Coding Agent](#4-opencode-terminal-first-ai-coding-agent)
5. [OpenClaw: Channel-First Personal Assistant](#5-openclaw-channel-first-personal-assistant)
6. [Side-by-Side Comparison](#6-side-by-side-comparison)
7. [Prompt Engineering Comparison](#7-prompt-engineering-comparison)
8. [What Astro Can Borrow](#8-what-astro-can-borrow)
9. [Implementation Recommendations](#9-implementation-recommendations)

---

## 1. Executive Summary

| Dimension | Astro | OpenCode | OpenClaw |
|-----------|-------|----------|----------|
| **Primary Role** | Planning layer + task orchestration | Terminal-first AI coding agent | Personal assistant across messaging channels |
| **Model Stance** | Claude-focused (via relay) | Provider-agnostic (22+ providers) | Multi-provider with auth profile rotation |
| **Core Loop** | Relay dispatch SSE streaming | Step-based agent iteration | Embedded Pi runtime with tool loop |
| **Tool Count** | 15 MCP tools | 46+ tools | 30+ tools + skills |
| **Session Model** | Project-based plan graph | File-backed SQLite sessions | Channel-based (agent:channel:sender) |
| **Safety** | XML delimiter wrapping | Permission rulesets + doom loop detection | Before-tool-call hooks + approval gating |
| **UI Surface** | Web dashboard (React) | Terminal UI (TUI) + desktop | Multi-channel messaging (Telegram, Slack, etc.) |
| **Language** | TypeScript (Vite + Hono) | TypeScript (Bun) | TypeScript (Node.js) |

---

## 2. Architecture Diagrams

### 2.1 Astro Architecture

```
                    +---------------------------+
                    |      Browser / Web UI     |
                    |  (React + React Flow)     |
                    +-------------|-------------+
                                  | HTTP / SSE
                    +-------------|-------------+
                    |    Hono API (port 3001)   |
                    |                           |
                    | +-------+ +--------+      |
                    | | agent | |dispatch|      |
                    | | routes| | routes |      |
                    | +---+---+ +---+----+      |
                    |     |         |           |
                    | +---+---+ +---+----+      |
                    | |Prompt | |Context |      |
                    | |Templ. | |Assemb. |      |
                    | +-------+ +--------+      |
                    |         |                 |
                    | +-------+-------+         |
                    | |Dispatch Engine|         |
                    | | (queue,deps,  |         |
                    | |  approval)    |         |
                    | +-------+-------+         |
                    +---------|---+-------------+
                              |   |
                   Relay      |   | Event
                   Dispatch   |   | Transport
                              |   |
                    +---------+   +--------+
                    |                      |
        +-----------+---------+    +-------+------+
        | Relay Server (3002) |    | Event Hooks  |
        |   WebSocket Hub     |    | - Audit      |
        |   Machine Registry  |    | - SSE notify |
        +----------|----------+    | - Usage      |
                   |               | - PR create  |
              WebSocket            | - Git pull   |
                   |               | - Channel    |
        +----------+----------+    +--------------+
        |   Agent Runner      |
        |   (Remote Machine)  |
        |                     |
        |  +------+ +------+  |
        |  |Claude| | MCP  |  |
        |  | Code | |Tools |  |
        |  +------+ +------+  |
        +---------+-----------+
                  |
              API Calls
                  |
        +---------+-----------+
        |    LLM API          |
        | (Claude / Others)   |
        +---------------------+
```

**Key Workflow Paths:**

```
Plan Generation:
  User description
    --> POST /api/agent/generate-plan
    --> buildPlanSystemPrompt() + vision doc + repo context
    --> RelayTaskDispatch { prompt, outputFormat: JSON_SCHEMA }
    --> relayServer.dispatchTask()
    --> Agent Runner executes with Claude
    --> SSE stream: text events --> plan_result event
    --> Frontend saves plan graph

Task Execution:
  User clicks "Execute Task"
    --> POST /api/dispatch/task
    --> Validate dependencies (or force)
    --> buildTaskExecutionPrompt() + vision + deps + instructions
    --> RelayTaskDispatch { prompt, workingDirectory, deliveryMode }
    --> relayServer.dispatchTask()
    --> Agent Runner executes with Claude Code
    --> SSE stream: text, tool_use, tool_result, file_change, progress
    --> task.completed event --> hooks (PR, audit, usage, notify)

Plan Chat:
  User sends message
    --> POST /api/agent/chat
    --> buildChatSystemPrompt() + current plan + milestones
    --> RelayTaskDispatch
    --> Agent returns text + astro-updates/astro-edges/astro-add-nodes blocks
    --> Frontend parses structured blocks, applies plan mutations

Steering (mid-execution):
  User sends guidance
    --> POST /api/dispatch/steer
    --> relayServer.steerTask(taskId, machineId, message)
    --> WebSocket task.steer --> Agent Runner receives mid-execution
    --> Agent adjusts approach, sends task.steer_ack

Approval Flow:
  Agent needs decision
    --> MCP ask_user_question tool
    --> POST /api/dispatch/request-dynamic-approval
    --> SSE approval.requested --> UI shows card
    --> User responds --> POST /api/dispatch/approval
    --> Promise resolves --> Agent continues
```

---

### 2.2 OpenCode Architecture

```
        +---------------------------+
        |   Terminal UI (TUI)       |
        |   or Desktop App          |
        +-------------|-------------+
                      |
        +-------------|-------------+
        |    Session Manager        |
        |                           |
        | +----------+ +--------+   |
        | |  Prompt  | |Instruct|   |
        | | (loop)   | |  ions  |   |
        | +----+-----+ +--------+   |
        |      |                    |
        | +----+-----+             |
        | |Processor |             |
        | |(stream   |             |
        | | events)  |             |
        | +----+-----+             |
        |      |                    |
        | +----+-----+ +--------+  |
        | |Permission| |  Tool  |  |
        | |  System  | |Registry|  |
        | +----------+ +---+----+  |
        +------------------|--------+
                           |
              +------------+------------+
              |            |            |
        +-----+----+ +----+---+ +-----+----+
        |  46 Tools | |  MCP   | |  Custom  |
        | (bash,    | | Servers| |  Tools   |
        | edit,     | |        | | (JS/TS)  |
        | read...)  | +--------+ +----------+
        +-----+-----+
              |
        +-----+-----+
        | Vercel AI  |
        |    SDK     |
        +-----+------+
              |
     +--------+--------+
     |        |        |
  +--+--+  +--+--+  +--+--+
  |Claud| |OpenAI| |Gemin|  ... 22+ providers
  +-----+ +-----+ +-----+
```

**Key Workflow (Step-Based Loop):**

```
User Input
  --> SessionPrompt.prompt()
  --> Create UserMessage (text, files, @agent refs)
  --> SessionPrompt.loop():
        WHILE true:
          |
          +-> Filter compacted messages
          +-> Insert mode reminders (plan/build switch)
          +-> Resolve tools (agent-filtered permissions)
          +-> LLM.stream() via Vercel AI SDK
          |     |
          |     +-> System prompt (provider-specific: anthropic.txt/beast.txt/gemini.txt)
          |     +-> + Custom instructions (AGENTS.md, CLAUDE.md)
          |     +-> + Tool definitions
          |     +-> streamText() --> fullStream iterator
          |
          +-> SessionProcessor.process():
          |     FOR EACH stream event:
          |       - reasoning-start/delta/end --> ReasoningPart
          |       - text-start/delta/end --> TextPart
          |       - tool-call --> Check permissions --> Execute tool --> ToolPart
          |       - tool-error --> Handle rejection
          |       - finish-step --> Usage metrics
          |       - error --> Fatal handling
          |
          +-> Check result:
                "stop"     --> Exit loop, return AssistantMessage
                "compact"  --> Run compaction agent, continue loop
                "continue" --> Next iteration (more tool calls)

Subtask Execution:
  Main agent calls TaskTool
    --> Spawn child session with subagent config
    --> Child runs own loop (same architecture)
    --> Result fed back as synthetic user message
    --> Parent continues

Doom Loop Detection:
  Same tool called 3x with identical input
    --> PermissionNext.ask("doom_loop")
    --> User approves or denies continuation

Compaction:
  Context window exceeded
    --> Spawn compaction agent
    --> Summarize conversation
    --> Replace history with compressed version
    --> Resume loop
```

---

### 2.3 OpenClaw Architecture

```
        +----------------------------------+
        |    Messaging Channels            |
        | (Telegram, Slack, Discord,       |
        |  WhatsApp, Signal, iMessage...)  |
        +--------------|-------------------+
                       |
        +--------------+-------------------+
        |     Gateway (WebSocket Hub)      |
        |                                  |
        | +--------+ +----------+          |
        | |Channel | | Session  |          |
        | |Monitor | | Routing  |          |
        | +---+----+ +----+-----+          |
        |     |            |               |
        | +---+-----+ +---+------+        |
        | |Inbound  | | Approval |        |
        | |Debounce | | Manager  |        |
        | +---------+ +----------+        |
        |                                  |
        | +----------+ +---------+        |
        | |  Agent   | |  Cron   |        |
        | |  Queue   | |Scheduler|        |
        | +----+-----+ +---------+        |
        +------|--+--------------------+---+
               |  |                    |
               |  | RPC               | Events
               |  |                   |
  +------------+  +---------+  +------+------+
  |                         |  |  Control UI |
  |                         |  |  (WebSocket)|
  |                         |  +-------------+
  |
  +----------------------------------+
  | Pi Embedded Runner               |
  |                                  |
  | +----------+ +----------+       |
  | |  System  | |  Skill   |       |
  | |  Prompt  | | Snapshot |       |
  | | Builder  | |  Loader  |       |
  | +----+-----+ +----+-----+       |
  |      |             |            |
  | +----+-------------+----+      |
  | |   Tool Registry       |      |
  | | (bash, browser, memory,|      |
  | |  sessions, subagents)  |      |
  | +-----------+-----------+      |
  |             |                   |
  | +-----------+-----------+      |
  | |   Agent Session       |      |
  | |  (stream + tool loop) |      |
  | +-----------+-----------+      |
  +-------------|------------------+
                |
       +--------+--------+
       |  Auth Profile    |
       |  Rotation        |
       +--------+---------+
                |
       +--------+--------+
       |    LLM API      |
       | (Claude, GPT,   |
       |  local models)  |
       +-----------------+
```

**Key Workflow:**

```
Inbound Message (e.g., from Telegram):
  Channel Monitor detects message
    --> Resolve route (agent, session key)
    --> Check pairing policy (DM: open/pairing/deny)
    --> Inbound debounce (wait for multi-part messages)
    --> Queue in ACTIVE_EMBEDDED_RUNS map

  Agent Execution:
    agentCommand()
      --> Resolve model + provider + auth profile
      --> Load session + decrypt history
      --> runEmbeddedPiAgent():
            |
            +-> Setup: workspace, sandbox, skills, tools
            +-> Build system prompt (buildAgentSystemPrompt):
            |     - Identity + tooling + safety
            |     - Skills + memory + context
            |     - Messaging + voice + heartbeat
            |     - Runtime info + workspace
            |
            +-> WHILE profileIndex < candidates:
                  |
                  +-> runEmbeddedAttempt():
                  |     Stream model response
                  |     FOR EACH tool_use in response:
                  |       Execute tool --> capture result
                  |       Add to session history
                  |       Continue streaming
                  |     Return assistant text + tool metadata + usage
                  |
                  +-> Check errors:
                        Context overflow? --> Auto-compaction (max 3x)
                        Auth failure?     --> Rotate auth profile
                        Rate limit?       --> Cooldown + rotate
                        Timeout?          --> Rotate profile

  Reply Dispatch:
    Agent text response
      --> Chunk by channel limits (Telegram: 4096, Discord: 2000)
      --> Preserve code fences + markdown
      --> Send via channel API

  Memory Persistence:
    After run completes
      --> Persist session with new history
      --> Update memory docs if needed
      --> Record usage metrics

Sub-agent Orchestration:
  Agent calls subagents(action="steer"|"list"|"kill")
    --> Gateway manages child sessions
    --> Results streamed back to parent
    --> Parent incorporates and continues

Approval Flow:
  Tool execution requires approval
    --> Before-tool-call hook fires
    --> exec.approval.request --> Gateway --> Control UI
    --> User approves/rejects
    --> exec.approval.resolve --> Resume agent
```

---

## 3. Astro: Planning-First Orchestration

### 3.1 Core Philosophy

Astro sits **above** execution agents as a planning layer. It does not build custom agents; it orchestrates existing ones (Claude Code, Codex) via a relay-based architecture. The core abstraction is a **plan graph** (DAG of tasks/milestones) that drives task decomposition, dependency tracking, and multi-environment dispatch.

### 3.2 Prompt Templates

Astro uses 6 distinct prompt templates:

| Template | Purpose | Key Characteristics |
|----------|---------|---------------------|
| `buildPlanSystemPrompt` | Initial plan generation | JSON schema output, 6-15 node DAG, milestone grouping |
| `buildChatSystemPrompt` | Plan refinement | Conversational, structured update blocks (astro-updates/edges/add-nodes) |
| `buildTaskChatSystemPrompt` | Task understanding | Concise Q&A about specific tasks |
| `buildTaskExecutionPrompt` | Task execution | Vision + deps + instructions, commit guidance |
| `buildSummaryPrompt` | Result summarization | JSON output: workCompleted, filesChanged, followUps |
| Compaction prompt | Session compression | Preserves decisions, specs, action items |

### 3.3 Unique Patterns

- **Relay-based execution**: All AI work flows through WebSocket relay to remote agent runners
- **Structured plan mutations**: Chat responses include fenced code blocks (`astro-updates`, `astro-edges`, `astro-add-nodes`) that the frontend parses and applies
- **Vision doc injection**: A persistent document describing product vision is injected into every agent session
- **Dependency output chaining**: Each task receives outputs from upstream dependencies (truncated to configurable max)
- **Tiered verification**: `auto` (tests pass) vs `human` (strategic decisions)
- **Event transport hooks**: Completion events trigger PR creation, merge queue, git pull, channel notifications

### 3.4 Strengths

- Strong planning abstraction (DAG-based decomposition)
- Clear separation: planning layer vs execution layer
- Multi-environment dispatch (local, HPC, cloud)
- Real-time steering of running agents
- Approval system with SSE notifications

### 3.5 Weaknesses

- No local execution fallback (requires relay + agent runner)
- Limited provider support (Claude-focused)
- No doom loop or context overflow handling
- No permission system for tool access
- Simple prompt templates (no provider-specific optimization)

---

## 4. OpenCode: Terminal-First AI Coding Agent

### 4.1 Core Philosophy

OpenCode is an open-source alternative to Claude Code, designed as a **provider-agnostic terminal AI agent**. It provides a full coding assistant experience with 46+ tools, sophisticated permission system, and a step-based agentic loop. The architecture emphasizes **safety** (permissions, doom loop detection), **extensibility** (plugins, MCP, custom tools), and **provider flexibility** (22+ LLM providers).

### 4.2 System Prompts (Provider-Specific)

| Prompt File | Target Models | Key Themes |
|-------------|---------------|------------|
| `anthropic.txt` | Claude family | Objectivity, TodoWrite, code references, conciseness |
| `beast.txt` | GPT-4o/5, o1/o3 | Autonomous iteration, WebFetch for packages, comprehensive todos |
| `gemini.txt` | Gemini models | File search specialization, glob/regex focus |
| `codex_header.txt` | GPT-5/Copilot | ASCII preference, apply_patch for edits |
| `qwen.txt` | Qwen/fallback | Same as anthropic without TodoWrite |
| `plan.txt` | Plan mode | Read-only phase instructions |
| `build-switch.txt` | Mode transition | Permission upgrade from plan to build |

### 4.3 Agent System

| Agent | Mode | Purpose | Key Permissions |
|-------|------|---------|----------------|
| `build` | primary | Full-access coding | Allows all tools, asks on doom_loop |
| `plan` | primary | Read-only planning | Denies edits, allows plan_exit |
| `general` | subagent | Complex multi-task | No todoread/todowrite |
| `explore` | subagent | Codebase search | grep, glob, read only |
| `compaction` | hidden | Context compression | All permissions denied |
| `title` | hidden | Session naming | All permissions denied |
| `summary` | hidden | Session summary | All permissions denied |

### 4.4 Unique Patterns

- **Provider-specific prompts**: Different system prompts optimized for each model family
- **Doom loop detection**: 3 identical tool calls triggers permission check
- **Permission rulesets**: Granular tool permissions with glob patterns, per-session overrides
- **Session compaction**: Automatic context compression when window fills
- **Plan/Build modes**: Explicit read-only planning phase before code changes
- **Instruction loading**: AGENTS.md, CLAUDE.md, CONTEXT.md from project/global/custom sources
- **Shell validation**: Tree-sitter AST parsing of bash commands before execution
- **Snapshot tracking**: Filesystem snapshots for revert support
- **LSP integration**: Go-to-definition, hover, diagnostics available to agents

### 4.5 Strengths

- Provider-agnostic (22+ providers via Vercel AI SDK)
- Sophisticated safety system (permissions, doom loop, plan mode)
- Rich tool ecosystem (46+ tools)
- Extensible (plugins, MCP, custom tools)
- Context management (compaction, truncation)
- LSP code intelligence

### 4.6 Weaknesses

- No multi-task orchestration (single agent at a time)
- No dependency-aware task chaining
- No web UI (TUI only, desktop app in beta)
- No vision doc or project-level context management
- No approval system for complex decisions

---

## 5. OpenClaw: Channel-First Personal Assistant

### 5.1 Core Philosophy

OpenClaw is a **local-first personal assistant gateway** that connects messaging channels to AI agents. It emphasizes **always-on presence** across communication surfaces (Telegram, Slack, Discord, WhatsApp, Signal, iMessage), with sophisticated skill composition, memory persistence, and sub-agent orchestration. The architecture is **gateway-centric** with embedded Pi runtime for low-latency tool execution.

### 5.2 System Prompt Structure

OpenClaw builds the most complex system prompt of the three, with 20+ sections:

| Section | Content |
|---------|---------|
| Identity | "You are a personal assistant running inside OpenClaw." |
| Tooling | Available tools + usage guidance + call style |
| Safety | No independent goals, prioritize safety, pause-and-ask |
| Skills | Scan available skills, read applicable SKILL.md |
| Memory | Use memory_search before answering about prior work |
| User Identity | Owner numbers for authorization |
| Time | User timezone and current time |
| Reply Tags | `[[reply_to_current]]`, `[[reply_to:<id>]]` |
| Messaging | Cross-session sends, sub-agent orchestration |
| Voice/TTS | Speech synthesis guidance |
| CLI Reference | Gateway management commands |
| Documentation | Links to docs, GitHub, Discord |
| Self-Update | Config management (only when user asks) |
| Model Aliases | Alternative model references |
| Workspace | Working directory + sandbox info |
| Context Files | SOUL.md persona, user context |
| Silent Replies | ` ` token for no-response |
| Heartbeats | `HEARTBEAT_OK` for health checks |
| Runtime | Agent ID, OS, model, channel, capabilities |

### 5.3 Unique Patterns

- **Auth profile rotation**: Automatic failover across multiple API keys with cooldown
- **Channel-first routing**: Sessions keyed by `{agent}:{channel}:{sender}`
- **Skill system**: Composable skills with MCP manifests, workspace + bundled
- **Memory system**: Semantic search over MEMORY.md + memory/*.md
- **Heartbeat protocol**: Periodic health check with `HEARTBEAT_OK` response
- **Sub-agent orchestration**: Parent agents can spawn/steer/kill child sessions
- **Message chunking**: Channel-aware limits (Telegram: 4096, Discord: 2000)
- **Embedded Pi runtime**: In-process agent execution (no subprocess overhead)
- **Before-tool-call hooks**: Approval gating before tool execution
- **Context overflow handling**: Auto-compaction (max 3x), tool result truncation
- **Silent reply token**: Agent can choose not to respond

### 5.4 Strengths

- Multi-channel messaging (10+ channels)
- Sophisticated memory system
- Skill composition and discovery
- Auth profile rotation with failover
- Sub-agent orchestration
- Channel-specific formatting
- Always-on assistant model

### 5.5 Weaknesses

- No planning/decomposition layer
- No dependency-aware task chaining
- No web dashboard
- No code intelligence (LSP)
- Complex configuration surface

---

## 6. Side-by-Side Comparison

### 6.1 Agentic Loop Architecture

| Aspect | Astro | OpenCode | OpenClaw |
|--------|-------|----------|----------|
| **Loop type** | Relay dispatch (fire-and-forget + stream) | Step-based iteration (while loop) | Embedded attempt loop with retry |
| **Tool execution** | Remote (agent runner) | Local (in-process) | Local (embedded runtime) |
| **Streaming** | SSE relay --> browser | fullStream iterator | Embedded session events |
| **Max turns** | Configurable (default 100) | Step threshold per agent | Profile rotation until exhaustion |
| **Context management** | None (relies on agent runner) | Auto-compaction | Auto-compaction (max 3x) |
| **Error recovery** | Activity timeout (5 min) | Permission rejection handling | Auth rotation + thinking fallback |
| **Multi-agent** | Single task per dispatch | Subtasks via TaskTool | Sub-agents via sessions_send |

### 6.2 Prompt Engineering

| Aspect | Astro | OpenCode | OpenClaw |
|--------|-------|----------|----------|
| **Provider adaptation** | None (single prompt) | 5+ provider-specific prompts | Single prompt, model-agnostic |
| **System prompt size** | Small (~200 lines) | Medium (~150 lines per variant) | Large (~600+ lines) |
| **Security** | XML delimiters (`<user_vision>`) | Safety instructions in prompt | Safety section + sandboxing |
| **Output format** | JSON schema enforcement | Structured output tool | Free text + tool results |
| **Instruction loading** | Vision doc only | AGENTS.md, CLAUDE.md, CONTEXT.md | SOUL.md, skills, context files |
| **Mode switching** | N/A | Plan <-> Build modes | Full/Minimal/None prompt modes |

### 6.3 Tool System

| Aspect | Astro | OpenCode | OpenClaw |
|--------|-------|----------|----------|
| **Tool count** | 15 MCP tools | 46+ tools | 30+ tools + skills |
| **Tool protocol** | MCP (HTTP API) | Native (Vercel AI SDK) | Native (Pi runtime) |
| **Permission model** | None (trust agent) | Granular rulesets + doom loop | Before-tool-call hooks |
| **Custom tools** | No | JS/TS files + plugins | Skills + MCP manifests |
| **File operations** | Via agent runner | Direct (read/write/edit/patch) | Direct (read/write/edit) |
| **Code intelligence** | No | LSP integration | No |
| **Web access** | No | WebFetch + WebSearch | web_search + web_fetch |

### 6.4 Session & State Management

| Aspect | Astro | OpenCode | OpenClaw |
|--------|-------|----------|----------|
| **Storage** | PGlite/Postgres (Drizzle) | SQLite (Drizzle) | JSON files (encrypted) |
| **Session key** | projectId + nodeId | ULID | agent:channel:sender |
| **History** | Conversation + plan graph | Messages + parts + snapshots | Encrypted session files |
| **Compaction** | Manual (via chat) | Auto (compaction agent) | Auto (max 3x attempts) |
| **Revert** | No | Snapshot-based revert | No |
| **Multi-user** | Yes (Supabase RLS) | Single user | Multi-user (channel-based) |

### 6.5 Safety & Guardrails

| Aspect | Astro | OpenCode | OpenClaw |
|--------|-------|----------|----------|
| **Prompt injection** | XML delimiter wrapping | Safety instructions | Safety section in prompt |
| **Tool permissions** | Trust model | Granular rulesets (allow/deny/ask) | Before-tool-call hooks |
| **Doom loop** | None | 3-call threshold detection | None |
| **Path traversal** | Zod validation (no `..`) | External directory protection | Sandbox workspace restriction |
| **Approval system** | Dynamic (ask_user_question MCP) | Permission prompts | Gateway approval manager |
| **Plan mode** | N/A | Read-only mode (no edits) | N/A |

---

## 7. Prompt Engineering Comparison

### 7.1 Task Execution Prompt Comparison

**Astro** (compact, vision-focused):
```
## Project Vision
{visionDoc}

## Previous Task Outputs
{dependency outputs}

## Current Task
**{title}**
{description}

## Instructions
Execute the task. Be thorough but efficient.
When you are done, commit all your changes.
```

**OpenCode** (provider-optimized, safety-focused):
```
[Provider-specific system prompt: anthropic.txt / beast.txt / gemini.txt]
[+ AGENTS.md / CLAUDE.md instructions]
[+ Tool definitions with permission rules]
[+ Mode-specific reminders (plan/build)]
[+ Doom loop detection]
[+ Compaction-aware history]
```

**OpenClaw** (comprehensive, context-rich):
```
You are a personal assistant running inside OpenClaw.
[+ 20 sections: tools, safety, skills, memory, messaging, voice, runtime...]
[+ SOUL.md persona context]
[+ Memory search results]
[+ Channel-specific formatting rules]
[+ Heartbeat protocol]
```

### 7.2 Key Prompt Patterns

| Pattern | Astro | OpenCode | OpenClaw |
|---------|-------|----------|----------|
| **JSON output enforcement** | "Your FINAL message must contain ONLY the JSON" + schema | StructuredOutput tool with retries | Free text only |
| **Autonomy guidance** | "Proceed independently for standard practices" | "Iterate until completely solved" (beast.txt) | "Prioritize safety, pause and ask" |
| **Code reference format** | None specified | `file_path:line_number` (anthropic.txt) | Not specified |
| **Todo tracking** | Not integrated | "Use TodoWrite VERY frequently" (anthropic.txt) | Via skill system |
| **Decomposition rules** | "~20 min expert work, <1000 LOC, <= M estimate" | Not specified | Not specified |
| **Web access** | Not available | "MUST use WebFetch for 3rd party packages" (beast.txt) | web_search + web_fetch available |

---

## 8. What Astro Can Borrow

### 8.1 From OpenCode (High Priority)

#### A. Provider-Specific System Prompts
**What**: Different system prompts optimized for each LLM provider family.

**Why**: Claude, GPT-4, and Gemini have different strengths and weaknesses. A single prompt leaves performance on the table.

**How to adapt**: Create `buildProviderPrompt(modelId)` that returns provider-optimized instructions for plan generation, chat, and task execution. Start with anthropic (current) + openai + gemini variants.

```
Priority: HIGH
Effort: MEDIUM (3-5 prompt variants)
Impact: Better plan quality across providers
```

#### B. Doom Loop Detection
**What**: Detect when the same tool is called 3+ times with identical input and intervene.

**Why**: Prevents agent runners from wasting tokens on stuck loops. Currently Astro has no protection against this.

**How to adapt**: Add doom loop detection in the relay event stream processing. Track recent tool calls per execution, surface warning to user via SSE event.

```
Priority: HIGH
Effort: LOW (event stream analysis)
Impact: Significant cost savings on stuck tasks
```

#### C. Context Overflow / Compaction
**What**: Automatic session history compression when context window fills.

**Why**: Long-running tasks and multi-turn plan chats can exceed context limits. Astro currently has basic compaction but could be more sophisticated.

**How to adapt**: Implement compaction as a lightweight agent call that summarizes conversation while preserving decisions and technical details. Trigger when approaching context limits.

```
Priority: HIGH
Effort: MEDIUM (compaction agent + trigger logic)
Impact: Enables longer planning sessions
```

#### D. Permission System for Tool Access
**What**: Granular allow/deny/ask rules for tool access with pattern matching.

**Why**: When Astro agents run Claude Code with MCP tools, there's no guardrail on what tools they use. A permission system would improve safety.

**How to adapt**: Add permission configuration to task dispatch that specifies which MCP tools the agent can use, with patterns for file paths.

```
Priority: MEDIUM
Effort: MEDIUM (permission rules + enforcement)
Impact: Improved safety for sensitive operations
```

#### E. Plan Mode (Read-Only)
**What**: Explicit read-only mode where agents can explore but not modify.

**Why**: During plan generation, agents should explore the codebase but not make changes. Currently Astro's plan generation has agentic tool access but no explicit read-only constraint.

**How to adapt**: Add `readOnly: true` to plan generation dispatches. Agent runner enforces by disabling write tools.

```
Priority: MEDIUM
Effort: LOW (flag + enforcement)
Impact: Safer plan generation
```

#### F. LSP Integration for Code Intelligence
**What**: Language Server Protocol integration for go-to-definition, hover, diagnostics.

**Why**: Agents with LSP access make fewer mistakes when modifying code. They can understand type relationships and catch errors before committing.

**How to adapt**: Expose LSP as an MCP tool available to agent runners. Start with TypeScript (tsserver) since Astro is TypeScript-based.

```
Priority: LOW (requires agent runner changes)
Effort: HIGH (LSP server management)
Impact: Higher quality code changes
```

#### G. Instruction Loading from Project Files
**What**: Automatic loading of AGENTS.md, CLAUDE.md from project directories.

**Why**: Astro already loads CLAUDE.md via the agent runner, but could formalize this pattern and support additional instruction files.

**How to adapt**: Already partially implemented via vision doc. Could add explicit support for loading AGENTS.md to define agent behaviors per project.

```
Priority: LOW
Effort: LOW
Impact: Better project-specific agent behavior
```

---

### 8.2 From OpenClaw (High Priority)

#### A. Auth Profile Rotation & Failover
**What**: Multiple API keys with automatic rotation on failure, cooldown periods, and round-robin selection.

**Why**: When running many concurrent tasks, hitting rate limits is common. Auth rotation enables continuous execution.

**How to adapt**: Add API key pool to dispatch engine. On rate limit or auth failure from relay, rotate to next key. Track cooldown periods.

```
Priority: HIGH
Effort: MEDIUM (key pool + rotation logic)
Impact: Higher throughput, fewer failures
```

#### B. Skill System
**What**: Composable skill packages with MCP manifests that agents can discover and use.

**Why**: Astro already has a skill store concept but it's not deeply integrated. OpenClaw's pattern of "scan skills before replying, read one SKILL.md if applicable" is elegant.

**How to adapt**: Enhance Astro's skill registry to inject skill descriptions into task execution prompts. Agent can read detailed skill docs when relevant.

```
Priority: HIGH
Effort: MEDIUM (skill prompt injection + discovery)
Impact: More capable task execution
```

#### C. Memory System (Semantic Search)
**What**: Persistent semantic memory that agents can query for prior decisions, patterns, and context.

**Why**: Astro tasks within a project share a vision doc but lack persistent memory of past execution decisions. A memory system would improve cross-task coherence.

**How to adapt**: Add project-level memory store (MEMORY.md + semantic index). Inject relevant memory snippets into task execution prompts.

```
Priority: HIGH
Effort: HIGH (semantic indexing + search)
Impact: Better cross-task coherence and learning
```

#### D. Sub-Agent Orchestration
**What**: Parent agents can spawn, steer, and kill child agent sessions.

**Why**: Complex tasks benefit from decomposition at the agent level. A planning agent could spawn implementation sub-agents.

**How to adapt**: Already partially implemented via MCP create_task tool. Could enhance with real-time steering of child tasks from parent tasks.

```
Priority: MEDIUM
Effort: HIGH (inter-task communication)
Impact: More sophisticated task execution
```

#### E. Before-Tool-Call Hooks
**What**: Intercept tool calls before execution for approval, modification, or blocking.

**Why**: More flexible than OpenCode's permission system. Allows dynamic approval based on context (e.g., block destructive operations near release).

**How to adapt**: Add hook system to relay event processing. When `tool_use` event arrives, optionally pause and request approval before forwarding to agent runner.

```
Priority: MEDIUM
Effort: MEDIUM (hook system + approval flow)
Impact: Fine-grained safety control
```

#### F. Context Overflow Handling (Multi-Strategy)
**What**: Three-level fallback: compaction -> tool result truncation -> error.

**Why**: More robust than single-strategy overflow handling. Maximizes chance of recovery.

**How to adapt**: Implement in relay event processing. Track approximate token usage from stream events. On overflow signal, try compaction first, then truncation.

```
Priority: MEDIUM
Effort: MEDIUM (multi-strategy implementation)
Impact: More resilient long-running tasks
```

#### G. Heartbeat Protocol
**What**: Periodic health checks with expected response format.

**Why**: Detect stalled agents faster. Currently Astro uses activity timeout (5 min) which is slow.

**How to adapt**: Add heartbeat polling in relay. Expect agent runner to respond within configurable timeout. Surface stall warnings via SSE.

```
Priority: LOW
Effort: LOW (ping/pong in relay)
Impact: Faster detection of stuck agents
```

---

### 8.3 Combined Innovations (New Patterns)

#### A. Provider-Aware Plan Generation
Combine Astro's plan graph + OpenCode's provider-specific prompts:
- Use Claude for high-quality plan generation (best at structured output)
- Use GPT-4 for plan refinement chat (good at iteration)
- Use Gemini for codebase exploration during plan generation (good at search)

#### B. Memory-Enhanced Dependency Chaining
Combine Astro's dependency output chaining + OpenClaw's memory system:
- When chaining dependency outputs, also include relevant memory entries
- After task completion, store key decisions in project memory
- Future tasks benefit from accumulated project knowledge

#### C. Permission-Aware Task Decomposition
Combine Astro's decomposition + OpenCode's permission system:
- Plan generation assigns permission profiles to tasks
- "Setup database schema" gets write + migration permissions
- "Run tests" gets read-only + test execution permissions
- Reduces blast radius of individual task failures

#### D. Skill-Driven Plan Generation
Combine Astro's plan graph + OpenClaw's skill system:
- During plan generation, scan available skills
- If a "React testing" skill exists, reference it in test task descriptions
- Agent runners load skill context when executing skill-relevant tasks

---

## 9. Implementation Recommendations

### 9.1 Quick Wins (1-2 days each)

1. **Doom loop detection** - Add to relay event stream processing
2. **Plan mode read-only flag** - Add to plan generation dispatch
3. **Heartbeat enhancement** - Reduce from 5-min timeout to 30-sec heartbeat
4. **Provider-specific prompts** - Start with Claude + GPT-4 variants for plan generation

### 9.2 Medium Effort (1 week each)

5. **Auth profile rotation** - API key pool with rotation and cooldown
6. **Context compaction** - Lightweight compaction agent for plan chat
7. **Permission system** - Tool-level permissions in dispatch configuration
8. **Skill prompt injection** - Inject relevant skill descriptions into task prompts

### 9.3 Larger Initiatives (2+ weeks each)

9. **Memory system** - Project-level semantic memory with cross-task coherence
10. **Sub-agent orchestration** - Inter-task communication and steering
11. **LSP integration** - Code intelligence as MCP tool for agent runners
12. **Before-tool-call hooks** - Dynamic approval system for tool execution

### 9.4 Prioritized Roadmap

```
Phase 1 (Immediate):
  [1] Doom loop detection
  [2] Provider-specific prompts
  [3] Auth profile rotation

Phase 2 (Next Sprint):
  [4] Context compaction
  [5] Skill prompt injection
  [6] Permission system

Phase 3 (Following Sprint):
  [7] Memory system
  [8] Sub-agent orchestration

Phase 4 (Future):
  [9] LSP integration
  [10] Before-tool-call hooks
```

---

## Appendix A: Astro Prompt Templates (Exact Text)

### A.1 Plan Generation System Prompt

```
You are a project planning assistant with access to the repository.
The key files and file tree are provided above.
You may use tools (Read, Glob, Grep) to explore the codebase for additional context before generating the plan.
When you are done exploring, output your final plan as a single JSON object.
Your FINAL message must contain ONLY the JSON object -- no prose before or after.

You decompose the project into a directed acyclic graph of tasks and milestones.

## Node rules
- Each node has a unique id: "n1", "n2", etc.
- type: "milestone" for checkpoints, "task" for work items, "decision" for human-judgment points.
- All status: "planned".
- verification: "auto" if programmatically verifiable, "human" otherwise.
- position: top-to-bottom layout starting at {x:40,y:40}, increment y by 100. Parallel branches offset x by 260.
- parentId: null for all nodes.
- dependencies: array of prerequisite node ids.
- Tasks do NOT have startDate or endDate.
- Milestones MUST have startDate and endDate (both equal, zero duration). Use ISO "YYYY-MM-DD" format.
- priority: "urgent" | "high" | "medium" | "low" | "none". Default "medium" for most tasks, "high" for critical path items.
- estimate: "XS" | "S" | "M" | "L" | "XL". Target each task at ~20 minutes of expert work time or <1000 lines of code changed. Tasks should be <= M.
- milestoneId: REQUIRED for tasks. Every task MUST have a milestoneId pointing to the milestone it contributes toward.

## Edge rules
- type: "dependency" for sequential, "branch" for parallel paths from a common node.

## Constraints
- Aim for 6–15 nodes, but this is flexible — use more for complex projects, fewer for simple ones. Valid DAG (no cycles).
- Every task node MUST have a milestoneId set.
- projectName MUST be at most 7 words. Use title case. No articles or filler words.
- Output MUST be a single JSON object with keys: projectName (string), nodes (array), edges (array).
- Do NOT include any text before or after the JSON. Do NOT wrap in markdown code fences.
```

### A.2 Task Execution Prompt

```
## Project Vision
<user_vision>{visionDoc}</user_vision>

## Previous Task Outputs
<dependency_outputs>
### Task: {depTitle} (node {depNodeId})
{depOutput}
</dependency_outputs>

## Working Directory
{workingDirectory}

## Current Task
<user_task>
**{taskTitle}**

{taskDescription}
</user_task>

## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered
- Verify your work when possible
- Be thorough but efficient
- When you are done, commit all your changes with a descriptive commit message

### Making Decisions vs. Asking for User Input

**When to proceed independently:**
- Standard best practices and established patterns exist
- Technical decisions with clear trade-offs you can evaluate
- Implementation details that don't affect user-facing behavior
- Refactoring and code quality improvements

**When to note that user input would be valuable:**
If you encounter a decision point where multiple approaches are equally valid...
1. Describe the decision point
2. Present 2-3 viable options with brief trade-offs
3. State which option you recommend and why
4. Proceed with your recommended approach unless instructed otherwise
```

### A.3 Chat System Prompt (Plan Refinement)

```
You are a project planning assistant for Astro.
Help the user refine their project plan through conversation.
You can modify any task property, manage dependencies/edges between nodes, and restructure the plan graph.

IMPORTANT: This is a conversational chat. Do NOT use any tools.

## Modifying the Plan

### Updating Node Properties (astro-updates blocks)
### Adding or Removing Edges (astro-edges blocks)
### Decomposing Tasks (astro-add-nodes blocks)

Decomposition rules:
- Prioritize orthogonal sub-tasks that can be independently verified
- Target ~20 min expert work time, <1000 LOC
- Estimate: XS (~5 min), S (~15 min), M (~30 min). Never larger than M.
- Preserve milestone assignment
- Wire dependencies for clear sequence or parallel branches
```

---

## Appendix B: OpenCode Key Prompts (Excerpts)

### B.1 anthropic.txt (Claude)

```
- You are highly skilled, professional, objective
- NEVER generate guessed URLs (search/WebFetch instead)
- Use TodoWrite VERY frequently (proactively create, update, check off)
- Reference code with file_path:line_number format
- Keep CLI output short and concise
- No emojis unless explicitly requested
- Prefer technical accuracy over validation
```

### B.2 beast.txt (GPT-4/o1/o3)

```
- Must iterate until problem is COMPLETELY solved
- Cannot rely on outdated knowledge - MUST use WebFetch
- Use sequential thinking for complex problems
- Comprehensive todo list with emoji status
- Test code rigorously - catch edge cases
- Keep going until ALL todo items checked
```

### B.3 Plan Mode

```
CRITICAL: READ-ONLY phase. STRICTLY FORBIDDEN any file edits.
Phase 1: Initial Understanding - explore codebase
Phase 2: Design - general agents design implementation
Phase 3: Review - read critical files, ensure alignment
Phase 4: Final Plan - write to plan file only
Phase 5: Call plan_exit tool
```

---

## Appendix C: OpenClaw Key Prompts (Excerpts)

### C.1 System Prompt Identity

```
You are a personal assistant running inside OpenClaw.
```

### C.2 Tool Call Style

```
Default: do not narrate routine, low-risk tool calls (just call the tool).
Narrate only when it helps: multi-step work, complex/challenging problems,
sensitive actions (e.g., deletions), or when the user explicitly asks.
```

### C.3 Safety

```
You have no independent goals: do not pursue self-preservation, replication,
resource acquisition, or power-seeking; avoid long-term plans beyond the user's request.
Prioritize safety and human oversight over completion; if instructions conflict,
pause and ask; comply with stop/pause/audit requests and never bypass safeguards.
```

### C.4 Skills

```
Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md, then follow it.
- If multiple could apply: choose the most specific one, then read/follow it.
- If none clearly apply: do not read any SKILL.md.
Constraints: never read more than one skill up front.
```

### C.5 Memory

```
Use memory_search before answering about prior work/decisions.
Include citations: file paths and line numbers.
```

### C.6 Heartbeats

```
If you receive a heartbeat poll, and there is nothing that needs attention,
reply exactly: HEARTBEAT_OK
If something needs attention, do NOT include "HEARTBEAT_OK";
reply with the alert text instead.
```
