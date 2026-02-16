import SwiftUI

struct NewProjectView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore
    @Environment(RealtimeStore.self) private var realtimeStore

    @State private var name = ""
    @State private var description = ""
    @State private var visionDoc = ""
    @State private var repository = ""
    @State private var workingDirectory = ""
    @State private var selectedEnvironment: TaskEnvironment?
    @State private var selectedMachineId: String?
    @State private var showVisionDoc = false
    @State private var isCreating = false
    @State private var error: String?

    /// Machines filtered by selected environment (or all if Auto)
    private var filteredMachines: [MachineInfo] {
        let connected = realtimeStore.connectedMachines.filter {
            $0.connectionStatus == .connected
        }
        guard let env = selectedEnvironment else { return connected }
        return connected.filter { $0.environmentType == env }
    }

    var body: some View {
        Form {
            Section("Project Info") {
                TextField("Project Name", text: $name)
                TextField("Description", text: $description, axis: .vertical)
                    .lineLimit(3...8)
            }

            Section("Environment & Code") {
                Picker("Environment", selection: $selectedEnvironment) {
                    Label("Auto", systemImage: "sparkles").tag(nil as TaskEnvironment?)
                    ForEach([TaskEnvironment.remote, .hpc, .cloud], id: \.self) { env in
                        Label(env.rawValue.capitalized, systemImage: envIcon(env)).tag(env as TaskEnvironment?)
                    }
                }
                .onChange(of: selectedEnvironment) { _, _ in
                    // Reset machine selection when environment changes
                    selectedMachineId = nil
                }

                if !filteredMachines.isEmpty {
                    Picker("Machine", selection: $selectedMachineId) {
                        Text("Auto").tag(nil as String?)
                        ForEach(filteredMachines) { machine in
                            HStack(spacing: 6) {
                                Image(systemName: machineIcon(machine.environmentType))
                                    .font(.caption2)
                                Text(machine.name)
                                if let load = machine.load, let tasks = load.activeTasks, tasks > 0 {
                                    Text("\(tasks) active")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }.tag(machine.machineId as String?)
                        }
                    }
                }

                TextField("Repository URL", text: $repository)
                    .font(.system(.body, design: .monospaced))
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Working Directory", text: $workingDirectory)
                    .font(.system(.body, design: .monospaced))
                    .textContentType(.none)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            Section {
                DisclosureGroup("Vision Document (Optional)", isExpanded: $showVisionDoc) {
                    TextEditor(text: $visionDoc)
                        .frame(minHeight: 100)
                        .font(.caption)
                }
            }

            if let error {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                        .font(.caption)
                }
            }
        }
        .navigationTitle("New Project")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Create") {
                    createProject()
                }
                .disabled(name.isEmpty || description.isEmpty || isCreating)
            }
        }
    }

    private func envIcon(_ env: TaskEnvironment) -> String {
        switch env {
        case .remote: return "server.rack"
        case .hpc: return "cpu"
        case .cloud: return "cloud"
        default: return "sparkles"
        }
    }

    private func machineIcon(_ env: TaskEnvironment) -> String {
        switch env {
        case .remote: return "desktopcomputer"
        case .hpc: return "cpu"
        case .cloud: return "cloud"
        default: return "desktopcomputer"
        }
    }

    private func createProject() {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDesc = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedVision = visionDoc.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedRepo = repository.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDir = workingDirectory.trimmingCharacters(in: .whitespacesAndNewlines)

        let projectId = UUID().uuidString
        let now = Date()
        let project = Project(
            id: projectId,
            name: trimmedName,
            description: trimmedDesc,
            visionDoc: trimmedVision,
            status: .active,
            color: "blue",
            icon: "📁",
            workingDirectory: trimmedDir.isEmpty ? nil : trimmedDir,
            repository: trimmedRepo.isEmpty ? nil : trimmedRepo,
            defaultEnvironment: selectedEnvironment,
            defaultMachineId: selectedMachineId,
            createdAt: now,
            updatedAt: now
        )

        isCreating = true
        error = nil

        Task {
            do {
                try await projectStore.createProject(project)

                // Use user-selected machine, or fall back to first connected machine
                let machineId = selectedMachineId ?? realtimeStore.connectedMachines.first?.machineId

                // Start plan generation in background (non-blocking).
                // This mirrors the web app flow:
                // 1. Repo setup (clone, resolve workingDir, read key files)
                // 2. Generate plan with full codebase context
                planStore.startGeneration(
                    projectId: projectId,
                    projectName: trimmedName,
                    description: trimmedDesc,
                    visionDoc: trimmedVision.isEmpty ? nil : trimmedVision,
                    workingDirectory: trimmedDir.isEmpty ? nil : trimmedDir,
                    repository: trimmedRepo.isEmpty ? nil : trimmedRepo,
                    targetMachineId: machineId
                )

                // Dismiss immediately — generation continues in background
                dismiss()
            } catch {
                self.error = error.localizedDescription
                isCreating = false
            }
        }
    }
}
