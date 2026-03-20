# MiroFlow vs. Astro: Agentic Workflow Comparison

**Date:** 2026-03-20
**Purpose:** Side-by-side analysis of MiroFlow's multi-agent orchestration against Astro's planning-based workflow. Covers architecture, sub-agent design, context management, prompt engineering, and what Astro-Assistant can adopt from MiroFlow.

---

## 1. Executive Summary

| Dimension | MiroFlow | Astro |
|---|---|---|
| **Primary domain** | Research/benchmark agent (GAIA, HLE, BrowseComp) | Software engineering agent (code, git, PRs) |
| **Architecture** | Hierarchical agent graph (main -> sub-workers) | DAG-based plan executor (planner -> node executor) |
| **Sub-agent model** | Dynamic: main agent decides when to spawn sub-workers via tool calls | Static: planner generates a DAG upfront, executor dispatches nodes |
| **Planning** | Implicit -- main agent plans in-context via numbered steps | Explicit -- structured `ExecutionPlan` with typed `PlanNode` objects |
| **Knowledge sharing** | Summary text returned from sub-agent to parent | 3-layer system: vision doc + dependency outputs + project knowledge store |
| **Context management** | Proactive context limit checking per turn | Unconditional compaction at plan entry + 70% threshold during execution |
| **Delivery** | Returns `\boxed{answer}` | Git branches, PRs, squash-merges |

---

## 2. Architecture Comparison

### 2.1 MiroFlow Architecture

```
User Task
    |
    v
+--------------------------------------------------+
|  Main Agent (IterativeAgentWithToolAndRollback)   |
|  - GPT-5 / Claude / MiroThinker                  |
|  - Plans in-context (numbered steps)              |
|  - Has tools + sub-agents exposed as tools        |
|  - Iterative ReAct loop with rollback             |
|  - max_turns limit (e.g., 200)                    |
+------------------+-------------------------------+
                   | (tool call: execute_subtask)
                   v
+--------------------------------------------------+
|  Sub-Agent Worker (same class, different config)  |
|  - MiroThinker / cheaper model                    |
|  - Has actual tools (search, code sandbox, etc.)  |
|  - Same iterative loop                            |
|  - Returns summary report to main agent           |
|  - Can nest further (agent-subagent-3)            |
+--------------------------------------------------+
```

**Key characteristics:**
- Agent graph is YAML-configured. Each agent is an `IterativeAgentWithToolAndRollback` with its own LLM, tools, prompts, and sub-agents.
- Sub-agents are exposed as MCP tools. The main agent sees `agent-worker::execute_subtask` alongside search, code sandbox, etc.
- Nesting supported: up to 3 levels (main -> sub-1 -> sub-3), each with different models and tools.
- No explicit plan object. The main agent plans in-context ("1. Search for X, 2. Analyze Y") but this is just text, not a data structure.

### 2.2 Astro Architecture

```
User Task
    |
    v
+--------------------------------------------------+
|  Plan Generator (LARGE model)                     |
|  - Produces ExecutionPlan: DAG of PlanNodes        |
|  - Each node has: type, tier, dependencies         |
|  - Node types: EXPLORE, IMPLEMENT, VERIFY, etc.   |
+------------------+-------------------------------+
                   |
                   v
+--------------------------------------------------+
|  Plan Executor                                    |
|  - Topological sort -> dispatch ready nodes        |
|  - Each IMPLEMENT node -> sub-agent in worktree    |
|  - After sub-agent: executor runs delivery         |
|  - Knowledge auto-extracted on completion           |
|  - Replan on failure (surgical subgraph replace)    |
+--------------------------------------------------+
```

**Key characteristics:**
- Plan is a first-class data structure (`ExecutionPlan` DAG with typed `PlanNode` objects).
- Sub-agents are child orchestrators running in isolated git worktrees.
- Delivery (push/PR/merge) is executor code, not agent instructions.
- Knowledge flows through 3 layers: vision doc, dependency outputs, project knowledge store.

---

## 3. Sub-Agent Design

### 3.1 How Many Sub-Agents?

| | MiroFlow | Astro |
|---|---|---|
| **Typical count** | 1-3 sub-agent types in YAML config | 1 per IMPLEMENT node in the plan (dynamic) |
| **Nesting depth** | Up to 3 levels (main -> sub-1 -> sub-3) | 1 level (parent executor -> child orchestrator) |
| **Spawning** | Dynamic -- main agent decides via tool call | Static -- planner decides at plan generation time |
| **Lifecycle** | Created on-demand per tool call, destroyed after | Created per node, runs in worktree, cleaned up after merge |

