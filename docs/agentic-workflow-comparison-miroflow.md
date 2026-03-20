# MiroFlow vs. Astro: Agentic Workflow Comparison

**Date:** 2026-03-20
**Purpose:** Side-by-side analysis of MiroFlow's multi-agent orchestration against Astro's planning-based workflow. Covers architecture, sub-agent design, context management, and prompt engineering.

---

## 1. Executive Summary

| Dimension | MiroFlow | Astro |
|---|---|---|
| **Primary domain** | Research/benchmark agent (GAIA, HLE, BrowseComp) | Software engineering agent (code, git, PRs) |
| **Architecture** | Hierarchical agent graph (main → sub-workers) | DAG-based plan executor (planner → node executor) |
| **Sub-agent model** | Dynamic: main agent decides when to spawn sub-workers via tool calls | Static: planner generates a DAG upfront, executor dispatches nodes |
| **Planning** | Implicit — main agent plans in-context via numbered steps | Explicit — structured `ExecutionPlan` with typed `PlanNode` objects |
| **Context management** | Summary-based handoff between agents; proactive context limit checking | Compaction at plan entry; per-node context isolation via worktrees |
| **Delivery** | Returns `\boxed{answer}` | Git branches, PRs, squash-merges |
| **Retry/recovery** | Rollback mechanism (undo last LLM turn, retry) | Merge conflict resolution (resume sub-agent session) |

**Key insight:** MiroFlow and Astro solve fundamentally different problems with similar multi-agent patterns. MiroFlow optimizes for *information retrieval accuracy* across research benchmarks. Astro optimizes for *code delivery correctness* across software engineering tasks. But both use a main-agent-delegates-to-sub-agents pattern with summary-based context passing.

---

## 2. Architecture Comparison

### 2.1 MiroFlow Architecture

```
User Task
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Main Agent (IterativeAgentWithToolAndRollback)  │
│  - GPT-5 / Claude / MiroThinker                 │
│  - Plans in-context (numbered steps)             │
│  - Has tools + sub-agents exposed as tools       │
│  - Iterative ReAct loop with rollback            │
│  - max_turns limit (e.g., 200)                   │
│  - Proactive context limit checking              │
└──────────────┬──────────────────────────────────┘
               │ (tool call: execute_subtask)
               ▼
┌─────────────────────────────────────────────────┐
│  Sub-Agent Worker (same class, different config) │
│  - MiroThinker / cheaper model                   │
│  - Has actual tools (search, code sandbox, etc.) │
│  - Same iterative loop                           │
│  - Returns summary report to main agent          │
│  - Can nest further (agent-subagent-3)           │
└─────────────────────────────────────────────────┘
```

**Key characteristics:**
- **Agent graph is YAML-configured.** Each agent is an `IterativeAgentWithToolAndRollback` instance with its own LLM, tools, prompts, and sub-agents.
- **Sub-agents are exposed as MCP tools.** The main agent sees `agent-worker::execute_subtask` as a tool alongside search, code sandbox, etc. It decides when to delegate.
- **Nesting is supported.** The graph config (`agent_quickstart_graph.yaml`) shows 3 levels: main → subagent-1 → subagent-3. Each level can have different models and tools.
- **No explicit plan object.** The main agent plans in-context ("1. Search for X, 2. Analyze Y, 3. Compute Z") but this plan is not a data structure — it's just text in the conversation.

### 2.2 Astro Architecture

```
User Task
    │
    ▼
┌─────────────────────────────────────────────────┐
│  /plan Command Entry                             │
│  1. Git preflight (detect mode, create branch)   │
│  2. Render plan panel (terminal, not LLM)        │
│  3. Compact context (unconditional)              │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Plan Generator (LARGE model)                    │
│  - Produces ExecutionPlan: DAG of PlanNodes      │
│  - Each node has: type, tier, dependencies       │
│  - Node types: EXPLORE, IMPLEMENT, VERIFY, etc.  │
│  - Typed knowledge edges between nodes           │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Plan Executor                                   │
│  - Topological sort → dispatch ready nodes       │
│  - Each IMPLEMENT node → sub-agent in worktree   │
│  - After sub-agent: executor runs delivery       │
│    (squash-merge or PR, not the agent)           │
│  - Node-boundary gates (STANDARD mode)           │
│  - Replan on failure (surgical subgraph replace)  │
└─────────────────────────────────────────────────┘
```

**Key characteristics:**
- **Plan is a first-class data structure.** `ExecutionPlan` is a DAG of `PlanNode` objects with typed dependencies, model tier assignments, and verification policies.
- **Sub-agents are child orchestrators.** Each runs in an isolated git worktree with its own context. They don't share conversation history with the parent.
- **Delivery is executor code, not agent instructions.** After a sub-agent completes, the executor runs `git push`, `gh pr create`, `localMergeIntoProjectBranch()` — the agent never touches git delivery.
- **Replanning is structural.** When a node fails, the planner replaces the failed subgraph, not the whole plan.

