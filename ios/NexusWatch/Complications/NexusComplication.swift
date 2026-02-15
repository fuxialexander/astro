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
            VStack(spacing: 1) {
                if entry.pendingDecisions > 0 {
                    Text("\(entry.pendingDecisions)")
                        .font(.system(size: 16, weight: .bold))
                        .monospacedDigit()
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(.orange.opacity(0.5))
                } else if entry.activeTasks > 0 {
                    Text("\(entry.activeTasks)")
                        .font(.system(size: 16, weight: .bold))
                        .monospacedDigit()
                    Image(systemName: "cpu")
                        .font(.system(size: 10))
                        .foregroundStyle(.blue.opacity(0.5))
                } else {
                    Text("\(entry.tasksCompleted)")
                        .font(.system(size: 14, weight: .bold))
                        .monospacedDigit()
                    Text("%")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(.green.opacity(0.5))
                }
            }
        }
    }

    private var rectangularView: some View {
        HStack(spacing: 10) {
            // Progress ring or icon
            if entry.activeTasks > 0 {
                ZStack {
                    Circle()
                        .stroke(Color.blue.opacity(0.3), lineWidth: 2.5)
                        .frame(width: 34, height: 34)

                    Circle()
                        .trim(from: 0, to: 0.67)
                        .stroke(Color.blue, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .frame(width: 34, height: 34)
                        .rotationEffect(.degrees(-90))

                    Text("\(entry.activeTasks)")
                        .font(.system(size: 12, weight: .bold))
                        .monospacedDigit()
                }
            } else {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(.orange)
                    .frame(width: 34, height: 34)
            }

            VStack(alignment: .leading, spacing: 1) {
                if entry.activeTasks > 0 {
                    Text("Running")
                        .font(.system(size: 10, weight: .semibold))
                    Text("\(entry.activeTasks) agents")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                } else if entry.pendingDecisions > 0 {
                    Text("Decisions")
                        .font(.system(size: 10, weight: .semibold))
                    Text("\(entry.pendingDecisions) waiting")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                } else {
                    Text("All Clear")
                        .font(.system(size: 10, weight: .semibold))
                    Text("\(entry.tasksCompleted) done")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var cornerView: some View {
        ZStack {
            Circle()
                .stroke(gaugeColor.opacity(0.3), lineWidth: 3)

            Circle()
                .trim(from: 0, to: gaugeProgress)
                .stroke(gaugeColor, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))

            if entry.pendingDecisions > 0 {
                Text("\(entry.pendingDecisions)")
                    .font(.system(size: 14, weight: .bold))
                    .monospacedDigit()
                    .widgetLabel {
                        Text("Decisions")
                    }
            } else if entry.activeTasks > 0 {
                Text("\(entry.activeTasks)")
                    .font(.system(size: 14, weight: .bold))
                    .monospacedDigit()
                    .widgetLabel {
                        Text("Agents")
                    }
            } else {
                Text("\(entry.tasksCompleted)")
                    .font(.system(size: 12, weight: .bold))
                    .monospacedDigit()
                    .widgetLabel {
                        Text("Done")
                    }
            }
        }
    }

    private var gaugeColor: Color {
        if entry.pendingDecisions > 0 { return .orange }
        if entry.activeTasks > 0 { return .blue }
        return .green
    }

    private var gaugeProgress: Double {
        if entry.pendingDecisions > 0 { return min(1.0, Double(entry.pendingDecisions) / 10.0) }
        if entry.activeTasks > 0 { return min(1.0, Double(entry.activeTasks) / 10.0) }
        return min(1.0, Double(entry.tasksCompleted) / 20.0)
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
