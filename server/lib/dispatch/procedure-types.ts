/**
 * Procedure-Based Workflow Types
 *
 * Sequential subroutine execution with approval gates and validation loops.
 * Pattern from Cyrus edge-worker/src/procedures/types.ts
 */

/**
 * Definition of a single subroutine in a procedure
 */
export interface SubroutineDefinition {
  /** Unique identifier for the subroutine */
  name: string

  /** Prompt template for this subroutine (supports {{variable}} interpolation) */
  promptTemplate: string

  /** Run with maxTurns: 1 (single-turn, no tools) */
  singleTurn?: boolean

  /** Human-readable description of what this subroutine does */
  description?: string

  /** Require human approval before running */
  requiresApproval?: boolean

  /** Approval message shown to user */
  approvalMessage?: string

  /** Run validation loop after this subroutine */
  usesValidationLoop?: boolean

  /** Max validation loop iterations (default: 3) */
  maxValidationIterations?: number

  /** Validation command (e.g., "npm test") */
  validationCommand?: string

  /** Tool restrictions for this subroutine */
  disallowedTools?: string[]

  /** Disable all tools (text-only output) */
  disallowAllTools?: boolean
}

/**
 * Complete definition of a procedure (sequence of subroutines)
 */
export interface ProcedureDefinition {
  /** Unique identifier for the procedure */
  name: string

  /** Human-readable description of when to use this procedure */
  description?: string

  /** Ordered list of subroutines to execute */
  subroutines: SubroutineDefinition[]
}

/**
 * Validation loop state for subroutines that use retry logic
 */
export interface ValidationLoopMetadata {
  /** Current iteration (1-based) */
  iteration: number

  /** Whether the loop is in fixer mode (running validation-fixer) */
  inFixerMode: boolean

  /** Results from each validation attempt */
  attempts: Array<{
    iteration: number
    pass: boolean
    reason: string
    timestamp: Date
  }>
}

/**
 * Procedure metadata stored in session
 */
export interface ProcedureState {
  /** Name of the active procedure */
  procedureName: string

  /** Current position in the subroutine sequence (0-indexed) */
  currentSubroutineIndex: number

  /** History of completed subroutines */
  subroutineHistory: Array<{
    subroutine: string
    completedAt: Date
    sessionId: string | null
    result?: string
  }>

  /** State for validation loop (when current subroutine uses usesValidationLoop) */
  validationLoop?: ValidationLoopMetadata

  /** Approval state */
  awaitingApproval?: boolean

  /** Approval result */
  approvalGranted?: boolean
}

/**
 * Built-in procedures
 */
export const BUILT_IN_PROCEDURES: Record<string, ProcedureDefinition> = {
  'full-development': {
    name: 'full-development',
    description: 'Implement → Test → Fix → Verify → Deploy',
    subroutines: [
      {
        name: 'implement',
        promptTemplate: 'Implement the following feature:\n\n{{task.description}}\n\nFollow project conventions and write tests.',
        usesValidationLoop: true,
        validationCommand: 'npm test',
        maxValidationIterations: 3,
      },
      {
        name: 'verify',
        promptTemplate: 'Verify the implementation meets all requirements. Provide a summary.',
        singleTurn: true,
        disallowAllTools: true,
      },
      {
        name: 'deploy',
        promptTemplate: 'Create a pull request for deployment with a clear description.',
        requiresApproval: true,
        approvalMessage: 'Approve deployment PR creation?',
      },
    ],
  },

  'bug-fix': {
    name: 'bug-fix',
    description: 'Debug → Fix → Test → Verify',
    subroutines: [
      {
        name: 'debug',
        promptTemplate: 'Debug the following issue:\n\n{{task.description}}\n\nIdentify the root cause.',
      },
      {
        name: 'fix',
        promptTemplate: 'Apply the fix and ensure tests pass.',
        usesValidationLoop: true,
        validationCommand: 'npm test',
        maxValidationIterations: 3,
      },
      {
        name: 'summary',
        promptTemplate: 'Summarize the fix and what was changed.',
        singleTurn: true,
        disallowAllTools: true,
      },
    ],
  },

  'research': {
    name: 'research',
    description: 'Research → Analyze → Report',
    subroutines: [
      {
        name: 'gather',
        promptTemplate: 'Research: {{task.description}}\n\nGather relevant information from the codebase.',
      },
      {
        name: 'analyze',
        promptTemplate: 'Analyze the gathered information and identify patterns.',
      },
      {
        name: 'report',
        promptTemplate: 'Write a comprehensive report with findings and recommendations.',
        singleTurn: true,
        disallowAllTools: true,
      },
    ],
  },
}

/**
 * Get a procedure definition by name
 */
export function getProcedure(name: string): ProcedureDefinition | null {
  return BUILT_IN_PROCEDURES[name] ?? null
}

/**
 * List all available procedures
 */
export function listProcedures(): ProcedureDefinition[] {
  return Object.values(BUILT_IN_PROCEDURES)
}
