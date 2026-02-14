import SwiftUI

struct AuthGateView: View {
    @Environment(SessionManager.self) private var session
    @State private var email = ""
    @State private var name = ""
    @State private var isRegistering = false
    @State private var isLoading = false
    @State private var error: String?
    @State private var serverURL: String = ""

    private let passkeyManager = PasskeyManager()

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Logo area
            VStack(spacing: 12) {
                Image(systemName: "hexagon.fill")
                    .font(.system(size: 60))
                    .foregroundStyle(.blue)

                Text("Nexus")
                    .font(.largeTitle.bold())

                Text("AI-Assisted Planning Platform")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Auth form
            VStack(spacing: 16) {
                if isRegistering {
                    TextField("Name", text: $name)
                        .textFieldStyle(.roundedBorder)
                        .textContentType(.name)
                }

                TextField("Email", text: $email)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocapitalization(.none)

                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                Button(action: authenticate) {
                    HStack {
                        if isLoading {
                            ProgressView()
                                .tint(.white)
                        }
                        Image(systemName: "faceid")
                        Text(isRegistering ? "Create Account" : "Sign In")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .disabled(email.isEmpty || isLoading)

                Button(isRegistering ? "Already have an account? Sign in" : "New user? Create account") {
                    withAnimation {
                        isRegistering.toggle()
                        error = nil
                    }
                }
                .font(.footnote)
                .foregroundStyle(.blue)

                Divider()
                    .padding(.vertical, 4)

                Button("Continue without sign in") {
                    session.setTokens(
                        access: "",
                        refresh: "",
                        userId: "dev-user",
                        email: email.isEmpty ? "dev@localhost" : email
                    )
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 32)

            Spacer()

            // Server URL config
            VStack(spacing: 8) {
                Divider()
                HStack {
                    Image(systemName: "server.rack")
                        .foregroundStyle(.secondary)
                    TextField("Server URL", text: $serverURL)
                        .textFieldStyle(.roundedBorder)
                        .font(.caption)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                        .onSubmit {
                            session.updateServerURL(serverURL)
                        }
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 16)
            }
        }
        .onAppear {
            serverURL = session.serverURL
        }
    }

    private func authenticate() {
        guard !email.isEmpty else { return }
        isLoading = true
        error = nil

        Task {
            do {
                if isRegistering {
                    let result = try await passkeyManager.register(email: email, name: name.isEmpty ? nil : name)
                    session.setTokens(access: "", refresh: "", userId: result.userId, email: email)
                } else {
                    let result = try await passkeyManager.login(email: email)
                    session.setTokens(access: "", refresh: "", userId: result.userId, email: email)
                }
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}
