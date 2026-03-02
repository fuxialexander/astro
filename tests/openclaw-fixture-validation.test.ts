/**
 * OpenClaw JSONL Fixture Validation Tests
 *
 * Validates that tests/fixtures/openclaw-output.jsonl contains well-formed
 * OpenClaw JSONL events that match the adapter's expected event schema.
 *
 * These tests are self-contained — they don't import from the agent-runner
 * submodule (which may not be initialized). Instead they validate the fixture
 * data structurally: correct JSON, expected event types, required fields,
 * scenario completeness, and edge cases.
 *
 * Scenarios covered:
 *   1. happy_path          — Full successful session
 *   2. tool_failure        — Tool fails, agent recovers
 *   3. multi_turn          — Multiple message cycles
 *   4. malformed_json      — Invalid/non-JSON lines
 *   5. incomplete_fields   — Events with missing or empty fields
 *   6. large_output        — Many text chunks + large tool output
 *   7. multiple_file_changes — File create/modify/delete + dedup
 *   8. error_session       — Fatal error, no session.end
 *   9. minimal_session     — Bare minimum valid session
 *  10. no_cost_session     — Session without cost metrics
 *  11. unicode_and_special_chars — i18n content, escapes
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Types matching the OpenClaw adapter's expected event shapes
// ---------------------------------------------------------------------------

/** All known OpenClaw JSONL event types */
const KNOWN_EVENT_TYPES = [
  'session.start',
  'message.start',
  'content.text',
  'tool_use.start',
  'tool_use.end',
  'file.change',
  'message.end',
  'session.end',
] as const

interface BaseEvent {
  type: string
  timestamp?: string
  [key: string]: unknown
}

interface SessionStartEvent extends BaseEvent {
  type: 'session.start'
  session_id?: string
  model?: string
}

interface ContentTextEvent extends BaseEvent {
  type: 'content.text'
  text?: string | null
}

interface ToolUseStartEvent extends BaseEvent {
  type: 'tool_use.start'
  tool_name?: string
  tool_input?: Record<string, unknown>
}

interface ToolUseEndEvent extends BaseEvent {
  type: 'tool_use.end'
  tool_name?: string
  result?: unknown
  success?: boolean | null
}

interface FileChangeEvent extends BaseEvent {
  type: 'file.change'
  path?: string
  action?: string
  lines_added?: number
  lines_removed?: number
}

interface SessionEndEvent extends BaseEvent {
  type: 'session.end'
  cost?: number
  input_tokens?: number
  output_tokens?: number
  turns?: number
  model?: string
  duration_ms?: number
}

type OpenClawEvent =
  | SessionStartEvent
  | ContentTextEvent
  | ToolUseStartEvent
  | ToolUseEndEvent
  | FileChangeEvent
  | SessionEndEvent
  | BaseEvent

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(process.cwd(), 'tests/fixtures/openclaw-output.jsonl')

interface ParsedLine {
  lineNumber: number
  raw: string
  parsed: OpenClawEvent | null
  isBlank: boolean
  isScenarioMarker: boolean
  scenarioName?: string
}

interface Scenario {
  name: string
  description: string
  lines: ParsedLine[]
  events: OpenClawEvent[]
}

let allLines: ParsedLine[]
let scenarios: Scenario[]
let validEvents: OpenClawEvent[]

/**
 * Parse the fixture file into structured line data and group by scenario.
 */
