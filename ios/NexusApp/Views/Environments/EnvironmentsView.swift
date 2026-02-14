import SwiftUI

struct EnvironmentsView: View {
    @Environment(RealtimeStore.self) private var realtimeStore
    @State private var registeredMachines: [RegisteredMachine] = []
    @State private var showAddMachine = false
    @State private var isLoadingRegistered = false

    var body: some View {
        List {
            // Connected machines (live)
            Section("Connected Machines") {
                if realtimeStore.connectedMachines.isEmpty {
                    HStack {
                        Image(systemName: "antenna.radiowaves.left.and.right.slash")
                            .foregroundStyle(.secondary)
                        Text("No machines connected")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    ForEach(realtimeStore.connectedMachines) { machine in
                        MachineCardView(machine: machine)
                    }
                }
            }

            // Registered machines (may be offline)
            Section("Registered Machines") {
                if isLoadingRegistered {
                    ProgressView()
                } else if registeredMachines.isEmpty {
                    HStack {
                        Image(systemName: "desktopcomputer.trianglebadge.exclamationmark")
                            .foregroundStyle(.secondary)
                        Text("No registered machines")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    ForEach(registeredMachines) { machine in
                        RegisteredMachineRow(machine: machine)
                    }
                }
            }
        }
        .navigationTitle("Environments")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showAddMachine = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showAddMachine) {
            NavigationStack {
                AddMachineView()
            }
        }
        .refreshable {
            await loadRegisteredMachines()
        }
        .task {
            await loadRegisteredMachines()
        }
    }

    private func loadRegisteredMachines() async {
        isLoadingRegistered = true
        do {
            let response = try await NexusAPI.shared.getRegisteredMachines()
            registeredMachines = response.machines
        } catch {}
        isLoadingRegistered = false
    }
}

// MARK: - Machine Card (Connected)

struct MachineCardView: View {
    let machine: MachineInfo

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: envIcon)
                    .foregroundStyle(.blue)
                Text(machine.name)
                    .font(.subheadline.weight(.medium))
                Spacer()
                HStack(spacing: 4) {
                    Circle()
                        .fill(.green)
                        .frame(width: 6, height: 6)
                    Text("Connected")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 16) {
                if let load = machine.load {
                    VStack(alignment: .leading) {
                        Text("CPU")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        Text("\(Int(load.cpuPercent ?? 0))%")
                            .font(.caption.monospacedDigit())
                    }
                    VStack(alignment: .leading) {
                        Text("Memory")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        Text("\(Int(load.memoryPercent ?? 0))%")
                            .font(.caption.monospacedDigit())
                    }
                    VStack(alignment: .leading) {
                        Text("Tasks")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        Text("\(load.activeTasks ?? 0)")
                            .font(.caption.monospacedDigit())
                    }
                }

                Spacer()

                if let providers = machine.providers, !providers.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(providers, id: \.type) { provider in
                            Text(provider.type)
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(.blue.opacity(0.1), in: Capsule())
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var envIcon: String {
        switch machine.environmentType {
        case .local: return "laptopcomputer"
        case .remote: return "server.rack"
        case .hpc: return "cpu"
        case .cloud: return "cloud"
        }
    }
}

// MARK: - Registered Machine Row

private struct RegisteredMachineRow: View {
    let machine: RegisteredMachine

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(machine.name)
                    .font(.subheadline.weight(.medium))
                HStack(spacing: 8) {
                    Text(machine.hostname)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(machine.platform)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            VStack(alignment: .trailing) {
                HStack(spacing: 4) {
                    Circle()
                        .fill(machine.isConnected == true ? .green : .gray)
                        .frame(width: 6, height: 6)
                    Text(machine.isConnected == true ? "Online" : "Offline")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let lastSeen = machine.lastSeenAt {
                    Text(lastSeen)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
