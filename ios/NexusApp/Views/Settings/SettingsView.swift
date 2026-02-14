import SwiftUI

struct SettingsView: View {
    @Environment(SessionManager.self) private var session
    @Environment(NotificationStore.self) private var notificationStore

    @State private var serverURL = ""
    @State private var healthStatus: String?
    @State private var isCheckingHealth = false
    @State private var selectedModel = "claude-sonnet-4-5-20250929"
    @State private var defaultProvider = ""
    @State private var providers: [ProviderInfo] = []
    @State private var showLogoutConfirm = false

    private let models = [
        "claude-opus-4-6",
        "claude-sonnet-4-5-20250929",
        "claude-haiku-4-5-20251001",
    ]

    var body: some View {
        Form {
            // Account
            Section("Account") {
                HStack {
                    Image(systemName: "person.circle")
                        .font(.title2)
                        .foregroundStyle(.blue)
                    VStack(alignment: .leading) {
                        Text(session.userEmail ?? "Unknown")
                            .font(.subheadline)
                        if let userId = session.userId {
                            Text(userId)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }

                Button("Sign Out", role: .destructive) {
                    showLogoutConfirm = true
                }
            }

            // Server
            Section("Server") {
                HStack {
                    TextField("Server URL", text: $serverURL)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                    Button("Save") {
                        session.updateServerURL(serverURL)
                    }
                    .font(.caption)
                }

                HStack {
                    Text("Health")
                    Spacer()
                    if isCheckingHealth {
                        ProgressView()
                    } else if let status = healthStatus {
                        Text(status)
                            .font(.caption)
                            .foregroundStyle(status == "ok" ? .green : .red)
                    }
                    Button("Check") {
                        checkHealth()
                    }
                    .font(.caption)
                }
            }

            // Model & Provider
            Section("AI Model") {
                Picker("Model", selection: $selectedModel) {
                    ForEach(models, id: \.self) { model in
                        Text(modelDisplayName(model)).tag(model)
                    }
                }
                .onChange(of: selectedModel) { _, newValue in
                    saveModel(newValue)
                }

                if !providers.isEmpty {
                    Picker("Provider", selection: $defaultProvider) {
                        Text("Auto").tag("")
                        ForEach(providers) { provider in
                            HStack {
                                Circle()
                                    .fill(provider.available ? .green : .red)
                                    .frame(width: 6, height: 6)
                                Text(provider.name)
                            }.tag(provider.id)
                        }
                    }
                    .onChange(of: defaultProvider) { _, newValue in
                        UserDefaults.standard.set(newValue, forKey: "nexus-defaultProvider")
                    }
                }
            }

            // Notifications
            Section("Notifications") {
                Toggle("Push Notifications", isOn: Binding(
                    get: { notificationStore.isEnabled },
                    set: { enabled in
                        if enabled {
                            Task {
                                _ = await notificationStore.requestPermission()
                            }
                        }
                    }
                ))

                if notificationStore.isEnabled {
                    Toggle("Decisions Required", isOn: bindPref(\.judgmentRequired))
                    Toggle("Task Failed", isOn: bindPref(\.taskFailed))
                    Toggle("Task Completed", isOn: bindPref(\.taskCompleted))
                    Toggle("Machine Disconnected", isOn: bindPref(\.machineDisconnected))
                    Toggle("Branch Unblocked", isOn: bindPref(\.branchUnblocked))
                }
            }

            // App Info
            Section("About") {
                HStack {
                    Text("Version")
                    Spacer()
                    Text("1.0.0")
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Text("Build")
                    Spacer()
                    Text("1")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            serverURL = session.serverURL
        }
        .task {
            await loadProviders()
            await loadSettings()
        }
        .alert("Sign Out", isPresented: $showLogoutConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Sign Out", role: .destructive) {
                session.clearSession()
            }
        } message: {
            Text("Are you sure you want to sign out?")
        }
    }

    private func checkHealth() {
        isCheckingHealth = true
        Task {
            do {
                let response = try await NexusAPI.shared.checkHealth()
                healthStatus = response.status ?? "ok"
            } catch {
                healthStatus = "error"
            }
            isCheckingHealth = false
        }
    }

    private func loadProviders() async {
        do {
            let response = try await NexusAPI.shared.getProviders()
            providers = response.providers
        } catch {}
    }

    private func saveModel(_ model: String) {
        Task {
            try? await NexusAPI.shared.patchSettings(["selectedModel": model])
        }
    }

    private func loadSettings() async {
        do {
            let settings = try await NexusAPI.shared.getSettings()
            if let model = settings["selectedModel"] {
                selectedModel = model
            }
        } catch {}
        // defaultProvider is stored locally (matches web app's IndexedDB pattern)
        defaultProvider = UserDefaults.standard.string(forKey: "nexus-defaultProvider") ?? ""
    }

    private func modelDisplayName(_ model: String) -> String {
        if model.contains("opus") { return "Claude Opus 4.6" }
        if model.contains("sonnet") { return "Claude Sonnet 4.5" }
        if model.contains("haiku") { return "Claude Haiku 4.5" }
        return model
    }

    private func bindPref(_ keyPath: WritableKeyPath<NotificationStore.NotificationPreferences, Bool>) -> Binding<Bool> {
        Binding(
            get: { notificationStore.preferences[keyPath: keyPath] },
            set: { notificationStore.preferences[keyPath: keyPath] = $0 }
        )
    }
}