function loadFixture(): {
  lines: ParsedLine[]
  scenarios: Scenario[]
  validEvents: OpenClawEvent[]
} {
  const content = readFileSync(FIXTURE_PATH, 'utf-8')
  const rawLines = content.split('\n')

  const lines: ParsedLine[] = rawLines.map((raw, i) => {
    const lineNumber = i + 1
    const trimmed = raw.trim()

    if (!trimmed) {
      return { lineNumber, raw, parsed: null, isBlank: true, isScenarioMarker: false }
    }

    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const isMarker =
        typeof obj === 'object' &&
        obj !== null &&
        !Array.isArray(obj) &&
        '_scenario' in obj
      return {
        lineNumber,
        raw,
        parsed: obj as OpenClawEvent,
        isBlank: false,
        isScenarioMarker: isMarker,
        scenarioName: isMarker ? (obj._scenario as string) : undefined,
      }
    } catch {
      return { lineNumber, raw, parsed: null, isBlank: false, isScenarioMarker: false }
    }
  })

  // Group into scenarios (a scenario starts with a _scenario marker line)
  const scenarioMap: Scenario[] = []
  let current: Scenario | null = null

  for (const line of lines) {
    if (line.isScenarioMarker && line.parsed) {
      current = {
        name: line.parsed._scenario as string,
        description: (line.parsed._description as string) || '',
        lines: [],
        events: [],
      }
      scenarioMap.push(current)
    } else if (current && !line.isBlank) {
      current.lines.push(line)
      if (line.parsed && typeof line.parsed === 'object' && 'type' in line.parsed) {
        current.events.push(line.parsed)
      }
    }
  }

  const events = lines
    .filter(
      (l) =>
        l.parsed !== null &&
        !l.isScenarioMarker &&
        typeof l.parsed === 'object' &&
        'type' in l.parsed,
    )
    .map((l) => l.parsed as OpenClawEvent)

  return { lines, scenarios: scenarioMap, validEvents: events }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeAll(() => {
  const data = loadFixture()
  allLines = data.lines
  scenarios = data.scenarios
  validEvents = data.validEvents
})

