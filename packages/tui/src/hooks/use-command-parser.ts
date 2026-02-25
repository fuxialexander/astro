/**
 * Command parser hook. Parses `:` commands and delegates to handlers.
 */
import { useCallback } from 'react'
import { executeCommand, getCompletions } from '../commands/registry.js'
import type { AstroClient } from '../client-adapter.js'

export function useCommandParser(client: AstroClient) {
  const execute = useCallback(
    async (input: string) => {
      const trimmed = input.trim()
      if (!trimmed) return

      await executeCommand(trimmed, client)
    },
    [client],
  )

  const autocomplete = useCallback(
    (partial: string): string[] => {
      return getCompletions(partial)
    },
    [],
  )

  return { execute, autocomplete }
}
