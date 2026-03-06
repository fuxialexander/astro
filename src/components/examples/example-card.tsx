import { FileText, MoreVertical, Pencil, Trash2, User } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { UseCaseTemplateSummary } from "@astro/core/templates"
import { cn } from "@/lib/utils"

interface ExampleCardProps {
  template: UseCaseTemplateSummary & {
    isOwner?: boolean
    canEdit?: boolean
  }
  onClick?: (template: UseCaseTemplateSummary) => void
  onEdit?: (template: UseCaseTemplateSummary) => void
  onDelete?: (template: UseCaseTemplateSummary) => void
}

// Category display names
const categoryLabels: Record<string, string> = {
  'software-development': 'Development',
  'data-science': 'Data Science',
  'machine-learning': 'ML',
  'devops-infrastructure': 'DevOps',
  'research-analysis': 'Research',
  'documentation': 'Docs',
  'testing-qa': 'Testing',
  'security': 'Security',
  'computational-biology': 'Bio',
  'custom': 'Custom',
}

// Maturity badge styling
const maturityConfig: Record<string, { label: string; className: string }> = {
  stable: { label: 'Stable', className: 'bg-success/10 text-success' },
  beta: { label: 'Beta', className: 'bg-warning/10 text-warning' },
  experimental: { label: 'Experimental', className: 'bg-info/10 text-info' },
}

// Parameter count to difficulty mapping
function getDifficultyFromParams(count: number): { label: string; className: string } {
  if (count <= 2) return { label: 'Easy', className: 'text-success' }
  if (count <= 5) return { label: 'Medium', className: 'text-warning' }
  return { label: 'Advanced', className: 'text-error' }
}

export function ExampleCard({ template, onClick, onEdit, onDelete }: ExampleCardProps) {
  const maturity = template.maturity ?? 'stable'
  const maturityStyle = maturityConfig[maturity] ?? maturityConfig.stable
  const difficulty = getDifficultyFromParams(template.parameterCount)
  const categoryLabel = categoryLabels[template.category] ?? template.category
  const isCustom = template.source === 'custom'
  const canEdit = template.canEdit ?? false
  const isOwner = template.isOwner ?? false

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit?.(template)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete?.(template)
  }

  return (
    <Card
      className={cn(
        "p-4 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer flex flex-col gap-3",
        "bg-card text-card-foreground group"
      )}
      onClick={() => onClick?.(template)}
    >
      {/* Header: Icon + Name + Maturity Badge + Actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted shrink-0 relative">
            {template.icon ? (
              <span className="text-xl">{template.icon}</span>
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground" />
            )}
            {isCustom && (
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary flex items-center justify-center">
                <User className="h-2 w-2 text-primary-foreground" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold truncate">{template.name}</h3>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {maturity !== 'stable' && (
            <Badge className={cn("text-[10px] border-0 px-1.5 py-0", maturityStyle.className)}>
              {maturityStyle.label}
            </Badge>
          )}
          {isCustom && canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleEdit}>
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  Edit Template
                </DropdownMenuItem>
                {isOwner && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleDelete}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Delete Template
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Description (truncated 2 lines) */}
      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
        {template.description}
      </p>

      {/* Footer: Category + Difficulty + Tags */}
      <div className="flex items-center gap-2 flex-wrap mt-auto">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {categoryLabel}
        </Badge>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          <span className={cn("font-medium", difficulty.className)}>
            {difficulty.label}
          </span>
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          {template.parameterCount} {template.parameterCount === 1 ? 'param' : 'params'}
        </span>
        {template.tags && template.tags.length > 0 && (
          <>
            <span className="text-muted-foreground/40">&middot;</span>
            {template.tags.slice(0, 2).map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="text-[10px] px-1.5 py-0"
              >
                {tag}
              </Badge>
            ))}
            {template.tags.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{template.tags.length - 2}
              </span>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
