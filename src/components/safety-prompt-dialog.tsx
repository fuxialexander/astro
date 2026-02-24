/**
 * SafetyPromptDialog Component
 *
 * Displays safety prompts when an agent encounters a non-git working directory.
 * Listens to the realtime store for incoming safety prompts and shows a modal
 * with options: proceed, init git, sandbox, or cancel.
 */

import { useState } from 'react'
import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { useRealtimeStore } from '@/stores/realtime-store'
import { cn } from '@/lib/utils'

/** Parse a plain-text warning into structured parts for rendering. */
function parseWarning(warning?: string): {
  headline: string
  body: string[]
  recommendations: string[]
  footer: string
} {
  if (!warning) return { headline: '', body: [], recommendations: [], footer: '' }

  const lines = warning.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return { headline: '', body: [], recommendations: [], footer: '' }

  // First line is the headline
  const headline = lines[0]

  const body: string[] = []
  const recommendations: string[] = []
  let footer = ''
  let inRecommendations = false

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue

    if (line.startsWith('Recommendations') || line.startsWith('Solutions')) {
      inRecommendations = true
      continue
    }

    if (inRecommendations) {
      // Check if this is the last line (footer like "Continue at your own risk.")
      if (i === lines.length - 1 && !line.match(/^\d/)) {
        footer = line
      } else {
        // Strip leading numbering like "1. " or "1) "
        recommendations.push(line.replace(/^\d+[.)]\s*/, ''))
      }
    } else {
      body.push(line)
    }
  }

  return { headline, body, recommendations, footer }
}

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
    if (!pendingPrompt || responding) return

    setResponding(true)
    setError(null)

    try {
      await respondToSafetyPrompt(pendingPrompt.taskId, 'cancel')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send response')
      setResponding(false)
    }
  }

  // Parse warning text into structured parts: headline, body lines, recommendations
  const warningParts = parseWarning(pendingPrompt?.warning)

  return (
    <Dialog
      open={!!pendingPrompt}
      onOpenChange={(open) => {
        if (!open && !responding) handleCancel()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/15">
              <ShieldAlert className="h-5 w-5 text-warning" />
            </div>
            <div>
              <DialogTitle className="text-base">Working Directory Review</DialogTitle>
              {warningParts.headline && (
                <p className="text-xs font-medium text-warning mt-0.5">
                  {warningParts.headline}
                </p>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Warning body */}
        {warningParts.body.length > 0 && (
          <div className="rounded-lg border border-warning/20 bg-warning/5 px-3.5 py-3 text-sm text-muted-foreground space-y-2">
            {warningParts.body.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
            {warningParts.recommendations.length > 0 && (
              <div className="pt-1">
                <p className="text-xs font-medium text-foreground mb-1">Recommendations</p>
                <ol className="list-decimal list-inside space-y-0.5 text-xs">
                  {warningParts.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ol>
              </div>
            )}
            {warningParts.footer && (
              <p className="text-xs font-medium text-warning flex items-center gap-1.5 pt-1">
                <AlertTriangle className="h-3 w-3" />
                {warningParts.footer}
              </p>
            )}
          </div>
        )}

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
                  className={cn(
                    "flex items-start space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors cursor-pointer",
                    selectedOption === option.id
                      ? "border-primary bg-primary/5"
                      : "border-border"
                  )}
                  onClick={() => setSelectedOption(option.id)}
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

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            disabled={responding}
            className="text-muted-foreground hover:text-destructive"
          >
            Cancel Task
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={responding || !selectedOption}
          >
            {responding ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                Sending...
              </>
            ) : (
              'Confirm'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
