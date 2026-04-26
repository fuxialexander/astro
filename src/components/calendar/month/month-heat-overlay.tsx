interface MonthHeatOverlayProps {
  intensity: number // 0..1
}

export function MonthHeatOverlay({ intensity }: MonthHeatOverlayProps) {
  if (intensity <= 0) return null
  const pct = Math.round(8 + intensity * 24)
  return (
    <div
      aria-hidden
      className="cal-heat-overlay"
      style={{
        background: `color-mix(in srgb, #60A5FA ${pct}%, transparent)`,
      }}
    />
  )
}
