import SwiftUI

// MARK: - Color Palette

struct ColorPalette {
    static let colors: [String] = [
        "#3b82f6", // blue
        "#8b5cf6", // purple
        "#ec4899", // pink
        "#ef4444", // red
        "#f97316", // orange
        "#f59e0b", // amber
        "#eab308", // yellow
        "#84cc16", // lime
        "#10b981", // green
        "#14b8a6", // teal
        "#06b6d4", // cyan
        "#0ea5e9", // sky
        "#6366f1", // indigo
        "#a855f7", // violet
        "#f43f5e", // rose
        "#64748b", // slate
    ]

    static func randomColor() -> String {
        colors.randomElement() ?? "#3b82f6"
    }
}

// MARK: - Icon Sets

struct IconSets {
    static let projectIcons: [String] = [
        "📋", "📝", "🎯", "🚀", "💡", "🔧", "⚙️", "🛠",
        "📊", "📈", "🎨", "🖥", "💻", "📱", "🌐", "🔬",
        "🧪", "🔭", "🎓", "📚", "🏗", "🏭", "🏢", "🎪",
        "🎬", "🎮", "🎲", "🧩", "🔐", "🔑"
    ]

    static let initiativeIcons: [String] = [
        "🎯", "🚀", "⭐️", "💎", "🏆", "🎖", "🎪", "🎭",
        "🎨", "🎬", "📡", "🔮", "💡", "🌟", "✨", "🔥",
        "⚡️", "🌈", "🎁", "🎉", "🎊", "🏅", "🥇", "🎓"
    ]

    static func randomProjectIcon() -> String {
        projectIcons.randomElement() ?? "📋"
    }

    static func randomInitiativeIcon() -> String {
        initiativeIcons.randomElement() ?? "🎯"
    }
}

// MARK: - Color Icon Badge

/// Compact badge displaying icon and color, can be made editable
struct ColorIconBadge: View {
    let icon: String
    let color: String
    var isEditable: Bool = false
    var onEdit: (() -> Void)?

    var body: some View {
        Button {
            onEdit?()
        } label: {
            HStack(spacing: 8) {
                Text(icon)
                    .font(.title3)

                if isEditable {
                    Image(systemName: "pencil.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(colorFromHex(color).opacity(0.15))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(colorFromHex(color), lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
        .disabled(!isEditable || onEdit == nil)
    }
}

// MARK: - Color Icon Picker

/// Full picker component with separate icon and color selectors
struct ColorIconPicker: View {
    @Binding var selectedColor: String
    @Binding var selectedIcon: String
    let iconSet: [String]

    @State private var showingIconPicker = false
    @State private var showingColorPicker = false

    init(
        color: Binding<String>,
        icon: Binding<String>,
        iconSet: [String] = IconSets.projectIcons
    ) {
        _selectedColor = color
        _selectedIcon = icon
        self.iconSet = iconSet
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Icon picker
            VStack(alignment: .leading, spacing: 8) {
                Text("Icon")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)

                Button {
                    showingIconPicker = true
                } label: {
                    HStack {
                        Text(selectedIcon)
                            .font(.title)

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                }
                .buttonStyle(.plain)
            }

            // Color picker
            VStack(alignment: .leading, spacing: 8) {
                Text("Color")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)

                Button {
                    showingColorPicker = true
                } label: {
                    HStack {
                        Circle()
                            .fill(colorFromHex( selectedColor) ?? .blue)
                            .frame(width: 24, height: 24)

                        Text(selectedColor)
                            .font(.subheadline)

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                }
                .buttonStyle(.plain)
            }
        }
        .sheet(isPresented: $showingIconPicker) {
            IconPickerSheet(selectedIcon: $selectedIcon, icons: iconSet)
        }
        .sheet(isPresented: $showingColorPicker) {
            ColorPickerSheet(selectedColor: $selectedColor)
        }
    }
}

// MARK: - Icon Picker Sheet

private struct IconPickerSheet: View {
    @Binding var selectedIcon: String
    let icons: [String]
    @Environment(\.dismiss) private var dismiss

    let columns = Array(repeating: GridItem(.flexible()), count: 6)

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(icons, id: \.self) { icon in
                        Button {
                            selectedIcon = icon
                            dismiss()
                        } label: {
                            Text(icon)
                                .font(.largeTitle)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(selectedIcon == icon ? Color.blue.opacity(0.2) : Color(.systemGray6))
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(selectedIcon == icon ? Color.blue : Color.clear, lineWidth: 2)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
            .navigationTitle("Select Icon")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Color Picker Sheet

private struct ColorPickerSheet: View {
    @Binding var selectedColor: String
    @Environment(\.dismiss) private var dismiss

    let columns = Array(repeating: GridItem(.flexible()), count: 4)

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(ColorPalette.colors, id: \.self) { color in
                        Button {
                            selectedColor = color
                            dismiss()
                        } label: {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(colorFromHex( color) ?? .blue)
                                .frame(height: 60)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(selectedColor == color ? Color.primary : Color.clear, lineWidth: 3)
                                )
                                .overlay(
                                    Group {
                                        if selectedColor == color {
                                            Image(systemName: "checkmark.circle.fill")
                                                .font(.title2)
                                                .foregroundStyle(.white)
                                                .shadow(radius: 2)
                                        }
                                    }
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
            .navigationTitle("Select Color")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Color Extension

extension Color {
    init?(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            return nil
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - Previews

#Preview("Badge") {
    VStack(spacing: 12) {
        ColorIconBadge(icon: "📋", color: "#3b82f6")
        ColorIconBadge(icon: "🎯", color: "#10b981", isEditable: true, onEdit: {})
    }
    .padding()
}

#Preview("Picker") {
    ColorIconPicker(
        color: .constant("#3b82f6"),
        icon: .constant("📋")
    )
    .padding()
}
