import SwiftUI

/// Unified session activity timeline view
struct SessionActivityView: View {
    let events: [TaskActivityEvent]

    var body: some View {
        if events.isEmpty {
            ContentUnavailableView(
                "No Activity",
                systemImage: "clock",
                description: Text("Session activity will stream here during execution.")
            )
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(events.enumerated()), id: \.offset) { _, event in
                        ActivityEventRow(event: event)
                    }
                }
                .padding()
            }
        }
    }
}

private struct ActivityEventRow: View {
    let event: TaskActivityEvent

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .font(.caption2)
                .foregroundStyle(iconColor)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                switch event {
                case .text(let content, _):
                    Text(content)
                        .font(.system(.caption, design: .monospaced))
                        .lineLimit(5)

                case .toolUse(_, let toolName, _, _):
                    Text("Tool: \(toolName)")
                        .font(.caption.weight(.medium))

                case .toolResult(_, let toolName, _, let success, let duration, _):
                    HStack {
                        Text("Result: \(toolName)")
                            .font(.caption.weight(.medium))
                        if let s = success {
                            Image(systemName: s ? "checkmark" : "xmark")
                                .font(.caption2)
                                .foregroundStyle(s ? .green : .red)
                        }
                        if let d = duration {
                            Text(String(format: "%.1fs", d / 1000))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }

                case .steer(let message, let accepted, _, _, _):
                    VStack(alignment: .leading) {
                        Text("Steer: \(message)")
                            .font(.caption)
                        if let a = accepted {
                            Text(a ? "Accepted" : "Rejected")
                                .font(.caption2)
                                .foregroundStyle(a ? .green : .red)
                        }
                    }

                case .fileChange(let path, let action, _, _, _, _):
                    Text("\(action): \(path)")
                        .font(.system(.caption, design: .monospaced))

                case .error(let error, _):
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)

                case .chatUser(let message, _):
                    Text("You: \(message)")
                        .font(.caption)

                case .chatAssistant(let content, _):
                    Text(content)
                        .font(.caption)
                        .lineLimit(3)
                }

                Text(timestamp.relativeString)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }

    private var timestamp: Date {
        switch event {
        case .text(_, let ts), .toolUse(_, _, _, let ts),
             .toolResult(_, _, _, _, _, let ts), .steer(_, _, _, _, let ts),
             .fileChange(_, _, _, _, _, let ts), .error(_, let ts),
             .chatUser(_, let ts), .chatAssistant(_, let ts):
            return ts
        }
    }

    private var icon: String {
        switch event {
        case .text: return "text.alignleft"
        case .toolUse: return "wrench"
        case .toolResult: return "checkmark.circle"
        case .steer: return "arrow.triangle.turn.up.right.diamond"
        case .fileChange: return "doc"
        case .error: return "exclamationmark.triangle"
        case .chatUser: return "person"
        case .chatAssistant: return "sparkles"
        }
    }

    private var iconColor: Color {
        switch event {
        case .text: return .secondary
        case .toolUse: return .blue
        case .toolResult: return .green
        case .steer: return .purple
        case .fileChange: return .orange
        case .error: return .red
        case .chatUser: return .blue
        case .chatAssistant: return .purple
        }
    }
}
