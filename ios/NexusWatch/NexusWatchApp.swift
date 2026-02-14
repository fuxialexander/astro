import SwiftUI

@main
struct NexusWatchApp: App {
    @State private var store = WatchStore()

    var body: some Scene {
        WindowGroup {
            WatchHomeView()
                .environment(store)
                .task {
                    await store.loadAll()
                }
        }
    }
}
