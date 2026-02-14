import SwiftUI

@Observable
@MainActor
final class NavigationContext {
    var currentProjectId: String?
    var currentNodeId: String?
    var currentTabName: String = "Dashboard"

    enum ChatScope: Equatable {
        case general
        case project(id: String)
        case task(nodeId: String, projectId: String)
    }

    var chatScope: ChatScope {
        if let nodeId = currentNodeId, let projectId = currentProjectId {
            return .task(nodeId: nodeId, projectId: projectId)
        } else if let projectId = currentProjectId {
            return .project(id: projectId)
        } else {
            return .general
        }
    }

    var scopeLabel: String {
        switch chatScope {
        case .general:
            return currentTabName
        case .project:
            return "Project"
        case .task:
            return "Task"
        }
    }
}
