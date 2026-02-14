import Foundation
import Observation

@Observable
@MainActor
final class PlanStore {
    /// Nodes keyed by projectId
    var nodesByProject: [String: [PlanNode]] = [:]
    /// Edges keyed by projectId
    var edgesByProject: [String: [PlanEdge]] = [:]
    var isLoading = false
    var error: String?

    // MARK: - Generation State

    enum GenerationPhase: String {
        case idle
        case repoSetup = "repo_setup"
        case generating
    }

    /// Per-project generation state for async background plan generation
    struct GenerationState {
        var isGenerating = false
        var phase: GenerationPhase = .idle
        var text = ""
        var error: String?
        var nodeCount = 0
        var needsGitInit = false
        var needsGitInitDir: String?
    }

    /// Active generation states keyed by projectId
    var generations: [String: GenerationState] = [:]

    private let api = NexusAPI.shared
    private let streamClient = AgentStreamClient()

    // MARK: - Accessors

    func nodes(for projectId: String) -> [PlanNode] {
        nodesByProject[projectId] ?? []
    }

    func edges(for projectId: String) -> [PlanEdge] {
        edgesByProject[projectId] ?? []
    }

    func node(id: String, projectId: String) -> PlanNode? {
        nodesByProject[projectId]?.first { $0.id == id }
    }

    func milestones(for projectId: String) -> [PlanNode] {
        nodes(for: projectId).filter { $0.type == .milestone }
    }

    func tasks(for projectId: String) -> [PlanNode] {
        nodes(for: projectId).filter { $0.type == .task }
    }

    func decisions(for projectId: String) -> [PlanNode] {
        nodes(for: projectId).filter { $0.type == .decision }
    }

    func pendingDecisions() -> [PlanNode] {
        nodesByProject.values.flatMap { $0 }.filter {
            $0.status == .awaitingJudgment || ($0.type == .decision && $0.status == .planned)
        }
    }

    func isGenerating(projectId: String) -> Bool {
        generations[projectId]?.isGenerating == true
    }

    func generationState(for projectId: String) -> GenerationState? {
        generations[projectId]
    }

    func tasksGrouped(by grouping: TaskGrouping, projectId: String) -> [(String, [PlanNode])] {
        let allTasks = tasks(for: projectId)
        switch grouping {
        case .status:
            let grouped = Dictionary(grouping: allTasks) { $0.status.displayName }
            return grouped.sorted { $0.key < $1.key }
        case .milestone:
            let milestoneMap = Dictionary(uniqueKeysWithValues: milestones(for: projectId).map { ($0.id, $0.title) })
            let grouped = Dictionary(grouping: allTasks) { node -> String in
                if let mid = node.milestoneId, let title = milestoneMap[mid] { return title }
                return "No Milestone"
            }
            return grouped.sorted { $0.key < $1.key }
        case .priority:
            let grouped = Dictionary(grouping: allTasks) { ($0.priority ?? .none).displayName }
            return grouped.sorted { $0.key < $1.key }
        case .none:
            return [("All Tasks", allTasks)]
        }
    }

    enum TaskGrouping: String, CaseIterable {
        case none = "None"
        case status = "Status"
        case milestone = "Milestone"
        case priority = "Priority"
    }

    // MARK: - Load

