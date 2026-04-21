/**
 * DynamicApprovalDialog Component
 *
 * Displays dynamic approval requests from agents (AskUserQuestion tool).
 * Listens to the realtime store for incoming approval requests and shows a modal.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { Checkbox } from '@/components/ui/checkbox'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { useRealtimeStore } from '@/stores/realtime-store'

// ── Reference Suggestion Types ────────────────────────────────────────
interface ReferenceSuggestion {
  citeKey: string
  title: string
  authors: string[]
  year: number
  doi?: string
  venue?: string
}

interface ReferenceSuggestionsPayload {
  message: string
  references: ReferenceSuggestion[]
}

function parseReferenceSuggestions(question: string): ReferenceSuggestionsPayload | null {
  if (!question.startsWith('REFERENCE_SUGGESTIONS:')) return null
  try {
    const jsonStr = question.slice('REFERENCE_SUGGESTIONS:'.length).trim()
    return JSON.parse(jsonStr) as ReferenceSuggestionsPayload
  } catch {
    return null
  }
}

// ── Reference Suggestions UI ──────────────────────────────────────────
function ReferenceSuggestionsContent({
  payload,
  selectedKeys,
  onToggle,
  onSelectAll,
  onSelectNone,
}: {
  payload: ReferenceSuggestionsPayload
  selectedKeys: Set<string>
  onToggle: (key: string) => void
  onSelectAll: () => void
  onSelectNone: () => void
}) {
  const allSelected = payload.references.length > 0 && selectedKeys.size === payload.references.length
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{payload.message}</p>
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={allSelected ? onSelectNone : onSelectAll}
        >
          {allSelected ? 'Select none' : 'Select all'}
        </button>
        <span className="text-muted-foreground">{selectedKeys.size} / {payload.references.length} selected</span>
      </div>
      <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
        {payload.references.map((ref) => (
          <div
            key={ref.citeKey}
            className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors cursor-pointer"
            onClick={() => onToggle(ref.citeKey)}
          >
            <Checkbox
              id={`ref-${ref.citeKey}`}
              checked={selectedKeys.has(ref.citeKey)}
              onCheckedChange={() => onToggle(ref.citeKey)}
              className="mt-0.5 shrink-0"
            />
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-semibold leading-snug">{ref.title}</span>
              <span className="text-xs text-muted-foreground">
                {ref.authors.join(', ')}{ref.year ? ` (${ref.year})` : ''}{ref.venue ? ` — ${ref.venue}` : ''}
              </span>
              <span className="text-xs font-mono text-muted-foreground">{ref.citeKey}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DynamicApprovalDialog() {
  const { t } = useTranslation(['dialogs', 'common'])
  const dynamicApprovals = useRealtimeStore((s) => s.dynamicApprovals)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)

  // Get the first pending approval (FIFO)
  const pendingApproval = dynamicApprovals.size > 0
    ? Array.from(dynamicApprovals.values())[0]
    : null

  // Detect reference suggestion mode
  const refSuggestions = pendingApproval?.question
    ? parseReferenceSuggestions(pendingApproval.question)
    : null

  // Track previous requestId to detect approval changes
  const [prevRequestId, setPrevRequestId] = useState<string | undefined>()
  const [selectedOption, setSelectedOption] = useState<string | undefined>()
  const [selectedRefKeys, setSelectedRefKeys] = useState<Set<string>>(new Set())
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
      // Pre-select all references
      if (refSuggestions) {
        setSelectedRefKeys(new Set(refSuggestions.references.map((r) => r.citeKey)))
      } else {
        setSelectedRefKeys(new Set())
      }
    }
  }

  const handleToggleRef = (key: string) => {
    setSelectedRefKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSelectAllRefs = () => {
    if (refSuggestions) {
      setSelectedRefKeys(new Set(refSuggestions.references.map((r) => r.citeKey)))
    }
  }

  const handleSelectNoneRefs = () => {
    setSelectedRefKeys(new Set())
  }

  const handleConfirm = async () => {
    if (!pendingApproval) return

    setResponding(true)
    setError(null)

    try {
      let responseValue: string
      if (refSuggestions) {
        const selected = Array.from(selectedRefKeys)
        responseValue = selected.length > 0
          ? JSON.stringify({ selected })
          : 'none'
      } else {
        if (!selectedOption) return
        responseValue = selectedOption
      }
      await respondToDynamicApproval(
        pendingApproval.taskId,
        pendingApproval.requestId,
        responseValue
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
      const cancelValue = refSuggestions ? 'none' : 'Other'
      await respondToDynamicApproval(
        pendingApproval.taskId,
        pendingApproval.requestId,
        cancelValue
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send response')
      setResponding(false)
    }
  }

  const isConfirmDisabled = responding || (refSuggestions ? false : !selectedOption)

  return (
    <Dialog open={!!pendingApproval} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning">
              <AlertCircle className="h-5 w-5 text-warning-foreground" />
            </div>
            <DialogTitle className="text-xl">{t('approval.agentQuestion', { ns: 'dialogs' })}</DialogTitle>
          </div>
          {!refSuggestions && (
            <DialogDescription asChild className="text-base">
              <div>{pendingApproval?.question && <MarkdownRenderer content={pendingApproval.question} className="text-sm" />}</div>
            </DialogDescription>
          )}
        </DialogHeader>

        {pendingApproval && (
          <div className="space-y-4">
            {refSuggestions ? (
              <ReferenceSuggestionsContent
                payload={refSuggestions}
                selectedKeys={selectedRefKeys}
                onToggle={handleToggleRef}
                onSelectAll={handleSelectAllRefs}
                onSelectNone={handleSelectNoneRefs}
              />
            ) : (
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
            )}

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
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
          >
            <Check className="h-4 w-4 mr-1.5" />
            {responding ? t('approval.confirming', { ns: 'dialogs' }) : t('confirm', { ns: 'common' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
