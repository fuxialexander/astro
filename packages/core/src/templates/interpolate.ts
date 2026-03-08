import type { ResolvedParameters } from '../types/use-case-template.js'

/**
 * Interpolate template parameters into a prompt string.
 * Uses {{paramName}} mustache-style placeholders.
 *
 * When a parameter value is empty/undefined/whitespace-only, the entire line
 * containing that placeholder is removed (e.g. "- Paper Link: {{paperLink}}" → stripped).
 * This prevents ugly dangling labels like "- Paper Link: " in the output.
 *
 * After stripping, runs of 3+ consecutive newlines are collapsed to 2
 * to prevent large gaps in the resulting text.
 */
export function interpolatePrompt(prompt: string, parameters: ResolvedParameters): string {
  let result = prompt
  for (const [key, value] of Object.entries(parameters)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const escapedPlaceholder = `\\{\\{${escapedKey}\\}\\}`
    const stringValue = Array.isArray(value)
      ? value.join(', ')
      : value != null ? String(value) : ''

    if (!stringValue.trim()) {
      // Remove the entire line that contains this empty placeholder so we don't
      // leave behind dangling label lines like "- Paper Link: "
      result = result.replace(
        new RegExp(`[^\n]*${escapedPlaceholder}[^\n]*\n?`, 'g'),
        ''
      )
    } else {
      result = result.replace(new RegExp(escapedPlaceholder, 'g'), stringValue)
    }
  }
  // Collapse runs of 3+ newlines left after stripping
  result = result.replace(/\n{3,}/g, '\n\n')
  return result
}
