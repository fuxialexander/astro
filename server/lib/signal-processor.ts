/**
 * Signal Processor
 *
 * Evaluates incoming signals (webhooks, events) against registered
 * evaluators contributed by plugins. Used to trigger plan node
 * transitions based on external events.
 */

/**
 * Result of processing a signal
 */
export interface SignalProcessResult {
  matched: boolean
  nodeIds: string[]
}

export class SignalProcessor {
  private evaluators = new Map<string, (payload: unknown) => boolean>()

  /**
   * Register an evaluator for a signal type
   */
  registerEvaluator(type: string, evaluator: (payload: unknown) => boolean): void {
    this.evaluators.set(type, evaluator)
  }

  /**
   * Unregister an evaluator
   */
  unregisterEvaluator(type: string): void {
    this.evaluators.delete(type)
  }

  /**
   * Process an incoming signal against registered evaluators
   */
  processWebhook(signalType: string, payload: unknown): SignalProcessResult {
    const evaluator = this.evaluators.get(signalType)
    if (!evaluator) {
      return { matched: false, nodeIds: [] }
    }

    try {
      const matched = evaluator(payload)
      return { matched, nodeIds: [] }
    } catch (err) {
      console.warn(`[signal-processor] Evaluator for '${signalType}' threw:`, err)
      return { matched: false, nodeIds: [] }
    }
  }

  /**
   * List all registered signal types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.evaluators.keys())
  }
}

export const signalProcessor = new SignalProcessor()
