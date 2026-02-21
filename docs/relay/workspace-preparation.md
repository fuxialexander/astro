# Workspace Preparation

Git worktree management for task execution isolation.

## Overview

Each task executes in an isolated Git worktree to prevent conflicts when multiple tasks modify the same repository concurrently.

**Key Concept:** One repository → Multiple worktrees → Isolated task execution

## Worktree Structure

```
~/.astro/
├── main-repo/              # Main repository (shared)
│   ├── .git/               # Git directory
│   └── README.md
└── worktrees/
    ├── ws-abc123/          # Worktree for task 1
    │   ├── exec-task-1/    # Task execution directory
    │   │   ├── .git → ../../main-repo/.git/worktrees/exec-task-1
    │   │   └── src/
    │   └── exec-task-2/
    └── ws-def456/          # Worktree for task 2
        └── exec-task-3/
```

## Preparation Flow

```
1. Task dispatch received
   ↓
2. Agent runner checks if workspace exists
   └─ If no: git clone repository → ~/.astro/main-repo
   ↓
3. Create worktree for task
   └─ git worktree add ~/.astro/worktrees/{workspaceId}/exec-{executionId} {branch}
   ↓
4. Execute task in worktree directory
   ↓
5. On completion:
   - Commit changes (if any)
   - Push to branch (if auto-pr enabled)
   - Remove worktree: git worktree remove exec-{executionId}
```

## Related Documentation

- [Relay Overview](./overview.md)
- [Dispatch System](./dispatch-system.md)
- [Agent Runner Protocol](../guides/agent-runner-protocol.md)
