// Milestone color palette — same 6-color palette used in PlanGraph
export const MILESTONE_PALETTE = [
  { border: '#7c3aed', bg: 'rgba(124,58,237,0.08)', text: '#7c3aed', stripe: '#7c3aed' },
  { border: '#0891b2', bg: 'rgba(8,145,178,0.08)',  text: '#0891b2', stripe: '#0891b2' },
  { border: '#b45309', bg: 'rgba(180,83,9,0.08)',   text: '#b45309', stripe: '#b45309' },
  { border: '#be185d', bg: 'rgba(190,24,93,0.08)',  text: '#be185d', stripe: '#be185d' },
  { border: '#15803d', bg: 'rgba(21,128,61,0.08)',  text: '#15803d', stripe: '#15803d' },
  { border: '#1d4ed8', bg: 'rgba(29,78,216,0.08)',  text: '#1d4ed8', stripe: '#1d4ed8' },
] as const

export type MilestoneColor = { border: string; bg: string; text: string; stripe: string }

// Status dot colors (plain hex — CSS vars don't work in SVG/inline styles)
export const STATUS_DOT_COLOR: Record<string, string> = {
  planned:           '#94a3b8',
  in_progress:       '#60a5fa',
  dispatched:        '#93c5fd',
  completed:         '#22c55e',
  auto_verified:     '#4ade80',
  awaiting_approval: '#facc15',
  awaiting_judgment: '#fb923c',
  pruned:            '#cbd5e1',
}

// Priority pip colors
export const PRIORITY_PIP_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
}

// Edge color (slate-500, readable in light + dark)
export const GRAPH_EDGE_COLOR = '#64748b'

/** Generate a visually distinct color for any index using golden-angle HSL rotation. */
function generateMilestoneColor(idx: number): MilestoneColor {
  // Golden angle ~137.5° gives maximally distinct hues for any sequence length
  const hue = Math.round((idx * 137.508) % 360)
  const color = `hsl(${hue}, 65%, 40%)`
  const bg = `hsla(${hue}, 65%, 40%, 0.08)`
  return { border: color, bg, text: color, stripe: color }
}

/** Return a stable color for a milestone given its position in the ordered list.
 *  First 6 use the curated palette; beyond that, golden-angle HSL ensures no repeats. */
export function getMilestoneColor(milestoneId: string, orderedMilestoneIds: string[]): MilestoneColor | null {
  const idx = orderedMilestoneIds.indexOf(milestoneId)
  if (idx === -1) return null
  return idx < MILESTONE_PALETTE.length
    ? MILESTONE_PALETTE[idx]
    : generateMilestoneColor(idx)
}
