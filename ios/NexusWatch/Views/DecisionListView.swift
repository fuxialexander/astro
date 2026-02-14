import SwiftUI

struct DecisionListView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        List {
            if store.decisions.isEmpty {
                ContentUnavailableView(
                    "All Clear",
                    systemImage: "checkmark.seal",
                    description: Text("No pending decisions.")
                )
            } else {
                ForEach(store.decisions) { decision in
                    NavigationLink {
                        DecisionDetailView(decision: decision)
                    } label: {
                        DecisionRow(decision: decision)
                    }
                }
            }
        }
        .navigationTitle("Decisions")
        .refreshable {
            await store.loadDecisions()
        }
    }
}

private struct DecisionRow: View {
    let decision: WatchDecision

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(decision.title)
                .font(.caption.bold())
                .lineLimit(2)

            if let project = decision.projectName {
                Text(project)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            HStack(spacing: 4) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                Text("Awaiting Judgment")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 2)
    }
}

struct DecisionDetailView: View {
    @Environment(WatchStore.self) private var store
    let decision: WatchDecision
    @State private var isProcessing = false
    @State private var actionResult: ActionResult?
    @Environment(\.dismiss) private var dismiss

    enum ActionResult {
        case approved, rejected, error(String)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                // Title
                Text(decision.title)
                    .font(.headline)

                // Project
                if let project = decision.projectName {
                    HStack(spacing: 4) {
                        Image(systemName: "folder")
                            .font(.caption2)
                        Text(project)
                            .font(.caption)
                    }
                    .foregroundStyle(.secondary)
                }

                Divider()

                // Description
                if !decision.description.isEmpty {
                    Text(decision.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Execution output summary
                if let output = decision.executionOutput, !output.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Output")
                            .font(.caption2.bold())
                            .foregroundStyle(.secondary)
                        Text(String(output.suffix(200)))
                            .font(.system(.caption2, design: .monospaced))
                            .lineLimit(6)
                    }
                    .padding(8)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                }

                // Error if any
                if let error = decision.executionError, !error.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.red)
                        Text(error)
                            .font(.caption2)
                            .lineLimit(3)
                    }
                }

                Divider()

                // Action buttons
                if let result = actionResult {
                    resultView(result)
                } else {
                    actionButtons
                }
            }
            .padding()
        }
        .navigationTitle("Review")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var actionButtons: some View {
        VStack(spacing: 8) {
            Button {
                Task { await performApprove() }
            } label: {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                    Text("Approve")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
            .disabled(isProcessing)

            Button(role: .destructive) {
                Task { await performReject() }
            } label: {
                HStack {
                    Image(systemName: "xmark.circle.fill")
                    Text("Reject")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(isProcessing)

            if isProcessing {
                ProgressView()
                    .padding(.top, 4)
            }
        }
    }

    @ViewBuilder
    private func resultView(_ result: ActionResult) -> some View {
        switch result {
        case .approved:
            Label("Approved", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
                .font(.caption.bold())
        case .rejected:
            Label("Rejected", systemImage: "xmark.circle.fill")
                .foregroundStyle(.red)
                .font(.caption.bold())
        case .error(let message):
            VStack(spacing: 4) {
                Label("Error", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                    .font(.caption.bold())
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Button("Retry") {
                    actionResult = nil
                }
                .font(.caption)
            }
        }
    }

    private func performApprove() async {
        isProcessing = true
        let success = await store.approve(decision)
        isProcessing = false
        if success {
            actionResult = .approved
            try? await Task.sleep(for: .seconds(1))
            dismiss()
        } else {
            actionResult = .error(store.lastError ?? "Unknown error")
        }
    }

    private func performReject() async {
        isProcessing = true
        let success = await store.reject(decision)
        isProcessing = false
        if success {
            actionResult = .rejected
            try? await Task.sleep(for: .seconds(1))
            dismiss()
        } else {
            actionResult = .error(store.lastError ?? "Unknown error")
        }
    }
}
