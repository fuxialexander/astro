# Prompt Caching Implementation

This document explains Astro's prompt caching strategy, optimized for cost efficiency and performance.

## Overview

Astro uses **Claude's Prompt Caching** feature to reduce API costs by up to 90% for repeated context. The implementation is designed for git-worktree scenarios where multiple tasks share the same initial codebase state.

## Cache Strategy

### Cache Hierarchy (Most Stable → Most Dynamic)

1. **MCP Tools** (1h cache)
   - ~3K tokens (18 tool definitions)
   - Cache hit: **90% cost savings**
   - Stable across ALL executions
   - Cached automatically via SDK

2. **Repository Context** (1h cache)
   - ~15K tokens (CLAUDE.md, README.md, package.json, file tree)
   - Cache hit: **90% cost savings**
   - **Key for worktree scenarios** ⭐
   - Read from source repo, not worktree path

3. **Vision Document** (1h cache)
   - ~2K tokens (project vision/goals)
   - Cache hit: **90% cost savings**
   - Stable per project

4. **Dependency Context** (5m cache)
   - ~5K tokens (outputs from upstream tasks)
   - Cache hit: **90% cost savings**
   - Shared by downstream tasks in same branch

### Total Potential Savings

**Typical task with repo:**
- Without caching: ~23K tokens × $3/MTok = **$0.069**
- With caching (after first): ~23K × $0.30/MTok = **$0.0069**
- **Savings: 90%** for subsequent tasks

**10 tasks in a project:**
- Without caching: $0.69
- With caching: $0.069 + (9 × $0.0069) = **$0.131**
- **Total savings: 81%**

## Git Worktree Caching

### The Problem

When tasks create worktrees:
```bash
/Repos/my-project/                    ← Source repo
/Repos/my-project/.git/worktrees/task-1/  ← Worktree 1
/Repos/my-project/.git/worktrees/task-2/  ← Worktree 2
```

Each worktree has a **different path**, which normally breaks caching.

### The Solution

**Cache the source repo content**, not the worktree path:

1. Extract source repo path from worktree: `/Repos/my-project/.git/worktrees/task-1/` → `/Repos/my-project/`
2. Read repo context (CLAUDE.md, file tree, etc.) from **source repo**
3. Cache this context with 1-hour TTL
4. Set `cwd: worktreePath` for file operations

**Result**: All worktrees from the same source repo get **cache hits**! ✅

### Implementation

See `server/lib/providers/cache-utils.ts`:

```typescript
// Extract source repo from worktree path
const sourceRepo = extractSourceRepoPath(worktreePath)
// /path/.git/worktrees/task-1 → /path

// Read context from source (not worktree)
const repoContext = readRepoContext(sourceRepo)

// Cache it (all worktrees share this)
buildCachedSystemPrompt({
  repoContext,        // 1h cache
  visionDoc,          // 1h cache
  dependencyContext,  // 5m cache
})

// Execute in worktree (can modify files independently)
query({ cwd: worktreePath, ... })
```

## Cache TTL Strategy

### 1-Hour Cache (Stable Content)
- **MCP Tools**: Never change during a session
- **Repo Context**: Only changes when source repo updates
- **Vision Doc**: Rarely modified during active work
- **Use case**: Long-running projects, agent workflows

### 5-Minute Cache (Dynamic Content)
- **Dependency Context**: Changes per task but shared by immediate downstream tasks
- **Use case**: Sequential task execution within 5 minutes

## Monitoring Cache Effectiveness

Logs show cache performance:

```bash
[claude-code] Cache stats: 23450 tokens, 87.2% hit rate, ~78% cost savings
```

- **Total tokens**: Full input context size
- **Hit rate**: Percentage read from cache vs created
- **Cost savings**: Estimated savings from cache hits

## When Cache Invalidates

According to Claude's documentation, cache breaks when:

### ✅ Safe (Cache Preserved)
- User message changes
- Task prompt changes
- Working directory path changes (if using our worktree pattern)
- Model selection (sonnet → opus)

