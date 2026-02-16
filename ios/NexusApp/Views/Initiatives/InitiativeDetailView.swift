import SwiftUI

struct InitiativeDetailView: View {
    let initiativeId: String

    @Environment(InitiativeStore.self) private var initiativeStore
    @Environment(ProjectStore.self) private var projectStore
    @State private var showingEditSheet = false
    @State private var showingDeleteAlert = false

    private var initiative: Initiative? {
        initiativeStore.initiatives.first { $0.id == initiativeId }
    }

    private var linkedProjects: [Project] {
        projectStore.projects.filter { $0.initiativeId == initiativeId }
    }

    var body: some View {
        Group {
            if let initiative {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        // Header
                        HStack(spacing: 16) {
                            Text(initiative.icon)
                                .font(.system(size: 60))
                                .frame(width: 80, height: 80)
                                .background(
                                    RoundedRectangle(cornerRadius: 16)
                                        .fill(colorFromHex(initiative.color).opacity(0.15))
                                )

                            VStack(alignment: .leading, spacing: 8) {
                                Text(initiative.name)
                                    .font(.title2.bold())

                                HStack {
                                    Text(initiative.status.displayName)
                                        .font(.subheadline)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .background(
                                            Capsule()
                                                .fill(Color(initiative.status.color).opacity(0.2))
                                        )
                                        .foregroundStyle(Color(initiative.status.color))

                                    if let lead = initiative.lead {
                                        Label(lead, systemImage: "person.fill")
                                            .font(.subheadline)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }

                        // Description
                        if !initiative.description.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Description")
                                    .font(.headline)

                                Text(initiative.description)
                                    .font(.body)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        // Goal
                        if let goal = initiative.goal, !goal.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Goal")
                                    .font(.headline)

                                Text(goal)
                                    .font(.body)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        // Timeline
                        if initiative.startDate != nil || initiative.targetDate != nil {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Timeline")
                                    .font(.headline)

                                HStack(spacing: 20) {
                                    if let startDate = initiative.startDate {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text("Start Date")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                            Text(startDate)
                                                .font(.subheadline)
                                        }
                                    }

                                    if let targetDate = initiative.targetDate {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text("Target Date")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                            Text(targetDate)
                                                .font(.subheadline)
                                        }
                                    }
                                }
                            }
                        }

                        Divider()

                        // Linked Projects
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("Projects")
                                    .font(.headline)

                                Spacer()

                                Text("\(linkedProjects.count)")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }

                            if linkedProjects.isEmpty {
                                ContentUnavailableView(
                                    "No Projects",
                                    systemImage: "folder",
                                    description: Text("No projects are linked to this initiative yet")
                                )
                                .frame(height: 120)
                            } else {
                                ForEach(linkedProjects) { project in
                                    NavigationLink(value: project) {
                                        ProjectMiniRow(project: project)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    .padding()
                }
            } else {
                ContentUnavailableView("Initiative Not Found", systemImage: "exclamationmark.triangle")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        showingEditSheet = true
                    } label: {
                        Label("Edit", systemImage: "pencil")
                    }

                    Button(role: .destructive) {
                        showingDeleteAlert = true
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingEditSheet) {
            if let initiative {
                EditInitiativeSheet(initiative: initiative)
            }
        }
        .alert("Delete Initiative", isPresented: $showingDeleteAlert) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task {
                    await deleteInitiative()
                }
            }
        } message: {
            Text("This will unlink all projects from this initiative. The projects will not be deleted.")
        }
        .navigationDestination(for: Project.self) { project in
            ProjectDetailView(projectId: project.id)
        }
    }

    private func deleteInitiative() async {
        do {
            try await initiativeStore.delete(initiativeId)
        } catch {
            print("Failed to delete initiative: \(error)")
        }
    }
}

// MARK: - Project Mini Row

private struct ProjectMiniRow: View {
    let project: Project

