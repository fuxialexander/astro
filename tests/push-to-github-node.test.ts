/**
 * Comprehensive tests for the "Push to GitHub" plan node feature.
 *
 * Covers:
 * 1. Prompt templates — GitHub integration section injection
 * 2. GitHubContextForPrompt interface edge cases
 * 3. Dispatch title detection regex
 * 4. Dispatch delivery mode override
 * 5. Dispatch prompt content (branch names, gh commands, retry instructions)
 * 6. Project-completion-hook guard
 * 7. Auto-wiring logic (plan-store addNode)
 * 8. Interaction with other prompt sections (vision, repo context, skills)
 */

import { describe, it, expect } from 'vitest'
import {
  buildInteractivePlanPrompt,
  sanitizeGitHubName,
  sanitizeGitBranch,
  type GitHubContextForPrompt,
} from '../packages/core/src/prompt-templates'

// ─── Shared regex (mirrors dispatch.ts and plan-store.ts) ───────────────────
const PUSH_TO_GITHUB_RE = /push\s+to\s+github|publish\s+to\s+github/i

// ─── 1. buildInteractivePlanPrompt — GitHub Integration section (detailed) ──

describe('buildInteractivePlanPrompt — GitHub integration (detailed)', () => {
  const ctx: GitHubContextForPrompt = {
    hasRepo: true,
    owner: 'acme',
    repo: 'widgets',
    baseBranch: 'develop',
  }

  it('injects the section when hasRepo + owner + repo are set', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).toContain('## GitHub Integration')
    expect(prompt).toContain('`acme/widgets`')
    expect(prompt).toContain('`develop` branch')
  })

  it('describes the node title, type, verification, estimate, and labels', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).toContain('"Push to GitHub"')
    expect(prompt).toContain('type: "task"')
    expect(prompt).toContain('verification: "auto"')
    expect(prompt).toContain('estimate: "XS"')
    expect(prompt).toContain('labelIds: ["l4"]')
  })

  it('includes acceptance criteria with gh pr checks command', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).toContain('ci-pass')
    expect(prompt).toContain('gh pr checks --required')
    expect(prompt).toContain('autoVerifiable: true')
  })

  it('mentions the repo name in the description text', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).toContain('acme/widgets')
    expect(prompt).toContain('merges the project branch into `develop`')
  })

  it('mentions retry cycles in the description', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).toContain('3 retry cycles')
  })

  it('states the node depends on ALL other task nodes', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).toContain('Depends on ALL other task nodes')
  })

  // ── Omission cases ────────────────────────────────────────────────────────

  it('omits section when githubContext is undefined', () => {
    const prompt = buildInteractivePlanPrompt('test')
    expect(prompt).not.toContain('## GitHub Integration')
    expect(prompt).not.toContain('Push to GitHub')
  })

  it('omits section when hasRepo is false', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: { hasRepo: false } })
    expect(prompt).not.toContain('## GitHub Integration')
  })

  it('omits section when owner is missing', () => {
    const prompt = buildInteractivePlanPrompt('test', {
      githubContext: { hasRepo: true, repo: 'widgets' },
    })
    expect(prompt).not.toContain('## GitHub Integration')
  })

  it('omits section when repo is missing', () => {
    const prompt = buildInteractivePlanPrompt('test', {
      githubContext: { hasRepo: true, owner: 'acme' },
    })
    expect(prompt).not.toContain('## GitHub Integration')
  })

  // ── Default base branch ───────────────────────────────────────────────────

  it('defaults to `main` when baseBranch is not set', () => {
    const noBase: GitHubContextForPrompt = { hasRepo: true, owner: 'acme', repo: 'widgets' }
    const prompt = buildInteractivePlanPrompt('test', { githubContext: noBase })
    expect(prompt).toContain('`main` branch')
    expect(prompt).toContain('into `main`')
  })

  // ── Ordering relative to other sections ───────────────────────────────────

  it('appears before ## Node Rules', () => {
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    const gh = prompt.indexOf('## GitHub Integration')
    const nr = prompt.indexOf('## Node Rules')
    expect(gh).toBeGreaterThan(-1)
    expect(nr).toBeGreaterThan(gh)
  })

  it('appears after skills section when both are present', () => {
    const prompt = buildInteractivePlanPrompt('test', { skillsSummary: 'skill list here', githubContext: ctx })
    const skills = prompt.indexOf('## Available Agent Skills')
    const gh = prompt.indexOf('## GitHub Integration')
    expect(skills).toBeGreaterThan(-1)
    expect(gh).toBeGreaterThan(skills)
  })

  // ── Coexistence with other prompt sections ────────────────────────────────

  it('coexists with vision doc, repo context, git state, and skills', () => {
    const prompt = buildInteractivePlanPrompt('test', {
      visionDoc: 'vision text',
      repoContext: { readmeMd: '# Readme' },
      gitState: { currentBranch: 'main', targetBranch: 'main', isDirty: false },
      skillsSummary: 'skill info',
      githubContext: ctx,
    })

    expect(prompt).toContain('## Project Vision Document')
    expect(prompt).toContain('## README.md')
    expect(prompt).toContain('## Git Repository State')
    expect(prompt).toContain('## Available Agent Skills')
    expect(prompt).toContain('## GitHub Integration')
    expect(prompt).toContain('## Node Rules')
  })
})

