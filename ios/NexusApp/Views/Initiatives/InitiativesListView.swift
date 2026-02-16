import SwiftUI

struct InitiativesListView: View {
    @Environment(InitiativeStore.self) private var initiativeStore
    @State private var showingNewInitiative = false
    @State private var searchText = ""

    private var filteredInitiatives: [Initiative] {
        if searchText.isEmpty {
            return initiativeStore.initiatives
        }
        return initiativeStore.initiatives.filter { initiative in
            initiative.name.localizedCaseInsensitiveContains(searchText) ||
            initiative.description.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if filteredInitiatives.isEmpty {
                    ContentUnavailableView(
                        searchText.isEmpty ? "No Initiatives" : "No Results",
                        systemImage: searchText.isEmpty ? "target" : "magnifyingglass",
                        description: Text(searchText.isEmpty ? "Create your first initiative to get started" : "Try a different search term")
                    )
                    .frame(height: 300)
                } else {
                    ForEach(filteredInitiatives) { initiative in
                        NavigationLink(value: initiative) {
                            InitiativeRow(initiative: initiative)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Initiatives")
        .searchable(text: $searchText, prompt: "Search initiatives")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingNewInitiative = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showingNewInitiative) {
            NewInitiativeSheet()
        }
        .navigationDestination(for: Initiative.self) { initiative in
            InitiativeDetailView(initiativeId: initiative.id)
        }
        .refreshable {
            await initiativeStore.refresh()
        }
        .task {
            await initiativeStore.loadIfNeeded()
        }
    }
}

// MARK: - Initiative Row

private struct InitiativeRow: View {
    let initiative: Initiative

    var body: some View {
        HStack(spacing: 12) {
            // Icon with color accent
            VStack {
                Text(initiative.icon)
                    .font(.title2)
                Spacer()
            }
            .frame(width: 44, height: 44)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(colorFromHex(initiative.color).opacity(0.15))
            )

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(initiative.name)
                        .font(.headline)
                        .foregroundStyle(.primary)

                    Spacer()

                    // Status badge
                    Text(initiative.status.displayName)
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule()
                                .fill(Color(initiative.status.color).opacity(0.2))
                        )
                        .foregroundStyle(Color(initiative.status.color))
                }

                if !initiative.description.isEmpty {
                    Text(initiative.description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                // Metadata
                HStack(spacing: 12) {
                    if let startDate = initiative.startDate {
                        Label(startDate, systemImage: "calendar")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let lead = initiative.lead {
                        Label(lead, systemImage: "person")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(12)
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 2, x: 0, y: 1)
    }
}

// MARK: - New Initiative Sheet

private struct NewInitiativeSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(InitiativeStore.self) private var initiativeStore

    @State private var name = ""
    @State private var description = ""
    @State private var goal = ""
    @State private var lead = ""
    @State private var status: Initiative.InitiativeStatus = .active
    @State private var startDate: Date?
    @State private var targetDate: Date?
    @State private var color = ColorPalette.randomColor()
    @State private var icon = IconSets.randomInitiativeIcon()

    @State private var isSaving = false
    @State private var errorMessage: String?

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
            .navigationTitle("New Initiative")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            await createInitiative()
                        }
                    }
                    .disabled(name.isEmpty || isSaving)
                    .opacity(isSaving ? 0.6 : 1)
                }
            }
        }
    }

    private func createInitiative() async {
        isSaving = true
        errorMessage = nil

        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"

        let initiative = Initiative(
            id: UUID().uuidString,
            name: name,
            description: description,
            projectIds: [],
            status: status,
            icon: icon,
            color: color,
            goal: goal.isEmpty ? nil : goal,
            lead: lead.isEmpty ? nil : lead,
            startDate: startDate.map { dateFormatter.string(from: $0) },
            targetDate: targetDate.map { dateFormatter.string(from: $0) },
            createdAt: Date(),
            updatedAt: Date()
        )

        do {
            try await initiativeStore.create(initiative)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }
}

#Preview {
    NavigationStack {
        InitiativesListView()
            .environment(InitiativeStore())
    }
}
