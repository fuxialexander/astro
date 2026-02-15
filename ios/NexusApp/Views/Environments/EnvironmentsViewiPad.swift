import SwiftUI

/// iPad-optimized environments view with three-panel layout (sidebar + list + detail)
struct EnvironmentsViewiPad: View {
    @Environment(RealtimeStore.self) private var realtimeStore
    @State private var registeredMachines: [RegisteredMachine] = []
    @State private var selectedMachine: MachineInfo?
    @State private var selectedRegistered: RegisteredMachine?
    @State private var showAddMachine = false
    @State private var isLoadingRegistered = false
    @State private var showDeviceCode = false
    @State private var deviceCodeData: DeviceCodeData?

    var body: some View {
        HStack(spacing: 0) {
            // Main machine list
            VStack(spacing: 0) {
                // Toolbar
                toolbar

                Divider()

                // Machine list
                machineList
            }
            .frame(maxWidth: .infinity)

            // Detail panel (right)
            if let machine = selectedMachine {
                Divider()

                MachineDetailPanel(
                    machine: machine,
                    onClose: { selectedMachine = nil }
                )
                .frame(width: 340)
                .transition(.move(edge: .trailing))
            } else if let registered = selectedRegistered {
                Divider()

                RegisteredMachineDetailPanel(
                    machine: registered,
                    onClose: { selectedRegistered = nil }
                )
                .frame(width: 340)
                .transition(.move(edge: .trailing))
            }
        }
        .background(Color(.systemGroupedBackground))
        .sheet(isPresented: $showAddMachine) {
            NavigationStack {
                AddMachineView()
            }
        }
        .sheet(isPresented: $showDeviceCode) {
            if let data = deviceCodeData {
                NavigationStack {
                    DeviceCodeSheet(data: data, onClose: {
                        showDeviceCode = false
                        deviceCodeData = nil
                        Task {
                            await loadRegisteredMachines()
                        }
                    })
                }
            }
        }
        .task {
            await loadRegisteredMachines()
        }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: 12) {
            Text("Environments")
                .font(.headline)

            Spacer()

            // Connected count
            HStack(spacing: 6) {
                Circle()
                    .fill(.green)
                    .frame(width: 8, height: 8)
                Text("\(realtimeStore.connectedMachines.count) Connected")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Button {
                startDeviceAuth()
            } label: {
                Label("Add Machine", systemImage: "plus.circle.fill")
                    .font(.subheadline.weight(.medium))
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(.bar)
    }

    // MARK: - Machine List

    private var machineList: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Connected machines
                VStack(alignment: .leading, spacing: 12) {
                    Text("Connected")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)

                    if realtimeStore.connectedMachines.isEmpty {
                        EmptyStateCard(
                            icon: "antenna.radiowaves.left.and.right.slash",
                            title: "No Connected Machines",
                            subtitle: "Machines will appear here when online"
                        )
                    } else {
                        ForEach(realtimeStore.connectedMachines) { machine in
                            MachineCard(
                                machine: machine,
                                isSelected: selectedMachine?.id == machine.id,
                                onTap: {
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        selectedMachine = machine
                                        selectedRegistered = nil
                                    }
                                }
                            )
                        }
                    }
                }

                // Registered machines
                VStack(alignment: .leading, spacing: 12) {
                    Text("All Machines")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)

                    if isLoadingRegistered {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding()
                    } else if registeredMachines.isEmpty {
                        EmptyStateCard(
                            icon: "desktopcomputer.trianglebadge.exclamationmark",
                            title: "No Registered Machines",
                            subtitle: "Add machines to run tasks remotely"
                        )
                    } else {
                        ForEach(registeredMachines) { machine in
                            RegisteredMachineCard(
                                machine: machine,
                                isSelected: selectedRegistered?.id == machine.id,
                                onTap: {
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        selectedRegistered = machine
                                        selectedMachine = nil
                                    }
                                }
                            )
                        }
                    }
                }
            }
            .padding(20)
        }
    }

    // MARK: - Actions

    private func loadRegisteredMachines() async {
        isLoadingRegistered = true
        do {
            let response = try await NexusAPI.shared.getRegisteredMachines()
            registeredMachines = response.machines
        } catch {}
        isLoadingRegistered = false
    }

    private func startDeviceAuth() {
        Task {
            do {
                let response = try await NexusAPI.shared.requestDeviceCode()
                deviceCodeData = DeviceCodeData(
                    deviceCode: response.deviceCode,
                    userCode: response.userCode,
                    verificationUri: response.verificationUri,
                    expiresIn: response.expiresIn,
                    interval: response.interval
                )
                showDeviceCode = true
            } catch {
                print("Failed to request device code: \(error)")
            }
        }
    }
}

