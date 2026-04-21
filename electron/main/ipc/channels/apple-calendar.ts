/**
 * Apple Calendar / Reminders integration for macOS.
 *
 * Strategy:
 * 1. Primary: AppleScript via osascript (requires TCC calendar permission).
 * 2. Fallback: Parse ~/.../Calendars/**\/*.ics files (read-only, no TCC needed).
 *
 * Permission: Add NSCalendarsUsageDescription to Info.plist and
 * com.apple.security.personal-information.calendars to entitlements.
 * The TCC dialog fires automatically on first osascript call.
 */

import { defineHandler } from '../registry.js'
import { z } from 'zod'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const execAsync = promisify(exec)

// ── Types ─────────────────────────────────────────────────────────────

export interface AppleCalendarEvent {
  id: string
  calendarId: string
  calendarName: string
  calendarColor: string | null
  title: string
  startDate: string  // ISO 8601
  endDate: string    // ISO 8601
  allDay: boolean
  notes: string | null
  location: string | null
  url: string | null
  isRecurring: boolean
}

export interface AppleCalendarInfo {
  id: string
  name: string
  color: string | null
  isSubscribed: boolean
  isWritable: boolean
}

// ── AppleScript helpers ───────────────────────────────────────────────

/**
 * Convert a macOS AppleScript date string to ISO 8601.
 * AppleScript returns dates like "Wednesday, April 21, 2026 at 9:00:00 AM"
 */
function parseAppleDate(s: string): string {
  try {
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d.toISOString()
  } catch { /* fall through */ }
  return new Date().toISOString()
}

async function runAppleScript(script: string, timeoutMs = 15000): Promise<string> {
  const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  })
  return stdout.trim()
}

/**
 * Produce a valid AppleScript string literal for arbitrary user input.
 * AppleScript has no backslash escapes inside string literals; double-quotes
 * must be expressed via concatenation with the built-in `quote` constant.
 * Control characters that could break script structure are stripped.
 */
function asString(value: string): string {
  // Strip control characters (newlines, tabs, etc.) that could break the script
  // eslint-disable-next-line no-control-regex
  const safe = value.replace(/[\x00-\x1f\x7f]/g, ' ')
  const parts = safe.split('"')
  if (parts.length === 1) return `"${safe}"`
  return parts.map(p => `"${p}"`).join(' & quote & ')
}

async function listEventsViaAppleScript(from: string, to: string): Promise<AppleCalendarEvent[] | null> {
  // AppleScript to list events across all calendars in a date range.
  // Returns pipe-delimited records: uid|summary|startDate|endDate|allDay|description|location|url|calName|calId
  const script = `
    set fromDate to date "${new Date(from).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}"
    set toDate to date "${new Date(to).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}"
    set toDate to toDate + (86400 * time scale)
    set output to {}
    tell application "Calendar"
      repeat with aCal in every calendar
        set calName to name of aCal
        set calId to uid of aCal
        try
          set calEvents to every event of aCal whose start date >= fromDate and start date <= toDate
          repeat with anEvent in calEvents
            try
              set evId to uid of anEvent
              set evTitle to summary of anEvent
              set evStart to start date of anEvent as string
              set evEnd to end date of anEvent as string
              set evAllDay to allday event of anEvent as string
              set evDesc to ""
              try
                set evDesc to description of anEvent
                if evDesc is missing value then set evDesc to ""
              end try
              set evLoc to ""
              try
                set evLoc to location of anEvent
                if evLoc is missing value then set evLoc to ""
              end try
              set evUrl to ""
              try
                set evUrl to url of anEvent
                if evUrl is missing value then set evUrl to ""
              end try
              set record to evId & "|" & evTitle & "|" & evStart & "|" & evEnd & "|" & evAllDay & "|" & evDesc & "|" & evLoc & "|" & evUrl & "|" & calName & "|" & calId
              set end of output to record
            end try
          end repeat
        end try
      end repeat
    end tell
    set AppleScript's text item delimiters to "\\n"
    set outputStr to output as string
    set AppleScript's text item delimiters to ""
    return outputStr
  `

  try {
    const raw = await runAppleScript(script, 20000)
    if (!raw) return []

    const events: AppleCalendarEvent[] = []
    for (const line of raw.split('\n')) {
      const parts = line.split('|')
      if (parts.length < 10) continue
      const [evId, evTitle, evStart, evEnd, evAllDay,, evLoc, evUrl,, calId] = parts
      const calName = parts[8] ?? ''
      events.push({
        id: evId?.trim() ?? `cal-${Math.random()}`,
        calendarId: calId?.trim() ?? '',
        calendarName: calName?.trim() ?? '',
        calendarColor: null,
        title: evTitle?.trim() ?? '(untitled)',
        startDate: parseAppleDate(evStart?.trim() ?? ''),
        endDate: parseAppleDate(evEnd?.trim() ?? ''),
        allDay: evAllDay?.trim() === 'true',
        notes: null,
        location: evLoc?.trim() || null,
        url: evUrl?.trim() || null,
        isRecurring: false,
      })
    }
    return events
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // TCC error codes: 1743 = "not authorized to send Apple events to Calendar"
    if (msg.includes('Not authorized') || msg.includes('1743') || msg.includes('not allowed to send') || msg.includes('NSAppleEventsUsageDescription')) {
      return null // permission denied signal
    }
    // Other errors (Calendar.app not running, timeout, etc.) — not a permission issue
    console.error('[apple-calendar] AppleScript error:', msg)
    return []
  }
}

