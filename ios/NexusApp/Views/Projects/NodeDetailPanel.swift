import SwiftUI

/// A compact detail panel for a plan node, shown in the right sidebar
/// Mirrors the TypeScript plan-view.tsx detail panel behavior
struct NodeDetailPanel: View {
    let node: PlanNode
    let projectId: String
    var onClose: () -> Void
    var onDecompose: ((String) -> Void)?
    
    @Environment(PlanStore.self) private var planStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(ExecutionStore.self) private var executionStore
    @Environment(RealtimeStore.self) private var realtimeStore

    @AppStorage("selectedModel") private var selectedModel = "claude-sonnet-4-5-20250929"
    @State private var selectedMachineId: String?
    @State private var editedDescription: String = ""
    @State private var isEditingDescription = false

    private var connectedMachines: [MachineInfo] {
        realtimeStore.connectedMachines.filter { $0.connectionStatus == .connected }
    }
    
    private var project: Project? {
        projectStore.project(id: projectId)
    }
    
    private var execution: TaskExecution? {
        executionStore.execution(for: node.id)
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            header
            
            Divider()
            
            // Content
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Properties section
                    propertiesSection
                    
                    Divider()
                    
                    // Description section
                    descriptionSection
                    
                    Divider()
                    
                    // Execution section
                    executionSection
                    
                    // Actions
                    if node.status == .awaitingJudgment {
                        Divider()
                        judgmentActions
                    } else if node.status != .pruned {
                        Divider()
                        generalActions
                    }
                }
                .padding()
            }
        }
        .background(Color(.systemGroupedBackground))
        .onAppear {
            editedDescription = node.description
        }
    }
    
    // MARK: - Header
    
    private var header: some View {
        HStack {
            Text(node.title)
                .font(.headline)
                .lineLimit(2)
            
            Spacer()
            
            Button {
                onClose()
            } label: {
                Image(systemName: "xmark")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
        .background(.bar)
    }
    
    // MARK: - Properties Section
    
    private var propertiesSection: some View {
        VStack(spacing: 12) {
            // Status
            propertyRow(label: "Status") {
                Menu {
                    ForEach(PlanNode.NodeStatus.allCases, id: \.self) { status in
                        Button {
                            updateNode(status: status)
                        } label: {
                            HStack {
                                Text(status.displayName)
                                if node.status == status {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    StatusBadge(status: node.status)
                }
            }
            
            // Priority
            propertyRow(label: "Priority") {
                Menu {
                    ForEach(Priority.allCases, id: \.self) { priority in
                        Button {
                            updateNode(priority: priority)
                        } label: {
                            HStack {
                                Text(priority.displayName)
                                if node.priority == priority {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    if let priority = node.priority, priority != .none {
                        PriorityBadge(priority: priority)
                    } else {
                        Text("None")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            
            // Estimate
            propertyRow(label: "Estimate") {
                Menu {
                    ForEach(Estimate.allCases, id: \.self) { estimate in
                        Button {
                            updateNode(estimate: estimate)
                        } label: {
                            HStack {
                                Text(estimate.rawValue)
                                if node.estimate == estimate {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    if let estimate = node.estimate {
                        EstimateBadge(estimate: estimate)
                    } else {
                        Text("—")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            
            // Due date
            propertyRow(label: "Due date") {
                if let dueDate = node.dueDate {
                    Text(dueDate)
                        .font(.subheadline)
                } else {
                    Text("—")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            
            // Type (read-only)
            propertyRow(label: "Type") {
                HStack(spacing: 4) {
                    NodeTypeIcon(type: node.type)
                    Text(node.type.rawValue.capitalized)
                        .font(.subheadline)
                }
            }
            
            // Verification (read-only)
            propertyRow(label: "Verification") {
                Text(node.verification.rawValue.capitalized)
                    .font(.subheadline)
            }
            
            // Environment
            if let environment = node.environment {
                propertyRow(label: "Environment") {
                    EnvironmentBadge(environment: environment)
                }
            }
        }
    }
    
    private func propertyRow<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            content()
        }
    }
    
    // MARK: - Description Section
    
    private var descriptionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Description")
                .font(.subheadline.weight(.semibold))
            
            if isEditingDescription {
                TextEditor(text: $editedDescription)
                    .font(.subheadline)
                    .frame(minHeight: 80)
                    .padding(8)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
                
                HStack {
                    Button("Cancel") {
                        editedDescription = node.description
                        isEditingDescription = false
                    }
                    .buttonStyle(.bordered)
                    
                    Spacer()
                    
                    Button("Save") {
                        updateNode(description: editedDescription)
                        isEditingDescription = false
                    }
                    .buttonStyle(.borderedProminent)
                }
            } else {
                Text(node.description.isEmpty ? "No description" : node.description)
                    .font(.subheadline)
                    .foregroundStyle(node.description.isEmpty ? .secondary : .primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
                    .onTapGesture {
                        isEditingDescription = true
                    }
            }
        }
    }
    
    // MARK: - Execution Section
    
    private var executionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Execution")
                .font(.subheadline.weight(.semibold))
            
            if let exec = execution {
                VStack(spacing: 8) {
                    propertyRow(label: "Status") {
                        HStack(spacing: 4) {
                            Circle()
                                .fill(executionStatusColor(exec.status))
                                .frame(width: 8, height: 8)
                            Text(exec.status.rawValue.capitalized)
                                .font(.subheadline)
                        }
                    }

                    if let provider = exec.providerName {
                        propertyRow(label: "Provider") {
                            Text(provider)
                                .font(.subheadline)
                        }
                    }

                    propertyRow(label: "Started") {
                        Text(exec.startedAt.relativeString)
                            .font(.subheadline)
                    }

                    if let metrics = exec.metrics {
                        if let cost = metrics.estimatedCostUsd {
                            propertyRow(label: "Cost") {
                                Text(String(format: "$%.4f", cost))
                                    .font(.subheadline.monospacedDigit())
                            }
                        }
                    }
                }

                // Model + Machine pickers (when not running)
                if exec.status != .running {
                    machinePickers
                }

                // Execution controls
                HStack(spacing: 8) {
                    if exec.status == .running {
                        Button {
                            Task { await executionStore.cancelExecution(nodeId: node.id) }
                        } label: {
                            Label("Stop", systemImage: "stop.fill")
                        }
                        .buttonStyle(.bordered)
                        .tint(.red)
                    } else {
                        Button {
                            dispatchTask()
                        } label: {
                            Label("Run Again", systemImage: "play.fill")
                        }
                        .buttonStyle(.bordered)
                    }

                    NavigationLink(destination: TaskDetailView(nodeId: node.id, projectId: projectId)) {
                        Label("Details", systemImage: "info.circle")
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.top, 4)
            } else {
                // No execution yet — show pickers + run button
                machinePickers

                Button {
                    dispatchTask()
                } label: {
                    Label("Run Task", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }
    
    private func executionStatusColor(_ status: TaskExecution.ExecutionStatus) -> Color {
        switch status {
        case .pending: return .gray
        case .running: return .blue
        case .success: return .green
        case .failure: return .red
        case .cancelled: return .orange
        }
    }
    
    // MARK: - Actions
    
    private var judgmentActions: some View {
        HStack(spacing: 8) {
            Button {
                updateNode(status: .completed)
            } label: {
                Label("Approve", systemImage: "checkmark.circle.fill")
            }
            .buttonStyle(.borderedProminent)
            
            Button {
                updateNode(status: .planned)
            } label: {
                Label("Retry", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            
            Button {
                updateNode(status: .pruned)
            } label: {
                Image(systemName: "xmark.circle")
            }
            .buttonStyle(.bordered)
            .tint(.red)
        }
    }
    
    private var generalActions: some View {
        HStack(spacing: 8) {
            if node.type == .task {
                Button {
                    onDecompose?(node.id)
                } label: {
                    Label("Decompose", systemImage: "square.grid.2x2")
                }
                .buttonStyle(.bordered)
            }
            
            Button {
                updateNode(status: .pruned)
            } label: {
                Label("Prune", systemImage: "scissors")
            }
            .buttonStyle(.bordered)
            .tint(.red)
        }
    }
    
    // MARK: - Update Helpers
    
    private func updateNode(status: PlanNode.NodeStatus? = nil, priority: Priority? = nil, estimate: Estimate? = nil, description: String? = nil) {
        var patch: [String: AnyCodable] = [:]
        if let status { patch["status"] = AnyCodable(status.rawValue) }
        if let priority { patch["priority"] = AnyCodable(priority.rawValue) }
        if let estimate { patch["estimate"] = AnyCodable(estimate.rawValue) }
        if let description { patch["description"] = AnyCodable(description) }
        
        Task {
            try? await planStore.updateNode(id: node.id, projectId: projectId, patch: patch)
        }
    }
    
    private let availableModels: [(id: String, label: String)] = [
        ("claude-sonnet-4-5-20250929", "Sonnet 4.5"),
        ("claude-opus-4-6", "Opus 4.6"),
        ("claude-haiku-4-5-20251001", "Haiku 4.5"),
    ]

    @ViewBuilder
    private var machinePickers: some View {
        VStack(spacing: 8) {
            propertyRow(label: "Model") {
                Picker("Model", selection: $selectedModel) {
                    ForEach(availableModels, id: \.id) { model in
                        Text(model.label).tag(model.id)
                    }
                }
                .pickerStyle(.menu)
            }

            if !connectedMachines.isEmpty {
                propertyRow(label: "Machine") {
                    Picker("Machine", selection: $selectedMachineId) {
                        Text("Auto").tag(nil as String?)
                        ForEach(connectedMachines) { machine in
                            Text(machine.name).tag(machine.machineId as String?)
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
        }
    }

    private func dispatchTask() {
        executionStore.dispatchTask(
            nodeId: node.id,
            projectId: projectId,
            title: node.title,
            description: node.description,
            environment: node.environment?.rawValue ?? "local",
            visionDoc: project?.visionDoc,
            targetMachineId: selectedMachineId ?? project?.defaultMachineId,
            workingDirectory: project?.workingDirectory,
            model: selectedModel
        )
    }
}
