/**
 * Result Router
 *
 * Routes task results to the appropriate next step:
 * - Auto-verified tasks are closed and downstream is triggered
 * - Judgment-required tasks are surfaced to the judgment queue
 * - Failed tasks are handled based on retry policy
 */

import type { PlanNode } from '../types.js'
import type { TaskResult, VerificationHints } from './types.js'
import type {
  RoutingDecision,
  JudgmentContext,
  TaskArtifact,
} from './types.js'

/**
 * Configuration for result routing
 */
export interface ResultRouterConfig {
  /** Default to auto-close if verification type not specified */
  defaultAutoClose: boolean
  /** Maximum output length to include in judgment context */
  maxJudgmentOutputLength: number
  /** Keywords that suggest a task failed even if status is success */
  failureKeywords: string[]
  /** Keywords that suggest auto-verification passed */
  successKeywords: string[]
}

/**
 * Default result router configuration
 */
export const DEFAULT_ROUTER_CONFIG: ResultRouterConfig = {
  defaultAutoClose: false,
  maxJudgmentOutputLength: 5000,
  failureKeywords: ['error', 'failed', 'exception', 'crash', 'fatal'],
  successKeywords: ['passed', 'success', 'completed', 'verified', 'all tests pass'],
}

/**
 * Result router implementation
 */
export class ResultRouter {
  private config: ResultRouterConfig
  constructor(config: ResultRouterConfig = DEFAULT_ROUTER_CONFIG) {
    this.config = config
  }

  /**
   * Route a task result to the appropriate next step
   */
  route(
    node: PlanNode,
    result: TaskResult,
    downstreamNodes: string[] = []
  ): RoutingDecision {
    // Determine if task succeeded
    const isSuccess = result.status === 'success'
    const isCancelled = result.status === 'cancelled'

    // Handle cancellation
    if (isCancelled) {
      return this.routeCancelled(node)
    }

    // Handle failure
    if (!isSuccess) {
      return this.routeFailure(node, result)
    }

    // Success case - determine verification approach
    const verification = this.determineVerification(node, result)

    if (verification === 'auto') {
      return this.routeAutoVerified(node, result, downstreamNodes)
    } else {
      return this.routeJudgmentRequired(node, result)
    }
  }

  /**
   * Determine if task can be auto-verified
   */
  private determineVerification(
    node: PlanNode,
    result: TaskResult
  ): 'auto' | 'human' {
    // Explicit node verification setting takes precedence
    if (node.verification === 'human') {
      return 'human'
    }

    if (node.verification === 'auto') {
      // Check verification hints for any issues
      const hints = result.verification as VerificationHints | undefined
      if (hints) {
        // If tests failed, require human review
        if (hints.testsFailed && hints.testsFailed > 0) {
          return 'human'
        }
        // If build failed, require human review
        if (hints.buildSucceeded === false) {
          return 'human'
        }
        // If lint failed, require human review
        if (hints.lintPassed === false) {
          return 'human'
        }
        // If type check failed, require human review
        if (hints.typeCheckPassed === false) {
          return 'human'
        }
        // Non-zero exit code requires review
        if (hints.exitCode !== undefined && hints.exitCode !== 0) {
          return 'human'
        }
      }

      // Check output for failure keywords
      if (this.containsFailureKeywords(result.stdout)) {
        return 'human'
      }

      return 'auto'
    }

    // Default based on config
    return this.config.defaultAutoClose ? 'auto' : 'human'
  }

  /**
   * Route an auto-verified task
   */
  private routeAutoVerified(
    _node: PlanNode,
    _result: TaskResult,
    downstreamNodes: string[]
  ): RoutingDecision {
    return {
      autoClose: true,
      targetStatus: 'auto_verified',
      reason: 'Task completed successfully with auto-verification',
      surfaceToJudgment: false,
      triggerDownstream: true,
      downstreamNodes,
    }
  }

