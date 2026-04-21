interface MonthHeatOverlayProps {
  intensity: number // 0..1
}

export function MonthHeatOverlay({ intensity }: MonthHeatOverlayProps) {
  if (intensity <= 0) return null
  const opacity = 0.04 + intensity * 0.24
  return (
    <div
      aria-hidden
      className="cal-heat-overlay"
      style={{
        background: `color-mix(in srgb, var(--primary) ${Math.round(opacity * 100)}%, transparent)`,
      }}
    />
  )
}
