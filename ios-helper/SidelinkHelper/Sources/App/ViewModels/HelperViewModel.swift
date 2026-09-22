import Foundation
import SwiftUI

@MainActor
final class HelperViewModel: ObservableObject {
    enum LastInstallRequest {
        case library(ipaId: String, appName: String, subtitle: String, idempotencyKey: String)
        case source(app: SourceAppDTO, sourceName: String, subtitle: String, idempotencyKey: String)
    }

    static let officialSourceURL = SidelinkSourceURLUtil.canonicalOfficialSourceURL
    static let installPollingTimeout: TimeInterval = 20 * 60
    static let maxInstallLogEntries = 300
    static let maxOperationReceipts = 200
    static let bundledTrustedSources: [TrustedSourceDTO] = [
        TrustedSourceDTO(
            id: "altstore-classic",
            name: "AltStore Classic",
            url: "https://cdn.altstore.io/file/altstore/apps.json",
            iconURL: "https://altstore.io/images/icon.png",
            description: "The canonical AltStore community source."
        ),
        TrustedSourceDTO(
            id: "cypwn",
            name: "CyPwn",
            url: "https://ipa.cypwn.xyz/cypwn_altstore.json",
            iconURL: nil,
            description: "CyPwn's AltStore-compatible source feed."
        ),
        TrustedSourceDTO(
            id: "sidelink-official",
            name: "SideLink Official",
            url: officialSourceURL,
            iconURL: "https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/build/icons/icon-1024.png",
            description: "The default source shipped with SideLink."
        ),
    ]

    @AppStorage("backendURL") var backendURL = "" {
        didSet {
            if oldValue != backendURL {
                pairingDraftDidChange()
            }
        }
    }
    @AppStorage(PairingCredentialStorage.baseURLKey) var pairedBackendURL = ""
    @AppStorage("helperToken") private var legacyHelperToken = ""
    @Published private(set) var helperToken = ""
    @AppStorage("serverName") var serverName = ""
    @AppStorage("serverVersion") var serverVersion = ""
    @AppStorage("deviceId") var deviceId = ""
    @AppStorage("customSourceURLs") var customSourceURLsJSON = "[]"
    @AppStorage("selectedAccountId") private var persistedSelectedAccountId = ""
    @AppStorage("primarySigningAccountId") private var persistedPrimarySigningAccountId = ""
    @AppStorage("selectedDeviceUdid") private var persistedSelectedDeviceUdid = ""

    @Published var pairingCode = "" {
        didSet {
            if oldValue != pairingCode {
                pairingDraftDidChange()
            }
        }
    }
    @Published var importURL = ""
    @Published var selectedAccountId = "" {
        didSet { persistedSelectedAccountId = selectedAccountId }
    }
    @Published var primarySigningAccountId = "" {
        didSet { persistedPrimarySigningAccountId = primarySigningAccountId }
    }
    @Published var selectedDeviceUdid = "" {
        didSet { persistedSelectedDeviceUdid = selectedDeviceUdid }
    }
    @Published var sourceURLInput = ""
    @Published var activeInstall2FACode = ""

    @Published var status: HelperStatusResponse?
    @Published var config: HelperConfigDTO?
    @Published var accounts: [AccountDTO] = []
    @Published var devices: [DeviceDTO] = []
    @Published var ipas: [IpaArtifactDTO] = []
    @Published var installedApps: [InstalledAppDTO] = []
    @Published var dailyOperations: DailyOperationsSnapshotDTO?
    @Published var dailyOperationsError: String?
    @Published var dailyOperationsLastSyncedAt: Date?
    @Published var dailyOperationsAuthorityExpired = true
    @Published var hostLastReachedAt: Date?
    @Published var hostReachable = false
    @Published var operationJobsById: [String: InstallJobDetailDTO] = [:]
    @Published var activityError: String?
    @Published var activityLastSyncedAt: Date?
    @Published var activityHostReachable = false
    @Published var activityAuthoritativeVersions: [String: InstallJobVersionFingerprint] = [:]
    @Published var activityMutationSuspensions: [String: ActivityMutationSuspension] = [:]
    @Published var activityReceiptValidationJobId: String?
    @Published var sourceCatalogs: [SourceCatalog] = []
    @Published var customSourceURLs: [String] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var toastMessage: String?

    // MARK: - Granular loading states
    @Published private(set) var loadingStates: [String: Bool] = [:]

    func setLoading(_ op: String, _ value: Bool) {
        loadingStates[op] = value
    }

    func isLoadingOp(_ op: String) -> Bool {
        loadingStates[op] ?? false
    }

    // MARK: - Error queue (last 5)
    @Published private(set) var errorQueue: [String] = []

    func pushError(_ msg: String) {
        errorQueue.append(msg)
        if errorQueue.count > 5 {
            errorQueue.removeFirst(errorQueue.count - 5)
        }
        errorMessage = msg
    }

    func popError() -> String? {
        guard !errorQueue.isEmpty else { return nil }
        let removed = errorQueue.removeFirst()
        errorMessage = errorQueue.last
        return removed
    }
    @Published var discoveredBackends: [DiscoveredBackend] = []
    @Published var activeInstallJob: InstallJobDetailDTO?
    @Published var activeInstallLogs: [InstallJobLogDTO] = []
    @Published var installConsolePresented = false
    @Published var installConsoleTitle = ""
    @Published var installConsoleSubtitle = ""
    @Published var pendingAppleAuth: PendingAppleAuthContext?
    @Published var helperLogs: [HelperLogEntryDTO] = []
    @Published var localActivityLogs: [HelperLogEntryDTO] = []
    @Published var appIds: [HelperAppIdDTO] = []
    @Published var appIdUsage: [HelperAppIdUsageDTO] = []
    @Published var certificates: [HelperCertificateDTO] = []
    @Published var trustedSources: [TrustedSourceDTO] = []
    @Published var unmanagedInstalledApps: [UnmanagedDeviceAppDTO] = []
    @Published var autoRefreshStates: [AutoRefreshStateDTO] = []
    @Published var sseConnected = false
    @Published var sourceCatalogFailures: [String] = []
    @Published private(set) var isPairing = false

    let api: APIClient
    let authorityNow: () -> Date
    let authorityTTL: TimeInterval
    private let discovery = DiscoveryListener()
    let sseClient: any SSEStreaming
    var activeJobPollingTask: Task<Void, Never>?
    var activeJobPollingJobId: String?
    var activeJobPollingGeneration: UUID?
    private var sseReconnectTask: Task<Void, Never>?
    private var sseReconnectAttempt = 0
    private var activeSSEConnectionID: UUID?
    private var activeSSEPairingIdentity: PairingIdentity?
    private static let sseMaxRetries = 10
    private let sseReconnectSleep: @Sendable (TimeInterval) async -> Void
    private let loadStoredPairingIdentity: () -> PairingCredentialStorage.StoredIdentity?
    private let storePairingIdentity: (String, String) -> PairingCredentialStorage.StoredIdentity?
    private let revokeStoredPairingIdentity: (PairingCredentialStorage.StoredIdentity) -> Bool
    var lastInstallRequest: LastInstallRequest?
    var pendingJobCommandKeys: [String: String] = [:]
    var activeInstallLogJobId: String?
    var installConsolePresentationJobId: String?
    var expectedInstallJobId: String?
    var hasPendingInstallPresentation = false
    var installConsoleAutoPresentationSuppressed = false
    var installConsoleAllowsNextDismissal = false
    var selectedOperationJobId: String?
    var selectedActivityReceiptJobId: String?
    var pendingAppleAuthIdentity: PairingIdentity?
    var storedPairingIdentityID = ""
    var pairingIdentityGeneration: UInt64 = 0
    private var pairingAttemptGeneration: UInt64 = 0
    private var refreshInFlightIdentity: PairingIdentity?
    private var refreshOwnershipGeneration: UInt64 = 0
    private var queuedRefreshIdentity: PairingIdentity?
    private var queuedRefreshShowsLoading = false
    var dailyOperationsRefreshGeneration: UInt64 = 0
    var dailyOperationSelectionGeneration: UInt64 = 0
    var dailyOperationsAuthorityGeneration: UInt64 = 0
    var dailyOperationsAuthorityExpiryTask: Task<Void, Never>?
    var activityRefreshGeneration: UInt64 = 0
    var activityAuthorityReadGeneration: UInt64 = 0
    var activityAuthorityReadGenerationsByJob: [String: UInt64] = [:]
    var appIDReadGeneration: UInt64 = 0
    var sourceCatalogReadGeneration: UInt64 = 0

