import Foundation

/// Central REST client for all /api/data/* endpoints
actor NexusAPI {
    static let shared = NexusAPI()

    private var baseURL: URL {
        get async {
            await URL(string: SessionManager.shared.serverURL)!
        }
    }

    private var session: URLSession { URLSession.shared }

    private var decoder: JSONDecoder { .nexus }
    private var encoder: JSONEncoder { .nexus }

    // MARK: - Generic request helpers

    private func request<T: Decodable>(_ method: String, path: String, body: (any Encodable)? = nil) async throws -> T {
        var req = URLRequest(url: await baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token = await SessionManager.shared.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            req.httpBody = try encoder.encode(AnyEncodable(body))
        }

        let (data, response) = try await session.data(for: req)

        guard let http = response as? HTTPURLResponse else {
            throw NexusError.invalidResponse
        }

        if http.statusCode == 401 {
            // Try refresh
            try await SessionManager.shared.refreshTokens()
            // Retry once
            if let token = await SessionManager.shared.accessToken {
                req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
            let (retryData, retryResponse) = try await session.data(for: req)
            guard let retryHttp = retryResponse as? HTTPURLResponse, (200...299).contains(retryHttp.statusCode) else {
                throw NexusError.unauthorized
            }
            return try decoder.decode(T.self, from: retryData)
        }

        guard (200...299).contains(http.statusCode) else {
            let errorBody = String(data: data, encoding: .utf8) ?? ""
            throw NexusError.httpError(statusCode: http.statusCode, body: errorBody)
        }

        return try decoder.decode(T.self, from: data)
    }

    private func requestVoid(_ method: String, path: String, body: (any Encodable)? = nil) async throws {
        let _: EmptyResponse = try await request(method, path: path, body: body)
    }

    // MARK: - Projects

    func getProjects() async throws -> [Project] {
        try await request("GET", path: "/api/data/projects")
    }

    func getProject(_ id: String) async throws -> Project {
        try await request("GET", path: "/api/data/projects/\(id)")
    }

    func createProject(_ project: Project) async throws -> Project {
        try await request("POST", path: "/api/data/projects", body: project)
    }

    func updateProject(_ id: String, patch: [String: AnyCodable]) async throws -> Project {
        try await request("PATCH", path: "/api/data/projects/\(id)", body: patch)
    }

    func deleteProject(_ id: String) async throws {
        try await requestVoid("DELETE", path: "/api/data/projects/\(id)")
    }

    // MARK: - Plan (nodes + edges)

    func getPlan(projectId: String) async throws -> PlanData {
        try await request("GET", path: "/api/data/plan/\(projectId)")
    }

    func putPlan(projectId: String, nodes: [PlanNode], edges: [PlanEdge]) async throws {
        let body = PlanData(nodes: nodes, edges: edges)
        try await requestVoid("PUT", path: "/api/data/plan/\(projectId)", body: body)
    }

    func createNode(_ node: PlanNode) async throws {
        try await requestVoid("POST", path: "/api/data/plan/nodes", body: node)
    }

    func updateNode(_ id: String, patch: [String: AnyCodable]) async throws {
        try await requestVoid("PATCH", path: "/api/data/plan/nodes/\(id)", body: patch)
    }

    func deleteNode(_ id: String) async throws {
        try await requestVoid("DELETE", path: "/api/data/plan/nodes/\(id)")
    }

    func createEdge(_ edge: PlanEdge) async throws {
        try await requestVoid("POST", path: "/api/data/plan/edges", body: edge)
    }

    func deleteEdge(_ id: String) async throws {
        try await requestVoid("DELETE", path: "/api/data/plan/edges/\(id)")
    }

    // MARK: - User Profile

    func getProfile() async throws -> UserProfile? {
        try await request("GET", path: "/api/data/profile")
    }

    func putProfile(_ profile: UserProfile) async throws -> UserProfile {
        try await request("PUT", path: "/api/data/profile", body: profile)
    }

    // MARK: - Usage

    func getTodayUsage() async throws -> DailyUsage {
        try await request("GET", path: "/api/data/usage/today")
    }

    // MARK: - Settings

    func getSettings() async throws -> [String: String] {
        try await request("GET", path: "/api/data/settings")
    }

    func patchSettings(_ settings: [String: String]) async throws {
        try await requestVoid("PATCH", path: "/api/data/settings", body: settings)
    }

    // MARK: - Chat

    func getChat(nodeId: String) async throws -> ChatData? {
        try await request("GET", path: "/api/data/chat/\(nodeId)")
    }

    func postChatMessage(nodeId: String, message: ChatMessage) async throws {
        try await requestVoid("POST", path: "/api/data/chat/\(nodeId)/messages", body: message)
    }

    func createChatSession(nodeId: String, projectId: String, sessionId: String?) async throws {
        let body: [String: AnyCodable] = [
            "projectId": AnyCodable(projectId),
            "sessionId": AnyCodable(sessionId as Any),
        ]
        try await requestVoid("POST", path: "/api/data/chat/\(nodeId)/session", body: body)
    }

    // MARK: - Relay / Machines

    func getMachines() async throws -> MachinesResponse {
        try await request("GET", path: "/api/relay/machines")
    }

    func getRegisteredMachines() async throws -> RegisteredMachinesResponse {
        try await request("GET", path: "/api/device/machines")
    }

    func getBestMachine(environment: String, provider: String? = nil) async throws -> BestMachineResponse {
        var path = "/api/relay/best-machine?environment=\(environment)"
        if let provider { path += "&provider=\(provider)" }
        return try await request("GET", path: path)
    }

    // MARK: - Providers

    func getProviders() async throws -> ProvidersResponse {
        try await request("GET", path: "/api/agent/providers")
    }

    // MARK: - Health

    func checkHealth() async throws -> HealthResponse {
        try await request("GET", path: "/api/health")
    }

    // MARK: - Execution Summary

    func summarizeExecution(
        taskTitle: String,
        taskDescription: String,
        executionOutput: String,
        fileChanges: [String],
        status: String
    ) async throws -> ExecutionSummary {
        let body: [String: AnyCodable] = [
            "taskTitle": AnyCodable(taskTitle),
            "taskDescription": AnyCodable(taskDescription),
            "executionOutput": AnyCodable(executionOutput),
            "fileChanges": AnyCodable(fileChanges),
            "status": AnyCodable(status),
        ]
        return try await request("POST", path: "/api/agent/summarize", body: body)
    }

    // MARK: - Repo Setup

    func setupRepo(
        projectId: String,
        projectName: String,
        projectDescription: String?,
        workingDirectory: String?,
        repository: String?,
        targetMachineId: String?
    ) async throws -> RepoSetupResult {
        var body: [String: AnyCodable] = [
            "projectId": AnyCodable(projectId),
            "projectName": AnyCodable(projectName),
        ]
        if let projectDescription { body["projectDescription"] = AnyCodable(projectDescription) }
        if let workingDirectory { body["workingDirectory"] = AnyCodable(workingDirectory) }
        if let repository { body["repository"] = AnyCodable(repository) }
        if let targetMachineId { body["targetMachineId"] = AnyCodable(targetMachineId) }
        return try await request("POST", path: "/api/repo/setup", body: body)
    }

    // MARK: - Dispatch

    func cancelTask(nodeId: String?, executionId: String?) async throws {
        var body: [String: AnyCodable] = [:]
        if let nodeId { body["nodeId"] = AnyCodable(nodeId) }
        if let executionId { body["executionId"] = AnyCodable(executionId) }
        try await requestVoid("POST", path: "/api/dispatch/cancel", body: body)
    }

    func steerTask(taskId: String, machineId: String, message: String, interrupt: Bool = false) async throws {
        var body: [String: AnyCodable] = [
            "taskId": AnyCodable(taskId),
            "machineId": AnyCodable(machineId),
            "message": AnyCodable(message),
        ]
        if interrupt {
            body["interrupt"] = AnyCodable(true)
        }
        try await requestVoid("POST", path: "/api/dispatch/steer", body: body)
    }

    func getDispatchStatus() async throws -> DispatchStatusResponse {
        try await request("GET", path: "/api/dispatch/status")
    }

    func getReadyTasks(projectId: String) async throws -> ReadyTasksResponse {
        try await request("GET", path: "/api/dispatch/ready/\(projectId)")
    }
}

// MARK: - Response Types

struct PlanData: Codable {
    var nodes: [PlanNode]
    var edges: [PlanEdge]
}

struct ChatData: Codable {
    var session: ChatSession?
    var messages: [ChatMessage]?
}

struct ChatSession: Codable {
    var nodeId: String
    var projectId: String
    var sessionId: String?
    var createdAt: Date?
    var updatedAt: Date?
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    var role: String
    var content: String
    var timestamp: Date
}

struct MachinesResponse: Codable {
    var machines: [MachineInfo]
    var summary: MachineSummary?
}

struct MachineSummary: Codable {
    var total: Int?
    var connected: Int?
}

struct RegisteredMachinesResponse: Codable {
    var machines: [RegisteredMachine]
    var count: Int
}

struct BestMachineResponse: Codable {
    var machine: MachineInfo?
    var error: String?
}

struct ProvidersResponse: Codable {
    var providers: [ProviderInfo]
}

struct ProviderInfo: Codable, Identifiable {
    var id: String
    var name: String
    var available: Bool
    var defaultModel: String?
    var availableModels: [String]?
}

struct HealthResponse: Codable {
    var status: String?
}

struct DispatchStatusResponse: Codable {
    var engine: EngineStatus?
    var queue: QueueStatus?

    struct EngineStatus: Codable {
        var running: Bool?
        var activeExecutions: Int?
    }

    struct QueueStatus: Codable {
        var total: Int?
        var activeTotal: Int?
    }
}

struct ReadyTasksResponse: Codable {
    var projectId: String
    var readyTasks: [ReadyTask]
    var count: Int

    struct ReadyTask: Codable {
        var nodeId: String
        var title: String
        var priority: Int?
    }
}

struct RepoSetupResult: Codable {
    var success: Bool?
    var workingDirectory: String?
    var fileTree: [String]?
    var repository: String?
    var needsGitInit: Bool?
    var keyFiles: RepoKeyFiles?
    var error: String?

    struct RepoKeyFiles: Codable {
        var claudeMd: String?
        var readmeMd: String?
        var packageInfo: String?
    }
}

struct EmptyResponse: Codable {}

// MARK: - Error

enum NexusError: LocalizedError {
    case invalidResponse
    case unauthorized
    case httpError(statusCode: Int, body: String)
    case sseParseError(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid response from server"
        case .unauthorized: return "Authentication required"
        case .httpError(let code, let body): return "HTTP \(code): \(body)"
        case .sseParseError(let msg): return "SSE parse error: \(msg)"
        }
    }
}

// MARK: - Encoder/Decoder extensions

extension JSONDecoder {
    static let nexus: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let str = try container.decode(String.self)
            // Try ISO 8601 with fractional seconds
            if let date = ISO8601DateFormatter.fractional.date(from: str) { return date }
            // Try ISO 8601 without fractional seconds
            if let date = ISO8601DateFormatter.standard.date(from: str) { return date }
            // Try date-only
            if let date = DateFormatter.dateOnly.date(from: str) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot decode date: \(str)")
        }
        return d
    }()
}

extension JSONEncoder {
    static let nexus: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()
}

extension ISO8601DateFormatter {
    static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    static let standard: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}

extension DateFormatter {
    static let dateOnly: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
}

// MARK: - AnyEncodable helper

struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void

    init(_ wrapped: any Encodable) {
        _encode = { encoder in
            try wrapped.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try _encode(encoder)
    }
}
