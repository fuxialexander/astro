import { Home, ChevronRight } from "lucide-react"
import type { CommandItem } from "@/types"

interface BreadcrumbsProps {
  items: CommandItem[]
  onNavigate: (index: number) => void
}

export function Breadcrumbs({ items, onNavigate }: BreadcrumbsProps) {
  if (items.length === 0) return null

  return (
    <div className="breadcrumbs">
      <button
        className="breadcrumb-item"
        onClick={() => onNavigate(-1)}
        title="Go to root"
      >
        <Home className="w-3.5 h-3.5" />
      </button>

      {items.map((item, index) => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ChevronRight className="w-3 h-3" style={{ color: 'var(--cp-text-tertiary)' }} />

          {index === items.length - 1 ? (
            <span className="breadcrumb-current">{item.label}</span>
          ) : (
            <button
              className="breadcrumb-item"
              onClick={() => onNavigate(index)}
            >
              {item.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