async function listCalendarsViaAppleScript(): Promise<AppleCalendarInfo[] | null> {
  const script = `
    set output to {}
    tell application "Calendar"
      repeat with aCal in every calendar
        set calId to uid of aCal
        set calName to name of aCal
        set record to calId & "|" & calName
        set end of output to record
      end repeat
    end tell
    set AppleScript's text item delimiters to "\\n"
    set outputStr to output as string
    set AppleScript's text item delimiters to ""
    return outputStr
  `
  try {
    const raw = await runAppleScript(script, 10000)
    if (!raw) return []
    return raw.split('\n').filter(Boolean).map((line) => {
      const [id, name] = line.split('|')
      return { id: id?.trim() ?? '', name: name?.trim() ?? '', color: null, isSubscribed: false, isWritable: true }
    })
  } catch {
    return null
  }
}

async function createEventViaAppleScript(req: {
  calendarName?: string
  title: string
  startDate: string
  endDate: string
  allDay?: boolean
  notes?: string
}): Promise<{ id: string; ok: boolean }> {
  const calRef = req.calendarName
    ? `first calendar whose name is ${asString(req.calendarName)}`
    : 'first calendar'
  const startD = new Date(req.startDate)
  const endD = new Date(req.endDate)
  if (isNaN(startD.getTime()) || isNaN(endD.getTime()) || endD < startD) {
    console.error('[apple-calendar] Invalid date range: endDate must be >= startDate')
    return { id: '', ok: false }
  }
  const startStr = startD.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true })
  const endStr = endD.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true })
  const notesLine = req.notes ? `\nset description of newEvent to ${asString(req.notes)}` : ''
  const allDay = req.allDay ? '\nset allday event of newEvent to true' : ''

  const script = `
    tell application "Calendar"
      set targetCal to ${calRef}
      set newEvent to make new event at end of events of targetCal with properties {summary:${asString(req.title)}, start date:date "${startStr}", end date:date "${endStr}"}${notesLine}${allDay}
      set evId to uid of newEvent
      return evId
    end tell
  `
  try {
    const id = await runAppleScript(script, 10000)
    return { id: id.trim(), ok: true }
  } catch (err) {
    console.error('[apple-calendar] create failed:', err)
    return { id: '', ok: false }
  }
}

async function deleteEventViaAppleScript(eventId: string): Promise<boolean> {
  const script = `
    tell application "Calendar"
      set targetEvent to first event of every calendar whose uid is "${eventId.replace(/"/g, '\\"')}"
      if targetEvent is not {} then
        delete item 1 of targetEvent
        return "ok"
      end if
      return "not-found"
    end tell
  `
  try {
    const result = await runAppleScript(script, 10000)
    return result.includes('ok')
  } catch {
    return false
  }
}

// ── ICS fallback ──────────────────────────────────────────────────────

function findICSFiles(): string[] {
  const calDir = path.join(os.homedir(), 'Library', 'Calendars')
  if (!fs.existsSync(calDir)) return []
  const files: string[] = []
  function walk(dir: string) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ics')) files.push(full)
      }
    } catch { /* ignore permission errors */ }
  }
  walk(calDir)
  return files.slice(0, 500) // cap at 500 files
}

