# Approval System - Quick Start Guide

This guide shows you how to add user approvals to your agent workflows in Nexus.

## Three Ways to Get User Input

### 1. Dynamic Questions (Recommended for Agents)

Use the `ask_user_question` MCP tool when your agent encounters a decision point during execution.

**When to use:**
- Agent discovers multiple valid approaches
- Architectural decisions depend on user preferences
- Trade-offs where user priorities matter

**How it works:**

The tool is automatically available to agents running in Claude Code provider. Just call it:

```typescript
// Agent calls this during execution
const result = await ask_user_question({
  question: "Which database should we use for caching?",
  options: [
    "Redis (fast, in-memory, requires separate service)",
    "SQLite (embedded, simple, slower at scale)",
    "PostgreSQL (consistent with main DB, more overhead)"
  ]
})

// result = "User selected: Redis (fast, in-memory, requires separate service)"
```

**What happens:**
1. Agent execution pauses
2. User sees `ApprovalCard` in Dashboard or Task Detail page
3. User selects option and clicks Confirm
4. Tool returns selected option
5. Agent continues with user's choice

**Guidelines:**
- Provide 2-5 clear, self-contained options
- Include context/trade-offs in option descriptions
- Don't use for things you can research yourself
- Don't use for standard best practices (just apply them)

### 2. Procedure Approvals (Predefined Gates)

Define approval points in your procedure workflows where you ALWAYS want user input.

**When to use:**
- Critical operations that should never be automated (e.g., deploy to production)
- Multi-step procedures with known decision points
- Situations where you want to enforce human review

**How it works:**

Define approval gates in your procedure:

```typescript
{
  name: 'feature-implementation',
  subroutines: [
    {
      name: 'plan',
      promptTemplate: 'Analyze and identify 2-3 implementation approaches.',
      singleTurn: true,
    },
    {
      name: 'choose-approach',
      promptTemplate: 'Implement using: {{approvalResult}}',
      requiresApproval: true,
      approvalMessage: 'Which implementation approach should I use?',
      approvalOptions: [
        'Approach 1: Minimal change to existing code',
        'Approach 2: Refactor for cleaner architecture',
        'Approach 3: Build new abstraction',
      ],
    },
    {
      name: 'implement',
      promptTemplate: 'Implement with tests.',
      usesValidationLoop: true,
      validationCommand: 'npm test',
    },
  ],
}
```

**What happens:**
1. Procedure runs until it hits the approval subroutine
2. Execution pauses, node status becomes `awaiting_approval`
3. User sees `ApprovalCard` in UI
4. User selects option
5. Next subroutine receives selection via `{{approvalResult}}` template variable

**Binary approval example:**

```typescript
{
  name: 'deploy',
  promptTemplate: 'Create and merge PR for production deployment.',
  requiresApproval: true,
  approvalMessage: 'Approve deployment to production?',
  // No options = binary approve/reject
}
```

User sees Approve/Reject buttons instead of multiple choice.

### 3. Agent Guidance (No Pause)

Let the agent make the decision autonomously but note the options considered.

**When to use:**
- Non-critical decisions
- Routine choices with clear best practices
- Situations where pausing would slow down progress

**How it works:**

The agent is instructed via system prompt to:
1. Note when it encounters a decision point
2. Present options and rationale in output
3. State its recommendation
4. Proceed with recommended approach
5. User can course-correct via steering chat if needed

**Agent output example:**

```
I need to choose a state management solution for the new feature.

Options:
1. Zustand - Lightweight (2KB), already used in the project, simple API
2. Redux Toolkit - More structured, better DevTools, steeper learning curve
3. React Context - Native, no dependencies, but requires more boilerplate

Recommendation: I recommend Zustand since it's already used elsewhere in the
codebase (see src/stores/), has a simpler API, and will maintain consistency.

Proceeding with Zustand implementation unless you'd like me to use a different
approach.
```

**User can:**
- Let it proceed (do nothing)
- Send steering message: "Actually, let's use Redux Toolkit for better debugging"
- Agent adjusts and continues

