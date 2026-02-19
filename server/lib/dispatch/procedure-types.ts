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

  /** Multiple choice options for approval (if omitted, shows binary approve/reject) */
  approvalOptions?: string[]

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

  /** Approval result (boolean for binary, or selected option for multi-choice) */
  approvalResult?: boolean | string

  /** The full procedure definition (for reference during execution) */
  procedure: ProcedureDefinition
}

/**
 * Built-in procedures
 */
export const BUILT_IN_PROCEDURES: Record<string, ProcedureDefinition> = {
  'full-development': {
    name: 'full-development',
    description: 'Implement → Verify → Git Commit → PR → Summary',
    subroutines: [
      {
        name: 'implement',
        description: 'Implement the task following project conventions',
        promptTemplate: `{{task.description}}

Follow project conventions. Write tests where appropriate. Be thorough but efficient.
When you encounter decision points where multiple approaches are equally valid, note your choice and reasoning.`,
        usesValidationLoop: true,
        validationCommand: 'npm run build',
        maxValidationIterations: 3,
      },
      {
        name: 'verify',
        description: 'Read-only verification of the implementation',
        promptTemplate: `You are a code reviewer. DO NOT make any changes. Only READ and VERIFY the work done so far.

Check the following:
1. Does the implementation match the task requirements?
2. Are there any obvious bugs or logic errors?
3. Do tests pass? Is the build clean?
4. Are there any security concerns?

Task that was implemented: {{task.description}}

Respond with a JSON object (and nothing else):
{
  "pass": true/false,
  "reason": "Brief explanation",
  "issues": ["list of specific issues if any"],
  "quality": "good" | "acceptable" | "needs-work"
}`,
        usesValidationLoop: true,
        maxValidationIterations: 2,
      },
      {
        name: 'git-commit',
        description: 'Stage and commit all changes with a descriptive message',
        promptTemplate: `Stage all changed files and create a git commit with a clear, descriptive commit message summarizing the work done.

The commit message should:
- Start with a conventional commit prefix (feat:, fix:, refactor:, etc.)
- Briefly describe what was accomplished
- Reference the task: {{task.title}}

Then push the branch to the remote. Do NOT create a pull request yet.`,
        singleTurn: true,
      },
      {
        name: 'gh-pr',
        description: 'Create or update a pull request',
        promptTemplate: `Create a GitHub pull request for the current branch. If a PR already exists for this branch, update its description instead.

The PR should include:
- Title: A concise description of the change
- Body with sections:
  ## Summary
  Brief description of what this PR does.

  ## Changes
  - List of key changes made

  ## Testing
  - How the changes were tested
  - Test results

  ## Task
  {{task.title}}: {{task.description}}

Use the gh CLI tool to create the PR.`,
        singleTurn: true,
      },
      {
        name: 'summary',
        description: 'Generate execution summary',
        promptTemplate: `Generate a concise summary of the work completed for this task.

Task: {{task.title}}
Description: {{task.description}}

Previous subroutine results:
{{previous.results}}

Respond with a JSON object (and nothing else):
{
  "workCompleted": "1-2 sentence summary of what was done",
  "filesChanged": ["list", "of", "files", "modified"],
  "status": "success" | "partial" | "failure",
  "followUps": ["any follow-up tasks or considerations"]
}`,
        singleTurn: true,
        disallowAllTools: true,
      },
    ],
  },

  'bug-fix': {
    name: 'bug-fix',
    description: 'Debug → Fix → Verify → Commit → Summary',
    subroutines: [
      {
        name: 'implement',
        description: 'Debug the issue and apply the fix',
        promptTemplate: `Debug and fix the following issue:

{{task.description}}

Steps:
1. Reproduce or understand the bug from the description
2. Identify the root cause by reading relevant code
3. Apply the minimal fix needed
4. Verify the fix resolves the issue
5. Ensure no regressions`,
        usesValidationLoop: true,
        validationCommand: 'npm run build',
        maxValidationIterations: 3,
      },
      {
        name: 'git-commit',
        description: 'Stage and commit the fix',
        promptTemplate: `Stage all changed files and create a git commit with a descriptive message.

Use the "fix:" conventional commit prefix. Reference: {{task.title}}

Push the branch to the remote.`,
        singleTurn: true,
      },
      {
        name: 'summary',
        description: 'Generate fix summary',
        promptTemplate: `Generate a concise summary of the bug fix.

Task: {{task.title}}
Description: {{task.description}}

Previous subroutine results:
{{previous.results}}

Respond with a JSON object (and nothing else):
{
  "workCompleted": "1-2 sentence summary of the fix",
  "filesChanged": ["list", "of", "files", "modified"],
  "status": "success" | "partial" | "failure",
  "followUps": ["any follow-up tasks"]
}`,
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
        description: 'Gather relevant information from the codebase',
        promptTemplate: `Research the following topic by exploring the codebase:

{{task.description}}

Gather relevant information: read files, search for patterns, understand architecture.
Take detailed notes on what you find.`,
      },
      {
        name: 'summary',
        description: 'Write a comprehensive research report',
        promptTemplate: `Write a comprehensive report based on your research.

Task: {{task.title}}
Description: {{task.description}}

Previous findings:
{{previous.results}}

Include:
1. Key findings
2. Patterns observed
3. Recommendations
4. Areas that need further investigation

Respond with a JSON object (and nothing else):
{
  "workCompleted": "1-2 sentence summary of findings",
  "filesChanged": [],
  "status": "success",
  "followUps": ["recommended next steps"]
}`,
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
