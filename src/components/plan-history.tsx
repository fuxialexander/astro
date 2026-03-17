import { useState } from "react"
import { useTranslation } from "react-i18next"
import { History, Undo2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { usePlanStore } from "@/stores/plan-store"

interface PlanHistoryProps {
  projectId: string
}

export function PlanHistory({ projectId }: PlanHistoryProps) {
  const { t } = useTranslation('plan')
  const [open, setOpen] = useState(false)
  const getArchivedPlanGroups = usePlanStore((s) => s.getArchivedPlanGroups)
  const restoreArchivedPlan = usePlanStore((s) => s.restoreArchivedPlan)
  const groups = getArchivedPlanGroups(projectId)

  if (groups.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          {t('history', 'Plan History')}
          <span className="text-xs opacity-60">({groups.length})</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-3 border-b">
          <h4 className="text-sm font-medium">{t('archivedPlans', 'Archived Plans')}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('archivedPlansDescription', 'Previous plan versions that were replaced during regeneration.')}
          </p>
        </div>
        <div className="max-h-60 overflow-y-auto">
          {groups.map((group) => (
            <div
              key={group.deletionActionId}
              className="flex items-start justify-between gap-2 p-3 border-b last:border-0 hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">
                  {group.archivedAt.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                <div className="text-sm mt-0.5">
                  {group.nodeCount} {t('tasks', { ns: 'common', defaultValue: 'tasks' })}
                </div>
                {group.titles.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {group.titles.join(', ')}
                    {group.nodeCount > 3 && '...'}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 h-7 gap-1 text-xs"
                onClick={() => {
                  restoreArchivedPlan(projectId, group.deletionActionId)
                  setOpen(false)
                }}
              >
                <Undo2 className="h-3 w-3" />
                {t('restore', { ns: 'common', defaultValue: 'Restore' })}
              </Button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
