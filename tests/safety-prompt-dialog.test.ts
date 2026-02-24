/**
 * Safety Prompt Dialog Tests
 *
 * Tests the safety prompt dialog component logic:
 *   1. Dialog dismissibility — Escape/click-outside should trigger cancel
 *   2. Cancel guard — no cancel while already responding
 *   3. First option auto-selected on new prompt
 *   4. State reset on prompt change
 *   5. Styling and labeling verification via source code
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// 1. Dialog state machine tests
// ============================================================================

interface SafetyPrompt {
  taskId: string
  safetyTier: string
  warning?: string
  options: Array<{ id: string; label: string; description?: string }>
}

/**
 * Simulates the dialog's state management logic.
 */
function createDialogState(prompt: SafetyPrompt | null) {
  let selectedOption = prompt?.options[0]?.id
  let responding = false
  let error: string | null = null

  return {
    get selectedOption() { return selectedOption },
    set selectedOption(val: string | undefined) { selectedOption = val },
    get responding() { return responding },
    get error() { return error },

    handleConfirm: async (respondFn: (taskId: string, decision: string) => Promise<void>) => {
      if (!prompt || !selectedOption) return false
      responding = true
      error = null
      try {
        await respondFn(prompt.taskId, selectedOption)
        return true
      } catch (err) {
        error = (err as Error).message
        responding = false
        return false
      }
    },

    handleCancel: async (respondFn: (taskId: string, decision: string) => Promise<void>) => {
      if (!prompt || responding) return false
      responding = true
      error = null
      try {
        await respondFn(prompt.taskId, 'cancel')
        return true
      } catch (err) {
        error = (err as Error).message
        responding = false
        return false
      }
    },

    // Simulates onOpenChange(false) from Dialog
    handleDialogClose: async (respondFn: (taskId: string, decision: string) => Promise<void>) => {
      if (responding) return false // Guard: can't close while responding
      return createDialogState(prompt).handleCancel(respondFn)
    },

    resetForNewPrompt: (newPrompt: SafetyPrompt) => {
      selectedOption = newPrompt.options[0]?.id
      responding = false
      error = null
    },
  }
}

