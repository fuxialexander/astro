import type { JSX } from "react"
import { cn } from "@/lib/utils"

export function AppIcon({ appId, className }: { appId: string; className?: string }): JSX.Element {
  return <img src={`/app-icons/${appId}.png`} alt="" className={cn("rounded-[3px]", className)} draggable={false} />
}
