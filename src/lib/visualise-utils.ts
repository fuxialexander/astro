/**
 * Utility functions for detecting and extracting visualizer code fences
 * from markdown content.
 */

const VISUALIZER_FENCE_REGEX = /```visualizer\s*\n([\s\S]*?)```/g
const VISUALIZER_FENCE_TEST = /```visualizer\s*\n/

/**
 * Check if a string contains a ```visualizer code fence.
 */
export function isVisualizerFence(text: string): boolean {
  return VISUALIZER_FENCE_TEST.test(text)
}

/**
 * Extract all visualizer code blocks from a markdown string.
 * Returns an array of the code content (without the fence markers).
 */
export function extractVisualizerCode(text: string): string[] {
  const results: string[] = []
  // Reset lastIndex since we reuse the global regex
  VISUALIZER_FENCE_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = VISUALIZER_FENCE_REGEX.exec(text)) !== null) {
    const code = match[1].trim()
    if (code) {
      results.push(code)
    }
  }
  return results
}
