/**
 * Utility functions for detecting and extracting visualizer code fences
 * from markdown content.
 */

/**
 * Returns true if the text contains at least one ```visualizer code fence.
 */
export function isVisualizerFence(text: string): boolean {
  return /```visualizer\b/m.test(text)
}

/**
 * Extracts code from all ```visualizer fences in the given text.
 * Returns an array of code strings, one per fence.
 * Unclosed fences are ignored (not extracted).
 */
export function extractVisualizerCode(text: string): string[] {
  const results: string[] = []
  const regex = /```visualizer\b[^\n]*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    results.push(match[1])
  }
  return results
}
