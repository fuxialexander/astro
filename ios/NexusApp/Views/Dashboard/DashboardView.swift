import SwiftUI

struct DashboardView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        // Use iPad-optimized view on larger screens
        if horizontalSizeClass == .regular {
            DashboardViewiPad()
        } else {
            DashboardViewEnhanced()
        }
    }
}

// Old components removed - now using DashboardViewEnhanced and DashboardViewiPad
