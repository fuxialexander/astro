import Foundation

/// SSE streaming client for /api/agent/* and /api/dispatch/* endpoints
/// Handles plan generation, chat, task-chat, and dispatch streaming
actor AgentStreamClient {
    private let baseURL: String
    private var activeClients: [String: SSEClient] = [:]

    init(baseURL: String? = nil) {
        self.baseURL = baseURL ?? MainActor.assumeIsolated { SessionManager.shared.serverURL }
    }

    // MARK: - Plan Generation

    func generatePlan(
        projectId: String,
        description: String,
        visionDoc: String? = nil,
        model: String? = nil,
        providerId: String? = nil,
        workingDirectory: String? = nil,
        targetMachineId: String? = nil,
        fileTree: [String]? = nil,
        keyFiles: RepoSetupResult.RepoKeyFiles? = nil
    ) -> AsyncStream<AgentEvent> {
        var body: [String: Any] = [
            "projectId": projectId,
            "description": description,
        ]
        if let visionDoc { body["visionDoc"] = visionDoc }
        if let model { body["model"] = model }
        if let providerId { body["providerId"] = providerId }
        if let workingDirectory { body["workingDirectory"] = workingDirectory }
        if let targetMachineId { body["targetMachineId"] = targetMachineId }
        if let fileTree { body["fileTree"] = fileTree }
        // Send all keyFiles fields including null values (matches web app behavior)
        if let keyFiles {
            let kf: [String: Any] = [
                "claudeMd": keyFiles.claudeMd as Any,
                "readmeMd": keyFiles.readmeMd as Any,
                "packageInfo": keyFiles.packageInfo as Any,
            ]
            body["keyFiles"] = kf
        }

        return streamSSE(path: "/api/agent/generate-plan", body: body, streamId: "plan-\(projectId)")
    }

    // MARK: - Plan Chat

    func chat(
        projectId: String,
        message: String,
        sessionId: String? = nil,
        visionDoc: String? = nil,
        planNodes: [[String: String]]? = nil,
        planEdges: [[String: String]]? = nil,
        model: String? = nil,
        messages: [[String: String]]? = nil
    ) -> AsyncStream<AgentEvent> {
        var body: [String: Any] = [
            "projectId": projectId,
            "message": message,
        ]
        if let sessionId { body["sessionId"] = sessionId }
        if let visionDoc { body["visionDoc"] = visionDoc }
        if let planNodes { body["planNodes"] = planNodes }
        if let planEdges { body["planEdges"] = planEdges }
        if let model { body["model"] = model }
        if let messages { body["messages"] = messages }

        return streamSSE(path: "/api/agent/chat", body: body, streamId: "chat-\(projectId)")
    }

    // MARK: - Task Chat

    func taskChat(
        nodeId: String,
        projectId: String,
        message: String,
        taskTitle: String,
        taskDescription: String,
        sessionId: String? = nil,
        taskOutput: String? = nil,
        visionDoc: String? = nil,
        model: String? = nil,
        messages: [[String: String]]? = nil
    ) -> AsyncStream<AgentEvent> {
        var body: [String: Any] = [
            "nodeId": nodeId,
            "projectId": projectId,
            "message": message,
            "taskTitle": taskTitle,
            "taskDescription": taskDescription,
        ]
        if let sessionId { body["sessionId"] = sessionId }
        if let taskOutput { body["taskOutput"] = taskOutput }
        if let visionDoc { body["visionDoc"] = visionDoc }
        if let model { body["model"] = model }
        if let messages { body["messages"] = messages }

        return streamSSE(path: "/api/agent/task-chat", body: body, streamId: "task-chat-\(nodeId)")
    }

    // MARK: - Dispatch (local execution)

    func dispatchLocal(
        nodeId: String,
        projectId: String,
        taskTitle: String,
        taskDescription: String,
        visionDoc: String? = nil,
        dependencyOutputs: String? = nil,
        workingDirectory: String? = nil,
        model: String? = nil,
        maxTurns: Int? = nil
    ) -> AsyncStream<AgentEvent> {
        var body: [String: Any] = [
            "nodeId": nodeId,
            "projectId": projectId,
            "taskTitle": taskTitle,
            "taskDescription": taskDescription,
        ]
        if let visionDoc { body["visionDoc"] = visionDoc }
        if let dependencyOutputs { body["dependencyOutputs"] = dependencyOutputs }
        if let workingDirectory { body["workingDirectory"] = workingDirectory }
        if let model { body["model"] = model }
        if let maxTurns { body["maxTurns"] = maxTurns }

        return streamSSE(path: "/api/agent/dispatch", body: body, streamId: "dispatch-\(nodeId)")
    }

    // MARK: - Dispatch (remote execution)

    func dispatchTask(
        nodeId: String,
        projectId: String,
        title: String,
        description: String,
        environment: String = "local",
        visionDoc: String? = nil,
        targetMachineId: String? = nil,
        model: String? = nil,
        maxTurns: Int? = nil,
        workingDirectory: String? = nil
    ) -> AsyncStream<AgentEvent> {
        var body: [String: Any] = [
            "nodeId": nodeId,
            "projectId": projectId,
            "title": title,
            "description": description,
            "environment": environment,
        ]
        if let visionDoc { body["visionDoc"] = visionDoc }
        if let targetMachineId { body["targetMachineId"] = targetMachineId }
        if let model { body["model"] = model }
        if let maxTurns { body["maxTurns"] = maxTurns }
        if let workingDirectory { body["workingDirectory"] = workingDirectory }

        return streamSSE(path: "/api/dispatch/task", body: body, streamId: "dispatch-task-\(nodeId)")
    }

    // MARK: - Abort

    func abort(sessionId: String?, taskId: String?) async throws {
        var body: [String: Any] = [:]
        if let sessionId { body["sessionId"] = sessionId }
        if let taskId { body["taskId"] = taskId }

        var request = URLRequest(url: URL(string: baseURL)!.appendingPathComponent("/api/agent/abort"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let token = await SessionManager.shared.accessToken
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await URLSession.shared.data(for: request)
    }

    // MARK: - Cancel active stream

    func cancelStream(id: String) {
        activeClients[id]?.disconnect()
        activeClients.removeValue(forKey: id)
    }

    // MARK: - Private SSE helper

    private func streamSSE(path: String, body: [String: Any], streamId: String) -> AsyncStream<AgentEvent> {
        // Cancel existing stream for same ID
        activeClients[streamId]?.disconnect()

        return AsyncStream { continuation in
            Task { @MainActor in
                let urlStr = self.baseURL + path
                guard let url = URL(string: urlStr) else {
                    continuation.finish()
                    return
                }

                // Build POST request for SSE
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                let token = SessionManager.shared.accessToken
                if let token {
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                }
                request.httpBody = try? JSONSerialization.data(withJSONObject: body)

                // Use URLSession streaming directly for POST SSE
                // Error events are informational (e.g. max_turns) — the server
                // may still send plan_result/done after an error.  Only terminate
                // on done/aborted or when the HTTP connection closes (onComplete).
                let delegate = SSEPostDelegate { message in
                    if let event = AgentEvent.parse(message) {
                        continuation.yield(event)
                        if case .done = event { continuation.finish() }
                        if case .aborted = event { continuation.finish() }
                    }
                } onComplete: {
                    continuation.finish()
                }

                let session = URLSession(
                    configuration: .default,
                    delegate: delegate,
                    delegateQueue: nil
                )
                let task = session.dataTask(with: request)
                task.resume()

                continuation.onTermination = { @Sendable _ in
                    task.cancel()
                    session.invalidateAndCancel()
                }
            }
        }
    }
}

// MARK: - Agent Event

enum AgentEvent {
    case text(String)
    case planResult(nodes: [PlanNode], edges: [PlanEdge])
    case toolUse(toolName: String, toolInput: AnyCodable)
    case toolResult(toolName: String, success: Bool?, result: AnyCodable?)
    case fileChange(path: String, action: String, diff: String?, linesAdded: Int?, linesRemoved: Int?)
    case progress(message: String, percentage: Double?)
    case sessionInit(sessionId: String, model: String?)
    case execInit(executionId: String, nodeId: String, providerId: String?, providerName: String?)
    case result(executionId: String?, nodeId: String?, status: String, output: String?, metrics: UsageMetrics?)
    case done(sessionId: String?, executionId: String?)
    case error(String, recoverable: Bool)
    case aborted(reason: String?)
    case heartbeat

    static func parse(_ message: SSEParser.Message) -> AgentEvent? {
        let eventType = message.event ?? "message"
        let data = message.data

        switch eventType {
        case "text":
            return .text(data)

        case "plan_result":
            guard let jsonData = data.data(using: .utf8),
                  let planData = try? JSONDecoder.nexus.decode(PlanData.self, from: jsonData) else {
                return .text(data)
            }
            return .planResult(nodes: planData.nodes, edges: planData.edges)

        case "tool_use":
            guard let jsonData = data.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else { return nil }
            return .toolUse(
                toolName: dict["toolName"] as? String ?? "",
                toolInput: AnyCodable(dict["toolInput"] ?? [:])
            )

        case "tool_result":
            guard let jsonData = data.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else { return nil }
            return .toolResult(
                toolName: dict["toolName"] as? String ?? "",
                success: dict["success"] as? Bool,
                result: (dict["result"]).map { AnyCodable($0) }
            )

        case "file_change":
            guard let jsonData = data.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else { return nil }
            return .fileChange(
                path: dict["path"] as? String ?? "",
                action: dict["action"] as? String ?? "",
                diff: dict["diff"] as? String,
                linesAdded: dict["linesAdded"] as? Int,
                linesRemoved: dict["linesRemoved"] as? Int
            )

        case "progress":
            guard let jsonData = data.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else { return nil }
            return .progress(
                message: dict["message"] as? String ?? "",
                percentage: dict["percentage"] as? Double
            )

        case "init":
            guard let jsonData = data.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else { return nil }
            return .execInit(
                executionId: dict["executionId"] as? String ?? "",
                nodeId: dict["nodeId"] as? String ?? "",
                providerId: dict["providerId"] as? String,
                providerName: dict["providerName"] as? String
            )

        case "session_init":
            guard let jsonData = data.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else { return nil }
            return .sessionInit(
                sessionId: dict["sessionId"] as? String ?? "",
                model: dict["model"] as? String
            )

        case "result":
            guard let jsonData = data.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else { return nil }
            var metrics: UsageMetrics?
            if let metricsData = dict["metrics"] {
                let metricsJSON = try? JSONSerialization.data(withJSONObject: metricsData)
                metrics = metricsJSON.flatMap { try? JSONDecoder.nexus.decode(UsageMetrics.self, from: $0) }
            }
            return .result(
                executionId: dict["executionId"] as? String,
                nodeId: dict["nodeId"] as? String,
                status: dict["status"] as? String ?? "unknown",
                output: dict["output"] as? String,
                metrics: metrics
            )

        case "done":
            guard let jsonData = data.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
                return .done(sessionId: nil, executionId: nil)
            }
            return .done(
                sessionId: dict["sessionId"] as? String,
                executionId: dict["executionId"] as? String
            )

        case "error":
            guard let jsonData = data.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
                return .error(data, recoverable: false)
            }
            return .error(
                dict["error"] as? String ?? data,
                recoverable: dict["recoverable"] as? Bool ?? false
            )

        case "aborted":
            guard let jsonData = data.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
                return .aborted(reason: nil)
            }
            return .aborted(reason: dict["reason"] as? String)

        case "heartbeat":
            return .heartbeat

        default:
            return nil
        }
    }
}