// ─── 2. buildInteractivePlanPrompt — GitHub Integration section ─────────────

describe('buildInteractivePlanPrompt — GitHub integration', () => {
  const ctx: GitHubContextForPrompt = {
    hasRepo: true,
    owner: 'org',
    repo: 'project',
    baseBranch: 'release',
  }

  it('injects section when githubContext has a repo', () => {
    const prompt = buildInteractivePlanPrompt('do something', { githubContext: ctx })
    expect(prompt).toContain('## GitHub Integration')
    expect(prompt).toContain('`org/project`')
    expect(prompt).toContain('`release` branch')
    expect(prompt).toContain('"Push to GitHub"')
  })

  it('includes repo name and target branch in description', () => {
    const prompt = buildInteractivePlanPrompt('do something', { githubContext: ctx })
    expect(prompt).toContain('org/project')
    expect(prompt).toContain('into `release`')
  })

  it('omits section when githubContext is absent', () => {
    const prompt = buildInteractivePlanPrompt('do something')
    expect(prompt).not.toContain('## GitHub Integration')
  })

  it('omits section when options is empty', () => {
    const prompt = buildInteractivePlanPrompt('do something', {})
    expect(prompt).not.toContain('## GitHub Integration')
  })

  it('omits section when hasRepo is false', () => {
    const prompt = buildInteractivePlanPrompt('do something', {
      githubContext: { hasRepo: false },
    })
    expect(prompt).not.toContain('## GitHub Integration')
  })

  it('defaults to main when baseBranch is absent', () => {
    const prompt = buildInteractivePlanPrompt('do something', {
      githubContext: { hasRepo: true, owner: 'x', repo: 'y' },
    })
    expect(prompt).toContain('`main` branch')
  })

  it('appears before ## Node Rules', () => {
    const prompt = buildInteractivePlanPrompt('do something', { githubContext: ctx })
    const gh = prompt.indexOf('## GitHub Integration')
    const nr = prompt.indexOf('## Node Rules')
    expect(gh).toBeGreaterThan(-1)
    expect(nr).toBeGreaterThan(gh)
  })

  it('coexists with vision doc and skills', () => {
    const prompt = buildInteractivePlanPrompt('do something', {
      visionDoc: 'my vision',
      skillsSummary: 'my skills',
      githubContext: ctx,
    })
    expect(prompt).toContain('## Project Vision Document')
    expect(prompt).toContain('## Available Agent Skills')
    expect(prompt).toContain('## GitHub Integration')
  })
})

// ─── 3. Dispatch title detection regex ──────────────────────────────────────

describe('Push to GitHub — title detection regex', () => {
  // Positive matches
  it.each([
    'Push to GitHub',
    'push to github',
    'PUSH TO GITHUB',
    'Push To GitHub',
    'Push  to  GitHub',       // extra spaces
    'Publish to GitHub',
    'publish to github',
    'PUBLISH TO GITHUB',
  ])('matches: "%s"', (title) => {
    expect(PUSH_TO_GITHUB_RE.test(title)).toBe(true)
  })

  // Negative matches — should NOT trigger special handling
  it.each([
    'Implement API endpoints',
    'Setup database',
    'Push changes to remote',
    'GitHub integration setup',
    'Deploy to production',
    'Create GitHub Actions workflow',
    'Push to GitLab',
    'Push to',
    '',
    'Submit PR',
  ])('does not match: "%s"', (title) => {
    expect(PUSH_TO_GITHUB_RE.test(title)).toBe(false)
  })
})

