import Foundation
import Security
import Observation

/// Manages user session: token storage in Keychain, auto-refresh, server URL
@Observable
@MainActor
final class SessionManager {
    static let shared = SessionManager()

    var isAuthenticated = false
    var serverURL: String = "https://nexus-api.fuxialexander.work"
    var userId: String?
    var userEmail: String?

    // Token storage (Keychain-backed)
    private(set) var accessToken: String?
    private(set) var refreshToken: String?

    private let keychainService = "com.nexus.app"
    private var refreshTask: Task<Void, Never>?

    private init() {
        // Load server URL from UserDefaults
        if let saved = UserDefaults.standard.string(forKey: "nexus.serverURL"), !saved.isEmpty {
            serverURL = saved
        }
    }

    // MARK: - Session lifecycle

    func restoreSession() async {
        // Load tokens from Keychain
        accessToken = loadKeychain(key: "accessToken")
        refreshToken = loadKeychain(key: "refreshToken")
        userId = UserDefaults.standard.string(forKey: "nexus.userId")
        userEmail = UserDefaults.standard.string(forKey: "nexus.userEmail")

        if accessToken != nil {
            // Verify session is still valid
            do {
                let response: SessionResponse = try await checkSession()
                if response.authenticated {
                    isAuthenticated = true
                    startAutoRefresh()
                } else {
                    // Try refresh
                    try await refreshTokens()
                    isAuthenticated = true
                    startAutoRefresh()
                }
            } catch {
                // If both fail, clear session
                clearSession()
            }
        }
    }

    func setTokens(access: String, refresh: String, userId: String?, email: String?) {
        accessToken = access
        refreshToken = refresh
        self.userId = userId
        self.userEmail = email

        saveKeychain(key: "accessToken", value: access)
        saveKeychain(key: "refreshToken", value: refresh)
        if let userId { UserDefaults.standard.set(userId, forKey: "nexus.userId") }
        if let email { UserDefaults.standard.set(email, forKey: "nexus.userEmail") }

        isAuthenticated = true
        startAutoRefresh()
    }

    func clearSession() {
        accessToken = nil
        refreshToken = nil
        userId = nil
        userEmail = nil
        isAuthenticated = false

        deleteKeychain(key: "accessToken")
        deleteKeychain(key: "refreshToken")
        UserDefaults.standard.removeObject(forKey: "nexus.userId")
        UserDefaults.standard.removeObject(forKey: "nexus.userEmail")

        refreshTask?.cancel()
        refreshTask = nil
    }

    func updateServerURL(_ url: String) {
        serverURL = url
        UserDefaults.standard.set(url, forKey: "nexus.serverURL")
    }

    // MARK: - Token refresh

    func refreshTokens() async throws {
        guard let refresh = refreshToken else { throw NexusError.unauthorized }

        var request = URLRequest(url: URL(string: serverURL)!.appendingPathComponent("/api/device/refresh"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "grantType": "refresh_token",
            "refreshToken": refresh,
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw NexusError.unauthorized
        }

        let result = try JSONDecoder.nexus.decode(TokenResponse.self, from: data)
        accessToken = result.accessToken
        if let newRefresh = result.refreshToken {
            refreshToken = newRefresh
            saveKeychain(key: "refreshToken", value: newRefresh)
        }
        saveKeychain(key: "accessToken", value: result.accessToken)
    }

    private func startAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = Task {
            // Refresh every 50 minutes (tokens expire in 60)
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(50 * 60))
                guard !Task.isCancelled else { break }
                try? await refreshTokens()
            }
        }
    }

    // MARK: - Session check

    private func checkSession() async throws -> SessionResponse {
        var request = URLRequest(url: URL(string: serverURL)!.appendingPathComponent("/api/auth/session"))
        request.httpMethod = "GET"
        if let token = accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder.nexus.decode(SessionResponse.self, from: data)
    }

    // MARK: - Keychain helpers

    private func saveKeychain(key: String, value: String) {
        let data = value.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)

        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(addQuery as CFDictionary, nil)
    }

    private func loadKeychain(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func deleteKeychain(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

// MARK: - Response types

private struct SessionResponse: Codable {
    var authenticated: Bool
    var user: SessionUser?
    var mode: String?

    struct SessionUser: Codable {
        var id: String?
        var email: String?
    }
}

private struct TokenResponse: Codable {
    var accessToken: String
    var tokenType: String?
    var expiresIn: Int?
    var refreshToken: String?
}
