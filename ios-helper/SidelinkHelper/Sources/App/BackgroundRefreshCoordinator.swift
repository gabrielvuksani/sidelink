import Foundation

struct BackgroundRefreshAttemptSummary: Codable {
    let pairingIdentityID: String
    let attemptedAt: String
    let candidates: Int
    let requested: Int
    let failed: Int
    let cancelled: Bool
}

#if os(iOS)
import BackgroundTasks
import UserNotifications

protocol BackgroundRefreshNotificationCenter: AnyObject {
    func requestAuthorizationIfNeeded() async
    func add(_ request: UNNotificationRequest) async throws
    func removePendingNotificationRequests(withIdentifiers identifiers: [String]) async
    func removeDeliveredNotifications(withIdentifiers identifiers: [String]) async
}

private final class SystemBackgroundRefreshNotificationCenter: BackgroundRefreshNotificationCenter {
    private let center = UNUserNotificationCenter.current()

    func requestAuthorizationIfNeeded() async {
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound])
        }
    }

    func add(_ request: UNNotificationRequest) async throws {
        try await center.add(request)
    }

    func removePendingNotificationRequests(withIdentifiers identifiers: [String]) async {
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
    }

    func removeDeliveredNotifications(withIdentifiers identifiers: [String]) async {
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }
}

final class BackgroundRefreshCoordinator {
    static let shared = BackgroundRefreshCoordinator()

    private let appRefreshTaskID = "com.sidelink.ioshelper.refresh"
    private let processingTaskID = "com.sidelink.ioshelper.refresh.processing"
    private let attemptSummaryKey = "backgroundRefreshLastAttemptSummary"
    private let api: APIClient
    private let notificationCenter: any BackgroundRefreshNotificationCenter
    private let loadStoredPairingIdentity: () -> PairingCredentialStorage.StoredIdentity?
    private let revokeStoredPairingIdentity: (PairingCredentialStorage.StoredIdentity) -> Bool

