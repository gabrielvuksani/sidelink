import Foundation

#if os(iOS)
import BackgroundTasks
import UserNotifications

final class BackgroundRefreshCoordinator {
    static let shared = BackgroundRefreshCoordinator()

    private let appRefreshTaskID = "com.sidelink.ioshelper.refresh"
    private let processingTaskID = "com.sidelink.ioshelper.refresh.processing"
    private let api = APIClient()

    private init() {}

    func registerTasks() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: appRefreshTaskID, using: nil) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.handleAppRefresh(task: refreshTask)
        }

        BGTaskScheduler.shared.register(forTaskWithIdentifier: processingTaskID, using: nil) { task in
            // Keep a no-op processing task registered so the identifier remains valid.
            task.setTaskCompleted(success: true)
        }
    }

    func setBackgroundRefreshEnabled(_ enabled: Bool) {
        if enabled {
            scheduleAppRefresh()
        } else {
            cancelScheduledRefresh()
        }
    }

    func requestNotificationAuthorizationIfNeeded() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound])
        }
    }

    func scheduleAppRefresh() {
        let defaults = UserDefaults.standard
        let enabled = defaults.object(forKey: "backgroundRefreshEnabled") as? Bool ?? true
        guard enabled else {
            cancelScheduledRefresh()
            return
        }

        cancelScheduledRefresh()

        let intervalMinutes = defaults.object(forKey: "backgroundRefreshIntervalMinutes") as? Int ?? 30
        let request = BGAppRefreshTaskRequest(identifier: appRefreshTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: TimeInterval(max(15, intervalMinutes) * 60))

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // iOS may reject duplicate/pending requests; this is expected.
        }
    }

    private func cancelScheduledRefresh() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: appRefreshTaskID)
    }

    private func handleAppRefresh(task: BGAppRefreshTask) {
        scheduleAppRefresh()

        let refreshTask = Task {
            let success = await performRefreshCycle()
            task.setTaskCompleted(success: success)
        }

        task.expirationHandler = {
            refreshTask.cancel()
        }
    }

    private func performRefreshCycle() async -> Bool {
        let defaults = UserDefaults.standard
        let backendURL = defaults.string(forKey: "backendURL") ?? ""
        let helperToken = KeychainStore.get("helperToken") ?? ""

        guard !backendURL.isEmpty, !helperToken.isEmpty else {
            return false
        }

        do {
            let states = try await api.listAutoRefreshStates(baseURL: backendURL, token: helperToken)
            let candidates = states.filter { $0.needsRefresh && !$0.refreshInProgress }
            var refreshedApps: [String] = []

            for state in candidates {
                if Task.isCancelled {
                    return false
                }
                try await api.triggerRefresh(baseURL: backendURL, token: helperToken, installId: state.installedAppId)
                refreshedApps.append(state.appName)
            }

            if !refreshedApps.isEmpty {
                await postRefreshNotification(refreshedApps)
            }

            return true
        } catch {
            await postRefreshFailureNotification(error)
            return false
        }
    }

    private func postRefreshNotification(_ apps: [String]) async {
        let center = UNUserNotificationCenter.current()
        await requestNotificationAuthorizationIfNeeded()

        let content = UNMutableNotificationContent()
        content.title = "SideLink refreshed apps"
        content.body = apps.count == 1 ? "\(apps[0]) was refreshed." : "\(apps.count) apps were refreshed."
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "sidelink.refresh.\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }

    private func postRefreshFailureNotification(_ error: Error) async {
        let center = UNUserNotificationCenter.current()
        await requestNotificationAuthorizationIfNeeded()

        let content = UNMutableNotificationContent()
        content.title = "SideLink refresh failed"
        content.body = error.localizedDescription
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "sidelink.refresh.failure.\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }
}
#else
final class BackgroundRefreshCoordinator {
    static let shared = BackgroundRefreshCoordinator()
    func registerTasks() {}
    func setBackgroundRefreshEnabled(_ enabled: Bool) {}
    func requestNotificationAuthorizationIfNeeded() async {}
    func scheduleAppRefresh() {}
}
#endif