  /**
   * Route a task requiring human judgment
   */
  private routeJudgmentRequired(
    node: PlanNode,
    result: TaskResult
  ): RoutingDecision {
    const judgmentContext = this.buildJudgmentContext(node, result)

    return {
      autoClose: false,
      targetStatus: 'awaiting_judgment',
      reason: 'Task requires human verification',
      surfaceToJudgment: true,
      judgmentContext,
      triggerDownstream: false,
    }
  }

  /**
   * Route a failed task
   */
  private routeFailure(node: PlanNode, result: TaskResult): RoutingDecision {
    const judgmentContext = this.buildFailureJudgmentContext(node, result)

    return {
      autoClose: false,
      targetStatus: 'awaiting_judgment',
      reason: `Task failed: ${result.errorMessage || 'Unknown error'}`,
      surfaceToJudgment: true,
      judgmentContext,
      triggerDownstream: false,
    }
  }

  /**
   * Route a cancelled task
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private routeCancelled(_node: PlanNode): RoutingDecision {
    return {
      autoClose: false,
      targetStatus: 'planned', // Reset to planned
      reason: 'Task was cancelled',
      surfaceToJudgment: false,
      triggerDownstream: false,
    }
  }

  /**
   * Build judgment context for a successful task
   */
  private buildJudgmentContext(_node: PlanNode, result: TaskResult): JudgmentContext {
    const output = result.stdout || ''
    const truncatedOutput = this.truncateOutput(output)

    // Extract key points from output
    const keyPoints = this.extractKeyPoints(output, result.verification as VerificationHints | undefined)

    // Build artifacts list
    const artifacts = this.extractArtifacts(result)

    // Determine suggested action
    const { action, confidence } = this.suggestAction(result)

    return {
      summary: truncatedOutput,
      keyPoints,
      suggestedAction: action,
      confidence,
      artifacts,
    }
  }

  /**
   * Build judgment context for a failed task
   */
  private buildFailureJudgmentContext(
    _node: PlanNode,
    result: TaskResult
  ): JudgmentContext {
    const errorMessage = result.errorMessage || 'Unknown error'
    const output = result.stdout || ''
    const stderr = result.stderr || ''

    const summary = this.truncateOutput([
      `**Error:** ${errorMessage}`,
      output ? `\n**Output:**\n${output}` : '',
      stderr ? `\n**Stderr:**\n${stderr}` : '',
    ].filter(Boolean).join('\n'))

    const failureHints = result.verification as VerificationHints | undefined
    const keyPoints = [
      `Error: ${errorMessage}`,
      failureHints?.exitCode !== undefined
        ? `Exit code: ${failureHints.exitCode}`
        : null,
      failureHints?.testsFailed
        ? `Tests failed: ${failureHints.testsFailed}`
        : null,
    ].filter((p): p is string => p !== null)

    // Suggest retry for transient errors
    const isTransient = this.isTransientError(errorMessage)

    return {
      summary,
      keyPoints,
      suggestedAction: isTransient ? 'retry' : 'reject',
      confidence: isTransient ? 0.6 : 0.4,
      artifacts: this.extractArtifacts(result),
    }
  }

  /**
   * Extract key points from task output
   */
  private extractKeyPoints(output: string, hints?: VerificationHints): string[] {
    const points: string[] = []

    // Add verification hints as key points
    if (hints) {
      if (hints.testsRun) {
        if (hints.testsPassed && hints.testsFailed !== undefined) {
          points.push(`Tests: ${hints.testsPassed} passed, ${hints.testsFailed} failed`)
        } else if (hints.testsPassed) {
          points.push(`Tests: ${hints.testsPassed} passed`)
        }
      }

      if (hints.buildSucceeded !== undefined) {
        points.push(`Build: ${hints.buildSucceeded ? 'succeeded' : 'failed'}`)
      }

      if (hints.lintPassed !== undefined) {
        points.push(`Lint: ${hints.lintPassed ? 'passed' : 'failed'}`)
      }

      if (hints.typeCheckPassed !== undefined) {
        points.push(`Type check: ${hints.typeCheckPassed ? 'passed' : 'failed'}`)
      }
    }

    // Extract key lines from output (lines with important keywords)
    const importantLines = output
      .split('\n')
      .filter((line) => {
        const lower = line.toLowerCase()
        return (
          lower.includes('success') ||
          lower.includes('complete') ||
          lower.includes('created') ||
          lower.includes('updated') ||
          lower.includes('warning')
        )
      })
      .slice(0, 5) // Max 5 important lines

    points.push(...importantLines.map((l) => l.trim()))

    return points.slice(0, 10) // Max 10 key points
  }

