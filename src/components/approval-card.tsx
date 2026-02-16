/**
 * ApprovalCard Component
 *
 * Displays approval requests with options for user response.
 * Supports both binary (approve/reject) and multi-choice approvals.
 */

import { useState } from 'react'
import { Check, X, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface ApprovalRequest {
  approvalId: string
  nodeId: string
  projectId: string
  executionId: string
  message: string
  options?: string[] // If present, show multi-choice; if absent, show binary approve/reject
  timestamp: Date
}

interface ApprovalCardProps {
  approval: ApprovalRequest
  onRespond: (approvalId: string, approved: boolean, selectedOption?: string) => Promise<void>
  className?: string
}

export function ApprovalCard({ approval, onRespond, className }: ApprovalCardProps) {
  const [selectedOption, setSelectedOption] = useState<string | undefined>(
    approval.options?.[0]
  )
  const [responding, setResponding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApprove = async () => {
    setResponding(true)
    setError(null)
    try {
      if (approval.options) {
        // Multi-choice approval - send selected option
        await onRespond(approval.approvalId, true, selectedOption)
      } else {
        // Binary approval - just approve
        await onRespond(approval.approvalId, true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to respond')
      setResponding(false)
    }
  }

  const handleReject = async () => {
    setResponding(true)
    setError(null)
    try {
      await onRespond(approval.approvalId, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to respond')
      setResponding(false)
    }
  }

  return (
    <Card className={cn('rounded-2xl shadow-lg border-warning/40', className)}>
      <CardContent className="flex flex-col gap-0 p-0">
        {/* Header */}
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning">
              <AlertCircle className="h-4 w-4 text-warning-foreground" />
            </div>
            <p className="text-base font-semibold text-foreground">Approval Required</p>
          </div>

          <p className="text-sm text-muted-foreground">{approval.message}</p>

          {/* Multi-choice options */}
          {approval.options && approval.options.length > 0 && (
            <RadioGroup
              value={selectedOption}
              onValueChange={setSelectedOption}
              className="flex flex-col gap-2 mt-2"
            >
              {approval.options.map((option, index) => (
                <div
                  key={option}
                  className="flex items-center space-x-2 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <RadioGroupItem value={option} id={`option-${index}`} />
                  <Label
                    htmlFor={`option-${index}`}
                    className="flex-1 cursor-pointer text-sm font-normal"
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

        {/* Actions */}
        <div className="flex gap-2 border-t px-5 py-4">
          {approval.options ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReject}
                disabled={responding}
                className="flex-1"
              >
                <X className="h-4 w-4 mr-1.5" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={responding || !selectedOption}
                className="flex-1"
              >
                <Check className="h-4 w-4 mr-1.5" />
                {responding ? 'Confirming...' : 'Confirm'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReject}
                disabled={responding}
                className="flex-1"
              >
                <X className="h-4 w-4 mr-1.5" />
                Reject
              </Button>
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={responding}
                className="flex-1"
              >
                <Check className="h-4 w-4 mr-1.5" />
                {responding ? 'Approving...' : 'Approve'}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