// ─── 4. Dispatch delivery mode override ─────────────────────────────────────

describe('Push to GitHub — dispatch delivery mode', () => {
  it('overrides to "push" when isPushToGithub is true', () => {
    // Simulate the logic from dispatch.ts
    const isPushToGithub = true
    const deliveryMode = 'pr'
    const effective = isPushToGithub ? 'push' : (deliveryMode ?? 'pr')
    expect(effective).toBe('push')
  })

  it('preserves original deliveryMode when isPushToGithub is false', () => {
    const isPushToGithub = false
    const deliveryMode = 'branch'
    const effective = isPushToGithub ? 'push' : (deliveryMode ?? 'pr')
    expect(effective).toBe('branch')
  })

  it('falls back to "pr" when deliveryMode is undefined and not Push node', () => {
    const isPushToGithub = false
    const deliveryMode = undefined
    const effective = isPushToGithub ? 'push' : (deliveryMode ?? 'pr')
    expect(effective).toBe('pr')
  })
})

// ─── 5. Dispatch prompt content ─────────────────────────────────────────────

describe('Push to GitHub — dispatch prompt assembly', () => {
  // Simulate the prompt parts that dispatch.ts builds for a Push node
  interface MockDepOutput {
    nodeId: string
    title: string
    output: string
    prUrl?: string
    prNumber?: number
    branchName?: string
  }

  function buildPushPrompt(opts: {
    shortProjectId: string
    baseBranch: string
    ghOwner: string
    ghRepo: string
    dependencyOutputs?: MockDepOutput[]
  }) {
    const projectBranchName = `astro/${opts.shortProjectId}`
    const targetBranch = opts.baseBranch
    const dependencyOutputs = opts.dependencyOutputs || []

    // Build sub-PR listing (mirrors dispatch.ts logic)
    const subPrs = dependencyOutputs
      .filter(d => d.prUrl && d.prNumber)
      .map(d => `- **${d.title}**: [PR #${d.prNumber}](${d.prUrl})`)
    const subPrSection = subPrs.length > 0
      ? `\n### Sub-PRs merged into \`${projectBranchName}\`\n\nThese task PRs have already been merged into the project branch:\n${subPrs.join('\n')}\n\nUse these PR links in the final PR body to give reviewers context on what changed.`
      : `\n### Sub-PRs\n\nNo per-task PR links found in dependency outputs. You can discover them by running:\n\`\`\`bash\ngh pr list --base '${projectBranchName}' --state merged --json number,title,url\n\`\`\`\nInclude any found PRs in the final PR body.`

    return `## Push to GitHub — Open Final Project PR

You are opening the FINAL pull request for this project on \`${opts.ghOwner}/${opts.ghRepo}\`.
This merges **all** completed task work from the project branch \`${projectBranchName}\` into \`${targetBranch}\`.

### Branch model

- **Project branch:** \`${projectBranchName}\`
- **Target branch:** \`${targetBranch}\`
${subPrSection}

### Step-by-step

1. **Discover sub-PRs** (if not all listed above)
   \`\`\`bash
   gh pr list --base '${projectBranchName}' --state merged --json number,title,url
   \`\`\`

2. **Check for an existing final PR**
   \`\`\`bash
   gh pr list --head '${projectBranchName}' --base '${targetBranch}' --json number,state
   \`\`\`

3. **Create the PR** (when no open PR exists)
   - Head: \`${projectBranchName}\`
   - Base: \`${targetBranch}\`

4. **Wait for CI checks**
   \`\`\`bash
   gh pr checks <PR_NUMBER> --watch
   \`\`\`

5. **Fix failures & retry** (up to 3 cycles)
   - \`gh api repos/${opts.ghOwner}/${opts.ghRepo}/pulls/<PR_NUMBER>/reviews\`
   - Push fixes: \`git push origin HEAD:refs/heads/${projectBranchName}\``
  }

  it('includes the correct project branch name', () => {
    const prompt = buildPushPrompt({ shortProjectId: 'abc123', baseBranch: 'main', ghOwner: 'acme', ghRepo: 'app' })
    expect(prompt).toContain('astro/abc123')
  })

  it('targets the configured base branch', () => {
    const prompt = buildPushPrompt({ shortProjectId: 'x', baseBranch: 'develop', ghOwner: 'o', ghRepo: 'r' })
    expect(prompt).toContain("--base 'develop'")
    expect(prompt).toContain('into `develop`')
  })

  it('references the correct GitHub repo for API calls', () => {
    const prompt = buildPushPrompt({ shortProjectId: 'x', baseBranch: 'main', ghOwner: 'my-org', ghRepo: 'my-repo' })
    expect(prompt).toContain('repos/my-org/my-repo/pulls/')
    expect(prompt).toContain('`my-org/my-repo`')
  })

  it('includes gh pr list command to check for existing PRs', () => {
    const prompt = buildPushPrompt({ shortProjectId: 'x', baseBranch: 'main', ghOwner: 'o', ghRepo: 'r' })
    expect(prompt).toContain('gh pr list --head')
  })

  it('includes gh pr checks --watch command', () => {
    const prompt = buildPushPrompt({ shortProjectId: 'x', baseBranch: 'main', ghOwner: 'o', ghRepo: 'r' })
    expect(prompt).toContain('gh pr checks <PR_NUMBER> --watch')
  })

  it('mentions up to 3 retry cycles', () => {
    const prompt = buildPushPrompt({ shortProjectId: 'x', baseBranch: 'main', ghOwner: 'o', ghRepo: 'r' })
    expect(prompt).toContain('3 cycles')
  })

  it('instructs to push fixes to the project branch via explicit refspec', () => {
    const prompt = buildPushPrompt({ shortProjectId: 'proj1', baseBranch: 'main', ghOwner: 'o', ghRepo: 'r' })
    expect(prompt).toContain('git push origin HEAD:refs/heads/astro/proj1')
  })

  it('includes branch model section explaining project vs target branch', () => {
    const prompt = buildPushPrompt({ shortProjectId: 'abc', baseBranch: 'main', ghOwner: 'o', ghRepo: 'r' })
    expect(prompt).toContain('### Branch model')
    expect(prompt).toContain('**Project branch:** `astro/abc`')
    expect(prompt).toContain('**Target branch:** `main`')
  })

  it('lists sub-PRs when dependency outputs have PR info', () => {
    const prompt = buildPushPrompt({
      shortProjectId: 'abc',
      baseBranch: 'main',
      ghOwner: 'acme',
      ghRepo: 'app',
      dependencyOutputs: [
        { nodeId: 'n1', title: 'Build API', output: 'done', prUrl: 'https://github.com/acme/app/pull/10', prNumber: 10 },
        { nodeId: 'n2', title: 'Add tests', output: 'done', prUrl: 'https://github.com/acme/app/pull/11', prNumber: 11 },
      ],
    })
    expect(prompt).toContain('### Sub-PRs merged into `astro/abc`')
    expect(prompt).toContain('- **Build API**: [PR #10](https://github.com/acme/app/pull/10)')
    expect(prompt).toContain('- **Add tests**: [PR #11](https://github.com/acme/app/pull/11)')
  })

  it('shows fallback discovery command when no sub-PRs in dependency outputs', () => {
    const prompt = buildPushPrompt({
      shortProjectId: 'abc',
      baseBranch: 'main',
      ghOwner: 'o',
      ghRepo: 'r',
      dependencyOutputs: [
        { nodeId: 'n1', title: 'Task 1', output: 'done' },
      ],
    })
    expect(prompt).toContain('### Sub-PRs')
    expect(prompt).toContain("gh pr list --base 'astro/abc' --state merged")
  })

  it('includes discover sub-PRs step in instructions', () => {
    const prompt = buildPushPrompt({ shortProjectId: 'abc', baseBranch: 'main', ghOwner: 'o', ghRepo: 'r' })
    expect(prompt).toContain('**Discover sub-PRs**')
    expect(prompt).toContain("gh pr list --base 'astro/abc' --state merged --json number,title,url")
  })

  it('skips deps without prUrl in sub-PR listing', () => {
    const prompt = buildPushPrompt({
      shortProjectId: 'abc',
      baseBranch: 'main',
      ghOwner: 'o',
      ghRepo: 'r',
      dependencyOutputs: [
        { nodeId: 'n1', title: 'Has PR', output: 'done', prUrl: 'https://github.com/o/r/pull/5', prNumber: 5 },
        { nodeId: 'n2', title: 'No PR', output: 'done' },
      ],
    })
    expect(prompt).toContain('### Sub-PRs merged into')
    expect(prompt).toContain('**Has PR**: [PR #5]')
    expect(prompt).not.toContain('**No PR**:')
  })
})

