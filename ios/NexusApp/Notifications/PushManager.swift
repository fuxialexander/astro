import Foundation
import UIKit
import UserNotifications

/// Manages APNs registration and token upload
final class PushManager: NSObject {
    static let shared = PushManager()

    func registerForPush() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    func handleDeviceToken(_ deviceToken: Data) {
        Task { @MainActor in
            NotificationStore().setDeviceToken(deviceToken)
            await NotificationStore().registerWithServer()
        }
    }
}
