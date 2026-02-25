/**
 * Command registry. Maps command names to handlers + provides autocomplete.
 */
import type { AstroClient } from '../client-adapter.js'
import { handlers } from './handlers.js'
import { PrefixTrie } from './autocomplete.js'
import { useTuiStore } from '../stores/tui-store.js'

// Build trie from handler keys
const trie = new PrefixTrie()
for (const key of Object.keys(handlers)) {
  trie.insert(key)
}

/**
 * Execute a command string. Parses the first word(s) as command name,
 * tries longest match first (e.g., "project list" before "project").
 */
export async function executeCommand(input: string, client: AstroClient): Promise<void> {
  const parts = input.split(/\s+/)

  // Try two-word command first (e.g., "project list")
  if (parts.length >= 2) {
    const twoWord = `${parts[0]} ${parts[1]}`
    if (handlers[twoWord]) {
      try {
        await handlers[twoWord](parts.slice(2), client)
      } catch (err) {
        useTuiStore.getState().setLastError(err instanceof Error ? err.message : String(err))
      }
      return
    }
  }

  // Try single-word command
  const cmd = parts[0]
  if (handlers[cmd]) {
    try {
      await handlers[cmd](parts.slice(1), client)
    } catch (err) {
      useTuiStore.getState().setLastError(err instanceof Error ? err.message : String(err))
    }
    return
  }

  useTuiStore.getState().setLastError(`Unknown command: ${cmd}`)
}

/**
 * Get autocomplete suggestions for a partial command.
 */
export function getCompletions(partial: string): string[] {
  return trie.search(partial)
}
