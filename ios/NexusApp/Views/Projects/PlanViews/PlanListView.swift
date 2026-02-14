import SwiftUI

struct PlanListView: View {
    let projectId: String

    @Environment(PlanStore.self) private var planStore
    @State private var grouping: PlanStore.TaskGrouping = .milestone
    @State private var searchText = ""
    @State private var statusFilter: PlanNode.NodeStatus?
    @State private var showAddTask = false

    private var filteredGroups: [(String, [PlanNode])] {
        var groups = planStore.tasksGrouped(by: grouping, projectId: projectId)
        if !searchText.isEmpty {
            groups = groups.map { (key, nodes) in
                (key, nodes.filter {
                    $0.title.localizedCaseInsensitiveContains(searchText) ||
                    $0.description.localizedCaseInsensitiveContains(searchText)
                })
            }.filter { !$0.1.isEmpty }
        }
        if let filter = statusFilter {
            groups = groups.map { (key, nodes) in
                (key, nodes.filter { $0.status == filter })
            }.filter { !$0.1.isEmpty }
        }
        return groups
    }

    var body: some View {
        List {
            ForEach(filteredGroups, id: \.0) { groupName, nodes in
                Section(groupName) {
                    ForEach(nodes) { node in
                        NavigationLink(destination: TaskDetailView(nodeId: node.id, projectId: projectId)) {
                            TaskRow(node: node)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                Task { try? await planStore.deleteNode(id: node.id, projectId: projectId) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
        .searchable(text: $searchText, prompt: "Search tasks")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Section("Group By") {
                        ForEach(PlanStore.TaskGrouping.allCases, id: \.self) { option in
                            Button {
                                grouping = option
                            } label: {
                                HStack {
                                    Text(option.rawValue)
                                    if grouping == option {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }
                    Section("Filter Status") {
                        Button("All") { statusFilter = nil }
                        ForEach(PlanNode.NodeStatus.allCases, id: \.self) { status in
                            Button {
                                statusFilter = status
                            } label: {
                                HStack {
                                    Text(status.displayName)
                                    if statusFilter == status {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showAddTask = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showAddTask) {
            NavigationStack {
                AddTaskView(projectId: projectId)
            }
        }
    }
}

// MARK: - Task Row

struct TaskRow: View {
    let node: PlanNode

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                NodeTypeIcon(type: node.type)
                Text(node.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Spacer()
                StatusBadge(status: node.status)
            }

            if !node.description.isEmpty {
                Text(node.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            HStack(spacing: 8) {
                if let priority = node.priority, priority != .none {
                    PriorityBadge(priority: priority)
                }
                if let estimate = node.estimate {
                    EstimateBadge(estimate: estimate)
                }
                if let env = node.environment {
                    EnvironmentBadge(environment: env)
                }
                Spacer()
                if let dueDate = node.dueDate {
                    Text(dueDate)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Add Task View

private struct AddTaskView: View {
    let projectId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(PlanStore.self) private var planStore

    @State private var title = ""
    @State private var description = ""
    @State private var type: PlanNode.NodeType = .task
    @State private var priority: Priority = .medium
    @State private var estimate: Estimate = .m
    @State private var environment: TaskEnvironment?

    var body: some View {
        Form {
            Section("Task Details") {
                TextField("Title", text: $title)
                TextField("Description", text: $description, axis: .vertical)
                    .lineLimit(3...6)
            }

            Section("Properties") {
                Picker("Type", selection: $type) {
                    ForEach(PlanNode.NodeType.allCases, id: \.self) { t in
                        Text(t.rawValue.capitalized).tag(t)
                    }
                }
                Picker("Priority", selection: $priority) {
                    ForEach(Priority.allCases, id: \.self) { p in
                        Text(p.displayName).tag(p)
                    }
                }
                Picker("Estimate", selection: $estimate) {
                    ForEach(Estimate.allCases, id: \.self) { e in
                        Text(e.rawValue).tag(e)
                    }
                }
                Picker("Environment", selection: $environment) {
                    Text("Auto").tag(nil as TaskEnvironment?)
                    ForEach([TaskEnvironment.remote, .hpc, .cloud], id: \.self) { e in
                        Text(e.rawValue.capitalized).tag(e as TaskEnvironment?)
                    }
                }
            }
        }
        .navigationTitle("Add Task")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Add") {
                    addTask()
                }
                .disabled(title.isEmpty)
            }
        }
    }

    private func addTask() {
        let node = PlanNode(
            id: UUID().uuidString,
            projectId: projectId,
            type: type,
            title: title,
            description: description,
            status: .planned,
            dependencies: [],
            environment: environment,
            verification: .auto,
            position: .init(x: 0, y: 0),
            priority: priority,
            estimate: estimate,
            createdAt: .now,
            updatedAt: .now
        )

        Task {
            try? await planStore.addNode(node)
            dismiss()
        }
    }
}
