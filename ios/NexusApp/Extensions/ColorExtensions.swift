import SwiftUI

// MARK: - Accent Colors from ios.pen

extension Color {
    // Accent colors matching ios.pen design
    static let nexusBlue = Color(hex: "3B82F6")        // Primary blue - active states, progress, links
    static let nexusGreen = Color(hex: "16A34A")       // Success - completed tasks
    static let nexusGreenLight = Color(hex: "22C55E")  // Success variant
    static let nexusAmber = Color(hex: "F59E0B")       // Warning - pending states, awaiting judgment

    // Glass effect helpers
    static let glassStroke = Color.white.opacity(0.2)
    static let glassShadow = Color.black.opacity(0.1)
}

// MARK: - Hex Initializer

extension Color {
    init(hex: String) {
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
            (a, r, g, b) = (255, 0, 0, 0)
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

// MARK: - Glass Background Modifier

struct GlassCard: ViewModifier {
    var cornerRadius: CGFloat = 16
    var material: Material = .ultraThinMaterial
    var shadowRadius: CGFloat = 20
    var shadowY: CGFloat = 10

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(material)
                    .shadow(color: .glassShadow, radius: shadowRadius, x: 0, y: shadowY)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .strokeBorder(.glassStroke, lineWidth: 1)
            )
    }
}

extension View {
    func glassCard(cornerRadius: CGFloat = 16, material: Material = .ultraThinMaterial, shadowRadius: CGFloat = 20, shadowY: CGFloat = 10) -> some View {
        modifier(GlassCard(cornerRadius: cornerRadius, material: material, shadowRadius: shadowRadius, shadowY: shadowY))
    }
}

// MARK: - Glow Effect Modifier

struct GlowEffect: ViewModifier {
    let color: Color
    let radius: CGFloat

    func body(content: Content) -> some View {
        content
            .shadow(color: color.opacity(0.5), radius: radius, x: 0, y: 0)
            .shadow(color: color.opacity(0.3), radius: radius * 1.5, x: 0, y: 0)
    }
}

extension View {
    func glow(color: Color, radius: CGFloat = 8) -> some View {
        modifier(GlowEffect(color: color, radius: radius))
    }
}