### 3.2 Sub-Agent Spawning

**MiroFlow:** The main agent calls `agent-worker::execute_subtask({"subtask": "Search for X"})`. The framework dynamically instantiates the sub-agent from YAML config, creates a fresh `AgentContext(task_description=subtask_text)`, runs the sub-agent's full iterative loop, and returns the sub-agent's `summary` field as the tool result. The main agent has no control over the sub-agent's internal behavior.

**Astro:** The plan executor dispatches nodes based on the DAG's topological order. For each IMPLEMENT node: creates a git worktree, spawns a child orchestrator, runs its ReAct loop, then the executor runs delivery (merge/PR). Knowledge from the node's output is auto-extracted into the project knowledge store.

### 3.3 Model Routing

**MiroFlow:** Different models per agent level, configured in YAML:
- Main agent: GPT-5 (strong reasoning, expensive)
- Sub-agent worker: MiroThinker (cheaper, good at tool use)

**Astro:** Model tier per plan node, assigned by the planner:
- EXPLORE nodes: SMALL (cheap, fast)
- IMPLEMENT nodes: LARGE (needs full reasoning)
- VERIFY nodes: SMALL (just run tests)

---

## 4. Knowledge Sharing -- The Key Difference

This is where the two systems diverge most significantly, and where Astro has a substantially richer model.

### 4.1 MiroFlow: Summary-Based Handoff

When the main agent delegates to a sub-agent, the sub-agent gets a **fresh context** with only the subtask description. No conversation history is shared. When the sub-agent finishes, it generates a summary via `SummaryGenerator` -- an LLM call that asks:

> "Summarize ALL working history for this task, including your step-by-step thoughts, all tool calls, and all tool results (i.e., the full solving trajectory so far). Output the FINAL ANSWER and detailed supporting information."

This summary is returned to the main agent as a tool result. It's a **complete report** -- not a brief handoff, but a full accounting of everything the sub-agent did and found.

**Strengths:**
- The summary is comprehensive -- it includes findings, tool call results, and the reasoning trajectory
- The main agent gets enough context to decide what to do next
- Simple to implement -- just an LLM call at the end

**Weaknesses:**
- Unstructured text -- the main agent must parse it to extract specific facts
- No persistence -- if the main agent's context overflows, the summary is lost
- No cross-agent sharing -- parallel sub-agents can't see each other's findings

### 4.2 Astro: 3-Layer Knowledge System

Astro has three distinct mechanisms for knowledge flow, each with different scope:

**Layer 1 -- Vision Document (global, every task):**
A user-written strategic document injected into every task's prompt. Read-only to agents. ~4.5K tokens. Purpose: ensure all agents work toward the same goal.

**Layer 2 -- Dependency Outputs (direct DAG parents only):**
When task B depends on task A, B's prompt includes A's `executionOutput` (truncated to 20K bytes). This is the primary mechanism for sequential information propagation. Includes metadata: nodeId, title, status, prUrl, branchName.

**Layer 3 -- Project Knowledge Store (all tasks, regardless of graph position):**
Auto-extracted from task summaries on completion. Stored in a `project_knowledge` table keyed by `(projectId, key)`. Budget: 16K chars total, sorted by recency. Entry types:
- `findings_{slug}` -- from `summary.keyFindings` (bullet list)
- `summary_{slug}` -- from `summary.executiveSummary`
- `work_{slug}` -- from `summary.workCompleted` (fallback)

This is the cross-task bridge that closes the gap between dependency outputs (direct parents only) and the need for broader project awareness. Even parallel siblings that have no DAG edge can see each other's findings via the knowledge store.

**The assembled execution prompt for each task:**
```
System instructions                              ~1K tokens
Vision document (global)                         ~4.5K tokens
Agent skills                                     ~1-3K tokens
Project knowledge (all completed tasks)          <=4K tokens
Graph position context (depth, siblings, branch) ~200 tokens
Dependency outputs (direct DAG parents)          ~5K per dep
Current task (title, description, criteria)      ~0.5-2K tokens
```

### 4.3 Side-by-Side

| Aspect | MiroFlow | Astro |
|---|---|---|
| **Inter-agent context** | Subtask text in, summary text out | 3 layers: vision + dependency outputs + knowledge store |
| **Cross-agent visibility** | None -- parallel sub-agents can't see each other | Project knowledge store visible to ALL tasks |
| **Persistence** | None -- summaries live only in parent's message_history | SQLite/Postgres -- knowledge survives crashes, restarts |
| **Structure** | Unstructured text summary | Typed entries with keys, source attribution, timestamps |
| **User editability** | None | Users can add/edit/delete knowledge entries via UI |
| **Budget control** | Implicit (context window limit) | Explicit: 20K per dep output, 16K total knowledge, 2K per entry |

