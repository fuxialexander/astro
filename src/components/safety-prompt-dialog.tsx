/**
 * SafetyPromptDialog Component
 *
 * Displays safety prompts when an agent encounters a non-git working directory.
 * Listens to the realtime store for incoming safety prompts and shows a modal
 * with options: proceed, init git, sandbox, or cancel.
 */

import { useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'
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

export function SafetyPromptDialog() {
  const safetyPrompts = useRealtimeStore((s) => s.safetyPrompts)
  const respondToSafetyPrompt = useRealtimeStore((s) => s.respondToSafetyPrompt)

  // Get the first pending prompt (FIFO)
  const pendingPrompt = safetyPrompts.size > 0
    ? Array.from(safetyPrompts.values())[0]
    : null

  // Track previous taskId to detect prompt changes
  const [prevTaskId, setPrevTaskId] = useState<string | undefined>()
  const [selectedOption, setSelectedOption] = useState<string | undefined>()
  const [responding, setResponding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state when prompt changes (using derived state pattern)
  const currentTaskId = pendingPrompt?.taskId
  if (currentTaskId !== prevTaskId) {
    setPrevTaskId(currentTaskId)
    if (pendingPrompt) {
      setSelectedOption(pendingPrompt.options[0]?.id)
      setResponding(false)
      setError(null)
    }
  }

  const handleConfirm = async () => {
    if (!pendingPrompt || !selectedOption) return

    setResponding(true)
    setError(null)

    try {
      await respondToSafetyPrompt(pendingPrompt.taskId, selectedOption)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send response')
      setResponding(false)
    }
  }

  const handleCancel = async () => {
    if (!pendingPrompt) return

    setResponding(true)
    setError(null)

    try {
      await respondToSafetyPrompt(pendingPrompt.taskId, 'cancel')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send response')
      setResponding(false)
    }
  }

  return (
    <Dialog open={!!pendingPrompt} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
            </div>
            <DialogTitle className="text-xl">Safety Check</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            {pendingPrompt?.warning || 'The working directory requires attention before proceeding.'}
          </DialogDescription>
        </DialogHeader>

        {pendingPrompt && (
          <div className="space-y-4">
            <RadioGroup
              value={selectedOption}
              onValueChange={setSelectedOption}
              className="flex flex-col gap-2"
            >
              {pendingPrompt.options.map((option) => (
                <div
                  key={option.id}
                  className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <RadioGroupItem value={option.id} id={`safety-option-${option.id}`} className="mt-0.5" />
                  <Label
                    htmlFor={`safety-option-${option.id}`}
                    className="flex-1 cursor-pointer"
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    {option.description && (
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {option.description}
                      </span>
                    )}
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
            Cancel Task
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={responding || !selectedOption}
          >
            {responding ? 'Sending...' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
