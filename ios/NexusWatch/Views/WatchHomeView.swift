import SwiftUI

struct WatchHomeView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                // Quick stats
                Section {
                    StatsRow(icon: "exclamationmark.triangle.fill", label: "Decisions", value: "\(store.stats.pendingDecisions)", color: .orange)
                    StatsRow(icon: "bolt.fill", label: "Active", value: "\(store.stats.activeTasks)", color: .blue)
                    StatsRow(icon: "checkmark.circle", label: "Done Today", value: "\(store.stats.tasksCompleted)", color: .green)
                }

                // Pending decisions — primary action
                if !store.decisions.isEmpty {
                    Section {
                        NavigationLink {
                            DecisionListView()
                        } label: {
                            HStack {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.orange)
                                Text("Decisions")
                                Spacer()
                                Text("\(store.decisions.count)")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } header: {
                        Text("Needs Attention")
                    }
                }

                // Active tasks
                if !store.activeTasks.isEmpty {
                    Section {
                        NavigationLink {
                            ActiveTasksView()
                        } label: {
                            HStack {
                                Image(systemName: "play.circle.fill")
                                    .foregroundStyle(.blue)
                                Text("Active Tasks")
                                Spacer()
                                Text("\(store.activeTasks.count)")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } header: {
                        Text("Running")
                    }
                }

                // Usage
                Section {
                    HStack {
                        Image(systemName: "dollarsign.circle")
                            .foregroundStyle(.secondary)
                        Text("Cost Today")
                        Spacer()
                        Text(String(format: "$%.2f", store.stats.costToday))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    .font(.caption)
                }
            }
            .navigationTitle("Nexus")
            .refreshable {
                await store.loadAll()
            }
            .overlay {
                if store.isLoading && store.decisions.isEmpty && store.activeTasks.isEmpty {
                    ProgressView("Loading...")
                }
            }
        }
    }
}

private struct StatsRow: View {
    let icon: String
    let label: String
    let value: String
    let color: Color

    var body: some View {
        HStack {
            Image(systemName: icon)
                .font(.caption2)
                .foregroundStyle(color)
                .frame(width: 16)
            Text(label)
                .font(.caption)
            Spacer()
            Text(value)
                .font(.caption.bold().monospacedDigit())
        }
    }
}