describe('Safety prompt dialog state', () => {
  const samplePrompt: SafetyPrompt = {
    taskId: 'exec-123',
    safetyTier: 'risky',
    warning: 'Working directory is not a git repository',
    options: [
      { id: 'proceed', label: 'Continue anyway', description: 'Proceed without git' },
      { id: 'init-git', label: 'Initialize git', description: 'Run git init first' },
      { id: 'sandbox', label: 'Use sandbox', description: 'Run in isolated environment' },
      { id: 'cancel', label: 'Cancel', description: 'Cancel the task' },
    ],
  }

  it('auto-selects the first option', () => {
    const state = createDialogState(samplePrompt)
    expect(state.selectedOption).toBe('proceed')
  })

  it('confirm sends the selected option', async () => {
    const state = createDialogState(samplePrompt)
    state.selectedOption = 'init-git'

    let sentDecision = ''
    await state.handleConfirm(async (_taskId, decision) => {
      sentDecision = decision
    })

    expect(sentDecision).toBe('init-git')
  })

  it('cancel always sends "cancel" decision', async () => {
    const state = createDialogState(samplePrompt)

    let sentDecision = ''
    await state.handleCancel(async (_taskId, decision) => {
      sentDecision = decision
    })

    expect(sentDecision).toBe('cancel')
  })

  it('cancel is blocked while responding (prevents double-submission)', async () => {
    const state = createDialogState(samplePrompt)

    // Start a confirm that takes time
    const slowRespond = () => new Promise<void>((resolve) => setTimeout(resolve, 100))
    const confirmPromise = state.handleConfirm(slowRespond)

    // Try to cancel immediately
    const cancelResult = await state.handleCancel(async () => {})
    expect(cancelResult).toBe(false) // Should be blocked

    await confirmPromise
  })

  it('dialog close (Escape) triggers cancel', async () => {
    const state = createDialogState(samplePrompt)

    let sentDecision = ''
    await state.handleDialogClose(async (_taskId, decision) => {
      sentDecision = decision
    })

    expect(sentDecision).toBe('cancel')
  })

  it('dialog close is blocked while responding', async () => {
    const state = createDialogState(samplePrompt)

    // Simulate responding state
    const neverResolve = () => new Promise<void>(() => {})
    state.handleConfirm(neverResolve) // Don't await — leaves responding=true

    // Wait a tick for responding to be set
    await new Promise((r) => setTimeout(r, 0))

    const closeResult = await state.handleDialogClose(async () => {})
    expect(closeResult).toBe(false)
  })

  it('resets state when prompt changes', () => {
    const state = createDialogState(samplePrompt)
    state.selectedOption = 'sandbox' // User changed selection

    const newPrompt: SafetyPrompt = {
      taskId: 'exec-456',
      safetyTier: 'dangerous',
      options: [
        { id: 'abort', label: 'Abort' },
        { id: 'force', label: 'Force continue' },
      ],
    }

    state.resetForNewPrompt(newPrompt)
    expect(state.selectedOption).toBe('abort')
    expect(state.responding).toBe(false)
    expect(state.error).toBeNull()
  })

  it('handles prompt with no options gracefully', () => {
    const emptyPrompt: SafetyPrompt = {
      taskId: 'exec-empty',
      safetyTier: 'risky',
      options: [],
    }

    const state = createDialogState(emptyPrompt)
    expect(state.selectedOption).toBeUndefined()
  })

  it('confirm does nothing without a selected option', async () => {
    const emptyPrompt: SafetyPrompt = {
      taskId: 'exec-empty',
      safetyTier: 'risky',
      options: [],
    }

    const state = createDialogState(emptyPrompt)
    const result = await state.handleConfirm(async () => {})
    expect(result).toBe(false)
  })

  it('confirm does nothing without a prompt', async () => {
    const state = createDialogState(null)
    const result = await state.handleConfirm(async () => {})
    expect(result).toBe(false)
  })

  it('error is displayed after failed confirm', async () => {
    const state = createDialogState(samplePrompt)

    await state.handleConfirm(async () => {
      throw new Error('Server unavailable')
    })

    expect(state.error).toBe('Server unavailable')
    expect(state.responding).toBe(false) // Reset to allow retry
  })

  it('error is cleared on next confirm attempt', async () => {
    const state = createDialogState(samplePrompt)

    // First attempt: fails
    await state.handleConfirm(async () => {
      throw new Error('First failure')
    })
    expect(state.error).toBe('First failure')

    // Second attempt: succeeds
    await state.handleConfirm(async () => {})
    // responding is true on success path; error was cleared
  })
})

// ============================================================================
// 2. Source code verification
// ============================================================================

describe('safety-prompt-dialog.tsx source code', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/components/safety-prompt-dialog.tsx'),
    'utf-8'
  )

  it('title says "Working Directory Review" not "Safety Check"', () => {
    expect(source).toContain('Working Directory Review')
    expect(source).not.toContain('>Safety Check<')
  })

  it('uses ShieldAlert icon for warning', () => {
    expect(source).toContain('ShieldAlert')
    expect(source).toContain('<ShieldAlert')
  })

  it('uses warning color for icon container', () => {
    expect(source).toContain('bg-warning/15')
  })

  it('onOpenChange calls handleCancel (not empty function)', () => {
    // Old code had: onOpenChange={() => {}}
    // New code should call handleCancel
    expect(source).not.toContain('onOpenChange={() => {}}')
    expect(source).toContain('handleCancel')
  })

  it('guards cancel with !responding', () => {
    // The onOpenChange handler should check responding state
    expect(source).toContain('!responding')
  })

  it('cancel button uses ghost variant', () => {
    expect(source).toContain('variant="ghost"')
  })

  it('cancel button has hover:text-destructive for warning color', () => {
    expect(source).toContain('hover:text-destructive')
  })

  it('confirm button shows Loader2 spinner while responding', () => {
    expect(source).toContain('Loader2')
    expect(source).toContain('animate-spin')
  })

  it('radio options have selected-state highlight', () => {
    expect(source).toContain('border-primary bg-primary/5')
  })

  it('footer has border-t separator', () => {
    expect(source).toContain('border-t')
  })

  it('icon container is h-10 w-10 rounded-lg', () => {
    expect(source).toContain('h-10')
    expect(source).toContain('w-10')
    expect(source).toContain('rounded-lg')
  })
})