    init(
        api: APIClient = APIClient(),
        notificationCenter: any BackgroundRefreshNotificationCenter = SystemBackgroundRefreshNotificationCenter(),
        loadStoredPairingIdentity: @escaping () -> PairingCredentialStorage.StoredIdentity? = PairingCredentialStorage.loadIdentity,
        revokeStoredPairingIdentity: @escaping (PairingCredentialStorage.StoredIdentity) -> Bool = PairingCredentialStorage.revokeIdentity
    ) {
        self.api = api
        self.notificationCenter = notificationCenter
        self.loadStoredPairingIdentity = loadStoredPairingIdentity
        self.revokeStoredPairingIdentity = revokeStoredPairingIdentity
    }

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
        await notificationCenter.requestAuthorizationIfNeeded()
    }

    func latestAttemptSummary() -> BackgroundRefreshAttemptSummary? {
        guard let data = UserDefaults.standard.data(forKey: attemptSummaryKey) else {
            return nil
        }
        guard let summary = try? JSONDecoder().decode(BackgroundRefreshAttemptSummary.self, from: data),
              summary.pairingIdentityID == currentPairingIdentity()?.id
        else {
            return nil
        }
        return summary
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

    func performRefreshCycle() async -> Bool {
        guard let identity = currentPairingIdentity() else {
            clearAttemptSummary()
            return false
        }

        let states: [AutoRefreshStateDTO]
        do {
            states = try await api.listAutoRefreshStates(baseURL: identity.baseURL, token: identity.token)
            guard isCurrentPairingIdentity(identity) else { return false }
        } catch {
            if isUnauthorized(error) {
                await revokePairingAuthority(identity)
                return false
            }
            guard isCurrentPairingIdentity(identity) else { return false }
            persistAttemptSummary(
                pairingIdentity: identity,
                candidates: 0,
                requested: 0,
                failed: 1,
                cancelled: false
            )
            await postRefreshFailureNotification(failedCount: nil, pairingIdentity: identity)
            return false
        }

        let candidates = states.filter { $0.needsRefresh && !$0.refreshInProgress }
        var requestedApps: [String] = []
        var failedCount = 0

        for state in candidates {
            if Task.isCancelled {
                guard isCurrentPairingIdentity(identity) else { return false }
                persistAttemptSummary(
                    pairingIdentity: identity,
                    candidates: candidates.count,
                    requested: requestedApps.count,
                    failed: failedCount,
                    cancelled: true
                )
                return false
            }

            do {
                let receipt = try await api.triggerRefresh(
                    baseURL: identity.baseURL,
                    token: identity.token,
                    installId: state.installedAppId,
                    idempotencyKey: UUID().uuidString
                )
                guard isCurrentPairingIdentity(identity) else { return false }
                if receipt.job?.outcome != "not_needed" {
                    requestedApps.append(state.appName)
                }
            } catch {
                if isUnauthorized(error) {
                    await revokePairingAuthority(identity)
                    return false
                }
                guard isCurrentPairingIdentity(identity) else { return false }
                failedCount += 1
            }
        }

        guard isCurrentPairingIdentity(identity) else { return false }

        persistAttemptSummary(
            pairingIdentity: identity,
            candidates: candidates.count,
            requested: requestedApps.count,
            failed: failedCount,
            cancelled: false
        )

        if !requestedApps.isEmpty {
            await postRefreshQueuedNotification(requestedApps, pairingIdentity: identity)
        }
        guard isCurrentPairingIdentity(identity) else { return false }
        if failedCount > 0 {
            await postRefreshFailureNotification(failedCount: failedCount, pairingIdentity: identity)
        }

        return failedCount == 0
    }

    private func currentPairingIdentity() -> PairingCredentialStorage.StoredIdentity? {
        guard let stored = loadStoredPairingIdentity(),
              !PairingCredentialStorage.isRevoked(identityID: stored.id)
        else { return nil }
        return stored
    }

    private func isCurrentPairingIdentity(_ identity: PairingCredentialStorage.StoredIdentity) -> Bool {
        currentPairingIdentity() == identity
    }

    private func isUnauthorized(_ error: Error) -> Bool {
        guard let apiError = error as? HelperAPIError,
              case .unauthorized = apiError
        else { return false }
        return true
    }

    private func revokePairingAuthority(_ identity: PairingCredentialStorage.StoredIdentity) async {
        PairingCredentialStorage.markRevoked(identityID: identity.id)
        _ = revokeStoredPairingIdentity(identity)
        clearAttemptSummary(pairingIdentity: identity)
        await removeRefreshNotifications(pairingIdentity: identity)
    }

    private func postRefreshQueuedNotification(
        _ apps: [String],
        pairingIdentity identity: PairingCredentialStorage.StoredIdentity
    ) async {
        await requestNotificationAuthorizationIfNeeded()
        guard isCurrentPairingIdentity(identity) else { return }

        let content = UNMutableNotificationContent()
        content.title = "Refresh requested on paired host"
        content.body = apps.count == 1
            ? "\(apps[0]) was requested and may be queued or already running."
            : "\(apps.count) refreshes were requested and may be queued or already running."
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: queuedNotificationIdentifier(pairingIdentity: identity),
            content: content,
            trigger: nil
        )
        do {
            try await notificationCenter.add(request)
        } catch {
            return
        }
        guard isCurrentPairingIdentity(identity) else {
            await removeRefreshNotifications(pairingIdentity: identity)
            return
        }
    }

    private func postRefreshFailureNotification(
        failedCount: Int?,
        pairingIdentity identity: PairingCredentialStorage.StoredIdentity
    ) async {
        await requestNotificationAuthorizationIfNeeded()
        guard isCurrentPairingIdentity(identity) else { return }

        let content = UNMutableNotificationContent()
        content.title = "Some refreshes were not requested"
        content.body = failedCount.map {
            "The paired host could not accept \($0) refresh request\($0 == 1 ? "" : "s"). Open SideLink for current status."
        } ?? "The paired host could not provide refresh status. Open SideLink and try again."
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: failureNotificationIdentifier(pairingIdentity: identity),
            content: content,
            trigger: nil
        )
        do {
            try await notificationCenter.add(request)
        } catch {
            return
        }
        guard isCurrentPairingIdentity(identity) else {
            await removeRefreshNotifications(pairingIdentity: identity)
            return
        }
    }

    private func queuedNotificationIdentifier(
        pairingIdentity identity: PairingCredentialStorage.StoredIdentity
    ) -> String {
        "sidelink.refresh.\(identity.id).queued"
    }

    private func failureNotificationIdentifier(
        pairingIdentity identity: PairingCredentialStorage.StoredIdentity
    ) -> String {
        "sidelink.refresh.\(identity.id).failure"
    }

    private func removeRefreshNotifications(
        pairingIdentity identity: PairingCredentialStorage.StoredIdentity
    ) async {
        let identifiers = [
            queuedNotificationIdentifier(pairingIdentity: identity),
            failureNotificationIdentifier(pairingIdentity: identity),
        ]
        await notificationCenter.removePendingNotificationRequests(withIdentifiers: identifiers)
        await notificationCenter.removeDeliveredNotifications(withIdentifiers: identifiers)
    }

    private func persistAttemptSummary(
        pairingIdentity identity: PairingCredentialStorage.StoredIdentity,
        candidates: Int,
        requested: Int,
        failed: Int,
        cancelled: Bool
    ) {
        let summary = BackgroundRefreshAttemptSummary(
            pairingIdentityID: identity.id,
            attemptedAt: ISO8601DateFormatter().string(from: Date()),
            candidates: candidates,
            requested: requested,
            failed: failed,
            cancelled: cancelled
        )
        if let data = try? JSONEncoder().encode(summary) {
            UserDefaults.standard.set(data, forKey: attemptSummaryKey)
        }
    }

    private func clearAttemptSummary() {
        UserDefaults.standard.removeObject(forKey: attemptSummaryKey)
    }

    private func clearAttemptSummary(pairingIdentity identity: PairingCredentialStorage.StoredIdentity) {
        guard let data = UserDefaults.standard.data(forKey: attemptSummaryKey),
              let summary = try? JSONDecoder().decode(BackgroundRefreshAttemptSummary.self, from: data),
              summary.pairingIdentityID == identity.id
        else { return }
        clearAttemptSummary()
    }
}
#else
final class BackgroundRefreshCoordinator {
    static let shared = BackgroundRefreshCoordinator()
    func registerTasks() {}
    func setBackgroundRefreshEnabled(_ enabled: Bool) {}
    func requestNotificationAuthorizationIfNeeded() async {}
    func scheduleAppRefresh() {}
    func latestAttemptSummary() -> BackgroundRefreshAttemptSummary? { nil }
}
#endif
