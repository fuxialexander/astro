interface MonthHeatOverlayProps {
  intensity: number // 0..1
}

export function MonthHeatOverlay({ intensity }: MonthHeatOverlayProps) {
  if (intensity <= 0) return null
  const pct = Math.round(15 + intensity * 50)
  return (
    <div
      aria-hidden
      className="cal-heat-overlay"
      style={{
        background: `color-mix(in srgb, #F97316 ${pct}%, transparent)`,
      }}
    />
  )
}