    func loadPlan(projectId: String) async {
        isLoading = true
        do {
            let data = try await api.getPlan(projectId: projectId)
            nodesByProject[projectId] = data.nodes
            edgesByProject[projectId] = data.edges
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    /// Load plans for multiple projects (e.g., all active projects for dashboard)
    func loadPlans(projectIds: [String]) async {
        isLoading = true
        await withTaskGroup(of: Void.self) { group in
            for projectId in projectIds {
                group.addTask {
                    do {
                        let data = try await self.api.getPlan(projectId: projectId)
                        await MainActor.run {
                            self.nodesByProject[projectId] = data.nodes
                            self.edgesByProject[projectId] = data.edges
                        }
                    } catch {
                        // Silently skip failed loads for individual projects
                    }
                }
            }
        }
        isLoading = false
        error = nil
    }

    // MARK: - Background Plan Generation

    /// Start plan generation in the background. Returns immediately.
    /// Observe `generations[projectId]` for progress.
    ///
    /// **Flow** (matches web app):
    /// 1. Phase `.repoSetup` — call `/api/repo/setup` to resolve working directory,
    ///    file tree, and key files (clones repo on remote machine if needed).
    /// 2. Phase `.generating` — call `/api/agent/generate-plan` with the resolved
    ///    context so the AI sees the codebase structure.
    func startGeneration(
        projectId: String,
        projectName: String,
        description: String,
        visionDoc: String? = nil,
        workingDirectory: String? = nil,
        repository: String? = nil,
        targetMachineId: String? = nil
    ) {
        generations[projectId] = GenerationState(isGenerating: true, phase: .repoSetup)

        Task {
            await runGeneration(
                projectId: projectId,
                projectName: projectName,
                description: description,
                visionDoc: visionDoc,
                workingDirectory: workingDirectory,
                repository: repository,
                targetMachineId: targetMachineId
            )
        }
    }

    private func runGeneration(
        projectId: String,
        projectName: String,
        description: String,
        visionDoc: String?,
        workingDirectory: String?,
        repository: String?,
        targetMachineId: String?
    ) async {
        // Step 0: Fetch model + provider settings (matches web app settings-store)
        var model: String?
        var providerId: String?
        do {
            let settings = try await api.getSettings()
            if let selectedModel = settings["selectedModel"], !selectedModel.isEmpty {
                model = selectedModel
            }
        } catch {
            // Non-fatal — use server default
        }
        // defaultProvider is stored locally (matches web app's IndexedDB pattern)
        let defaultProvider = UserDefaults.standard.string(forKey: "nexus-defaultProvider") ?? ""
        if !defaultProvider.isEmpty {
            providerId = defaultProvider
        }
        // Only send model if provider is claude-code or auto (matches web app logic)
        let isClaudeProvider = defaultProvider.isEmpty || defaultProvider == "claude-code"
        if !isClaudeProvider {
            model = nil
        }

        // Step 1: Repo setup — resolve working directory, file tree, key files
        var resolvedWorkingDir = workingDirectory
        var fileTree: [String]?
        var keyFiles: RepoSetupResult.RepoKeyFiles?

        if repository != nil || workingDirectory != nil || targetMachineId != nil {
            generations[projectId]?.phase = .repoSetup
            do {
                let repoResult = try await api.setupRepo(
                    projectId: projectId,
                    projectName: projectName,
                    projectDescription: description,
                    workingDirectory: workingDirectory,
                    repository: repository,
                    targetMachineId: targetMachineId
                )

                // Handle needsGitInit (matches web app — flag it but still generate without context)
                if repoResult.needsGitInit == true {
                    generations[projectId]?.needsGitInit = true
                    generations[projectId]?.needsGitInitDir = repoResult.workingDirectory
                } else {
                    if let dir = repoResult.workingDirectory { resolvedWorkingDir = dir }
                    fileTree = repoResult.fileTree
                    keyFiles = repoResult.keyFiles
                }

                // Update project with resolved values (matches web app behavior)
                var patch: [String: AnyCodable] = [:]
                if let dir = repoResult.workingDirectory { patch["workingDirectory"] = AnyCodable(dir) }
                if let repo = repoResult.repository { patch["repository"] = AnyCodable(repo) }
                if !patch.isEmpty {
                    _ = try? await api.updateProject(projectId, patch: patch)
                }
            } catch {
                // Non-fatal — proceed without repo context
                print("[PlanStore] Repo setup failed: \(error.localizedDescription)")
            }
        }

        // Step 2: Generate plan with resolved context
        generations[projectId]?.phase = .generating

        let stream = await streamClient.generatePlan(
            projectId: projectId,
            description: description,
            visionDoc: visionDoc,
            model: model,
            providerId: providerId,
            workingDirectory: resolvedWorkingDir,
            targetMachineId: targetMachineId,
            fileTree: fileTree,
            keyFiles: keyFiles
        )

        for await event in stream {
            switch event {
            case .text(let text):
                generations[projectId]?.text += text

            case .planResult(var nodes, let edges):
                // Backend plan_result omits projectId — inject it
                for i in nodes.indices { nodes[i].projectId = projectId }
                setNodes(nodes, edges: edges, projectId: projectId)
                generations[projectId]?.nodeCount = nodes.count
                // Clear any prior informational error (e.g. max_turns)
                generations[projectId]?.error = nil
                do {
                    try await savePlan(projectId: projectId)
                } catch {
                    generations[projectId]?.error = "Failed to save plan: \(error.localizedDescription)"
                }

            case .error(let msg, _):
                generations[projectId]?.error = msg

            default:
                break
            }
        }

        generations[projectId]?.isGenerating = false
    }

    // MARK: - Mutations

    func addNode(_ node: PlanNode) async throws {
        try await api.createNode(node)
        nodesByProject[node.projectId, default: []].append(node)
    }

    func updateNode(id: String, projectId: String, patch: [String: AnyCodable]) async throws {
        try await api.updateNode(id, patch: patch)
        if let _ = nodesByProject[projectId]?.firstIndex(where: { $0.id == id }) {
            // Reload to get fresh data
            await loadPlan(projectId: projectId)
        }
    }

    func deleteNode(id: String, projectId: String) async throws {
        try await api.deleteNode(id)
        nodesByProject[projectId]?.removeAll { $0.id == id }
        edgesByProject[projectId]?.removeAll { $0.source == id || $0.target == id }
    }

    func addEdge(_ edge: PlanEdge, projectId: String) async throws {
        try await api.createEdge(edge)
        edgesByProject[projectId, default: []].append(edge)
    }

    func deleteEdge(id: String, projectId: String) async throws {
        try await api.deleteEdge(id)
        edgesByProject[projectId]?.removeAll { $0.id == id }
    }

    /// Update node status locally (optimistic update for execution state changes)
    func updateNodeStatus(id: String, projectId: String, status: PlanNode.NodeStatus) {
        guard let idx = nodesByProject[projectId]?.firstIndex(where: { $0.id == id }) else { return }
        nodesByProject[projectId]?[idx].status = status
    }

    func setNodes(_ nodes: [PlanNode], edges: [PlanEdge], projectId: String) {
        nodesByProject[projectId] = nodes
        edgesByProject[projectId] = edges
    }

    func savePlan(projectId: String) async throws {
        let nodes = nodesByProject[projectId] ?? []
        let edges = edgesByProject[projectId] ?? []
        try await api.putPlan(projectId: projectId, nodes: nodes, edges: edges)
    }
}
