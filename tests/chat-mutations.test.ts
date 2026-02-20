/**
 * Chat Mutation Extraction Tests
 *
 * Tests the extractMutations function that parses astro-updates, astro-edges,
 * and astro-add-nodes code blocks from assistant messages.
 *
 * This logic is defined in chat-panel.tsx but tested here in isolation
 * by reimporting the regex patterns and parsing logic.
 */
import { describe, it, expect } from 'vitest'

// Replicate the extraction logic from chat-panel.tsx for testability
const UPDATE_BLOCK_RE = /```astro-updates\s*\n([\s\S]*?)```/g
const EDGE_BLOCK_RE = /```astro-edges\s*\n([\s\S]*?)```/g
const ADD_NODES_BLOCK_RE = /```astro-add-nodes\s*\n([\s\S]*?)```/g

interface ParsedNodeUpdate {
  nodeId: string
  [key: string]: unknown
}

interface ParsedEdgeOp {
  action: 'add' | 'remove'
  source: string
  target: string
  type?: string
}

interface ParsedNewNode {
  id?: string
  title: string
  description: string
  type?: string
  milestoneId?: string
  dependencies?: string[]
  priority?: string
  estimate?: string
  environment?: string
  verification?: string
}

interface AppliedMutations {
  nodeUpdates: ParsedNodeUpdate[]
  edgeOps: ParsedEdgeOp[]
  newNodes: ParsedNewNode[]
}

function extractMutations(content: string): { cleanContent: string; mutations: AppliedMutations } {
  const nodeUpdates: ParsedNodeUpdate[] = []
  const edgeOps: ParsedEdgeOp[] = []
  const newNodes: ParsedNewNode[] = []

  let cleanContent = content.replace(UPDATE_BLOCK_RE, (match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim())
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && item.nodeId) {
            nodeUpdates.push(item as ParsedNodeUpdate)
          }
        }
      }
    } catch {
      return match
    }
    return ''
  })

  cleanContent = cleanContent.replace(EDGE_BLOCK_RE, (match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim())
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && item.action && item.source && item.target) {
            edgeOps.push(item as ParsedEdgeOp)
          }
        }
      }
    } catch {
      return match
    }
    return ''
  })

  cleanContent = cleanContent
    .replace(ADD_NODES_BLOCK_RE, (match, json: string) => {
      try {
        const parsed = JSON.parse(json.trim())
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === 'object' && item.title) {
              newNodes.push(item as ParsedNewNode)
            }
          }
        }
      } catch {
        return match
      }
      return ''
    })
    .trim()

  return { cleanContent, mutations: { nodeUpdates, edgeOps, newNodes } }
}

