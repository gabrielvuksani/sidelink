import Foundation
import SwiftUI

@MainActor
final class HelperViewModel: ObservableObject {
    enum LastInstallRequest {
        case library(ipaId: String, appName: String, subtitle: String)
        case source(app: SourceAppDTO, sourceName: String, subtitle: String)
    }

    static let officialSourceURL = SidelinkSourceURLUtil.canonicalOfficialSourceURL
    static let installPollingTimeout: TimeInterval = 20 * 60
    static let maxInstallLogEntries = 300
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

    @AppStorage("backendURL") var backendURL = ""
    @AppStorage("helperToken") private var legacyHelperToken = ""
    @Published private(set) var helperToken = ""
    @AppStorage("serverName") var serverName = ""
    @AppStorage("serverVersion") var serverVersion = ""
    @AppStorage("deviceId") var deviceId = ""
    @AppStorage("customSourceURLs") var customSourceURLsJSON = "[]"
    @AppStorage("selectedAccountId") private var persistedSelectedAccountId = ""
    @AppStorage("primarySigningAccountId") private var persistedPrimarySigningAccountId = ""
    @AppStorage("selectedDeviceUdid") private var persistedSelectedDeviceUdid = ""

    @Published var pairingCode = ""
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

    let api = APIClient()
    private let discovery = DiscoveryListener()
    private let sseClient = SSEClient()
    var activeJobPollingTask: Task<Void, Never>?
    private var sseReconnectTask: Task<Void, Never>?
    private var sseReconnectAttempt = 0
    private static let sseMaxRetries = 10
    var lastInstallRequest: LastInstallRequest?
    var installConsoleAutoPresentationSuppressed = false
    var installConsoleAllowsNextDismissal = false
    private var refreshInFlight = false

    init() {
        if let stored = KeychainStore.get("helperToken"), !stored.isEmpty {
            helperToken = stored
        } else if !legacyHelperToken.isEmpty {
            helperToken = legacyHelperToken
            _ = KeychainStore.set("helperToken", value: legacyHelperToken)
            legacyHelperToken = ""
        }

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

        sseClient.onEvent = { [weak self] event, data in
            Task { @MainActor in
                self?.sseConnected = true
                self?.sseReconnectAttempt = 0
                self?.handleSSEEvent(event: event, data: data)
            }
        }

        sseClient.onFailure = { [weak self] _ in
            Task { @MainActor in
                self?.sseConnected = false
                self?.scheduleSSEReconnect()
            }
        }

        discovery.start()
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
        activeJobPollingTask?.cancel()
        activeJobPollingTask = nil
        sseReconnectTask?.cancel()
        sseReconnectTask = nil
        sseClient.disconnect()
        discovery.stop()
    }

    // MARK: - Computed Properties

    var isPaired: Bool {
        !helperToken.isEmpty
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

        let installAttention = activeInstallJob == nil ? 0 : 1
        return criticalExpirations + installAttention
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

        if let job = activeInstallJob {
            return inferredInstallName(for: job)
        }

        return "Install"
    }

    var installConsoleResolvedSubtitle: String {
        if !installConsoleSubtitle.isEmpty {
            return installConsoleSubtitle
        }

        if let job = activeInstallJob {
            return inferredInstallSubtitle(for: job)
        }

        return "Signing, provisioning, and device installation happen here in one place."
    }

    var activeInstallProgressFraction: Double {
        guard let job = activeInstallJob, !job.steps.isEmpty else { return isLoading ? 0.08 : 0 }
        let finished = job.steps.filter { $0.status == "completed" || $0.status == "skipped" }.count
        return min(1, max(Double(finished) / Double(job.steps.count), job.status == "completed" ? 1 : 0.08))
    }

