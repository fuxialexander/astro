import Foundation
import Observation

/// Central state for the watchOS app
@Observable
@MainActor
final class WatchStore {
    var decisions: [WatchDecision] = []
    var activeTasks: [WatchTask] = []
    var stats: WatchStats = WatchStats(activeProjects: 0, tasksCompleted: 0, pendingDecisions: 0, activeTasks: 0, costToday: 0)

    var isLoading = false
    var lastError: String?
    var lastRefresh: Date?

    private let api = WatchAPI.shared

    // MARK: - Load all data

    func loadAll() async {
        isLoading = true
        lastError = nil

        async let decisionsResult = loadDecisions()
        async let tasksResult = loadActiveTasks()
        async let statsResult = loadStats()

        await decisionsResult
        await tasksResult
        await statsResult

        lastRefresh = Date()
        isLoading = false
    }

    // MARK: - Decisions

    func loadDecisions() async {
        do {
            decisions = try await api.getPendingDecisions()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func approve(_ decision: WatchDecision) async -> Bool {
        do {
            try await api.approveTask(decision.id, projectId: decision.projectId)
            decisions.removeAll { $0.id == decision.id }
            stats = WatchStats(
                activeProjects: stats.activeProjects,
                tasksCompleted: stats.tasksCompleted + 1,
                pendingDecisions: max(0, stats.pendingDecisions - 1),
                activeTasks: stats.activeTasks,
                costToday: stats.costToday
            )
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    func reject(_ decision: WatchDecision) async -> Bool {
        do {
            try await api.rejectTask(decision.id, projectId: decision.projectId)
            decisions.removeAll { $0.id == decision.id }
            stats = WatchStats(
                activeProjects: stats.activeProjects,
                tasksCompleted: stats.tasksCompleted,
                pendingDecisions: max(0, stats.pendingDecisions - 1),
                activeTasks: max(0, stats.activeTasks - 1),
                costToday: stats.costToday
            )
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    // MARK: - Active tasks

    func loadActiveTasks() async {
        do {
            activeTasks = try await api.getActiveTasks()
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Stats

    func loadStats() async {
        do {
            stats = try await api.getStats()
        } catch {
            lastError = error.localizedDescription
        }
    }
}
