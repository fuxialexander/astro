import SwiftUI

/// Horizontal Gantt-like timeline view for plan nodes
struct PlanTimelineView: View {
    let projectId: String

    @Environment(PlanStore.self) private var planStore
    @State private var scale: CGFloat = 1.0

    private var nodes: [PlanNode] {
        planStore.nodes(for: projectId)
            .filter { $0.startDate != nil || $0.endDate != nil }
            .sorted { ($0.startDate ?? "") < ($1.startDate ?? "") }
    }

    private var milestones: [PlanNode] {
        planStore.milestones(for: projectId)
    }

    private var dateRange: (start: Date, end: Date) {
        let formatter = DateFormatter.dateOnly
        let starts = nodes.compactMap { $0.startDate.flatMap { formatter.date(from: $0) } }
        let ends = nodes.compactMap { $0.endDate.flatMap { formatter.date(from: $0) } }
        let allDates = starts + ends
        let start = allDates.min() ?? Date()
        let end = allDates.max() ?? Date().addingTimeInterval(30 * 24 * 3600)
        return (start, end)
    }

    var body: some View {
        if nodes.isEmpty {
            ContentUnavailableView(
                "No Timeline Data",
                systemImage: "calendar",
                description: Text("Tasks need start/end dates to appear on the timeline.")
            )
        } else {
            ScrollView([.horizontal, .vertical]) {
                VStack(alignment: .leading, spacing: 2) {
                    // Header
                    TimelineHeader(dateRange: dateRange, scale: scale)

                    // Milestone markers
                    ForEach(milestones) { ms in
                        MilestoneRow(node: ms, dateRange: dateRange, scale: scale)
                    }

                    Divider()

                    // Task bars
                    ForEach(nodes.filter { $0.type == .task }) { node in
                        TaskTimelineRow(node: node, dateRange: dateRange, scale: scale)
                    }
                }
                .padding()
            }
            .gesture(
                MagnificationGesture()
                    .onChanged { scale = max(0.5, min(3.0, $0)) }
            )
        }
    }
}

private struct TimelineHeader: View {
    let dateRange: (start: Date, end: Date)
    let scale: CGFloat

    var body: some View {
        let totalDays = max(1, Calendar.current.dateComponents([.day], from: dateRange.start, to: dateRange.end).day ?? 30)
        let dayWidth = 30.0 * scale

        HStack(spacing: 0) {
            ForEach(0..<totalDays, id: \.self) { day in
                let date = Calendar.current.date(byAdding: .day, value: day, to: dateRange.start)!
                VStack(spacing: 2) {
                    if day % 7 == 0 {
                        Text(date, format: .dateTime.month(.abbreviated).day())
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("")
                            .font(.caption2)
                    }
                    Rectangle()
                        .fill(.secondary.opacity(day % 7 == 0 ? 0.3 : 0.1))
                        .frame(width: dayWidth, height: 1)
                }
            }
        }
        .frame(height: 20)
    }
}

private struct TaskTimelineRow: View {
    let node: PlanNode
    let dateRange: (start: Date, end: Date)
    let scale: CGFloat

    var body: some View {
        let totalDays = max(1, Calendar.current.dateComponents([.day], from: dateRange.start, to: dateRange.end).day ?? 30)
        let dayWidth = 30.0 * scale
        let totalWidth = Double(totalDays) * dayWidth

        let startOffset = dayOffset(node.startDate, from: dateRange.start) * dayWidth
        let endOffset = dayOffset(node.endDate ?? node.startDate, from: dateRange.start) * dayWidth + dayWidth

        ZStack(alignment: .leading) {
            Rectangle()
                .fill(.clear)
                .frame(width: totalWidth, height: 28)

            RoundedRectangle(cornerRadius: 4)
                .fill(statusColor(node.status).opacity(0.3))
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(statusColor(node.status), lineWidth: 1)
                )
                .frame(width: max(dayWidth, endOffset - startOffset), height: 24)
                .offset(x: startOffset)
                .overlay(alignment: .leading) {
                    Text(node.title)
                        .font(.caption2)
                        .lineLimit(1)
                        .padding(.horizontal, 4)
                        .offset(x: startOffset + 2)
                }
        }
    }

    private func dayOffset(_ dateStr: String?, from start: Date) -> Double {
        guard let str = dateStr, let date = DateFormatter.dateOnly.date(from: str) else { return 0 }
        return Double(Calendar.current.dateComponents([.day], from: start, to: date).day ?? 0)
    }

    private func statusColor(_ status: PlanNode.NodeStatus) -> Color {
        switch status {
        case .completed, .autoVerified: return .green
        case .inProgress, .dispatched: return .blue
        case .awaitingJudgment: return .orange
        case .pruned: return .red
        case .planned: return .gray
        }
    }
}

private struct MilestoneRow: View {
    let node: PlanNode
    let dateRange: (start: Date, end: Date)
    let scale: CGFloat

    var body: some View {
        let totalDays = max(1, Calendar.current.dateComponents([.day], from: dateRange.start, to: dateRange.end).day ?? 30)
        let dayWidth = 30.0 * scale
        let totalWidth = Double(totalDays) * dayWidth
        let offset = dayOffset(node.endDate ?? node.startDate, from: dateRange.start) * dayWidth

        ZStack(alignment: .leading) {
            Rectangle()
                .fill(.clear)
                .frame(width: totalWidth, height: 20)

            Image(systemName: "diamond.fill")
                .font(.caption)
                .foregroundStyle(.purple)
                .offset(x: offset)

            Text(node.title)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.purple)
                .offset(x: offset + 16)
        }
    }

    private func dayOffset(_ dateStr: String?, from start: Date) -> Double {
        guard let str = dateStr, let date = DateFormatter.dateOnly.date(from: str) else { return 0 }
        return Double(Calendar.current.dateComponents([.day], from: start, to: date).day ?? 0)
    }
}
