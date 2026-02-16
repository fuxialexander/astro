import Foundation
import Observation

@Observable
@MainActor
final class InitiativeStore {
    var initiatives: [Initiative] = []
    var isLoading = false
    var error: String?

    private var hasLoaded = false

    // MARK: - Loading

    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        await refresh()
    }

    func refresh() async {
        isLoading = true
        error = nil

        do {
            initiatives = try await NexusAPI.shared.getInitiatives()
            hasLoaded = true
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    // MARK: - CRUD Operations

    func create(_ initiative: Initiative) async throws {
        let created = try await NexusAPI.shared.createInitiative(initiative)
        initiatives.append(created)
    }

    func update(_ id: String, patch: [String: AnyCodable]) async throws {
        let updated = try await NexusAPI.shared.updateInitiative(id, patch: patch)

        if let index = initiatives.firstIndex(where: { $0.id == id }) {
            initiatives[index] = updated
        }
    }

    func delete(_ id: String) async throws {
        try await NexusAPI.shared.deleteInitiative(id)
        initiatives.removeAll { $0.id == id }
    }

    // MARK: - Queries

    func initiative(id: String) -> Initiative? {
        initiatives.first { $0.id == id }
    }

    var activeInitiatives: [Initiative] {
        initiatives.filter { $0.status == .active }
    }

    var completedInitiatives: [Initiative] {
        initiatives.filter { $0.status == .completed }
    }
}
