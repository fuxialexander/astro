import SwiftUI

// MARK: - Nexus Design System
// Inspired by ios.pen design with native iOS implementation

enum NexusTheme {
    // MARK: - Colors

    enum Colors {
        // Backgrounds
        static let background = colorFromHex( "0A0E1A")
        static let surface = colorFromHex( "111827")
        static let surfaceElevated = colorFromHex( "1E293B")

        // Borders & Dividers
        static let border = colorFromHex( "1E293B").opacity(0.25)
        static let borderSubtle = colorFromHex( "1E293B").opacity(0.15)

        // Status Colors
        static let statusCompleted = colorFromHex( "16A34A")
        static let statusInProgress = colorFromHex( "3B82F6")
        static let statusAwaiting = colorFromHex( "F59E0B")
        static let statusError = colorFromHex( "EF4444")
        static let statusPruned = colorFromHex( "9CA3AF")

        // Semantic
        static let primary = colorFromHex( "3B82F6")
        static let success = colorFromHex( "16A34A")
        static let warning = colorFromHex( "F59E0B")
        static let danger = colorFromHex( "EF4444")

        // Text
        static let textPrimary = Color.white
        static let textSecondary = colorFromHex( "94A3B8")
        static let textTertiary = colorFromHex( "64748B")
    }

    // MARK: - Spacing

    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 24
        static let xxxl: CGFloat = 32
    }

    // MARK: - Corner Radius

    enum CornerRadius {
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 20
        static let pill: CGFloat = 999
    }

    // MARK: - Shadows

    enum Shadow {
        static let card: (color: Color, radius: CGFloat, x: CGFloat, y: CGFloat) =
            (.black.opacity(0.15), 8, 0, 2)

        static let cardElevated: (color: Color, radius: CGFloat, x: CGFloat, y: CGFloat) =
            (.black.opacity(0.25), 16, 0, 4)

        static let floating: (color: Color, radius: CGFloat, x: CGFloat, y: CGFloat) =
            (.black.opacity(0.3), 24, 0, 8)
    }

    // MARK: - Typography

    enum Typography {
        static let largeTitle = Font.system(size: 34, weight: .bold)
        static let title1 = Font.system(size: 28, weight: .bold)
        static let title2 = Font.system(size: 22, weight: .bold)
        static let title3 = Font.system(size: 20, weight: .semibold)
        static let headline = Font.system(size: 17, weight: .semibold)
        static let body = Font.system(size: 17, weight: .regular)
        static let bodyMedium = Font.system(size: 17, weight: .medium)
        static let callout = Font.system(size: 16, weight: .regular)
        static let subheadline = Font.system(size: 15, weight: .regular)
        static let footnote = Font.system(size: 13, weight: .regular)
        static let footnoteMedium = Font.system(size: 13, weight: .medium)
        static let caption1 = Font.system(size: 12, weight: .regular)
        static let caption1Medium = Font.system(size: 12, weight: .medium)
        static let caption2 = Font.system(size: 11, weight: .regular)
        static let caption2Medium = Font.system(size: 11, weight: .medium)
    }
}

// MARK: - View Extensions

extension View {
    func nexusCard(padding: CGFloat = NexusTheme.Spacing.lg) -> some View {
        self
            .padding(padding)
            .background(NexusTheme.Colors.surface)
            .cornerRadius(NexusTheme.CornerRadius.md)
            .shadow(
                color: NexusTheme.Shadow.card.color,
                radius: NexusTheme.Shadow.card.radius,
                x: NexusTheme.Shadow.card.x,
                y: NexusTheme.Shadow.card.y
            )
    }

    func nexusCardElevated(padding: CGFloat = NexusTheme.Spacing.lg) -> some View {
        self
            .padding(padding)
            .background(NexusTheme.Colors.surface)
            .cornerRadius(NexusTheme.CornerRadius.lg)
            .shadow(
                color: NexusTheme.Shadow.cardElevated.color,
                radius: NexusTheme.Shadow.cardElevated.radius,
                x: NexusTheme.Shadow.cardElevated.x,
                y: NexusTheme.Shadow.cardElevated.y
            )
    }

    func scrollFadeOverlay() -> some View {
        self.overlay(alignment: .bottom) {
            LinearGradient(
                colors: [
                    NexusTheme.Colors.background.opacity(0),
                    NexusTheme.Colors.background.opacity(0.5),
                    NexusTheme.Colors.background
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 100)
            .allowsHitTesting(false)
        }
    }
}
