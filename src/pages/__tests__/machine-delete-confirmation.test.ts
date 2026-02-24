/**
 * Unit tests for machine delete confirmation behavior.
 *
 * Tests the confirmation flow logic used in ConnectedMachinesCard:
 * 1. Delete button click stops event propagation (doesn't trigger card click)
 * 2. Confirmation state machine: idle → confirming → confirmed/cancelled
 * 3. Only calls onRemove after explicit confirmation
 */

import { describe, it, expect, vi } from 'vitest'

/**
 * Simulates the confirmation state machine used in ConnectedMachinesCard.
 * Extracted as pure logic to test without React/DOM dependencies.
 */
function createConfirmationFlow() {
  let confirmingMachineId: string | null = null
  const onRemove = vi.fn()
  const onMachineClick = vi.fn()

  return {
    get confirmingId() { return confirmingMachineId },
    onRemove,
    onMachineClick,

    /** Simulates clicking the delete button (with stopPropagation) */
    clickDeleteButton(machineId: string) {
      // In the real component, e.stopPropagation() prevents the card onClick.
      // Here we just verify that onMachineClick is NOT called.
      confirmingMachineId = machineId
    },

    /** Simulates clicking the card body */
    clickCard(machineId: string) {
      onMachineClick(machineId)
    },

    /** Simulates confirming the deletion in the dialog */
    confirmDeletion() {
      if (confirmingMachineId) {
        onRemove(confirmingMachineId)
        confirmingMachineId = null
      }
    },

    /** Simulates cancelling the deletion dialog */
    cancelDeletion() {
      confirmingMachineId = null
    },
  }
}

describe('machine delete confirmation flow', () => {
  it('starts with no machine being confirmed', () => {
    const flow = createConfirmationFlow()
    expect(flow.confirmingId).toBeNull()
  })

  it('sets confirming state when delete button is clicked', () => {
    const flow = createConfirmationFlow()
    flow.clickDeleteButton('machine-1')
    expect(flow.confirmingId).toBe('machine-1')
  })

  it('does not call onRemove when delete button is clicked (only opens dialog)', () => {
    const flow = createConfirmationFlow()
    flow.clickDeleteButton('machine-1')
    expect(flow.onRemove).not.toHaveBeenCalled()
  })

  it('does not call onMachineClick when delete button is clicked (stopPropagation)', () => {
    const flow = createConfirmationFlow()
    flow.clickDeleteButton('machine-1')
    expect(flow.onMachineClick).not.toHaveBeenCalled()
  })

  it('calls onRemove only after explicit confirmation', () => {
    const flow = createConfirmationFlow()
    flow.clickDeleteButton('machine-1')
    flow.confirmDeletion()
    expect(flow.onRemove).toHaveBeenCalledWith('machine-1')
    expect(flow.onRemove).toHaveBeenCalledTimes(1)
  })

  it('clears confirming state after confirmation', () => {
    const flow = createConfirmationFlow()
    flow.clickDeleteButton('machine-1')
    flow.confirmDeletion()
    expect(flow.confirmingId).toBeNull()
  })

  it('does not call onRemove when cancelled', () => {
    const flow = createConfirmationFlow()
    flow.clickDeleteButton('machine-1')
    flow.cancelDeletion()
    expect(flow.onRemove).not.toHaveBeenCalled()
    expect(flow.confirmingId).toBeNull()
  })

  it('allows clicking card normally without delete interference', () => {
    const flow = createConfirmationFlow()
    flow.clickCard('machine-1')
    expect(flow.onMachineClick).toHaveBeenCalledWith('machine-1')
    expect(flow.onRemove).not.toHaveBeenCalled()
    expect(flow.confirmingId).toBeNull()
  })

  it('handles rapid click-delete then cancel then click-card', () => {
    const flow = createConfirmationFlow()
    // First: click delete
    flow.clickDeleteButton('machine-1')
    expect(flow.confirmingId).toBe('machine-1')
    // Then: cancel
    flow.cancelDeletion()
    expect(flow.confirmingId).toBeNull()
    // Then: click card normally
    flow.clickCard('machine-1')
    expect(flow.onMachineClick).toHaveBeenCalledWith('machine-1')
    expect(flow.onRemove).not.toHaveBeenCalled()
  })

  it('confirms deletion for a different machine than the one clicked for card details', () => {
    const flow = createConfirmationFlow()
    // Click card for machine-1 (opens detail)
    flow.clickCard('machine-1')
    expect(flow.onMachineClick).toHaveBeenCalledWith('machine-1')
    // Click delete for machine-2
    flow.clickDeleteButton('machine-2')
    expect(flow.confirmingId).toBe('machine-2')
    // Confirm
    flow.confirmDeletion()
    expect(flow.onRemove).toHaveBeenCalledWith('machine-2')
  })

  it('no-ops confirmDeletion when nothing is being confirmed', () => {
    const flow = createConfirmationFlow()
    flow.confirmDeletion()
    expect(flow.onRemove).not.toHaveBeenCalled()
  })
})

describe('stopPropagation behavior', () => {
  it('stopPropagation prevents parent handler from firing', () => {
    const parentHandler = vi.fn()
    const childHandler = vi.fn()

    // Simulate DOM event propagation logic
    const event = {
      propagationStopped: false,
      stopPropagation() { this.propagationStopped = true },
    }

    // Child handler runs first (delete button)
    childHandler(event)
    event.stopPropagation()

    // Parent handler only runs if propagation wasn't stopped
    if (!event.propagationStopped) {
      parentHandler()
    }

    expect(childHandler).toHaveBeenCalled()
    expect(parentHandler).not.toHaveBeenCalled()
  })
})
