import SwiftUI

struct ProjectListView: View {
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore
    @Environment(\.colorScheme) private var colorScheme

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
        ZStack {
            AdaptiveColors.background(colorScheme).ignoresSafeArea()

            ScrollView {
                LazyVStack(spacing: NexusTheme.Spacing.md) {
                    ForEach(filteredProjects) { project in
                        NavigationLink(destination: ProjectDetailView(projectId: project.id)) {
                            AdaptiveProjectCard(
                                project: project,
                                isGenerating: planStore.isGenerating(projectId: project.id)
                            )
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button(role: .destructive) {
                                Task { try? await projectStore.deleteProject(project.id) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
                .padding(NexusTheme.Spacing.lg)
                .padding(.bottom, NexusTheme.Spacing.xxxl)
            }
            .adaptiveScrollFade(colorScheme: colorScheme)
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

// Removed: ProjectRow and HealthBadge are now replaced by AdaptiveProjectCard and NexusHealthIndicator from the design system
