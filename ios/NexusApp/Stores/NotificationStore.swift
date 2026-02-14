import Foundation
import Observation
import UserNotifications

@Observable
@MainActor
final class NotificationStore {
    var isEnabled = false
    var deviceToken: String?
    var preferences = NotificationPreferences()

    struct NotificationPreferences: Codable {
        var judgmentRequired = true
        var taskFailed = true
        var taskCompleted = false
        var machineDisconnected = true
        var branchUnblocked = false
    }

    func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            isEnabled = granted
            return granted
        } catch {
            return false
        }
    }

    func setDeviceToken(_ token: Data) {
        deviceToken = token.map { String(format: "%02.2hhx", $0) }.joined()
    }

    func registerWithServer() async {
        guard let token = deviceToken else { return }
        // POST /api/notifications/register
        let url = URL(string: SessionManager.shared.serverURL + "/api/notifications/register")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let authToken = SessionManager.shared.accessToken {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }

        let body: [String: Any] = [
            "deviceToken": token,
            "userId": SessionManager.shared.userId ?? "",
            "preferences": [
                "judgmentRequired": preferences.judgmentRequired,
                "taskFailed": preferences.taskFailed,
                "taskCompleted": preferences.taskCompleted,
                "machineDisconnected": preferences.machineDisconnected,
                "branchUnblocked": preferences.branchUnblocked,
            ],
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: request)
    }
}
