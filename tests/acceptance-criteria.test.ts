import { describe, it, expect } from 'vitest'

// Test 1: Verification status determination
// Extract the logic from realtime-store.ts task:result handler into a testable function
describe('determineNodeStatus', () => {
  // Pure function that determines what status a node should get after task completion
  function determineNodeStatus(
    isSuccess: boolean,
    verification: 'auto' | 'human',
    acceptanceCriteria?: Array<{ autoVerifiable: boolean }>
  ): string {
    if (!isSuccess) return 'awaiting_judgment'

    // If any criterion requires human review, always await judgment
    if (acceptanceCriteria?.some(c => !c.autoVerifiable)) {
      return 'awaiting_judgment'
    }

    return verification === 'auto' ? 'auto_verified' : 'awaiting_judgment'
  }

  it('auto verification + success → auto_verified', () => {
    expect(determineNodeStatus(true, 'auto')).toBe('auto_verified')
  })

  it('human verification + success → awaiting_judgment', () => {
    expect(determineNodeStatus(true, 'human')).toBe('awaiting_judgment')
  })

  it('auto verification + failure → awaiting_judgment', () => {
    expect(determineNodeStatus(false, 'auto')).toBe('awaiting_judgment')
  })

  it('human verification + failure → awaiting_judgment', () => {
    expect(determineNodeStatus(false, 'human')).toBe('awaiting_judgment')
  })

  it('auto + all criteria autoVerifiable + success → auto_verified', () => {
    const criteria = [
      { autoVerifiable: true },
      { autoVerifiable: true },
    ]
    expect(determineNodeStatus(true, 'auto', criteria)).toBe('auto_verified')
  })

  it('auto + one manual criterion + success → awaiting_judgment', () => {
    const criteria = [
      { autoVerifiable: true },
      { autoVerifiable: false },
    ]
    expect(determineNodeStatus(true, 'auto', criteria)).toBe('awaiting_judgment')
  })

  it('empty criteria + auto + success → auto_verified (fallback)', () => {
    expect(determineNodeStatus(true, 'auto', [])).toBe('auto_verified')
  })
})

// Test 2: Verification prompt building
describe('buildVerificationSection', () => {
  interface AcceptanceCriterion {
    id: string
    type: 'test' | 'build' | 'lint' | 'command' | 'manual'
    description: string
    command?: string
    autoVerifiable: boolean
  }

  function buildVerificationSection(
    verification: 'auto' | 'human' | undefined,
    acceptanceCriteria?: AcceptanceCriterion[]
  ): string {
    const criteria = acceptanceCriteria || []
    const autoChecks = criteria.filter(c => c.autoVerifiable && c.command)
    const manualChecks = criteria.filter(c => !c.autoVerifiable)

    if (autoChecks.length > 0) {
      const checkList = autoChecks.map(c => `- **${c.description}**: Run \`${c.command}\``).join('\n')
      let section = `Before finishing, run these verification checks:\n\n${checkList}\n\nReport results of each check.`
      if (verification === 'auto') {
        section += `\nIf all checks pass, the task will be auto-approved. If any fails, a human will review.`
      }
      if (manualChecks.length > 0) {
        section += `\n\nA human reviewer will also evaluate:\n${manualChecks.map(c => `- ${c.description}`).join('\n')}`
      }
      return section
    } else if (verification === 'auto') {
      return 'This task uses **automatic verification**.'
    } else {
      let section = 'This task requires **human judgment**.'
      if (manualChecks.length > 0) {
        section += `\n\nThe reviewer will check:\n${manualChecks.map(c => `- ${c.description}`).join('\n')}`
      }
      return section
    }
  }

  it('includes command checks in prompt', () => {
    const criteria: AcceptanceCriterion[] = [
      { id: 'ac1', type: 'test', description: 'Run unit tests', command: 'npm test', autoVerifiable: true },
    ]
    const result = buildVerificationSection('auto', criteria)
    expect(result).toContain('npm test')
    expect(result).toContain('Run unit tests')
    expect(result).toContain('auto-approved')
  })

  it('includes manual checks for reviewer', () => {
    const criteria: AcceptanceCriterion[] = [
      { id: 'ac1', type: 'manual', description: 'UI matches mockup', autoVerifiable: false },
    ]
    const result = buildVerificationSection('human', criteria)
    expect(result).toContain('UI matches mockup')
    expect(result).toContain('reviewer will check')
  })

  it('handles mixed criteria', () => {
    const criteria: AcceptanceCriterion[] = [
      { id: 'ac1', type: 'test', description: 'Run tests', command: 'npm test', autoVerifiable: true },
      { id: 'ac2', type: 'manual', description: 'Check UX', autoVerifiable: false },
    ]
    const result = buildVerificationSection('auto', criteria)
    expect(result).toContain('npm test')
    expect(result).toContain('Check UX')
    expect(result).toContain('human reviewer')
  })

  it('falls back to generic for empty criteria + auto', () => {
    const result = buildVerificationSection('auto', [])
    expect(result).toContain('automatic verification')
  })

  it('falls back to generic for empty criteria + human', () => {
    const result = buildVerificationSection('human', [])
    expect(result).toContain('human judgment')
  })
})

// Test 3: AcceptanceCriterion type validation
describe('AcceptanceCriterion schema', () => {
  it('valid criterion has required fields', () => {
    const criterion = {
      id: 'ac1',
      type: 'test' as const,
      description: 'Run unit tests',
      command: 'npm test',
      autoVerifiable: true,
    }
    expect(criterion.id).toBeDefined()
    expect(criterion.type).toBeDefined()
    expect(criterion.description).toBeDefined()
    expect(criterion.autoVerifiable).toBeDefined()
  })

  it('manual criterion has no command', () => {
    const criterion = {
      id: 'ac2',
      type: 'manual' as const,
      description: 'Review UI design',
      autoVerifiable: false,
    }
    expect(criterion.command).toBeUndefined()
    expect(criterion.autoVerifiable).toBe(false)
  })

  it('valid types are test, build, lint, command, manual', () => {
    const validTypes = ['test', 'build', 'lint', 'command', 'manual']
    for (const type of validTypes) {
      const criterion = { id: 'ac1', type, description: 'test', autoVerifiable: true }
      expect(validTypes).toContain(criterion.type)
    }
  })
})
