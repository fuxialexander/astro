import Foundation

/// Lightweight API client for watchOS — minimal subset of NexusAPI
actor WatchAPI {
    static let shared = WatchAPI()

    private var baseURL: String {
        UserDefaults(suiteName: "group.com.nexus.app")?.string(forKey: "nexus.serverURL") ?? "http://localhost:3001"
    }

    private var accessToken: String? {
        UserDefaults(suiteName: "group.com.nexus.app")?.string(forKey: "nexus.accessToken")
    }

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let str = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: str) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: str) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date: \(str)")
        }
        return d
    }()

    // MARK: - Generic request

    private func request<T: Decodable>(_ method: String, path: String, body: Data? = nil) async throws -> T {
        guard let url = URL(string: baseURL)?.appendingPathComponent(path) else {
            throw WatchAPIError.invalidURL
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 15

        if let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            req.httpBody = body
        }

        let (data, response) = try await URLSession.shared.data(for: req)

        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw WatchAPIError.httpError(code)
        }

        return try decoder.decode(T.self, from: data)
    }

    // MARK: - Decisions (awaiting_judgment nodes)

    func getPendingDecisions() async throws -> [WatchDecision] {
        try await request("GET", path: "/api/data/plan?status=awaiting_judgment")
    }

    // MARK: - Active tasks

    func getActiveTasks() async throws -> [WatchTask] {
        struct AllNodes: Decodable {
            var nodes: [WatchTask]
        }
        // Fetch all nodes and filter client-side for active statuses
        let projects: [WatchProject] = try await request("GET", path: "/api/data/projects")
        var activeTasks: [WatchTask] = []

        for project in projects where project.status == "active" {
            do {
                struct PlanData: Decodable {
                    var nodes: [WatchTask]
                }
                let plan: PlanData = try await request("GET", path: "/api/data/plan/\(project.id)")
                let active = plan.nodes.filter { $0.status.isActive }
                    .map { task in
                        var t = task
                        t.projectName = project.name
                        return t
                    }
                activeTasks.append(contentsOf: active)
            } catch {
                continue
            }
        }

        return activeTasks
    }

    // MARK: - Stats

    func getStats() async throws -> WatchStats {
        let projects: [WatchProject] = try await request("GET", path: "/api/data/projects")
        let activeProjects = projects.filter { $0.status == "active" }

        struct UsageData: Decodable {
            var totalCostUsd: Double
            var tasksCompleted: Int
        }

        var tasksCompleted = 0
        var costToday: Double = 0
        var pendingDecisions = 0
        var activeTasks = 0

        do {
            let usage: UsageData = try await request("GET", path: "/api/data/usage/today")
            tasksCompleted = usage.tasksCompleted
            costToday = usage.totalCostUsd
        } catch {}

        for project in activeProjects {
            do {
                struct PlanData: Decodable {
                    var nodes: [WatchTask]
                }
                let plan: PlanData = try await request("GET", path: "/api/data/plan/\(project.id)")
                pendingDecisions += plan.nodes.filter { $0.status == .awaitingJudgment }.count
                activeTasks += plan.nodes.filter { $0.status.isActive }.count
            } catch {
                continue
            }
        }

        return WatchStats(
            activeProjects: activeProjects.count,
            tasksCompleted: tasksCompleted,
            pendingDecisions: pendingDecisions,
            activeTasks: activeTasks,
            costToday: costToday
        )
    }

    // MARK: - Judgment actions

    func approveTask(_ nodeId: String, projectId: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "status": "completed"
        ])
        let _: WatchTask = try await request("PATCH", path: "/api/data/plan/\(projectId)/nodes/\(nodeId)", body: body)
    }

    func rejectTask(_ nodeId: String, projectId: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "status": "pruned"
        ])
        let _: WatchTask = try await request("PATCH", path: "/api/data/plan/\(projectId)/nodes/\(nodeId)", body: body)
    }
}

enum WatchAPIError: Error, LocalizedError {
    case invalidURL
    case httpError(Int)
    case noAuth

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid server URL"
        case .httpError(let code): return "Server error (\(code))"
        case .noAuth: return "Not authenticated"
        }
    }
}
