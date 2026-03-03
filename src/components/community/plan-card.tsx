import { Star, GitFork, Layers } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { useNavigate } from "react-router"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { SharedPlanSummary } from "@/lib/community-client"

interface PlanCardProps {
  plan: SharedPlanSummary
}

/**
 * CommunityPlanCard Component
 *
 * Displays a summary card for a community plan with:
 * - Title and description (truncated to 2 lines)
 * - Author name (or 'Anonymous')
 * - Category badge
 * - Tags as small badges
 * - Star count, fork count, and node count indicators
 * - Relative date (e.g., "2 days ago")
 * - Hover effect with shadow transition
 * - Click navigation to plan detail page
 */
export function PlanCard({ plan }: PlanCardProps) {
  const navigate = useNavigate()

  // Node count is not available in summary view, will be shown as 0
  const nodeCount = 0

  const handleClick = () => {
    navigate(`/community/plans/${plan.id}`)
  }

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={handleClick}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg line-clamp-1">{plan.title}</CardTitle>
          {plan.category && (
            <Badge variant="secondary" className="shrink-0">
              {plan.category}
            </Badge>
          )}
        </div>
        <CardDescription className="line-clamp-2">
          {plan.description || "No description provided"}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* Author */}
        <div className="text-sm text-muted-foreground mb-3">
          by {plan.isAnonymous ? 'Anonymous' : (plan.authorName || 'Anonymous')}
        </div>

        {/* Tags */}
        {plan.tags && plan.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {plan.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Star className="h-4 w-4" />
            <span>{plan.starsCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <GitFork className="h-4 w-4" />
            <span>{plan.forksCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Layers className="h-4 w-4" />
            <span>{nodeCount}</span>
          </div>
          <div className="ml-auto text-xs">
            {formatDistanceToNow(new Date(plan.createdAt), { addSuffix: true })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