---

## 5. Context Management Within an Agent

### 5.1 MiroFlow: Proactive Context Limit Checking

The `IterativeAgentWithToolAndRollback` maintains a `message_history` list that grows with each turn. Two mechanisms prevent context overflow:

1. **Proactive check** (`ensure_summary_context`): Before each turn, pre-renders the summary prompt and estimates whether adding it would exceed `max_context_length`. If so, breaks the loop and generates a summary.

2. **Reactive catch** (`ContextLimitError`): If the LLM call itself fails due to context limits, catches the error and breaks to summary generation.

### 5.2 Astro: Compaction at Plan Entry + Threshold During Execution

- **At `/plan` entry:** Unconditional compaction. The entire conversation is compacted into a handoff summary before the plan generator runs.
- **During execution:** Auto-compaction triggers at 70% context window usage. Uses `STRUCTURED_COMPACTION_PROMPT` to produce a handoff summary.

### 5.3 Assessment

MiroFlow's proactive check is more precise -- it estimates whether the summary prompt would fit before each turn. Astro's 70% threshold is coarser. However, for frontier models with 200K+ context windows, the practical difference is small. The more important difference is that Astro compacts unconditionally at plan entry (a clean-slate operation), while MiroFlow only compacts when forced by limits.

---

## 6. Prompt Comparison

### 6.1 System Prompts

**MiroFlow Main Agent** (`main_agent_prompt_gaia.py`):
- Tool-use formatting instructions (XML-style MCP tags)
- Task Strategy: "Analyze -> Plan -> Execute -> Review"
- Tool-Use Guidelines: ONE tool call per response, self-contained context per call
- Tool-Use Communication Rules: STOP after one tool call
- No agent-specific objective (main agent is a generalist)

**MiroFlow Sub-Agent Worker** (`sub_worker.py`):
- Same tool-use formatting and guidelines as main agent
- Additional "Agent Specific Objective":
  - "You are an agent that performs various subtasks"
  - "Do not infer, speculate, or attempt to fill in missing parts"
  - File path handling instructions
  - Reliability assessment guidelines
  - "Focus on completing the specific subtask assigned to you"

**Astro:** System prompt assembled from project instructions (CLAUDE.md), skill definitions (SKILL.md files), and tool definitions (JSON schema). Supports parallel tool calls (no "one tool per response" restriction). Plan mode adds a read-only suffix when active.

### 6.2 Summary/Compaction Prompts

**MiroFlow** (`generate_summarize_prompt`) -- asks for a **complete report**:
> "Summarize ALL working history for this task, including your step-by-step thoughts, all tool calls, and all tool results (i.e., the full solving trajectory so far). Output the FINAL ANSWER and detailed supporting information."

**Astro** (`STRUCTURED_COMPACTION_PROMPT`) -- asks for a **handoff brief**:
> "Create a handoff summary for another LLM that will resume the task. Include: current progress, key decisions, what remains to be done, critical data, errors to avoid. Maximum 1000 tokens."

**Key difference:** MiroFlow optimizes for answer extraction (complete report). Astro optimizes for task continuation (handoff brief). MiroFlow's approach produces richer summaries because it asks for everything; Astro's is more token-efficient because it asks for only what's needed to continue.

### 6.3 Failure Prompts

**MiroFlow** (`ExceedMaxTurnSummaryGenerator`) -- structured post-mortem:
```
* Failure type: incomplete / blocked / misdirected / format_missed
* What happened: approach taken and why it didn't reach a final answer
* Useful findings: facts, intermediate results, conclusions that can be reused
```

**Astro** -- merge conflict resolution (operational):
```
MERGE CONFLICT DETECTED (attempt N/3)
Conflicting files: [list]
Please resolve: fetch, rebase, resolve markers, stage, continue rebase
```

Different domains, different failure modes. MiroFlow's failure is "couldn't find the answer." Astro's failure is "couldn't merge the code."

---

## 7. Rollback Mechanism -- Critical Assessment

### 7.1 What MiroFlow Does

MiroFlow's `IterativeAgentWithToolAndRollback` has a turn-level rollback for malformed LLM outputs:

