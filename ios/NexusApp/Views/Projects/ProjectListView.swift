import SwiftUI

struct ProjectListView: View {
    @Environment(ProjectStore.self) private var projectStore
    @State private var searchText = ""
    @State private var showNewProject = false
    @State private var sortBy: SortOption = .updated

    enum SortOption: String, CaseIterable {
        case updated = "Updated"
        case name = "Name"
        case health = "Health"
    }

    private var filteredProjects: [Project] {
        var projects = projectStore.activeProjects
        if !searchText.isEmpty {
            projects = projects.filter {
                $0.name.localizedCaseInsensitiveContains(searchText) ||
                $0.description.localizedCaseInsensitiveContains(searchText)
            }
        }
        switch sortBy {
        case .updated: return projects.sorted { $0.updatedAt > $1.updatedAt }
        case .name: return projects.sorted { $0.name < $1.name }
        case .health: return projects.sorted { ($0.health?.rawValue ?? "") < ($1.health?.rawValue ?? "") }
        }
    }

    var body: some View {
        List {
            ForEach(filteredProjects) { project in
                NavigationLink(destination: ProjectDetailView(projectId: project.id)) {
                    ProjectRow(project: project)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) {
                        Task { try? await projectStore.deleteProject(project.id) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
        .searchable(text: $searchText, prompt: "Search projects")
        .navigationTitle("Projects")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ForEach(SortOption.allCases, id: \.self) { option in
                        Button {
                            sortBy = option
                        } label: {
                            HStack {
                                Text(option.rawValue)
                                if sortBy == option {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                }
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showNewProject = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showNewProject) {
            NavigationStack {
                NewProjectView()
            }
        }
        .refreshable {
            await projectStore.refresh()
        }
    }
}

private struct ProjectRow: View {
    let project: Project
    @Environment(PlanStore.self) private var planStore

    private var isGenerating: Bool {
        planStore.isGenerating(projectId: project.id)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(project.name)
                    .font(.body.weight(.medium))
                Spacer()
                if isGenerating {
                    ProgressView()
                        .scaleEffect(0.7)
                } else if let health = project.health {
                    HealthBadge(health: health)
                }
            }

            Text(project.description)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            HStack(spacing: 12) {
                if isGenerating {
                    Text("Generating plan...")
                        .font(.caption2)
                        .foregroundStyle(.blue)
                } else if let progress = project.progress {
                    HStack(spacing: 4) {
                        ProgressView(value: Double(progress), total: 100)
                            .frame(width: 40)
                        Text("\(progress)%")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                if let startDate = project.startDate {
                    Text(startDate)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Spacer()

                Text(project.updatedAt.relativeString)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct HealthBadge: View {
    let health: Project.ProjectHealth

    var body: some View {
        Text(displayName)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }

    private var displayName: String {
        switch health {
        case .onTrack: return "On Track"
        case .atRisk: return "At Risk"
        case .offTrack: return "Off Track"
        }
    }

    private var color: Color {
        switch health {
        case .onTrack: return .green
        case .atRisk: return .yellow
        case .offTrack: return .red
        }
    }
}
