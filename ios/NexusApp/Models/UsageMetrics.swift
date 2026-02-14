import Foundation

struct UsageMetrics: Codable {
    var durationMs: Int?
    var inputTokens: Int?
    var outputTokens: Int?
    var tokensUsed: Int?
    var estimatedCostUsd: Double?
    var model: String?
    var turnsUsed: Int?
}

struct DailyUsage: Codable {
    var totalCostUsd: Double
    var totalInputTokens: Int
    var totalOutputTokens: Int
    var tasksCompleted: Int
    var tasksFailed: Int
}
