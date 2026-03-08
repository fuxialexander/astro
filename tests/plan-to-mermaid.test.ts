/**
 * Unit tests for planToMermaid() — deterministic plan JSON to Mermaid converter.
 *
 * Tests cover:
 * - Empty input handling
 * - Single node rendering (task vs milestone)
 * - Multi-node with edges
 * - Special character escaping in labels
 * - Long title truncation
 * - Style class assignment based on node type and status
 * - Edge filtering (only between valid nodes)
 * - Complex DAG structures (diamond, linear, branching)
 *
 * Run with: npx vitest run tests/plan-to-mermaid.test.ts
 */

import { describe, it, expect } from 'vitest'
import { planToMermaid, type MermaidNode, type MermaidEdge } from '../src/lib/plan-to-mermaid'

describe('planToMermaid', () => {
  describe('empty input', () => {
    it('should return empty string for no nodes', () => {
      expect(planToMermaid([], [])).toBe('')
    })

    it('should return empty string for empty arrays', () => {
      expect(planToMermaid([], [{ source: 'a', target: 'b' }])).toBe('')
    })
  })

  describe('single node', () => {
    it('should render a task node as rounded rectangle', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Set up API', type: 'task' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('graph TD')
      expect(result).toContain('n0("Set up API")')
      expect(result).not.toContain('{{')
    })

    it('should render a milestone node as hexagon', () => {
      const nodes: MermaidNode[] = [{ id: 'm1', title: 'MVP Complete', type: 'milestone' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('{{"MVP Complete"}}')
    })

    it('should render branch and decision nodes as rounded rectangles', () => {
      const nodes: MermaidNode[] = [
        { id: 'b1', title: 'Explore options', type: 'branch' },
        { id: 'd1', title: 'Choose approach', type: 'decision' },
      ]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('n0("Explore options")')
      expect(result).toContain('n1("Choose approach")')
    })
  })

  describe('edges', () => {
    it('should render edges between valid nodes', () => {
      const nodes: MermaidNode[] = [
        { id: 'a', title: 'Task A', type: 'task' },
        { id: 'b', title: 'Task B', type: 'task' },
      ]
      const edges: MermaidEdge[] = [{ source: 'a', target: 'b' }]
      const result = planToMermaid(nodes, edges)

      expect(result).toContain('n0 --> n1')
    })

    it('should skip edges with missing source or target', () => {
      const nodes: MermaidNode[] = [{ id: 'a', title: 'Task A', type: 'task' }]
      const edges: MermaidEdge[] = [{ source: 'a', target: 'missing' }]
      const result = planToMermaid(nodes, edges)

      expect(result).not.toContain('-->')
    })

    it('should render multiple edges', () => {
      const nodes: MermaidNode[] = [
        { id: 'a', title: 'A', type: 'task' },
        { id: 'b', title: 'B', type: 'task' },
        { id: 'c', title: 'C', type: 'task' },
      ]
      const edges: MermaidEdge[] = [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
      ]
      const result = planToMermaid(nodes, edges)

      expect(result).toContain('n0 --> n1')
      expect(result).toContain('n0 --> n2')
    })
  })

  describe('label escaping', () => {
    it('should escape double quotes', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Fix "bug"', type: 'task' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('#quot;bug#quot;')
      expect(result).not.toContain('"bug"')
    })

    it('should escape brackets and braces', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Array[0] = {value}', type: 'task' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('#lsqb;0#rsqb;')
      expect(result).toContain('#lbrace;value#rbrace;')
    })

    it('should escape angle brackets', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Add <Component>', type: 'task' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('#lt;Component#gt;')
    })

    it('should escape parentheses', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Call fn()', type: 'task' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('#lpar;#rpar;')
    })

    it('should escape hash to prevent accidental entity refs', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Issue #42', type: 'task' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('#num;42')
      expect(result).not.toContain('#42')
    })

    it('should replace newlines with spaces', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Line 1\nLine 2', type: 'task' }]
      const result = planToMermaid(nodes, [])

      // Newlines must be removed from labels — they break the line-based graph syntax
      expect(result).toContain('Line 1 Line 2')
    })

    it('should preserve semicolons and pipes inside quoted labels', () => {
      // `;` and `|` are safe inside ("...") labels — only dangerous at top level
      const nodes: MermaidNode[] = [
        { id: 'a', title: 'Step 1; Step 2', type: 'task' },
        { id: 'b', title: 'Compare A | B', type: 'task' },
      ]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('Step 1; Step 2')
      expect(result).toContain('Compare A | B')
    })
  })

  describe('title truncation', () => {
    it('should not truncate titles under 40 chars', () => {
      const title = 'Set up the API endpoints' // 24 chars
      const nodes: MermaidNode[] = [{ id: 'n1', title, type: 'task' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain(title)
    })

    it('should truncate titles over 40 chars with ellipsis', () => {
      const title = 'This is a very long task title that should be truncated for readability'
      const nodes: MermaidNode[] = [{ id: 'n1', title, type: 'task' }]
      const result = planToMermaid(nodes, [])

      expect(result).not.toContain(title)
      expect(result).toContain('\u2026') // Unicode ellipsis
    })

    it('should truncate to exactly 40 characters (39 + ellipsis)', () => {
      const title = 'A'.repeat(50)
      const nodes: MermaidNode[] = [{ id: 'n1', title, type: 'task' }]
      const result = planToMermaid(nodes, [])

      // The truncated part should be 39 chars + ellipsis
      expect(result).toContain('A'.repeat(39) + '\u2026')
    })
  })

  describe('style classes', () => {
    it('should apply task class to planned tasks', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Task', type: 'task', status: 'planned' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('class n0 task')
    })

    it('should apply milestone class to milestone nodes', () => {
      const nodes: MermaidNode[] = [{ id: 'm1', title: 'Done', type: 'milestone', status: 'planned' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('class n0 milestone')
    })

    it('should apply completed class to completed tasks', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Task', type: 'task', status: 'completed' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('class n0 completed')
    })

    it('should apply completed class to auto_verified tasks', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Task', type: 'task', status: 'auto_verified' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('class n0 completed')
    })

    it('should apply inprogress class to in_progress tasks', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Task', type: 'task', status: 'in_progress' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('class n0 inprogress')
    })

    it('should apply inprogress class to dispatched tasks', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Task', type: 'task', status: 'dispatched' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('class n0 inprogress')
    })

    it('should apply pruned class to pruned tasks', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Task', type: 'task', status: 'pruned' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('class n0 pruned')
    })

    it('should prioritize status over type for class assignment', () => {
      // A completed milestone should get "completed", not "milestone"
      const nodes: MermaidNode[] = [{ id: 'm1', title: 'Done', type: 'milestone', status: 'completed' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('class n0 completed')
      expect(result).not.toContain('class n0 milestone')
    })
  })

  describe('complex graphs', () => {
    it('should handle diamond dependency pattern', () => {
      const nodes: MermaidNode[] = [
        { id: 'a', title: 'Start', type: 'task' },
        { id: 'b', title: 'Path 1', type: 'task' },
        { id: 'c', title: 'Path 2', type: 'task' },
        { id: 'd', title: 'Merge', type: 'milestone' },
      ]
      const edges: MermaidEdge[] = [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
        { source: 'b', target: 'd' },
        { source: 'c', target: 'd' },
      ]
      const result = planToMermaid(nodes, edges)

      expect(result).toContain('n0 --> n1')
      expect(result).toContain('n0 --> n2')
      expect(result).toContain('n1 --> n3')
      expect(result).toContain('n2 --> n3')
      expect(result).toContain('{{"Merge"}}')
    })

    it('should handle linear pipeline', () => {
      const nodes: MermaidNode[] = [
        { id: '1', title: 'Step 1', type: 'task' },
        { id: '2', title: 'Step 2', type: 'task' },
        { id: '3', title: 'Step 3', type: 'task' },
      ]
      const edges: MermaidEdge[] = [
        { source: '1', target: '2' },
        { source: '2', target: '3' },
      ]
      const result = planToMermaid(nodes, edges)

      expect(result).toContain('n0 --> n1')
      expect(result).toContain('n1 --> n2')
    })

    it('should handle nodes with no edges (isolated tasks)', () => {
      const nodes: MermaidNode[] = [
        { id: 'a', title: 'Independent A', type: 'task' },
        { id: 'b', title: 'Independent B', type: 'task' },
      ]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('n0("Independent A")')
      expect(result).toContain('n1("Independent B")')
      expect(result).not.toContain('-->')
    })

    it('should handle mixed statuses across nodes', () => {
      const nodes: MermaidNode[] = [
        { id: 'a', title: 'Done', type: 'task', status: 'completed' },
        { id: 'b', title: 'Running', type: 'task', status: 'in_progress' },
        { id: 'c', title: 'Waiting', type: 'task', status: 'planned' },
        { id: 'd', title: 'Pruned', type: 'task', status: 'pruned' },
      ]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('class n0 completed')
      expect(result).toContain('class n1 inprogress')
      expect(result).toContain('class n2 task')
      expect(result).toContain('class n3 pruned')
    })
  })

  describe('determinism', () => {
    it('should produce identical output for identical input', () => {
      const nodes: MermaidNode[] = [
        { id: 'a', title: 'Task A', type: 'task' },
        { id: 'b', title: 'Task B', type: 'task' },
      ]
      const edges: MermaidEdge[] = [{ source: 'a', target: 'b' }]

      const result1 = planToMermaid(nodes, edges)
      const result2 = planToMermaid(nodes, edges)

      expect(result1).toBe(result2)
    })
  })

  describe('classDef declarations', () => {
    it('should always include all five classDef lines', () => {
      const nodes: MermaidNode[] = [{ id: 'n1', title: 'Task', type: 'task' }]
      const result = planToMermaid(nodes, [])

      expect(result).toContain('classDef task fill:#dbeafe')
      expect(result).toContain('classDef milestone fill:#fef3c7')
      expect(result).toContain('classDef completed fill:#dcfce7')
      expect(result).toContain('classDef inprogress fill:#ede9fe')
      expect(result).toContain('classDef pruned fill:#f1f5f9')
    })
  })
})