function parseICSEvents(content: string, from: Date, to: Date): AppleCalendarEvent[] {
  const events: AppleCalendarEvent[] = []
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let current: Partial<AppleCalendarEvent> | null = null
  let uid = ''
  let dtStart = ''
  let dtEnd = ''
  let summary = ''
  let description = ''
  let location = ''

  const parseICSDate = (val: string): string => {
    // YYYYMMDDTHHMMSSZ or YYYYMMDD
    const v = val.split(';').pop() ?? val // handle VALUE=DATE: prefix
    if (v.length === 8) {
      const y = v.slice(0, 4), m = v.slice(4, 6), d = v.slice(6, 8)
      return `${y}-${m}-${d}T00:00:00.000Z`
    }
    if (v.length >= 15) {
      const y = v.slice(0, 4), mo = v.slice(4, 6), d = v.slice(6, 8)
      const h = v.slice(9, 11), mi = v.slice(11, 13), s = v.slice(13, 15)
      return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`
    }
    return new Date().toISOString()
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (line === 'BEGIN:VEVENT') {
      current = {}; uid = ''; dtStart = ''; dtEnd = ''; summary = ''; description = ''; location = ''
    } else if (line === 'END:VEVENT' && current !== null) {
      if (uid && dtStart) {
        const start = new Date(parseICSDate(dtStart))
        if (start >= from && start <= to) {
          events.push({
            id: uid,
            calendarId: 'ics-fallback',
            calendarName: 'Calendar (offline)',
            calendarColor: null,
            title: summary || '(untitled)',
            startDate: parseICSDate(dtStart),
            endDate: dtEnd ? parseICSDate(dtEnd) : parseICSDate(dtStart),
            allDay: dtStart.length === 8,
            notes: description || null,
            location: location || null,
            url: null,
            isRecurring: false,
          })
        }
      }
      current = null
    } else if (current !== null) {
      if (line.startsWith('UID:')) uid = line.slice(4)
      else if (line.startsWith('DTSTART')) dtStart = line.split(':').slice(1).join(':')
      else if (line.startsWith('DTEND')) dtEnd = line.split(':').slice(1).join(':')
      else if (line.startsWith('SUMMARY:')) summary = line.slice(8)
      else if (line.startsWith('DESCRIPTION:')) description = line.slice(12)
      else if (line.startsWith('LOCATION:')) location = line.slice(9)
    }
  }
  return events
}

async function listEventsViaICS(from: string, to: string): Promise<AppleCalendarEvent[]> {
  const files = findICSFiles()
  const fromDate = new Date(from)
  const toDate = new Date(to)
  const events: AppleCalendarEvent[] = []

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8')
      events.push(...parseICSEvents(content, fromDate, toDate))
    } catch { /* skip unreadable files */ }
  }
  return events
}

// ── IPC Handlers ──────────────────────────────────────────────────────

const appleEventSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  calendarName: z.string(),
  calendarColor: z.string().nullable(),
  title: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  allDay: z.boolean(),
  notes: z.string().nullable(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  isRecurring: z.boolean(),
})

const listEventsSchema = {
  req: z.object({ from: z.string(), to: z.string() }),
  res: z.object({
    events: z.array(appleEventSchema),
    source: z.enum(['applescript', 'ics-fallback']),
    permissionDenied: z.boolean(),
  }),
}

const listCalendarsSchema = {
  req: z.object({}),
  res: z.object({
    calendars: z.array(z.object({
      id: z.string(),
      name: z.string(),
      color: z.string().nullable(),
      isSubscribed: z.boolean(),
      isWritable: z.boolean(),
    })),
  }),
}

const createEventSchema = {
  req: z.object({
    calendarName: z.string().optional(),
    title: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    allDay: z.boolean().optional(),
    notes: z.string().optional(),
  }),
  res: z.object({ id: z.string(), ok: z.boolean() }),
}

const updateEventSchema = {
  req: z.object({
    eventId: z.string(),
    calendarId: z.string(),
    title: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    notes: z.string().optional(),
  }),
  res: z.object({ ok: z.boolean() }),
}

const deleteEventSchema = {
  req: z.object({ eventId: z.string(), calendarId: z.string() }),
  res: z.object({ ok: z.boolean() }),
}

export function registerAppleCalendarChannels(): void {
  // Only register on macOS
  if (process.platform !== 'darwin') return

  defineHandler('apple-calendar:list-events', listEventsSchema, async ({ from, to }) => {
    const appleEvents = await listEventsViaAppleScript(from, to)
    if (appleEvents !== null) {
      return { events: appleEvents, source: 'applescript' as const, permissionDenied: false }
    }

    // Permission denied or error — fall back to ICS
    console.log('[apple-calendar] Falling back to ICS parsing')
    const icsEvents = await listEventsViaICS(from, to)
    return { events: icsEvents, source: 'ics-fallback' as const, permissionDenied: appleEvents === null }
  })

  defineHandler('apple-calendar:list-calendars', listCalendarsSchema, async () => {
    const cals = await listCalendarsViaAppleScript()
    return { calendars: cals ?? [] }
  })

  defineHandler('apple-calendar:create-event', createEventSchema, async (req) => {
    return createEventViaAppleScript(req)
  })

  defineHandler('apple-calendar:update-event', updateEventSchema, async ({ eventId }) => {
    // Simplified: delete + recreate for now (full update is complex in AppleScript)
    console.log('[apple-calendar] update not yet fully implemented for eventId:', eventId)
    return { ok: false }
  })

  defineHandler('apple-calendar:delete-event', deleteEventSchema, async ({ eventId }) => {
    const ok = await deleteEventViaAppleScript(eventId)
    return { ok }
  })
}
