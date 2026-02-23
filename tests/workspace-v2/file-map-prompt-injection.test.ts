/**
 * Unit tests for ContextAssembler.buildExecutionPrompt().
 *
 * Verifies that file map / data access / resource path sections are
 * correctly injected (or omitted) based on the AssembledContext fields.
 */
import { describe, it, expect } from 'vitest'
import { createContextAssembler } from '../../packages/core/src/dispatch/context-assembler.js'
import type { AssembledContext, GraphPosition } from '../../packages/core/src/dispatch/types.js'
import type { PlanNode } from '../../packages/core/src/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultGraphPosition: GraphPosition = {
  depth: 0,
  upstreamCount: 0,
  downstreamCount: 0,
  isOnBranch: false,
  parallelSiblings: 0,
}

function makeNode(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    id: 'n1',
    projectId: 'p1',
    type: 'task',
    title: 'Test Task',
    description: 'Do the thing',
    status: 'planned',
    parentId: null,
    dependencies: [],
    verification: 'auto',
    position: { x: 0, y: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    node: makeNode(),
    projectId: 'p1',
    dependencyOutputs: [],
    graphPosition: defaultGraphPosition,
    ...overrides,
  }
}

// ===========================================================================
// Tests
// ===========================================================================

describe('buildExecutionPrompt — file map / data access injection', () => {
  const assembler = createContextAssembler()

  it('includes ## Data Access section when originalProjectDirectory is set', () => {
    const ctx = makeContext({
      originalProjectDirectory: '/home/user/my-project',
    })
    const prompt = assembler.buildExecutionPrompt(ctx)

    expect(prompt).toContain('## Data Access')
    expect(prompt).toContain('/home/user/my-project')
    expect(prompt).toContain('git worktree')
    expect(prompt).toContain('absolute paths')
  })

  it('does NOT include ## Data Access when originalProjectDirectory is absent', () => {
    const ctx = makeContext() // no originalProjectDirectory
    const prompt = assembler.buildExecutionPrompt(ctx)

    expect(prompt).not.toContain('## Data Access')
  })

  it('includes ## Working Directory when workingDirectory is set', () => {
    const ctx = makeContext({
      workingDirectory: '/tmp/work',
    })
    const prompt = assembler.buildExecutionPrompt(ctx)

    expect(prompt).toContain('## Working Directory')
    expect(prompt).toContain('/tmp/work')
  })

  it('does NOT include ## Working Directory when workingDirectory is absent', () => {
    const ctx = makeContext()
    const prompt = assembler.buildExecutionPrompt(ctx)

    expect(prompt).not.toContain('## Working Directory')
  })

  it('includes ## Additional Resource Folders when resourcePaths is set', () => {
    const ctx = makeContext({
      resourcePaths: ['/data/datasets', '/shared/configs'],
    })
    const prompt = assembler.buildExecutionPrompt(ctx)

    expect(prompt).toContain('## Additional Resource Folders')
    expect(prompt).toContain('- /data/datasets')
    expect(prompt).toContain('- /shared/configs')
  })

  it('does NOT include ## Additional Resource Folders when resourcePaths is empty', () => {
    const ctx = makeContext({ resourcePaths: [] })
    const prompt = assembler.buildExecutionPrompt(ctx)

    expect(prompt).not.toContain('## Additional Resource Folders')
  })

  it('full context assembly: sections appear in correct order', () => {
    const ctx = makeContext({
      visionDoc: 'Build the best app ever.',
      dependencyOutputs: [
        {
          nodeId: 'dep1',
          title: 'Setup CI',
          output: 'CI is green.',
          truncated: false,
          status: 'completed',
        },
      ],
      graphPosition: {
        depth: 2,
        upstreamCount: 1,
        downstreamCount: 3,
        isOnBranch: false,
        parallelSiblings: 0,
      },
      workingDirectory: '/home/user/my-project/.astro/worktrees/task-1',
      originalProjectDirectory: '/home/user/my-project',
      resourcePaths: ['/shared/data'],
    })

    const prompt = assembler.buildExecutionPrompt(ctx)

    // Verify ordering: vision → task context → deps → working dir → data access → resources → current task → instructions
    const visionIdx = prompt.indexOf('## Project Vision')
    const taskContextIdx = prompt.indexOf('## Task Context')
    const depsIdx = prompt.indexOf('## Previous Task Outputs')
    const workingDirIdx = prompt.indexOf('## Working Directory')
    const dataAccessIdx = prompt.indexOf('## Data Access')
    const resourceIdx = prompt.indexOf('## Additional Resource Folders')
    const currentTaskIdx = prompt.indexOf('## Current Task')
    const instructionsIdx = prompt.indexOf('## Instructions')

    expect(visionIdx).toBeGreaterThanOrEqual(0)
    expect(taskContextIdx).toBeGreaterThan(visionIdx)
    expect(depsIdx).toBeGreaterThan(taskContextIdx)
    expect(workingDirIdx).toBeGreaterThan(depsIdx)
    expect(dataAccessIdx).toBeGreaterThan(workingDirIdx)
    expect(resourceIdx).toBeGreaterThan(dataAccessIdx)
    expect(currentTaskIdx).toBeGreaterThan(resourceIdx)
    expect(instructionsIdx).toBeGreaterThan(currentTaskIdx)

    // Verify content from each section
    expect(prompt).toContain('Build the best app ever.')
    expect(prompt).toContain('Setup CI')
    expect(prompt).toContain('CI is green.')
    expect(prompt).toContain('/home/user/my-project')
    expect(prompt).toContain('- /shared/data')
    expect(prompt).toContain('**Test Task**')
    expect(prompt).toContain('Do the thing')
  })

  it('includes vision doc when present', () => {
    const ctx = makeContext({ visionDoc: 'Ship fast, ship well.' })
    const prompt = assembler.buildExecutionPrompt(ctx)

    expect(prompt).toContain('## Project Vision')
    expect(prompt).toContain('Ship fast, ship well.')
  })

  it('omits vision doc when absent', () => {
    const ctx = makeContext()
    const prompt = assembler.buildExecutionPrompt(ctx)

    expect(prompt).not.toContain('## Project Vision')
  })
})
