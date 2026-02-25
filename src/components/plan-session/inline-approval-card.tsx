/**
 * Inline Approval Card for plan session chat timeline.
 *
 * Renders a compact decision card inline in the activity stream.
 * Shows radio options when pending, answered state after response.
 * Includes an "Other" option for custom free-text answers.
 */

import { useState, useRef, useEffect } from "react"
import { Check, MessageCircleQuestion } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const OTHER_SENTINEL = "__other__"

interface InlineApprovalCardProps {
  requestId: string
  question: string
  options: string[]
  answered?: boolean
  answer?: string
  onRespond: (requestId: string, answer: string) => Promise<void>
}

export function InlineApprovalCard({
  requestId,
  question,
  options,
  answered,
  answer,
  onRespond,
}: InlineApprovalCardProps) {
  const [selectedOption, setSelectedOption] = useState<string>(options[0] || "")
  const [customText, setCustomText] = useState("")
  const [responding, setResponding] = useState(false)
  const customInputRef = useRef<HTMLInputElement>(null)

  const isOther = selectedOption === OTHER_SENTINEL

  // Focus the custom input when "Other" is selected
  useEffect(() => {
    if (isOther) {
      customInputRef.current?.focus()
    }
  }, [isOther])

  const effectiveAnswer = isOther ? customText.trim() : selectedOption

  const handleSubmit = async () => {
    if (!effectiveAnswer || responding) return
    setResponding(true)
    try {
      await onRespond(requestId, effectiveAnswer)
    } catch {
      setResponding(false)
    }
  }

  if (answered) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-success/30 bg-success/5 p-3">
        <div className="flex items-start gap-2">
          <Check className="h-4 w-4 mt-0.5 shrink-0 text-success" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground mb-1">{question}</p>
            <p className="text-sm font-medium text-foreground">{answer}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-4 my-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <div className="flex items-start gap-2 mb-3">
        <MessageCircleQuestion className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
        <p className="text-sm font-medium text-foreground">{question}</p>
      </div>

      <RadioGroup
        value={selectedOption}
        onValueChange={setSelectedOption}
        className="flex flex-col gap-1.5 mb-3"
      >
        {options.map((option, index) => (
          <div
            key={option}
            className={cn(
              "flex items-center space-x-2 rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors",
              selectedOption === option && "border-primary bg-primary/5"
            )}
          >
            <RadioGroupItem value={option} id={`approval-${requestId}-${index}`} />
            <Label
              htmlFor={`approval-${requestId}-${index}`}
              className="flex-1 cursor-pointer text-sm font-normal"
            >
              {option}
            </Label>
          </div>
        ))}
        {/* Other option with custom text input */}
        <div
          className={cn(
            "flex items-center space-x-2 rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors",
            isOther && "border-primary bg-primary/5"
          )}
        >
          <RadioGroupItem value={OTHER_SENTINEL} id={`approval-${requestId}-other`} />
          <Label
            htmlFor={`approval-${requestId}-other`}
            className="cursor-pointer text-sm font-normal shrink-0"
          >
            Other:
          </Label>
          <input
            ref={customInputRef}
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onFocus={() => setSelectedOption(OTHER_SENTINEL)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="Type your answer..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </RadioGroup>

      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={responding || !effectiveAnswer}
        className="w-full"
      >
        <Check className="h-3.5 w-3.5 mr-1.5" />
        {responding ? "Sending..." : "Confirm"}
      </Button>
    </div>
  )
}
