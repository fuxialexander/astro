import WidgetKit
import SwiftUI

// MARK: - Widget Timeline Provider

struct NexusWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> NexusWidgetEntry {
        NexusWidgetEntry(
            date: .now,
            activeProjects: 3,
            tasksCompleted: 12,
            pendingDecisions: 2,
            connectedMachines: 1,
            costToday: 1.23
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (NexusWidgetEntry) -> Void) {
        completion(placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NexusWidgetEntry>) -> Void) {
        Task {
            let entry = await fetchCurrentData()
            let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: .now)!
            let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
            completion(timeline)
        }
    }

    private func fetchCurrentData() async -> NexusWidgetEntry {
        // Read server URL from shared UserDefaults (App Group)
        let serverURL = UserDefaults(suiteName: "group.com.nexus.app")?.string(forKey: "nexus.serverURL") ?? "http://localhost:3001"

        do {
            // Fetch usage data
            let usageURL = URL(string: "\(serverURL)/api/data/usage/today")!
            let (usageData, _) = try await URLSession.shared.data(from: usageURL)
            let usage = try JSONDecoder().decode(WidgetUsageData.self, from: usageData)

            // Fetch projects count
            let projectsURL = URL(string: "\(serverURL)/api/data/projects")!
            let (projectsData, _) = try await URLSession.shared.data(from: projectsURL)
            let projects = try JSONDecoder().decode([WidgetProject].self, from: projectsData)

            return NexusWidgetEntry(
                date: .now,
                activeProjects: projects.filter { $0.status == "active" }.count,
                tasksCompleted: usage.tasksCompleted,
                pendingDecisions: 0, // Would need plan data
                connectedMachines: 0, // Would need relay data
                costToday: usage.totalCostUsd
            )
        } catch {
            return NexusWidgetEntry(date: .now, activeProjects: 0, tasksCompleted: 0, pendingDecisions: 0, connectedMachines: 0, costToday: 0)
        }
    }
}

// MARK: - Timeline Entry

struct NexusWidgetEntry: TimelineEntry {
    let date: Date
    let activeProjects: Int
    let tasksCompleted: Int
    let pendingDecisions: Int
    let connectedMachines: Int
    let costToday: Double
}

// MARK: - Widget View

struct NexusWidgetView: View {
    let entry: NexusWidgetEntry
    @SwiftUI.Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemSmall:
            smallWidget
        case .systemMedium:
            mediumWidget
        default:
            mediumWidget
        }
    }

    private var smallWidget: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "hexagon.fill")
                    .font(.caption)
                    .foregroundStyle(.blue)
                Text("Nexus")
                    .font(.caption.bold())
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("\(entry.tasksCompleted)")
                        .font(.title2.bold().monospacedDigit())
                    Text("tasks")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if entry.pendingDecisions > 0 {
                    HStack(spacing: 2) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                        Text("\(entry.pendingDecisions) decisions")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                }
            }

            Spacer()

            Text(String(format: "$%.2f", entry.costToday))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding()
    }

    private var mediumWidget: some View {
        HStack {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "hexagon.fill")
                        .font(.caption)
                        .foregroundStyle(.blue)
                    Text("Nexus")
                        .font(.caption.bold())
                }

                Spacer()

                WidgetStatRow(icon: "checkmark.circle", value: "\(entry.tasksCompleted)", label: "Tasks Done", color: .green)
                WidgetStatRow(icon: "folder", value: "\(entry.activeProjects)", label: "Projects", color: .blue)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: 8) {
                if entry.pendingDecisions > 0 {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text("\(entry.pendingDecisions)")
                            .font(.title3.bold())
                    }
                    Text("decisions")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                VStack(alignment: .trailing) {
                    Text(String(format: "$%.2f", entry.costToday))
                        .font(.subheadline.monospacedDigit())
                    Text("today")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding()
    }
}

private struct WidgetStatRow: View {
    let icon: String
    let value: String
    let label: String
    let color: Color

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.caption2)
                .foregroundStyle(color)
            Text(value)
                .font(.subheadline.bold().monospacedDigit())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Widget Configuration

struct NexusProgressWidget: Widget {
    let kind = "NexusProgressWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NexusWidgetProvider()) { entry in
            NexusWidgetView(entry: entry)
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("Nexus Progress")
        .description("Track your project progress and task completion.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Data models for widget

private struct WidgetUsageData: Codable {
    var totalCostUsd: Double
    var tasksCompleted: Int
    var tasksFailed: Int
}

private struct WidgetProject: Codable {
    var id: String
    var status: String
}
