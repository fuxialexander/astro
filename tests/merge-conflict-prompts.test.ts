/**
 * Comprehensive tests for merge conflict resolution prompt changes in astro.
 *
 * Covers:
 * 1. buildInteractivePlanPrompt — Push to GitHub rebase/conflict instructions
 * 2. Task description quality guidance
 * 3. Parallel task file separation guidance
 * 4. Dead code removal verification — buildPlanSystemPrompt is gone
 * 5. Re-export shim completeness — server/lib/prompt-templates.ts
 * 6. buildRefinementPrompt — replan example description quality
 * 7. PLAN_GRAPH_SCHEMA — description field reinforcement
 */

import { describe, it, expect } from 'vitest'
import {
  buildInteractivePlanPrompt,
  buildChatSystemPrompt,
  buildTaskChatSystemPrompt,
  buildTaskExecutionPrompt,
  buildTitleGenerationPrompt,
  buildRefinementPrompt,
  buildLabelSuggestionPrompt,
  buildSummaryPrompt,
  buildCompactionPrompt,
  sanitizeGitHubName,
  sanitizeGitBranch,
  PLAN_GRAPH_SCHEMA,
  type GitHubContextForPrompt,
  type TaskExecutionContext,
  type TaskChatContext,
  type RefinementInput,
} from '../packages/core/src/prompt-templates'

// ============================================================================
// 1. Push to GitHub — rebase & conflict resolution instructions
// ============================================================================

describe('Push to GitHub — rebase & conflict resolution', () => {
  const githubCtx: GitHubContextForPrompt = {
    hasRepo: true,
    owner: 'myorg',
    repo: 'myrepo',
    baseBranch: 'main',
  }

  it('includes pre-PR rebase instruction', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: githubCtx })
    expect(prompt).toContain('git fetch origin main && git rebase origin/main')
  })

  it('includes conflict resolution during rebase', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: githubCtx })
    expect(prompt).toContain('resolve each conflicting file')
    expect(prompt).toContain('git add the resolved files')
    expect(prompt).toContain('git rebase --continue')
  })

  it('includes force-push with --force-with-lease', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: githubCtx })
    expect(prompt).toContain('--force-with-lease')
  })

  it('includes post-PR conflict handling', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: githubCtx })
    expect(prompt).toContain('if GitHub reports merge conflicts')
    expect(prompt).toContain('rebase onto the latest')
  })

  it('includes CI check retry cycle', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: githubCtx })
    expect(prompt).toContain('up to 3 retry cycles')
    expect(prompt).toContain('CI checks')
  })

  it('uses sanitized owner/repo in description', () => {
    const ctx: GitHubContextForPrompt = {
      hasRepo: true,
      owner: 'my<org>',
      repo: 'my<repo>',
      baseBranch: 'main',
    }
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).toContain('myorg/myrepo')
    expect(prompt).not.toContain('<org>')
  })

  it('uses sanitized baseBranch', () => {
    const ctx: GitHubContextForPrompt = {
      hasRepo: true,
      owner: 'org',
      repo: 'repo',
      baseBranch: 'main; rm -rf /',
    }
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    // Sanitized: only [a-zA-Z0-9._/-]
    expect(prompt).toContain('`mainrm-rf/`')
    expect(prompt).not.toContain('; rm -rf /')
  })

  it('omits Push to GitHub when hasRepo is false', () => {
    const ctx: GitHubContextForPrompt = { hasRepo: false }
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).not.toContain('Push to GitHub')
  })

  it('omits Push to GitHub when owner missing', () => {
    const ctx: GitHubContextForPrompt = { hasRepo: true, repo: 'myrepo' }
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).not.toContain('Push to GitHub')
  })

  it('omits Push to GitHub when repo missing', () => {
    const ctx: GitHubContextForPrompt = { hasRepo: true, owner: 'myorg' }
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).not.toContain('Push to GitHub')
  })

  it('omits Push to GitHub when no githubContext', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).not.toContain('Push to GitHub')
  })

  it('defaults baseBranch to main when not provided', () => {
    const ctx: GitHubContextForPrompt = {
      hasRepo: true,
      owner: 'org',
      repo: 'repo',
      // baseBranch omitted
    }
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).toContain('`main`')
  })

  it('Push to GitHub node has correct metadata', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: githubCtx })
    expect(prompt).toContain('verification: "auto"')
    expect(prompt).toContain('estimate: "XS"')
    expect(prompt).toContain('labelIds: ["l4"]')
  })

  it('Push to GitHub has acceptance criteria with gh pr checks', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: githubCtx })
    expect(prompt).toContain('gh pr checks')
    expect(prompt).toContain('autoVerifiable: true')
  })
})

// ============================================================================
// 2. Task description quality guidance
// ============================================================================

