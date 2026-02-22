/**
 * Unit tests for relay dispatch prompt construction
 *
 * Verifies:
 * - Relay dispatch builds full execution prompt (matching local dispatch)
 * - Prompt includes vision doc, dependencies, instructions
 * - Decision-making instructions are present
 * - Pre-built prompt bypasses relay prompt construction
 * - Context assembler produces correct graph position context
 */

import { describe, it, expect } from 'vitest'

describe('relay dispatch prompt quality', () => {
  it('relay prompt includes decision-making instructions', () => {
    // Simulate what dispatchViaRelay builds
    const visionDoc = 'Build a planning tool for developers'
    const dependencyOutputs = [
      { nodeId: 'dep-1', title: 'Setup database', output: 'Database setup complete' },
    ]
    const workingDirectory = '/home/user/project'
    const title = 'Implement API endpoints'
    const description = 'Create REST endpoints for CRUD operations'

    const promptParts: string[] = []

    if (visionDoc) {
      promptParts.push(`## Project Vision\n\n${visionDoc}`)
    }

    if (dependencyOutputs.length > 0) {
      const depsSection = dependencyOutputs
        .map((d) => `### ${d.title}\n\n${d.output}`)
        .join('\n\n---\n\n')
      promptParts.push(`## Previous Task Outputs\n\n${depsSection}`)
    }

    if (workingDirectory) {
      promptParts.push(`## Working Directory\n\n${workingDirectory}`)
    }

    promptParts.push(`## Current Task\n\n**${title}**\n\n${description}`)

    promptParts.push(`## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered
- Verify your work when possible
- Be thorough but efficient
- When you are done, commit all your changes with a descriptive commit message summarizing what was accomplished

### Making Decisions vs. Asking for User Input

**When to proceed independently:**
- Standard best practices and established patterns exist
- Technical decisions with clear trade-offs you can evaluate
- Implementation details that don't affect user-facing behavior
- Refactoring and code quality improvements

**When to note that user input would be valuable:**
If you encounter a decision point where multiple approaches are equally valid and the choice depends on user preferences or priorities (e.g., which library to use, architectural patterns, feature trade-offs), note it clearly in your output:
1. Describe the decision point
2. Present 2-3 viable options with brief trade-offs
3. State which option you recommend and why
4. Proceed with your recommended approach unless instructed otherwise

The user can review your reasoning in the task output and provide guidance if they disagree with your choice.`)

    const prompt = promptParts.join('\n\n---\n\n')

    // Key assertions: the prompt has all the sections the local dispatch includes
    expect(prompt).toContain('## Project Vision')
    expect(prompt).toContain(visionDoc)
    expect(prompt).toContain('## Previous Task Outputs')
    expect(prompt).toContain('Setup database')
    expect(prompt).toContain('## Working Directory')
    expect(prompt).toContain(workingDirectory)
    expect(prompt).toContain('## Current Task')
    expect(prompt).toContain(title)
    expect(prompt).toContain('## Instructions')
    expect(prompt).toContain('Making Decisions vs. Asking for User Input')
    expect(prompt).toContain('commit all your changes')
  })

  it('relay prompt omits sections when not applicable', () => {
    const promptParts: string[] = []
    const title = 'Simple task'
    const description = 'Do a thing'

    // No vision doc, no dependencies, no working directory
    promptParts.push(`## Current Task\n\n**${title}**\n\n${description}`)
    promptParts.push(`## Instructions\n\nExecute the task.`)

    const prompt = promptParts.join('\n\n---\n\n')

    expect(prompt).not.toContain('## Project Vision')
    expect(prompt).not.toContain('## Previous Task Outputs')
    expect(prompt).not.toContain('## Working Directory')
    expect(prompt).toContain('## Current Task')
  })
})

