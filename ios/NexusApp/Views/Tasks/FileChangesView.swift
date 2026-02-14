import SwiftUI

/// File change list with diff display
struct FileChangesView: View {
    let changes: [FileChange]

    var body: some View {
        if changes.isEmpty {
            ContentUnavailableView(
                "No File Changes",
                systemImage: "doc.on.doc",
                description: Text("File modifications will appear here during execution.")
            )
        } else {
            List {
                ForEach(changes) { change in
                    FileChangeRow(change: change)
                }
            }
        }
    }
}

private struct FileChangeRow: View {
    let change: FileChange
    @State private var showDiff = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                if change.diff != nil {
                    showDiff.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: actionIcon)
                        .font(.caption)
                        .foregroundStyle(actionColor)

                    Text(change.path)
                        .font(.system(.caption, design: .monospaced))
                        .lineLimit(1)

                    Spacer()

                    HStack(spacing: 4) {
                        if let added = change.linesAdded, added > 0 {
                            Text("+\(added)")
                                .font(.caption2)
                                .foregroundStyle(.green)
                        }
                        if let removed = change.linesRemoved, removed > 0 {
                            Text("-\(removed)")
                                .font(.caption2)
                                .foregroundStyle(.red)
                        }
                    }

                    if change.diff != nil {
                        Image(systemName: showDiff ? "chevron.up" : "chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .buttonStyle(.plain)

            if showDiff, let diff = change.diff {
                ScrollView(.horizontal) {
                    Text(diff)
                        .font(.system(.caption2, design: .monospaced))
                        .textSelection(.enabled)
                        .padding(8)
                }
                .frame(maxHeight: 200)
                .background(Color(.systemGroupedBackground), in: RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    private var actionIcon: String {
        switch change.action {
        case .create: return "plus.circle.fill"
        case .modify: return "pencil.circle.fill"
        case .delete: return "minus.circle.fill"
        }
    }

    private var actionColor: Color {
        switch change.action {
        case .create: return .green
        case .modify: return .blue
        case .delete: return .red
        }
    }
}