// ─── 6. Project-completion-hook guard ───────────────────────────────────────

describe('project-completion-hook — Push to GitHub guard', () => {
  interface MockNode {
    id: string
    title: string
    type: string
    status: string
    deletedAt?: Date | null
  }

  function shouldSkipHook(nodes: MockNode[]): boolean {
    const pushNode = nodes.find(n =>
      n.type === 'task' && PUSH_TO_GITHUB_RE.test(n.title)
    )
    return !!pushNode
  }

  it('skips when a "Push to GitHub" task exists (completed)', () => {
    expect(shouldSkipHook([
      { id: 'n1', title: 'Build API', type: 'task', status: 'completed' },
      { id: 'n2', title: 'Push to GitHub', type: 'task', status: 'completed' },
    ])).toBe(true)
  })

  it('skips when a "Push to GitHub" task exists (still planned)', () => {
    expect(shouldSkipHook([
      { id: 'n1', title: 'Build API', type: 'task', status: 'completed' },
      { id: 'n2', title: 'Push to GitHub', type: 'task', status: 'planned' },
    ])).toBe(true)
  })

  it('skips for "Publish to GitHub" variant', () => {
    expect(shouldSkipHook([
      { id: 'n1', title: 'Work', type: 'task', status: 'completed' },
      { id: 'n2', title: 'Publish to GitHub', type: 'task', status: 'planned' },
    ])).toBe(true)
  })

  it('does NOT skip when no Push node exists', () => {
    expect(shouldSkipHook([
      { id: 'n1', title: 'Build API', type: 'task', status: 'completed' },
      { id: 'n2', title: 'Write tests', type: 'task', status: 'completed' },
    ])).toBe(false)
  })

  it('does NOT skip when "Push to GitHub" is a milestone (not task)', () => {
    expect(shouldSkipHook([
      { id: 'n1', title: 'Work', type: 'task', status: 'completed' },
      { id: 'n2', title: 'Push to GitHub', type: 'milestone', status: 'completed' },
    ])).toBe(false)
  })

  it('does NOT skip for unrelated titles containing "github"', () => {
    expect(shouldSkipHook([
      { id: 'n1', title: 'Setup GitHub Actions', type: 'task', status: 'completed' },
    ])).toBe(false)
  })

  it('handles empty node list', () => {
    expect(shouldSkipHook([])).toBe(false)
  })
})

