import WidgetKit
import SwiftUI

// MARK: - Widget Timeline Provider

struct NexusWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> NexusWidgetEntry {
        NexusWidgetEntry(
            date: .now,
            projectName: "Nexus Platform",
            planProgress: 64,
            pendingDecisions: 3,
            activeAgents: [
                AgentInfo(name: "frontend-builder", progress: 67, color: .blue),
                AgentInfo(name: "api-integrator", progress: 82, color: .green),
                AgentInfo(name: "test-runner", progress: 41, color: .orange)
            ],
            milestones: [
                MilestoneInfo(name: "Core Planning", completed: 4, total: 6, color: .green),
                MilestoneInfo(name: "User Interface", completed: 1, total: 5, color: .blue),
                MilestoneInfo(name: "API Integration", completed: 0, total: 4, color: .gray)
            ]
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (NexusWidgetEntry) -> Void) {
        completion(placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NexusWidgetEntry>) -> Void) {
        Task {
            let entry = await fetchCurrentData()
            let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: .now)!
            let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
            completion(timeline)
        }
    }

    private func fetchCurrentData() async -> NexusWidgetEntry {
        // Read server URL from shared UserDefaults (App Group)
        let serverURL = UserDefaults(suiteName: "group.com.nexus.app")?.string(forKey: "nexus.serverURL") ?? "http://localhost:3001"

        do {
            // Fetch dashboard data
            let dashboardURL = URL(string: "\(serverURL)/api/data/dashboard")!
            let (data, _) = try await URLSession.shared.data(from: dashboardURL)
            let dashboard = try JSONDecoder().decode(WidgetDashboardData.self, from: data)

            // Convert to widget entry
            return NexusWidgetEntry(
                date: .now,
                projectName: dashboard.activeProject?.name ?? "Nexus",
                planProgress: dashboard.planProgress,
                pendingDecisions: dashboard.pendingDecisions,
                activeAgents: dashboard.activeAgents.map { agent in
                    AgentInfo(
                        name: agent.name,
                        progress: agent.progress,
                        color: colorForStatus(agent.status)
                    )
                },
                milestones: dashboard.milestones.map { milestone in
                    MilestoneInfo(
                        name: milestone.name,
                        completed: milestone.completed,
                        total: milestone.total,
                        color: milestone.completed == milestone.total ? .green :
                               milestone.completed > 0 ? .blue : .gray
                    )
                }
            )
        } catch {
            // Return fallback data on error
            return NexusWidgetEntry(
                date: .now,
                projectName: "Nexus Platform",
                planProgress: 0,
                pendingDecisions: 0,
                activeAgents: [],
                milestones: []
            )
        }
    }

    private func colorForStatus(_ status: String) -> Color {
        switch status {
        case "in_progress": return .blue
        case "completed": return .green
        case "awaiting_judgment": return .orange
        default: return .gray
        }
    }
}

// MARK: - Timeline Entry

struct NexusWidgetEntry: TimelineEntry {
    let date: Date
    let projectName: String
    let planProgress: Int
    let pendingDecisions: Int
    let activeAgents: [AgentInfo]
    let milestones: [MilestoneInfo]
}

struct AgentInfo {
    let name: String
    let progress: Int
    let color: Color
}

struct MilestoneInfo {
    let name: String
    let completed: Int
    let total: Int
    let color: Color
}

// MARK: - Widget Views

struct NexusWidgetView: View {
    let entry: NexusWidgetEntry
    @SwiftUI.Environment(\.widgetFamily) var family
    @SwiftUI.Environment(\.colorScheme) var colorScheme

    var body: some View {
        switch family {
        case .systemSmall:
            SmallWidgetView(entry: entry, colorScheme: colorScheme)
        case .systemMedium:
            MediumWidgetView(entry: entry, colorScheme: colorScheme)
        case .systemLarge:
            LargeWidgetView(entry: entry, colorScheme: colorScheme)
        case .systemExtraLarge:
            ExtraLargeWidgetView(entry: entry, colorScheme: colorScheme)
        @unknown default:
            MediumWidgetView(entry: entry, colorScheme: colorScheme)
        }
    }
}

// MARK: - Small Widget (Decisions)

