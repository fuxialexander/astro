import Foundation
import AuthenticationServices

/// Manages WebAuthn passkey registration and login via ASAuthorizationController
@MainActor
final class PasskeyManager: NSObject {
    private var continuation: CheckedContinuation<ASAuthorization, Error>?
    private let relyingPartyIdentifier: String

    init(relyingPartyIdentifier: String = "localhost") {
        self.relyingPartyIdentifier = relyingPartyIdentifier
    }

    // MARK: - Register new passkey

    func register(email: String, name: String? = nil) async throws -> (userId: String, session: Any?) {
        // Step 1: Get registration options from server
        let options = try await getRegistrationOptions(email: email, name: name)

        // Step 2: Create passkey via ASAuthorizationController
        let credential = try await performRegistration(
            challenge: options.challenge,
            userId: options.userId,
            userName: email,
            displayName: name ?? email
        )

        // Step 3: Verify with server
        let result = try await verifyRegistration(email: email, name: name, credential: credential)
        return (userId: result.userId, session: result.session)
    }

    // MARK: - Login with existing passkey

    func login(email: String? = nil) async throws -> (userId: String, session: Any?) {
        // Step 1: Get login options
        let options = try await getLoginOptions(email: email)

        // Step 2: Authenticate via ASAuthorizationController
        let credential = try await performAuthentication(challenge: options.challenge)

        // Step 3: Verify with server
        let result = try await verifyLogin(credential: credential, challengeKey: options.challengeKey)
        return (userId: result.userId, session: result.session)
    }

    // MARK: - Server communication

    private func getRegistrationOptions(email: String, name: String?) async throws -> RegistrationOptions {
        let serverURL = SessionManager.shared.serverURL
        var request = URLRequest(url: URL(string: "\(serverURL)/api/auth/webauthn/register-options")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "email": email,
            "name": name as Any,
        ])
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder.nexus.decode(RegistrationOptions.self, from: data)
    }

    private func getLoginOptions(email: String?) async throws -> LoginOptions {
        let serverURL = SessionManager.shared.serverURL
        var request = URLRequest(url: URL(string: "\(serverURL)/api/auth/webauthn/login-options")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [:]
        if let email { body["email"] = email }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder.nexus.decode(LoginOptions.self, from: data)
    }

    private func verifyRegistration(email: String, name: String?, credential: ASAuthorizationPlatformPublicKeyCredentialRegistration) async throws -> AuthResult {
        let serverURL = SessionManager.shared.serverURL
        var request = URLRequest(url: URL(string: "\(serverURL)/api/auth/webauthn/register-verify")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let credentialData: [String: Any] = [
            "id": credential.credentialID.base64URLEncoded,
            "rawId": credential.credentialID.base64URLEncoded,
            "type": "public-key",
            "response": [
                "clientDataJSON": credential.rawClientDataJSON.base64URLEncoded,
                "attestationObject": credential.rawAttestationObject?.base64URLEncoded ?? "",
            ],
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "email": email,
            "name": name as Any,
            "credential": credentialData,
        ])

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder.nexus.decode(AuthResult.self, from: data)
    }

    private func verifyLogin(credential: ASAuthorizationPlatformPublicKeyCredentialAssertion, challengeKey: String) async throws -> AuthResult {
        let serverURL = SessionManager.shared.serverURL
        var request = URLRequest(url: URL(string: "\(serverURL)/api/auth/webauthn/login-verify")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let credentialData: [String: Any] = [
            "id": credential.credentialID.base64URLEncoded,
            "rawId": credential.credentialID.base64URLEncoded,
            "type": "public-key",
            "response": [
                "clientDataJSON": credential.rawClientDataJSON.base64URLEncoded,
                "authenticatorData": credential.rawAuthenticatorData.base64URLEncoded,
                "signature": credential.signature.base64URLEncoded,
                "userHandle": credential.userID.base64URLEncoded,
            ],
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "credential": credentialData,
            "challengeKey": challengeKey,
        ])

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder.nexus.decode(AuthResult.self, from: data)
    }

    // MARK: - ASAuthorizationController

    private func performRegistration(challenge: Data, userId: Data, userName: String, displayName: String) async throws -> ASAuthorizationPlatformPublicKeyCredentialRegistration {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingPartyIdentifier)
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: userName,
            userID: userId
        )

        let authorization = try await performAuthorization(requests: [request])
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration else {
            throw PasskeyError.invalidCredential
        }
        return credential
    }

    private func performAuthentication(challenge: Data) async throws -> ASAuthorizationPlatformPublicKeyCredentialAssertion {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingPartyIdentifier)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)

        let authorization = try await performAuthorization(requests: [request])
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw PasskeyError.invalidCredential
        }
        return credential
    }

    private func performAuthorization(requests: [ASAuthorizationRequest]) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: requests)
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }
}

// MARK: - ASAuthorizationControllerDelegate

extension PasskeyManager: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        continuation?.resume(returning: authorization)
        continuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}

// MARK: - ASAuthorizationControllerPresentationContextProviding

extension PasskeyManager: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // Get the key window
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.windows.first else {
            return UIWindow()
        }
        return window
    }
}

// MARK: - Types

private struct RegistrationOptions: Codable {
    var challenge: Data
    var userId: Data
    var options: AnyCodable?

    enum CodingKeys: String, CodingKey {
        case options, email, existingUser
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let opts = try container.decode(AnyCodable.self, forKey: .options)

        // Extract challenge and user.id from the options object
        if let dict = opts.dictValue,
           let challengeStr = dict["challenge"] as? String,
           let challengeData = Data(base64URLEncoded: challengeStr) {
            challenge = challengeData
        } else {
            challenge = Data()
        }

        if let dict = opts.dictValue,
           let user = dict["user"] as? [String: Any],
           let userIdStr = user["id"] as? String,
           let userIdData = Data(base64URLEncoded: userIdStr) {
            userId = userIdData
        } else {
            userId = Data()
        }

        options = opts
    }

    func encode(to encoder: Encoder) throws {}
}

private struct LoginOptions: Codable {
    var challenge: Data
    var challengeKey: String

    enum CodingKeys: String, CodingKey {
        case options, challengeKey
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        challengeKey = try container.decode(String.self, forKey: .challengeKey)
        let opts = try container.decode(AnyCodable.self, forKey: .options)

        if let dict = opts.dictValue,
           let challengeStr = dict["challenge"] as? String,
           let challengeData = Data(base64URLEncoded: challengeStr) {
            challenge = challengeData
        } else {
            challenge = Data()
        }
    }

    func encode(to encoder: Encoder) throws {}
}

private struct AuthResult: Codable {
    var verified: Bool
    var userId: String
    var session: AnyCodable?
}

enum PasskeyError: LocalizedError {
    case invalidCredential
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .invalidCredential: return "Invalid credential response"
        case .serverError(let msg): return msg
        }
    }
}

// MARK: - Base64URL helpers

extension Data {
    var base64URLEncoded: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URLEncoded string: String) {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }
        self.init(base64Encoded: base64)
    }
}