    var body: some View {
        HStack(spacing: 12) {
            Text(project.icon)
                .font(.title3)

            VStack(alignment: .leading, spacing: 2) {
                Text(project.name)
                    .font(.subheadline.weight(.medium))

                if !project.description.isEmpty {
                    Text(project.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            if let health = project.health {
                Circle()
                    .fill(healthColor(health))
                    .frame(width: 8, height: 8)
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(12)
        .background(Color(.systemGray6))
        .cornerRadius(8)
    }

    private func healthColor(_ health: Project.ProjectHealth) -> Color {
        switch health {
        case .onTrack: return .green
        case .atRisk: return .orange
        case .offTrack: return .red
        }
    }
}

// MARK: - Edit Initiative Sheet

private struct EditInitiativeSheet: View {
    let initiative: Initiative

    @Environment(\.dismiss) private var dismiss
    @Environment(InitiativeStore.self) private var initiativeStore

    @State private var name: String
    @State private var description: String
    @State private var goal: String
    @State private var lead: String
    @State private var status: Initiative.InitiativeStatus
    @State private var startDate: Date?
    @State private var targetDate: Date?
    @State private var color: String
    @State private var icon: String

    @State private var isSaving = false
    @State private var errorMessage: String?

    init(initiative: Initiative) {
        self.initiative = initiative
        _name = State(initialValue: initiative.name)
        _description = State(initialValue: initiative.description)
        _goal = State(initialValue: initiative.goal ?? "")
        _lead = State(initialValue: initiative.lead ?? "")
        _status = State(initialValue: initiative.status)
        _color = State(initialValue: initiative.color)
        _icon = State(initialValue: initiative.icon)

        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        _startDate = State(initialValue: initiative.startDate.flatMap { dateFormatter.date(from: $0) })
        _targetDate = State(initialValue: initiative.targetDate.flatMap { dateFormatter.date(from: $0) })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Initiative Name", text: $name)

                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("Details") {
                    TextField("Goal", text: $goal, axis: .vertical)
                        .lineLimit(2...4)

                    TextField("Lead", text: $lead)

                    Picker("Status", selection: $status) {
                        ForEach(Initiative.InitiativeStatus.allCases, id: \.self) { status in
                            Text(status.displayName).tag(status)
                        }
                    }
                }

                Section("Dates") {
                    DatePicker(
                        "Start Date",
                        selection: Binding(
                            get: { startDate ?? Date() },
                            set: { startDate = $0 }
                        ),
                        displayedComponents: .date
                    )

                    DatePicker(
                        "Target Date",
                        selection: Binding(
                            get: { targetDate ?? Date() },
                            set: { targetDate = $0 }
                        ),
                        displayedComponents: .date
                    )
                }

                Section("Appearance") {
                    ColorIconPicker(
                        color: $color,
                        icon: $icon,
                        iconSet: IconSets.initiativeIcons
                    )
                }

                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Edit Initiative")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await saveChanges()
                        }
                    }
                    .disabled(name.isEmpty || isSaving)
                    .opacity(isSaving ? 0.6 : 1)
                }
            }
        }
    }

    private func saveChanges() async {
        isSaving = true
        errorMessage = nil

        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"

        var patch: [String: AnyCodable] = [
            "name": AnyCodable(name),
            "description": AnyCodable(description),
            "status": AnyCodable(status.rawValue),
            "color": AnyCodable(color),
            "icon": AnyCodable(icon),
        ]

        if !goal.isEmpty {
            patch["goal"] = AnyCodable(goal)
        }
        if !lead.isEmpty {
            patch["lead"] = AnyCodable(lead)
        }
        if let startDate {
            patch["startDate"] = AnyCodable(dateFormatter.string(from: startDate))
        }
        if let targetDate {
            patch["targetDate"] = AnyCodable(dateFormatter.string(from: targetDate))
        }

        do {
            try await initiativeStore.update(initiative.id, patch: patch)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }
}

#Preview {
    NavigationStack {
        InitiativeDetailView(initiativeId: "preview-id")
            .environment(InitiativeStore())
            .environment(ProjectStore())
    }
}
