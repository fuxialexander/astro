import SwiftUI

/// iPad-optimized plan graph view (placeholder - uses regular ProjectDetailView for now)
struct PlanGraphViewiPad: View {
    let projectId: String
    
    var body: some View {
        ProjectDetailView(projectId: projectId)
    }
}
