import SwiftUI

/// Vertical timeline of tool calls with collapsible I/O
struct ToolTraceView: View {
    let traces: [ToolTrace]

    var body: some View {
        if traces.isEmpty {
            ContentUnavailableView(
                "No Tool Calls",
                systemImage: "wrench.and.screwdriver",
                description: Text("Tool calls will appear here during execution.")
            )
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(traces.enumerated()), id: \.element.id) { index, trace in
                        ToolTraceRow(trace: trace, isLast: index == traces.count - 1)
                    }
                }
                .padding()
            }
        }
    }
}

private struct ToolTraceRow: View {
    let trace: ToolTrace
    let isLast: Bool

    @State private var isExpanded = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Timeline line + dot
            VStack(spacing: 0) {
                Circle()
                    .fill(dotColor)
                    .frame(width: 10, height: 10)

                if !isLast {
                    Rectangle()
                        .fill(.secondary.opacity(0.3))
                        .frame(width: 1)
                        .frame(maxHeight: .infinity)
                }
            }
            .frame(width: 10)

            // Content
            VStack(alignment: .leading, spacing: 6) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                } label: {
                    HStack {
                        Image(systemName: "wrench")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(trace.toolName)
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        if let success = trace.success {
                            Image(systemName: success ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(success ? .green : .red)
                        }
                        if let duration = trace.duration {
                            Text(String(format: "%.1fs", duration / 1000))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .buttonStyle(.plain)

                if isExpanded {
                    VStack(alignment: .leading, spacing: 8) {
                        // Input
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Input")
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(.secondary)
                            Text(trace.toolInput.prettyJSON)
                                .font(.system(.caption2, design: .monospaced))
                                .textSelection(.enabled)
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(.systemGroupedBackground), in: RoundedRectangle(cornerRadius: 6))
                        }

                        // Result
                        if let result = trace.toolResult {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Result")
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(.secondary)
                                Text(result.prettyJSON)
                                    .font(.system(.caption2, design: .monospaced))
                                    .textSelection(.enabled)
                                    .lineLimit(20)
                                    .padding(8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color(.systemGroupedBackground), in: RoundedRectangle(cornerRadius: 6))
                            }
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }

                Text(trace.timestamp.relativeString)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.bottom, 12)
    }

    private var dotColor: Color {
        if let success = trace.success {
            return success ? .green : .red
        }
        return .blue
    }
}