struct SmallWidgetView: View {
    let entry: NexusWidgetEntry
    let colorScheme: ColorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Top section with logo and badge
            HStack(alignment: .center, spacing: 0) {
                // Logo
                ZStack {
                    LinearGradient(
                        colors: [Color(hex: "60A5FA"), Color(hex: "3B82F6"), Color(hex: "2563EB")],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .cornerRadius(8)

                    Image(systemName: "hexagon.fill")
                        .font(.system(size: 14))
                        .foregroundColor(.white)
                }
                .frame(width: 28, height: 28)

                Spacer()

                // Status badge
                HStack(spacing: 4) {
                    Circle()
                        .fill(Color(hex: "F59E0B"))
                        .frame(width: 6, height: 6)

                    Text("Waiting")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(Color(hex: "F59E0B"))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color(hex: "F59E0B").opacity(0.1))
                .cornerRadius(8)
            }

            Spacer()

            // Bottom section with count
            VStack(alignment: .leading, spacing: 2) {
                Text("\(entry.pendingDecisions)")
                    .font(.system(size: 36, weight: .bold, design: .default))
                    .foregroundColor(colorScheme == .dark ? Color(hex: "F1F5F9") : Color(hex: "1E293B"))

                Text("Decisions")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(Color(hex: "64748B"))
            }
        }
        .padding(16)
        .background(colorScheme == .dark ? Color(hex: "111827") : .white)
        .cornerRadius(22)
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .strokeBorder(colorScheme == .dark ? Color.clear : Color(hex: "E2E8F0"), lineWidth: 1)
        )
    }
}

// MARK: - Medium Widget (Active Agents)

struct MediumWidgetView: View {
    let entry: NexusWidgetEntry
    let colorScheme: ColorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack(alignment: .center, spacing: 0) {
                // Logo
                HStack(spacing: 8) {
                    ZStack {
                        LinearGradient(
                            colors: [Color(hex: "60A5FA"), Color(hex: "3B82F6"), Color(hex: "2563EB")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                        .cornerRadius(6)

                        Image(systemName: "hexagon.fill")
                            .font(.system(size: 12))
                            .foregroundColor(.white)
                    }
                    .frame(width: 24, height: 24)

                    Text("Nexus")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(colorScheme == .dark ? Color(hex: "F1F5F9") : Color(hex: "1E293B"))
                }

                Spacer()

                // Badge
                HStack(spacing: 4) {
                    Circle()
                        .fill(Color(hex: "F59E0B"))
                        .frame(width: 6, height: 6)

                    Text("\(entry.pendingDecisions) Decisions")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(Color(hex: "F59E0B"))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color(hex: "F59E0B").opacity(0.1))
                .cornerRadius(8)
            }

            // Agent list
            VStack(spacing: 6) {
                ForEach(Array(entry.activeAgents.prefix(3).enumerated()), id: \.offset) { index, agent in
                    AgentRowMedium(agent: agent, colorScheme: colorScheme)
                }
            }
        }
        .padding(16)
        .background(colorScheme == .dark ? Color(hex: "111827") : .white)
        .cornerRadius(22)
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .strokeBorder(colorScheme == .dark ? Color.clear : Color(hex: "E2E8F0"), lineWidth: 1)
        )
    }
}

// MARK: - Large Widget

struct LargeWidgetView: View {
    let entry: NexusWidgetEntry
    let colorScheme: ColorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack(alignment: .center, spacing: 0) {
                HStack(spacing: 8) {
                    ZStack {
                        LinearGradient(
                            colors: [Color(hex: "3B82F6"), Color(hex: "1D4ED8")],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .cornerRadius(6)

                        Image(systemName: "hexagon.fill")
                            .font(.system(size: 14))
                            .foregroundColor(.white)
                    }
                    .frame(width: 24, height: 24)

                    Text("Nexus")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(colorScheme == .dark ? Color(hex: "F1F5F9") : Color(hex: "1E293B"))
                }

                Spacer()

                // Badge
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 10))
                        .foregroundColor(Color(hex: "F59E0B"))

                    Text("\(entry.pendingDecisions) Decisions")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(Color(hex: "F59E0B"))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color(hex: "7C2D12").opacity(0.13))
                .cornerRadius(8)
            }

            Divider()
                .background(colorScheme == .dark ? Color(hex: "1E293B") : Color(hex: "E2E8F0"))

            // Plan Progress section
            VStack(alignment: .leading, spacing: 8) {
                Text("Plan Progress")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.3)
                    .foregroundColor(Color(hex: "64748B"))

                HStack {
                    Text(entry.projectName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(colorScheme == .dark ? Color(hex: "E2E8F0") : Color(hex: "1E293B"))

                    Spacer()

                    Text("\(entry.planProgress)%")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Color(hex: "22C55E"))
                }

                // Progress bar
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(colorScheme == .dark ? Color(hex: "1E293B") : Color(hex: "E2E8F0"))
                            .frame(height: 6)

                        RoundedRectangle(cornerRadius: 3)
                            .fill(LinearGradient(
                                colors: [Color(hex: "22C55E"), Color(hex: "16A34A")],
                                startPoint: .top,
                                endPoint: .bottom
                            ))
                            .frame(width: geometry.size.width * CGFloat(entry.planProgress) / 100, height: 6)
                    }
                }
                .frame(height: 6)

                // Milestones
                VStack(spacing: 5) {
                    ForEach(Array(entry.milestones.prefix(3).enumerated()), id: \.offset) { index, milestone in
                        MilestoneRow(milestone: milestone)
                    }
                }
            }

            Divider()
                .background(colorScheme == .dark ? Color(hex: "1E293B") : Color(hex: "E2E8F0"))

            // Active Agents section
            VStack(alignment: .leading, spacing: 8) {
                Text("Active Agents")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.3)
                    .foregroundColor(Color(hex: "64748B"))

                ForEach(Array(entry.activeAgents.prefix(3).enumerated()), id: \.offset) { index, agent in
                    AgentRowLarge(agent: agent)
                }
            }
        }
        .padding(16)
        .background(colorScheme == .dark ? Color(hex: "111827") : .white)
        .cornerRadius(22)
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .strokeBorder(colorScheme == .dark ? Color.clear : Color(hex: "E2E8F0"), lineWidth: 1)
        )
    }
}

