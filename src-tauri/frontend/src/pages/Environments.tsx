/**
 * Environments — machine and environment management page (stub).
 */
import { useEffect, useState } from 'react'
import { Monitor, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import { getBaseUrl } from '@desktop/lib/api-client'

interface Machine {
  id: string
  name: string
  status: 'online' | 'offline'
  platform?: string
  lastSeen?: string
}

export function Environments() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)

  const loadMachines = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${getBaseUrl()}/api/relay/machines`)
      if (res.ok) {
        const data = await res.json()
        setMachines(Array.isArray(data) ? data : [])
      }
    } catch {
      // Relay may not be available
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadMachines()
  }, [])

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-[900px] w-full mx-auto px-8 py-8 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Environments
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Connected machines and compute environments
            </p>
          </div>
          <button
            onClick={() => void loadMachines()}
            disabled={loading}
            className={cn(
              'p-2 rounded-md text-muted-foreground',
              'hover:bg-muted hover:text-foreground transition-colors',
              loading && 'animate-spin',
            )}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {loading && machines.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Loading environments...
          </div>
        ) : machines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Monitor className="w-8 h-8 opacity-30" />
            <p className="text-sm">No machines connected</p>
            <p className="text-xs max-w-xs text-center">
              Register a machine by running the agent on your local machine, HPC cluster, or cloud instance.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {machines.map((machine) => (
              <div
                key={machine.id}
                className="flex items-center gap-3 p-4 rounded-xl border bg-card"
              >
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center',
                  machine.status === 'online' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
                )}>
                  {machine.status === 'online' ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{machine.name || machine.id}</p>
                  {machine.platform && (
                    <p className="text-[10px] text-muted-foreground">{machine.platform}</p>
                  )}
                </div>
                <span className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full font-medium',
                  machine.status === 'online' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
                )}>
                  {machine.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
