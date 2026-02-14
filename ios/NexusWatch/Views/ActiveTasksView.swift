import SwiftUI

struct ActiveTasksView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        List {
            if store.activeTasks.isEmpty {
                ContentUnavailableView(
                    "No Active Tasks",
                    systemImage: "tray",
                    description: Text("No tasks are currently running.")
                )
            } else {
                ForEach(groupedByProject, id: \.key) { project, tasks in
                    Section {
                        ForEach(tasks) { task in
                            TaskRow(task: task)
                        }
                    } header: {
                        Text(project)
                    }
                }
            }
        }
        .navigationTitle("Active")
        .refreshable {
            await store.loadActiveTasks()
        }
    }

    private var groupedByProject: [(key: String, value: [WatchTask])] {
        let grouped = Dictionary(grouping: store.activeTasks) { $0.projectName ?? "Unknown" }
        return grouped.sorted { $0.key < $1.key }
    }
}

private struct TaskRow: View {
    let task: WatchTask

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: task.status.iconName)
                .font(.caption)
                .foregroundStyle(statusColor)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(.caption.bold())
                    .lineLimit(2)

                HStack(spacing: 4) {
                    Text(task.status.displayName)
                        .font(.caption2)
                        .foregroundStyle(statusColor)

                    if let priority = task.priority, priority != "none" {
                        Text(priority.capitalized)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var statusColor: Color {
        switch task.status {
        case .inProgress: return .blue
        case .dispatched: return .cyan
        case .awaitingJudgment: return .orange
        default: return .secondary
        }
    }
}