describe('Task description quality guidance', () => {
  it('includes Task Description Quality section', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('## Task Description Quality')
  })

  it('instructs concrete developer brief, not vague summary', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('concrete brief')
    expect(prompt).toContain('which files/modules')
    expect(prompt).toContain('what "done" looks like')
  })

  it('warns against vague descriptions', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('Avoid vague descriptions')
  })

  it('plan schema description field references developer brief', () => {
    const descProp = PLAN_GRAPH_SCHEMA.properties.nodes.items.properties.description
    expect(descProp.description).toContain('concrete developer brief')
    expect(descProp.description).toContain('prompt sent to the AI agent')
  })

  it('example description in plan output is generic, not project-specific', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('Concrete developer brief')
    // Should NOT contain Astro-specific file paths
    expect(prompt).not.toContain('packages/core/src')
    expect(prompt).not.toContain('server/routes')
  })
})

// ============================================================================
// 3. Parallel task file separation guidance
// ============================================================================

describe('Parallel task file separation guidance', () => {
  it('includes Parallel Task File Separation section', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('## Parallel Task File Separation')
  })

  it('instructs file boundary splitting', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('Split by file boundaries')
    expect(prompt).toContain('each parallel task should touch distinct files')
  })

  it('instructs dependency edges for shared files', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('must modify the same file, add a dependency edge')
  })

  it('instructs shared types in earlier task', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('shared types/interfaces in an earlier task')
  })

  it('instructs grouping related changes', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('component + test + styles')
  })

  it('explains why — merge conflicts from parallel agents', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('minimize merge conflicts')
    expect(prompt).toContain('isolated git worktrees')
  })
})

// ============================================================================
// 4. Dead code removal verification
// ============================================================================

describe('Dead code removal — buildPlanSystemPrompt', () => {
  it('buildPlanSystemPrompt is NOT exported from core', async () => {
    const exports = await import('../packages/core/src/prompt-templates')
    expect((exports as Record<string, unknown>).buildPlanSystemPrompt).toBeUndefined()
  })

  it('InputParallelizationContext is NOT a runtime export from core', async () => {
    const exports = await import('../packages/core/src/prompt-templates')
    // Type-only exports don't exist at runtime
    expect('InputParallelizationContext' in exports).toBe(false)
  })

  it('server re-export shim does NOT export buildPlanSystemPrompt', async () => {
    const exports = await import('../server/lib/prompt-templates')
    expect((exports as Record<string, unknown>).buildPlanSystemPrompt).toBeUndefined()
  })
})

// ============================================================================
// 5. Re-export shim completeness
// ============================================================================

describe('Re-export shim completeness (server/lib/prompt-templates)', () => {
  it('exports all active prompt functions', async () => {
    const exports = await import('../server/lib/prompt-templates')
    expect(typeof exports.buildInteractivePlanPrompt).toBe('function')
    expect(typeof exports.buildChatSystemPrompt).toBe('function')
    expect(typeof exports.buildTaskChatSystemPrompt).toBe('function')
    expect(typeof exports.buildTaskExecutionPrompt).toBe('function')
    expect(typeof exports.buildTitleGenerationPrompt).toBe('function')
    expect(typeof exports.buildRefinementPrompt).toBe('function')
    expect(typeof exports.buildLabelSuggestionPrompt).toBe('function')
    expect(typeof exports.buildSummaryPrompt).toBe('function')
    expect(typeof exports.buildCompactionPrompt).toBe('function')
    expect(typeof exports.sanitizeGitHubName).toBe('function')
    expect(typeof exports.sanitizeGitBranch).toBe('function')
  })

  it('exports PLAN_GRAPH_SCHEMA', async () => {
    const exports = await import('../server/lib/prompt-templates')
    expect(exports.PLAN_GRAPH_SCHEMA).toBeDefined()
    expect(exports.PLAN_GRAPH_SCHEMA.properties.nodes).toBeDefined()
  })

  it('re-exported functions are identical to core exports', async () => {
    const core = await import('../packages/core/src/prompt-templates')
    const shim = await import('../server/lib/prompt-templates')

    expect(shim.buildInteractivePlanPrompt).toBe(core.buildInteractivePlanPrompt)
    expect(shim.buildChatSystemPrompt).toBe(core.buildChatSystemPrompt)
    expect(shim.buildTaskChatSystemPrompt).toBe(core.buildTaskChatSystemPrompt)
    expect(shim.sanitizeGitHubName).toBe(core.sanitizeGitHubName)
  })
})

// ============================================================================
// 6. buildInteractivePlanPrompt — structural integrity
// ============================================================================

