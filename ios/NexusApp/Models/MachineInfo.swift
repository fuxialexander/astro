import Foundation

struct MachineInfo: Codable, Identifiable, Hashable {
    var id: String { machineId }
    let machineId: String
    var name: String
    var environmentType: TaskEnvironment
    var connectionStatus: ConnectionStatus
    var providers: [MachineProvider]?
    var resources: MachineResources?
    var load: MachineLoad?
    var connectedAt: String?
    var lastHeartbeat: String?
    var tags: [String]?

    enum ConnectionStatus: String, Codable {
        case connected, disconnected
    }

    static func == (lhs: MachineInfo, rhs: MachineInfo) -> Bool { lhs.machineId == rhs.machineId }
    func hash(into hasher: inout Hasher) { hasher.combine(machineId) }
}

struct MachineProvider: Codable, Hashable {
    var type: String
    var status: String
    var currentTasks: Int?
    var maxConcurrentTasks: Int?
}

struct MachineResources: Codable, Hashable {
    var cpu: Int?
    var memory: Int?
}

struct MachineLoad: Codable, Hashable {
    var cpuPercent: Double?
    var memoryPercent: Double?
    var activeTasks: Int?
}

/// Registered machine from device auth (may be offline)
struct RegisteredMachine: Codable, Identifiable {
    let id: String
    var name: String
    var hostname: String
    var platform: String
    var environmentType: String
    var providers: [String]?
    var registeredAt: String?
    var lastSeenAt: String?
    var isConnected: Bool?
    var isRevoked: Bool?
}