describe('fixture file structure', () => {
  it('fixture file exists and is non-empty', () => {
    expect(allLines.length).toBeGreaterThan(0)
  })

  it('contains multiple scenarios', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(8)
  })

  it('all scenario names are unique', () => {
    const names = scenarios.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('contains expected scenario names', () => {
    const names = new Set(scenarios.map((s) => s.name))
    expect(names).toContain('happy_path')
    expect(names).toContain('tool_failure')
    expect(names).toContain('multi_turn')
    expect(names).toContain('malformed_json')
    expect(names).toContain('incomplete_fields')
    expect(names).toContain('large_output')
    expect(names).toContain('multiple_file_changes')
    expect(names).toContain('error_session')
    expect(names).toContain('minimal_session')
    expect(names).toContain('no_cost_session')
    expect(names).toContain('unicode_and_special_chars')
  })

  it('every valid event has a type field', () => {
    for (const event of validEvents) {
      expect(event).toHaveProperty('type')
      expect(typeof event.type).toBe('string')
    }
  })
})

// ---------------------------------------------------------------------------
// Scenario: happy_path
// ---------------------------------------------------------------------------

describe('scenario: happy_path', () => {
  let scenario: Scenario

  beforeAll(() => {
    scenario = scenarios.find((s) => s.name === 'happy_path')!
  })

  it('exists', () => {
    expect(scenario).toBeDefined()
  })

  it('starts with session.start', () => {
    expect(scenario.events[0]?.type).toBe('session.start')
  })

  it('ends with session.end', () => {
    expect(scenario.events[scenario.events.length - 1]?.type).toBe('session.end')
  })

  it('session.start has session_id and model', () => {
    const start = scenario.events[0] as SessionStartEvent
    expect(start.session_id).toBeTruthy()
    expect(start.model).toBeTruthy()
  })

  it('contains multiple content.text events (streaming chunks)', () => {
    const textEvents = scenario.events.filter((e) => e.type === 'content.text')
    expect(textEvents.length).toBeGreaterThanOrEqual(3)
  })

  it('has paired tool_use.start and tool_use.end events', () => {
    const starts = scenario.events.filter((e) => e.type === 'tool_use.start')
    const ends = scenario.events.filter((e) => e.type === 'tool_use.end')
    expect(starts.length).toBe(ends.length)
    expect(starts.length).toBeGreaterThanOrEqual(2)
  })

  it('tool_use.end events have success=true', () => {
    const ends = scenario.events.filter((e) => e.type === 'tool_use.end') as ToolUseEndEvent[]
    for (const end of ends) {
      expect(end.success).toBe(true)
    }
  })

  it('has file.change events with action field', () => {
    const changes = scenario.events.filter((e) => e.type === 'file.change') as FileChangeEvent[]
    expect(changes.length).toBeGreaterThanOrEqual(1)
    for (const change of changes) {
      expect(change.path).toBeTruthy()
      expect(['created', 'modified', 'deleted']).toContain(change.action)
    }
  })

  it('has message.start and message.end', () => {
    const msgStarts = scenario.events.filter((e) => e.type === 'message.start')
    const msgEnds = scenario.events.filter((e) => e.type === 'message.end')
    expect(msgStarts.length).toBeGreaterThanOrEqual(1)
    expect(msgEnds.length).toBeGreaterThanOrEqual(1)
  })

  it('session.end has complete metrics', () => {
    const end = scenario.events.find((e) => e.type === 'session.end') as SessionEndEvent
    expect(end.cost).toBeTypeOf('number')
    expect(end.cost).toBeGreaterThan(0)
    expect(end.input_tokens).toBeTypeOf('number')
    expect(end.output_tokens).toBeTypeOf('number')
    expect(end.turns).toBeTypeOf('number')
    expect(end.model).toBeTruthy()
    expect(end.duration_ms).toBeTypeOf('number')
  })
})

// ---------------------------------------------------------------------------
// Scenario: tool_failure
// ---------------------------------------------------------------------------

describe('scenario: tool_failure', () => {
  let scenario: Scenario

  beforeAll(() => {
    scenario = scenarios.find((s) => s.name === 'tool_failure')!
  })

  it('exists', () => {
    expect(scenario).toBeDefined()
  })

  it('contains at least one tool_use.end with success=false', () => {
    const failures = scenario.events.filter(
      (e) => e.type === 'tool_use.end' && (e as ToolUseEndEvent).success === false,
    )
    expect(failures.length).toBeGreaterThanOrEqual(1)
  })

  it('agent recovers after failure (more tool calls follow)', () => {
    const events = scenario.events
    const failIndex = events.findIndex(
      (e) => e.type === 'tool_use.end' && (e as ToolUseEndEvent).success === false,
    )
    expect(failIndex).toBeGreaterThan(-1)

    // There should be more tool calls after the failure
    const afterFailure = events.slice(failIndex + 1)
    const subsequentTools = afterFailure.filter(
      (e) => e.type === 'tool_use.start' || e.type === 'tool_use.end',
    )
    expect(subsequentTools.length).toBeGreaterThanOrEqual(2)
  })

  it('session still ends successfully with metrics', () => {
    const end = scenario.events.find((e) => e.type === 'session.end') as SessionEndEvent
    expect(end).toBeDefined()
    expect(end.cost).toBeTypeOf('number')
  })
})

// ---------------------------------------------------------------------------
// Scenario: multi_turn
// ---------------------------------------------------------------------------

describe('scenario: multi_turn', () => {
  let scenario: Scenario

  beforeAll(() => {
    scenario = scenarios.find((s) => s.name === 'multi_turn')!
  })

  it('exists', () => {
    expect(scenario).toBeDefined()
  })

  it('has multiple message.start/message.end pairs', () => {
    const msgStarts = scenario.events.filter((e) => e.type === 'message.start')
    const msgEnds = scenario.events.filter((e) => e.type === 'message.end')
    expect(msgStarts.length).toBeGreaterThanOrEqual(2)
    expect(msgEnds.length).toBeGreaterThanOrEqual(2)
  })

  it('session.end reports turns > 1', () => {
    const end = scenario.events.find((e) => e.type === 'session.end') as SessionEndEvent
    expect(end).toBeDefined()
    expect(end.turns).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Scenario: malformed_json
// ---------------------------------------------------------------------------

describe('scenario: malformed_json', () => {
  let scenario: Scenario

  beforeAll(() => {
    scenario = scenarios.find((s) => s.name === 'malformed_json')!
  })

  it('exists', () => {
    expect(scenario).toBeDefined()
  })

  it('contains non-JSON lines', () => {
    const nonJson = scenario.lines.filter((l) => l.parsed === null)
    expect(nonJson.length).toBeGreaterThanOrEqual(1)
  })

  it('contains lines that are valid JSON but not objects (arrays, null)', () => {
    const nonObjects = scenario.lines.filter((l) => {
      if (!l.raw.trim()) return false
      try {
        const parsed = JSON.parse(l.raw.trim())
        return Array.isArray(parsed) || parsed === null
      } catch {
        return false
      }
    })
    expect(nonObjects.length).toBeGreaterThanOrEqual(1)
  })

  it('contains truncated/incomplete JSON', () => {
    const hasIncomplete = scenario.lines.some((l) => {
      const trimmed = l.raw.trim()
      // Starts with { but is not valid JSON
      if (!trimmed.startsWith('{')) return false
      try {
        JSON.parse(trimmed)
        return false
      } catch {
        return true
      }
    })
    expect(hasIncomplete).toBe(true)
  })

  it('also contains valid events mixed in', () => {
    expect(scenario.events.length).toBeGreaterThanOrEqual(2)
  })

  it('includes an unknown event type', () => {
    const unknowns = scenario.events.filter(
      (e) => e.type && !(KNOWN_EVENT_TYPES as readonly string[]).includes(e.type),
    )
    expect(unknowns.length).toBeGreaterThanOrEqual(1)
  })

  it('contains an empty JSON object', () => {
    const empty = scenario.lines.some((l) => l.raw.trim() === '{}')
    expect(empty).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Scenario: incomplete_fields
// ---------------------------------------------------------------------------

describe('scenario: incomplete_fields', () => {
  let scenario: Scenario

  beforeAll(() => {
    scenario = scenarios.find((s) => s.name === 'incomplete_fields')!
  })

  it('exists', () => {
    expect(scenario).toBeDefined()
  })

  it('has session.start without session_id', () => {
    const starts = scenario.events.filter(
      (e) => e.type === 'session.start',
    ) as SessionStartEvent[]
    const withoutId = starts.some((s) => !s.session_id)
    expect(withoutId).toBe(true)
  })

  it('has content.text with empty or missing text', () => {
    const texts = scenario.events.filter(
      (e) => e.type === 'content.text',
    ) as ContentTextEvent[]
    const emptyOrMissing = texts.some(
      (t) => t.text === '' || t.text === undefined || t.text === null,
    )
    expect(emptyOrMissing).toBe(true)
  })

  it('has tool_use.start without tool_name', () => {
    const starts = scenario.events.filter(
      (e) => e.type === 'tool_use.start',
    ) as ToolUseStartEvent[]
    const withoutName = starts.some((s) => !s.tool_name)
    expect(withoutName).toBe(true)
  })

  it('has file.change without path', () => {
    const changes = scenario.events.filter(
      (e) => e.type === 'file.change',
    ) as FileChangeEvent[]
    const withoutPath = changes.some((c) => !c.path)
    expect(withoutPath).toBe(true)
  })

  it('has session.end without any metrics', () => {
    const ends = scenario.events.filter(
      (e) => e.type === 'session.end',
    ) as SessionEndEvent[]
    const bare = ends.some(
      (e) =>
        e.cost === undefined &&
        e.input_tokens === undefined &&
        e.output_tokens === undefined,
    )
    expect(bare).toBe(true)
  })

  it('events with extra unknown fields are still valid JSON', () => {
    const withExtra = scenario.events.filter(
      (e) => 'extra_field' in e || 'nested' in e || 'turn_number' in e,
    )
    expect(withExtra.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Scenario: large_output
// ---------------------------------------------------------------------------

describe('scenario: large_output', () => {
  let scenario: Scenario

  beforeAll(() => {
    scenario = scenarios.find((s) => s.name === 'large_output')!
  })

  it('exists', () => {
    expect(scenario).toBeDefined()
  })

  it('has many content.text events simulating streaming', () => {
    const textEvents = scenario.events.filter(
      (e) => e.type === 'content.text',
    ) as ContentTextEvent[]
    expect(textEvents.length).toBeGreaterThanOrEqual(7)
  })

  it('text chunks are small (word-level streaming)', () => {
    const textEvents = scenario.events.filter(
      (e) => e.type === 'content.text',
    ) as ContentTextEvent[]
    // At least some should be very short (1-10 chars)
    const shortChunks = textEvents.filter((t) => t.text && t.text.length <= 10)
    expect(shortChunks.length).toBeGreaterThanOrEqual(5)
  })

  it('tool output is multi-line', () => {
    const toolEnds = scenario.events.filter(
      (e) => e.type === 'tool_use.end',
    ) as ToolUseEndEvent[]
    const multiLine = toolEnds.some(
      (e) => typeof e.result === 'string' && e.result.includes('\n'),
    )
    expect(multiLine).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Scenario: multiple_file_changes
// ---------------------------------------------------------------------------

describe('scenario: multiple_file_changes', () => {
  let scenario: Scenario

  beforeAll(() => {
    scenario = scenarios.find((s) => s.name === 'multiple_file_changes')!
  })

  it('exists', () => {
    expect(scenario).toBeDefined()
  })

  it('has file changes with all three actions', () => {
    const changes = scenario.events.filter(
      (e) => e.type === 'file.change',
    ) as FileChangeEvent[]
    const actions = new Set(changes.map((c) => c.action))
    expect(actions).toContain('created')
    expect(actions).toContain('modified')
    expect(actions).toContain('deleted')
  })

  it('has a file that is both created and modified (dedup test)', () => {
    const changes = scenario.events.filter(
      (e) => e.type === 'file.change',
    ) as FileChangeEvent[]
    const pathCounts = new Map<string, number>()
    for (const c of changes) {
      if (c.path) {
        pathCounts.set(c.path, (pathCounts.get(c.path) || 0) + 1)
      }
    }
    const duplicated = [...pathCounts.values()].some((count) => count > 1)
    expect(duplicated).toBe(true)
  })

  it('deleted file has lines_removed', () => {
    const deleted = scenario.events.find(
      (e) => e.type === 'file.change' && (e as FileChangeEvent).action === 'deleted',
    ) as FileChangeEvent
    expect(deleted).toBeDefined()
    expect(deleted.lines_removed).toBeTypeOf('number')
    expect(deleted.lines_removed).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Scenario: error_session
// ---------------------------------------------------------------------------

describe('scenario: error_session', () => {
  let scenario: Scenario

  beforeAll(() => {
    scenario = scenarios.find((s) => s.name === 'error_session')!
  })

  it('exists', () => {
    expect(scenario).toBeDefined()
  })

  it('starts with session.start', () => {
    expect(scenario.events[0]?.type).toBe('session.start')
  })

  it('does NOT end with session.end (abrupt termination)', () => {
    const lastEvent = scenario.events[scenario.events.length - 1]
    expect(lastEvent?.type).not.toBe('session.end')
  })

  it('contains at least one tool failure', () => {
    const failures = scenario.events.filter(
      (e) => e.type === 'tool_use.end' && (e as ToolUseEndEvent).success === false,
    )
    expect(failures.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Scenario: minimal_session
// ---------------------------------------------------------------------------

describe('scenario: minimal_session', () => {
  let scenario: Scenario

  beforeAll(() => {
    scenario = scenarios.find((s) => s.name === 'minimal_session')!
  })

  it('exists', () => {
    expect(scenario).toBeDefined()
  })

  it('has exactly: session.start, message.start, content.text, message.end, session.end', () => {
    const types = scenario.events.map((e) => e.type)
    expect(types).toEqual([
      'session.start',
      'message.start',
      'content.text',
      'message.end',
      'session.end',
    ])
  })

  it('has no tool calls', () => {
    const tools = scenario.events.filter(
      (e) => e.type === 'tool_use.start' || e.type === 'tool_use.end',
    )
    expect(tools.length).toBe(0)
  })

  it('session.end has low cost for minimal work', () => {
    const end = scenario.events.find((e) => e.type === 'session.end') as SessionEndEvent
    expect(end.cost).toBeLessThan(0.01)
    expect(end.turns).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Scenario: no_cost_session
// ---------------------------------------------------------------------------

describe('scenario: no_cost_session', () => {
  let scenario: Scenario

  beforeAll(() => {
    scenario = scenarios.find((s) => s.name === 'no_cost_session')!
  })

  it('exists', () => {
    expect(scenario).toBeDefined()
  })

  it('session.end has no cost field', () => {
    const end = scenario.events.find((e) => e.type === 'session.end') as SessionEndEvent
    expect(end).toBeDefined()
    expect(end.cost).toBeUndefined()
  })

  it('session.end still has token counts', () => {
    const end = scenario.events.find((e) => e.type === 'session.end') as SessionEndEvent
    expect(end.input_tokens).toBeTypeOf('number')
    expect(end.output_tokens).toBeTypeOf('number')
  })

  it('uses a non-commercial model name', () => {
    const start = scenario.events.find(
      (e) => e.type === 'session.start',
    ) as SessionStartEvent
    expect(start.model).toContain('local')
  })
})

// ---------------------------------------------------------------------------
// Scenario: unicode_and_special_chars
// ---------------------------------------------------------------------------

describe('scenario: unicode_and_special_chars', () => {
  let scenario: Scenario

  beforeAll(() => {
    scenario = scenarios.find((s) => s.name === 'unicode_and_special_chars')!
  })

  it('exists', () => {
    expect(scenario).toBeDefined()
  })

  it('contains CJK characters in text events', () => {
    const texts = scenario.events.filter(
      (e) => e.type === 'content.text',
    ) as ContentTextEvent[]
    const hasCJK = texts.some((t) => t.text && /[\u3000-\u9fff\u4e00-\u9fff]/.test(t.text))
    expect(hasCJK).toBe(true)
  })

  it('contains emoji', () => {
    const texts = scenario.events.filter(
      (e) => e.type === 'content.text',
    ) as ContentTextEvent[]
    const hasEmoji = texts.some(
      (t) => t.text && /[\u{1F300}-\u{1F9FF}]/u.test(t.text),
    )
    expect(hasEmoji).toBe(true)
  })

  it('file.change creates an i18n file', () => {
    const changes = scenario.events.filter(
      (e) => e.type === 'file.change',
    ) as FileChangeEvent[]
    const i18nFile = changes.some((c) => c.path?.includes('i18n'))
    expect(i18nFile).toBe(true)
  })

  it('all events are valid JSON despite special characters', () => {
    for (const line of scenario.lines) {
      if (line.parsed !== null) {
        // Re-parse to verify round-trip
        expect(() => JSON.parse(line.raw)).not.toThrow()
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Cross-scenario structural checks
// ---------------------------------------------------------------------------

describe('cross-scenario validation', () => {
  it('all event types used in fixtures are known (except intentional unknowns in malformed)', () => {
    const malformedScenario = scenarios.find((s) => s.name === 'malformed_json')
    const nonMalformed = scenarios.filter((s) => s.name !== 'malformed_json' && s.name !== 'incomplete_fields')

    for (const scenario of nonMalformed) {
      for (const event of scenario.events) {
        expect(
          (KNOWN_EVENT_TYPES as readonly string[]).includes(event.type),
          `Unknown event type "${event.type}" in scenario "${scenario.name}"`,
        ).toBe(true)
      }
    }

    // Malformed scenario should have at least one unknown type
    if (malformedScenario) {
      const hasUnknown = malformedScenario.events.some(
        (e) => !(KNOWN_EVENT_TYPES as readonly string[]).includes(e.type),
      )
      expect(hasUnknown).toBe(true)
    }
  })

  it('sessions with session.end always have session.start before it', () => {
    for (const scenario of scenarios) {
      const endIdx = scenario.events.findIndex((e) => e.type === 'session.end')
      if (endIdx > -1) {
        const startIdx = scenario.events.findIndex((e) => e.type === 'session.start')
        expect(
          startIdx,
          `session.end without session.start in "${scenario.name}"`,
        ).toBeGreaterThanOrEqual(0)
        expect(
          startIdx,
          `session.start after session.end in "${scenario.name}"`,
        ).toBeLessThan(endIdx)
      }
    }
  })

  it('message.end events always follow a message.start', () => {
    for (const scenario of scenarios) {
      // Skip malformed and incomplete — they may have partial sequences
      if (scenario.name === 'malformed_json' || scenario.name === 'incomplete_fields') continue

      let messageDepth = 0
      for (const event of scenario.events) {
        if (event.type === 'message.start') messageDepth++
        if (event.type === 'message.end') {
          expect(
            messageDepth,
            `message.end without preceding message.start in "${scenario.name}"`,
          ).toBeGreaterThan(0)
          messageDepth--
        }
      }
    }
  })

  it('tool_use.start is always followed by tool_use.end (in complete sessions)', () => {
    const completeScenarios = scenarios.filter(
      (s) =>
        s.name !== 'malformed_json' &&
        s.name !== 'incomplete_fields' &&
        s.name !== 'error_session',
    )

    for (const scenario of completeScenarios) {
      const starts = scenario.events.filter((e) => e.type === 'tool_use.start').length
      const ends = scenario.events.filter((e) => e.type === 'tool_use.end').length
      expect(
        starts,
        `Unmatched tool_use pairs in "${scenario.name}": ${starts} starts vs ${ends} ends`,
      ).toBe(ends)
    }
  })

  it('total valid events across all scenarios is reasonable (50+)', () => {
    expect(validEvents.length).toBeGreaterThanOrEqual(50)
  })
})

// ---------------------------------------------------------------------------
// handleStreamLine compatibility checks (adapter contract validation)
// ---------------------------------------------------------------------------

describe('adapter contract: handleStreamLine compatibility', () => {
  /**
   * Minimal reimplementation of OpenClawAdapter.handleStreamLine to verify
   * fixtures produce the expected calls. This mirrors the adapter's logic
   * without importing from the submodule.
   */
  function simulateHandleStreamLine(line: string): {
    calls: { method: string; args: unknown[] }[]
    metrics?: Record<string, unknown>
  } {
    const calls: { method: string; args: unknown[] }[] = []

    try {
      const event = JSON.parse(line) as Record<string, unknown>
      const type = event.type as string

      switch (type) {
        case 'session.start': {
          const sessionId = event.session_id as string | undefined
          const model = event.model as string | undefined
          if (sessionId) {
            calls.push({ method: 'sessionInit', args: [sessionId, model] })
          }
          break
        }
        case 'message.start':
          calls.push({ method: 'status', args: ['running', undefined, 'Agent thinking...'] })
          break
        case 'content.text': {
          const text = event.text as string | undefined
          if (text) {
            calls.push({ method: 'text', args: [text] })
          }
          break
        }
        case 'tool_use.start': {
          const toolName = (event.tool_name as string) || 'unknown'
          const toolInput = event.tool_input ?? {}
          calls.push({ method: 'toolUse', args: [toolName, toolInput] })
          break
        }
        case 'tool_use.end': {
          const toolName = (event.tool_name as string) || 'unknown'
          const result = event.result
          const success = event.success !== false
          calls.push({ method: 'toolResult', args: [toolName, result, success] })
          break
        }
        case 'file.change': {
          const path = event.path as string
          const action = (event.action as string) || 'modified'
          const linesAdded = event.lines_added as number | undefined
          const linesRemoved = event.lines_removed as number | undefined
          if (path) {
            calls.push({
              method: 'fileChange',
              args: [path, action, linesAdded, linesRemoved],
            })
          }
          break
        }
        case 'message.end':
          calls.push({ method: 'status', args: ['running', undefined, 'Turn complete'] })
          break
        case 'session.end': {
          const cost = event.cost as number | undefined
          const turns = event.turns as number | undefined
          if (cost !== undefined) {
            calls.push({
              method: 'status',
              args: ['running', 100, `Completed (${turns ?? 0} turns, $${cost.toFixed(4)})`],
            })
          } else {
            calls.push({ method: 'status', args: ['running', 100, 'Completed'] })
          }
          return {
            calls,
            metrics: {
              totalCost: event.cost,
              inputTokens: event.input_tokens,
              outputTokens: event.output_tokens,
              numTurns: event.turns,
              model: event.model,
              durationMs: event.duration_ms,
            },
          }
        }
        default:
          break
      }
    } catch {
      calls.push({ method: 'stdout', args: [line + '\n'] })
    }

    return { calls }
  }

  it('happy_path produces sessionInit, text, toolUse, toolResult, fileChange, status calls', () => {
    const scenario = scenarios.find((s) => s.name === 'happy_path')!
    const allCalls: { method: string; args: unknown[] }[] = []
    let finalMetrics: Record<string, unknown> | undefined

    for (const event of scenario.events) {
      const result = simulateHandleStreamLine(JSON.stringify(event))
      allCalls.push(...result.calls)
      if (result.metrics) finalMetrics = result.metrics
    }

    const methods = new Set(allCalls.map((c) => c.method))
    expect(methods).toContain('sessionInit')
    expect(methods).toContain('text')
    expect(methods).toContain('toolUse')
    expect(methods).toContain('toolResult')
    expect(methods).toContain('fileChange')
    expect(methods).toContain('status')

    expect(finalMetrics).toBeDefined()
    expect(finalMetrics?.totalCost).toBeTypeOf('number')
  })

  it('malformed lines produce stdout calls', () => {
    const malformed = scenarios.find((s) => s.name === 'malformed_json')!
    let stdoutCalls = 0

    for (const line of malformed.lines) {
      if (line.isBlank) continue
      const result = simulateHandleStreamLine(line.raw.trim())
      stdoutCalls += result.calls.filter((c) => c.method === 'stdout').length
    }

    expect(stdoutCalls).toBeGreaterThanOrEqual(1)
  })

  it('no_cost session.end produces "Completed" without cost', () => {
    const scenario = scenarios.find((s) => s.name === 'no_cost_session')!
    const endEvent = scenario.events.find((e) => e.type === 'session.end')!
    const result = simulateHandleStreamLine(JSON.stringify(endEvent))

    const statusCall = result.calls.find((c) => c.method === 'status')
    expect(statusCall).toBeDefined()
    expect(statusCall!.args[2]).toBe('Completed')
  })

  it('tool_failure scenario produces mixed success/failure toolResult calls', () => {
    const scenario = scenarios.find((s) => s.name === 'tool_failure')!
    const allCalls: { method: string; args: unknown[] }[] = []

    for (const event of scenario.events) {
      const result = simulateHandleStreamLine(JSON.stringify(event))
      allCalls.push(...result.calls)
    }

    const toolResults = allCalls.filter((c) => c.method === 'toolResult')
    const successes = toolResults.filter((c) => c.args[2] === true)
    const failures = toolResults.filter((c) => c.args[2] === false)

    expect(successes.length).toBeGreaterThanOrEqual(1)
    expect(failures.length).toBeGreaterThanOrEqual(1)
  })
})
