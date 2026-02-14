import Foundation
import Observation

@Observable
@MainActor
final class RealtimeStore {
    var connectedMachines: [MachineInfo] = []
    var recentEvents: [ActivityEvent] = []
    var isConnected = false

    private var sseClient: SSEClient?
    private let maxRecentEvents = 100

    // MARK: - Connection

    func connect() {
        let urlStr = SessionManager.shared.serverURL + "/api/events/stream"
        guard let url = URL(string: urlStr) else { return }

        var headers: [String: String] = [
            "Accept": "text/event-stream",
        ]
        if let token = SessionManager.shared.accessToken {
            headers["Authorization"] = "Bearer \(token)"
        }

        sseClient?.disconnect()
        sseClient = SSEClient(url: url, headers: headers)

        sseClient?.connect(
            onEvent: { [weak self] message in
                Task { @MainActor in
                    self?.handleSSEMessage(message)
                }
            },
            onError: { [weak self] _ in
                Task { @MainActor in
                    self?.isConnected = false
                    // Auto-reconnect after delay
                    try? await Task.sleep(for: .seconds(5))
                    self?.connect()
                }
            },
            onOpen: { [weak self] in
                Task { @MainActor in
                    self?.isConnected = true
                }
            }
        )
    }

    func disconnect() {
        sseClient?.disconnect()
        sseClient = nil
        isConnected = false
    }

    // MARK: - Event handling

    private func handleSSEMessage(_ message: SSEParser.Message) {
        let eventName = message.event ?? "message"

        // Parse machines snapshot
        if eventName == "machines:snapshot" {
            if let data = message.data.data(using: .utf8),
               let machines = try? JSONDecoder.nexus.decode([MachineInfo].self, from: data) {
                connectedMachines = machines
            }
            return
        }

        guard let type = SSEEventType(rawValue: eventName) else { return }

        var eventData: [String: AnyCodable] = [:]
        if let jsonData = message.data.data(using: .utf8),
           let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {
            eventData = dict.mapValues { AnyCodable($0) }
        }

        let event = ActivityEvent(
            id: message.id ?? UUID().uuidString,
            type: type,
            data: eventData
        )

        // Handle machine events
        switch type {
        case .machineConnected:
            if let data = message.data.data(using: .utf8),
               let machine = try? JSONDecoder.nexus.decode(MachineInfo.self, from: data) {
                if let idx = connectedMachines.firstIndex(where: { $0.machineId == machine.machineId }) {
                    connectedMachines[idx] = machine
                } else {
                    connectedMachines.append(machine)
                }
            }

        case .machineDisconnected:
            if let machineId = event.machineId {
                connectedMachines.removeAll { $0.machineId == machineId }
            }

        default:
            break
        }

        // Add to recent events
        recentEvents.insert(event, at: 0)
        if recentEvents.count > maxRecentEvents {
            recentEvents = Array(recentEvents.prefix(maxRecentEvents))
        }
    }

    // MARK: - Queries

    func machine(id: String) -> MachineInfo? {
        connectedMachines.first { $0.machineId == id }
    }

    var totalActiveTasks: Int {
        connectedMachines.compactMap { $0.load?.activeTasks }.reduce(0, +)
    }

    var taskEvents: [ActivityEvent] {
        recentEvents.filter {
            switch $0.type {
            case .taskStdout, .taskText, .taskProgress, .taskResult, .taskToolTrace, .taskFileChange:
                return true
            default:
                return false
            }
        }
    }
}
