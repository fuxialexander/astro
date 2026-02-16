import SwiftUI

/// Displays approval requests with options for user response.
/// Supports both binary (approve/reject) and multi-choice approvals.
struct ApprovalCard: View {
    let approval: ActivityEvent
    let onRespond: (Bool, String?) async throws -> Void

    @State private var selectedOption: String?
    @State private var isResponding = false
    @State private var errorMessage: String?

    init(approval: ActivityEvent, onRespond: @escaping (Bool, String?) async throws -> Void) {
        self.approval = approval
        self.onRespond = onRespond
        // Default to first option if multi-choice
        _selectedOption = State(initialValue: approval.approvalOptions?.first)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.title2)
                    .foregroundStyle(.orange)

                Text("Approval Required")
                    .font(.headline)
                    .foregroundStyle(.primary)
            }

            // Message
            Text(approval.approvalMessage ?? "Approval required to continue")
                .font(.body)
                .foregroundStyle(.secondary)

            // Multi-choice options
            if let options = approval.approvalOptions, !options.isEmpty {
                VStack(spacing: 8) {
                    ForEach(options, id: \.self) { option in
                        Button {
                            selectedOption = option
                        } label: {
                            HStack {
                                Image(systemName: selectedOption == option ? "circle.fill" : "circle")
                                    .foregroundStyle(selectedOption == option ? .blue : .secondary)

                                Text(option)
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                    .multilineTextAlignment(.leading)

                                Spacer()
                            }
                            .padding(12)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(selectedOption == option ? Color.blue.opacity(0.1) : Color(.systemGray6))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(selectedOption == option ? Color.blue : Color.clear, lineWidth: 1.5)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Error message
            if let error = errorMessage {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(.red)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            // Action buttons
            HStack(spacing: 12) {
                // Reject button
                Button {
                    Task {
                        await handleReject()
                    }
                } label: {
                    HStack {
                        Image(systemName: "xmark")
                        Text("Reject")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color(.systemGray5))
                    .foregroundStyle(.primary)
                    .cornerRadius(8)
                }
                .disabled(isResponding)

                // Approve button
                Button {
                    Task {
                        await handleApprove()
                    }
                } label: {
                    HStack {
                        if isResponding {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(.white)
                        } else {
                            Image(systemName: "checkmark")
                        }
                        Text("Approve")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color.blue)
                    .foregroundStyle(.white)
                    .cornerRadius(8)
                }
                .disabled(isResponding)
            }
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(.systemBackground))
                .shadow(color: .orange.opacity(0.2), radius: 8, x: 0, y: 2)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.orange.opacity(0.3), lineWidth: 1)
        )
    }

    private func handleApprove() async {
        isResponding = true
        errorMessage = nil

        do {
            // For multi-choice, send selected option
            if approval.approvalOptions != nil {
                try await onRespond(true, selectedOption)
            } else {
                // Binary approval
                try await onRespond(true, nil)
            }
        } catch {
            errorMessage = error.localizedDescription
            isResponding = false
        }
    }

    private func handleReject() async {
        isResponding = true
        errorMessage = nil

        do {
            try await onRespond(false, nil)
        } catch {
            errorMessage = error.localizedDescription
            isResponding = false
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        // Binary approval
        ApprovalCard(
            approval: ActivityEvent(
                id: "1",
                type: .approvalRequested,
                data: [
                    "approvalId": AnyCodable("approval-1"),
                    "message": AnyCodable("Do you want to proceed with deployment?")
                ]
            ),
            onRespond: { approved, _ in
                print("Binary approval: \(approved)")
            }
        )

        // Multi-choice approval
        ApprovalCard(
            approval: ActivityEvent(
                id: "2",
                type: .approvalRequested,
                data: [
                    "approvalId": AnyCodable("approval-2"),
                    "message": AnyCodable("Which implementation approach should I use?"),
                    "options": AnyCodable([
                        "Approach 1: Minimal change to existing code",
                        "Approach 2: Refactor for cleaner architecture",
                        "Approach 3: Build new abstraction"
                    ])
                ]
            ),
            onRespond: { approved, option in
                print("Multi-choice approval: \(approved), option: \(option ?? "none")")
            }
        )
    }
    .padding()
}
