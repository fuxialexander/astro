import SwiftUI

struct MainTabView: View {
    @Environment(RealtimeStore.self) private var realtimeStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore
    @Environment(NavigationContext.self) private var navigationContext
    @State private var selectedTab: Tab = .dashboard
    @State private var showVoiceChat = false
    @SwiftUI.Environment(\.horizontalSizeClass) private var sizeClass

    enum Tab: String, CaseIterable, Identifiable {
        case dashboard = "Dashboard"
        case projects = "Projects"
        case myTasks = "My Tasks"
        case settings = "Settings"

        var id: String { rawValue }

        var icon: String {
            switch self {
            case .dashboard: return "square.grid.2x2"
            case .projects: return "folder"
            case .myTasks: return "checkmark.circle"
            case .settings: return "gearshape"
            }
        }

        var keyboardShortcut: KeyEquivalent? {
            switch self {
            case .dashboard: return "1"
            case .projects: return "2"
            case .myTasks: return "3"
            case .settings: return "4"
            }
        }
    }

    var body: some View {
        Group {
            if isCompact {
                compactLayout
            } else {
                regularLayout
            }
        }
        .task {
            await projectStore.loadProjects()
            realtimeStore.connect()
        }
        // Keyboard shortcuts for iPad/visionOS
        .keyboardShortcut("1", modifiers: .command) { selectedTab = .dashboard }
        .keyboardShortcut("2", modifiers: .command) { selectedTab = .projects }
        .keyboardShortcut("3", modifiers: .command) { selectedTab = .myTasks }
        .keyboardShortcut("4", modifiers: .command) { selectedTab = .settings }
    }

    private var isCompact: Bool {
        #if os(watchOS)
        return true
        #else
        return sizeClass == .compact
        #endif
    }

    // MARK: - iPhone: Tab bar with centered voice button

    private var compactLayout: some View {
        VStack(spacing: 0) {
            // Main content
            Group {
                switch selectedTab {
                case .dashboard:
                    NavigationStack {
                        DashboardView()
                    }
                case .projects:
                    NavigationStack {
                        ProjectListView()
                    }
                case .myTasks:
                    NavigationStack {
                        MyTasksView()
                    }
                case .settings:
                    NavigationStack {
                        SettingsView()
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            
            // Custom tab bar with voice button in center
            customTabBar
        }
        .sheet(isPresented: $showVoiceChat) {
            VoiceChatSheet()
        }
        .onChange(of: selectedTab) { _, newTab in
            navigationContext.currentTabName = newTab.rawValue
            // Clear project/task context when leaving project tabs
            if newTab != .projects {
                navigationContext.currentProjectId = nil
                navigationContext.currentNodeId = nil
            }
        }
    }
    
    private var customTabBar: some View {
        HStack(spacing: 0) {
            // Dashboard
            tabBarButton(for: .dashboard)
            
            // Projects
            tabBarButton(for: .projects)
            
            // Voice button (center)
            Button {
                showVoiceChat = true
            } label: {
                ZStack {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 56, height: 56)
                        .shadow(color: .accentColor.opacity(0.3), radius: 8, y: 4)
                    
                    Image(systemName: "waveform")
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(.white)
                }
            }
            .offset(y: -12)
            
            // My Tasks
            tabBarButton(for: .myTasks)
            
            // Settings
            tabBarButton(for: .settings)
        }
        .padding(.horizontal, 8)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .background {
            Rectangle()
                .fill(.bar)
                .ignoresSafeArea(edges: .bottom)
        }
    }
    
    private func tabBarButton(for tab: Tab) -> some View {
        Button {
            selectedTab = tab
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.icon)
                    .font(.system(size: 20))
                Text(tab.rawValue)
                    .font(.caption2)
            }
            .foregroundStyle(selectedTab == tab ? Color.accentColor : Color.secondary)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - iPad / visionOS: Sidebar split view

    @State private var selectedProjectId: String?
    @State private var selectedNodeId: String?
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    private var regularLayout: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            iPadSidebar
        } content: {
            iPadContent
        } detail: {
            iPadDetail
        }
        .navigationSplitViewStyle(.balanced)
        #if os(visionOS)
        .ornament(attachmentAnchor: .scene(.bottom)) {
            HStack(spacing: 16) {
                ForEach(Tab.allCases) { tab in
                    Button {
                        selectedTab = tab
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: tab.icon)
                                .font(.title3)
                            Text(tab.rawValue)
                                .font(.caption2)
                        }
                        .foregroundStyle(selectedTab == tab ? .primary : .secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .glassBackgroundEffect()
        }
        #endif
    }

    private var iPadSidebar: some View {
        List(selection: Binding<Tab?>(get: { selectedTab }, set: { if let tab = $0 { selectedTab = tab } })) {
            Section {
                ForEach(Tab.allCases) { tab in
                    Label(tab.rawValue, systemImage: tab.icon)
                        .tag(tab)
                }
            }

            Section("Projects") {
                ForEach(projectStore.activeProjects) { project in
                    Button {
                        selectedTab = .projects
                        selectedProjectId = project.id
                    } label: {
                        HStack {
                            Circle()
                                .fill(projectHealthColor(project.health))
                                .frame(width: 6, height: 6)
                            Text(project.name)
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            Section("Quick Stats") {
                Label("\(realtimeStore.connectedMachines.count) machines", systemImage: "desktopcomputer")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Label("\(realtimeStore.totalActiveTasks) active tasks", systemImage: "bolt.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Nexus")
        #if !os(visionOS)
        .listStyle(.sidebar)
        #endif
    }

    @ViewBuilder
    private var iPadContent: some View {
        switch selectedTab {
        case .dashboard:
            DashboardView()
        case .projects:
            if let projectId = selectedProjectId {
                ProjectDetailView(projectId: projectId)
            } else {
                ProjectListView()
            }
        case .myTasks:
            MyTasksView()
        case .settings:
            SettingsView()
        }
    }

    @ViewBuilder
    private var iPadDetail: some View {
        if let nodeId = selectedNodeId, let projectId = selectedProjectId {
            TaskDetailView(nodeId: nodeId, projectId: projectId)
        } else if selectedTab == .projects, let projectId = selectedProjectId {
            PlanGraphView(projectId: projectId)
        } else {
            ContentUnavailableView("Select an Item", systemImage: "sidebar.right", description: Text("Choose a task or project to see details."))
        }
    }

    // MARK: - Shared

    private func projectHealthColor(_ health: Project.ProjectHealth?) -> Color {
        switch health {
        case .onTrack: return .green
        case .atRisk: return .yellow
        case .offTrack: return .red
        case nil: return .gray
        }
    }
}

// MARK: - Keyboard shortcut helper

private extension View {
    func keyboardShortcut(_ key: KeyEquivalent, modifiers: EventModifiers, action: @escaping () -> Void) -> some View {
        self.background {
            Button("") { action() }
                .keyboardShortcut(key, modifiers: modifiers)
                .frame(width: 0, height: 0)
                .opacity(0)
        }
    }
}
