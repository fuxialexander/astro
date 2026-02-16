import Foundation
import SwiftUI

/// An initiative groups related projects together
struct Initiative: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var description: String
    var projectIds: [String]
    var status: InitiativeStatus
    var icon: String
    var color: String
    var goal: String?
    var lead: String?
    var startDate: String?
    var targetDate: String?
    var createdAt: Date?
    var updatedAt: Date?

    init(
        id: String = UUID().uuidString,
        name: String,
        description: String = "",
        projectIds: [String] = [],
        status: InitiativeStatus = .active,
        icon: String = "🎯",
        color: String = "3B82F6",
        goal: String? = nil,
        lead: String? = nil,
        startDate: String? = nil,
        targetDate: String? = nil,
        createdAt: Date? = .now,
        updatedAt: Date? = .now
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.projectIds = projectIds
        self.status = status
        self.icon = icon
        self.color = color
        self.goal = goal
        self.lead = lead
        self.startDate = startDate
        self.targetDate = targetDate
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum InitiativeStatus: String, Codable, CaseIterable {
        case active
        case onHold = "on_hold"
        case completed
        case archived

        var displayName: String {
            switch self {
            case .active: return "Active"
            case .onHold: return "On Hold"
            case .completed: return "Completed"
            case .archived: return "Archived"
            }
        }

        var color: String {
            switch self {
            case .active: return "green"
            case .onHold: return "orange"
            case .completed: return "blue"
            case .archived: return "gray"
            }
        }
    }

    static func == (lhs: Initiative, rhs: Initiative) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
