import SwiftUI

/// Agents screen - Shows running agent sessions
struct AgentsView: View {
    @Environment(RealtimeStore.self) private var realtimeStore
    @Environment(PlanStore.self) private var planStore
    @Environment(ProjectStore.self) private var projectStore

    private var runningTasks: [PlanNode] {
        planStore.nodesByProject.values
            .flatMap { $0 }
            .filter { $0.status == .inProgress || $0.status == .dispatched }
            .sorted { ($0.executionStartedAt ?? Date.distantPast) > ($1.executionStartedAt ?? Date.distantPast) }
    }

    private var totalRunning: Int {
        runningTasks.count
    }

    private var totalCompleted: Int {
        planStore.nodesByProject.values
            .flatMap { $0 }
            .filter { $0.status == .completed }
            .count
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Agents")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(.primary)
                }

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 12)

            // Content
            ScrollView {
                VStack(spacing: 20) {
                    // Summary stats
                    HStack(spacing: 12) {
                        AgentStatCard(
                            label: "Running",
                            value: "\(totalRunning)",
                            icon: "play.circle.fill",
                            color: .nexusBlue
                        )

                        AgentStatCard(
                            label: "Completed Today",
                            value: "\(totalCompleted)",
                            icon: "checkmark.circle.fill",
                            color: .nexusGreen
                        )
                    }

                    // Running agents list
                    if !runningTasks.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Running")
                                .font(.system(size: 14, weight: .semibold))
                                .tracking(0.5)
                                .foregroundStyle(colorFromHex( "64748B"))

                            ForEach(runningTasks) { node in
                                NavigationLink(value: node) {
                                    AgentRow(node: node)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    } else {
                        ContentUnavailableView(
                            "No Running Agents",
                            systemImage: "bolt.slash",
                            description: Text("Start a task to see agent activity here")
                        )
                        .frame(height: 200)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 100) // Extra padding for tab bar
            }
        }
        .background(
            LinearGradient(
                colors: [
                    Color.black.opacity(0.85),
                    colorFromHex( "0A0E1A").opacity(0.9)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .navigationDestination(for: PlanNode.self) { node in
            TaskDetailView(nodeId: node.id, projectId: node.projectId ?? "")
        }
        .task {
            await planStore.loadPlans(projectIds: projectStore.projects.map(\.id))
        }
    }
}

// MARK: - Agent Stat Card

private struct AgentStatCard: View {
    let label: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 16))
                    .foregroundStyle(color)

                Text(value)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(.primary)
            }

            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .glassCard(cornerRadius: 16, material: .ultraThinMaterial, shadowRadius: 20, shadowY: 6)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .fill(color.opacity(0.05))
        )
    }
}

// MARK: - Agent Row

private struct AgentRow: View {
    let node: PlanNode
    @Environment(RealtimeStore.self) private var realtimeStore

    private var elapsedTime: String {
        guard let startedAt = node.executionStartedAt else { return "0:00" }
        let elapsed = Date().timeIntervalSince(startedAt)
        let minutes = Int(elapsed) / 60
        let seconds = Int(elapsed) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    private var machineName: String {
        // Get machine name from recent task events
        guard let executionId = node.executionId else { return "Unknown" }
        let taskEvents = realtimeStore.taskEvents.filter {
            $0.data["executionId"]?.value as? String == executionId
        }
        if let machineId = taskEvents.first?.data["machineId"]?.value as? String,
           let machine = realtimeStore.machine(id: machineId) {
            return machine.name
        }
        return "Unknown"
    }

    private var providerName: String {
        "Agent"
    }

    private var latestOutput: String {
        // Get latest stdout from events
        guard let executionId = node.executionId else { return "Starting..." }
        let stdoutEvents = realtimeStore.taskEvents.filter {
            $0.type == .taskStdout &&
            $0.data["executionId"]?.value as? String == executionId
        }
        if let latest = stdoutEvents.first,
           let output = latest.data["output"]?.value as? String {
            return output
        }
        return "Starting..."
    }

    private var progress: Double {
        // Calculate progress from events
        guard let executionId = node.executionId else { return 0 }
        let progressEvents = realtimeStore.taskEvents.filter {
            $0.type == .taskProgress &&
            $0.data["executionId"]?.value as? String == executionId
        }
        if let latest = progressEvents.first,
           let prog = latest.data["progress"]?.value as? Double {
            return prog
        }
        return 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Top: task + time
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(node.title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        Image(systemName: "laptopcomputer")
                            .font(.system(size: 10))
                            .foregroundStyle(.tertiary)

                        Text("\(machineName) · \(providerName)")
                            .font(.system(size: 12))
                            .foregroundStyle(.tertiary)
                    }
                }

                Spacer()

                Text(elapsedTime)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.secondary)
            }

            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(.tertiary.opacity(0.3))
                        .frame(height: 4)

                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.nexusBlue)
                        .frame(width: geometry.size.width * progress, height: 4)
                        .glow(color: .nexusBlue, radius: 3)
                }
            }
            .frame(height: 4)

            // Latest output
            Text(latestOutput)
                .font(.system(size: 12))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
        }
        .padding(16)
        .glassCard(cornerRadius: 16, material: .ultraThinMaterial, shadowRadius: 16, shadowY: 4)
    }
}
