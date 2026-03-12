import { useState, useMemo } from 'react'
import { Clock, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

import { formatRelativeTime } from '@/lib/date-utils'
import {
  useRecentWorkdirs,
  parseMachineWorkdir,
  type RecentWorkdir,
} from '@/hooks/use-recent-workdirs'

interface RecentWorkdirPopoverProps {
  machineId?: string
  onSelect: (selection: { machineId: string; workingDirectory: string }) => void
  disabled?: boolean
}

export function RecentWorkdirPopover({
  machineId,
  onSelect,
  disabled,
}: RecentWorkdirPopoverProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const recentWorkdirs = useRecentWorkdirs(machineId)

  const parsed = useMemo(() => parseMachineWorkdir(filter.trim()), [filter])

  const filtered = useMemo(() => {
    if (!filter.trim()) return recentWorkdirs
    const q = filter.toLowerCase()
    return recentWorkdirs.filter(
      (w) =>
        w.workingDirectory.toLowerCase().includes(q) ||
        w.machineName.toLowerCase().includes(q)
    )
  }, [recentWorkdirs, filter])

  function handleSelect(item: RecentWorkdir) {
    onSelect({ machineId: item.machineId, workingDirectory: item.workingDirectory })
    setOpen(false)
    setFilter('')
  }

  function handleParsedSelect() {
    if (!parsed) return
    // Resolve machine name to ID from the workdirs list, or use the raw string as ID
    const match = recentWorkdirs.find(
      (w) => w.machineName.toLowerCase() === parsed.machine.toLowerCase()
    )
    onSelect({
      machineId: match?.machineId ?? parsed.machine,
      workingDirectory: parsed.path,
    })
    setOpen(false)
    setFilter('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="Recent working directories"
          className="shrink-0 rounded-md border border-border p-1.5 hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Clock className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter or paste machine:path..."
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            autoFocus
          />
        </div>

        {/* Items list */}
        <div className="max-h-64 overflow-y-auto p-1">
          {/* Parsed machine:path option */}
          {parsed && parsed.path && (
            <button
              type="button"
              onClick={handleParsedSelect}
              className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-primary">
                  Use custom path
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono text-foreground truncate">
                  {parsed.path}
                </code>
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {parsed.machine}
                </span>
              </div>
            </button>
          )}

          {filtered.length === 0 && !parsed && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              No recent working directories
            </div>
          )}

          {filtered.map((item) => (
            <button
              key={`${item.machineId}|${item.workingDirectory}`}
              type="button"
              onClick={() => handleSelect(item)}
              className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <code className="text-xs font-mono text-foreground truncate">
                  {item.workingDirectory}
                </code>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {item.machineName}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatRelativeTime(new Date(item.lastUsedAt))}
                </span>
                {item.useCount > 1 && (
                  <span className="text-[10px] text-muted-foreground">
                    ({item.useCount}x)
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