    var installConsoleRequiresPersistentPresentation: Bool {
        activeInstallJob?.status == "waiting_2fa"
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

    var signingIdentityDisplayName: String {
        effectiveSigningAccount?.appleId ?? "No Apple ID"
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

    var latestUploadedIpa: IpaArtifactDTO? {
        ipas.max(by: { ($0.uploadedAt ?? "") < ($1.uploadedAt ?? "") }) ?? ipas.first
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

    func pair() async {
        let code = pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)
        errorMessage = nil
        guard code.count == 6, code.allSatisfy(\.isNumber) else {
            errorMessage = "Pairing code must be 6 digits."
            return
        }

        guard let normalized = normalizedBackendURL(backendURL) else {
            errorMessage = "Enter a valid backend URL (for example: http://sidelink.local:4010)."
            return
        }

        backendURL = normalized

        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await api.pair(baseURL: normalized, code: code)
            updateHelperToken(result.token)
            serverName = result.serverName ?? "SideLink"
            serverVersion = result.serverVersion ?? ""
            pairingCode = ""
            errorMessage = nil
            toastMessage = "Paired successfully"
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func pairUsingPayload(_ rawPayload: String) async -> Bool {
        guard applyPairingPayload(rawPayload) else {
            return false
        }

        await pair()
        return isPaired
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
        if let discoveredName = payload.serverName, !discoveredName.isEmpty {
            serverName = discoveredName
        }

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

    func refreshAll() async {
        await refreshAll(showLoading: true)
    }

    func refreshAllSilently() async {
        await refreshAll(showLoading: false)
    }

    private func refreshAll(showLoading: Bool) async {
        guard !refreshInFlight else { return }

        guard isPaired else {
            await refreshSourceCatalogs()
            await refreshTrustedSources()
            return
        }

        refreshInFlight = true
        if showLoading {
            isLoading = true
        }
        defer {
            refreshInFlight = false
            if showLoading {
                isLoading = false
            }
        }

        do {
            let previousPrimarySigningAccountId = primarySigningAccountId
            let previousSelectedDeviceUdid = selectedDeviceUdid
            async let statusCall = api.fetchStatus(baseURL: backendURL, token: helperToken, deviceId: selectedDeviceUdid.isEmpty ? (deviceId.isEmpty ? nil : deviceId) : selectedDeviceUdid)
            async let configCall = api.fetchConfig(baseURL: backendURL, token: helperToken)
            async let accountCall = api.listAccounts(baseURL: backendURL, token: helperToken)
            async let ipaCall = api.listIpas(baseURL: backendURL, token: helperToken)

            let statusResponse = try await statusCall
            let configResponse = try await configCall
            let accountResponse = try await accountCall
            let ipaResponse = try await ipaCall
            let deviceResponse = (try? await api.listDevices(baseURL: backendURL, token: helperToken)) ?? statusResponse.devices

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

            let installedDeviceFilter = selectedDeviceUdid.isEmpty ? (deviceId.isEmpty ? nil : deviceId) : selectedDeviceUdid
            do {
                installedApps = try await api.listInstalledApps(
                    baseURL: backendURL,
                    token: helperToken,
                    deviceUdid: installedDeviceFilter
                )
            } catch {
                recordLocalActivity(
                    level: "warn",
                    code: "installed.refresh.partial",
                    message: "Installed app records could not be refreshed: \(error.localizedDescription)"
                )
            }

            await refreshLatestInstallJob()
            await refreshSourceCatalogs()
            await refreshTrustedSources()
            await refreshDeviceInventory()
            do {
                autoRefreshStates = try await api.listAutoRefreshStates(baseURL: backendURL, token: helperToken)
            } catch {
                recordLocalActivity(
                    level: "warn",
                    code: "scheduler.refresh.partial",
                    message: "Auto-refresh states could not be refreshed: \(error.localizedDescription)"
                )
            }
            await loadAppIds()
            connectSSEIfPossible()
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
            if case HelperAPIError.unauthorized = error {
                // Token is no longer valid -- clear it so the user is prompted to
                // re-pair instead of repeatedly hitting 401 on every refresh.
                updateHelperToken("")
                backendURL = ""
                accounts = []
                devices = []
                ipas = []
                installedApps = []
                config = nil
                status = nil
                sseClient.disconnect()
                errorMessage = "Your helper token is no longer valid. Please re-pair with your desktop."
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    // MARK: - Clear Pairing

    func clearPairing() {
        activeJobPollingTask?.cancel()
        activeJobPollingTask = nil
        sseReconnectTask?.cancel()
        sseReconnectTask = nil
        sseClient.disconnect()
        sseConnected = false
        updateHelperToken("")
        status = nil
        config = nil
        accounts = []
        devices = []
        ipas = []
        installedApps = []
        activeInstallJob = nil
        activeInstallLogs = []
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
        installConsolePresented = false
        installConsoleAutoPresentationSuppressed = false
        installConsoleAllowsNextDismissal = false
        lastInstallRequest = nil
        primarySigningAccountId = ""
        selectedAccountId = ""
        selectedDeviceUdid = ""
    }

    // MARK: - Logs & Certificates

    func loadHelperLogs(level: String? = nil) async {
        guard requirePairing(for: "view helper logs") else { return }

        errorMessage = nil
        do {
            helperLogs = try await api.listLogs(baseURL: backendURL, token: helperToken, level: level)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadAppIds(sync: Bool = false) async {
        guard requirePairing(for: "view App IDs") else { return }

        errorMessage = nil
        do {
            async let idsCall = api.listAppIds(baseURL: backendURL, token: helperToken, sync: sync)
            async let usageCall = api.getAppIdUsage(baseURL: backendURL, token: helperToken)
            appIds = try await idsCall
            appIdUsage = try await usageCall
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deleteAppId(_ appId: String) async {
        guard requirePairing(for: "delete App IDs") else { return }

        errorMessage = nil
        do {
            try await api.deleteAppId(baseURL: backendURL, token: helperToken, appId: appId)
            toastMessage = "App ID removed"
            await loadAppIds()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadCertificates() async {
        guard requirePairing(for: "view certificates") else { return }

        errorMessage = nil
        do {
            certificates = try await api.listCertificates(baseURL: backendURL, token: helperToken)
        } catch {
            errorMessage = error.localizedDescription
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

    private func connectSSEIfPossible() {
        guard isPaired,
              let url = URL(string: backendURL + "/api/helper/events")
        else {
            return
        }
        sseReconnectTask?.cancel()
        sseClient.connect(url: url, headers: ["x-sidelink-helper-token": helperToken])
    }

    private func scheduleSSEReconnect() {
        guard isPaired else { return }
        sseReconnectTask?.cancel()

        guard sseReconnectAttempt < Self.sseMaxRetries else {
            pushError("Connection lost — could not reconnect after \(Self.sseMaxRetries) attempts. Pull to refresh manually or re-pair.")
            return
        }

        let attempt = min(sseReconnectAttempt, 5)
        let delaySeconds = pow(2.0, Double(attempt))
        sseReconnectAttempt += 1
        sseReconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(min(delaySeconds, 30) * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.connectSSEIfPossible()
            }
        }
    }

    private func updateHelperToken(_ token: String) {
        helperToken = token
        if token.isEmpty {
            _ = KeychainStore.remove("helperToken")
        } else {
            _ = KeychainStore.set("helperToken", value: token)
        }
        legacyHelperToken = ""
    }

    private func isLocalHost(_ host: String) -> Bool {
        SidelinkNetworkUtil.isLocalHost(host)
    }

    // MARK: - SSE Event Handling

    private func handleSSEEvent(event: String, data: String) {
        guard !data.isEmpty else {
            return
        }

        if event == "job-update" {
            let payload = parseJSONDictionary(data)
            if let jobId = payload?["jobId"] as? String ?? payload?["id"] as? String {
                Task {
                    do {
                        let job = try await api.getInstallJob(baseURL: backendURL, token: helperToken, jobId: jobId)
                        await MainActor.run {
                            let snapshot = self.applyInstallSnapshot(job)
                            if self.installConsoleTitle.isEmpty {
                                self.installConsoleTitle = self.inferredInstallName(for: snapshot)
                            }
                            if self.installConsoleSubtitle.isEmpty {
                                self.installConsoleSubtitle = self.inferredInstallSubtitle(for: snapshot)
                            }
                            if self.isInstallJobInFlight(snapshot) && !self.installConsoleAutoPresentationSuppressed {
                                self.installConsolePresented = true
                            }
                        }
                    } catch {
                        // Leave existing progress state intact.
                    }
                }
                return
            }

            Task {
                await refreshLatestInstallJob()
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
            activeInstallLogs.append(entry)
            if activeInstallLogs.count > Self.maxInstallLogEntries {
                activeInstallLogs.removeFirst(activeInstallLogs.count - Self.maxInstallLogEntries)
            }
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

        if event == "device-update" {
            Task {
                await refreshAllSilently()
            }
            return
        }

        if event == "scheduler-update" || event == "app-update" {
            Task {
                await refreshAllSilently()
            }
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