---

## 3. Sub-Agent Design

### 3.1 How Many Sub-Agents?

| | MiroFlow | Astro |
|---|---|---|
| **Typical count** | 1-3 sub-agent types in YAML config | 1 per IMPLEMENT node in the plan (dynamic) |
| **Nesting depth** | Up to 3 levels (main → sub-1 → sub-3) | 1 level (parent executor → child orchestrator) |
| **Spawning** | Dynamic — main agent decides via tool call | Static — planner decides at plan generation time |
| **Lifecycle** | Created on-demand per tool call, destroyed after | Created per node, runs in worktree, cleaned up after merge |
| **Identity** | Named in YAML (`agent-worker`, `agent-subagent-1`) | Named by plan node ID (`T003`, `T004`) |

### 3.2 Sub-Agent Spawning

**MiroFlow:** The main agent sees sub-agents as tools. When it calls `agent-worker::execute_subtask({"subtask": "Search for X"})`, the framework:
1. Dynamically instantiates the sub-agent from YAML config
2. Creates a fresh `AgentContext(task_description=subtask_text)`
3. Runs the sub-agent's full iterative loop
4. Returns the sub-agent's `summary` field as the tool result

The main agent has no control over the sub-agent's internal behavior — it just sends a task description and gets back a summary report.

**Astro:** The plan executor dispatches nodes based on the DAG's topological order. For each IMPLEMENT node:
1. Creates a git worktree branched from the project branch
2. Spawns a child orchestrator (same codebase, different config) in the worktree
3. The child runs its full ReAct loop with file tools scoped to the worktree
4. After completion, the executor runs delivery (merge/PR)
5. Knowledge from the node's output is passed to dependent nodes as typed facts

### 3.3 Model Routing

**MiroFlow:** Different models per agent level. Typical pattern:
- Main agent: GPT-5 (strong reasoning, expensive)
- Sub-agent worker: MiroThinker (cheaper, good at tool use)
- Leaf sub-agent: MiroThinker (same, has actual tools)

Configured in YAML per agent:
```yaml
main_agent:
  llm:
    provider_class: GPT5OpenAIClient
    model_name: gpt-5
agent-worker:
  llm:
    provider_class: MiroThinkerSGLangClient
    model_name: mirothinker-32b
```

**Astro:** Model tier per plan node. The planner assigns SMALL/MEDIUM/LARGE per node:
- EXPLORE nodes: SMALL (cheap, fast)
- IMPLEMENT nodes: LARGE (needs full reasoning)
- VERIFY nodes: SMALL (just run tests)

Resolved from `config/default.yaml` — never hardcoded model names.

---

## 4. Context Management

This is where the two systems diverge most significantly.

### 4.1 MiroFlow: Summary-Based Handoff

**Between agents:** When the main agent delegates to a sub-agent, the sub-agent gets a fresh context with only the subtask description. No conversation history is shared. When the sub-agent finishes, it generates a summary via `SummaryGenerator` — an LLM call that asks "summarize ALL working history for this task." This summary is returned to the main agent as a tool result.

**Within an agent:** The `IterativeAgentWithToolAndRollback` maintains a `message_history` list that grows with each turn. Two mechanisms prevent context overflow:

1. **Proactive context limit checking** (`ensure_summary_context`): Before each turn, checks if adding the summary prompt would exceed the context window. If so, breaks the loop and generates a summary.

2. **`ContextLimitError` catch**: If the LLM call itself fails due to context limits, catches the error and breaks to summary generation.

**On failure/retry:** The `ExceedMaxTurnSummaryGenerator` produces a structured failure post-mortem:
```
* Failure type: incomplete / blocked / misdirected / format_missed
* What happened: description of approach and why it failed
* Useful findings: reusable facts and intermediate results
```
This failure summary can be fed into a retry attempt as prior experience.

### 4.2 Astro: Isolation + Compaction

**Between agents:** Each sub-agent (child orchestrator) runs in a completely isolated context — separate git worktree, separate conversation, separate tool scope. No conversation history is shared. Knowledge flows between nodes as typed facts (file paths, function signatures, test results), not as conversation text.

**At plan entry:** Unconditional compaction. The entire conversation is compacted into a handoff summary before the plan generator runs. This gives the planner a clean slate.

**During execution:** The orchestrator's auto-compaction triggers at 70% context window usage. Uses `STRUCTURED_COMPACTION_PROMPT` to produce a handoff summary that retains progress, decisions, and next steps.

### 4.3 Side-by-Side

