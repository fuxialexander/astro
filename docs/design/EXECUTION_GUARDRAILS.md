# Execution Guardrails: Task Lifecycle, Timeouts, and Dead Job Detection

> Design document for issue #720.
> Describes the current guardrail system, known gaps, and proposed improvements.

## Table of Contents

- [Task Lifecycle Overview](#task-lifecycle-overview)
- [Startup Phase](#startup-phase)
- [Execution Phase](#execution-phase)
- [Completion Phase](#completion-phase)
- [Current Timeout System](#current-timeout-system)
- [Activity Timer: What Resets It](#activity-timer-what-resets-it)
- [Approval Pause Mechanism](#approval-pause-mechanism)
- [Provider Event Patterns](#provider-event-patterns)
- [Compute Backend Scenarios](#compute-backend-scenarios)
- [Known Gaps](#known-gaps)
- [Proposed Changes](#proposed-changes)

---

## Task Lifecycle Overview

```
                          Frontend                    Server                     Agent Runner
                          --------                    ------                     ------------

                     updateNode("dispatched")
                             |
                     POST /api/dispatch/task ------>  validate + resolve deps
                             |                              |
                             |                        relay.dispatchTask() -----> WebSocket msg
                             |                              |                        |
                             |                        emit SSE "init"          spawn CLI process
                             |                        updateNode("in_progress")      |
                             |                              |                   session_init
                     receive SSE "init"  <-----------  onSessionInit <------------- WS msg
                             |                              |                        |
                             |                         [EXECUTION LOOP]              |
                             |                              |                   tool_use / text
                     receive SSE events  <-----------  onText/onToolTrace <-------- WS msg
                             |                              |                        |
                             |                              |                   tool_result
                     receive SSE events  <-----------  onToolTrace <--------------- WS msg
                             |                              |                        |
                             |                         [IF APPROVAL NEEDED]          |
                             |                              |                   approval_request
                     show approval card  <-----------  onApprovalRequest <--------- WS msg
                     user responds -------->           relay.sendApproval --------> WS msg
                             |                              |                   resume execution
                             |                              |                        |
                             |                         [EXECUTION COMPLETE]          |
                             |                              |                   task_result
                     receive SSE "done"  <-----------  onResult <----------------- WS msg
                             |                         compute finalNodeStatus
                             |                         updateNode(status)
                             |                         alive = false
                             |                         [STREAM CLOSES]
                             |
                     updateNode(finalStatus)
```

### Status Transitions

```
planned -----> dispatched -----> in_progress -----> auto_verified
  ^               (frontend)      (server)              |
  |                                   |                  +--> triggers autoDispatchDownstream()
  |                                   |
  |                                   +-----------> awaiting_judgment
  |                                                      |
  +--- (timeout reset) <---------+                       +--> user approves --> completed
                                  |                                               |
                                  |                  +--> triggers autoDispatchDownstream()
                           (timeout after all
                            retries exhausted)
```

---

## Startup Phase

**Definition:** From `relay.dispatchTask()` to first event received by the server.

```
Timeline:
  t=0     relay.dispatchTask() sends WebSocket message to agent runner
  t=?     agent runner receives message, queues task
  t=?     agent runner spawns CLI process (claude, codex, openclaw, opencode)
  t=?     CLI process initializes, connects to AI API
  t=?     CLI emits first "system" event --> adapter calls stream.sessionInit()
  t=?     agent runner sends task_session_init via WebSocket
  t=?     server receives session_init --> hasReceivedEvent = true
```

**What can go wrong:**

| Failure | Cause | Observable? |
|---------|-------|-------------|
| WebSocket message never delivered | Stale connection, network drop | No — relay thinks it sent successfully |
| Agent runner busy | All slots occupied, task queued | No — no feedback until slot opens |
| Agent runner crashed | Process died, OOM | Yes — machine heartbeat timeout detects |
| CLI process fails to spawn | Binary not found, permission error | Yes — agent runner sends task_result with error |
| API connection timeout | Rate limit, API outage | Partially — long delay before session_init |

**Current guardrail:** Two-tier timeout with retry.

```
                    STARTUP_TIMEOUT_MS (3 minutes)
                    |<---->|
  t=0     t=3m     t=6m         ...        t=30m      t=40m
  dispatch retry#1  retry#2      ...        retry#10   KILL
           cancel   cancel                  cancel     status='planned'
           re-send  re-send                 re-send    error msg saved
                                            (10 min final timeout)

  After each retry, timer resets. Last attempt uses FINAL_STARTUP_TIMEOUT_MS (10 min).
  Total worst case: 10 * 3 min + 10 min = ~40 minutes, 11 dispatch attempts.
```

**Code location:** `server/routes/dispatch.ts:1193-1194, 1657-1673`

---

## Execution Phase

**Definition:** From first event received (`hasReceivedEvent = true`) to `onResult`.

```
                    ACTIVITY_TIMEOUT_MS (2 hours)
                    |<--------------------------------------------->|
  event ---------> event ---------> event ---------> event -------->
  lastActivity     lastActivity     lastActivity     lastActivity
  resets           resets           resets           resets

  If gap between events exceeds ACTIVITY_TIMEOUT_MS:

  event ---------> [silence..........................] KILL
  lastActivity                                        status='planned'
                                                      error msg saved

  UNLESS waitingForApproval or hasPendingApproval:

  event --> approval_request --> [human away...] --> [human away...]
  lastActivity  waitingForApproval=true              timer resets
                                                     every 15s
                                                     (NEVER kills)
```

**Code location:** `server/routes/dispatch.ts:1196, 1649-1707`

---

## Completion Phase

**Definition:** `onResult` fires, computing final node status.

```
onResult fires:
  |
  +-- resultSent = true
  +-- alive = false
  |
  +-- isSuccess? (result.status === 'completed')
  |     |
  |     +-- YES -------+
  |     |              |
  |     +-- NO -----+  |
  |                  |  |
  |    FAILURE       |  SUCCESS
  |    status =      |  |
  |    'awaiting_    |  +-- deliveryOk?
  |     judgment'    |  |   (no status, or 'success', or 'skipped')
  |                  |  |     |
  |                  |  |     +-- YES --+
  |                  |  |     |        |
  |                  |  |     +-- NO   |
  |                  |  |         |    |
  |                  |  |    DELIVERY   |
  |                  |  |    FAILED     |
  |                  |  |         |    |
  |                  |  |         +-- yoloEnabled?
  |                  |  |              |
  |                  |  |              +-- YES --> auto_verified
  |                  |  |              +-- NO ---> awaiting_judgment
  |                  |  |
  |                  |  +-- (verification === 'auto' || yoloEnabled)?
  |                  |       |
  |                  |       +-- YES --> auto_verified
  |                  |       +-- NO ---> awaiting_judgment
  |                  |
  +------------------+
  |
  +-- SSE "done" event sent
  +-- alive = false --> heartbeat loop exits on next tick
  +-- [NO MORE SERVER PROCESS WATCHING THIS TASK]
  |
  +-- if auto_verified --> autoDispatchDownstream()
  +-- if awaiting_judgment --> blocked until user approves
```

### Completion Decision Matrix

```
+----------+----------------+---------------+------+-----------------------+
| Success? | Delivery       | Verification  | YOLO | Final Status          |
+----------+----------------+---------------+------+-----------------------+
| YES      | ok/skipped/nil | auto          | any  | auto_verified         |
| YES      | ok/skipped/nil | human         | OFF  | awaiting_judgment     |
| YES      | ok/skipped/nil | human         | ON   | auto_verified         |
| YES      | FAILED         | any           | OFF  | awaiting_judgment     |
| YES      | FAILED         | any           | ON   | auto_verified         |
| NO       | any            | any           | any  | awaiting_judgment     |
+----------+----------------+---------------+------+-----------------------+
```

### Post-Completion Safety

```
onResult:
  resultSent = true    <-- set immediately
  alive = false        <-- set at end of handler

Heartbeat loop (every 15s):
  if (!alive) { clearInterval(heartbeat); return }   <-- exits immediately
  ...
  if (!resultSent) {   <-- timeout logic ONLY fires when result not yet received
    // kill logic
  }

RESULT: After task completes, no timeout can fire. awaiting_judgment persists
        indefinitely in DB. Human can take as long as needed to respond.
```

**Code location:** `server/routes/dispatch.ts:1198-1385` (onResult), `1649-1712` (heartbeat)

---

## Current Timeout System

### Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `STARTUP_TIMEOUT_MS` | 3 minutes | `dispatch.ts` | Wait for first event from agent runner |
| `FINAL_STARTUP_TIMEOUT_MS` | 10 minutes | `dispatch.ts` | Last startup attempt (slow cold starts) |
| `ACTIVITY_TIMEOUT_MS` | 2 hours | `dispatch.ts` | Wait between events during execution |
| `MAX_STARTUP_RETRIES` | 10 | `dispatch.ts` | Re-dispatch attempts before giving up |
| Heartbeat interval | 15 sec | `dispatch.ts` | Polling frequency for timeout checks |
| One-shot task timeout | 2 min | `agent.ts:413` | Non-streaming operations (compaction, summary) |
| Relay machine heartbeat | 30 sec | `websocket-client.ts:62` | Agent runner liveness ping |

### History

PR #688 changed startup and activity timeouts from `3 min / 2 hours` to `5 days / 5 days`.
PR #726 restored sane timeouts: `3 min / 2 hours`, increased retries to 10, added `FINAL_STARTUP_TIMEOUT_MS`,
added `task:stdout` listener, and added Session Liveness instructions to compute backend skills.
Motivation was to prevent killing tasks waiting for user approval. However, the approval pause
mechanism (`waitingForApproval` flag + `hasPendingApprovalForExecution()` check) already handles
this case correctly — it resets the timer every 15 seconds while any approval is pending.

---

## Activity Timer: What Resets It

Every relay event handler in the dispatch SSE stream resets `lastActivity = Date.now()`:

```
+---------------------+---------------------------+-----------------------------------+
| Handler             | Relay Event               | What triggers it                  |
+---------------------+---------------------------+-----------------------------------+
| onResult            | task:result               | Agent finishes (success/failure)  |
| onText              | task:text                 | Agent writes text output          |
| onSessionInit       | task:session_init         | CLI process starts, gets session  |
| onProgress          | task:progress             | Adapter progress updates          |
| onToolTrace         | task:tool_trace           | Agent calls/completes a tool      |
| onFileChange        | task:file_change          | Agent creates/modifies a file     |
| onApprovalRequest   | task:approval_request     | Agent asks user a question        |
| onSafetyPrompt      | task:safety_prompt        | Workdir safety check fires        |
| onStdout            | task:stdout               | Raw stdout from adapters          |
|                     |                           | (SLURM output tailing, blocking   |
|                     |                           |  bash commands) — added in #726   |
+---------------------+---------------------------+-----------------------------------+
```

**Resolved (PR #726):** `task:stdout` listener added. Raw stdout from SLURM output tailing,
blocking Bash commands, and any adapter's `stream.stdout()` calls now resets the activity timer.

---

## Approval Pause Mechanism

```
Agent requests approval:
  onApprovalRequest fires
    --> lastActivity = Date.now()
    --> waitingForApproval = true
    --> SSE "approval_request" sent to browser

Heartbeat loop (every 15 seconds):
  if (Date.now() - lastActivity > timeoutMs) {
    if (waitingForApproval || hasPendingApproval) {
      lastActivity = Date.now()   // RESET -- never kills while approval pending
    } else if (!resultSent) {
      // ... kill logic (only if NO approval pending AND no result)
    }
  }

User responds:
  --> relay.sendApprovalResponse() to agent runner
  --> agent resumes, sends next event (text/tool_use)
  --> onText or onToolTrace fires
      --> waitingForApproval = false
      --> lastActivity = Date.now()

RESULT: Task survives indefinitely while waiting for human approval.
        This is correct behavior -- the 5-day timeout is NOT needed for this case.
```

**Code location:** `dispatch.ts:1496-1530` (onApprovalRequest), `dispatch.ts:1653-1655` (pause logic)

---

## Provider Event Patterns

How frequently each provider adapter emits events during normal execution:

```
Claude Code (claude-code-adapter.ts):
  session_init ----> [thinking: SILENT] ----> tool_use ----> [bash runs: SILENT] ----> tool_result
                     ~5-30 sec                               may be MINUTES              |
                                                             (npm build, git clone)      v
                                                                                    tool_use ...
  Uses: stream.text(), stream.toolUse(), stream.toolResult()
  Thinking: NOT visible (stream-json format only surfaces final output)
  Max silent gap: 1-10 minutes (during long bash commands)

Claude SDK (claude-sdk-adapter.ts):
  session_init ----> text tokens (streaming) ----> tool_use ----> tool_result ----> text ...
                     every ~100-500ms               immediate     after execution
  Uses: stream.text() (token-by-token), stream.toolUse(), stream.toolResult()
  Thinking: VISIBLE (extended thinking streamed as text)
  Max silent gap: seconds (most reliable for frequent events)

Codex (codex-adapter.ts):
  session_init ----> [reasoning: text] ----> tool_use ----> tool_result ----> text ...
                     per item.completed       per item      per item
  Uses: stream.text(), stream.toolUse(), stream.toolResult()
  Thinking: VISIBLE (reasoning items produce text events)
  Max silent gap: 10-30 seconds between turns

OpenClaw (openclaw-adapter.ts):
  session_init ----> text ----> tool_use ----> tool_result ----> text ...
                     per content.text    paired start/end
  Uses: stream.text(), stream.toolUse(), stream.toolResult()
  Max silent gap: 10-30 seconds

OpenCode (opencode-adapter.ts):
  session_init ----> text ----> tool_use ----> tool_result ----> text ...
                     per block   per block      per user event
  Uses: stream.text(), stream.toolUse(), stream.toolResult()
  Max silent gap: 30-60 seconds

SLURM (slurm-adapter.ts):
  status("running") ----> [PENDING...] ----> status("Job running") ----> [stdout tailing]
                          no events until      on state change only       every 5 sec BUT
                          state changes                                   via stream.stdout()
                                                                          NOT stream.text()
  Uses: stream.status(), stream.stdout(), stream.stderr()
  DOES NOT USE: stream.text(), stream.toolUse(), stream.toolResult()
  Max silent gap: UNBOUNDED (stdout not listened to by dispatch.ts)
```

### Event Flow Through the System

```
Agent Runner Adapter                  WebSocket                Relay Server              Dispatch SSE
--------------------                  ---------                ------------              ------------

stream.text(data)  -----> task_text ---------> handleAgentRunnerTaskText()
                                               emit('task:text', msg)  -------> onText()
                                                                                lastActivity = now  [OK]

stream.toolUse()   -----> task_tool_use -----> handleAgentRunnerTaskToolUse()
                                               emit('task:tool_trace', msg) --> onToolTrace()
                                                                                lastActivity = now  [OK]

stream.stdout(data) ----> task_output -------> handleAgentRunnerTaskOutput()
                                               emit('task:stdout', msg) ------> onStdout()
                                                                                lastActivity = now  [FIXED #726]

stream.status()    -----> task_status -------> handleAgentRunnerTaskStatus()
                                               emit('task:progress', msg) ----> onProgress()
                                                                                lastActivity = now  [OK]
```

---

## Compute Backend Scenarios

When an AI agent manages long-running jobs on external compute backends:

### Scenario 1: Agent submits Slurm job and polls (GOOD)

```
Agent: Bash("sbatch train.sh")     --> tool_use event   --> lastActivity resets [OK]
       result: "Submitted job 123" --> tool_result event --> lastActivity resets [OK]
       Bash("squeue -j 123")       --> tool_use event   --> lastActivity resets [OK]
       result: "RUNNING 00:05:00"  --> tool_result event --> lastActivity resets [OK]
       [waits 60 seconds, polls again]
       Bash("squeue -j 123")       --> tool_use event   --> lastActivity resets [OK]
       ...repeats...

Each poll is a discrete Bash tool call --> regular tool_use/tool_result events.
Activity timer resets every ~60 seconds. Task stays alive.
```

### Scenario 2: Agent submits Slurm job and goes silent (BAD)

```
Agent: Bash("sbatch train.sh")     --> tool_use event   --> lastActivity resets [OK]
       result: "Submitted job 123" --> tool_result event --> lastActivity resets [OK]
       [agent "thinks": I'll wait for the job to finish]
       [NO MORE TOOL CALLS]
       ...
       [ACTIVITY_TIMEOUT_MS later] --> KILLED (false negative)

Agent did not poll. No events flow. Timeout fires correctly from the system's
perspective, but the user's job is still running on the cluster.
```

### Scenario 3: Agent runs blocking command (FIXED by P3)

```
Agent: Bash("kubectl logs -f pod/train")  --> tool_use event --> lastActivity resets [OK]
       [bash blocks, streaming stdout for hours]
       stdout lines flow:                 --> task:stdout events --> onStdout() [FIXED #726]
       [activity timer resets on each stdout line]

Previously: dispatch.ts had no listener for task:stdout, so blocking commands timed out.
Now: onStdout resets lastActivity, keeping the session alive.
```

### Scenario 4: Native SLURM adapter (FIXED by P3)

```
SlurmAdapter.execute():
  sbatch script.sh                 --> stream.status("running")  --> task:progress --> lastActivity [OK]
  monitorJob() polls every 5s:
    squeue -j 123 (state=RUNNING)  --> [no event, state unchanged]
    tail output file               --> stream.stdout(data) --> task:stdout --> onStdout() [FIXED #726]
    squeue -j 123 (state=RUNNING)  --> [no event, state unchanged]
    tail output file               --> stream.stdout(data) --> task:stdout --> onStdout() [FIXED #726]
    ...repeats for hours...
  squeue -j 123 (state=COMPLETED)  --> stream.status("completed") --> task:progress --> lastActivity [OK]

Previously: only state transitions reset the timer. Now: stdout from output file tailing
resets the timer every 5 seconds, keeping long-running SLURM jobs alive.
```

---

## Known Gaps

### Gap 1: Both timeouts are 5 days — RESOLVED (#726)

The approval pause mechanism already prevents killing tasks during human intervention.
The 5-day timeout only matters for genuine dead agents (no approval pending, no events).
A dead agent is detectable within minutes, not days.

**Impact:** Dead tasks hang for up to 20 days (4 attempts * 5 days) before recovery.

**Resolution:** Startup timeout → 3 min × 10 retries + 10 min final (~40 min). Activity timeout → 2 hours.

### Gap 2: `task:stdout` not listened to — RESOLVED (#726)

`dispatch.ts` registers listeners for `task:text`, `task:progress`, `task:tool_trace`,
etc. but NOT `task:stdout`. Any adapter or execution path that produces raw stdout
(SLURM output tailing, blocking Bash commands) will not reset the activity timer.

**Impact:** SLURM jobs and blocking commands appear dead despite active output.

**Resolution:** Added `relayServer.on('task:stdout', onStdout)` — resets `lastActivity` and sets `hasReceivedEvent = true`.

### Gap 3: No `dispatched` recovery on frontend

Frontend sets `status: "dispatched"` optimistically (`execution-store.ts:455`) before
POSTing to `/api/dispatch/task`. If the HTTP request fails, the node stays `dispatched`
forever with no recovery mechanism.

**Impact:** Tasks stuck in `dispatched` state after network errors.

**Fix:** Add a frontend reconciliation check — if a node has been `dispatched` for >2 minutes
with no SSE `init` event, reset to `planned` with an error.

### Gap 4: Agent runner `activeTasks` not cross-referenced

The agent runner sends heartbeats every 30 seconds containing actual task IDs:
```json
{ "type": "heartbeat", "payload": { "activeTasks": ["task-1", "task-2"], ... } }
```

But the server only stores `activeTasks.length` (`relay-server.ts:1888`), discarding
the task IDs. A task the server considers `in_progress` but the runner doesn't list
in `activeTasks` is a dead task — detectable within ~1 minute.

**Impact:** Most robust dead job detection signal is available but unused.

**Fix:** Store actual task IDs in the heartbeat handler. Periodically compare against
server-tracked dispatched tasks. If a task is missing from the runner's active list
for 2+ consecutive heartbeats, mark it as dead.

### Gap 5: Compute backend skills don't instruct polling — RESOLVED (#726)

The skills (`skills/compute_backend_default/{slurm,k8s-exec,docker}/SKILL.md`) teach
agents how to submit and monitor jobs but don't instruct them to poll regularly. An
agent may submit a job and go silent, producing no tool events.

**Impact:** Long-running compute jobs look dead because the agent doesn't poll.

**Resolution:** "Session Liveness" section added to all three compute backend skills (slurm, docker, k8s-exec).
Agents instructed to: poll every 60s with discrete tool calls, tail output between polls, never go silent,
avoid blocking commands as sole monitoring, and report progress to the user.

### Gap 6: Server-side dispatch SSE can die silently

When `autoDispatchDownstream()` calls `serverSideDispatch()`, it creates an internal
HTTP POST with an SSE consumer running in the background. If this connection dies
(server restart, memory pressure), the task is stuck in `in_progress` with no watcher.

**Impact:** Auto-cascaded tasks can get stuck after server restarts.

**Fix:** P4 — periodic server-side watchdog that checks `plan_nodes WHERE status = 'in_progress'`
against recent `streaming_events` entries.

---

## Proposed Changes

### P1: Reduce startup timeout + increase retries — DONE (#726)

```
BEFORE (PR #688):
  STARTUP_TIMEOUT_MS = 5 days
  MAX_STARTUP_RETRIES = 3
  Total worst case: 4 * 5 days = 20 days

IMPLEMENTED:
  STARTUP_TIMEOUT_MS = 3 minutes
  MAX_STARTUP_RETRIES = 10
  FINAL_STARTUP_TIMEOUT_MS = 10 minutes (last attempt only)
  Total worst case: 10 * 3 min + 10 min = 40 minutes

Rationale:
  - session_init arrives within seconds for ALL providers
  - 3 minutes is generous for transient failures
  - 10 retries covers intermittent issues (busy runner, network blips)
  - 10 minute final attempt covers slow machine cold starts
  - Approval pause mechanism is unaffected (only fires after hasReceivedEvent)
```

### P2: Cross-reference `activeTasks` heartbeat (Medium effort, highest value) ✅

```
Implementation:
  MachineRegistryEntry.activeTaskIds: string[]  — stores actual task IDs from heartbeat
  RelayServer.startDeadJobChecker(): 60-second interval, 2-miss threshold
  RelayServer.getTasksForMachine(): reverse lookup of taskToMachine Map
  Emits 'task:dead' event → server/index.ts handler resets plan_node to 'planned'

Flow:
  1. Agent runner heartbeat: { activeTasks: ["task-1", "task-2"] }
  2. handleAgentRunnerHeartbeat() stores IDs via machineRegistry.updateActiveTaskIds()
  3. Every 60s, dead job checker compares server taskToMachine vs runner activeTaskIds
  4. After 2 consecutive misses (~2 min), emits task:dead → DB reset to 'planned'

Benefits:
  - Detects dead tasks within ~1-2 minutes regardless of event patterns
  - Works for ALL providers including SLURM
  - Works for blocking commands, silent agents, crashed CLIs
  - Independent of timeout values
```

### P3: Listen for `task:stdout` — DONE (#726)

```
// In dispatch.ts, added alongside existing listeners:

const onStdout = (msg: TaskStdoutMessage) => {
  if (!alive || msg.output.taskId !== executionId) return
  lastActivity = Date.now()
  hasReceivedEvent = true
}

relayServer.on('task:stdout', onStdout)
// ... and in cleanup:
relayServer.off('task:stdout', onStdout)
```

This ensures SLURM output tailing and blocking Bash commands reset the activity timer.

### P4: Activity timeout — DONE (#726)

```
IMPLEMENTED:
  ACTIVITY_TIMEOUT_MS = 2 hours

Rationale:
  - Approval pause already handles human intervention (resets timer indefinitely)
  - 2 hours covers: long builds (npm, docker), large git operations, slow APIs
  - With P3 (stdout listener), SLURM jobs with output stay alive
  - With P5 (skill instructions), agents poll regularly for compute jobs
  - If P2 is implemented, activity timeout becomes a fallback only
```

### P5: Compute backend skill instructions — DONE (#726)

Add "Session Liveness" sections to each compute skill instructing agents to:
- Poll job status every 60 seconds with discrete `Bash` tool calls
- Tail output files between polls to surface progress
- Report progress to the user between polls
- Never use blocking commands (`logs -f`, `srun`) as sole monitoring
- Never submit a job and wait silently

### P6: Frontend `dispatched` watchdog (Low effort)

In the execution store, add a timeout check: if a node has been in `dispatched` status
for >2 minutes with no SSE `init` event received, reset it to `planned` with an error
message and allow the user to retry.

### P7: Server-side `in_progress` watchdog (Medium effort) ✅

```
Implementation:
  server/lib/execution-watchdog.ts — standalone module (cleanup-scheduler pattern)
  startExecutionWatchdog() / stopExecutionWatchdog() — started in server/index.ts
  5-minute interval, 2-hour stale threshold (configurable via WatchdogConfig)
  Uses Redis leader election for multi-instance safety (only one instance runs the watchdog)

Flow:
  1. Query plan_nodes WHERE status IN ('in_progress', 'dispatched')
     AND updated_at < NOW() - 2 hours AND deleted_at IS NULL
  2. For each stale node, check:
     a. dispatchEngine.hasPendingApprovalForExecution() — skip if approval pending
     b. streaming_events for any recent events — skip if activity found
  3. If truly stale: reset to 'planned' with descriptive error message

Also provides stream-level timeout: if a dispatch SSE stream has no activity
for streamTimeoutMs, the watchdog emits a synthetic error event and closes
the stream (prevents silent stream death).
```

Cross-references against `streaming_events` — if no recent events and no pending
approval, reset to `planned`. Handles server restarts and dead internal SSE connections.

**Key file**: `server/lib/execution-watchdog.ts`

---

## Implementation Priority

```
Priority   Proposal   Effort    Impact                                                       Status
--------   --------   ------    ------                                                       ------
HIGH       P1         Low       Reduces 20-day worst case to 40 min for startup failures     ✅ Done (#720)
HIGH       P3         Low       Fixes task:stdout gap — one listener addition                ✅ Done (#720)
HIGH       P5         Low       Prevents silent agents on compute backends                   ✅ Done (#720)
MEDIUM     P2         Medium    Most robust dead job detection (heartbeat cross-reference)    ✅ Done
MEDIUM     P4         Low       Restores original 2-hour activity timeout safely              ✅ Done (#720)
LOW        P6         Low       Frontend dispatched recovery                                  Deferred (server-side covers)
LOW        P7         Medium    Server-side in_progress watchdog (belt-and-suspenders)        ✅ Done
```
