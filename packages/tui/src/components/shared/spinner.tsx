import React, { useState, useEffect } from 'react'
import { Text } from 'ink'

const FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F']

interface SpinnerProps {
  label?: string
}

export function Spinner({ label }: SpinnerProps) {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length)
    }, 80)
    return () => clearInterval(timer)
  }, [])

  return (
    <Text color="cyan">
      {FRAMES[frame]}{label ? ` ${label}` : ''}
    </Text>
  )
}