  /**
   * Extract artifacts from task result
   */
  private extractArtifacts(result: TaskResult): TaskArtifact[] {
    const artifacts: TaskArtifact[] = []

    // Add file changes as artifacts
    if (result.filesChanged) {
      for (const change of result.filesChanged) {
        artifacts.push({
          name: change.path,
          type: 'diff',
          path: change.path,
          preview: change.diff?.slice(0, 500),
        })
      }
    }

    return artifacts
  }

  /**
   * Suggest an action based on task result
   */
  private suggestAction(
    result: TaskResult
  ): { action: JudgmentContext['suggestedAction']; confidence: number } {
    const hints = result.verification as VerificationHints | undefined

    // Strong indicators for approval
    if (hints) {
      const allTestsPass = hints.testsRun && hints.testsFailed === 0
      const buildOk = hints.buildSucceeded !== false
      const lintOk = hints.lintPassed !== false
      const typeOk = hints.typeCheckPassed !== false

      if (allTestsPass && buildOk && lintOk && typeOk) {
        return { action: 'approve', confidence: 0.9 }
      }
    }

    // Check output for success indicators
    const output = result.stdout || ''
    const hasSuccessKeywords = this.containsSuccessKeywords(output)
    const hasFailureKeywords = this.containsFailureKeywords(output)

    if (hasSuccessKeywords && !hasFailureKeywords) {
      return { action: 'approve', confidence: 0.7 }
    }

    if (hasFailureKeywords) {
      return { action: 'modify', confidence: 0.5 }
    }

    // Default: suggest approval with low confidence
    return { action: 'approve', confidence: 0.5 }
  }

  /**
   * Check if error is likely transient (network, timeout, etc.)
   */
  private isTransientError(errorMessage: string): boolean {
    const transientPatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /ECONNRESET/i,
      /ETIMEDOUT/i,
      /rate limit/i,
      /too many requests/i,
      /503/,
      /502/,
      /temporarily unavailable/i,
    ]

    return transientPatterns.some((p) => p.test(errorMessage))
  }

  /**
   * Check if output contains failure keywords
   */
  private containsFailureKeywords(output?: string): boolean {
    if (!output) return false
    const lower = output.toLowerCase()
    return this.config.failureKeywords.some((kw) => lower.includes(kw))
  }

  /**
   * Check if output contains success keywords
   */
  private containsSuccessKeywords(output?: string): boolean {
    if (!output) return false
    const lower = output.toLowerCase()
    return this.config.successKeywords.some((kw) => lower.includes(kw))
  }

  /**
   * Truncate output for judgment context
   */
  private truncateOutput(output: string): string {
    if (output.length <= this.config.maxJudgmentOutputLength) {
      return output
    }
    const half = Math.floor(this.config.maxJudgmentOutputLength / 2)
    return (
      output.slice(0, half) +
      '\n\n[... output truncated ...]\n\n' +
      output.slice(-half)
    )
  }
}

/**
 * Create a result router with default configuration
 */
export function createResultRouter(
  config?: Partial<ResultRouterConfig>
): ResultRouter {
  return new ResultRouter({ ...DEFAULT_ROUTER_CONFIG, ...config })
}
