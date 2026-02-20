/**
 * GTD Workflow Page
 *
 * A Getting Things Done workflow view contributed by the GTD plugin.
 */

export function GtdPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">GTD Workflow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Getting Things Done workflow for organizing and prioritizing tasks
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Inbox */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3">Inbox</h2>
          <p className="text-xs text-muted-foreground">
            Capture new items here. Process them into contexts and projects.
          </p>
          <div className="mt-4 flex flex-col items-center justify-center py-8 text-muted-foreground">
            <span className="text-sm">No items in inbox</span>
          </div>
        </div>

        {/* Next Actions */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3">Next Actions</h2>
          <p className="text-xs text-muted-foreground">
            Tasks flagged as next actions, grouped by context.
          </p>
          <div className="mt-4 flex flex-col items-center justify-center py-8 text-muted-foreground">
            <span className="text-sm">No next actions</span>
          </div>
        </div>

        {/* Waiting For */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3">Waiting For</h2>
          <p className="text-xs text-muted-foreground">
            Items delegated or waiting on external input.
          </p>
          <div className="mt-4 flex flex-col items-center justify-center py-8 text-muted-foreground">
            <span className="text-sm">Nothing waiting</span>
          </div>
        </div>
      </div>
    </div>
  )
}
