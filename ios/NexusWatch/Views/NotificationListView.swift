import SwiftUI

/// Displays recent notifications in a compact Watch UI
struct NotificationListView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        VStack(spacing: 6) {
            // Time display
            Text(formattedTime)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(red: 71/255, green: 85/255, blue: 105/255))
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 4)

            // Title
            Text("Recent")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Notification list
            ScrollView {
                VStack(spacing: 6) {
                    // Mock notifications - in real app, fetch from store
                    NotificationRow(
                        icon: "checkmark.circle.fill",
                        iconColor: Color(red: 50/255, green: 213/255, blue: 131/255),
                        title: "Auth flow completed",
                        subtitle: "2m ago",
                        backgroundColor: Color(red: 22/255, green: 163/255, blue: 74/255).opacity(0.09)
                    )

                    NotificationRow(
                        icon: "exclamationmark.triangle.fill",
                        iconColor: Color(red: 245/255, green: 158/255, blue: 11/255),
                        title: "Decision needed",
                        subtitle: "Token strategy • 5m",
                        backgroundColor: Color(red: 245/255, green: 158/255, blue: 11/255).opacity(0.09)
                    )

                    NotificationRow(
                        icon: "cpu",
                        iconColor: Color(red: 59/255, green: 130/255, blue: 246/255),
                        title: "Agent paused",
                        subtitle: "Rate limiter • 12m",
                        backgroundColor: Color(red: 59/255, green: 130/255, blue: 246/255).opacity(0.09)
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
}

private struct NotificationRow: View {
    let icon: String
    let iconColor: Color
    let title: String
    let subtitle: String
    let backgroundColor: Color

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(iconColor)
                .frame(width: 16, height: 16)

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                Text(subtitle)
                    .font(.system(size: 9))
                    .foregroundStyle(Color(red: 71/255, green: 85/255, blue: 105/255))
                    .lineLimit(1)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(backgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
