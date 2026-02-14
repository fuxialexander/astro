import SwiftUI

struct ContextBadge: View {
    let scope: NavigationContext.ChatScope
    let projectName: String?
    let taskTitle: String?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: iconName)
                .font(.caption2)
            Text(label)
                .font(.caption)
                .fontWeight(.medium)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(.fill.tertiary, in: Capsule())
    }

    private var iconName: String {
        switch scope {
        case .general: return "sparkles"
        case .project: return "folder"
        case .task: return "checkmark.circle"
        }
    }

    private var label: String {
        switch scope {
        case .general:
            return "General"
        case .project:
            if let name = projectName {
                return "Project: \(name)"
            }
            return "Project"
        case .task:
            if let title = taskTitle {
                return "Task: \(title)"
            }
            return "Task"
        }
    }
}
