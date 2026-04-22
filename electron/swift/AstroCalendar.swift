import Foundation
import EventKit
#if canImport(AppKit)
import AppKit
#endif

// ── Helpers ───────────────────────────────────────────────────────────────────

let store = EKEventStore()
let iso = ISO8601DateFormatter()

func requestAccess(to entityType: EKEntityType) -> Bool {
    let sem = DispatchSemaphore(value: 0)
    var granted = false
    if #available(macOS 14.0, *) {
        if entityType == .event {
            store.requestFullAccessToEvents { g, _ in granted = g; sem.signal() }
        } else {
            store.requestFullAccessToReminders { g, _ in granted = g; sem.signal() }
        }
    } else {
        store.requestAccess(to: entityType) { g, _ in granted = g; sem.signal() }
    }
    sem.wait()
    return granted
}

func colorHex(_ color: NSColor?) -> String? {
    guard let c = color?.usingColorSpace(.sRGB) else { return nil }
    return String(format: "#%02x%02x%02x",
        Int(c.redComponent * 255),
        Int(c.greenComponent * 255),
        Int(c.blueComponent * 255))
}

func emit(_ obj: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}

func parseArg(_ name: String) -> String? {
    let args = CommandLine.arguments
    for i in 0..<args.count - 1 where args[i] == name { return args[i + 1] }
    return nil
}

// ── Commands ──────────────────────────────────────────────────────────────────

let command = CommandLine.arguments.count >= 2 ? CommandLine.arguments[1] : ""

switch command {

// ── list-calendars ────────────────────────────────────────────────────────────
case "list-calendars":
    guard requestAccess(to: .event) else {
        emit(["error": "permission_denied", "calendars": [] as [Any]])
        exit(0)
    }
    let calendars: [[String: Any]] = store.calendars(for: .event).map { cal in
        var d: [String: Any] = [
            "id": cal.calendarIdentifier,
            "name": cal.title,
            "isSubscribed": cal.isSubscribed,
            "isWritable": !cal.isImmutable,
        ]
        if let hex = colorHex(cal.color) { d["color"] = hex }
        return d
    }
    emit(["calendars": calendars])

// ── list-events ───────────────────────────────────────────────────────────────
case "list-events":
    let fromDate = parseArg("--from").flatMap { iso.date(from: $0) } ?? Date().addingTimeInterval(-7 * 86400)
    let toDate   = parseArg("--to").flatMap   { iso.date(from: $0) } ?? Date().addingTimeInterval(7 * 86400)

    guard requestAccess(to: .event) else {
        emit(["error": "permission_denied", "events": [] as [Any]])
        exit(0)
    }
    let predicate = store.predicateForEvents(withStart: fromDate, end: toDate, calendars: nil)
    let events: [[String: Any]] = store.events(matching: predicate).map { ev in
        var d: [String: Any] = [
            "id":           ev.eventIdentifier ?? UUID().uuidString,
            "calendarId":   ev.calendar.calendarIdentifier,
            "calendarName": ev.calendar.title,
            "title":        ev.title ?? "",
            "startDate":    iso.string(from: ev.startDate),
            "endDate":      iso.string(from: ev.endDate ?? ev.startDate),
            "allDay":       ev.isAllDay,
            "isRecurring":  ev.hasRecurrenceRules,
        ]
        if let hex   = colorHex(ev.calendar.color) { d["calendarColor"] = hex }
        if let notes = ev.notes,    !notes.isEmpty    { d["notes"]    = notes }
        if let loc   = ev.location, !loc.isEmpty      { d["location"] = loc }
        if let url   = ev.url                         { d["url"]      = url.absoluteString }
        return d
    }
    emit(["events": events])

// ── create-event ──────────────────────────────────────────────────────────────
case "create-event":
    let inputData = FileHandle.standardInput.readDataToEndOfFile()
    guard let input = try? JSONSerialization.jsonObject(with: inputData) as? [String: Any] else {
        emit(["error": "invalid_input", "id": "", "ok": false])
        exit(1)
    }
    guard requestAccess(to: .event) else {
        emit(["error": "permission_denied", "id": "", "ok": false])
        exit(0)
    }
    let ev = EKEvent(eventStore: store)
    ev.title   = input["title"] as? String ?? ""
    ev.isAllDay = input["allDay"] as? Bool ?? false
    if let s = (input["startDate"] as? String).flatMap({ iso.date(from: $0) }) { ev.startDate = s }
    if let e = (input["endDate"]   as? String).flatMap({ iso.date(from: $0) }) { ev.endDate   = e }
    if let notes = input["notes"] as? String { ev.notes = notes }
    if let calName = input["calendarName"] as? String {
        ev.calendar = store.calendars(for: .event).first { $0.title == calName }
            ?? store.defaultCalendarForNewEvents
    } else {
        ev.calendar = store.defaultCalendarForNewEvents
    }
    do {
        try store.save(ev, span: .thisEvent)
        emit(["id": ev.eventIdentifier ?? "", "ok": true])
    } catch {
        emit(["error": error.localizedDescription, "id": "", "ok": false])
    }

// ── delete-event ──────────────────────────────────────────────────────────────
case "delete-event":
    guard let eventId = parseArg("--id") else {
        emit(["error": "missing --id", "ok": false])
        exit(1)
    }
    guard requestAccess(to: .event) else {
        emit(["error": "permission_denied", "ok": false])
        exit(0)
    }
    if let ev = store.event(withIdentifier: eventId) {
        do {
            try store.remove(ev, span: .thisEvent)
            emit(["ok": true])
        } catch {
            emit(["error": error.localizedDescription, "ok": false])
        }
    } else {
        emit(["ok": false, "error": "event_not_found"])
    }

default:
    fputs("astro-calendar: unknown command '\(command)'\n", stderr)
    exit(1)
}
