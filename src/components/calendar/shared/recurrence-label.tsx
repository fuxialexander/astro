interface RecurrenceLabelProps {
  cronExpression: string
  timezone?: string
}

function parseCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 5) return expr

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  const days: Record<string, string> = {
    '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday',
    '4': 'Thursday', '5': 'Friday', '6': 'Saturday',
    'MON': 'Monday', 'TUE': 'Tuesday', 'WED': 'Wednesday',
    'THU': 'Thursday', 'FRI': 'Friday', 'SAT': 'Saturday', 'SUN': 'Sunday',
  }
  const months: Record<string, string> = {
    '1': 'January', '2': 'February', '3': 'March', '4': 'April',
    '5': 'May', '6': 'June', '7': 'July', '8': 'August',
    '9': 'September', '10': 'October', '11': 'November', '12': 'December',
  }

  // @daily / every day
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (hour !== '*' && minute !== '*') {
      const h = parseInt(hour)
      const m = parseInt(minute)
      const suffix = h < 12 ? 'AM' : 'PM'
      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
      const displayM = m === 0 ? '' : `:${String(m).padStart(2, '0')}`
      return `Every day at ${displayH}${displayM} ${suffix}`
    }
    return 'Every day'
  }

  // Specific weekday(s)
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const dayNames = dayOfWeek.split(',').map((d) => days[d.toUpperCase()] ?? d).join(', ')
    if (hour !== '*' && minute !== '*') {
      const h = parseInt(hour)
      const m = parseInt(minute)
      const suffix = h < 12 ? 'AM' : 'PM'
      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
      const displayM = m === 0 ? '' : `:${String(m).padStart(2, '0')}`
      return `Every ${dayNames} at ${displayH}${displayM} ${suffix}`
    }
    return `Every ${dayNames}`
  }

  // Mon-Fri
  if (dayOfWeek === '1-5' || dayOfWeek === 'MON-FRI') {
    if (hour !== '*' && minute !== '*') {
      const h = parseInt(hour)
      const m = parseInt(minute)
      const suffix = h < 12 ? 'AM' : 'PM'
      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
      const displayM = m === 0 ? '' : `:${String(m).padStart(2, '0')}`
      return `Every weekday at ${displayH}${displayM} ${suffix}`
    }
    return 'Every weekday'
  }

  // Specific month day
  if (dayOfMonth !== '*' && month !== '*') {
    const monthName = months[month] ?? month
    return `Every year on ${monthName} ${dayOfMonth}`
  }

  return expr
}

export function RecurrenceLabel({ cronExpression, timezone }: RecurrenceLabelProps) {
  const label = parseCron(cronExpression)
  return (
    <span className="text-xs text-muted-foreground">
      {label}
      {timezone && timezone !== 'UTC' && ` (${timezone})`}
    </span>
  )
}