describe('buildInteractivePlanPrompt — structural integrity', () => {
  it('includes user goal in delimiters', () => {
    const prompt = buildInteractivePlanPrompt('Build a REST API')
    expect(prompt).toContain('<user_goal>')
    expect(prompt).toContain('Build a REST API')
    expect(prompt).toContain('</user_goal>')
  })

  it('includes vision doc when provided', () => {
    const prompt = buildInteractivePlanPrompt('test', { visionDoc: 'My vision doc content' })
    expect(prompt).toContain('<user_vision>')
    expect(prompt).toContain('My vision doc content')
    expect(prompt).toContain('</user_vision>')
  })

  it('does not inject repo context or git state (agents discover via tools)', () => {
    const prompt = buildInteractivePlanPrompt('test', { hasWorkingDirectory: true })
    expect(prompt).not.toContain('CLAUDE.md')
    expect(prompt).not.toContain('<user_content>')
    expect(prompt).not.toContain('Git Repository State')
  })

  it('includes skills summary when provided', () => {
    const prompt = buildInteractivePlanPrompt('test', { skillsSummary: 'kubectl, docker, helm' })
    expect(prompt).toContain('Agent Skills & Tools')
    expect(prompt).toContain('kubectl, docker, helm')
  })

  it('codebase approach when hasWorkingDirectory is true', () => {
    const prompt = buildInteractivePlanPrompt('test', { hasWorkingDirectory: true })
    expect(prompt).toContain('Quick survey of the codebase')
    expect(prompt).toContain('Deep-dive into relevant files')
  })

  it('non-codebase approach when hasWorkingDirectory is false', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('Use web search')
    expect(prompt).not.toContain('Quick survey of the codebase')
  })

  it('includes replan context when provided', () => {
    const prompt = buildInteractivePlanPrompt('test', {
      replanContext: {
        previousPlanSummary: 'Built v1 of the API',
        changeDescription: 'Need to add auth',
        lessons: [
          {
            taskTitle: 'Build API',
            taskDescription: 'REST endpoints',
            status: 'success',
            executionSummary: 'All endpoints working',
            followUps: ['Add rate limiting'],
          },
        ],
      },
    })
    expect(prompt).toContain('Previous Plan')
    expect(prompt).toContain('Built v1 of the API')
    expect(prompt).toContain('Need to add auth')
    expect(prompt).toContain('Build API')
    expect(prompt).toContain('Add rate limiting')
  })

  it('Node Rules section is present', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('## Node Rules')
  })

  it('Edge Rules section is present', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('## Edge Rules')
  })

  it('Important section tells AI not to write code', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('Do NOT write code')
    expect(prompt).toContain('Your only job is to plan')
  })

  it('includes JSON code fence example', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).toContain('```json')
    expect(prompt).toContain('"projectName"')
    expect(prompt).toContain('"nodes"')
    expect(prompt).toContain('"edges"')
  })
})

// ============================================================================
// 7. Other active prompt functions — smoke tests
// ============================================================================

describe('Active prompt functions — smoke tests', () => {
  it('buildChatSystemPrompt returns valid prompt', () => {
    const prompt = buildChatSystemPrompt()
    expect(prompt).toContain('project planning assistant')
    expect(prompt).toContain('Mutation Format')
  })

  it('buildChatSystemPrompt includes plan context when provided', () => {
    const nodes = [
      { id: 'n1', title: 'Task 1', description: 'Do something', status: 'planned', type: 'task' },
    ]
    const prompt = buildChatSystemPrompt(undefined, nodes)
    expect(prompt).toContain('Task 1')
    expect(prompt).toContain('Do something')
  })

  it('buildTaskChatSystemPrompt returns valid prompt', () => {
    const context: TaskChatContext = {
      taskTitle: 'Build API',
      taskDescription: 'Create REST endpoints',
    }
    const prompt = buildTaskChatSystemPrompt(context)
    expect(prompt).toContain('Build API')
    expect(prompt).toContain('Create REST endpoints')
  })

  it('buildTaskChatSystemPrompt includes skills injection', () => {
    const context: TaskChatContext = {
      taskTitle: 'Test',
      taskDescription: 'Test desc',
      skillsInjection: '<skill>kubectl commands</skill>',
    }
    const prompt = buildTaskChatSystemPrompt(context)
    expect(prompt).toContain('kubectl commands')
  })

  it('buildTaskExecutionPrompt returns valid prompt', () => {
    const context: TaskExecutionContext = {
      taskTitle: 'Add auth',
      taskDescription: 'Implement JWT authentication',
    }
    const prompt = buildTaskExecutionPrompt(context)
    expect(prompt).toContain('Add auth')
    expect(prompt).toContain('JWT authentication')
  })

  it('buildRefinementPrompt returns valid prompt', () => {
    const input: RefinementInput = {
      context: 'task',
      title: 'Build API',
      description: 'Create REST endpoints',
    }
    const prompt = buildRefinementPrompt(input)
    expect(prompt).toContain('Build API')
    expect(prompt).toContain('refinedTitle')
    expect(prompt).toContain('refinedDescription')
  })

  it('buildCompactionPrompt formats messages', () => {
    const prompt = buildCompactionPrompt([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ])
    expect(prompt).toContain('Human: Hello')
    expect(prompt).toContain('Assistant: Hi there')
    expect(prompt).toContain('Summarize')
  })

  it('buildSummaryPrompt returns valid prompt', () => {
    const prompt = buildSummaryPrompt({
      taskTitle: 'test',
      taskDescription: 'test desc',
      executionOutput: 'done',
      fileChanges: [{ path: 'src/index.ts', action: 'modified' }],
      status: 'success',
    })
    expect(prompt).toContain('test')
    expect(prompt).toContain('workCompleted')
  })

  it('buildTitleGenerationPrompt returns valid prompt', () => {
    const prompt = buildTitleGenerationPrompt('Build a weather app with React')
    expect(prompt).toContain('weather app')
    expect(prompt).toContain('Title')
  })

  it('buildLabelSuggestionPrompt returns valid prompt', () => {
    const prompt = buildLabelSuggestionPrompt('Add Docker deployment config')
    expect(prompt).toContain('Docker deployment')
    expect(prompt).toContain('labelIds')
  })
})

