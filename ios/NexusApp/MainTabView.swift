import SwiftUI

struct MainTabView: View {
    @Environment(RealtimeStore.self) private var realtimeStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore
    @Environment(NavigationContext.self) private var navigationContext
    @State private var selectedTab: Tab = .pulse
    @State private var showVoiceChat = false
    @SwiftUI.Environment(\.horizontalSizeClass) private var sizeClass

    enum Tab: String, CaseIterable, Identifiable {
        case pulse = "Pulse"
        case plan = "Plan"
        case agents = "Agents"
        case environments = "Envs"

        var id: String { rawValue }

        var icon: String {
            switch self {
            case .pulse: return "waveform.path.ecg"
            case .plan: return "arrow.triangle.branch"
            case .agents: return "bolt.fill"
            case .environments: return "server.rack"
            }
        }

        var keyboardShortcut: KeyEquivalent? {
            switch self {
            case .pulse: return "1"
            case .plan: return "2"
            case .agents: return "3"
            case .environments: return "4"
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
        .keyboardShortcut("1", modifiers: .command) { selectedTab = .pulse }
        .keyboardShortcut("2", modifiers: .command) { selectedTab = .plan }
        .keyboardShortcut("3", modifiers: .command) { selectedTab = .agents }
        .keyboardShortcut("4", modifiers: .command) { selectedTab = .environments }
    }

    private var isCompact: Bool {
        #if os(watchOS)
        return true
        #else
        return sizeClass == .compact
        #endif
    }

    // MARK: - iPhone: New pill-shaped tab bar

    private var compactLayout: some View {
        ZStack(alignment: .bottom) {
            // Main content
            Group {
                switch selectedTab {
                case .pulse:
                    NavigationStack {
                        PulseView()
                    }
                case .plan:
                    NavigationStack {
                        ProjectListView()
                    }
                case .agents:
                    NavigationStack {
                        AgentsView()
                    }
                case .environments:
                    NavigationStack {
                        EnvironmentsView()
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            // New pill-shaped tab bar
            modernTabBar
        }
        .onChange(of: selectedTab) { _, newTab in
            navigationContext.currentTabName = newTab.rawValue
            // Clear project/task context when leaving project tabs
            if newTab != .plan {
                navigationContext.currentProjectId = nil
                navigationContext.currentNodeId = nil
            }
        }
    }
    
    private var modernTabBar: some View {
        VStack(spacing: 0) {
            // Gradient fade with smoother transition
            LinearGradient(
                stops: [
                    .init(color: Color.black.opacity(0), location: 0),
                    .init(color: Color.black.opacity(0.3), location: 0.5),
                    .init(color: Color.black.opacity(0.7), location: 1.0)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 40)

            // Pill-shaped tab container with glass effect
            HStack(spacing: 0) {
                ForEach(Tab.allCases) { tab in
                    tabBarButton(for: tab)
                }
            }
            .padding(4)
            .background(.thinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 31)
                    .strokeBorder(.glassStroke, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 31))
            .shadow(color: .black.opacity(0.3), radius: 30, x: 0, y: -8)
            .shadow(color: .black.opacity(0.15), radius: 12, x: 0, y: -2)
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .ignoresSafeArea(edges: .bottom)
    }

    private func tabBarButton(for tab: Tab) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedTab = tab
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.icon)
                    .font(.system(size: 24))
                    .symbolRenderingMode(.hierarchical)

                Text(tab.rawValue)
                    .font(.system(size: 10, weight: selectedTab == tab ? .semibold : .medium))
            }
            .foregroundStyle(selectedTab == tab ? .primary : .secondary)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(
                Group {
                    if selectedTab == tab {
                        RoundedRectangle(cornerRadius: 27)
                            .fill(.regularMaterial)
                            .overlay(
                                RoundedRectangle(cornerRadius: 27)
                                    .strokeBorder(.glassStroke, lineWidth: 0.5)
                            )
                            .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 2)
                    }
                }
            )
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
                        selectedTab = .plan
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
        case .pulse:
            PulseView()
        case .plan:
            if let projectId = selectedProjectId {
                // Use iPad-optimized plan graph view with built-in inspector
                PlanGraphViewiPad(projectId: projectId)
            } else {
                ProjectListView()
            }
        case .agents:
            // Use iPad-optimized agents view with built-in detail panel
            AgentsViewiPad()
        case .environments:
            // Use iPad-optimized environments view with built-in detail panel
            EnvironmentsViewiPad()
        }
    }

    @ViewBuilder
    private var iPadDetail: some View {
        if let nodeId = selectedNodeId, let projectId = selectedProjectId {
            TaskDetailView(nodeId: nodeId, projectId: projectId)
        } else if selectedTab == .plan, let projectId = selectedProjectId {
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

// Color extension moved to Extensions/ColorExtensions.swift
