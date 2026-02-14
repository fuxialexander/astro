import Foundation
import Observation

@Observable
@MainActor
final class UsageStore {
    var todayUsage = DailyUsage(
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        tasksCompleted: 0,
        tasksFailed: 0
    )
    var isLoading = false

    private let api = NexusAPI.shared

    func loadTodayUsage() async {
        isLoading = true
        do {
            todayUsage = try await api.getTodayUsage()
        } catch {
            // Keep existing data
        }
        isLoading = false
    }

    var totalTokens: Int {
        todayUsage.totalInputTokens + todayUsage.totalOutputTokens
    }

    var formattedCost: String {
        String(format: "$%.2f", todayUsage.totalCostUsd)
    }
}
