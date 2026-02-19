# Git Pull Hook

## Overview

The Git Pull Hook is an event-driven post-execution hook that automatically synchronizes the main project repository after task completion. This ensures that the main working directory stays up-to-date with any changes pushed from worktree-based task execution.

## How It Works

### Trigger Condition

The hook is triggered on `task.completed` events and performs the following steps:

1. **Validates prerequisites**:
   - Checks that the project has a `workingDirectory` configured
   - Verifies that the directory exists on the filesystem
   - Confirms that the directory is a git repository (has a `.git` folder)

2. **Executes git pull**:
   - Runs `git pull` in the project's working directory
   - Uses a 30-second timeout to prevent hanging
   - Logs both stdout and stderr output

3. **Handles errors gracefully**:
   - All errors are logged but don't prevent task completion
   - The hook is non-blocking and best-effort
   - Failed pulls are logged as warnings for debugging

## Use Case

When tasks are executed in worktrees (isolated git working trees):
1. Agent makes changes in the worktree
2. Agent commits and pushes changes to remote
3. Task completes successfully
4. Git Pull Hook triggers and pulls changes into main repo
5. Main repository is now synchronized with the pushed changes

This workflow ensures that the main repository stays synchronized without requiring manual intervention.

## Configuration

The hook requires:
- Project to have a `workingDirectory` set in the database
- The `workingDirectory` must be a valid git repository
- Git must be available on the system PATH

No additional configuration is required. The hook is automatically registered on server startup.

## Implementation

The hook is implemented in `server/lib/events/hooks/git-pull-hook.ts` and registered in `server/index.ts` along with other event hooks.

### Code Flow

```typescript
task.completed event
  → gitPullHook
    → Validate project.workingDirectory exists
    → Verify directory and .git exist
    → Execute: git pull (timeout: 30s)
    → Log output/errors
```

## Logging

The hook logs at different levels:

- **Info**: When pulling changes
  ```
  [git-pull-hook] Pulling latest changes in /path/to/repo
  [git-pull-hook] git pull output: Already up to date.
  ```

- **Warning**: When prerequisites aren't met
  ```
  [git-pull-hook] No working directory configured, skipping git pull
  [git-pull-hook] Working directory does not exist: /path/to/repo
  [git-pull-hook] Not a git repository: /path/to/repo
  ```

- **Warning**: When git pull fails
  ```
  [git-pull-hook] Failed to pull in /path/to/repo: Network error
  ```

## Error Handling

All errors are caught and logged, but never thrown. This ensures:
- Task completion isn't blocked by git pull failures
- Network issues don't affect task execution
- The system remains resilient to git configuration problems

## Testing

Tests are located in `server/lib/events/hooks/__tests__/git-pull-hook.test.ts`.

The test suite covers:
- ✅ Skipping non-task.completed events
- ✅ Skipping when project is missing
- ✅ Skipping when workingDirectory is missing
- ✅ Skipping when directory doesn't exist
- ✅ Skipping when not a git repository
- ✅ Executing git pull when all conditions are met
- ✅ Handling git pull errors gracefully

## Future Enhancements

Potential improvements:
- Add support for configurable git pull options (e.g., `--rebase`, `--ff-only`)
- Add metrics tracking for successful/failed pulls
- Add notification when pull brings in new changes
- Support for pulling specific branches
- Integration with conflict detection and resolution
