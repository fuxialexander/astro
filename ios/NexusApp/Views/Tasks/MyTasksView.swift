import SwiftUI

struct MyTasksView: View {
    @Environment(PlanStore.self) private var planStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(\.colorScheme) private var colorScheme

    var initialStatusFilter: Set<PlanNode.NodeStatus>? = nil

    @State private var searchText = ""
    @State private var groupBy: GroupOption = .project
    @State private var statusFilter: Set<PlanNode.NodeStatus> = []
    @State private var priorityFilter: Priority?

    enum GroupOption: String, CaseIterable {
        case project = "Project"
        case status = "Status"
        case priority = "Priority"
        case none = "None"
    }

    private var allTasks: [PlanNode] {
        planStore.nodesByProject.values.flatMap { $0 }.filter { $0.type == .task }
    }

    private var filteredTasks: [PlanNode] {
        var tasks = allTasks
        if !searchText.isEmpty {
            tasks = tasks.filter {
                $0.title.localizedCaseInsensitiveContains(searchText) ||
                $0.description.localizedCaseInsensitiveContains(searchText)
            }
        }
        if !statusFilter.isEmpty {
            tasks = tasks.filter { statusFilter.contains($0.status) }
        }
        if let pf = priorityFilter {
            tasks = tasks.filter { $0.priority == pf }
        }
        return tasks
    }

    private var groupedTasks: [(String, [PlanNode])] {
        switch groupBy {
        case .project:
            let grouped = Dictionary(grouping: filteredTasks) { node -> String in
                projectStore.project(id: node.projectId)?.name ?? "Unknown Project"
            }
            return grouped.sorted { $0.key < $1.key }
        case .status:
            let grouped = Dictionary(grouping: filteredTasks) { $0.status.displayName }
            return grouped.sorted { $0.key < $1.key }
        case .priority:
            let grouped = Dictionary(grouping: filteredTasks) { ($0.priority ?? .none).displayName }
            return grouped.sorted { $0.key < $1.key }
        case .none:
            return filteredTasks.isEmpty ? [] : [("All", filteredTasks)]
        }
    }

    var body: some View {
        ZStack {
            AdaptiveColors.background(colorScheme).ignoresSafeArea()

            ScrollView {
                LazyVStack(spacing: NexusTheme.Spacing.lg, pinnedViews: [.sectionHeaders]) {
                    ForEach(groupedTasks, id: \.0) { groupName, tasks in
                        Section {
                            ForEach(tasks) { task in
                                NavigationLink(destination: TaskDetailView(nodeId: task.id, projectId: task.projectId)) {
                                    AdaptiveTaskRow(
                                        node: task,
                                        projectName: groupBy != .project ? projectStore.project(id: task.projectId)?.name : nil
                                    )
                                }
                                .buttonStyle(.plain)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button(role: .destructive) {
                                        Task { try? await planStore.deleteNode(id: task.id, projectId: task.projectId) }
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                        } header: {
                            NexusSectionHeader(
                                title: groupName,
                                count: tasks.count
                            )
                            .padding(.horizontal, NexusTheme.Spacing.lg)
                            .padding(.top, NexusTheme.Spacing.md)
                            .padding(.bottom, NexusTheme.Spacing.sm)
                            .background(AdaptiveColors.background(colorScheme))
                        }
                    }
                }
                .padding(NexusTheme.Spacing.lg)
            }
            .adaptiveScrollFade(colorScheme: colorScheme)

            if allTasks.isEmpty {
                ContentUnavailableView(
                    "No Tasks",
                    systemImage: "checkmark.circle",
                    description: Text("Tasks from your projects will appear here.")
                )
            }
        }
        .searchable(text: $searchText, prompt: "Search tasks")
        .navigationTitle(statusFilter.isEmpty ? "My Tasks" : "Running Tasks")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Section("Group By") {
                        ForEach(GroupOption.allCases, id: \.self) { option in
                            Button {
                                groupBy = option
                            } label: {
                                HStack {
                                    Text(option.rawValue)
                                    if groupBy == option {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }

                    Section("Filter by Status") {
                        ForEach(PlanNode.NodeStatus.allCases, id: \.self) { status in
                            Button {
                                if statusFilter.contains(status) {
                                    statusFilter.remove(status)
                                } else {
                                    statusFilter.insert(status)
                                }
                            } label: {
                                HStack {
                                    Text(status.displayName)
                                    if statusFilter.contains(status) {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }

                    if !statusFilter.isEmpty || priorityFilter != nil {
                        Section {
                            Button("Clear All Filters") {
                                statusFilter = []
                                priorityFilter = nil
                            }
                        }
                    }
                } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                        if !statusFilter.isEmpty || priorityFilter != nil {
                            Circle()
                                .fill(AdaptiveColors.primary)
                                .frame(width: 8, height: 8)
                                .offset(x: 4, y: -4)
                        }
                    }
                }
            }
        }
        .task {
            // Load all project plans
            for project in projectStore.activeProjects {
                await planStore.loadPlan(projectId: project.id)
            }
        }
        .onAppear {
            // Apply initial status filter if provided
            if let initialFilter = initialStatusFilter {
                statusFilter = initialFilter
            }
        }
    }
}