// ─── 7. Auto-wiring logic (plan-store addNode) ─────────────────────────────

describe('Push to GitHub — auto-wiring on addNode', () => {
  interface MockPlanNode {
    id: string
    title: string
    type: string
    deletedAt?: Date | null
    dependencies?: string[]
  }

  interface MockEdge {
    id: string
    source: string
    target: string
    type: string
  }

  /**
   * Pure-function version of the auto-wiring logic from plan-store.ts addNode.
   * Returns the edge to add (if any) and updated Push node dependencies.
   */
  function computeAutoWire(
    newNode: MockPlanNode,
    existingNodes: MockPlanNode[],
    existingEdges: MockEdge[],
  ): { shouldWire: boolean; pushNodeId?: string; newEdge?: MockEdge; updatedDeps?: string[] } {
    if (newNode.type !== 'task' || PUSH_TO_GITHUB_RE.test(newNode.title)) {
      return { shouldWire: false }
    }
    const pushNode = existingNodes.find(
      (n) => n.type === 'task' && PUSH_TO_GITHUB_RE.test(n.title) && !n.deletedAt
    )
    if (!pushNode) return { shouldWire: false }
    const edgeExists = existingEdges.some(
      (e) => e.source === newNode.id && e.target === pushNode.id
    )
    if (edgeExists) return { shouldWire: false }
    return {
      shouldWire: true,
      pushNodeId: pushNode.id,
      newEdge: { id: 'auto', source: newNode.id, target: pushNode.id, type: 'dependency' },
      updatedDeps: [...(pushNode.dependencies ?? []), newNode.id],
    }
  }

  // ── Positive cases ──────────────────────────────────────────────────────

  it('wires a new task → Push node', () => {
    const push: MockPlanNode = { id: 'push', title: 'Push to GitHub', type: 'task', dependencies: ['n1'] }
    const result = computeAutoWire(
      { id: 'n2', title: 'Add tests', type: 'task' },
      [push],
      [],
    )
    expect(result.shouldWire).toBe(true)
    expect(result.pushNodeId).toBe('push')
    expect(result.newEdge?.source).toBe('n2')
    expect(result.newEdge?.target).toBe('push')
    expect(result.updatedDeps).toEqual(['n1', 'n2'])
  })

  it('wires even when Push node has zero existing dependencies', () => {
    const push: MockPlanNode = { id: 'push', title: 'Push to GitHub', type: 'task' }
    const result = computeAutoWire(
      { id: 'n1', title: 'Setup DB', type: 'task' },
      [push],
      [],
    )
    expect(result.shouldWire).toBe(true)
    expect(result.updatedDeps).toEqual(['n1'])
  })

  it('works with "Publish to GitHub" variant', () => {
    const push: MockPlanNode = { id: 'pub', title: 'Publish to GitHub', type: 'task' }
    const result = computeAutoWire(
      { id: 'n1', title: 'Fix bug', type: 'task' },
      [push],
      [],
    )
    expect(result.shouldWire).toBe(true)
    expect(result.pushNodeId).toBe('pub')
  })

  // ── Skip cases ────────────────────────────────────────────────────────

  it('skips when the new node IS the Push node itself', () => {
    const result = computeAutoWire(
      { id: 'push', title: 'Push to GitHub', type: 'task' },
      [],
      [],
    )
    expect(result.shouldWire).toBe(false)
  })

  it('skips when the new node is a milestone', () => {
    const push: MockPlanNode = { id: 'push', title: 'Push to GitHub', type: 'task' }
    const result = computeAutoWire(
      { id: 'm1', title: 'MVP Complete', type: 'milestone' },
      [push],
      [],
    )
    expect(result.shouldWire).toBe(false)
  })

  it('skips when the new node is a decision', () => {
    const push: MockPlanNode = { id: 'push', title: 'Push to GitHub', type: 'task' }
    const result = computeAutoWire(
      { id: 'd1', title: 'Choose framework', type: 'decision' },
      [push],
      [],
    )
    expect(result.shouldWire).toBe(false)
  })

  it('skips when no Push node exists', () => {
    const result = computeAutoWire(
      { id: 'n1', title: 'Add tests', type: 'task' },
      [{ id: 'n0', title: 'Setup', type: 'task' }],
      [],
    )
    expect(result.shouldWire).toBe(false)
  })

  it('skips when the Push node is soft-deleted', () => {
    const push: MockPlanNode = {
      id: 'push', title: 'Push to GitHub', type: 'task', deletedAt: new Date(),
    }
    const result = computeAutoWire(
      { id: 'n1', title: 'Work', type: 'task' },
      [push],
      [],
    )
    expect(result.shouldWire).toBe(false)
  })

  it('skips when edge already exists (no duplicates)', () => {
    const push: MockPlanNode = { id: 'push', title: 'Push to GitHub', type: 'task' }
    const existingEdge: MockEdge = { id: 'e1', source: 'n2', target: 'push', type: 'dependency' }
    const result = computeAutoWire(
      { id: 'n2', title: 'Add tests', type: 'task' },
      [push],
      [existingEdge],
    )
    expect(result.shouldWire).toBe(false)
  })

  // ── Multiple nodes scenario ───────────────────────────────────────────

  it('wires correctly when plan already has multiple tasks', () => {
    const push: MockPlanNode = {
      id: 'push', title: 'Push to GitHub', type: 'task',
      dependencies: ['n1', 'n2'],
    }
    const existingEdges: MockEdge[] = [
      { id: 'e1', source: 'n1', target: 'push', type: 'dependency' },
      { id: 'e2', source: 'n2', target: 'push', type: 'dependency' },
    ]
    const result = computeAutoWire(
      { id: 'n3', title: 'New task', type: 'task' },
      [
        { id: 'n1', title: 'Task 1', type: 'task' },
        { id: 'n2', title: 'Task 2', type: 'task' },
        push,
      ],
      existingEdges,
    )
    expect(result.shouldWire).toBe(true)
    expect(result.updatedDeps).toEqual(['n1', 'n2', 'n3'])
  })

  it('returns correct edge direction (source=new, target=push)', () => {
    const push: MockPlanNode = { id: 'push', title: 'Push to GitHub', type: 'task' }
    const result = computeAutoWire(
      { id: 'new-task', title: 'Feature X', type: 'task' },
      [push],
      [],
    )
    expect(result.newEdge?.source).toBe('new-task')
    expect(result.newEdge?.target).toBe('push')
    expect(result.newEdge?.type).toBe('dependency')
  })
})

