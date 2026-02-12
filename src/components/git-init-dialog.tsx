import { Button } from '@/components/ui/button'
import type { GitInitPrompt } from '@/hooks/use-repo-setup'

export function GitInitDialog({
  prompt,
  onConfirm,
  onDismiss,
}: {
  prompt: GitInitPrompt | null
  onConfirm: () => void
  onDismiss: () => void
}) {
  if (!prompt) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-lg max-w-md">
        <h3 className="text-sm font-semibold">Initialize Git Repository?</h3>
        <p className="text-sm text-muted-foreground">
          The directory <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{prompt.dir}</code> is not a git repository. Initialize one?
        </p>
        <p className="text-xs text-muted-foreground">
          This will create a .gitignore, CLAUDE.md, and make an initial commit.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onDismiss}>
            Skip
          </Button>
          <Button size="sm" onClick={onConfirm}>
            Initialize
          </Button>
        </div>
      </div>
    </div>
  )
}
