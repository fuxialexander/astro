import Foundation
import Observation

@Observable
@MainActor
final class ExecutionStore {
    /// Active executions keyed by nodeId
    var executions: [String: TaskExecution] = [:]
    var isLoading = false
    var error: String?

    /// SessionStore for dual-write (set from NexusApp.swift)
    var sessionStore: SessionStore?

    /// PlanStore for node status updates (set from NexusApp.swift)
    var planStore: PlanStore?

    /// Maps nodeId → sessionStore session ID for the current execution
    private var executionSessionIds: [String: String] = [:]

    private let streamClient = AgentStreamClient()

    // MARK: - Accessors

    func execution(for nodeId: String) -> TaskExecution? {
        executions[nodeId]
    }

    var activeExecutions: [TaskExecution] {
        executions.values.filter { $0.status == .running }.sorted { $0.startedAt < $1.startedAt }
    }

    /// Get the SessionStore session ID for a node's current execution
    func executionSessionId(for nodeId: String) -> String? {
        executionSessionIds[nodeId]
    }

    // MARK: - Dispatch task

    func dispatchTask(
        nodeId: String,
        projectId: String,
        title: String,
        description: String,
        environment: String = "local",
        visionDoc: String? = nil,
        targetMachineId: String? = nil,
        workingDirectory: String? = nil,
        model: String? = nil
    ) {
        // Initialize execution state
        let execution = TaskExecution(
            nodeId: nodeId,
            projectId: projectId,
            executionId: "",
            status: .pending,
            streamText: "",
            startedAt: .now,
            toolTraces: [],
            fileChanges: [],
            activityEvents: []
        )
        executions[nodeId] = execution

        // Update node status to dispatched
        planStore?.updateNodeStatus(id: nodeId, projectId: projectId, status: .dispatched)

        // Create execution session in SessionStore
        if let sessionStore {
            let session = sessionStore.createSession(type: .execution, projectId: projectId, nodeId: nodeId)
            executionSessionIds[nodeId] = session.id
            sessionStore.setStatus(session.id, status: .streaming)
        }

        Task {
            let stream = await streamClient.dispatchTask(
                nodeId: nodeId,
                projectId: projectId,
                title: title,
                description: description,
                environment: environment,
                visionDoc: visionDoc,
                targetMachineId: targetMachineId,
                model: model,
                workingDirectory: workingDirectory
            )

            for await event in stream {
                handleEvent(event, nodeId: nodeId)
            }
        }
    }

    // MARK: - Cancel

