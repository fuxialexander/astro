import Foundation

struct Project: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var description: String
    var visionDoc: String
    var status: ProjectStatus
    var startDate: String?
    var targetDate: String?
    var lead: String?
    var health: ProjectHealth?
    var initiativeId: String?
    var progress: Int?
    var labels: [ProjectLabel]?
    var color: String
    var icon: String
    var workingDirectory: String?
    var repository: String?
    var defaultEnvironment: TaskEnvironment?
    var defaultMachineId: String?
    var createdAt: Date
    var updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, name, description, visionDoc, status
        case startDate, targetDate, lead, health
        case initiativeId, progress, labels, color, icon
        case workingDirectory, repository
        case defaultEnvironment, defaultMachineId
        case createdAt, updatedAt
    }

    enum ProjectStatus: String, Codable, CaseIterable {
        case active, archived
    }

    enum ProjectHealth: String, Codable, CaseIterable {
        case onTrack = "on_track"
        case atRisk = "at_risk"
        case offTrack = "off_track"
    }

    static func == (lhs: Project, rhs: Project) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct ProjectLabel: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var color: String
}

enum TaskEnvironment: String, Codable, CaseIterable {
    case local, remote, hpc, cloud
}

enum Priority: String, Codable, CaseIterable {
    case urgent, high, medium, low, none

    var displayName: String { rawValue.capitalized }

    var color: String {
        switch self {
        case .urgent: return "red"
        case .high: return "orange"
        case .medium: return "yellow"
        case .low: return "blue"
        case .none: return "gray"
        }
    }

    var sortOrder: Int {
        switch self {
        case .urgent: return 0
        case .high: return 1
        case .medium: return 2
        case .low: return 3
        case .none: return 4
        }
    }
}

enum Estimate: String, Codable, CaseIterable {
    case xs = "XS"
    case s = "S"
    case m = "M"
    case l = "L"
    case xl = "XL"
}
