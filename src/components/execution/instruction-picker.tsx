/**
 * Instruction Picker — the [🔧] button next to machine chips.
 *
 * Single-select popover: lists all machine instructions, shows which one
 * is assigned as default for the given machine. Click to assign/change.
 */

import { useState } from "react"
import { ScrollText, Check, Plus, ChevronDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useMachineInstructionStore } from "@/stores/machine-instruction-store"
import { cn } from "@/lib/utils"
import type { MachineInstruction } from "@/types"

interface InstructionPickerProps {
  machineId?: string
  currentInstructionId?: string | null
  onSelect: (instructionId: string | null) => void
  onCreateNew?: () => void
  compact?: boolean
  className?: string
}

export function InstructionPicker({
  currentInstructionId,
  onSelect,
  onCreateNew,
  compact = true,
  className,
}: InstructionPickerProps) {
  const [open, setOpen] = useState(false)
  const instructions = useMachineInstructionStore((s) => s.instructions)

  const currentInstruction = instructions.find((i) => i.id === currentInstructionId)
  const hasOverride = !!currentInstructionId

  const handleSelect = (instruction: MachineInstruction | null) => {
    onSelect(instruction?.id ?? null)
    setOpen(false)
  }

  if (compact) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center justify-center rounded-md p-1 transition-colors cursor-pointer",
                    hasOverride
                      ? "text-primary hover:bg-primary/10"
                      : "text-muted-foreground hover:bg-muted",
                    className,
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ScrollText className="h-3.5 w-3.5" />
                  {hasOverride && (
                    <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">
                {currentInstruction ? `Instruction: ${currentInstruction.name}` : "Select compute instruction"}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <InstructionPickerContent
          instructions={instructions}
          currentInstructionId={currentInstructionId}
          onSelect={handleSelect}
          onCreateNew={onCreateNew}
        />
      </Popover>
    )
  }

  // Expanded mode — shows instruction name in button
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors cursor-pointer",
            hasOverride
              ? "border-primary/30 bg-primary/5 text-primary"
              : "border-border hover:bg-muted text-muted-foreground",
            className,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <ScrollText className="h-3 w-3" />
          <span className="max-w-[150px] truncate">
            {currentInstruction?.name ?? "No instruction"}
          </span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <InstructionPickerContent
        instructions={instructions}
        currentInstructionId={currentInstructionId}
        onSelect={handleSelect}
        onCreateNew={onCreateNew}
      />
    </Popover>
  )
}

function InstructionPickerContent({
  instructions,
  currentInstructionId,
  onSelect,
  onCreateNew,
}: {
  instructions: MachineInstruction[]
  currentInstructionId?: string | null
  onSelect: (instruction: MachineInstruction | null) => void
  onCreateNew?: () => void
}) {
  return (
    <PopoverContent className="w-56 p-1" align="start">
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
        Compute Instruction
      </p>

      {/* "None" option */}
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted transition-colors",
          !currentInstructionId && "bg-accent/50",
        )}
        onClick={() => onSelect(null)}
      >
        <span className="flex-1 text-left text-muted-foreground">None</span>
        {!currentInstructionId && <Check className="h-3.5 w-3.5 text-primary" />}
      </button>

      {instructions.length > 0 && <div className="my-0.5 h-px bg-border" />}

      {/* Instruction list */}
      {instructions.map((instruction) => {
        const selected = instruction.id === currentInstructionId
        return (
          <button
            key={instruction.id}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted transition-colors",
              selected && "bg-accent/50",
            )}
            onClick={() => onSelect(instruction)}
          >
            <div className="flex-1 text-left min-w-0">
              <div className="font-medium truncate">{instruction.name}</div>
              {instruction.tags.length > 0 && (
                <div className="flex gap-1 mt-0.5">
                  {instruction.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="inline-block rounded bg-muted px-1 py-0 text-[10px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </button>
        )
      })}

      {/* Create new */}
      {onCreateNew && (
        <>
          <div className="my-0.5 h-px bg-border" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
            onClick={onCreateNew}
          >
            <Plus className="h-3.5 w-3.5" />
            Create New
          </button>
        </>
      )}
    </PopoverContent>
  )
}
