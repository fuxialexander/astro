import SwiftUI

/// Displays plan progress with milestone breakdown
struct PlanProgressView: View {
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
            Text("Nexus Platform")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Overall progress bar
            HStack(spacing: 8) {
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color(red: 30/255, green: 41/255, blue: 59/255))
                        .frame(height: 6)

                    RoundedRectangle(cornerRadius: 3)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 96/255, green: 165/255, blue: 250/255),
                                    Color(red: 59/255, green: 130/255, blue: 246/255)
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: CGFloat(overallProgress) * (174 - 8 - 30), height: 6)
                }

                Text("\(Int(overallProgress * 100))%")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color(red: 59/255, green: 130/255, blue: 246/255))
                    .monospacedDigit()
            }

            // Milestone list
            ScrollView {
                VStack(spacing: 8) {
                    MilestoneRow(
                        name: "M1: Core Planning",
                        completed: 4,
                        total: 6,
                        color: Color(red: 50/255, green: 213/255, blue: 131/255)
                    )

                    MilestoneRow(
                        name: "M2: User Interface",
                        completed: 1,
                        total: 5,
                        color: Color(red: 245/255, green: 158/255, blue: 11/255)
                    )

                    MilestoneRow(
                        name: "M3: API Integration",
                        completed: 0,
                        total: 4,
                        color: Color(red: 156/255, green: 163/255, blue: 175/255)
                    )
                }
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

    private var overallProgress: Double {
        return 0.64
    }
}

private struct MilestoneRow: View {
    let name: String
    let completed: Int
    let total: Int
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            // Header
            HStack {
                Text(name)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(color)

                Spacer()

                Text("\(completed)/\(total)")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(Color(red: 71/255, green: 85/255, blue: 105/255))
            }

            // Progress bar
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(red: 30/255, green: 41/255, blue: 59/255))
                    .frame(height: 4)

                if completed > 0 {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(color)
                        .frame(width: progress * (174 - 24 - 20), height: 4)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color(red: 17/255, green: 24/255, blue: 39/255))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var progress: Double {
        guard total > 0 else { return 0 }
        return Double(completed) / Double(total)
    }
}
