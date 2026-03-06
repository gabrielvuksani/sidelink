import SwiftUI

@main
struct SidelinkHelperApp: App {
    @Environment(\.scenePhase) private var scenePhase

    init() {
        BackgroundRefreshCoordinator.shared.registerTasks()
        BackgroundRefreshCoordinator.shared.scheduleAppRefresh()
    }

    var body: some Scene {
        WindowGroup {
            SidelinkAppRootView()
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                BackgroundRefreshCoordinator.shared.scheduleAppRefresh()
            }
        }
    }
}
