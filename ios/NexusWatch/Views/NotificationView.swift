import SwiftUI
import UserNotifications

/// Handles deep-link routing from push notifications on watchOS
struct NotificationView: View {
    let notificationType: NotificationType
    let payload: NotificationPayload

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                // Header
                HStack(spacing: 8) {
                    Image(systemName: notificationType.icon)
                        .font(.title3)
                        .foregroundStyle(notificationType.color)
                    Text(notificationType.title)
                        .font(.headline)
                }

                Divider()

                // Task/project info
                if let taskTitle = payload.taskTitle {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Task")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(taskTitle)
                            .font(.caption.bold())
                    }
                }

                if let projectName = payload.projectName {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Project")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(projectName)
                            .font(.caption)
                    }
                }

                if let message = payload.message {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Details")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Notification")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Notification types

enum NotificationType: String {
    case judgment = "awaiting_judgment"
    case taskCompleted = "task_completed"
    case taskFailed = "task_failed"
    case machineDisconnected = "machine_disconnected"
    case branchUnblocked = "branch_unblocked"

    var title: String {
        switch self {
        case .judgment: return "Decision Needed"
        case .taskCompleted: return "Task Completed"
        case .taskFailed: return "Task Failed"
        case .machineDisconnected: return "Machine Offline"
        case .branchUnblocked: return "Branch Ready"
        }
    }

    var icon: String {
        switch self {
        case .judgment: return "exclamationmark.triangle.fill"
        case .taskCompleted: return "checkmark.seal.fill"
        case .taskFailed: return "xmark.circle.fill"
        case .machineDisconnected: return "desktopcomputer.trianglebadge.exclamationmark"
        case .branchUnblocked: return "arrow.triangle.branch"
        }
    }

    var color: Color {
        switch self {
        case .judgment: return .orange
        case .taskCompleted: return .green
        case .taskFailed: return .red
        case .machineDisconnected: return .yellow
        case .branchUnblocked: return .blue
        }
    }
}

struct NotificationPayload {
    var taskId: String?
    var projectId: String?
    var taskTitle: String?
    var projectName: String?
    var message: String?

    init(from userInfo: [AnyHashable: Any]) {
        taskId = userInfo["taskId"] as? String
        projectId = userInfo["projectId"] as? String
        taskTitle = userInfo["taskTitle"] as? String
        projectName = userInfo["projectName"] as? String
        message = userInfo["message"] as? String
    }
}

// MARK: - Watch notification delegate

final class WatchNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = WatchNotificationDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show notifications even when app is foreground on watch
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        // Post notification for the app to handle deep linking
        NotificationCenter.default.post(
            name: .watchDeepLink,
            object: nil,
            userInfo: userInfo as? [String: Any]
        )
        completionHandler()
    }
}

extension Notification.Name {
    static let watchDeepLink = Notification.Name("watchDeepLink")
}
