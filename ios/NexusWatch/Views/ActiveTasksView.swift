import SwiftUI

struct ActiveTasksView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        VStack(spacing: 8) {
            // Time display
            Text(formattedTime)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(red: 71/255, green: 85/255, blue: 105/255))
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 4)

            // Title
            Text("Agents")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Task list
            if store.activeTasks.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "tray")
                        .font(.title)
                        .foregroundStyle(.secondary)
                    Text("No Active Agents")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(store.activeTasks.prefix(3)) { task in
                            NavigationLink {
                                AgentDetailView(task: task)
                            } label: {
                                AgentRow(task: task)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        .navigationBarHidden(true)
        .refreshable {
            await store.loadActiveTasks()
        }
    }

    private var formattedTime: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm"
        return formatter.string(from: Date())
    }
}

private struct AgentRow: View {
    let task: WatchTask

    var body: some View {
        HStack(spacing: 8) {
            // Progress ring
            ZStack {
                Circle()
                    .stroke(progressColor.opacity(0.3), lineWidth: 2.5)
                    .frame(width: 28, height: 28)

                Circle()
                    .trim(from: 0, to: progressValue)
                    .stroke(progressColor, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .frame(width: 28, height: 28)
                    .rotationEffect(.degrees(-90))

                Text("\(Int(progressValue * 100))")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(progressColor)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                Text(task.projectName ?? "Unknown")
                    .font(.system(size: 9))
                    .foregroundStyle(Color(red: 71/255, green: 85/255, blue: 105/255))
                    .lineLimit(1)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color(red: 17/255, green: 24/255, blue: 39/255))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var progressValue: Double {
        // Mock progress based on status
        switch task.status {
        case .dispatched: return 0.2
        case .inProgress: return Double.random(in: 0.4...0.9)
        case .awaitingJudgment: return 0.95
        default: return 0.5
        }
    }

    private var progressColor: Color {
        switch task.status {
        case .inProgress: return Color(red: 59/255, green: 130/255, blue: 246/255) // accent-blue
        case .dispatched: return Color(red: 96/255, green: 165/255, blue: 250/255) // lighter blue
        case .awaitingJudgment: return Color(red: 50/255, green: 213/255, blue: 131/255) // accent-green
        default: return Color(red: 59/255, green: 130/255, blue: 246/255)
        }
    }
}