### ❌ Breaks Cache
- System prompt changes
- Tool definitions change
- Vision doc modified
- Repo context modified (CLAUDE.md, README, package.json changes)
- Image presence changes
- Speed toggle (`speed: "fast"`)

## File Structure

```
server/lib/providers/
├── cache-utils.ts              # Cache utility functions
│   ├── buildCachedSystemPrompt()   # Build blocks with cache_control
│   ├── addToolCaching()            # Add cache to tools
│   ├── calculateCacheStats()       # Monitor effectiveness
│   └── extractSourceRepoPath()     # Worktree path extraction
│
└── adapters/
    └── claude-code.ts          # Uses cache utilities
        ├── prepareContext()        # Builds cached system blocks
        └── stream()/execute()      # Passes blocks to SDK
```

## API Reference

### `buildCachedSystemPrompt(options)`

Builds system prompt blocks with cache controls.

**Parameters:**
```typescript
{
  baseInstructions?: string      // No cache (task-specific)
  repoContext?: RepoContextResult  // 1h cache
  visionDoc?: string             // 1h cache
  dependencyContext?: string     // 5m cache
  workingDirectory?: string      // No cache (reference only)
}
```

**Returns:**
```typescript
CacheControlBlock[] // Array of system blocks with cache_control
```

### `extractSourceRepoPath(worktreePath)`

Extracts source repo path from worktree path.

**Example:**
```typescript
extractSourceRepoPath('/path/to/repo/.git/worktrees/task-1')
// → '/path/to/repo'

extractSourceRepoPath('/path/to/normal-repo')
// → '/path/to/normal-repo' (unchanged)
```

### `calculateCacheStats(usage)`

Calculates cache effectiveness from API usage metrics.

**Parameters:**
```typescript
{
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
}
```

**Returns:**
```typescript
{
  totalInputTokens: number       // Full context size
  cacheHitRate: number          // 0-1 (percentage of cache hits)
  estimatedSavings: number      // Estimated % cost reduction
}
```

## Best Practices

### ✅ Do

- Use worktree pattern for parallel task execution
- Keep vision docs stable during active work
- Group related tasks to maximize 5m dependency cache
- Monitor cache logs to validate effectiveness
- Use 1h cache for stable project-level context

### ❌ Don't

- Modify CLAUDE.md frequently during task batches
- Change tool definitions mid-session
- Toggle between speed modes repeatedly
- Rely on caching for rapidly changing system prompts

## Troubleshooting

### Low Cache Hit Rate (<50%)

**Possible causes:**
- System prompts changing between requests
- Repo context being read from different paths
- Vision doc modifications
- Tool definitions changing

**Solutions:**
- Verify worktree path extraction is working
- Check logs for source repo path
- Ensure vision doc is stable
- Avoid modifying CLAUDE.md during task batches

### No Cache Hits

**Check:**
1. Is prompt > minimum cacheable size? (1024 tokens for Sonnet)
2. Are cache_control blocks present in system prompt?
3. Is request within 5m (or 1h) of previous request?
4. Are tool definitions identical?

### Cache Invalidating Too Often

**Solutions:**
- Move changing content AFTER cached blocks
- Use 5m cache for dynamic content
- Keep stable content (tools, repo, vision) first
- Separate task-specific instructions from cached context

## Performance Impact

### Latency
- **Cache write** (first request): Same latency as without caching
- **Cache hit** (subsequent): Faster time-to-first-token for large contexts

### Cost
- **Cache write**: 1.25x base price (5m) or 2x base price (1h)
- **Cache hit**: 0.1x base price (90% savings!)
- **Break-even**: 2-3 requests with same context

### Rate Limits
- **Cache hits don't count toward rate limits** 🎉
- Only non-cached tokens count
- Enables higher effective throughput

## References

- [Claude Prompt Caching Documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [Agent SDK Documentation](https://github.com/anthropics/anthropic-sdk-typescript)
- `server/lib/providers/cache-utils.ts` - Implementation
- `server/lib/repo-context.ts` - Repo context reader