// ============================================================================
// 8. Sanitization — security-critical
// ============================================================================

describe('Sanitization functions', () => {
  it('sanitizeGitHubName removes script injection', () => {
    expect(sanitizeGitHubName('<script>alert(1)</script>')).toBe('scriptalert1script')
  })

  it('sanitizeGitHubName allows valid chars', () => {
    expect(sanitizeGitHubName('my-org.repo_123')).toBe('my-org.repo_123')
  })

  it('sanitizeGitHubName truncates at 100 chars', () => {
    const long = 'a'.repeat(200)
    expect(sanitizeGitHubName(long).length).toBe(100)
  })

  it('sanitizeGitBranch allows slashes for namespaced branches', () => {
    expect(sanitizeGitBranch('astro/7b19a9')).toBe('astro/7b19a9')
    expect(sanitizeGitBranch('feature/my-branch')).toBe('feature/my-branch')
  })

  it('sanitizeGitBranch removes shell injection', () => {
    expect(sanitizeGitBranch('main; rm -rf /')).toBe('mainrm-rf/')
  })

  it('sanitizeGitBranch truncates at 200 chars', () => {
    const long = 'a'.repeat(300)
    expect(sanitizeGitBranch(long).length).toBe(200)
  })

  it('sanitizeGitHubName returns empty on all-invalid input', () => {
    expect(sanitizeGitHubName('!!!@@@###')).toBe('')
  })

  it('sanitizeGitBranch returns empty on all-invalid input', () => {
    expect(sanitizeGitBranch('$$$%%%^^^')).toBe('')
  })
})

// ============================================================================
// 9. PLAN_GRAPH_SCHEMA structure
// ============================================================================

describe('PLAN_GRAPH_SCHEMA', () => {
  it('has required top-level fields', () => {
    expect(PLAN_GRAPH_SCHEMA.required).toContain('projectName')
    expect(PLAN_GRAPH_SCHEMA.required).toContain('nodes')
    expect(PLAN_GRAPH_SCHEMA.required).toContain('edges')
  })

  it('nodes have all required fields', () => {
    const required = PLAN_GRAPH_SCHEMA.properties.nodes.items.required
    expect(required).toContain('id')
    expect(required).toContain('type')
    expect(required).toContain('title')
    expect(required).toContain('description')
    expect(required).toContain('status')
    expect(required).toContain('dependencies')
    expect(required).toContain('verification')
    expect(required).toContain('position')
  })

  it('edges have required fields', () => {
    const required = PLAN_GRAPH_SCHEMA.properties.edges.items.required
    expect(required).toContain('id')
    expect(required).toContain('source')
    expect(required).toContain('target')
    expect(required).toContain('type')
  })

  it('node type enum includes all valid types', () => {
    const typeEnum = PLAN_GRAPH_SCHEMA.properties.nodes.items.properties.type.enum
    expect(typeEnum).toContain('milestone')
    expect(typeEnum).toContain('task')
    expect(typeEnum).toContain('branch')
    expect(typeEnum).toContain('decision')
  })

  it('node has acceptanceCriteria property', () => {
    const props = PLAN_GRAPH_SCHEMA.properties.nodes.items.properties
    expect(props.acceptanceCriteria).toBeDefined()
    expect(props.acceptanceCriteria.type).toBe('array')
  })

  it('node has milestoneId property marked as required for tasks', () => {
    const milestoneDesc = PLAN_GRAPH_SCHEMA.properties.nodes.items.properties.milestoneId.description
    expect(milestoneDesc).toContain('REQUIRED for tasks')
  })
})