// MARK: - Machine Card (Connected)

private struct MachineCard: View {
    let machine: MachineInfo
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: envIcon)
                        .foregroundStyle(.blue)
                        .font(.title3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(machine.name)
                            .font(.subheadline.weight(.semibold))
                        Text(machine.hostname)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    HStack(spacing: 4) {
                        Circle()
                            .fill(.green)
                            .frame(width: 6, height: 6)
                        Text("Active")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                // Progress bar (CPU/Memory)
                if let load = machine.load {
                    HStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("CPU")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                Spacer()
                                Text("\(Int(load.cpuPercent ?? 0))%")
                                    .font(.caption2.monospacedDigit())
                            }
                            ProgressView(value: load.cpuPercent ?? 0, total: 100)
                                .tint(progressColor(load.cpuPercent ?? 0))
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Memory")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                Spacer()
                                Text("\(Int(load.memoryPercent ?? 0))%")
                                    .font(.caption2.monospacedDigit())
                            }
                            ProgressView(value: load.memoryPercent ?? 0, total: 100)
                                .tint(progressColor(load.memoryPercent ?? 0))
                        }
                    }
                }

                // Providers
                if let providers = machine.providers, !providers.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(providers, id: \.type) { provider in
                            HStack(spacing: 4) {
                                Circle()
                                    .fill(provider.available ? .green : .gray)
                                    .frame(width: 4, height: 4)
                                Text(provider.type)
                                    .font(.caption2)
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(.blue.opacity(0.1), in: Capsule())
                        }
                    }
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(isSelected ? Color.accentColor.opacity(0.1) : Color(.systemBackground))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(isSelected ? Color.accentColor : Color.clear, lineWidth: 2)
            )
            .padding(.horizontal, 16)
        }
        .buttonStyle(.plain)
    }

    private var envIcon: String {
        switch machine.environmentType {
        case .local: return "laptopcomputer"
        case .remote: return "server.rack"
        case .hpc: return "cpu"
        case .cloud: return "cloud"
        }
    }

    private func progressColor(_ percent: Double) -> Color {
        if percent < 60 { return .green }
        if percent < 80 { return .yellow }
        return .orange
    }
}

// MARK: - Registered Machine Card

private struct RegisteredMachineCard: View {
    let machine: RegisteredMachine
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text(machine.name)
                        .font(.subheadline.weight(.semibold))
                    HStack(spacing: 10) {
                        Text(machine.hostname)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(machine.platform)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                HStack(spacing: 4) {
                    Circle()
                        .fill(machine.isConnected == true ? .green : .gray)
                        .frame(width: 6, height: 6)
                    Text(machine.isConnected == true ? "Online" : "Offline")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(isSelected ? Color.accentColor.opacity(0.1) : Color(.systemBackground))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(isSelected ? Color.accentColor : Color.clear, lineWidth: 2)
            )
            .padding(.horizontal, 16)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Machine Detail Panel

private struct MachineDetailPanel: View {
    let machine: MachineInfo
    let onClose: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                HStack {
                    Text("Machine Details")
                        .font(.headline)
                    Spacer()
                    Button {
                        onClose()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }

                Divider()

                // Machine info
                VStack(alignment: .leading, spacing: 12) {
                    InfoRow(label: "Name", value: machine.name)
                    InfoRow(label: "Hostname", value: machine.hostname)
                    InfoRow(label: "Platform", value: machine.platform)
                    InfoRow(label: "Type", value: machine.environmentType.rawValue.capitalized)
                    if let version = machine.version {
                        InfoRow(label: "Agent Version", value: version)
                    }
                }

                Divider()

                // System resources
                if let load = machine.load {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("System Resources")
                            .font(.subheadline.weight(.semibold))

                        VStack(spacing: 10) {
                            ResourceBar(
                                label: "CPU",
                                value: load.cpuPercent ?? 0,
                                unit: "%"
                            )
                            ResourceBar(
                                label: "Memory",
                                value: load.memoryPercent ?? 0,
                                unit: "%"
                            )
                            if let tasks = load.activeTasks {
                                InfoRow(label: "Active Tasks", value: "\(tasks)")
                            }
                        }
                    }

                    Divider()
                }

                // Providers
                if let providers = machine.providers, !providers.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Providers")
                            .font(.subheadline.weight(.semibold))

                        ForEach(providers, id: \.type) { provider in
                            HStack {
                                Circle()
                                    .fill(provider.available ? .green : .gray)
                                    .frame(width: 8, height: 8)
                                Text(provider.type)
                                    .font(.subheadline)
                                Spacer()
                                Text(provider.available ? "Available" : "Unavailable")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(10)
                            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
            }
            .padding(24)
        }
        .background(Color(.systemBackground))
    }
}

// MARK: - Registered Machine Detail Panel

private struct RegisteredMachineDetailPanel: View {
    let machine: RegisteredMachine
    let onClose: () -> Void

