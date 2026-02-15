/**
 * Procedure Executor
 *
 * Handles sequential subroutine execution with validation loops and approval gates.
 * Pattern from Cyrus edge-worker/src/ProcedureRunner.ts
 */

import type { PlanNode } from '../../../src/types/index.js'
import type { TaskResult } from '../providers/types.js'
import type {
  SubroutineDefinition,
  ProcedureState,
  ValidationLoopMetadata,
} from './procedure-types.js'
import { errorMessage } from '../error-utils.js'
import { execSync } from 'child_process'

/**
 * Approval callback signature
 */
export type ApprovalCallback = (
  node: PlanNode,
  subroutine: SubroutineDefinition
) => Promise<boolean>

/**
 * Interpolate variables in prompt template
 * Supports {{task.field}} syntax
 */
export function interpolatePrompt(
  template: string,
  node: PlanNode,
  state: ProcedureState
): string {
  let prompt = template

  // Replace {{task.description}}
  prompt = prompt.replace(/\{\{task\.description\}\}/g, node.description || node.title)

  // Replace {{task.title}}
  prompt = prompt.replace(/\{\{task\.title\}\}/g, node.title)

  // Replace {{task.id}}
  prompt = prompt.replace(/\{\{task\.id\}\}/g, node.id)

  // Add previous subroutine results if available
  if (state.subroutineHistory.length > 0) {
    const previousResults = state.subroutineHistory
      .map((h) => `## ${h.subroutine}\n${h.result || '(no result)'}`)
      .join('\n\n')

    prompt = prompt.replace(
      /\{\{previous\.results\}\}/g,
      previousResults
    )
  }

  return prompt
}

/**
 * Run validation command and parse result
 * Returns true if validation passed, false otherwise
 */
export function runValidationCommand(command: string, workingDirectory?: string): {
  pass: boolean
  reason: string
  exitCode: number
} {
  try {
    console.log(`[procedure] Running validation: ${command}`)

    execSync(command, {
      cwd: workingDirectory,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5 * 60 * 1000, // 5 minute timeout
    })

    return {
      pass: true,
      reason: 'Validation command succeeded',
      exitCode: 0,
    }
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string }

    return {
      pass: false,
      reason: `Validation failed: ${err.stderr || err.stdout || errorMessage(error)}`,
      exitCode: err.status ?? 1,
    }
  }
}

/**
 * Parse validation result from task output
 * Looks for test counts, exit codes, build status
 */
export function parseValidationResult(result: TaskResult): {
  testsRun?: number
  testsPassed?: number
  testsFailed?: number
  buildSucceeded?: boolean
  lintPassed?: boolean
} {
  const verification = result.verification ?? {}

  return {
    testsRun: verification.testsRun,
    testsPassed: verification.testsPassed,
    testsFailed: verification.testsFailed,
    buildSucceeded: verification.buildSucceeded,
    lintPassed: verification.lintPassed,
  }
}

/**
 * Determine if validation passed based on result
 */
export function isValidationPassed(
  result: TaskResult,
  subroutine: SubroutineDefinition,
  validationResult?: ReturnType<typeof runValidationCommand>
): boolean {
  // If we ran a validation command, use its result
  if (validationResult) {
    return validationResult.pass
  }

  // Otherwise check task result status
  if (result.status !== 'success') {
    return false
  }

  // Check verification hints
  const parsed = parseValidationResult(result)

  // If tests were run, check pass rate
  if (parsed.testsRun !== undefined && parsed.testsRun > 0) {
    return parsed.testsFailed === 0
  }

  // If build was checked, verify it succeeded
  if (parsed.buildSucceeded !== undefined) {
    return parsed.buildSucceeded
  }

  // If lint was checked, verify it passed
  if (parsed.lintPassed !== undefined) {
    return parsed.lintPassed
  }

  // Default: assume passed if task succeeded
  return true
}

/**
 * Build fixer prompt for validation loop retry
 */
export function buildFixerPrompt(
  originalPrompt: string,
  validationResult: ReturnType<typeof runValidationCommand>,
  iteration: number
): string {
  return `The previous attempt failed validation. Here's what went wrong:

**Validation Error** (Attempt ${iteration}):
\`\`\`
${validationResult.reason}
\`\`\`

Please fix the issue and ensure the validation command passes.

Original task:
${originalPrompt}

Focus on addressing the specific validation failure above.`
}

/**
 * Initialize validation loop metadata
 */
export function initValidationLoop(): ValidationLoopMetadata {
  return {
    iteration: 1,
    inFixerMode: false,
    attempts: [],
  }
}

/**
 * Update validation loop metadata after attempt
 */
export function recordValidationAttempt(
  metadata: ValidationLoopMetadata,
  passed: boolean,
  reason: string
): void {
  metadata.attempts.push({
    iteration: metadata.iteration,
    pass: passed,
    reason,
    timestamp: new Date(),
  })
}

/**
 * Check if should retry validation loop
 */
export function shouldRetryValidation(
  metadata: ValidationLoopMetadata,
  maxIterations: number
): boolean {
  return metadata.iteration < maxIterations
}
