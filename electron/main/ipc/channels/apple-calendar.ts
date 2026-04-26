/**
 * Apple Calendar integration via a bundled Swift helper binary (AstroCalendar).
 *
 * The Swift binary calls EventKit directly, which produces a proper TCC
 * prompt attributed to Astro.app (responsible-process chain).  No AppleScript
 * or NSAppleEventsUsageDescription needed.
 *
 * Binary path:
 *   packaged  → Contents/Resources/binaries/astro-calendar
 *   dev       → electron/resources/binaries/astro-calendar
 *
 * Permission: com.apple.security.personal-information.calendars in entitlements
 *             NSCalendarsUsageDescription in Info.plist
 */

import { app } from 'electron'
import { defineHandler } from '../registry.js'
import { z } from 'zod'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppleCalendarEvent {
  id: string
  calendarId: string
  calendarName: string
  calendarColor: string | null
  title: string
  startDate: string
  endDate: string
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

// ── Helper binary ─────────────────────────────────────────────────────────────

function getHelperPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'binaries', 'astro-calendar')
  }
  // dev: .vite/build/index.js → ../../electron/resources/binaries/astro-calendar
  return path.resolve(__dirname, '../../electron/resources/binaries/astro-calendar')
}

async function runHelper(args: string[], stdinJson?: unknown): Promise<unknown> {
  const bin = getHelperPath()
  if (!fs.existsSync(bin)) {
    throw new Error(`astro-calendar binary not found at ${bin}. Run npm run build:calendar-helper.`)
  }

  const cmd = `"${bin}" ${args.map(a => `"${a}"`).join(' ')}`
  const opts: Parameters<typeof execAsync>[1] = {
    timeout: 20000,
    maxBuffer: 50 * 1024 * 1024,
  }
  if (stdinJson !== undefined) {
    // pipe JSON via stdin for create-event
    const { stdout } = await execAsync(
      `echo '${JSON.stringify(stdinJson).replace(/'/g, "'\\''")}' | "${bin}" ${args.join(' ')}`,
      opts,
    )
    return JSON.parse(String(stdout).trim())
  }
  const { stdout } = await execAsync(cmd, opts)
  return JSON.parse(String(stdout).trim())
}

// ── ICS fallback (read-only, no TCC) ─────────────────────────────────────────

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
    } catch { /* ignore */ }
  }
  walk(calDir)
  return files.slice(0, 500)
}

function parseICSDate(val: string): string {
  const v = val.split(';').pop() ?? val
  if (v.length === 8) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00.000Z`
  }
  if (v.length >= 15) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}.000Z`
  }
  return new Date().toISOString()
}

function parseICSEvents(content: string, from: Date, to: Date): AppleCalendarEvent[] {
  const events: AppleCalendarEvent[] = []
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let uid = '', dtStart = '', dtEnd = '', summary = '', description = '', location = ''
  let inEvent = false

  for (const raw of lines) {
    const line = raw.trim()
    if (line === 'BEGIN:VEVENT') {
      inEvent = true; uid = ''; dtStart = ''; dtEnd = ''; summary = ''; description = ''; location = ''
    } else if (line === 'END:VEVENT' && inEvent) {
      if (uid && dtStart) {
        const start = new Date(parseICSDate(dtStart))
        if (start >= from && start <= to) {
          events.push({
            id: uid, calendarId: 'ics-fallback', calendarName: 'Calendar (offline)',
            calendarColor: null, title: summary || '(untitled)',
            startDate: parseICSDate(dtStart),
            endDate: dtEnd ? parseICSDate(dtEnd) : parseICSDate(dtStart),
            allDay: dtStart.length === 8,
            notes: description || null, location: location || null, url: null, isRecurring: false,
          })
        }
      }
      inEvent = false
    } else if (inEvent) {
      if (line.startsWith('UID:'))         uid = line.slice(4)
      else if (line.startsWith('DTSTART')) dtStart = line.split(':').slice(1).join(':')
      else if (line.startsWith('DTEND'))   dtEnd = line.split(':').slice(1).join(':')
      else if (line.startsWith('SUMMARY:'))     summary = line.slice(8)
      else if (line.startsWith('DESCRIPTION:')) description = line.slice(12)
      else if (line.startsWith('LOCATION:'))    location = line.slice(9)
    }
  }
  return events
}

