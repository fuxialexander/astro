import Foundation
import UserNotifications
import UIKit

/// Handles incoming push notifications and routes deep links
final class NotificationHandler: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationHandler()

    // Called when notification is tapped
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo

        // Parse deep link from notification payload
        if let deepLink = userInfo["deepLink"] as? String {
            handleDeepLink(deepLink)
        } else if let type = userInfo["type"] as? String {
            switch type {
            case "awaiting_judgment":
                if let nodeId = userInfo["nodeId"] as? String,
                   let projectId = userInfo["projectId"] as? String {
                    navigateToTask(nodeId: nodeId, projectId: projectId)
                }
            case "task_result":
                if let nodeId = userInfo["nodeId"] as? String,
                   let projectId = userInfo["projectId"] as? String {
                    navigateToTask(nodeId: nodeId, projectId: projectId)
                }
            case "machine_disconnected":
                navigateToEnvironments()
            default:
                break
            }
        }

        completionHandler()
    }

    // Called when notification arrives while app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show banner even when app is in foreground
        completionHandler([.banner, .sound, .badge])
    }

    // MARK: - Deep link routing

    private func handleDeepLink(_ link: String) {
        guard let url = URL(string: link) else { return }
        let components = url.pathComponents

        // /project/:id/task/:nodeId
        if components.count >= 4, components[1] == "project", components[3] == "task" {
            let projectId = components[2]
            let nodeId = components[4]
            navigateToTask(nodeId: nodeId, projectId: projectId)
        }
        // /project/:id
        else if components.count >= 2, components[1] == "project" {
            let projectId = components[2]
            navigateToProject(projectId: projectId)
        }
        // /environments
        else if components.contains("environments") {
            navigateToEnvironments()
        }
    }

    private func navigateToTask(nodeId: String, projectId: String) {
        // Post notification for app to handle navigation
        NotificationCenter.default.post(
            name: .navigateToTask,
            object: nil,
            userInfo: ["nodeId": nodeId, "projectId": projectId]
        )
    }

    private func navigateToProject(projectId: String) {
        NotificationCenter.default.post(
            name: .navigateToProject,
            object: nil,
            userInfo: ["projectId": projectId]
        )
    }

    private func navigateToEnvironments() {
        NotificationCenter.default.post(
            name: .navigateToEnvironments,
            object: nil
        )
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let navigateToTask = Notification.Name("com.nexus.navigateToTask")
    static let navigateToProject = Notification.Name("com.nexus.navigateToProject")
    static let navigateToEnvironments = Notification.Name("com.nexus.navigateToEnvironments")
}
