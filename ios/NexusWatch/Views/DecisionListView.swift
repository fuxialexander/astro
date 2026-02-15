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
        case approved, deferred, error(String)
    }

    var body: some View {
        VStack(spacing: 10) {
            // Time display
            Text(formattedTime)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(red: 71/255, green: 85/255, blue: 105/255))
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 4)

            Spacer()

            // Title
            Text(decision.title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            // Recommendation/Description
            Text(decision.description.isEmpty ? "Review this decision" : decision.description)
                .font(.system(size: 11))
                .foregroundStyle(Color(red: 100/255, green: 116/255, blue: 139/255))
                .multilineTextAlignment(.center)
                .lineHeight(1.4)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            Spacer()

            // Action buttons
            if let result = actionResult {
                resultView(result)
            } else {
                actionButtons
            }

            // Pagination dots
            HStack(spacing: 4) {
                Circle()
                    .fill(.white)
                    .frame(width: 6, height: 6)
                ForEach(1..<(store.decisions.count > 0 ? min(3, store.decisions.count) : 1), id: \.self) { _ in
                    Circle()
                        .fill(Color(red: 71/255, green: 85/255, blue: 105/255))
                        .frame(width: 6, height: 6)
                }
            }
            .padding(.bottom, 4)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        .navigationBarHidden(true)
    }

    private var formattedTime: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm"
        return formatter.string(from: Date())
    }

    private var actionButtons: some View {
        HStack(spacing: 8) {
            // Approve button
            Button {
                Task { await performApprove() }
            } label: {
                Image(systemName: "checkmark")
                    .font(.system(size: 22))
                    .foregroundStyle(.white)
                    .frame(width: 72, height: 42)
                    .background(Color(red: 22/255, green: 163/255, blue: 74/255))
                    .clipShape(RoundedRectangle(cornerRadius: 21))
            }
            .buttonStyle(.plain)
            .disabled(isProcessing)

            // Defer button
            Button {
                dismiss()
            } label: {
                Image(systemName: "timer")
                    .font(.system(size: 20))
                    .foregroundStyle(Color(red: 100/255, green: 116/255, blue: 139/255))
                    .frame(width: 72, height: 42)
                    .background(Color(red: 30/255, green: 41/255, blue: 59/255))
                    .clipShape(RoundedRectangle(cornerRadius: 21))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func resultView(_ result: ActionResult) -> some View {
        switch result {
        case .approved:
            Label("Approved", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
                .font(.caption.bold())
        case .deferred:
            Label("Deferred", systemImage: "timer")
                .foregroundStyle(.orange)
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
}
