import SwiftUI

/// Flow to generate a device code for machine registration
struct AddMachineView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var step: Step = .selectType
    @State private var machineType: TaskEnvironment = .local
    @State private var deviceCode: String?
    @State private var userCode: String?
    @State private var verificationUrl: String?
    @State private var isLoading = false
    @State private var error: String?

    enum Step {
        case selectType
        case showCode
    }

    var body: some View {
        VStack(spacing: 24) {
            switch step {
            case .selectType:
                selectTypeView

            case .showCode:
                showCodeView
            }
        }
        .padding()
        .navigationTitle("Add Machine")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
        }
    }

    private var selectTypeView: some View {
        VStack(spacing: 24) {
            Text("Select Machine Type")
                .font(.headline)

            VStack(spacing: 12) {
                ForEach(TaskEnvironment.allCases, id: \.self) { env in
                    Button {
                        machineType = env
                    } label: {
                        HStack {
                            Image(systemName: envIcon(env))
                                .frame(width: 30)
                            Text(env.rawValue.capitalized)
                                .font(.body)
                            Spacer()
                            if machineType == env {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.blue)
                            }
                        }
                        .padding()
                        .background(
                            machineType == env ? Color.blue.opacity(0.1) : Color(.systemGroupedBackground),
                            in: RoundedRectangle(cornerRadius: 10)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            Button("Generate Device Code") {
                generateCode()
            }
            .buttonStyle(.borderedProminent)
            .disabled(isLoading)

            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Spacer()
        }
    }

    private var showCodeView: some View {
        VStack(spacing: 24) {
            Image(systemName: "qrcode")
                .font(.system(size: 40))
                .foregroundStyle(.blue)

            Text("Enter this code on your machine")
                .font(.headline)

            if let code = userCode {
                Text(code)
                    .font(.system(.largeTitle, design: .monospaced).bold())
                    .padding()
                    .background(.blue.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                    .textSelection(.enabled)
            }

            if let url = verificationUrl {
                VStack(spacing: 4) {
                    Text("Or visit:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(url)
                        .font(.caption)
                        .foregroundStyle(.blue)
                        .textSelection(.enabled)
                }
            }

            Text("Run `nexus-agent auth` on your machine and enter this code when prompted.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Spacer()

            Button("Done") { dismiss() }
                .buttonStyle(.bordered)
        }
    }

    private func generateCode() {
        isLoading = true
        error = nil

        Task {
            do {
                let serverURL = SessionManager.shared.serverURL
                var request = URLRequest(url: URL(string: "\(serverURL)/api/device/authorize")!)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: [
                    "machineInfo": [
                        "hostname": "new-machine",
                        "platform": "unknown",
                        "environmentType": machineType.rawValue,
                        "providers": [["type": "claude-code"]],
                    ],
                ])

                let (data, _) = try await URLSession.shared.data(for: request)
                let result = try JSONDecoder.nexus.decode(DeviceAuthResponse.self, from: data)

                deviceCode = result.deviceCode
                userCode = result.userCode
                verificationUrl = result.verificationUriComplete

                step = .showCode
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func envIcon(_ env: TaskEnvironment) -> String {
        switch env {
        case .local: return "laptopcomputer"
        case .remote: return "server.rack"
        case .hpc: return "cpu"
        case .cloud: return "cloud"
        }
    }
}

private struct DeviceAuthResponse: Codable {
    var deviceCode: String
    var userCode: String
    var verificationUri: String?
    var verificationUriComplete: String?
    var expiresIn: Int
    var interval: Int
}
