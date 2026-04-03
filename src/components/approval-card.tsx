/**
 * ApprovalCard — asymmetric design.
 *
 * Reject is small and immediately accessible at the top.
 * Approve is large and prominent at the bottom — requires intentional scroll.
 * This friction gradient reduces false-approvals on high-risk actions.
 */

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, X, AlertTriangle, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export interface ApprovalRequest {
  approvalId: string
  nodeId: string
  projectId: string
  executionId: string
  message: string
  options?: string[]
  timestamp: Date
}

interface ApprovalCardProps {
  approval: ApprovalRequest
  onRespond: (approvalId: string, approved: boolean, selectedOption?: string) => Promise<void>
  className?: string
}

export function ApprovalCard({ approval, onRespond, className }: ApprovalCardProps) {
  const { t } = useTranslation(["dialogs", "common"])
  const [selectedOption, setSelectedOption] = useState<string | undefined>(approval.options?.[0])
  const [responding, setResponding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApprove = async () => {
    setResponding(true)
    setError(null)
    try {
      if (approval.options) {
        await onRespond(approval.approvalId, true, selectedOption)
      } else {
        await onRespond(approval.approvalId, true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to respond")
      setResponding(false)
    }
  }

  const handleReject = async () => {
    setResponding(true)
    setError(null)
    try {
      await onRespond(approval.approvalId, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to respond")
      setResponding(false)
    }
  }

  return (
    <div className={cn("rounded-xl border border-warning/30 bg-card overflow-hidden", className)}>
      {/* Top bar: small reject — friction-free, immediately reachable */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-muted/[0.03]">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-warning/15">
            <AlertTriangle className="h-3 w-3 text-warning" />
          </div>
          <span className="text-[11px] font-semibold text-warning tracking-wide uppercase">
            {t("approval.title", { ns: "dialogs" })}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReject}
          disabled={responding}
          className="h-6 text-[11px] px-2.5 gap-1 text-muted-foreground/60 hover:text-error hover:bg-error/5 border border-border/40"
        >
          <X className="h-3 w-3" />
          {t("approval.reject", { ns: "dialogs" })}
        </Button>
      </div>

      {/* Body: context for the decision */}
      <div className="flex flex-col gap-3 px-4 py-4">
        <p className="text-sm text-foreground/80 leading-relaxed">{approval.message}</p>

        {/* Multi-choice options */}
        {approval.options && approval.options.length > 0 && (
          <RadioGroup
            value={selectedOption}
            onValueChange={setSelectedOption}
            className="flex flex-col gap-2 mt-1"
          >
            {approval.options.map((option, i) => (
              <div
                key={option}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors cursor-pointer",
                  selectedOption === option
                    ? "border-primary/40 bg-primary/[0.03]"
                    : "border-border/40 hover:bg-muted/30"
                )}
              >
                <RadioGroupItem value={option} id={`opt-${approval.approvalId}-${i}`} />
                <Label htmlFor={`opt-${approval.approvalId}-${i}`} className="flex-1 cursor-pointer text-sm font-normal">
                  {option}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}

        {error && (
          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Scroll cue — nudges user to see the full context before approving */}
        <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground/30 mt-1">
          <ChevronDown className="h-3 w-3" />
          <span>review before approving</span>
          <ChevronDown className="h-3 w-3" />
        </div>
      </div>

      {/* Bottom: large approve button — requires scroll, intentional click */}
      <div className="px-4 pb-4">
        <Button
          onClick={handleApprove}
          disabled={responding || (!!approval.options && !selectedOption)}
          className="w-full h-10 gap-2 font-semibold text-sm"
        >
          <Check className="h-4 w-4" />
          {responding
            ? t("approval.approving", { ns: "dialogs" })
            : approval.options
              ? t("confirm", { ns: "common" })
              : t("approval.approve", { ns: "dialogs" })}
        </Button>
      </div>
    </div>
  )
}
