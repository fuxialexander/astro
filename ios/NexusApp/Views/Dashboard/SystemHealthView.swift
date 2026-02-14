import SwiftUI

struct SystemHealthView: View {
    @Environment(RealtimeStore.self) private var realtimeStore
    @Environment(ExecutionStore.self) private var executionStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("System Health")
                    .font(.headline)
                Spacer()
                HStack(spacing: 4) {
                    Circle()
                        .fill(realtimeStore.isConnected ? .green : .red)
                        .frame(width: 6, height: 6)
                    Text(realtimeStore.isConnected ? "Connected" : "Disconnected")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                MiniStatView(
                    label: "Machines",
                    value: "\(realtimeStore.connectedMachines.count)",
                    icon: "desktopcomputer"
                )
                MiniStatView(
                    label: "Active Tasks",
                    value: "\(realtimeStore.totalActiveTasks)",
                    icon: "bolt.fill"
                )
                MiniStatView(
                    label: "Running",
                    value: "\(executionStore.activeExecutions.count)",
                    icon: "play.circle"
                )
            }

            if !realtimeStore.connectedMachines.isEmpty {
                Divider()
                ForEach(realtimeStore.connectedMachines) { machine in
                    HStack(spacing: 8) {
                        Image(systemName: machineIcon(machine.environmentType))
                            .font(.caption)
                            .foregroundStyle(.blue)

                        Text(machine.name)
                            .font(.caption.weight(.medium))
                            .lineLimit(1)
                            .truncationMode(.middle)

                        Spacer()

                        if let load = machine.load {
                            HStack(spacing: 4) {
                                Text("CPU \(Int(load.cpuPercent ?? 0))%")
                                Text("Mem \(Int(load.memoryPercent ?? 0))%")
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }

                        if let tasks = machine.load?.activeTasks, tasks > 0 {
                            Text("\(tasks) tasks")
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(.blue.opacity(0.1), in: Capsule())
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private func machineIcon(_ env: TaskEnvironment) -> String {
        switch env {
        case .local: return "laptopcomputer"
        case .remote: return "server.rack"
        case .hpc: return "cpu"
        case .cloud: return "cloud"
        }
    }
}

private struct MiniStatView: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.bold().monospacedDigit())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}
