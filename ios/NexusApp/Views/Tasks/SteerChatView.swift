import SwiftUI

/// Send guidance to a running agent
struct SteerChatView: View {
    let nodeId: String
    let projectId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(ExecutionStore.self) private var executionStore
    @Environment(SessionStore.self) private var sessionStore

    @State private var message = ""

    /// Steer messages from the execution session
    private var steerMessages: [SteerMessage] {
        guard let sid = executionStore.executionSessionId(for: nodeId),
              let session = sessionStore.getSession(sid) else { return [] }
        return session.steerMessages
    }

    var body: some View {
        VStack(spacing: 0) {
            // Message history
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(steerMessages) { msg in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Image(systemName: "arrow.triangle.turn.up.right.diamond.fill")
                                    .font(.caption2)
                                    .foregroundStyle(.blue)
                                Text("Guidance sent")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }

                            Text(msg.message)
                                .font(.subheadline)
                                .padding(10)
                                .background(.blue.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))

                            if let accepted = msg.accepted {
                                HStack(spacing: 4) {
                                    Image(systemName: accepted ? "checkmark.circle" : "xmark.circle")
                                        .font(.caption2)
                                        .foregroundStyle(accepted ? .green : .red)
                                    Text(msg.ackMessage ?? (accepted ? "Accepted" : "Rejected"))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                .padding()
            }

            Divider()

            // Input
            HStack(spacing: 8) {
                TextField("Send guidance to agent...", text: $message, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)

                Button {
                    sendGuidance()
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.body)
                }
                .disabled(message.isEmpty)
            }
            .padding()
        }
        .navigationTitle("Steer Agent")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    private func sendGuidance() {
        let msg = message
        message = ""

        Task {
            await executionStore.steer(nodeId: nodeId, message: msg)
        }
    }
}