// MARK: - SSE POST Delegate (uses SSEParser)

private class SSEPostDelegate: NSObject, URLSessionDataDelegate {
    private let parser = SSEParser()
    private let onMessage: (SSEParser.Message) -> Void
    private let onComplete: () -> Void
    private var httpStatusCode: Int?
    private var errorBodyData = Data()
    private var receivedSSEEvent = false

    init(onMessage: @escaping (SSEParser.Message) -> Void, onComplete: @escaping () -> Void) {
        self.onMessage = onMessage
        self.onComplete = onComplete
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        httpStatusCode = (response as? HTTPURLResponse)?.statusCode
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        // If non-2xx, accumulate body for error extraction
        if let code = httpStatusCode, code < 200 || code >= 300 {
            errorBodyData.append(data)
            return
        }
        guard let chunk = String(data: data, encoding: .utf8) else { return }
        let messages = parser.feed(chunk)
        for message in messages {
            receivedSSEEvent = true
            onMessage(message)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // Surface HTTP errors as AgentEvent.error
        if let code = httpStatusCode, code < 200 || code >= 300 {
            var errorMsg = "Server error (\(code))"
            if !errorBodyData.isEmpty,
               let json = try? JSONSerialization.jsonObject(with: errorBodyData) as? [String: Any],
               let msg = json["error"] as? String {
                errorMsg = msg
            }
            let errMessage = SSEParser.Message(event: "error", data: "{\"error\":\"\(errorMsg.replacingOccurrences(of: "\"", with: "\\\""))\"}")
            onMessage(errMessage)
        } else if let error, !receivedSSEEvent {
            let errMessage = SSEParser.Message(event: "error", data: "{\"error\":\"\(error.localizedDescription.replacingOccurrences(of: "\"", with: "\\\""))\"}")
            onMessage(errMessage)
        }
        onComplete()
    }
}