// MARK: - Extra Large Widget (iPad)

struct ExtraLargeWidgetView: View {
    let entry: NexusWidgetEntry
    let colorScheme: ColorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Header
            HStack(alignment: .center, spacing: 0) {
                HStack(spacing: 10) {
                    ZStack {
                        LinearGradient(
                            colors: [Color(hex: "3B82F6"), Color(hex: "1D4ED8")],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .cornerRadius(7)

                        Image(systemName: "hexagon.fill")
                            .font(.system(size: 16))
                            .foregroundColor(.white)
                    }
                    .frame(width: 28, height: 28)

                    Text("Nexus")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(colorScheme == .dark ? Color(hex: "F1F5F9") : Color(hex: "1E293B"))

                    Text(entry.projectName)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Color(hex: "64748B"))
                }

                Spacer()

                // Badges
                HStack(spacing: 8) {
                    HStack(spacing: 5) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 12))
                            .foregroundColor(Color(hex: "F59E0B"))

                        Text("\(entry.pendingDecisions) Decisions")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(Color(hex: "F59E0B"))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color(hex: "F59E0B").opacity(0.08))
                    .cornerRadius(8)

                    HStack(spacing: 5) {
                        Image(systemName: "cpu")
                            .font(.system(size: 12))
                            .foregroundColor(Color(hex: "3B82F6"))

                        Text("\(entry.activeAgents.count) Agents")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(Color(hex: "3B82F6"))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color(hex: "3B82F6").opacity(0.08))
                    .cornerRadius(8)
                }
            }

            Divider()
                .background(colorScheme == .dark ? Color(hex: "1E293B") : Color(hex: "E2E8F0"))

            // Body with two columns
            HStack(alignment: .top, spacing: 20) {
                // Left: Plan Progress
                VStack(alignment: .leading, spacing: 12) {
                    Text("Plan Progress")
                        .font(.system(size: 12, weight: .semibold))
                        .tracking(0.3)
                        .foregroundColor(Color(hex: "64748B"))

                    HStack {
                        Text("Overall Progress")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(colorScheme == .dark ? Color(hex: "E2E8F0") : Color(hex: "1E293B"))

                        Spacer()

                        Text("\(entry.planProgress)%")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(Color(hex: "22C55E"))
                    }

                    // Progress bar
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(colorScheme == .dark ? Color(hex: "1E293B") : Color(hex: "E2E8F0"))
                                .frame(height: 8)

                            RoundedRectangle(cornerRadius: 4)
                                .fill(LinearGradient(
                                    colors: [Color(hex: "22C55E"), Color(hex: "16A34A")],
                                    startPoint: .top,
                                    endPoint: .bottom
                                ))
                                .frame(width: geometry.size.width * CGFloat(entry.planProgress) / 100, height: 8)
                        }
                    }
                    .frame(height: 8)

                    // Milestones
                    VStack(spacing: 8) {
                        ForEach(Array(entry.milestones.prefix(3).enumerated()), id: \.offset) { index, milestone in
                            MilestoneCardXL(milestone: milestone, colorScheme: colorScheme)
                        }
                    }

                    Spacer()
                }
                .frame(maxWidth: .infinity)

                // Right: Active Agents
                VStack(alignment: .leading, spacing: 12) {
                    Text("Active Agents")
                        .font(.system(size: 12, weight: .semibold))
                        .tracking(0.3)
                        .foregroundColor(Color(hex: "64748B"))

                    ForEach(Array(entry.activeAgents.prefix(3).enumerated()), id: \.offset) { index, agent in
                        AgentRowXL(agent: agent, colorScheme: colorScheme)
                    }

                    Spacer()
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(20)
        .background(colorScheme == .dark ? Color(hex: "111827") : .white)
        .cornerRadius(22)
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .strokeBorder(colorScheme == .dark ? Color.clear : Color(hex: "E2E8F0"), lineWidth: 1)
        )
    }
}