    func cancelExecution(nodeId: String) async {
        guard let exec = executions[nodeId] else { return }
        do {
            try await NexusAPI.shared.cancelTask(nodeId: nodeId, executionId: exec.executionId)
            executions[nodeId]?.status = .cancelled
            if let sid = executionSessionIds[nodeId] {
                sessionStore?.setStatus(sid, status: .cancelled)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Steer

    func steer(nodeId: String, message: String, interrupt: Bool = false) async {
        guard let exec = executions[nodeId] else { return }
        let machineId = exec.machineId ?? "local"

        // Add steer event immediately for instant UI feedback
        executions[nodeId]?.activityEvents.append(
            .steer(message: message, accepted: nil, ackMessage: nil, interrupted: interrupt ? true : nil, timestamp: .now)
        )

        // Dual-write to SessionStore
        if let sid = executionSessionIds[nodeId] {
            sessionStore?.addSteerMessage(sid, message: message, interrupted: interrupt ? true : nil)
        }

        do {
            try await NexusAPI.shared.steerTask(
                taskId: exec.executionId,
                machineId: machineId,
                message: message,
                interrupt: interrupt
            )
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Event handling

    private func handleEvent(_ event: AgentEvent, nodeId: String) {
        guard executions[nodeId] != nil else { return }
        let sid = executionSessionIds[nodeId]

        switch event {
        case .execInit(let executionId, _, let providerId, let providerName):
            executions[nodeId]?.executionId = executionId
            executions[nodeId]?.providerId = providerId
            executions[nodeId]?.providerName = providerName
            executions[nodeId]?.status = .running

            // Update node status to in_progress
            if let projectId = executions[nodeId]?.projectId {
                planStore?.updateNodeStatus(id: nodeId, projectId: projectId, status: .inProgress)
            }

        case .sessionInit(let sessionId, let model):
            executions[nodeId]?.sessionId = sessionId
            if let sid {
                sessionStore?.setProviderSessionId(sid, providerSessionId: sessionId)
                if let model {
                    sessionStore?.sessions[sid]?.model = model
                }
            }

        case .text(let text):
            executions[nodeId]?.streamText += text
            executions[nodeId]?.activityEvents.append(
                .text(content: text, timestamp: .now)
            )

        case .toolUse(let toolName, let toolInput):
            let trace = ToolTrace(
                id: UUID().uuidString,
                toolName: toolName,
                toolInput: toolInput,
                timestamp: .now
            )
            executions[nodeId]?.toolTraces.append(trace)
            executions[nodeId]?.activityEvents.append(
                .toolUse(id: trace.id, toolName: toolName, toolInput: toolInput, timestamp: .now)
            )

        case .toolResult(let toolName, let success, let result):
            if let lastTrace = executions[nodeId]?.toolTraces.last {
                if let idx = executions[nodeId]?.toolTraces.firstIndex(where: { $0.id == lastTrace.id }) {
                    executions[nodeId]?.toolTraces[idx].toolResult = result
                    executions[nodeId]?.toolTraces[idx].success = success
                }
            }
            executions[nodeId]?.activityEvents.append(
                .toolResult(id: UUID().uuidString, toolName: toolName, toolResult: result, success: success, duration: nil, timestamp: .now)
            )

        case .fileChange(let path, let action, let diff, let linesAdded, let linesRemoved):
            let change = FileChange(
                path: path,
                action: FileChange.FileAction(rawValue: action) ?? .modify,
                linesAdded: linesAdded,
                linesRemoved: linesRemoved,
                diff: diff,
                timestamp: .now
            )
            executions[nodeId]?.fileChanges.append(change)
            executions[nodeId]?.activityEvents.append(
                .fileChange(path: path, action: action, diff: diff, linesAdded: linesAdded, linesRemoved: linesRemoved, timestamp: .now)
            )

        case .result(_, _, let status, let output, let metrics):
            executions[nodeId]?.status = status == "success" ? .success : .failure
            executions[nodeId]?.completedAt = .now
            executions[nodeId]?.metrics = metrics
            if let output { executions[nodeId]?.streamText += "\n\n--- Result ---\n\(output)" }

            // Update node status to completed
            if let projectId = executions[nodeId]?.projectId {
                planStore?.updateNodeStatus(id: nodeId, projectId: projectId, status: status == "success" ? .completed : .planned)
            }

            // Dual-write to SessionStore
            if let sid {
                sessionStore?.setStatus(sid, status: status == "success" ? .completed : .error)
                if let metrics {
                    sessionStore?.setMetrics(sid, metrics: metrics)
                }
            }

            // Fire-and-forget execution summary
            if let sid, let exec = executions[nodeId] {
                let title = exec.nodeId
                let execOutput = exec.streamText
                let fileChanges = exec.fileChanges.map(\.path)
                Task {
                    await fetchAndStoreSummary(
                        sessionId: sid,
                        taskTitle: title,
                        taskDescription: "",
                        executionOutput: String(execOutput.suffix(4000)),
                        fileChanges: fileChanges,
                        status: status
                    )
                }
            }

        case .error(let msg, _):
            executions[nodeId]?.error = msg
            executions[nodeId]?.status = .failure
            executions[nodeId]?.completedAt = .now
            executions[nodeId]?.activityEvents.append(.error(error: msg, timestamp: .now))

            // Update node status back to planned on error
            if let projectId = executions[nodeId]?.projectId {
                planStore?.updateNodeStatus(id: nodeId, projectId: projectId, status: .planned)
            }

            if let sid {
                sessionStore?.setStatus(sid, status: .error)
            }

        case .aborted(let reason):
            executions[nodeId]?.status = .cancelled
            executions[nodeId]?.error = reason

            // Update node status back to planned on abort
            if let projectId = executions[nodeId]?.projectId {
                planStore?.updateNodeStatus(id: nodeId, projectId: projectId, status: .planned)
            }

            if let sid {
                sessionStore?.setStatus(sid, status: .cancelled)
            }

        case .done:
            if executions[nodeId]?.status == .running {
                executions[nodeId]?.status = .success
            }
            executions[nodeId]?.completedAt = .now
            if let sid, executions[nodeId]?.status == .success {
                sessionStore?.setStatus(sid, status: .completed)
            }

        default:
            break
        }
    }

    // MARK: - Execution Summary

    private func fetchAndStoreSummary(
        sessionId: String,
        taskTitle: String,
        taskDescription: String,
        executionOutput: String,
        fileChanges: [String],
        status: String
    ) async {
        do {
            let summary = try await NexusAPI.shared.summarizeExecution(
                taskTitle: taskTitle,
                taskDescription: taskDescription,
                executionOutput: executionOutput,
                fileChanges: fileChanges,
                status: status
            )
            sessionStore?.setSummary(sessionId, summary: summary)
        } catch {
            // Summary is best-effort, don't propagate errors
        }
    }

    func clearExecution(nodeId: String) {
        executions.removeValue(forKey: nodeId)
        executionSessionIds.removeValue(forKey: nodeId)
    }
}
