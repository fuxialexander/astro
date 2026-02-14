import SwiftUI

@main
struct NexusApp: App {
    @State private var session = SessionManager.shared
    @State private var projectStore = ProjectStore()
    @State private var planStore = PlanStore()
    @State private var executionStore = ExecutionStore()
    @State private var realtimeStore = RealtimeStore()
    @State private var usageStore = UsageStore()
    @State private var notificationStore = NotificationStore()
    @State private var navigationContext = NavigationContext()
    @State private var voiceChatStore = VoiceChatStore()
    @State private var speechRecognizer = SpeechRecognizer()
    @State private var sessionStore = SessionStore()

    var body: some Scene {
        WindowGroup {
            Group {
                if session.isAuthenticated {
                    MainTabView()
                } else {
                    AuthGateView()
                }
            }
            .environment(session)
            .environment(projectStore)
            .environment(planStore)
            .environment(executionStore)
            .environment(realtimeStore)
            .environment(usageStore)
            .environment(notificationStore)
            .environment(navigationContext)
            .environment(voiceChatStore)
            .environment(speechRecognizer)
            .environment(sessionStore)
            .task {
                executionStore.sessionStore = sessionStore
                executionStore.planStore = planStore
                await session.restoreSession()
                await sessionStore.load()
            }
        }
        #if os(visionOS)
        .defaultSize(width: 1400, height: 900)
        #endif

        #if os(visionOS)
        // Separate window for task detail on visionOS
        WindowGroup("Task Detail", id: "task-detail", for: TaskWindowData.self) { $data in
            if let data {
                TaskDetailView(nodeId: data.nodeId, projectId: data.projectId)
                    .environment(session)
                    .environment(projectStore)
                    .environment(planStore)
                    .environment(executionStore)
                    .environment(realtimeStore)
                    .environment(usageStore)
                    .environment(notificationStore)
                    .environment(navigationContext)
                    .environment(voiceChatStore)
                    .environment(speechRecognizer)
                    .environment(sessionStore)
            }
        }
        .defaultSize(width: 800, height: 600)
        #endif
    }
}

// Data for opening task in a separate visionOS window
struct TaskWindowData: Codable, Hashable {
    let nodeId: String
    let projectId: String
}
