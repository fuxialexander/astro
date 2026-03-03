import { Globe } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

/**
 * Community Page
 *
 * Placeholder for community features like shared templates, user profiles, etc.
 */
export function Community() {
  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-primary font-semibold">Community</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <EmptyState
          icon={Globe}
          title="Community coming soon"
          description="Connect with other Astro users, share templates, and collaborate on projects."
          className="h-full"
        />
      </div>
    </div>
  )
}