    @State private var showingRevokeConfirm = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Header
                HStack {
                    Text("Machine Details")
                        .font(.headline)
                    Spacer()
                    Button {
                        onClose()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }

                Divider()

                // Machine info
                VStack(alignment: .leading, spacing: 12) {
                    InfoRow(label: "Name", value: machine.name)
                    InfoRow(label: "Hostname", value: machine.hostname)
                    InfoRow(label: "Platform", value: machine.platform)
                    if let lastSeen = machine.lastSeenAt {
                        InfoRow(label: "Last Seen", value: lastSeen)
                    }
                }

                Divider()

                // Status
                HStack(spacing: 10) {
                    Circle()
                        .fill(machine.isConnected == true ? .green : .gray)
                        .frame(width: 12, height: 12)
                    Text(machine.isConnected == true ? "Connected" : "Disconnected")
                        .font(.subheadline.weight(.medium))
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))

                Divider()

                // Actions
                VStack(spacing: 10) {
                    Button(role: .destructive) {
                        showingRevokeConfirm = true
                    } label: {
                        Label("Revoke Access", systemImage: "xmark.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(24)
        }
        .background(Color(.systemBackground))
        .confirmationDialog(
            "Revoke access to \(machine.name)?",
            isPresented: $showingRevokeConfirm,
            titleVisibility: .visible
        ) {
            Button("Revoke", role: .destructive) {
                Task {
                    try? await NexusAPI.shared.revokeMachine(id: machine.id)
                    onClose()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This machine will no longer be able to connect to Nexus.")
        }
    }
}

// MARK: - Supporting Views

private struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.tertiary)
                .frame(width: 80, alignment: .leading)
            Text(value)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ResourceBar: View {
    let label: String
    let value: Double
    let unit: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Spacer()
                Text("\(Int(value))\(unit)")
                    .font(.caption.monospacedDigit())
            }
            ProgressView(value: value, total: 100)
                .tint(progressColor)
        }
    }

    private var progressColor: Color {
        if value < 60 { return .green }
        if value < 80 { return .yellow }
        return .orange
    }
}

private struct EmptyStateCard: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.subheadline.weight(.medium))
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 16)
    }
}

// MARK: - Device Code Sheet

private struct DeviceCodeSheet: View {
    let data: DeviceCodeData
    let onClose: () -> Void

    @State private var isPolling = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "desktopcomputer.and.arrow.down")
                .font(.system(size: 60))
                .foregroundStyle(.blue)

            VStack(spacing: 8) {
                Text("Connect Your Machine")
                    .font(.title2.weight(.bold))
                Text("Enter this code on your agent runner")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            // Device code display
            Text(data.userCode)
                .font(.system(size: 48, weight: .bold, design: .monospaced))
                .padding(20)
                .background(.blue.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))

            VStack(spacing: 12) {
                Text("On your machine, run:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("nexus agent auth")
                    .font(.system(.body, design: .monospaced))
                    .padding(12)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                    .frame(maxWidth: .infinity)
            }

            if isPolling {
                HStack(spacing: 8) {
                    ProgressView()
                        .scaleEffect(0.8)
                    Text("Waiting for authentication...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Spacer()

            Button("Cancel") {
                onClose()
            }
            .buttonStyle(.bordered)
        }
        .padding(32)
        .navigationTitle("Add Machine")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await pollForToken()
        }
    }

    private func pollForToken() async {
        isPolling = true
        var attempts = 0
        let maxAttempts = data.expiresIn / data.interval

        while attempts < maxAttempts {
            try? await Task.sleep(for: .seconds(data.interval))
            attempts += 1

            do {
                let _ = try await NexusAPI.shared.pollDeviceToken(deviceCode: data.deviceCode)
                // Success!
                isPolling = false
                onClose()
                return
            } catch {
                // Continue polling (authorization_pending is expected)
                if error.localizedDescription.contains("expired") {
                    self.error = "Code expired. Please try again."
                    isPolling = false
                    return
                }
            }
        }

        error = "Timeout. Please try again."
        isPolling = false
    }
}

struct DeviceCodeData {
    let deviceCode: String
    let userCode: String
    let verificationUri: String
    let expiresIn: Int
    let interval: Int
}
