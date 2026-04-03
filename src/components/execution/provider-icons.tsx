/* eslint-disable react-refresh/only-export-components */
/**
 * Provider-specific icons for the AI agent dropdown.
 *
 * Claude and OpenAI use simplified SVG logos.
 * Others use compact text abbreviations.
 */

import { Bot } from "lucide-react"
import { cn } from "@/lib/utils"

interface ProviderIconProps {
  className?: string
}

function ClaudeIcon({ className }: ProviderIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M16.273 12.845 12.849 3.908c-.354-.926-1.344-.926-1.698 0L7.727 12.845c-.176.46-.062.791.149 1.058.21.267.63.49 1.162.49h5.924c.532 0 .952-.223 1.162-.49.21-.267.325-.598.149-1.058ZM12 20.092l-2.5-6.534h5l-2.5 6.534Z" />
    </svg>
  )
}

function OpenAIIcon({ className }: ProviderIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073ZM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494ZM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646ZM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872Zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667Zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66ZM8.392 12.66l-2.02-1.164a.08.08 0 0 1-.038-.057V5.849a4.494 4.494 0 0 1 7.375-3.453l-.142.08L8.794 5.23a.795.795 0 0 0-.393.676l-.009 6.755Zm1.1-2.366 2.6-1.502 2.6 1.502v2.999l-2.6 1.502-2.6-1.502Z" />
    </svg>
  )
}

function TextIcon({ text, className }: ProviderIconProps & { text: string }) {
  return (
    <span className={cn("font-bold text-[9px] leading-none uppercase select-none", className)}>
      {text}
    </span>
  )
}

/**
 * Returns the appropriate icon element for a provider ID.
 */
export function getProviderIcon(providerId: string, className?: string): React.ReactNode {
  switch (providerId) {
    case "claude-sdk":
      return <ClaudeIcon className={className} />
    case "codex":
      return <OpenAIIcon className={className} />
    case "pi":
      return <TextIcon text="pi" className={className} />
    case "openclaw":
      return <TextIcon text="oc" className={className} />
    case "opencode":
      return <TextIcon text="oc" className={className} />
    default:
      return <Bot className={className} />
  }
}