// ─── 8. GitHubContextForPrompt construction from DB data ────────────────────

describe('GitHubContextForPrompt — construction logic', () => {
  // Simulates the logic in agent.ts and dispatch.ts that builds the context

  function buildGitHubContext(dbProject: {
    githubOwner?: string | null
    githubRepo?: string | null
    source?: { baseBranch?: string } | null
  }): GitHubContextForPrompt | undefined {
    if (dbProject.githubOwner?.trim() && dbProject.githubRepo?.trim()) {
      return {
        hasRepo: true,
        owner: dbProject.githubOwner.trim(),
        repo: dbProject.githubRepo.trim(),
        baseBranch: dbProject.source?.baseBranch?.trim() || 'main',
      }
    }
    return undefined
  }

  it('returns context when both githubOwner and githubRepo are set', () => {
    const ctx = buildGitHubContext({
      githubOwner: 'acme', githubRepo: 'app', source: { baseBranch: 'develop' },
    })
    expect(ctx).toEqual({
      hasRepo: true,
      owner: 'acme',
      repo: 'app',
      baseBranch: 'develop',
    })
  })

  it('defaults baseBranch to main when source is null', () => {
    const ctx = buildGitHubContext({ githubOwner: 'o', githubRepo: 'r', source: null })
    expect(ctx?.baseBranch).toBe('main')
  })

  it('defaults baseBranch to main when source.baseBranch is empty', () => {
    const ctx = buildGitHubContext({ githubOwner: 'o', githubRepo: 'r', source: { baseBranch: '' } })
    expect(ctx?.baseBranch).toBe('main')
  })

  it('returns undefined when githubOwner is null', () => {
    expect(buildGitHubContext({ githubOwner: null, githubRepo: 'app' })).toBeUndefined()
  })

  it('returns undefined when githubRepo is null', () => {
    expect(buildGitHubContext({ githubOwner: 'acme', githubRepo: null })).toBeUndefined()
  })

  it('returns undefined when both are null', () => {
    expect(buildGitHubContext({ githubOwner: null, githubRepo: null })).toBeUndefined()
  })

  it('returns undefined when both are undefined', () => {
    expect(buildGitHubContext({})).toBeUndefined()
  })

  it('returns undefined when githubOwner is whitespace-only', () => {
    expect(buildGitHubContext({ githubOwner: '  ', githubRepo: 'app' })).toBeUndefined()
  })

  it('returns undefined when githubRepo is whitespace-only', () => {
    expect(buildGitHubContext({ githubOwner: 'acme', githubRepo: '  ' })).toBeUndefined()
  })

  it('trims whitespace from owner and repo', () => {
    const ctx = buildGitHubContext({ githubOwner: ' acme ', githubRepo: ' app ', source: { baseBranch: ' develop ' } })
    expect(ctx).toEqual({ hasRepo: true, owner: 'acme', repo: 'app', baseBranch: 'develop' })
  })
})