// MARK: - Component Views

struct AgentRowMedium: View {
    let agent: AgentInfo
    let colorScheme: ColorScheme

    var body: some View {
        HStack(spacing: 8) {
            // Progress ring
            ZStack {
                Circle()
                    .stroke(agent.color.opacity(0.3), lineWidth: 2)
                    .frame(width: 24, height: 24)

                Text("\(agent.progress)")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundColor(agent.color)
            }

            Text(agent.name)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(colorScheme == .dark ? Color(hex: "F1F5F9") : Color(hex: "1E293B"))

            Spacer()

            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(colorScheme == .dark ? Color(hex: "1E293B") : Color(hex: "E2E8F0"))
                        .frame(width: 60, height: 4)

                    RoundedRectangle(cornerRadius: 2)
                        .fill(agent.color)
                        .frame(width: 60 * CGFloat(agent.progress) / 100, height: 4)
                }
            }
            .frame(width: 60, height: 4)
        }
    }
}

struct AgentRowLarge: View {
    let agent: AgentInfo

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .stroke(agent.color, lineWidth: 3)
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 1) {
                Text(agent.name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color(hex: "E2E8F0"))

                Text("Running · \(agent.progress)%")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(agent.color)
            }

            Spacer()
        }
    }
}

struct AgentRowXL: View {
    let agent: AgentInfo
    let colorScheme: ColorScheme

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .stroke(agent.color, lineWidth: 3)
                .frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: 2) {
                Text(agent.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(colorScheme == .dark ? Color(hex: "E2E8F0") : Color(hex: "1E293B"))

                Text("Running · \(agent.progress)%")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(agent.color)
            }

            Spacer()

            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(colorScheme == .dark ? Color(hex: "1E293B") : Color(hex: "E2E8F0"))
                        .frame(width: 60, height: 4)

                    RoundedRectangle(cornerRadius: 2)
                        .fill(agent.color)
                        .frame(width: 60 * CGFloat(agent.progress) / 100, height: 4)
                }
            }
            .frame(width: 60, height: 4)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(colorScheme == .dark ? Color(hex: "0D1117").opacity(0.5) : Color(hex: "F1F5F9"))
        .cornerRadius(10)
    }
}

struct MilestoneRow: View {
    let milestone: MilestoneInfo

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(milestone.color)
                .frame(width: 6, height: 6)

            Text(milestone.name)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(Color(hex: "94A3B8"))

            Spacer()

            Text("\(milestone.completed)/\(milestone.total)")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(Color(hex: "64748B"))
        }
    }
}

struct MilestoneCardXL: View {
    let milestone: MilestoneInfo
    let colorScheme: ColorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Circle()
                    .fill(milestone.color)
                    .frame(width: 6, height: 6)

                Text(milestone.name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(colorScheme == .dark ? Color(hex: "94A3B8") : Color(hex: "64748B"))

                Spacer()

                Text("\(milestone.completed)/\(milestone.total)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color(hex: "64748B"))
            }

            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(colorScheme == .dark ? Color(hex: "1E293B") : Color(hex: "E2E8F0"))
                        .frame(height: 4)

                    if milestone.total > 0 {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(milestone.color)
                            .frame(width: geometry.size.width * CGFloat(milestone.completed) / CGFloat(milestone.total), height: 4)
                    }
                }
            }
            .frame(height: 4)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(colorScheme == .dark ? Color(hex: "0D1117").opacity(0.5) : Color(hex: "F1F5F9"))
        .cornerRadius(8)
    }
}

// MARK: - Widget Configuration

struct NexusProgressWidget: Widget {
    let kind = "NexusProgressWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NexusWidgetProvider()) { entry in
            NexusWidgetView(entry: entry)
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("Nexus Progress")
        .description("Track your project progress, decisions, and active agents.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
    }
}

// MARK: - Data models for widget

private struct WidgetDashboardData: Codable {
    var activeProject: ActiveProject?
    var planProgress: Int
    var pendingDecisions: Int
    var activeAgents: [ActiveAgent]
    var milestones: [Milestone]

    struct ActiveProject: Codable {
        var name: String
    }

    struct ActiveAgent: Codable {
        var name: String
        var progress: Int
        var status: String
    }

    struct Milestone: Codable {
        var name: String
        var completed: Int
        var total: Int
    }
}

// MARK: - Helper Extension

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