| Aspect | MiroFlow | Astro |
|---|---|---|
| **Inter-agent context** | Subtask text in, summary text out | Typed facts (file paths, signatures, test results) |
| **Intra-agent context** | Growing message_history with proactive limit check | Growing conversation with 70% threshold compaction |
| **Compaction trigger** | Context limit approaching (proactive) or exceeded (reactive) | Unconditional at plan entry; 70% threshold during execution |
| **Failure context** | Structured post-mortem (failure type, findings) | Merge conflict prompt (rebase instructions) |
| **Context isolation** | Fresh AgentContext per sub-agent call | Separate git worktree + separate conversation per node |

---

## 5. Prompt Comparison

### 5.1 System Prompts

**MiroFlow Main Agent** (`main_agent_prompt_gaia.py`):
- Tool-use formatting instructions (XML-style MCP tags)
- Task Strategy section: "Analyze → Plan → Execute → Review"
- Tool-Use Guidelines: ONE tool call per response, self-contained context
- Tool-Use Communication Rules: STOP after one tool call
- No agent-specific objective (main agent is a generalist)

**MiroFlow Sub-Agent Worker** (`sub_worker.py`):
- Same tool-use formatting as main agent
- Same Task Strategy and Guidelines
- Additional "Agent Specific Objective" section:
  - "You are an agent that performs various subtasks"
  - "Do not infer, speculate, or attempt to fill in missing parts"
  - File path handling instructions
  - Reliability assessment guidelines
  - "Focus on completing the specific subtask assigned to you"

**Astro Main Agent** (system prompt in orchestrator):
- Tool definitions (JSON schema, not XML)
- Project instructions (from CLAUDE.md)
- Skill definitions (from SKILL.md files)
- Plan mode suffix (when active): read-only constraints
- No explicit "one tool per response" rule — Astro supports parallel tool calls

**Astro Sub-Agent** (child orchestrator):
- Same system prompt structure as main agent
- Scoped to the worktree directory
- Node-specific instructions injected from plan node description
- Knowledge from predecessor nodes injected as context

### 5.2 Summary/Compaction Prompts

**MiroFlow** (`generate_summarize_prompt`):
```
We are now ending this session, and your conversation history will be deleted.
You must NOT initiate any further tool use.
Summarize the above conversation, and output the FINAL ANSWER.
If a clear answer has already been provided earlier, do not rethink it.
Summarize ALL working history: step-by-step thoughts, all tool calls, all tool results.
Output the FINAL ANSWER and detailed supporting information.
```

**Astro** (`STRUCTURED_COMPACTION_PROMPT`):
```
You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary
for another LLM that will resume the task.
Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data (file paths, variable names, error messages)
- Errors or dead ends to avoid repeating
Maximum 1000 tokens.
```

**Key difference:** MiroFlow's summary prompt asks for a *complete report* (all findings, all tool calls). Astro's compaction prompt asks for a *handoff brief* (progress, next steps, critical data). MiroFlow optimizes for answer extraction; Astro optimizes for task continuation.

### 5.3 Failure/Retry Prompts

**MiroFlow** (`ExceedMaxTurnSummaryGenerator`):
Uses assistant prefill to force structured output:
```
<think>
We need to write a structured post-mortem style summary:
* Failure type: incomplete / blocked / misdirected / format_missed
* What happened: approach taken and why it didn't reach a final answer
* Useful findings: facts, intermediate results, conclusions that can be reused
</think>
```

**Astro** (`buildConflictResolutionPrompt` in task-executor.ts):
```
MERGE CONFLICT DETECTED (attempt N/3)
Conflicting files: [list]
The project branch is: astro/plan-{slug}
Please resolve this:
1. Fetch the latest project branch
2. Rebase onto the project branch
3. Resolve conflict markers
4. Stage resolved files
5. Continue the rebase
6. Verify your changes still work
```

**Key difference:** MiroFlow's failure prompt is introspective ("why did we fail?"). Astro's is operational ("here's what to do to fix the merge conflict").

---

## 6. Rollback and Retry Mechanisms

### 6.1 MiroFlow: LLM Output Rollback

MiroFlow's `IterativeAgentWithToolAndRollback` has a sophisticated rollback mechanism for handling malformed LLM outputs:

1. **Truncation detection**: If `finish_reason == "length"` or MCP tags appear without parsed tool calls → rollback (undo last assistant message, retry)
2. **Refusal detection**: If response contains "I'm sorry, but I can't" → rollback
3. **Duplicate query detection**: If the agent tries to call the same tool with the same arguments → rollback
4. **Limits**: `max_consecutive_rollbacks` (default 5), `max_duplicate_rollbacks` (default 3)

This is a *turn-level* retry — it undoes the last LLM response and retries the same turn.

### 6.2 Astro: Merge Conflict Resolution

Astro's retry mechanism operates at the *delivery level*, not the LLM output level:

1. **Pre-merge rebase**: Before merging, rebase the task branch onto the project branch tip. Handles the common case where another task merged while this one was executing.
2. **Merge retry loop**: If squash-merge fails with conflict, resume the sub-agent's session with a conflict resolution prompt. The agent rebases, resolves markers, and the merge is retried. Max 3 attempts.
3. **PR conflict resolution**: Same pattern but with force-push after rebase.

Astro does not have MiroFlow-style LLM output rollback — it relies on the provider's native retry/error handling.

---

## 7. Tool Systems

| Aspect | MiroFlow | Astro |
|---|---|---|
| **Protocol** | MCP (Model Context Protocol) via XML tags | Native tool calling (JSON schema) |
| **Tool format** | XML: `<use_mcp_tool><server_name>...</server_name>` | Provider-native (Anthropic tool_use, OpenAI function_call) |
| **Tool servers** | MCP servers (search, code sandbox, browser, vision, audio) | Built-in tools (bash, read, write, edit, glob, grep, etc.) |
| **Sub-agents as tools** | Yes — `agent-worker::execute_subtask` | No — sub-agents are dispatched by the executor, not called as tools |
| **Skills** | SKILL.md files loaded as tool definitions | SKILL.md files injected into system prompt |
| **Tool blacklist** | Per-agent YAML config (`tool_blacklist`) | Per-mode denied tools (`PlanModeManager.get_denied_tools()`) |
| **Parallel tool calls** | Strictly ONE per response (enforced by prompt) | Multiple per response (supported by providers) |
| **Tool output truncation** | 100K chars max | Per-tool limits (bash: 50K, read: 30K, grep: 20K) |

---

## 8. What Astro Can Learn from MiroFlow

1. **Rollback mechanism for malformed outputs.** MiroFlow's truncation/refusal detection and turn-level rollback is elegant. Astro could benefit from detecting `finish_reason == "length"` and retrying the turn instead of proceeding with a truncated response.

2. **Structured failure post-mortems.** MiroFlow's `ExceedMaxTurnSummaryGenerator` produces typed failure summaries (failure type, what happened, useful findings). Astro's compaction prompt could include a failure mode when the node fails, producing structured data for the replanner.

3. **Proactive context limit checking.** MiroFlow pre-renders the summary prompt and checks if it would fit before each turn. Astro's 70% threshold is coarser — it could benefit from checking whether the compaction prompt itself would fit.

4. **Duplicate query detection.** MiroFlow tracks all tool calls and rolls back if the agent repeats the same query. Astro has no equivalent — a sub-agent could waste turns repeating the same `grep` or `read` call.

---

## 9. What MiroFlow Can Learn from Astro

1. **Explicit plan as a data structure.** MiroFlow's "plan" is just numbered steps in the conversation — it can't be inspected, persisted, or partially re-executed. Astro's `ExecutionPlan` DAG enables surgical replanning, parallel execution, and persistence across crashes.

2. **Delivery isolation via git worktrees.** MiroFlow's sub-agents share the filesystem. Astro's worktree-per-task model means parallel agents can't corrupt each other's files, and each task's changes are independently reviewable via PR.

3. **Typed knowledge passing.** MiroFlow passes summaries (unstructured text) between agents. Astro passes typed facts (file paths, function signatures, test results) — more reliable for downstream consumption.

4. **Separation of agent work from delivery.** In MiroFlow, the agent does everything. In Astro, the agent writes code and the executor handles git delivery. This separation means the agent doesn't need to understand git workflows.

---

## 10. Summary Table

| Feature | MiroFlow | Astro |
|---|---|---|
| Plan representation | In-context numbered steps | Typed DAG (`ExecutionPlan`) |
| Sub-agent spawning | Tool call (`execute_subtask`) | Executor dispatches per DAG node |
| Sub-agent count | 1-3 types, nested up to 3 levels | 1 per IMPLEMENT node (dynamic) |
| Model routing | Per-agent YAML config | Per-node tier (SMALL/MEDIUM/LARGE) |
| Context between agents | Summary text | Typed facts |
| Context within agent | Growing message_history + proactive limit check | Growing conversation + 70% compaction |
| Compaction prompt | "Summarize ALL working history" (complete report) | "Create a handoff summary" (continuation brief) |
| Failure handling | Structured post-mortem + retry with experience | Merge conflict resolution + replan failed subgraph |
| Rollback | Turn-level (undo last LLM response) | Delivery-level (rebase + retry merge) |
| Tool protocol | MCP (XML tags) | Native provider tool calling (JSON) |
| Tool calls per turn | Strictly 1 | Multiple supported |
| Delivery | `\boxed{answer}` | Git branches, PRs, squash-merges |
| Isolation | Fresh AgentContext per sub-agent | Git worktree per task node |
| Persistence | Logs only | SQLite plan storage, session resume |