    init(
        api: APIClient = APIClient(),
        sseClient: any SSEStreaming = SSEClient(),
        authorityNow: @escaping () -> Date = Date.init,
        authorityTTL: TimeInterval = 5 * 60,
        sseReconnectSleep: @escaping @Sendable (TimeInterval) async -> Void = { delay in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        },
        loadStoredPairingIdentity: @escaping () -> PairingCredentialStorage.StoredIdentity? = PairingCredentialStorage.loadIdentity,
        storePairingIdentity: @escaping (String, String) -> PairingCredentialStorage.StoredIdentity? = {
            PairingCredentialStorage.storeIdentity(baseURL: $0, token: $1)
        },
        revokeStoredPairingIdentity: @escaping (PairingCredentialStorage.StoredIdentity) -> Bool = PairingCredentialStorage.revokeIdentity,
        startLongLivedServices: Bool = true
    ) {
        self.api = api
        self.sseClient = sseClient
        self.authorityNow = authorityNow
        self.authorityTTL = authorityTTL
        self.sseReconnectSleep = sseReconnectSleep
        self.loadStoredPairingIdentity = loadStoredPairingIdentity
        self.storePairingIdentity = storePairingIdentity
        self.revokeStoredPairingIdentity = revokeStoredPairingIdentity

        if let storedIdentity = loadStoredPairingIdentity(),
           !PairingCredentialStorage.isRevoked(identityID: storedIdentity.id),
           !storedIdentity.token.isEmpty,
           let normalizedURL = normalizedBackendURL(storedIdentity.baseURL),
           normalizedURL == storedIdentity.baseURL
        {
            storedPairingIdentityID = storedIdentity.id
            pairedBackendURL = normalizedURL
            helperToken = storedIdentity.token
        } else {
            storedPairingIdentityID = ""
            pairedBackendURL = ""
            helperToken = ""
            serverName = ""
            serverVersion = ""
            deviceId = ""
            persistedPrimarySigningAccountId = ""
            persistedSelectedAccountId = ""
            persistedSelectedDeviceUdid = ""
        }
        _ = KeychainStore.remove(PairingCredentialStorage.tokenKey)
        legacyHelperToken = ""

        loadCustomSourcesFromStorage()
        ensureDefaultSourcePresent()
        primarySigningAccountId = persistedPrimarySigningAccountId
        selectedAccountId = persistedSelectedAccountId
        selectedDeviceUdid = persistedSelectedDeviceUdid

        discovery.onPayload = { [weak self] payload in
            Task { @MainActor in
                self?.ingestDiscovery(payload)
            }
        }

        sseClient.onEvent = { [weak self] connectionID, event, data in
            DispatchQueue.main.async {
                guard let self,
                      self.activeSSEConnectionID == connectionID,
                      let identity = self.activeSSEPairingIdentity,
                      self.isCurrentPairingIdentity(identity)
                else {
                    return
                }
                if self.isAuthorityRevocationEvent(event: event, data: data) {
                    self.losePairingAuthority(pairingIdentity: identity)
                    return
                }
                if event == "close" {
                    self.handleCurrentSSETransportClosure(
                        connectionID: connectionID,
                        pairingIdentity: identity
                    )
                    return
                }
                self.sseConnected = true
                self.sseReconnectAttempt = 0
                self.hostReachable = true
                self.hostLastReachedAt = self.authorityNow()
                self.handleSSEEvent(event: event, data: data, pairingIdentity: identity)
            }
        }

        sseClient.onFailure = { [weak self] connectionID, error in
            DispatchQueue.main.async {
                guard let self,
                      self.activeSSEConnectionID == connectionID,
                      let identity = self.activeSSEPairingIdentity,
                      self.isCurrentPairingIdentity(identity)
                else {
                    return
                }
                if self.handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                    return
                }
                self.handleCurrentSSETransportClosure(
                    connectionID: connectionID,
                    pairingIdentity: identity
                )
            }
        }

