/**
 * Chat Mutation Extraction Tests
 *
 * Tests the extractMutations function from plan-mutations.ts which parses
 * ```json mutation blocks (shape-based detection) and legacy astro-* fences.
 */
import { describe, it, expect } from 'vitest'
import { extractMutations } from '@/lib/plan-mutations'

describe('extractMutations', () => {
  // ── New format: ```json with shape-based detection ──

  describe('json fence with mutation shape', () => {
    it('extracts updateNodes from a json fence', () => {
      const content = `I've updated the priorities.

\`\`\`json
{
  "updateNodes": [
    { "nodeId": "task-1", "priority": "urgent" },
    { "nodeTitle": "Deploy to prod", "status": "pruned" }
  ]
}
\`\`\`

Done!`

      const { cleanContent, mutations } = extractMutations(content)

      expect(mutations.nodeUpdates).toHaveLength(2)
      expect(mutations.nodeUpdates[0]).toEqual({ nodeId: 'task-1', priority: 'urgent' })
      expect(mutations.nodeUpdates[1]).toEqual({ nodeTitle: 'Deploy to prod', status: 'pruned' })
      expect(cleanContent).toContain("I've updated the priorities.")
      expect(cleanContent).toContain('Done!')
      expect(cleanContent).not.toContain('updateNodes')
    })

    it('extracts addNodes from a json fence', () => {
      const content = `\`\`\`json
{
  "addNodes": [
    {
      "id": "tmp1",
      "title": "Add caching layer",
      "description": "Set up Redis cache",
      "milestoneId": "m1",
      "dependencies": ["task-1"],
      "priority": "high",
      "estimate": "M"
    }
  ]
}
\`\`\``

      const { mutations } = extractMutations(content)

      expect(mutations.newNodes).toHaveLength(1)
      expect(mutations.newNodes[0].title).toBe('Add caching layer')
      expect(mutations.newNodes[0].dependencies).toEqual(['task-1'])
      expect(mutations.newNodes[0].priority).toBe('high')
      expect(mutations.newNodes[0].estimate).toBe('M')
    })

    it('extracts updateEdges from a json fence', () => {
      const content = `\`\`\`json
{
  "updateEdges": [
    { "action": "add", "source": "task-1", "target": "task-2", "type": "dependency" },
    { "action": "remove", "source": "task-3", "target": "task-4" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(content)

      expect(mutations.edgeOps).toHaveLength(2)
      expect(mutations.edgeOps[0]).toEqual({
        action: 'add',
        source: 'task-1',
        target: 'task-2',
        type: 'dependency',
      })
      expect(mutations.edgeOps[1].action).toBe('remove')
    })

    it('extracts all three mutation types from one json block', () => {
      const content = `Here are all the changes:

\`\`\`json
{
  "updateNodes": [
    { "nodeId": "t1", "status": "completed" }
  ],
  "addNodes": [
    { "title": "New task", "description": "Something new" }
  ],
  "updateEdges": [
    { "action": "add", "source": "t1", "target": "t2" }
  ]
}
\`\`\`

All done!`

      const { cleanContent, mutations } = extractMutations(content)

      expect(mutations.nodeUpdates).toHaveLength(1)
      expect(mutations.newNodes).toHaveLength(1)
      expect(mutations.edgeOps).toHaveLength(1)
      expect(cleanContent).toContain('Here are all the changes:')
      expect(cleanContent).toContain('All done!')
      expect(cleanContent).not.toContain('updateNodes')
    })

    it('ignores json fences without mutation shape', () => {
      const content = `Here's some config:

\`\`\`json
{ "name": "my-project", "version": "1.0.0" }
\`\`\`

Done.`

      const { cleanContent, mutations } = extractMutations(content)

      expect(mutations.nodeUpdates).toHaveLength(0)
      expect(mutations.edgeOps).toHaveLength(0)
      expect(mutations.newNodes).toHaveLength(0)
      // Non-mutation JSON block should be preserved
      expect(cleanContent).toContain('```json')
      expect(cleanContent).toContain('"name": "my-project"')
    })

    it('ignores json fences with array (not object)', () => {
      const content = `\`\`\`json
[1, 2, 3]
\`\`\``

      const { cleanContent, mutations } = extractMutations(content)
      expect(mutations.nodeUpdates).toHaveLength(0)
      expect(cleanContent).toContain('[1, 2, 3]')
    })

    it('ignores json fences with full plan shape (projectName/nodes/edges)', () => {
      // The prompt says "Do NOT output a full plan JSON object"
      // Full plan objects don't have updateNodes/addNodes/updateEdges keys
      const content = `\`\`\`json
{
  "projectName": "My Project",
  "nodes": [{ "id": "n1", "title": "Task 1" }],
  "edges": []
}
\`\`\``

      const { cleanContent, mutations } = extractMutations(content)
      expect(mutations.nodeUpdates).toHaveLength(0)
      expect(mutations.newNodes).toHaveLength(0)
      expect(mutations.edgeOps).toHaveLength(0)
      // Full plan JSON should be preserved (not stripped)
      expect(cleanContent).toContain('projectName')
    })

    it('skips updateNodes items without nodeId or nodeTitle', () => {
      const content = `\`\`\`json
{
  "updateNodes": [
    { "status": "completed" },
    { "nodeId": "valid", "status": "done" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(content)
      expect(mutations.nodeUpdates).toHaveLength(1)
      expect(mutations.nodeUpdates[0].nodeId).toBe('valid')
    })

    it('skips addNodes items without title', () => {
      const content = `\`\`\`json
{
  "addNodes": [
    { "description": "no title" },
    { "title": "Valid", "description": "has title" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(content)
      expect(mutations.newNodes).toHaveLength(1)
      expect(mutations.newNodes[0].title).toBe('Valid')
    })

    it('skips updateEdges items without action/source/target', () => {
      const content = `\`\`\`json
{
  "updateEdges": [
    { "action": "add", "source": "a" },
    { "action": "add", "source": "a", "target": "b" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(content)
      expect(mutations.edgeOps).toHaveLength(1)
    })

    it('handles malformed JSON in json fence gracefully', () => {
      const content = `\`\`\`json
{not valid json
\`\`\``

      const { cleanContent, mutations } = extractMutations(content)
      expect(mutations.nodeUpdates).toHaveLength(0)
      // Malformed block stays in content
      expect(cleanContent).toContain('{not valid json')
    })
  })

  // ── Legacy format: astro-* fences ──

  describe('legacy astro-plan-change fence', () => {
    it('extracts from astro-plan-change block', () => {
      const content = `Changes:

\`\`\`astro-plan-change
{
  "updateNodes": [{ "nodeId": "task-1", "status": "completed" }],
  "addNodes": [{ "title": "New", "description": "Added" }],
  "updateEdges": [{ "action": "add", "source": "task-1", "target": "task-2" }]
}
\`\`\``

      const { cleanContent, mutations } = extractMutations(content)

      expect(mutations.nodeUpdates).toHaveLength(1)
      expect(mutations.newNodes).toHaveLength(1)
      expect(mutations.edgeOps).toHaveLength(1)
      expect(cleanContent).not.toContain('astro-plan-change')
    })
  })

  describe('legacy separate block fences', () => {
    it('extracts from astro-updates block (array format)', () => {
      const content = `\`\`\`astro-updates
[{"nodeId": "task-1", "status": "completed"}]
\`\`\``

      const { mutations } = extractMutations(content)
      expect(mutations.nodeUpdates).toHaveLength(1)
      expect(mutations.nodeUpdates[0].nodeId).toBe('task-1')
    })

    it('extracts from astro-edges block', () => {
      const content = `\`\`\`astro-edges
[{"action": "add", "source": "task-1", "target": "task-2", "type": "dependency"}]
\`\`\``

      const { mutations } = extractMutations(content)
      expect(mutations.edgeOps).toHaveLength(1)
    })

    it('extracts from astro-add-nodes block', () => {
      const content = `\`\`\`astro-add-nodes
[{"title": "Setup CI/CD", "description": "Configure GitHub Actions", "dependencies": ["task-1"]}]
\`\`\``

      const { mutations } = extractMutations(content)
      expect(mutations.newNodes).toHaveLength(1)
      expect(mutations.newNodes[0].title).toBe('Setup CI/CD')
    })
  })

  // ── Priority: json fence takes precedence over legacy ──

  describe('priority', () => {
    it('uses json fence when both formats are present', () => {
      const content = `\`\`\`json
{
  "updateNodes": [{ "nodeId": "from-json", "status": "completed" }]
}
\`\`\`

\`\`\`astro-updates
[{"nodeId": "from-legacy", "status": "completed"}]
\`\`\``

      const { mutations } = extractMutations(content)
      // json fence found mutations, so legacy is skipped
      expect(mutations.nodeUpdates).toHaveLength(1)
      expect(mutations.nodeUpdates[0].nodeId).toBe('from-json')
    })
  })

  // ── Edge cases ──

  describe('edge cases', () => {
    it('returns empty mutations for plain text', () => {
      const content = 'Just a normal response with no code blocks.'

      const { cleanContent, mutations } = extractMutations(content)

      expect(mutations.nodeUpdates).toHaveLength(0)
      expect(mutations.edgeOps).toHaveLength(0)
      expect(mutations.newNodes).toHaveLength(0)
      expect(cleanContent).toBe(content)
    })

    it('ignores non-json code blocks', () => {
      const content = `\`\`\`typescript
const x = 1
\`\`\``

      const { cleanContent, mutations } = extractMutations(content)
      expect(mutations.nodeUpdates).toHaveLength(0)
      expect(cleanContent).toContain('typescript')
    })

    it('handles empty updateNodes/addNodes/updateEdges arrays', () => {
      const content = `\`\`\`json
{ "updateNodes": [], "addNodes": [], "updateEdges": [] }
\`\`\``

      const { cleanContent, mutations } = extractMutations(content)
      // Empty arrays still count as mutation shape — block is removed
      expect(mutations.nodeUpdates).toHaveLength(0)
      expect(cleanContent).not.toContain('updateNodes')
    })

    it('handles nodeTitle-based updates', () => {
      const content = `\`\`\`json
{
  "updateNodes": [
    { "nodeTitle": "Setup Database", "type": "task", "priority": "high" }
  ]
}
\`\`\``

      const { mutations } = extractMutations(content)
      expect(mutations.nodeUpdates).toHaveLength(1)
      expect(mutations.nodeUpdates[0].nodeTitle).toBe('Setup Database')
      expect(mutations.nodeUpdates[0].priority).toBe('high')
    })
  })
})