## Testing Your Approvals

### Demo the Flow

See how approvals work visually:

```bash
npm run demo:approval
```

### Test the Integration

Verify everything is wired correctly:

```bash
# Terminal 1: Start backend
npm run dev:backend

# Terminal 2: Run tests
npm run test:approval
```

### End-to-End Test

1. Start full stack: `npm run dev`
2. Create a project
3. Dispatch a task that calls `ask_user_question`
4. Check Dashboard - you should see an `ApprovalCard`
5. Select an option and click Confirm
6. Verify agent continues with your choice

## UI Components

The `ApprovalCard` component automatically handles both approval types:

**Multi-choice:**
```tsx
<ApprovalCard
  approval={{
    approvalId: "approval-123",
    message: "Which approach?",
    options: ["Option A", "Option B", "Option C"]
  }}
  onRespond={respondToApproval}
/>
```

Shows radio buttons with Confirm/Cancel.

**Binary:**
```tsx
<ApprovalCard
  approval={{
    approvalId: "approval-456",
    message: "Deploy to production?"
  }}
  onRespond={respondToApproval}
/>
```

Shows Approve/Reject buttons.

## Best Practices

### When to Use Each Approach

| Situation | Approach | Why |
|-----------|----------|-----|
| Agent discovers decision during execution | Dynamic tool | Flexible, agent can ask when needed |
| Known decision points in workflow | Procedure approval | Consistent, predictable gates |
| Routine technical choices | Agent guidance | Faster, agent uses judgment |
| Critical operations (deploy, delete) | Procedure approval | Always require human sign-off |
| Exploring trade-offs | Dynamic tool | Agent can explain context |
| Applying best practices | Agent guidance | Don't pause for standard decisions |

### Writing Good Options

✅ **Good:**
```
"Redis (fast, in-memory, requires separate service)"
"SQLite (embedded, simple, slower at scale)"
"PostgreSQL (consistent with main DB, more overhead)"
```

Each option includes the choice AND the trade-offs.

❌ **Bad:**
```
"Redis"
"SQLite"
"PostgreSQL"
```

No context - user can't make informed decision.

### Question Quality

✅ **Good:**
```
"Which database should we use for caching? We need fast reads but can tolerate occasional cache misses."
```

Clear context, specific use case.

❌ **Bad:**
```
"What database?"
```

Too vague, no context.

### Timeout Handling

Approvals timeout after 5 minutes by default. The agent receives an error and can:
- Proceed with a default choice (document in output)
- Retry with a simpler question
- Pause and wait for user to steer

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Agent (Claude SDK)                                           │
│   ↓ calls ask_user_question tool                            │
│ MCP Server (nexus-tools-server.ts)                          │
│   ↓ HTTP POST /api/dispatch/request-dynamic-approval        │
│ Dispatch Engine (dispatch-engine.ts)                        │
│   ↓ emits approval.requested event                          │
│ Event System (nexusEventTransport)                          │
│   ↓ SSE to browser                                          │
│ UI (ApprovalCard)                                           │
│   ↓ user selects                                            │
│ POST /api/dispatch/approve                                  │
│   ↓ resolves promise                                        │
│ Returns selected option to agent                            │
└─────────────────────────────────────────────────────────────┘
```

## Troubleshooting

**Approval not appearing in UI:**
- Check browser console for SSE errors
- Verify execution store has pending approval (React DevTools)
- Check SSE connection: `curl http://localhost:3001/api/events/stream`

**MCP tool not available:**
- Verify Claude Code provider is being used
- Check agent logs for "Nexus MCP Tools Server running"
- Ensure MCP server is in provider's mcpServers config

**Approval timeout:**
- Default is 5 minutes
- User may have closed browser tab
- Check if approval event was emitted (server logs)

## Related Documentation

- `APPROVAL_SYSTEM.md` - Complete architecture documentation
- `scripts/README.md` - Testing documentation
- `server/lib/mcp/nexus-tools-server.ts` - MCP server implementation
- `server/lib/dispatch/dispatch-engine.ts` - Approval logic
