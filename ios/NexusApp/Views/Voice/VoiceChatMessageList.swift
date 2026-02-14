import SwiftUI

struct VoiceChatMessageList: View {
    let messages: [VoiceChatMessage]
    let streamingText: String
    let isStreaming: Bool
    let currentScope: NavigationContext.ChatScope

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        VStack(spacing: 4) {
                            // Show scope change label
                            if index == 0 || messages[index - 1].scope != message.scope {
                                scopeChangeLabel(message.scope)
                            }
                            ChatBubbleView(
                                role: message.role.rawValue,
                                content: message.content
                            )
                        }
                    }

                    // Streaming response in progress
                    if isStreaming && !streamingText.isEmpty {
                        ChatBubbleView(
                            role: "assistant",
                            content: streamingText
                        )
                        .opacity(0.9)
                    } else if isStreaming {
                        HStack(spacing: 6) {
                            ProgressView()
                                .controlSize(.small)
                            Text("Thinking...")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                    }

                    // Invisible anchor for auto-scroll
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.vertical, 12)
            }
            .onChange(of: messages.count) {
                withAnimation {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            .onChange(of: streamingText) {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }

    private func scopeChangeLabel(_ scope: NavigationContext.ChatScope) -> some View {
        HStack {
            Rectangle()
                .fill(.separator)
                .frame(height: 0.5)
            Text(scopeName(scope))
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .fixedSize()
            Rectangle()
                .fill(.separator)
                .frame(height: 0.5)
        }
        .padding(.horizontal)
        .padding(.vertical, 4)
    }

    private func scopeName(_ scope: NavigationContext.ChatScope) -> String {
        switch scope {
        case .general: return "General"
        case .project: return "Project context"
        case .task: return "Task context"
        }
    }
}

// MARK: - Chat Bubble

private struct ChatBubbleView: View {
    let role: String
    let content: String

    private var isUser: Bool { role == "user" }
    private var isError: Bool { role == "error" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 48) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 2) {
                Text(content)
                    .font(.body)
                    .foregroundStyle(isError ? .red : .primary)
                    .textSelection(.enabled)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                isUser ? Color.accentColor : (isError ? Color.red.opacity(0.1) : Color(.systemGray6)),
                in: RoundedRectangle(cornerRadius: 16)
            )
            .foregroundStyle(isUser ? .white : .primary)

            if !isUser { Spacer(minLength: 48) }
        }
        .padding(.horizontal)
    }
}