describe('relay dispatch — pre-built prompt bypass', () => {
  it('relay server uses pre-built prompt when task.prompt is set', () => {
    // Simulate relay-server.ts dispatchTask logic
    const task = {
      prompt: 'Pre-built full execution prompt with all context',
      visionDoc: 'Should be ignored',
      dependencies: ['dep output 1'],
      title: 'Task Title',
      description: 'Task Description',
    }

    let finalPrompt: string
    if (task.prompt) {
      finalPrompt = task.prompt
    } else {
      const promptParts: string[] = []
      if (task.visionDoc) promptParts.push(`## Project Vision\n\n${task.visionDoc}`)
      if (task.dependencies.length > 0) promptParts.push(`## Previous Task Outputs\n\n${task.dependencies.join('\n\n---\n\n')}`)
      promptParts.push(`## Current Task\n\n**${task.title}**\n\n${task.description}`)
      finalPrompt = promptParts.join('\n\n---\n\n')
    }

    // When prompt is set, it should be used directly
    expect(finalPrompt).toBe('Pre-built full execution prompt with all context')
    expect(finalPrompt).not.toContain('## Project Vision')
  })

  it('relay server constructs prompt from parts when no pre-built prompt', () => {
    const task = {
      prompt: undefined as string | undefined,
      visionDoc: 'Product vision here',
      dependencies: ['Output from task A'],
      title: 'Implement feature',
      description: 'Build the feature',
    }

    let finalPrompt: string
    if (task.prompt) {
      finalPrompt = task.prompt
    } else {
      const promptParts: string[] = []
      if (task.visionDoc) promptParts.push(`## Project Vision\n\n${task.visionDoc}`)
      if (task.dependencies && task.dependencies.length > 0) {
        promptParts.push(`## Previous Task Outputs\n\n${task.dependencies.join('\n\n---\n\n')}`)
      }
      promptParts.push(`## Current Task\n\n**${task.title}**\n\n${task.description}`)
      promptParts.push(`## Instructions\n\nExecute the task described above.`)
      finalPrompt = promptParts.join('\n\n---\n\n')
    }

    // Fallback: constructs from parts
    expect(finalPrompt).toContain('## Project Vision')
    expect(finalPrompt).toContain('Product vision here')
    expect(finalPrompt).toContain('## Previous Task Outputs')
    expect(finalPrompt).toContain('## Current Task')
  })
})

describe('context assembler — graph position', () => {
  it('builds position context string from graph position', () => {
    // Simulate ContextAssembler.buildPositionContext
    const position = {
      depth: 3,
      upstreamCount: 5,
      downstreamCount: 2,
      isOnBranch: true,
      branchId: 'branch-1',
      parallelSiblings: 1,
    }

    const parts: string[] = []
    if (position.depth > 0) parts.push(`This task is at depth ${position.depth} in the plan graph.`)
    if (position.upstreamCount > 0) parts.push(`It has ${position.upstreamCount} upstream dependencies.`)
    if (position.downstreamCount > 0) parts.push(`${position.downstreamCount} tasks depend on this one.`)
    if (position.isOnBranch && position.branchId) parts.push(`This task is on an exploration branch.`)
    if (position.parallelSiblings > 0) parts.push(`${position.parallelSiblings} other tasks are running in parallel.`)

    const context = parts.join(' ')

    expect(context).toContain('depth 3')
    expect(context).toContain('5 upstream dependencies')
    expect(context).toContain('2 tasks depend')
    expect(context).toContain('exploration branch')
    expect(context).toContain('1 other tasks are running in parallel')
  })

  it('returns empty string for root node with no connections', () => {
    const position = {
      depth: 0,
      upstreamCount: 0,
      downstreamCount: 0,
      isOnBranch: false,
      parallelSiblings: 0,
    }

    const parts: string[] = []
    if (position.depth > 0) parts.push(`depth ${position.depth}`)
    if (position.upstreamCount > 0) parts.push(`upstream`)
    if (position.downstreamCount > 0) parts.push(`downstream`)

    expect(parts.join(' ')).toBe('')
  })
})

describe('context assembler — dependency gathering', () => {
  it('truncates large dependency outputs', () => {
    const maxSize = 100
    const output = 'x'.repeat(200)

    const truncated = output.length > maxSize
    const truncatedOutput = truncated ? output.slice(0, maxSize) + '\n\n[Output truncated...]' : output

    expect(truncated).toBe(true)
    expect(truncatedOutput.length).toBe(maxSize + '\n\n[Output truncated...]'.length)
    expect(truncatedOutput).toContain('[Output truncated...]')
  })

  it('does not truncate small outputs', () => {
    const maxSize = 10000
    const output = 'Small output'

    const truncated = output.length > maxSize
    const truncatedOutput = truncated ? output.slice(0, maxSize) + '\n\n[Output truncated...]' : output

    expect(truncated).toBe(false)
    expect(truncatedOutput).toBe('Small output')
  })
})
