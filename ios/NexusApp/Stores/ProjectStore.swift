import Foundation
import Observation

@Observable
@MainActor
final class ProjectStore {
    var projects: [Project] = []
    var isLoading = false
    var error: String?

    private let api = NexusAPI.shared

    // MARK: - Computed

    var activeProjects: [Project] {
        projects.filter { $0.status == .active }
    }

    var archivedProjects: [Project] {
        projects.filter { $0.status == .archived }
    }

    func project(id: String) -> Project? {
        projects.first { $0.id == id }
    }

    // MARK: - CRUD

    func loadProjects() async {
        isLoading = true
        do {
            projects = try await api.getProjects()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func createProject(_ project: Project) async throws {
        let created = try await api.createProject(project)
        projects.append(created)
    }

    func updateProject(_ id: String, patch: [String: AnyCodable]) async throws {
        let updated = try await api.updateProject(id, patch: patch)
        if let index = projects.firstIndex(where: { $0.id == id }) {
            projects[index] = updated
        }
    }

    func deleteProject(_ id: String) async throws {
        try await api.deleteProject(id)
        projects.removeAll { $0.id == id }
    }

    func refresh() async {
        await loadProjects()
    }
}