async function listEventsViaICS(from: string, to: string): Promise<AppleCalendarEvent[]> {
  const files = findICSFiles()
  const fromDate = new Date(from), toDate = new Date(to)
  const events: AppleCalendarEvent[] = []
  for (const file of files) {
    try {
      events.push(...parseICSEvents(fs.readFileSync(file, 'utf-8'), fromDate, toDate))
    } catch { /* skip */ }
  }
  return events
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

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

// ── IPC Handlers ──────────────────────────────────────────────────────────────

export function registerAppleCalendarChannels(): void {
  if (process.platform !== 'darwin') return

  defineHandler(
    'apple-calendar:list-events',
    {
      req: z.object({ from: z.string(), to: z.string() }),
      res: z.object({
        events: z.array(appleEventSchema),
        source: z.enum(['eventkit', 'ics-fallback']),
        permissionDenied: z.boolean(),
      }),
    },
    async ({ from, to }) => {
      try {
        const result = await runHelper(['list-events', '--from', from, '--to', to]) as Record<string, unknown>
        if (result.error === 'permission_denied') {
          const icsEvents = await listEventsViaICS(from, to)
          return { events: icsEvents, source: 'ics-fallback' as const, permissionDenied: true }
        }
        const raw = (result.events ?? []) as Record<string, unknown>[]
        const events: AppleCalendarEvent[] = raw.map(ev => ({
          id:            String(ev.id ?? ''),
          calendarId:    String(ev.calendarId ?? ''),
          calendarName:  String(ev.calendarName ?? ''),
          calendarColor: (ev.calendarColor as string | null) ?? null,
          title:         String(ev.title ?? ''),
          startDate:     String(ev.startDate ?? ''),
          endDate:       String(ev.endDate ?? ''),
          allDay:        Boolean(ev.allDay),
          notes:         (ev.notes as string | null) ?? null,
          location:      (ev.location as string | null) ?? null,
          url:           (ev.url as string | null) ?? null,
          isRecurring:   Boolean(ev.isRecurring),
        }))
        return { events, source: 'eventkit' as const, permissionDenied: false }
      } catch (err) {
        console.error('[apple-calendar] list-events error:', err)
        const icsEvents = await listEventsViaICS(from, to)
        return { events: icsEvents, source: 'ics-fallback' as const, permissionDenied: false }
      }
    },
  )

  defineHandler(
    'apple-calendar:list-calendars',
    {
      req: z.object({}),
      res: z.object({
        calendars: z.array(z.object({
          id: z.string(), name: z.string(), color: z.string().nullable(),
          isSubscribed: z.boolean(), isWritable: z.boolean(),
        })),
      }),
    },
    async () => {
      try {
        const result = await runHelper(['list-calendars']) as Record<string, unknown>
        if (result.error === 'permission_denied') return { calendars: [] }
        const raw = (result.calendars ?? []) as Record<string, unknown>[]
        return {
          calendars: raw.map(c => ({
            id:           String(c.id ?? ''),
            name:         String(c.name ?? ''),
            color:        (c.color as string | null) ?? null,
            isSubscribed: Boolean(c.isSubscribed),
            isWritable:   Boolean(c.isWritable),
          })),
        }
      } catch (err) {
        console.error('[apple-calendar] list-calendars error:', err)
        return { calendars: [] }
      }
    },
  )

  defineHandler(
    'apple-calendar:create-event',
    {
      req: z.object({
        calendarName: z.string().optional(),
        title: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        allDay: z.boolean().optional(),
        notes: z.string().optional(),
      }),
      res: z.object({ id: z.string(), ok: z.boolean() }),
    },
    async (req) => {
      try {
        const result = await runHelper(['create-event'], req) as Record<string, unknown>
        return { id: String(result.id ?? ''), ok: result.ok === true }
      } catch (err) {
        console.error('[apple-calendar] create-event error:', err)
        return { id: '', ok: false }
      }
    },
  )

  defineHandler(
    'apple-calendar:update-event',
    {
      req: z.object({
        eventId: z.string(), calendarId: z.string(),
        title: z.string().optional(), startDate: z.string().optional(),
        endDate: z.string().optional(), notes: z.string().optional(),
      }),
      res: z.object({ ok: z.boolean() }),
    },
    async () => ({ ok: false }), // delete + recreate pattern; not yet implemented
  )

  defineHandler(
    'apple-calendar:list-reminders',
    {
      req: z.object({ from: z.string(), to: z.string() }),
      res: z.object({
        reminders: z.array(z.object({
          id: z.string(),
          calendarId: z.string(),
          calendarName: z.string(),
          calendarColor: z.string().nullable(),
          title: z.string(),
          isCompleted: z.boolean(),
          priority: z.number(),
          dueDate: z.string().nullable(),
          completedDate: z.string().nullable(),
          notes: z.string().nullable(),
        })),
        permissionDenied: z.boolean(),
      }),
    },
    async ({ from, to }) => {
      try {
        const result = await runHelper(['list-reminders', '--from', from, '--to', to]) as Record<string, unknown>
        if (result.error === 'permission_denied') {
          return { reminders: [], permissionDenied: true }
        }
        const raw = (result.reminders ?? []) as Record<string, unknown>[]
        return {
          reminders: raw.map(r => ({
            id:            String(r.id ?? ''),
            calendarId:    String(r.calendarId ?? ''),
            calendarName:  String(r.calendarName ?? ''),
            calendarColor: (r.calendarColor as string | null) ?? null,
            title:         String(r.title ?? ''),
            isCompleted:   Boolean(r.isCompleted),
            priority:      Number(r.priority ?? 0),
            dueDate:       (r.dueDate as string | null) ?? null,
            completedDate: (r.completedDate as string | null) ?? null,
            notes:         (r.notes as string | null) ?? null,
          })),
          permissionDenied: false,
        }
      } catch (err) {
        console.error('[apple-calendar] list-reminders error:', err)
        return { reminders: [], permissionDenied: false }
      }
    },
  )

  defineHandler(
    'apple-calendar:delete-event',
    {
      req: z.object({ eventId: z.string(), calendarId: z.string() }),
      res: z.object({ ok: z.boolean() }),
    },
    async ({ eventId }) => {
      try {
        const result = await runHelper(['delete-event', '--id', eventId]) as Record<string, unknown>
        return { ok: result.ok === true }
      } catch (err) {
        console.error('[apple-calendar] delete-event error:', err)
        return { ok: false }
      }
    },
  )
}