// ─── 9. Whitelist sanitization functions ─────────────────────────────────────

describe('sanitizeGitHubName', () => {
  it('allows valid owner/repo characters', () => {
    expect(sanitizeGitHubName('acme-corp')).toBe('acme-corp')
    expect(sanitizeGitHubName('my_repo.js')).toBe('my_repo.js')
    expect(sanitizeGitHubName('User123')).toBe('User123')
  })

  it('strips shell metacharacters', () => {
    expect(sanitizeGitHubName('widgets; rm -rf /')).toBe('widgetsrm-rf')
    expect(sanitizeGitHubName('repo$(whoami)')).toBe('repowhoami')
    expect(sanitizeGitHubName('repo | cat /etc/passwd')).toBe('repocatetcpasswd')
  })

  it('strips backticks and quotes', () => {
    expect(sanitizeGitHubName('ac`me')).toBe('acme')
    expect(sanitizeGitHubName("ac'me")).toBe('acme')
    expect(sanitizeGitHubName('ac"me')).toBe('acme')
  })

  it('strips control characters', () => {
    expect(sanitizeGitHubName('o\x00wner')).toBe('owner')
    expect(sanitizeGitHubName('r\x1fepo')).toBe('repo')
  })

  it('truncates to 100 chars', () => {
    const long = 'a'.repeat(200)
    expect(sanitizeGitHubName(long)).toBe('a'.repeat(100))
  })

  it('returns empty string for completely invalid input', () => {
    expect(sanitizeGitHubName('; $() | &')).toBe('')
  })
})

