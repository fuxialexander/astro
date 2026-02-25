import React from 'react'
import { Text } from 'ink'
import { getStatusColor, getStatusSymbol } from '../../lib/status-colors.js'

interface StatusBadgeProps {
  status: string
  showSymbol?: boolean
}

export function StatusBadge({ status, showSymbol = true }: StatusBadgeProps) {
  const color = getStatusColor(status)
  const symbol = showSymbol ? getStatusSymbol(status) + ' ' : ''
  return (
    <Text color={color}>{symbol}[{status}]</Text>
  )
}
