import { describe, it, expect } from 'vitest'
import { extractPlanJsonFromText } from '../src/lib/plan-extraction'

describe('extractPlanJsonFromText', () => {
  it('extracts JSON from a ```json code fence with valid plan structure', () => {
    const text = `Here is the plan:
\`\`\`json
{
  "projectName": "My Project",
  "nodes": [
    { "id": "node-1", "label": "Setup", "status": "planned" },
    { "id": "node-2", "label": "Build", "status": "planned" }
  ],
  "edges": [
    { "source": "node-1", "target": "node-2" }
  ]
}
\`\`\`
That's the plan.`

    const result = extractPlanJsonFromText(text)
    expect(result).not.toBeNull()
    expect(result!.projectName).toBe('My Project')
    expect(result!.nodes).toHaveLength(2)
    expect(result!.edges).toHaveLength(1)
    expect(result!.nodes[0]).toMatchObject({ id: 'node-1', label: 'Setup' })
    expect(result!.edges[0]).toMatchObject({ source: 'node-1', target: 'node-2' })
  })

  it('extracts JSON from raw text containing a JSON object with projectName and nodes', () => {
    const text = `I'll create the following plan: {"projectName": "Raw Plan", "nodes": [{"id": "a", "label": "Task A"}], "edges": []} and that's it.`

    const result = extractPlanJsonFromText(text)
    expect(result).not.toBeNull()
    expect(result!.projectName).toBe('Raw Plan')
    expect(result!.nodes).toHaveLength(1)
    expect(result!.edges).toHaveLength(0)
  })

  it('returns null for truncated/invalid JSON in a code fence', () => {
    const text = `Here is the plan:
\`\`\`json
{
  "projectName": "Broken",
  "nodes": [
    { "id": "node-1", "label": "Setup"
\`\`\``

    const result = extractPlanJsonFromText(text)
    expect(result).toBeNull()
  })

  it('returns null for text with no JSON at all', () => {
    const text = 'This is just plain text with no JSON whatsoever.'
    const result = extractPlanJsonFromText(text)
    expect(result).toBeNull()
  })

  it('returns null for empty string', () => {
    const result = extractPlanJsonFromText('')
    expect(result).toBeNull()
  })

  it('returns null when first code fence lacks plan structure and second fence exists', () => {
    // The regex only matches the first code fence (non-greedy).
    // If the first fence doesn't have nodes, the raw JSON fallback also
    // struggles with backtick-fenced content, so the result is null.
    const text = `Here is some config:
\`\`\`json
{
  "name": "config",
  "value": 42
}
\`\`\`

And here is the plan:
\`\`\`json
{
  "projectName": "Multi Fence",
  "nodes": [
    { "id": "n1", "label": "First" }
  ],
  "edges": []
}
\`\`\`
Done.`

    const result = extractPlanJsonFromText(text)
    expect(result).toBeNull()
  })

  it('extracts from the first code fence when it has plan structure', () => {
    const text = `Here is the plan:
\`\`\`json
{
  "projectName": "First Fence",
  "nodes": [
    { "id": "n1", "label": "Task 1" }
  ],
  "edges": []
}
\`\`\`

And some other JSON:
\`\`\`json
{
  "projectName": "Second Fence",
  "nodes": [
    { "id": "n2", "label": "Task 2" }
  ],
  "edges": []
}
\`\`\`
Done.`

    const result = extractPlanJsonFromText(text)
    expect(result).not.toBeNull()
    expect(result!.projectName).toBe('First Fence')
    expect(result!.nodes).toHaveLength(1)
  })

  it('handles plan with only nodes (no edges array in source, but edges key present)', () => {
    const text = `\`\`\`json
{
  "projectName": "No Edges",
  "nodes": [
    { "id": "solo", "label": "Solo task" }
  ]
}
\`\`\``

    const result = extractPlanJsonFromText(text)
    // The function checks parsed.nodes && Array.isArray(parsed.nodes)
    // It doesn't require edges, so this should work
    expect(result).not.toBeNull()
    expect(result!.projectName).toBe('No Edges')
    expect(result!.nodes).toHaveLength(1)
    expect(result!.edges).toBeUndefined()
  })

  it('handles empty nodes array', () => {
    const text = `\`\`\`json
{
  "projectName": "Empty",
  "nodes": [],
  "edges": []
}
\`\`\``

    const result = extractPlanJsonFromText(text)
    // Array.isArray([]) is true, but empty array is falsy for parsed.nodes check
    // parsed.nodes is [] which is truthy in JS, so this should work
    expect(result).not.toBeNull()
    expect(result!.nodes).toHaveLength(0)
    expect(result!.edges).toHaveLength(0)
  })

  it('returns null when JSON has nodes that is not an array', () => {
    const text = `\`\`\`json
{
  "projectName": "Bad Nodes",
  "nodes": "not an array",
  "edges": []
}
\`\`\``

    const result = extractPlanJsonFromText(text)
    expect(result).toBeNull()
  })

  it('handles nested objects inside nodes', () => {
    const text = `\`\`\`json
{
  "projectName": "Nested",
  "nodes": [
    {
      "id": "n1",
      "label": "Complex task",
      "data": { "priority": "high", "tags": ["backend", "api"] }
    }
  ],
  "edges": []
}
\`\`\``

    const result = extractPlanJsonFromText(text)
    expect(result).not.toBeNull()
    expect(result!.nodes[0]).toMatchObject({
      id: 'n1',
      label: 'Complex task',
      data: { priority: 'high', tags: ['backend', 'api'] }
    })
  })

  it('handles raw JSON with deeply nested braces', () => {
    const text = `The plan is {"projectName": "Deep", "nodes": [{"id": "1", "meta": {"a": {"b": "c"}}}], "edges": [{"source": "1", "target": "2"}]} end.`

    const result = extractPlanJsonFromText(text)
    expect(result).not.toBeNull()
    expect(result!.projectName).toBe('Deep')
    expect(result!.nodes).toHaveLength(1)
    expect(result!.nodes[0]).toMatchObject({ id: '1', meta: { a: { b: 'c' } } })
  })

  it('returns null for raw JSON that is truncated (unbalanced braces)', () => {
    const text = `The plan is {"projectName": "Truncated", "nodes": [{"id": "1"}`

    const result = extractPlanJsonFromText(text)
    expect(result).toBeNull()
  })

  it('returns null when JSON is valid but has no nodes key', () => {
    const text = `\`\`\`json
{
  "projectName": "No Nodes Key",
  "tasks": [{ "id": "1" }]
}
\`\`\``

    const result = extractPlanJsonFromText(text)
    expect(result).toBeNull()
  })

  it('prefers code fence JSON over raw JSON', () => {
    const text = `Raw: {"projectName": "Raw", "nodes": [{"id": "raw-1"}], "edges": []}
\`\`\`json
{
  "projectName": "Fenced",
  "nodes": [{ "id": "fenced-1" }],
  "edges": []
}
\`\`\``

    const result = extractPlanJsonFromText(text)
    expect(result).not.toBeNull()
    // Code fence is tried first and should win
    expect(result!.projectName).toBe('Fenced')
  })
})
