import SwiftUI

/// Terminal-style output viewer with auto-scroll
struct TaskOutputView: View {
    let execution: TaskExecution?

    @State private var autoScroll = true
    @State private var searchText = ""

    var body: some View {
        if let execution {
            VStack(spacing: 0) {
                // Search bar
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("Search output...", text: $searchText)
                        .font(.caption)
                    if !searchText.isEmpty {
                        Button {
                            searchText = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                    }
                    Toggle("Auto-scroll", isOn: $autoScroll)
                        .font(.caption)
                        .toggleStyle(.switch)
                        .fixedSize()
                }
                .padding(.horizontal)
                .padding(.vertical, 6)

                Divider()

                // Output text
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            let lines = execution.streamText.components(separatedBy: "\n")
                            ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                                if searchText.isEmpty || line.localizedCaseInsensitiveContains(searchText) {
                                    HStack(alignment: .top, spacing: 8) {
                                        Text("\(index + 1)")
                                            .font(.system(.caption2, design: .monospaced))
                                            .foregroundStyle(.tertiary)
                                            .frame(width: 30, alignment: .trailing)

                                        Text(highlightedText(line))
                                            .font(.system(.caption, design: .monospaced))
                                            .textSelection(.enabled)
                                    }
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 1)
                                    .id(index)
                                }
                            }

                            Color.clear
                                .frame(height: 1)
                                .id("bottom")
                        }
                    }
                    .background(Color(.systemGroupedBackground))
                    .onChange(of: execution.streamText) {
                        if autoScroll {
                            withAnimation {
                                proxy.scrollTo("bottom")
                            }
                        }
                    }
                }
            }
        } else {
            ContentUnavailableView(
                "No Output",
                systemImage: "terminal",
                description: Text("Run this task to see execution output.")
            )
        }
    }

    private func highlightedText(_ line: String) -> AttributedString {
        var result = AttributedString(line)
        if !searchText.isEmpty, let range = result.range(of: searchText, options: .caseInsensitive) {
            result[range].backgroundColor = .yellow.opacity(0.3)
        }
        return result
    }
}
