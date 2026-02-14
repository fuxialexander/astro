import SwiftUI

struct VoiceChatSheet: View {
    @Environment(NavigationContext.self) private var navigationContext
    @Environment(VoiceChatStore.self) private var voiceChatStore
    @Environment(ProjectStore.self) private var projectStore
    @Environment(PlanStore.self) private var planStore
    @Environment(\.dismiss) private var dismiss

    @State private var textInput: String = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Context badge
                HStack {
                    ContextBadge(
                        scope: navigationContext.chatScope,
                        projectName: currentProjectName,
                        taskTitle: currentTaskTitle
                    )
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.top, 8)
                .padding(.bottom, 4)

                Divider()

                // Message list
                if voiceChatStore.messages.isEmpty && !voiceChatStore.isStreaming {
                    emptyState
                } else {
                    VoiceChatMessageList(
                        messages: voiceChatStore.messages,
                        streamingText: voiceChatStore.streamingText,
                        isStreaming: voiceChatStore.isStreaming,
                        currentScope: navigationContext.chatScope
                    )
                }

                Divider()

                // Input bar
                VoiceInputBar(
                    textInput: $textInput,
                    isStreaming: voiceChatStore.isStreaming,
                    onSend: { message, _ in
                        voiceChatStore.send(
                            message: message,
                            scope: navigationContext.chatScope,
                            projectStore: projectStore,
                            planStore: planStore
                        )
                    }
                )
            }
            .navigationTitle("Voice Assistant")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !voiceChatStore.messages.isEmpty {
                        Button("Clear") {
                            voiceChatStore.clearHistory()
                        }
                        .font(.subheadline)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }

    // MARK: - Helpers

    private var currentProjectName: String? {
        guard let id = navigationContext.currentProjectId else { return nil }
        return projectStore.project(id: id)?.name
    }

    private var currentTaskTitle: String? {
        guard let nodeId = navigationContext.currentNodeId,
              let projectId = navigationContext.currentProjectId else { return nil }
        return planStore.node(id: nodeId, projectId: projectId)?.title
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "waveform.circle")
                .font(.system(size: 48))
                .foregroundStyle(.tertiary)
            Text("Ask anything")
                .font(.headline)
                .foregroundStyle(.secondary)
            Text("Use voice or text to create projects, refine plans, and manage tasks.")
                .font(.subheadline)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
        }
    }
}
