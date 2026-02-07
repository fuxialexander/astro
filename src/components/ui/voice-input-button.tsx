import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Mic, MicOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

export interface VoiceInputButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Whether currently recording */
  isRecording: boolean
  /** Whether transcription is in progress */
  isTranscribing: boolean
  /** Whether voice input is available */
  isAvailable: boolean
  /** Recording duration in seconds */
  duration?: number
  /** Click handler */
  onClick: () => void
  /** Size variant */
  size?: 'default' | 'sm' | 'icon'
  /** Show duration while recording */
  showDuration?: boolean
}

/**
 * Voice input button component that shows recording state and transcription progress.
 * Uses the microphone icon from lucide-react.
 */
export const VoiceInputButton = forwardRef<HTMLButtonElement, VoiceInputButtonProps>(
  (
    {
      isRecording,
      isTranscribing,
      isAvailable,
      duration = 0,
      onClick,
      size = 'icon',
      showDuration = true,
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const formatDuration = (seconds: number): string => {
      const mins = Math.floor(seconds / 60)
      const secs = seconds % 60
      return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const getTooltipContent = () => {
      if (!isAvailable) return 'Voice input not available'
      if (isTranscribing) return 'Transcribing...'
      if (isRecording) return 'Click to stop recording'
      return 'Click to start voice input'
    }

    const button = (
      <Button
        ref={ref}
        type="button"
        variant={isRecording ? 'destructive' : 'ghost'}
        size={size}
        onClick={onClick}
        disabled={disabled || !isAvailable || isTranscribing}
        className={cn(
          'relative transition-all',
          isRecording && 'animate-pulse',
          className
        )}
        {...props}
      >
        {isTranscribing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isRecording ? (
          <>
            <MicOff className="h-4 w-4" />
            {showDuration && duration > 0 && size !== 'icon' && (
              <span className="ml-1 text-xs font-mono">{formatDuration(duration)}</span>
            )}
          </>
        ) : isAvailable ? (
          <Mic className="h-4 w-4" />
        ) : (
          <MicOff className="h-4 w-4 text-muted-foreground" />
        )}

        {/* Recording indicator dot */}
        {isRecording && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </Button>
    )

    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {getTooltipContent()}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
)

VoiceInputButton.displayName = 'VoiceInputButton'