describe('extractMutations', () => {
  describe('node updates', () => {
    it('extracts astro-updates blocks', () => {
      const content = `I've updated the task status.

\`\`\`astro-updates
[{"nodeId": "task-1", "status": "completed"}]
\`\`\`

Done!`

      const { cleanContent, mutations } = extractMutations(content)

      expect(mutations.nodeUpdates).toHaveLength(1)
      expect(mutations.nodeUpdates[0]).toEqual({
        nodeId: 'task-1',
        status: 'completed',
      })
      expect(cleanContent).toContain("I've updated the task status.")
      expect(cleanContent).toContain('Done!')
      expect(cleanContent).not.toContain('astro-updates')
    })

    it('extracts multiple node updates', () => {
      const content = `\`\`\`astro-updates
[
  {"nodeId": "task-1", "status": "completed", "priority": "high"},
  {"nodeId": "task-2", "title": "Updated title"}
]
\`\`\``

      const { mutations } = extractMutations(content)

      expect(mutations.nodeUpdates).toHaveLength(2)
      expect(mutations.nodeUpdates[0].nodeId).toBe('task-1')
      expect(mutations.nodeUpdates[0].priority).toBe('high')
      expect(mutations.nodeUpdates[1].title).toBe('Updated title')
    })

    it('skips items without nodeId', () => {
      const content = `\`\`\`astro-updates
[{"status": "completed"}, {"nodeId": "valid", "status": "done"}]
\`\`\``

      const { mutations } = extractMutations(content)
      expect(mutations.nodeUpdates).toHaveLength(1)
      expect(mutations.nodeUpdates[0].nodeId).toBe('valid')
    })

    it('keeps malformed JSON visible in content', () => {
      const content = `\`\`\`astro-updates
{not valid json
\`\`\``

      const { cleanContent, mutations } = extractMutations(content)
      expect(mutations.nodeUpdates).toHaveLength(0)
      expect(cleanContent).toContain('astro-updates')
    })
  })

  describe('edge operations', () => {
    it('extracts add edge operations', () => {
      const content = `\`\`\`astro-edges
[{"action": "add", "source": "task-1", "target": "task-2", "type": "dependency"}]
\`\`\``

      const { mutations } = extractMutations(content)

      expect(mutations.edgeOps).toHaveLength(1)
      expect(mutations.edgeOps[0]).toEqual({
        action: 'add',
        source: 'task-1',
        target: 'task-2',
        type: 'dependency',
      })
    })

    it('extracts remove edge operations', () => {
      const content = `\`\`\`astro-edges
[{"action": "remove", "source": "a", "target": "b"}]
\`\`\``

      const { mutations } = extractMutations(content)
      expect(mutations.edgeOps).toHaveLength(1)
      expect(mutations.edgeOps[0].action).toBe('remove')
    })

    it('requires action, source, and target', () => {
      const content = `\`\`\`astro-edges
[{"action": "add", "source": "a"}, {"action": "add", "source": "a", "target": "b"}]
\`\`\``

      const { mutations } = extractMutations(content)
      expect(mutations.edgeOps).toHaveLength(1) // Only the complete one
    })
  })

  describe('new nodes', () => {
    it('extracts add-nodes blocks', () => {
      const content = `\`\`\`astro-add-nodes
[{
  "id": "new-1",
  "title": "Setup CI/CD",
  "description": "Configure GitHub Actions",
  "type": "task",
  "dependencies": ["task-1"]
}]
\`\`\``

      const { mutations } = extractMutations(content)

      expect(mutations.newNodes).toHaveLength(1)
      expect(mutations.newNodes[0].title).toBe('Setup CI/CD')
      expect(mutations.newNodes[0].dependencies).toEqual(['task-1'])
    })

    it('requires title field', () => {
      const content = `\`\`\`astro-add-nodes
[{"description": "no title"}, {"title": "Valid", "description": "has title"}]
\`\`\``

      const { mutations } = extractMutations(content)
      expect(mutations.newNodes).toHaveLength(1)
      expect(mutations.newNodes[0].title).toBe('Valid')
    })
  })

  describe('combined mutations', () => {
    it('extracts all three types from one message', () => {
      const content = `Here are the changes:

\`\`\`astro-updates
[{"nodeId": "t1", "status": "completed"}]
\`\`\`

\`\`\`astro-edges
[{"action": "add", "source": "t1", "target": "t2"}]
\`\`\`

\`\`\`astro-add-nodes
[{"title": "New task", "description": "Added"}]
\`\`\`

All done!`

      const { cleanContent, mutations } = extractMutations(content)

      expect(mutations.nodeUpdates).toHaveLength(1)
      expect(mutations.edgeOps).toHaveLength(1)
      expect(mutations.newNodes).toHaveLength(1)
      expect(cleanContent).toContain('Here are the changes:')
      expect(cleanContent).toContain('All done!')
      expect(cleanContent).not.toContain('astro-updates')
      expect(cleanContent).not.toContain('astro-edges')
      expect(cleanContent).not.toContain('astro-add-nodes')
    })

    it('returns empty mutations for plain text', () => {
      const content = 'Just a normal response with no code blocks.'

      const { cleanContent, mutations } = extractMutations(content)

      expect(mutations.nodeUpdates).toHaveLength(0)
      expect(mutations.edgeOps).toHaveLength(0)
      expect(mutations.newNodes).toHaveLength(0)
      expect(cleanContent).toBe(content)
    })

    it('ignores non-astro code blocks', () => {
      const content = `Here's some code:

\`\`\`typescript
const x = 1
\`\`\`

Done.`

      const { cleanContent, mutations } = extractMutations(content)
      expect(mutations.nodeUpdates).toHaveLength(0)
      expect(cleanContent).toContain('typescript')
    })
  })
})
