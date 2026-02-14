import Foundation
import SwiftData

// MARK: - SwiftData Models for offline caching

@Model
final class CachedProject {
    @Attribute(.unique) var id: String
    var data: Data // Encoded Project JSON
    var updatedAt: Date

    init(id: String, data: Data, updatedAt: Date = .now) {
        self.id = id
        self.data = data
        self.updatedAt = updatedAt
    }
}

@Model
final class CachedPlanData {
    @Attribute(.unique) var projectId: String
    var nodesData: Data // Encoded [PlanNode] JSON
    var edgesData: Data // Encoded [PlanEdge] JSON
    var updatedAt: Date

    init(projectId: String, nodesData: Data, edgesData: Data, updatedAt: Date = .now) {
        self.projectId = projectId
        self.nodesData = nodesData
        self.edgesData = edgesData
        self.updatedAt = updatedAt
    }
}

// MARK: - Local Cache Manager

@MainActor
final class LocalCache {
    static let shared = LocalCache()

    private var container: ModelContainer?

    private func getContainer() throws -> ModelContainer {
        if let container { return container }
        let schema = Schema([CachedProject.self, CachedPlanData.self, CachedSession.self])
        let config = ModelConfiguration(isStoredInMemoryOnly: false)
        let c = try ModelContainer(for: schema, configurations: config)
        container = c
        return c
    }

    // MARK: - Projects

    func cacheProjects(_ projects: [Project]) async {
        guard let container = try? getContainer() else { return }
        let context = container.mainContext
        let encoder = JSONEncoder.nexus

        for project in projects {
            if let data = try? encoder.encode(project) {
                let cached = CachedProject(id: project.id, data: data)
                context.insert(cached)
            }
        }
        try? context.save()
    }

    func loadCachedProjects() async -> [Project]? {
        guard let container = try? getContainer() else { return nil }
        let context = container.mainContext
        let descriptor = FetchDescriptor<CachedProject>()
        let decoder = JSONDecoder.nexus

        guard let cached = try? context.fetch(descriptor) else { return nil }
        return cached.compactMap { try? decoder.decode(Project.self, from: $0.data) }
    }

    // MARK: - Plans

    func cachePlan(projectId: String, nodes: [PlanNode], edges: [PlanEdge]) async {
        guard let container = try? getContainer() else { return }
        let context = container.mainContext
        let encoder = JSONEncoder.nexus

        if let nodesData = try? encoder.encode(nodes),
           let edgesData = try? encoder.encode(edges) {
            let cached = CachedPlanData(projectId: projectId, nodesData: nodesData, edgesData: edgesData)
            context.insert(cached)
            try? context.save()
        }
    }

    func loadCachedPlan(projectId: String) async -> (nodes: [PlanNode], edges: [PlanEdge])? {
        guard let container = try? getContainer() else { return nil }
        let context = container.mainContext
        let decoder = JSONDecoder.nexus

        var descriptor = FetchDescriptor<CachedPlanData>(
            predicate: #Predicate { $0.projectId == projectId }
        )
        descriptor.fetchLimit = 1

        guard let cached = try? context.fetch(descriptor).first,
              let nodes = try? decoder.decode([PlanNode].self, from: cached.nodesData),
              let edges = try? decoder.decode([PlanEdge].self, from: cached.edgesData) else {
            return nil
        }
        return (nodes, edges)
    }

    // MARK: - Sessions

    func cacheSession(_ session: ChatSessionData) async {
        guard let container = try? getContainer() else { return }
        let context = container.mainContext
        let encoder = JSONEncoder.nexus

        guard let data = try? encoder.encode(session) else { return }

        // Upsert: delete existing then insert
        let sessionId = session.id
        let descriptor = FetchDescriptor<CachedSession>(
            predicate: #Predicate { $0.id == sessionId }
        )
        if let existing = try? context.fetch(descriptor).first {
            context.delete(existing)
        }

        let cached = CachedSession(
            id: session.id,
            data: data,
            type: session.type.rawValue,
            projectId: session.projectId,
            nodeId: session.nodeId,
            updatedAt: session.updatedAt
        )
        context.insert(cached)
        try? context.save()
    }

    func loadCachedSessions() async -> [ChatSessionData] {
        guard let container = try? getContainer() else { return [] }
        let context = container.mainContext
        let decoder = JSONDecoder.nexus
        let descriptor = FetchDescriptor<CachedSession>()

        guard let cached = try? context.fetch(descriptor) else { return [] }
        return cached.compactMap { try? decoder.decode(ChatSessionData.self, from: $0.data) }
    }

    func loadCachedSessions(forNode nodeId: String, type: String? = nil) async -> [ChatSessionData] {
        guard let container = try? getContainer() else { return [] }
        let context = container.mainContext
        let decoder = JSONDecoder.nexus

        let descriptor: FetchDescriptor<CachedSession>
        if let type {
            descriptor = FetchDescriptor<CachedSession>(
                predicate: #Predicate { $0.nodeId == nodeId && $0.type == type }
            )
        } else {
            descriptor = FetchDescriptor<CachedSession>(
                predicate: #Predicate { $0.nodeId == nodeId }
            )
        }

        guard let cached = try? context.fetch(descriptor) else { return [] }
        return cached.compactMap { try? decoder.decode(ChatSessionData.self, from: $0.data) }
    }

    func loadCachedSessions(forProject projectId: String, type: String? = nil) async -> [ChatSessionData] {
        guard let container = try? getContainer() else { return [] }
        let context = container.mainContext
        let decoder = JSONDecoder.nexus

        let descriptor: FetchDescriptor<CachedSession>
        if let type {
            descriptor = FetchDescriptor<CachedSession>(
                predicate: #Predicate { $0.projectId == projectId && $0.type == type }
            )
        } else {
            descriptor = FetchDescriptor<CachedSession>(
                predicate: #Predicate { $0.projectId == projectId }
            )
        }

        guard let cached = try? context.fetch(descriptor) else { return [] }
        return cached.compactMap { try? decoder.decode(ChatSessionData.self, from: $0.data) }
    }

    func deleteCachedSession(id: String) async {
        guard let container = try? getContainer() else { return }
        let context = container.mainContext

        let descriptor = FetchDescriptor<CachedSession>(
            predicate: #Predicate { $0.id == id }
        )
        if let cached = try? context.fetch(descriptor).first {
            context.delete(cached)
            try? context.save()
        }
    }
}