        if startLongLivedServices {
            discovery.start()
        }
    }

    deinit {
        // `deinit` runs off the main actor. Accessing @MainActor-isolated state
        // here is unsafe under Swift 6 strict concurrency. Only touch the
        // nonisolated subsystems; callers should invoke `invalidate()` from
        // the view's `.onDisappear` to deterministically release VM state.
        sseClient.disconnect()
        discovery.stop()
    }

    /// Call from the root view's lifecycle (e.g. `.onDisappear`) to cancel all
    /// in-flight tasks and tear down long-lived subscriptions before the
    /// ObservableObject is actually deallocated. This used to live in `deinit`
    /// but that required `@MainActor`-isolated state access from a nonisolated
    /// context, which produces Swift 6 strict-concurrency warnings.
    @MainActor
    func invalidate() {
        invalidateDailyOperationsAuthority(message: nil)
        invalidateDailyOperationSelection()
        activeJobPollingTask?.cancel()
        activeJobPollingTask = nil
        activeJobPollingJobId = nil
        activeJobPollingGeneration = nil
        sseReconnectTask?.cancel()
        sseReconnectTask = nil
        disconnectSSE()
        discovery.stop()
    }

    // MARK: - Computed Properties

    var isPaired: Bool {
        hasPairingCredential
    }

    var hasPairingCredential: Bool {
        currentPairingIdentity() != nil
    }

    var hostConnectionLabel: String {
        if !hasPairingCredential {
            return "Not paired"
        }
        return hostReachable ? "Reachable" : "Unavailable"
    }

    var maxActiveAppSlots: Int {
        config?.freeAccountLimits?.maxActiveApps ?? 3
    }

    var activeAppSlotUsage: Int {
        installedApps.filter { ($0.status ?? "active") != "deactivated" }.count
    }

    var isAtFreeSlotLimit: Bool {
        activeAppSlotUsage >= maxActiveAppSlots
    }

    var installReadinessMessage: String? {
        if !isPaired {
            return "Pair with a SideLink server to install or refresh apps"
        }
        if pendingAppleAuth != nil {
            return "Finish Apple ID verification in Settings before installing apps"
        }
        if activeAccounts.isEmpty {
            return "Add an Apple ID before installing apps"
        }
        if primaryActiveSigningAccount == nil {
            return "Choose a primary signing identity before installing apps"
        }
        if devices.isEmpty {
            return "Connect a device to the paired server before installing apps"
        }
        if selectedDevice == nil {
            return "Select a target device before installing apps"
        }
        if isAtFreeSlotLimit {
            return "Free Apple accounts can only keep \(maxActiveAppSlots) active apps signed at once"
        }
        return nil
    }

    var installedAttentionCount: Int {
        let criticalExpirations = installedApps.filter {
            guard ($0.status ?? "active") != "deactivated",
                  let expires = ISO8601DateFormatter().date(from: $0.expiresAt)
            else {
                return false
            }
            return expires.timeIntervalSinceNow <= 86_400
        }.count

        let actionableJobIds: Set<String>
        if let dailyOperations {
            let actionIds = Set(dailyOperations.actions.map(\.id))
            let waitingJobIds = actionIds.contains("waiting-2fa")
                ? dailyOperations.operations.filter { $0.status == "waiting_2fa" }.map(\.jobId)
                : []
            let recentFailureJobIds = actionIds.contains("recent-failures")
                ? dailyOperations.recentOutcomes.filter { $0.status == "failed" }.map(\.jobId)
                : []
            actionableJobIds = Set(waitingJobIds + recentFailureJobIds)
        } else if let activeInstallJob,
                  isInstallJobInFlight(activeInstallJob) || activeInstallJob.status == "failed" {
            actionableJobIds = [activeInstallJob.id]
        } else {
            actionableJobIds = []
        }
        let installAttention = actionableJobIds.count
        return criticalExpirations + installAttention
    }

    var operationActivity: OperationActivityProjection {
        OperationActivityProjection.make(from: Array(operationJobsById.values))
    }

    var hasCurrentActivitySnapshot: Bool {
        hasPairingCredential
            && activityHostReachable
            && activityError == nil
            && activityLastSyncedAt != nil
    }

    var supportsExactJobCommandPreconditions: Bool {
        dailyOperations?.jobCommandPreconditionVersion == 1
    }

    func activityAuthorityState(for job: InstallJobDetailDTO) -> ActivityReceiptAuthorityState {
        if activityReceiptValidationJobId == job.id {
            return .checking
        }
        let fingerprint = InstallJobVersionFingerprint(job: job)
        if let suspension = activityMutationSuspensions[job.id],
           suspension.fingerprint == fingerprint {
            switch suspension.disposition {
            case .submitting: return .commandSubmitting
            case .accepted: return .commandAccepted
            case .outcomeUnknown: return .commandOutcomeUnknown
            }
        }
        return activityAuthoritativeVersions[job.id] == fingerprint ? .current : .lastKnown
    }

    var presentedActivityCommandDisabledReason: String? {
        guard supportsExactJobCommandPreconditions else {
            return "Update SideLink on the paired Mac before sending receipt commands. This host has not confirmed exact-version enforcement."
        }
        guard let job = presentedInstallJob else { return nil }
        let fingerprint = InstallJobVersionFingerprint(job: job)
        if let suspension = activityMutationSuspensions[job.id],
           suspension.fingerprint == fingerprint {
            switch suspension.disposition {
            case .submitting:
                return "SideLink is sending this command. Another command cannot be sent until its outcome is known."
            case .accepted:
                return "The host accepted the last command. Waiting for a newer receipt prevents sending it twice."
            case .outcomeUnknown:
                return "The last command may have reached the host. Waiting for a newer receipt prevents sending it twice."
            }
        }
        guard selectedActivityReceiptJobId == job.id else { return nil }

        switch activityAuthorityState(for: job) {
        case .current:
            return nil
        case .checking:
            return "Checking this exact receipt with the paired host. Commands stay unavailable until it responds."
        case .commandSubmitting:
            return "SideLink is sending this command. Another command cannot be sent until its outcome is known."
        case .commandAccepted:
            return "The host accepted the last command. Waiting for a newer receipt before another command can be sent."
        case .commandOutcomeUnknown:
            return "The command outcome could not be confirmed. Waiting for a newer receipt prevents sending it twice."
        case .lastKnown:
            return "This is a last-known receipt. Refresh it from the paired host before sending a command."
        }
    }

    var presentedActivityRetryDisabledReason: String? {
        guard let job = presentedInstallJob,
              selectedActivityReceiptJobId == job.id
        else {
            return nil
        }
        return "Retry this operation from its app or library entry. Activity receipts do not retain private install inputs."
    }

    var settingsAttentionCount: Int {
        if pendingAppleAuth != nil {
            return 1
        }
        return isPaired ? 0 : 1
    }

    var visibleLogs: [HelperLogEntryDTO] {
        let merged = helperLogs + localActivityLogs
        var seen = Set<String>()
        return merged
            .sorted { $0.at > $1.at }
            .filter { entry in
                seen.insert(entry.id).inserted
            }
    }

    var canStartInstall: Bool {
        isPaired && primaryActiveSigningAccount != nil && selectedDevice != nil && !isAtFreeSlotLimit
    }

    var installConsoleResolvedTitle: String {
        if !installConsoleTitle.isEmpty {
            return installConsoleTitle
        }

        if let job = presentedInstallJob {
            return inferredInstallName(for: job)
        }

        return "Install"
    }

    var installConsoleResolvedSubtitle: String {
        if !installConsoleSubtitle.isEmpty {
            return installConsoleSubtitle
        }

        if let job = presentedInstallJob {
            return inferredInstallSubtitle(for: job)
        }

        return "Signing, provisioning, and device installation happen here in one place."
    }

    var activeInstallProgressFraction: Double {
        guard let job = presentedInstallJob, !job.steps.isEmpty else { return isLoading ? 0.08 : 0 }
        let finished = job.steps.filter { $0.status == "completed" || $0.status == "skipped" }.count
        return min(1, max(Double(finished) / Double(job.steps.count), job.status == "completed" ? 1 : 0.08))
    }

    var installConsoleRequiresPersistentPresentation: Bool {
        presentedInstallJob?.status == "waiting_2fa"
    }

    var presentedInstallJob: InstallJobDetailDTO? {
        guard !hasPendingInstallPresentation,
              let activeInstallJob,
              installConsolePresentationJobId == activeInstallJob.id
        else {
            return nil
        }
        return activeInstallJob
    }

    var presentedInstallLogs: [InstallJobLogDTO] {
        guard let job = presentedInstallJob,
              activeInstallLogJobId == job.id
        else {
            return []
        }
        return activeInstallLogs
    }

    var selectedAccount: AccountDTO? {
        accounts.first(where: { $0.id == selectedAccountId })
    }

    var primarySigningAccount: AccountDTO? {
        accounts.first(where: { $0.id == primarySigningAccountId })
    }

    var activeAccounts: [AccountDTO] {
        accounts.filter { $0.status == "active" }
    }

    var primaryActiveSigningAccount: AccountDTO? {
        activeAccounts.first(where: { $0.id == primarySigningAccountId })
    }

    var effectiveSigningAccount: AccountDTO? {
        primaryActiveSigningAccount ?? selectedActiveAccount ?? automaticPrimarySigningAccount()
    }

    var selectedActiveAccount: AccountDTO? {
        activeAccounts.first(where: { $0.id == selectedAccountId })
    }

    var selectedDevice: DeviceDTO? {
        devices.first(where: { $0.id == selectedDeviceUdid })
    }

    var sourceApps: [SourceAppDTO] {
        sourceCatalogs.flatMap { $0.manifest.apps }
    }

    var signingDeviceDisplayName: String {
        selectedDevice?.name ?? "No Device"
    }

    var primarySigningSummary: String {
        guard let account = effectiveSigningAccount else {
            return "Add and verify an Apple ID to keep one signing identity across installs."
        }
        let device = selectedDevice?.name ?? "your device"
        return "SideLink defaults to \(account.appleId) for signing and installs to \(device)."
    }

    var installPreparationSummary: String {
        installSubtitle(base: "Importing the IPA if needed, then using your primary signing identity for the install.")
    }

    func isOfficialSourceURL(_ url: String) -> Bool {
        SidelinkSourceURLUtil.normalized(url).caseInsensitiveCompare(Self.officialSourceURL) == .orderedSame
    }

    func canRemoveSource(_ catalog: SourceCatalog) -> Bool {
        if isPaired {
            return !catalog.isBuiltIn && catalog.sourceId != nil
        }
        return customSourceURLs.contains(catalog.sourceURL)
    }

    var accountsNeedingAttention: [AccountDTO] {
        accounts.filter { $0.status != "active" }
    }

    func accountNeedsAttention(_ account: AccountDTO) -> Bool {
        account.status != "active"
    }

    // MARK: - Primary Signing Identity

    func setPrimarySigningAccount(_ accountId: String, showConfirmation: Bool = true) {
        guard activeAccounts.contains(where: { $0.id == accountId }) else {
            errorMessage = "Only active Apple IDs can become your primary signing identity"
            return
        }

        primarySigningAccountId = accountId
        selectedAccountId = accountId
        errorMessage = nil

        if showConfirmation, let account = activeAccounts.first(where: { $0.id == accountId }) {
            toastMessage = "Primary signing identity switched to \(account.appleId)"
        }
    }

    // MARK: - Pairing

    @discardableResult
    func pair() async -> Bool {
        let code = pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)
        errorMessage = nil
        guard code.count == 6, code.allSatisfy(\.isNumber) else {
            errorMessage = "Pairing code must be 6 digits."
            return false
        }

        guard let normalized = normalizedBackendURL(backendURL) else {
            errorMessage = "Enter a valid backend URL (for example: http://sidelink.local:4010)."
            return false
        }

        backendURL = normalized
        pairingAttemptGeneration &+= 1
        let attemptGeneration = pairingAttemptGeneration

        isPairing = true
        defer {
            if pairingAttemptGeneration == attemptGeneration {
                isPairing = false
            }
        }

        do {
            let result = try await api.pair(baseURL: normalized, code: code)
            guard pairingAttemptGeneration == attemptGeneration,
                  normalizedBackendURL(backendURL) == normalized,
                  !result.token.isEmpty
            else {
                return false
            }

            guard replacePairingIdentity(baseURL: normalized, token: result.token) else {
                errorMessage = "Could not securely store the paired host identity."
                return false
            }
            guard let identity = currentPairingIdentity() else { return false }
            serverName = result.serverName ?? "SideLink"
            serverVersion = result.serverVersion ?? ""
            pairingCode = ""
            errorMessage = nil
            toastMessage = "Paired successfully"
            hostReachable = true
            hostLastReachedAt = authorityNow()
            Task { [weak self] in
                await self?.refreshAllSilently(pairingIdentity: identity)
            }
            return true
        } catch {
            guard pairingAttemptGeneration == attemptGeneration else { return false }
            errorMessage = error.localizedDescription
            return false
        }
    }

    func pairUsingPayload(_ rawPayload: String) async -> Bool {
        guard applyPairingPayload(rawPayload) else {
            return false
        }

        return await pair()
    }

    func applyPairingPayload(_ rawPayload: String) -> Bool {
        errorMessage = nil

        let trimmedPayload = rawPayload.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPayload.isEmpty else {
            errorMessage = "Pairing payload is empty."
            return false
        }

        guard let data = trimmedPayload.data(using: .utf8),
              let payload = try? JSONDecoder().decode(HelperPairingPayload.self, from: data)
        else {
            errorMessage = "Invalid pairing payload."
            return false
        }

        let normalizedCode = payload.code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedCode.count == 6, normalizedCode.allSatisfy(\.isNumber) else {
            errorMessage = "Pairing payload is missing a valid 6-digit code."
            return false
        }

        guard let normalizedURL = normalizedBackendURL(payload.backendUrl) else {
            errorMessage = "Pairing payload contains an invalid backend URL."
            return false
        }

        pairingCode = normalizedCode
        backendURL = normalizedURL

        return true
    }

    private func normalizedBackendURL(_ raw: String) -> String? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }

        if !value.contains("://") {
            value = "http://\(value)"
        }

        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              (scheme == "http" || scheme == "https"),
              url.host != nil else {
            return nil
        }

        guard (url.path.isEmpty || url.path == "/"), url.query == nil, url.fragment == nil else {
            return nil
        }

        if scheme == "http", let host = url.host, !isLocalHost(host) {
            return nil
        }

        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.path = ""
        components.query = nil
        components.fragment = nil

        let normalized = components.string ?? value
        return normalized.hasSuffix("/") ? String(normalized.dropLast()) : normalized
    }

    // MARK: - Refresh

    func refreshAll(pairingIdentity: PairingIdentity? = nil) async {
        await refreshAll(showLoading: true, pairingIdentity: pairingIdentity)
    }

    func refreshAllSilently(pairingIdentity: PairingIdentity? = nil) async {
        await refreshAll(showLoading: false, pairingIdentity: pairingIdentity)
    }

    private func refreshAll(showLoading: Bool, pairingIdentity providedIdentity: PairingIdentity?) async {
        guard let initialIdentity = providedIdentity ?? currentPairingIdentity() else {
            await refreshSourceCatalogs()
            await refreshTrustedSources()
            return
        }
        guard isCurrentPairingIdentity(initialIdentity) else { return }

        if queueRefreshIfInFlight(identity: initialIdentity, showLoading: showLoading) {
            return
        }

        refreshOwnershipGeneration &+= 1
        let ownershipGeneration = refreshOwnershipGeneration
        refreshInFlightIdentity = initialIdentity
        await performFullRefreshPass(identity: initialIdentity, showLoading: showLoading)
        guard ownsRefreshCycle(identity: initialIdentity, generation: ownershipGeneration) else {
            return
        }

        if let trailingRefresh = takeQueuedRefresh() {
            await performFullRefreshPass(
                identity: trailingRefresh.identity,
                showLoading: trailingRefresh.showsLoading
            )
            guard ownsRefreshCycle(identity: initialIdentity, generation: ownershipGeneration) else {
                return
            }
        }

        let followUpRefresh = takeQueuedRefresh()
        refreshInFlightIdentity = nil

        if let followUpRefresh {
            Task { [weak self] in
                await self?.refreshAll(
                    showLoading: followUpRefresh.showsLoading,
                    pairingIdentity: followUpRefresh.identity
                )
            }
        }
    }

    private func performFullRefreshPass(identity: PairingIdentity, showLoading: Bool) async {
        if showLoading {
            isLoading = true
        }

        await performFullRefresh(identity: identity)

        if showLoading, isCurrentPairingIdentity(identity) {
            isLoading = false
        }
    }

    private func ownsRefreshCycle(identity: PairingIdentity, generation: UInt64) -> Bool {
        refreshInFlightIdentity == identity && refreshOwnershipGeneration == generation
    }

    private func queueRefreshIfInFlight(identity: PairingIdentity, showLoading: Bool) -> Bool {
        guard refreshInFlightIdentity != nil else { return false }
        queuedRefreshIdentity = identity
        queuedRefreshShowsLoading = queuedRefreshShowsLoading || showLoading
        return true
    }

    private func takeQueuedRefresh() -> (identity: PairingIdentity, showsLoading: Bool)? {
        defer {
            queuedRefreshIdentity = nil
            queuedRefreshShowsLoading = false
        }
        guard let identity = queuedRefreshIdentity,
              isCurrentPairingIdentity(identity)
        else {
            return nil
        }
        return (identity, queuedRefreshShowsLoading)
    }

    private func performFullRefresh(identity: PairingIdentity) async {
        do {
            let previousPrimarySigningAccountId = primarySigningAccountId
            let previousSelectedDeviceUdid = selectedDeviceUdid
            let requestedDeviceId = selectedDeviceUdid.isEmpty
                ? (deviceId.isEmpty ? nil : deviceId)
                : selectedDeviceUdid
            async let statusCall = api.fetchStatus(
                baseURL: identity.baseURL,
                token: identity.token,
                deviceId: requestedDeviceId
            )
            async let configCall = api.fetchConfig(baseURL: identity.baseURL, token: identity.token)
            async let accountCall = api.listAccounts(baseURL: identity.baseURL, token: identity.token)
            async let ipaCall = api.listIpas(baseURL: identity.baseURL, token: identity.token)

            let (statusResponse, configResponse, accountResponse, ipaResponse) = try await (
                statusCall,
                configCall,
                accountCall,
                ipaCall
            )
            guard isCurrentPairingIdentity(identity) else { return }
            let deviceResponse: [DeviceDTO]
            do {
                deviceResponse = try await api.listDevices(
                    baseURL: identity.baseURL,
                    token: identity.token
                )
            } catch {
                guard isCurrentPairingIdentity(identity) else { return }
                if handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                    return
                }
                deviceResponse = statusResponse.devices
            }

            guard isCurrentPairingIdentity(identity) else { return }

            hostReachable = true
            hostLastReachedAt = authorityNow()

            status = statusResponse
            config = configResponse
            accounts = accountResponse
            devices = deviceResponse
            ipas = ipaResponse

            let nextPrimarySigningAccountId = resolvePrimarySigningAccountId(preferred: previousPrimarySigningAccountId)
            let nextSelectedDeviceUdid = devices.contains(where: { $0.id == previousSelectedDeviceUdid })
                ? previousSelectedDeviceUdid
                : (devices.first?.id ?? "")

            let invalidatedPrimarySigningIdentity = !previousPrimarySigningAccountId.isEmpty
                && previousPrimarySigningAccountId != nextPrimarySigningAccountId
                && !activeAccounts.contains(where: { $0.id == previousPrimarySigningAccountId })
            let invalidatedDeviceSelection = !previousSelectedDeviceUdid.isEmpty
                && previousSelectedDeviceUdid != nextSelectedDeviceUdid
                && !devices.contains(where: { $0.id == previousSelectedDeviceUdid })

            primarySigningAccountId = nextPrimarySigningAccountId
            selectedAccountId = nextPrimarySigningAccountId
            selectedDeviceUdid = nextSelectedDeviceUdid

            do {
                let refreshedInstalledApps = try await api.listInstalledApps(
                    baseURL: identity.baseURL,
                    token: identity.token,
                    deviceUdid: nil
                )
                guard isCurrentPairingIdentity(identity) else { return }
                installedApps = refreshedInstalledApps
            } catch {
                guard isCurrentPairingIdentity(identity) else { return }
                if handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                    return
                }
                recordLocalActivity(
                    level: "warn",
                    code: "installed.refresh.partial",
                    message: "Installed app records could not be refreshed: \(error.localizedDescription)"
                )
            }

            guard isCurrentPairingIdentity(identity) else { return }
            await refreshDailyOperations(pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            await refreshLatestInstallJob(pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            await refreshSourceCatalogs(pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            await refreshTrustedSources(pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            await refreshDeviceInventory(pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            do {
                let refreshedStates = try await api.listAutoRefreshStates(
                    baseURL: identity.baseURL,
                    token: identity.token
                )
                guard isCurrentPairingIdentity(identity) else { return }
                autoRefreshStates = refreshedStates
            } catch {
                guard isCurrentPairingIdentity(identity) else { return }
                if handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                    return
                }
                recordLocalActivity(
                    level: "warn",
                    code: "scheduler.refresh.partial",
                    message: "Auto-refresh states could not be refreshed: \(error.localizedDescription)"
                )
            }
            await loadAppIds(pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            connectSSEIfPossible(pairingIdentity: identity)
            errorMessage = nil

            var recoveryMessages: [String] = []
            if invalidatedPrimarySigningIdentity {
                recoveryMessages.append(activeAccounts.isEmpty
                    ? "Your primary signing identity is no longer available."
                    : "Your primary signing identity disappeared, so SideLink switched to the next active Apple ID.")
            }
            if invalidatedDeviceSelection {
                recoveryMessages.append(devices.isEmpty
                    ? "Your selected device is no longer available."
                    : "Your selected device was removed, so SideLink switched to another connected device.")
            }
            if !recoveryMessages.isEmpty {
                toastMessage = recoveryMessages.joined(separator: " ")
            }
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                hostReachable = false
                expireDailyOperationsAuthority(
                    message: dailyOperations == nil
                        ? nil
                        : "Today could not reach the paired host. Showing the last known status."
                )
                errorMessage = error.localizedDescription
            }
        }
    }

    func refreshSourceCatalogs(pairingIdentity identity: PairingIdentity) async {
        guard isCurrentPairingIdentity(identity) else { return }
        let request = nextSourceCatalogRead(pairingIdentity: identity)
        do {
            let sources = try await api.listSources(
                baseURL: request.identity.baseURL,
                token: request.identity.token
            )
            guard isCurrentSourceCatalogRead(
                generation: request.generation,
                pairingIdentity: request.identity
            ) else { return }
            sourceCatalogFailures = sources
                .filter { $0.enabled && $0.cachedManifest == nil }
                .map { "\($0.name): manifest is not available yet. Refresh the source from the desktop if this persists." }
            sourceCatalogs = sources
                .filter(\.enabled)
                .compactMap { source in
                    guard let manifest = source.cachedManifest else { return nil }
                    return SourceCatalog(
                        sourceId: source.id,
                        sourceURL: source.url,
                        manifest: manifest,
                        isBuiltIn: source.isBuiltIn
                    )
                }
                .sorted { $0.manifest.name.localizedCaseInsensitiveCompare($1.manifest.name) == .orderedAscending }
        } catch {
            if handleAuthorityLossIfUnauthorized(error, pairingIdentity: request.identity) {
                return
            }
            guard isCurrentSourceCatalogRead(
                generation: request.generation,
                pairingIdentity: request.identity
            ) else { return }
            sourceCatalogFailures = ["Desktop-managed sources could not be refreshed: \(error.localizedDescription)"]
            sourceCatalogs = []
        }
    }

    func refreshTrustedSources(pairingIdentity identity: PairingIdentity) async {
        guard isCurrentPairingIdentity(identity) else { return }
        do {
            let remoteSources = try await api.listTrustedSources(baseURL: identity.baseURL, token: identity.token)
            guard isCurrentPairingIdentity(identity) else { return }
            trustedSources = mergeTrustedSources(remoteSources)
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                trustedSources = Self.bundledTrustedSources
            }
        }
    }

    func refreshDeviceInventory(pairingIdentity identity: PairingIdentity) async {
        guard isCurrentPairingIdentity(identity) else { return }
        let targetDeviceUdid = selectedDeviceUdid.isEmpty ? (devices.first?.id ?? "") : selectedDeviceUdid
        guard !targetDeviceUdid.isEmpty else {
            unmanagedInstalledApps = []
            return
        }

        do {
            let inventory = try await api.listAllDeviceApps(
                baseURL: identity.baseURL,
                token: identity.token,
                deviceUdid: targetDeviceUdid
            )
            let currentTargetDeviceUdid = selectedDeviceUdid.isEmpty ? (devices.first?.id ?? "") : selectedDeviceUdid
            guard isCurrentPairingIdentity(identity), currentTargetDeviceUdid == targetDeviceUdid else { return }
            if !inventory.managed.isEmpty {
                installedApps = inventory.managed
            }
            unmanagedInstalledApps = inventory.unmanaged
        } catch {
            let currentTargetDeviceUdid = selectedDeviceUdid.isEmpty ? (devices.first?.id ?? "") : selectedDeviceUdid
            guard isCurrentPairingIdentity(identity), currentTargetDeviceUdid == targetDeviceUdid else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                unmanagedInstalledApps = []
            }
        }
    }

    private func loadAppIds(pairingIdentity identity: PairingIdentity) async {
        guard isCurrentPairingIdentity(identity) else { return }
        let request = nextAppIDRead(pairingIdentity: identity)
        do {
            async let idsCall = api.listAppIds(baseURL: request.identity.baseURL, token: request.identity.token)
            async let usageCall = api.getAppIdUsage(baseURL: request.identity.baseURL, token: request.identity.token)
            let (refreshedAppIds, refreshedUsage) = try await (idsCall, usageCall)
            guard isCurrentAppIDRead(
                generation: request.generation,
                pairingIdentity: request.identity
            ) else { return }
            appIds = refreshedAppIds
            appIdUsage = refreshedUsage
        } catch {
            if handleAuthorityLossIfUnauthorized(error, pairingIdentity: request.identity) {
                return
            }
            guard isCurrentAppIDRead(
                generation: request.generation,
                pairingIdentity: request.identity
            ) else { return }
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Clear Pairing

    func clearLiveHostStateAfterPairingIdentityChange() {
        pairingAttemptGeneration &+= 1
        isPairing = false
        isLoading = false
        loadingStates = [:]
        errorMessage = nil
        errorQueue = []
        toastMessage = nil
        refreshOwnershipGeneration &+= 1
        refreshInFlightIdentity = nil
        queuedRefreshIdentity = nil
        queuedRefreshShowsLoading = false
        activeJobPollingTask?.cancel()
        activeJobPollingTask = nil
        activeJobPollingJobId = nil
        activeJobPollingGeneration = nil
        sseReconnectTask?.cancel()
        sseReconnectTask = nil
        disconnectSSE()
        sseReconnectAttempt = 0

        status = nil
        config = nil
        accounts = []
        devices = []
        ipas = []
        installedApps = []
        operationJobsById = [:]
        activityError = nil
        activityLastSyncedAt = nil
        activityHostReachable = false
        activityAuthoritativeVersions = [:]
        activityMutationSuspensions = [:]
        activityReceiptValidationJobId = nil
        activityRefreshGeneration &+= 1
        activityAuthorityReadGeneration &+= 1
        activityAuthorityReadGenerationsByJob = [:]
        activeInstallJob = nil
        activeInstallLogs = []
        activeInstallLogJobId = nil
        expectedInstallJobId = nil
        selectedOperationJobId = nil
        selectedActivityReceiptJobId = nil
        hasPendingInstallPresentation = false
        installConsolePresentationJobId = nil
        installConsolePresented = false
        installConsoleTitle = ""
        installConsoleSubtitle = ""
        installConsoleAutoPresentationSuppressed = false
        installConsoleAllowsNextDismissal = false
        activeInstall2FACode = ""
        pendingAppleAuth = nil
        pendingAppleAuthIdentity = nil
        lastInstallRequest = nil
        pendingJobCommandKeys = [:]

        helperLogs = []
        localActivityLogs = []
        appIds = []
        appIdUsage = []
        certificates = []
        unmanagedInstalledApps = []
        autoRefreshStates = []
        sourceCatalogs = []
        trustedSources = Self.bundledTrustedSources
        sourceCatalogFailures = []

        primarySigningAccountId = ""
        selectedAccountId = ""
        selectedDeviceUdid = ""
        serverName = ""
        serverVersion = ""
        deviceId = ""
        hostReachable = false
        hostLastReachedAt = nil
        invalidateDailyOperationsAuthority(
            message: dailyOperations == nil
                ? nil
                : (hasPairingCredential
                    ? "Today needs a fresh connection to the paired host."
                    : "Re-pair with your desktop to update Today.")
        )
        invalidateDailyOperationSelection()
    }

    func clearPairing() {
        invalidateDailyOperationsAuthority(message: nil)
        invalidateDailyOperationSelection()
        activeJobPollingTask?.cancel()
        activeJobPollingTask = nil
        activeJobPollingJobId = nil
        activeJobPollingGeneration = nil
        sseReconnectTask?.cancel()
        sseReconnectTask = nil
        disconnectSSE()
        clearCommittedPairingIdentity()
        status = nil
        config = nil
        accounts = []
        devices = []
        ipas = []
        installedApps = []
        dailyOperations = nil
        dailyOperationsError = nil
        dailyOperationsLastSyncedAt = nil
        hostReachable = false
        hostLastReachedAt = nil
        operationJobsById = [:]
        activityError = nil
        activityLastSyncedAt = nil
        activityHostReachable = false
        activityAuthoritativeVersions = [:]
        activityMutationSuspensions = [:]
        activityReceiptValidationJobId = nil
        activityRefreshGeneration &+= 1
        activityAuthorityReadGeneration &+= 1
        activityAuthorityReadGenerationsByJob = [:]
        activeInstallJob = nil
        activeInstallLogs = []
        activeInstallLogJobId = nil
        expectedInstallJobId = nil
        selectedOperationJobId = nil
        selectedActivityReceiptJobId = nil
        hasPendingInstallPresentation = false
        sourceCatalogs = []
        trustedSources = []
        helperLogs = []
        localActivityLogs = []
        appIds = []
        appIdUsage = []
        certificates = []
        unmanagedInstalledApps = []
        autoRefreshStates = []
        sourceCatalogFailures = []
        activeInstall2FACode = ""
        installConsoleTitle = ""
        installConsoleSubtitle = ""
        installConsolePresentationJobId = nil
        installConsolePresented = false
        installConsoleAutoPresentationSuppressed = false
        installConsoleAllowsNextDismissal = false
        lastInstallRequest = nil
        pendingJobCommandKeys = [:]
        primarySigningAccountId = ""
        selectedAccountId = ""
        selectedDeviceUdid = ""
    }

    // MARK: - Logs & Certificates

    func loadHelperLogs(level: String? = nil) async {
        guard let identity = currentPairingIdentity() else {
            _ = requirePairing(for: "view helper logs")
            return
        }

        errorMessage = nil
        do {
            let refreshedLogs = try await api.listLogs(
                baseURL: identity.baseURL,
                token: identity.token,
                level: level
            )
            guard isCurrentPairingIdentity(identity) else { return }
            helperLogs = refreshedLogs
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                errorMessage = error.localizedDescription
            }
        }
    }

    func loadAppIds(sync: Bool = false) async {
        guard let capturedIdentity = currentPairingIdentity() else {
            _ = requirePairing(for: "view App IDs")
            return
        }
        let identity: PairingIdentity
        if sync {
            guard let authorizedIdentity = await requireCurrentHostAuthority(
                for: "synchronize App IDs",
                identity: capturedIdentity
            ) else { return }
            identity = authorizedIdentity
        } else {
            identity = capturedIdentity
        }
        let request = nextAppIDRead(pairingIdentity: identity)

        errorMessage = nil
        do {
            async let idsCall = api.listAppIds(baseURL: request.identity.baseURL, token: request.identity.token, sync: sync)
            async let usageCall = api.getAppIdUsage(baseURL: request.identity.baseURL, token: request.identity.token)
            let (refreshedAppIds, refreshedUsage) = try await (idsCall, usageCall)
            guard isCurrentAppIDRead(
                generation: request.generation,
                pairingIdentity: request.identity
            ) else { return }
            appIds = refreshedAppIds
            appIdUsage = refreshedUsage
        } catch {
            if handleAuthorityLossIfUnauthorized(error, pairingIdentity: request.identity) {
                return
            }
            guard isCurrentAppIDRead(
                generation: request.generation,
                pairingIdentity: request.identity
            ) else { return }
            errorMessage = error.localizedDescription
        }
    }

    func deleteAppId(_ appId: String) async {
        guard let identity = await requireCurrentHostAuthority(for: "delete App IDs") else { return }

        errorMessage = nil
        do {
            try await api.deleteAppId(
                baseURL: identity.baseURL,
                token: identity.token,
                appId: appId
            )
            guard isCurrentPairingIdentity(identity) else { return }
            toastMessage = "App ID removed"
            await loadAppIds(pairingIdentity: identity)
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                errorMessage = error.localizedDescription
            }
        }
    }

    func loadCertificates() async {
        guard let identity = currentPairingIdentity() else {
            _ = requirePairing(for: "view certificates")
            return
        }

        errorMessage = nil
        do {
            let refreshedCertificates = try await api.listCertificates(
                baseURL: identity.baseURL,
                token: identity.token
            )
            guard isCurrentPairingIdentity(identity) else { return }
            certificates = refreshedCertificates
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                errorMessage = error.localizedDescription
            }
        }
    }

    // MARK: - Discovery

    func applyDiscoveredBackend(_ backend: DiscoveredBackend) {
        backendURL = backend.url
        errorMessage = nil
    }

    // MARK: - Internal Helpers

    func requirePairing(for action: String) -> Bool {
        guard isPaired else {
            errorMessage = "Pair with a SideLink server before you \(action)."
            return false
        }
        return true
    }

    func requireInstallReadiness() -> Bool {
        guard let message = installReadinessMessage else {
            return true
        }

        errorMessage = message
        return false
    }

    func recordLocalActivity(level: String, code: String, message: String) {
        let entry = HelperLogEntryDTO(
            id: "local-\(UUID().uuidString)",
            level: level,
            code: code,
            message: message,
            at: ISO8601DateFormatter().string(from: Date())
        )
        localActivityLogs.insert(entry, at: 0)
        if localActivityLogs.count > 100 {
            localActivityLogs.removeLast(localActivityLogs.count - 100)
        }
    }

    func isValidRemoteURL(_ raw: String) -> Bool {
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(), let host = url.host else {
            return false
        }
        guard scheme == "https" || scheme == "http" else {
            return false
        }
        return scheme == "https" || isLocalHost(host)
    }

    private func resolvePrimarySigningAccountId(preferred: String? = nil) -> String {
        let candidates = [preferred, primarySigningAccountId, persistedPrimarySigningAccountId, selectedAccountId]
            .compactMap { value -> String? in
                guard let value, !value.isEmpty else { return nil }
                return value
            }

        for candidate in candidates {
            if activeAccounts.contains(where: { $0.id == candidate }) {
                return candidate
            }
        }

        return automaticPrimarySigningAccount()?.id ?? ""
    }

    private func automaticPrimarySigningAccount() -> AccountDTO? {
        activeAccounts.min { lhs, rhs in
            let lhsDate = accountCreatedDate(lhs)
            let rhsDate = accountCreatedDate(rhs)

            switch (lhsDate, rhsDate) {
            case let (lhsDate?, rhsDate?):
                if lhsDate != rhsDate {
                    return lhsDate < rhsDate
                }
            case (_?, nil):
                return true
            case (nil, _?):
                return false
            default:
                break
            }

            return lhs.appleId.localizedCaseInsensitiveCompare(rhs.appleId) == .orderedAscending
        }
    }

    private func accountCreatedDate(_ account: AccountDTO) -> Date? {
        guard let createdAt = account.createdAt, !createdAt.isEmpty else { return nil }
        return ISO8601DateFormatter().date(from: createdAt)
    }

    // MARK: - SSE

    func connectSSEIfPossible(pairingIdentity: PairingIdentity? = nil) {
        guard let identity = pairingIdentity ?? currentPairingIdentity(),
              isCurrentPairingIdentity(identity),
              let url = URL(string: identity.baseURL + "/api/helper/events")
        else {
            return
        }
        if activeSSEConnectionID != nil, activeSSEPairingIdentity == identity {
            return
        }
        sseReconnectTask?.cancel()
        let connectionID = sseClient.connect(
            url: url,
            headers: ["x-sidelink-helper-token": identity.token]
        )
        activeSSEConnectionID = connectionID
        activeSSEPairingIdentity = identity
    }

    private func scheduleSSEReconnect(pairingIdentity identity: PairingIdentity) {
        guard isCurrentPairingIdentity(identity) else { return }
        sseReconnectTask?.cancel()

        guard sseReconnectAttempt < Self.sseMaxRetries else {
            pushError("Connection lost — could not reconnect after \(Self.sseMaxRetries) attempts. Pull to refresh manually or re-pair.")
            return
        }

        let attempt = min(sseReconnectAttempt, 5)
        let delaySeconds = pow(2.0, Double(attempt))
        sseReconnectAttempt += 1
        sseReconnectTask = Task { [weak self] in
            guard let self else { return }
            await self.sseReconnectSleep(min(delaySeconds, 30))
            guard !Task.isCancelled else { return }
            guard self.isCurrentPairingIdentity(identity) else { return }
            self.connectSSEIfPossible(pairingIdentity: identity)
        }
    }

    private func handleCurrentSSETransportClosure(
        connectionID: UUID,
        pairingIdentity identity: PairingIdentity
    ) {
        guard activeSSEConnectionID == connectionID,
              activeSSEPairingIdentity == identity,
              isCurrentPairingIdentity(identity)
        else {
            return
        }
        activeSSEConnectionID = nil
        activeSSEPairingIdentity = nil
        sseConnected = false
        hostReachable = false
        sseClient.disconnect()
        scheduleSSEReconnect(pairingIdentity: identity)
    }

    private func disconnectSSE() {
        activeSSEConnectionID = nil
        activeSSEPairingIdentity = nil
        sseConnected = false
        sseClient.disconnect()
    }

    private func pairingDraftDidChange() {
        pairingAttemptGeneration &+= 1
        isPairing = false
    }

    @discardableResult
    func replacePairingIdentity(baseURL: String, token: String) -> Bool {
        let normalizedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedBaseURL = normalizedToken.isEmpty ? "" : (normalizedBackendURL(baseURL) ?? "")
        guard normalizedToken.isEmpty || !normalizedBaseURL.isEmpty else { return false }

        if normalizedToken.isEmpty {
            return clearCommittedPairingIdentity()
        }

        let storedIdentity: PairingCredentialStorage.StoredIdentity
        let liveIdentityMatches = pairedBackendURL == normalizedBaseURL
            && helperToken == normalizedToken
            && !storedPairingIdentityID.isEmpty
        if liveIdentityMatches,
           let persistedIdentity = loadStoredPairingIdentity(),
           persistedIdentity.id == storedPairingIdentityID,
           persistedIdentity.baseURL == normalizedBaseURL,
           persistedIdentity.token == normalizedToken,
           !PairingCredentialStorage.isRevoked(identityID: persistedIdentity.id)
        {
            storedIdentity = persistedIdentity
        } else {
            guard let writtenIdentity = storePairingIdentity(normalizedBaseURL, normalizedToken),
                  !PairingCredentialStorage.isRevoked(identityID: writtenIdentity.id),
                  let persistedIdentity = loadStoredPairingIdentity(),
                  persistedIdentity == writtenIdentity,
                  persistedIdentity.baseURL == normalizedBaseURL,
                  persistedIdentity.token == normalizedToken
            else {
                return false
            }
            storedIdentity = persistedIdentity
        }

        let changed = storedPairingIdentityID != storedIdentity.id
            || pairedBackendURL != storedIdentity.baseURL
            || helperToken != storedIdentity.token
        storedPairingIdentityID = storedIdentity.id
        pairedBackendURL = storedIdentity.baseURL
        helperToken = storedIdentity.token
        _ = KeychainStore.remove(PairingCredentialStorage.tokenKey)
        legacyHelperToken = ""
        if changed {
            pairingIdentityDidChange()
            dailyOperations = nil
            dailyOperationsError = nil
            dailyOperationsLastSyncedAt = nil
        }
        return true
    }

    @discardableResult
    func clearCommittedPairingIdentity() -> Bool {
        guard let storedIdentity = liveStoredPairingIdentity() else {
            forceClearLivePairingIdentityAfterStorageFailure()
            return true
        }

        PairingCredentialStorage.markRevoked(identityID: storedIdentity.id)
        let storageCleared = revokeStoredPairingIdentity(storedIdentity)
        forceClearLivePairingIdentityAfterStorageFailure()
        return storageCleared
    }

    @discardableResult
    func revokeCommittedPairingIdentity(pairingIdentity identity: PairingIdentity) -> Bool {
        guard storedPairingIdentityID == identity.id,
              pairedBackendURL == identity.baseURL,
              helperToken == identity.token
        else { return true }

        let storedIdentity = PairingCredentialStorage.StoredIdentity(
            id: identity.id,
            baseURL: identity.baseURL,
            token: identity.token
        )
        PairingCredentialStorage.markRevoked(identityID: identity.id)
        let storageCleared = revokeStoredPairingIdentity(storedIdentity)
        forceClearLivePairingIdentityAfterStorageFailure()
        return storageCleared
    }

    @discardableResult
    func reconcilePairingAuthority(
        message: String = "Your helper token is no longer valid. Re-pair with your desktop."
    ) -> Bool {
        guard let liveIdentity = liveStoredPairingIdentity() else { return false }
        let persistedIdentity = loadStoredPairingIdentity()
        guard !PairingCredentialStorage.isRevoked(identityID: liveIdentity.id),
              persistedIdentity == liveIdentity
        else {
            PairingCredentialStorage.markRevoked(identityID: liveIdentity.id)
            _ = revokeStoredPairingIdentity(liveIdentity)
            forceClearLivePairingIdentityAfterStorageFailure()
            hostReachable = false
            expireDailyOperationsAuthority(message: "Re-pair with your desktop to update Today.")
            errorMessage = message
            return true
        }
        return false
    }

    private func liveStoredPairingIdentity() -> PairingCredentialStorage.StoredIdentity? {
        guard !storedPairingIdentityID.isEmpty,
              !pairedBackendURL.isEmpty,
              !helperToken.isEmpty
        else { return nil }
        return PairingCredentialStorage.StoredIdentity(
            id: storedPairingIdentityID,
            baseURL: pairedBackendURL,
            token: helperToken
        )
    }

    func forceClearLivePairingIdentityAfterStorageFailure() {
        let changed = !storedPairingIdentityID.isEmpty || !pairedBackendURL.isEmpty || !helperToken.isEmpty
        storedPairingIdentityID = ""
        pairedBackendURL = ""
        helperToken = ""
        legacyHelperToken = ""
        if changed {
            pairingIdentityDidChange()
        }
    }

    private func isLocalHost(_ host: String) -> Bool {
        SidelinkNetworkUtil.isLocalHost(host)
    }

    // MARK: - SSE Event Handling

    func handleSSEEvent(event: String, data: String, pairingIdentity identity: PairingIdentity) {
        guard isCurrentPairingIdentity(identity), !data.isEmpty else {
            return
        }

        if isAuthorityRevocationEvent(event: event, data: data) {
            losePairingAuthority(pairingIdentity: identity)
            return
        }

        if event == "job-update" {
            let payload = parseJSONDictionary(data)
            if let jobId = payload?["jobId"] as? String ?? payload?["id"] as? String {
                let authorityRead = beginActivityDetailAuthorityRead(
                    jobId: jobId,
                    purpose: .invalidation
                )
                Task {
                    do {
                        let job = try await api.getInstallJob(
                            baseURL: identity.baseURL,
                            token: identity.token,
                            jobId: jobId
                        )
                        guard isCurrentPairingIdentity(identity) else { return }
                        guard let renderedJob = publishActivityDetailAuthority(
                            job,
                            readToken: authorityRead
                        ) else { return }
                        let ownsConsole = if let selectedJobId = selectedOperationJobId {
                            selectedJobId == jobId
                        } else {
                            expectedInstallJobId == jobId
                                || installConsolePresentationJobId == jobId
                                || activeInstallJob?.id == jobId
                        }
                        if ownsConsole {
                            let snapshot = applyInstallSnapshot(renderedJob, pairingIdentity: identity)
                            if installConsoleTitle.isEmpty {
                                installConsoleTitle = inferredInstallName(for: snapshot)
                            }
                            if installConsoleSubtitle.isEmpty {
                                installConsoleSubtitle = inferredInstallSubtitle(for: snapshot)
                            }
                            if isInstallJobInFlight(snapshot) && !installConsoleAutoPresentationSuppressed {
                                installConsolePresented = true
                            }
                        }
                        await refreshDailyOperations(pairingIdentity: identity)
                    } catch HelperAPIError.notFound(_) {
                        guard isCurrentPairingIdentity(identity) else { return }
                        _ = invalidateActivityDetailAuthority(
                            jobId: jobId,
                            readToken: authorityRead
                        )
                    } catch {
                        guard isCurrentPairingIdentity(identity) else { return }
                        if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                            finishActivityDetailAuthorityReadFailure(
                                jobId: jobId,
                                readToken: authorityRead
                            )
                        }
                    }
                }
                return
            }

            activityAuthoritativeVersions = [:]
            Task {
                await refreshDailyOperations(pairingIdentity: identity)
                guard isCurrentPairingIdentity(identity) else { return }
                await refreshLatestInstallJob(pairingIdentity: identity)
            }
            return
        }

        if event == "job-log" {
            guard let payload = parseJSONDictionary(data),
                  let jobId = payload["jobId"] as? String,
                  activeInstallJob?.id == jobId,
                  let logData = data.data(using: .utf8)
            else {
                return
            }
            guard let entry: InstallJobLogDTO = try? JSONDecoder().decode(InstallJobLogDTO.self, from: logData) else {
                return
            }

            let currentLogs = activeInstallLogJobId == jobId ? activeInstallLogs : []
            activeInstallLogs = InstallJobLogOrdering.merge(
                persisted: currentLogs,
                live: [entry],
                jobId: jobId,
                limit: Self.maxInstallLogEntries
            )
            activeInstallLogJobId = jobId
            if let activeInstallJob {
                self.activeInstallJob = reconcileInstallJob(activeInstallJob, logs: activeInstallLogs)
            }
            return
        }

        if event == "log" {
            guard let logData = data.data(using: .utf8),
                  let entry = try? JSONDecoder().decode(HelperLogEntryDTO.self, from: logData)
            else {
                return
            }

            helperLogs.removeAll { $0.id == entry.id }
            helperLogs.insert(entry, at: 0)
            if helperLogs.count > 200 {
                helperLogs.removeLast(helperLogs.count - 200)
            }
            return
        }

        if event == "device-update" || event == "account-update" {
            refreshAllAfterSSEInvalidation(pairingIdentity: identity)
            return
        }

        if event == "scheduler-update" || event == "app-update" {
            refreshAllAfterSSEInvalidation(pairingIdentity: identity)
        }
    }

    private func refreshAllAfterSSEInvalidation(pairingIdentity identity: PairingIdentity) {
        guard isCurrentPairingIdentity(identity) else { return }
        if queueRefreshIfInFlight(identity: identity, showLoading: false) {
            return
        }
        Task { [weak self] in
            await self?.refreshAllSilently(pairingIdentity: identity)
        }
    }

    private func parseJSONDictionary(_ raw: String) -> [String: Any]? {
        guard let data = raw.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data),
              let dict = value as? [String: Any]
        else {
            return nil
        }
        return dict
    }

    private func isAuthorityRevocationEvent(event: String, data: String) -> Bool {
        event == "authority-revoked"
            && parseJSONDictionary(data)?["reason"] as? String == "token_rotated"
    }

    // MARK: - Discovery (Network)

    private func ingestDiscovery(_ payload: DiscoveryBroadcastDTO) {
        guard let address = preferredDiscoveryAddress(from: payload.addresses) else {
            return
        }

        let host = address.contains(":") ? "[\(address)]" : address
        let url = "http://\(host):\(payload.port)"
        let now = Date()

        if let idx = discoveredBackends.firstIndex(where: { $0.url == url }) {
            discoveredBackends[idx].name = payload.name
            discoveredBackends[idx].lastSeenAt = now
        } else {
            discoveredBackends.append(
                DiscoveredBackend(
                    id: url,
                    name: payload.name,
                    url: url,
                    lastSeenAt: now
                )
            )
        }

        discoveredBackends = discoveredBackends
            .filter { now.timeIntervalSince($0.lastSeenAt) < 20 }
            .sorted { $0.lastSeenAt > $1.lastSeenAt }

        if !isPaired && backendURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            backendURL = url
        }
    }

    private func preferredDiscoveryAddress(from addresses: [String]) -> String? {
        let cleaned = addresses
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        if let preferred = cleaned.first(where: { isPreferredDiscoveryHost($0) }) {
            return preferred
        }

        return cleaned.first(where: { !$0.hasPrefix("127.") && !$0.hasPrefix("169.254.") && $0 != "::1" })
    }

    private func isPreferredDiscoveryHost(_ host: String) -> Bool {
        let lower = host.lowercased()
        if lower.hasSuffix(".local") {
            return true
        }
        return isLocalHost(lower) && !lower.hasPrefix("127.") && !lower.hasPrefix("169.254.")
    }
}