1. **Truncation**: `finish_reason == "length"` or MCP tags without parsed tool calls -> rollback
2. **Refusal**: Response contains "I'm sorry, but I can't" -> rollback
3. **Duplicate queries**: Same tool call with same arguments -> rollback
4. Limits: `max_consecutive_rollbacks` (default 5), `max_duplicate_rollbacks` (default 3)

### 7.2 Do Frontier Models Need This?

**Truncation rollback:** With frontier models (Claude 3.5/4, GPT-5) that have 200K+ context windows and 8K+ output tokens, truncation due to `finish_reason == "length"` is rare. It was more relevant for older models with 4K output limits. For MiroThinker (a smaller open-source model), this is still relevant -- it's more likely to produce malformed XML or hit output limits.

**Refusal rollback:** Frontier models rarely refuse mid-task. When they do, retrying the same turn usually produces the same refusal. This is more useful for smaller models that sometimes refuse due to confusion rather than policy.

**Duplicate query rollback:** This is genuinely useful regardless of model size. Even frontier models sometimes repeat the same search query or file read in a loop. However, Astro already has a different mechanism for this -- the orchestrator's doom loop detection (`src/agents/doom_loop.py`) catches repetitive tool call patterns.

**Assessment:** For Astro-Assistant, which targets frontier models, the rollback mechanism provides marginal value. The truncation and refusal cases are rare. The duplicate query case is already handled by doom loop detection. The implementation cost (tracking all tool calls, managing rollback state) is not justified for the edge cases it covers.

---

## 8. What Astro-Assistant Should Adopt from MiroFlow

### 8.1 Richer Summary Prompts (HIGH VALUE)

MiroFlow's summary prompt asks for a **complete report** -- all findings, all tool calls, all results, the full solving trajectory. Astro's compaction prompt asks for a **handoff brief** -- progress, next steps, critical data, max 1000 tokens.

**The problem with Astro's approach:** When a sub-agent completes an EXPLORE node, its findings are compressed into a 1000-token handoff summary. This loses detail. The downstream IMPLEMENT node may need specific file paths, function signatures, or error messages that were in the sub-agent's conversation but didn't make it into the brief.

**What to adopt:** Use MiroFlow's "complete report" framing for the summary that feeds into the project knowledge store. The sub-agent should produce a comprehensive summary (not a brief) that includes:
- All key findings with specific details (file paths, line numbers, function names)
- Tool call results that produced useful information
- Decisions made and reasoning
- What was tried and didn't work (to avoid repeating)

This is different from the context compaction prompt (which should remain a brief for continuation). The distinction:
- **Compaction prompt** (within an agent): brief handoff for the same agent to continue. Keep it short.
- **Completion summary** (between agents): complete report for downstream agents. Be comprehensive.

Astro's knowledge auto-extraction (`extractKnowledgeFromSummary`) already decomposes summaries into `findings_*`, `summary_*`, and `work_*` entries. A richer summary produces richer knowledge entries.

### 8.2 Structured Failure Post-Mortems (MEDIUM VALUE)

MiroFlow's `ExceedMaxTurnSummaryGenerator` produces typed failure summaries:
- Failure type: `incomplete | blocked | misdirected | format_missed`
- What happened: approach taken and why it failed
- Useful findings: reusable facts and intermediate results

**What to adopt:** When a plan node fails, the executor should ask the sub-agent for a structured failure report before marking the node as failed. This report feeds into the replanner, which can make better decisions about how to replace the failed subgraph. Currently, Astro's replanner only sees the node's status and error message -- not a structured analysis of what went wrong.

Proposed failure summary prompt for Astro:
```
This task could not be completed. Before ending, produce a structured failure report:

1. **Failure type**: one of: incomplete (ran out of turns), blocked (missing dependency/access),
   misdirected (wrong approach), error (tool/runtime failure)
2. **What was attempted**: brief description of the approach taken
3. **What was learned**: any useful findings, file paths, or partial results
4. **Suggested next step**: what a replacement task should try differently
```

### 8.3 Sub-Agent-as-Tool Pattern (LOW VALUE for Astro-Assistant, but worth noting)

MiroFlow exposes sub-agents as MCP tools (`agent-worker::execute_subtask`). The main agent decides dynamically when to delegate. This is elegant for research tasks where the main agent doesn't know upfront how many sub-tasks it needs.

For Astro-Assistant, this pattern is less useful because:
- The planner generates the DAG upfront -- delegation is planned, not dynamic
- Git worktree isolation requires knowing the task structure before execution
- The executor handles delivery after each sub-agent -- dynamic spawning would complicate this

