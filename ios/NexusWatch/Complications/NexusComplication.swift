import WidgetKit
import SwiftUI

// MARK: - Complication Provider

struct NexusComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> NexusComplicationEntry {
        NexusComplicationEntry(date: .now, pendingDecisions: 2, activeTasks: 3, tasksCompleted: 12)
    }

    func getSnapshot(in context: Context, completion: @escaping (NexusComplicationEntry) -> Void) {
        completion(placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NexusComplicationEntry>) -> Void) {
        Task {
            let entry = await fetchData()
            let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: .now)!
            let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
            completion(timeline)
        }
    }

    private func fetchData() async -> NexusComplicationEntry {
        do {
            let stats = try await WatchAPI.shared.getStats()
            return NexusComplicationEntry(
                date: .now,
                pendingDecisions: stats.pendingDecisions,
                activeTasks: stats.activeTasks,
                tasksCompleted: stats.tasksCompleted
            )
        } catch {
            return NexusComplicationEntry(date: .now, pendingDecisions: 0, activeTasks: 0, tasksCompleted: 0)
        }
    }
}

// MARK: - Entry

struct NexusComplicationEntry: TimelineEntry {
    let date: Date
    let pendingDecisions: Int
    let activeTasks: Int
    let tasksCompleted: Int
}

// MARK: - Complication Views

struct NexusComplicationView: View {
    let entry: NexusComplicationEntry
    @SwiftUI.Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            circularView
        case .accessoryRectangular:
            rectangularView
        case .accessoryCorner:
            cornerView
        case .accessoryInline:
            inlineView
        default:
            circularView
        }
    }

    private var circularView: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                if entry.pendingDecisions > 0 {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                    Text("\(entry.pendingDecisions)")
                        .font(.title3.bold().monospacedDigit())
                } else {
                    Image(systemName: "hexagon.fill")
                        .font(.caption)
                    Text("\(entry.activeTasks)")
                        .font(.title3.bold().monospacedDigit())
                }
            }
        }
    }

    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: "hexagon.fill")
                    .font(.caption2)
                Text("Nexus")
                    .font(.caption2.bold())
            }

            HStack(spacing: 8) {
                Label("\(entry.pendingDecisions)", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(entry.pendingDecisions > 0 ? .orange : .secondary)

                Label("\(entry.activeTasks)", systemImage: "bolt.fill")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.blue)

                Label("\(entry.tasksCompleted)", systemImage: "checkmark.circle")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.green)
            }
        }
    }

    private var cornerView: some View {
        ZStack {
            if entry.pendingDecisions > 0 {
                Text("\(entry.pendingDecisions)")
                    .font(.title3.bold().monospacedDigit())
                    .widgetLabel {
                        Text("Decisions")
                    }
            } else {
                Text("\(entry.activeTasks)")
                    .font(.title3.bold().monospacedDigit())
                    .widgetLabel {
                        Text("Active")
                    }
            }
        }
    }

    private var inlineView: some View {
        HStack(spacing: 4) {
            if entry.pendingDecisions > 0 {
                Image(systemName: "exclamationmark.triangle.fill")
                Text("\(entry.pendingDecisions) decisions")
            } else {
                Image(systemName: "hexagon.fill")
                Text("\(entry.activeTasks) active")
            }
        }
    }
}

// MARK: - Widget Configuration

struct NexusComplicationWidget: Widget {
    let kind = "NexusComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NexusComplicationProvider()) { entry in
            NexusComplicationView(entry: entry)
        }
        .configurationDisplayName("Nexus Status")
        .description("Track pending decisions and active tasks.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryCorner,
            .accessoryInline,
        ])
    }
}
