import SwiftUI

struct VisionDocEditor: View {
    let projectId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(ProjectStore.self) private var projectStore

    @State private var text = ""
    @State private var isSaving = false

    private var project: Project? {
        projectStore.project(id: projectId)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TextEditor(text: $text)
                    .font(.body)
                    .padding()
            }
            .navigationTitle("Vision Document")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                    }
                    .disabled(isSaving)
                }
            }
        }
        .onAppear {
            text = project?.visionDoc ?? ""
        }
    }

    private func save() {
        isSaving = true
        Task {
            try? await projectStore.updateProject(projectId, patch: [
                "visionDoc": AnyCodable(text),
            ])
            isSaving = false
            dismiss()
        }
    }
}
