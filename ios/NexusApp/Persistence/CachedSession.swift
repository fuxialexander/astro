import Foundation
import SwiftData

@Model
final class CachedSession {
    @Attribute(.unique) var id: String
    var data: Data           // Encoded ChatSessionData JSON
    var type: String         // SessionType.rawValue for queries
    var projectId: String
    var nodeId: String?
    var updatedAt: Date

    init(id: String, data: Data, type: String, projectId: String, nodeId: String? = nil, updatedAt: Date = .now) {
        self.id = id
        self.data = data
        self.type = type
        self.projectId = projectId
        self.nodeId = nodeId
        self.updatedAt = updatedAt
    }
}