However, for the `agent` tool (sub-agent for focused investigation), Astro-Assistant already uses a similar pattern -- the main agent spawns a read-only sub-agent via tool call. MiroFlow's approach of returning a **complete summary report** (not just raw output) from the sub-agent is worth adopting for the `agent` tool.

### 8.4 What NOT to Adopt

| MiroFlow Feature | Why Not for Astro-Assistant |
|---|---|
| **Turn-level rollback** | Frontier models rarely truncate or refuse. Doom loop detection already handles repetition. |
| **Proactive context limit checking** | Astro already has threshold-based compaction (70%) and unconditional compaction at plan entry. Adding per-turn estimation adds complexity for marginal benefit with 200K+ context windows. |
| **One-tool-per-response restriction** | Astro supports parallel tool calls, which is faster. The restriction exists in MiroFlow because XML-based MCP parsing is fragile with multiple tool calls. Astro uses native provider tool calling (JSON), which handles parallel calls reliably. |
| **MCP XML tool format** | Astro uses native provider tool calling (Anthropic tool_use, OpenAI function_call). XML parsing with regex is fragile and the primary reason MiroFlow needs the rollback mechanism. |

---

## 9. Implementation Plan for Astro-Assistant

### Priority 1: Richer Completion Summaries

**File:** `src/session/compaction.py` -- add a new `COMPLETION_SUMMARY_PROMPT` distinct from `STRUCTURED_COMPACTION_PROMPT`.

```python
COMPLETION_SUMMARY_PROMPT = """\
You have completed a task. Produce a COMPLETE REPORT of everything you did and found.

Include:
- All key findings with specific details (file paths, line numbers, function names)
- Tool results that produced useful information (quote relevant output)
- Decisions made and the reasoning behind them
- Approaches that were tried and did not work (so downstream tasks avoid repeating them)
- Any partial results, data, or observations that may help related tasks

Be comprehensive. This report will be decomposed into knowledge entries for other agents.
Do NOT include tool call syntax or speculative filler. Focus on factual, specific information."""
```

**Used by:** The `PlanExecutor` after each sub-agent completes a node. The summary feeds into `extractKnowledgeFromSummary()` for the project knowledge store.

### Priority 2: Structured Failure Reports

**File:** `src/session/compaction.py` -- add `FAILURE_REPORT_PROMPT`.

```python
FAILURE_REPORT_PROMPT = """\
This task could not be completed. Produce a structured failure report:

1. **Failure type**: incomplete | blocked | misdirected | error
2. **What was attempted**: brief description of the approach
3. **What was learned**: useful findings, file paths, partial results
4. **Suggested next step**: what a replacement task should try differently

Be specific. This report will be used by the replanner to generate a better replacement task."""
```

**Used by:** The `PlanExecutor` when a node fails. The failure report is passed to the replanner as context for surgical replanning.

### Priority 3: Richer `agent` Tool Summaries

The existing `agent` tool (sub-agent for focused investigation) should return a complete report, not just raw output. Update the agent tool's post-processing to use `COMPLETION_SUMMARY_PROMPT` before returning results to the parent agent.

---

## 10. Summary Table

| Feature | MiroFlow | Astro | Adopt? |
|---|---|---|---|
| Plan representation | In-context numbered steps | Typed DAG (`ExecutionPlan`) | No -- Astro's is better |
| Sub-agent spawning | Tool call (`execute_subtask`) | Executor dispatches per DAG node | No -- different needs |
| Knowledge sharing | Summary text (single layer) | 3 layers: vision + deps + knowledge store | No -- Astro's is richer |
| Completion summary | Complete report (all findings, trajectory) | Brief handoff (1000 tokens) | **Yes** -- adopt richer summaries |
| Failure handling | Structured post-mortem (typed) | Error message only | **Yes** -- adopt structured failures |
| Rollback | Turn-level (undo last LLM response) | Doom loop detection | No -- marginal value for frontier models |
| Context limit check | Proactive per-turn estimation | 70% threshold + plan entry compaction | No -- already sufficient |
| Tool calls per turn | Strictly 1 (XML parsing fragility) | Multiple (native provider JSON) | No -- Astro's is faster |
| Tool protocol | MCP (XML tags, regex parsed) | Native provider tool calling | No -- Astro's is more reliable |
| Model routing | Per-agent YAML config | Per-node tier (SMALL/MEDIUM/LARGE) | No -- Astro's is more flexible |
| Isolation | Fresh AgentContext per sub-agent | Git worktree per task node | No -- Astro's is stronger |
