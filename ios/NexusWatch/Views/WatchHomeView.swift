import SwiftUI

struct WatchHomeView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        NavigationStack {
            VStack(spacing: 10) {
                // Decisions card
                NavigationLink {
                    DecisionListView()
                } label: {
                    HomeCard(
                        icon: "exclamationmark.triangle.fill",
                        iconColor: Color(red: 245/255, green: 158/255, blue: 11/255), // accent-amber
                        number: "\(store.stats.pendingDecisions) Decisions",
                        subtitle: "Waiting",
                        backgroundColor: Color(red: 245/255, green: 158/255, blue: 11/255).opacity(0.09)
                    )
                }
                .buttonStyle(.plain)

                // Agents card
                NavigationLink {
                    ActiveTasksView()
                } label: {
                    HomeCard(
                        icon: "cpu",
                        iconColor: Color(red: 59/255, green: 130/255, blue: 246/255), // accent-blue
                        number: "\(store.stats.activeTasks) Agents",
                        subtitle: "Running",
                        backgroundColor: Color(red: 59/255, green: 130/255, blue: 246/255).opacity(0.09)
                    )
                }
                .buttonStyle(.plain)

                // Completed card
                HomeCard(
                    icon: "checkmark.circle.fill",
                    iconColor: Color(red: 50/255, green: 213/255, blue: 131/255), // accent-green
                    number: "\(store.stats.tasksCompleted) Done",
                    subtitle: "Today",
                    backgroundColor: Color(red: 22/255, green: 163/255, blue: 74/255).opacity(0.09)
                )

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 16)
            .background(Color.black)
            .navigationBarHidden(true)
            .refreshable {
                await store.loadAll()
            }
            .overlay(alignment: .top) {
                // Time display
                Text(formattedTime)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color(red: 71/255, green: 85/255, blue: 105/255))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
            }
            .overlay {
                if store.isLoading && store.decisions.isEmpty && store.activeTasks.isEmpty {
                    ProgressView("Loading...")
                }
            }
        }
    }

    private var formattedTime: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm"
        return formatter.string(from: Date())
    }
}

private struct HomeCard: View {
    let icon: String
    let iconColor: Color
    let number: String
    let subtitle: String
    let backgroundColor: Color

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 22))
                .foregroundStyle(iconColor)
                .frame(width: 22, height: 22)

            VStack(alignment: .leading, spacing: 2) {
                Text(number)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(iconColor.opacity(0.5))
            }

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .frame(height: 54)
        .padding(.horizontal, 14)
        .background(backgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
