import SwiftUI

/// Displays detailed information about a running agent
struct AgentDetailView: View {
    @Environment(WatchStore.self) private var store
    let task: WatchTask
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 6) {
            // Time display
            Text(formattedTime)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(red: 71/255, green: 85/255, blue: 105/255))
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 4)

            Spacer()

            // Header with progress ring
            VStack(alignment: .center, spacing: 4) {
                // Progress ring
                ZStack {
                    Circle()
                        .stroke(progressColor.opacity(0.3), lineWidth: 3.5)
                        .frame(width: 48, height: 48)

                    Circle()
                        .trim(from: 0, to: progressValue)
                        .stroke(progressColor, style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
                        .frame(width: 48, height: 48)
                        .rotationEffect(.degrees(-90))

                    Text("\(Int(progressValue * 100))%")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(progressColor)
                }

                // Task name
                Text(task.title)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)

                // Machine name
                Text(task.projectName ?? "Unknown")
                    .font(.system(size: 10))
                    .foregroundStyle(Color(red: 100/255, green: 116/255, blue: 139/255))
            }

            // Status row
            HStack(spacing: 6) {
                // Status badge
                HStack(spacing: 4) {
                    Circle()
                        .fill(progressColor)
                        .frame(width: 6, height: 6)
                    Text(task.status.displayName)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(progressColor)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(progressColor.opacity(0.09))
                .clipShape(RoundedRectangle(cornerRadius: 8))

                // Time badge
                HStack {
                    Text(elapsedTime)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(Color(red: 148/255, green: 163/255, blue: 184/255))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color(red: 30/255, green: 41/255, blue: 59/255))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            // Last action
            VStack(alignment: .leading, spacing: 2) {
                Text("Current Step")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(Color(red: 71/255, green: 85/255, blue: 105/255))

                Text("Working on implementation...")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Color(red: 17/255, green: 24/255, blue: 39/255))
            .clipShape(RoundedRectangle(cornerRadius: 10))

            // Action buttons
            HStack(spacing: 6) {
                // Pause button
                Button {
                    // Pause action
                } label: {
                    Image(systemName: "pause.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(.black)
                        .frame(width: 72, height: 32)
                        .background(Color(red: 245/255, green: 158/255, blue: 11/255))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)

                // Stop button
                Button {
                    // Stop action
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(.white)
                        .frame(width: 72, height: 32)
                        .background(Color(red: 239/255, green: 68/255, blue: 68/255))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
            }

            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        .navigationBarHidden(true)
    }

    private var formattedTime: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm"
        return formatter.string(from: Date())
    }

    private var progressValue: Double {
        // Mock progress based on status
        switch task.status {
        case .dispatched: return 0.2
        case .inProgress: return 0.67
        case .awaitingJudgment: return 0.95
        default: return 0.5
        }
    }

    private var progressColor: Color {
        switch task.status {
        case .inProgress: return Color(red: 59/255, green: 130/255, blue: 246/255) // accent-blue
        case .dispatched: return Color(red: 96/255, green: 165/255, blue: 250/255)
        case .awaitingJudgment: return Color(red: 245/255, green: 158/255, blue: 11/255)
        default: return Color(red: 59/255, green: 130/255, blue: 246/255)
        }
    }

    private var elapsedTime: String {
        let elapsed = Date().timeIntervalSince(task.updatedAt)
        let minutes = Int(elapsed / 60)
        if minutes < 60 {
            return "\(minutes)m"
        } else {
            let hours = minutes / 60
            return "\(hours)h"
        }
    }
}