describe('sanitizeGitBranch', () => {
  it('allows slashes for namespaced branches', () => {
    expect(sanitizeGitBranch('feature/my-branch')).toBe('feature/my-branch')
    expect(sanitizeGitBranch('release/v1.0')).toBe('release/v1.0')
  })

  it('strips shell metacharacters', () => {
    expect(sanitizeGitBranch('main; rm -rf /')).toBe('mainrm-rf/')
  })

  it('truncates to 200 chars', () => {
    const long = 'a'.repeat(300)
    expect(sanitizeGitBranch(long)).toBe('a'.repeat(200))
  })
})

describe('Prompt sanitization — integration with buildInteractivePlanPrompt', () => {
  it('strips shell injection from owner/repo in system prompt', () => {
    const ctx: GitHubContextForPrompt = { hasRepo: true, owner: 'acme; rm -rf /', repo: 'app$(whoami)', baseBranch: 'main' }
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).not.toContain('; rm')
    expect(prompt).not.toContain('$(whoami)')
    expect(prompt).toContain('acmerm-rf/appwhoami')
  })

  it('strips newlines from baseBranch', () => {
    const ctx: GitHubContextForPrompt = { hasRepo: true, owner: 'o', repo: 'r', baseBranch: 'ma\nin' }
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    expect(prompt).not.toContain('ma\nin')
    expect(prompt).toContain('main')
  })

  it('skips GitHub section but returns full prompt when owner sanitizes to empty', () => {
    const ctx: GitHubContextForPrompt = { hasRepo: true, owner: '; $()', repo: 'app', baseBranch: 'main' }
    const prompt = buildInteractivePlanPrompt('test', { githubContext: ctx })
    // Should skip the GitHub section but NOT return empty
    expect(prompt).not.toContain('## GitHub Integration')
    expect(prompt.length).toBeGreaterThan(100) // rest of prompt still present
    expect(prompt).toContain('## Node Rules') // core section still present
  })
})

// ─── 10. Project-completion-hook — pruned Push node ─────────────────────────

describe('project-completion-hook — pruned Push node', () => {
  interface MockNode {
    id: string
    title: string
    type: string
    status: string
    deletedAt?: Date | null
  }

  function shouldSkipHook(nodes: MockNode[]): boolean {
    const pushNode = nodes.find(n =>
      n.type === 'task' && !n.deletedAt && n.status !== 'pruned' &&
      PUSH_TO_GITHUB_RE.test(n.title)
    )
    return !!pushNode
  }

  it('does NOT skip when Push node is pruned (allows fallback PR)', () => {
    expect(shouldSkipHook([
      { id: 'n1', title: 'Build API', type: 'task', status: 'completed' },
      { id: 'n2', title: 'Push to GitHub', type: 'task', status: 'pruned' },
    ])).toBe(false)
  })

  it('still skips when Push node is completed (not pruned)', () => {
    expect(shouldSkipHook([
      { id: 'n1', title: 'Build API', type: 'task', status: 'completed' },
      { id: 'n2', title: 'Push to GitHub', type: 'task', status: 'completed' },
    ])).toBe(true)
  })

  it('still skips when Push node is planned (not yet executed)', () => {
    expect(shouldSkipHook([
      { id: 'n1', title: 'Build API', type: 'task', status: 'completed' },
      { id: 'n2', title: 'Push to GitHub', type: 'task', status: 'planned' },
    ])).toBe(true)
  })

  it('does NOT skip when Push node is both pruned and deleted', () => {
    expect(shouldSkipHook([
      { id: 'n1', title: 'Build API', type: 'task', status: 'completed' },
      { id: 'n2', title: 'Push to GitHub', type: 'task', status: 'pruned', deletedAt: new Date() },
    ])).toBe(false)
  })
})
