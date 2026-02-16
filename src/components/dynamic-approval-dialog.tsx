/**
 * DynamicApprovalDialog Component
 *
 * Displays dynamic approval requests from agents (AskUserQuestion tool).
 * Listens to the realtime store for incoming approval requests and shows a modal.
 */

import { useState } from 'react'
import { Check, X, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { useRealtimeStore } from '@/stores/realtime-store'

export function DynamicApprovalDialog() {
  const dynamicApprovals = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)

  // Get the first pending approval (FIFO)
  const pendingApproval = dynamicApprovals.size > 0
    ? Array.from(dynamicApprovals.values())[0]
    : null

  // Track previous requestId to detect approval changes
  const [prevRequestId, setPrevRequestId] = useState<string | undefined>()
  const [selectedOption, setSelectedOption] = useState<string | undefined>()
  const [responding, setResponding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state when approval changes (using derived state pattern)
  const currentRequestId = pendingApproval?.requestId
  if (currentRequestId !== prevRequestId) {
    setPrevRequestId(currentRequestId)
    if (pendingApproval) {
      setSelectedOption(pendingApproval.options[0])
      setResponding(false)
      setError(null)
    }
  }

  const handleConfirm = async () => {
    if (!pendingApproval || !selectedOption) return

    setResponding(true)
    setError(null)

    try {
      await respondToDynamicApproval(
        pendingApproval.taskId,
        pendingApproval.requestId,
        selectedOption
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send response')
      setResponding(false)
    }
  }

  const handleCancel = async () => {
    if (!pendingApproval) return

    setResponding(true)
    setError(null)

    try {
      // Send "Other" as the answer to indicate cancellation
      await respondToDynamicApproval(
        pendingApproval.taskId,
        pendingApproval.requestId,
        'Other'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send response')
      setResponding(false)
    }
  }

  return (
    <Dialog open={!!pendingApproval} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning">
              <AlertCircle className="h-5 w-5 text-warning-foreground" />
            </div>
            <DialogTitle className="text-xl">Agent Question</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            {pendingApproval?.question}
          </DialogDescription>
        </DialogHeader>

        {pendingApproval && (
          <div className="space-y-4">
            <RadioGroup
              value={selectedOption}
              onValueChange={setSelectedOption}
              className="flex flex-col gap-2"
            >
              {pendingApproval.options.map((option, index) => (
                <div
                  key={option}
                  className="flex items-center space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <RadioGroupItem value={option} id={`approval-option-${index}`} />
                  <Label
                    htmlFor={`approval-option-${index}`}
                    className="flex-1 cursor-pointer text-sm"
                  >
                    {option}
                  </Label>
                </div>
              ))}
            </RadioGroup>

            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={responding}
          >
            <X className="h-4 w-4 mr-1.5" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={responding || !selectedOption}
          >
            <Check className="h-4 w-4 mr-1.5" />
            {responding ? 'Confirming...' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
