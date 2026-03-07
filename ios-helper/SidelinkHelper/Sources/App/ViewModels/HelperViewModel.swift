import Foundation
import SwiftUI

@MainActor
final class HelperViewModel: ObservableObject {
    private enum LastInstallRequest {
        case library(ipaId: String, appName: String, subtitle: String)
        case source(app: SourceAppDTO, sourceName: String, subtitle: String)
    }

    private static let officialSourceURL = SidelinkSourceURLUtil.canonicalOfficialSourceURL
    private static let installPollingTimeout: TimeInterval = 20 * 60
    private static let maxInstallLogEntries = 300
    private static let bundledTrustedSources: [TrustedSourceDTO] = [
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
            name: "Sidelink Official",
            url: officialSourceURL,
            iconURL: "https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/build/icons/icon-1024.png",
            description: "The default source shipped with Sidelink."
        ),
    ]

    @AppStorage("backendURL") var backendURL = ""
    @AppStorage("helperToken") private var legacyHelperToken = ""
    @Published private(set) var helperToken = ""
    @AppStorage("serverName") var serverName = ""
    @AppStorage("serverVersion") var serverVersion = ""
    @AppStorage("deviceId") var deviceId = ""
    @AppStorage("customSourceURLs") private var customSourceURLsJSON = "[]"
    @AppStorage("selectedAccountId") private var persistedSelectedAccountId = ""
    @AppStorage("primarySigningAccountId") private var persistedPrimarySigningAccountId = ""
    @AppStorage("selectedDeviceUdid") private var persistedSelectedDeviceUdid = ""

    @Published var pairingCode = ""
    @Published var importURL = ""
    @Published var selectedAccountId = "" {
        didSet { persistedSelectedAccountId = selectedAccountId }
    }
    @Published private(set) var primarySigningAccountId = "" {
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
    @Published var sseConnected = false
    @Published var sourceCatalogFailures: [String] = []

    private let api = APIClient()
    private let discovery = DiscoveryListener()
    private let sseClient = SSEClient()
    private var activeJobPollingTask: Task<Void, Never>?
    private var sseReconnectTask: Task<Void, Never>?
    private var sseReconnectAttempt = 0
    private var lastInstallRequest: LastInstallRequest?
    private var installConsoleAutoPresentationSuppressed = false

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
        activeJobPollingTask?.cancel()
        sseReconnectTask?.cancel()
        sseClient.disconnect()
        discovery.stop()
    }

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
            return "Pair with a Sidelink server to install or refresh apps"
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
        return "Sidelink defaults to \(account.appleId) for signing and installs to \(device)."
    }

    var installPreparationSummary: String {
        installSubtitle(base: "Importing the IPA if needed, then using your primary signing identity for the install.")
    }

    func isOfficialSourceURL(_ url: String) -> Bool {
        SidelinkSourceURLUtil.normalized(url).caseInsensitiveCompare(Self.officialSourceURL) == .orderedSame
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
            serverName = result.serverName ?? "Sidelink"
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

    func refreshAll() async {
        guard isPaired else {
            await refreshSourceCatalogs()
            await refreshTrustedSources()
            return
        }

        isLoading = true
        defer { isLoading = false }

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
            connectSSEIfPossible()
            errorMessage = nil

            var recoveryMessages: [String] = []
            if invalidatedPrimarySigningIdentity {
                recoveryMessages.append(activeAccounts.isEmpty
                    ? "Your primary signing identity is no longer available."
                    : "Your primary signing identity disappeared, so Sidelink switched to the next active Apple ID.")
            }
            if invalidatedDeviceSelection {
                recoveryMessages.append(devices.isEmpty
                    ? "Your selected device is no longer available."
                    : "Your selected device was removed, so Sidelink switched to another connected device.")
            }
            if !recoveryMessages.isEmpty {
                toastMessage = recoveryMessages.joined(separator: " ")
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func triggerRefresh(installId: String) async {
        guard requirePairing(for: "refresh installed apps") else { return }

        errorMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            try await api.triggerRefresh(baseURL: backendURL, token: helperToken, installId: installId)
            toastMessage = "Refresh triggered"
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func importFromURL() async {
        guard requirePairing(for: "import IPA URLs") else { return }

        errorMessage = nil
        let raw = importURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else {
            errorMessage = "Enter an IPA URL first"
            return
        }

        guard isValidRemoteURL(raw) else {
            errorMessage = "Invalid IPA URL"
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            if let fileName = URL(string: raw)?.lastPathComponent,
               ipas.contains(where: { $0.originalName == fileName }) {
                toastMessage = "An IPA with this filename is already in your library"
                return
            }

            let imported = try await api.importIpaFromURL(baseURL: backendURL, token: helperToken, urlString: raw)
            let isDuplicateBundle = ipas.contains(where: { $0.bundleId == imported.bundleId && $0.id != imported.id })
            importURL = ""
            toastMessage = isDuplicateBundle
                ? "Imported, but bundle ID \(imported.bundleId) already exists in your library"
                : "IPA imported"
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func importLocalIpa(fileName: String, fileData: Data) async {
        guard requirePairing(for: "upload IPA files") else { return }

        errorMessage = nil
        guard !fileData.isEmpty else {
            errorMessage = "The selected IPA file is empty"
            return
        }

        let normalizedName = fileName.trimmingCharacters(in: .whitespacesAndNewlines)
        let effectiveName = normalizedName.isEmpty ? "Imported.ipa" : normalizedName
        guard effectiveName.lowercased().hasSuffix(".ipa") else {
            errorMessage = "Only .ipa files can be imported"
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            if ipas.contains(where: { $0.originalName.caseInsensitiveCompare(effectiveName) == .orderedSame }) {
                toastMessage = "An IPA with this filename is already in your library"
                return
            }

            let imported = try await api.uploadIpa(
                baseURL: backendURL,
                token: helperToken,
                fileName: effectiveName,
                fileData: fileData
            )

            let isDuplicateBundle = ipas.contains(where: { $0.bundleId == imported.bundleId && $0.id != imported.id })
            toastMessage = isDuplicateBundle
                ? "Uploaded, but bundle ID \(imported.bundleId) already exists in your library"
                : "IPA uploaded"
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func startInstall(ipaId: String, appName: String? = nil, subtitle: String? = nil) async {
        let resolvedName = appName ?? ipas.first(where: { $0.id == ipaId })?.bundleName ?? "Library App"
        let resolvedSubtitle = installSubtitle(base: subtitle ?? "Installing from your library")
        prepareInstallConsole(title: resolvedName, subtitle: resolvedSubtitle)
        lastInstallRequest = .library(ipaId: ipaId, appName: resolvedName, subtitle: resolvedSubtitle)

        guard requireInstallReadiness() else {
            return
        }

        errorMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            _ = try await api.startInstall(
                baseURL: backendURL,
                token: helperToken,
                ipaId: ipaId,
                accountId: primarySigningAccountId,
                deviceUdid: selectedDeviceUdid
            )
            await refreshLatestInstallJob()
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func installFromSource(_ app: SourceAppDTO, sourceName: String? = nil, subtitle: String? = nil) async {
        let resolvedSourceName = sourceName ?? sourceCatalogs.first(where: { $0.manifest.apps.contains(where: { $0.id == app.id }) })?.manifest.name ?? "Source"
        let resolvedSubtitle = installSubtitle(base: subtitle ?? "Installing from \(resolvedSourceName)")
        prepareInstallConsole(title: app.name, subtitle: resolvedSubtitle)
        lastInstallRequest = .source(app: app, sourceName: resolvedSourceName, subtitle: resolvedSubtitle)

        guard requireInstallReadiness() else {
            return
        }

        errorMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            let downloadURL = app.primaryDownloadURL
            guard !downloadURL.isEmpty else {
                errorMessage = "Selected source app has no download URL"
                return
            }

            let imported = try await api.importIpaFromURL(baseURL: backendURL, token: helperToken, urlString: downloadURL)
            _ = try await api.startInstall(
                baseURL: backendURL,
                token: helperToken,
                ipaId: imported.id,
                accountId: primarySigningAccountId,
                deviceUdid: selectedDeviceUdid
            )
            await refreshLatestInstallJob()
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func addSourceFromDeepLink(_ urlString: String) async {
        let raw = SidelinkSourceURLUtil.normalized(urlString)
        guard !raw.isEmpty, isValidRemoteURL(raw) else {
            recordLocalActivity(level: "warn", code: "source.import.invalid", message: "Rejected an invalid source URL.")
            toastMessage = "Invalid source URL"
            return
        }

        if customSourceURLs.contains(where: { SidelinkSourceURLUtil.normalized($0) == raw }) {
            recordLocalActivity(level: "info", code: "source.import.duplicate", message: "Skipped importing a source that was already added.")
            toastMessage = "Source already configured"
            return
        }

        do {
            let manifest = try await api.fetchSourceManifest(urlString: raw)
            customSourceURLs.append(raw)
            persistCustomSources()
            await refreshSourceCatalogs()
            recordLocalActivity(level: "info", code: "source.import.success", message: "Imported source \(manifest.name).")
            toastMessage = "Source imported from deep link"
        } catch {
            recordLocalActivity(level: "error", code: "source.import.failed", message: "Failed to import source: \(error.localizedDescription)")
            toastMessage = error.localizedDescription
        }
    }

    func addCustomSource() async {
        errorMessage = nil
        let raw = SidelinkSourceURLUtil.normalized(sourceURLInput)
        guard !raw.isEmpty else {
            recordLocalActivity(level: "warn", code: "source.import.empty", message: "Tried to import a source without entering a URL.")
            errorMessage = "Enter a source URL"
            return
        }

        guard isValidRemoteURL(raw) else {
            recordLocalActivity(level: "warn", code: "source.import.invalid", message: "Rejected an invalid source URL.")
            errorMessage = "Invalid source URL"
            return
        }

        if customSourceURLs.contains(where: { SidelinkSourceURLUtil.normalized($0) == raw }) {
            recordLocalActivity(level: "info", code: "source.import.duplicate", message: "Skipped importing a source that was already added.")
            errorMessage = "Source already added"
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let manifest = try await api.fetchSourceManifest(urlString: raw)
            customSourceURLs.append(raw)
            persistCustomSources()
            sourceURLInput = ""
            await refreshSourceCatalogs()
            recordLocalActivity(level: "info", code: "source.import.success", message: "Imported source \(manifest.name).")
            toastMessage = "Source added"
        } catch {
            recordLocalActivity(level: "error", code: "source.import.failed", message: "Failed to import source: \(error.localizedDescription)")
            errorMessage = error.localizedDescription
        }
    }

    func removeCustomSource(_ url: String) async {
        let normalized = SidelinkSourceURLUtil.normalized(url)
        customSourceURLs.removeAll { SidelinkSourceURLUtil.normalized($0) == normalized }
        persistCustomSources()
        await refreshSourceCatalogs()
    }

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
        sourceCatalogFailures = []
        activeInstall2FACode = ""
        installConsoleTitle = ""
        installConsoleSubtitle = ""
        installConsolePresented = false
        installConsoleAutoPresentationSuppressed = false
        lastInstallRequest = nil
        primarySigningAccountId = ""
        selectedAccountId = ""
        selectedDeviceUdid = ""
    }

    func refreshAllApps() async {
        guard requirePairing(for: "refresh all installed apps") else { return }

        errorMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await api.refreshAll(baseURL: backendURL, token: helperToken)
            toastMessage = "Triggered refresh for \(result.triggered) app\(result.triggered == 1 ? "" : "s")"
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deactivateInstalledApp(_ appId: String) async {
        guard requirePairing(for: "deactivate installed apps") else { return }

        errorMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            _ = try await api.deactivateInstalledApp(baseURL: backendURL, token: helperToken, appId: appId)
            toastMessage = "App deactivated"
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func reactivateInstalledApp(_ appId: String) async {
        guard requirePairing(for: "reactivate installed apps") else { return }

        errorMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            _ = try await api.reactivateInstalledApp(baseURL: backendURL, token: helperToken, appId: appId)
            toastMessage = "Reactivation queued"
            await refreshLatestInstallJob()
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

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

    func refreshTrustedSources() async {
        guard isPaired else {
            trustedSources = Self.bundledTrustedSources
            return
        }
        do {
            let remoteSources = try await api.listTrustedSources(baseURL: backendURL, token: helperToken)
            trustedSources = mergeTrustedSources(remoteSources)
        } catch {
            trustedSources = Self.bundledTrustedSources
        }
    }

    func addTrustedSource(_ source: TrustedSourceDTO) async {
        sourceURLInput = source.url
        await addCustomSource()
    }

    private func mergeTrustedSources(_ remoteSources: [TrustedSourceDTO]) -> [TrustedSourceDTO] {
        var mergedByURL: [String: TrustedSourceDTO] = [:]

        for source in Self.bundledTrustedSources {
            mergedByURL[SidelinkSourceURLUtil.normalized(source.url).lowercased()] = source
        }

        for source in remoteSources {
            mergedByURL[SidelinkSourceURLUtil.normalized(source.url).lowercased()] = source
        }

        let remoteURLs = Set(remoteSources.map { SidelinkSourceURLUtil.normalized($0.url).lowercased() })
        return mergedByURL.values.sorted { lhs, rhs in
            let lhsRemote = remoteURLs.contains(SidelinkSourceURLUtil.normalized(lhs.url).lowercased())
            let rhsRemote = remoteURLs.contains(SidelinkSourceURLUtil.normalized(rhs.url).lowercased())
            if lhsRemote != rhsRemote {
                return lhsRemote && !rhsRemote
            }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }

    func refreshDeviceInventory() async {
        guard isPaired else {
            unmanagedInstalledApps = []
            return
        }

        let targetDeviceUdid = selectedDeviceUdid.isEmpty ? (devices.first?.id ?? "") : selectedDeviceUdid
        guard !targetDeviceUdid.isEmpty else {
            unmanagedInstalledApps = []
            return
        }

        do {
            let inventory = try await api.listAllDeviceApps(baseURL: backendURL, token: helperToken, deviceUdid: targetDeviceUdid)
            if !inventory.managed.isEmpty {
                installedApps = inventory.managed
            }
            unmanagedInstalledApps = inventory.unmanaged
        } catch {
            unmanagedInstalledApps = []
        }
    }

    func submitActiveInstall2FA() async {
        guard requirePairing(for: "verify install jobs") else { return }
        guard let job = activeInstallJob, job.status == "waiting_2fa" else {
            errorMessage = "No install job is currently waiting for 2FA"
            return
        }

        installConsolePresented = true
        errorMessage = nil

        let code = activeInstall2FACode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard code.count == 6 else {
            errorMessage = "Enter the 6-digit verification code"
            return
        }

        do {
            try await api.submitInstallJob2FA(baseURL: backendURL, token: helperToken, jobId: job.id, code: code)
            activeInstall2FACode = ""
            let updated = try await api.getInstallJob(baseURL: backendURL, token: helperToken, jobId: job.id)
            let logs = await refreshActiveInstallLogs(jobId: updated.id)
            let resolved = applyInstallSnapshot(updated, logs: logs)
            if resolved.status == "running" || resolved.status == "queued" {
                beginPollingInstallJob(jobId: resolved.id)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func retryLastInstallRequest() async {
        guard let lastInstallRequest else {
            if let job = activeInstallJob {
                await startInstall(ipaId: job.ipaId, appName: inferredInstallName(for: job), subtitle: "Retrying install")
            }
            return
        }

        switch lastInstallRequest {
        case .library(let ipaId, let appName, let subtitle):
            await startInstall(ipaId: ipaId, appName: appName, subtitle: subtitle)
        case .source(let app, let sourceName, let subtitle):
            await installFromSource(app, sourceName: sourceName, subtitle: subtitle)
        }
    }

    func openInstallConsole() {
        installConsoleAutoPresentationSuppressed = false
        installConsolePresented = true
    }

    func dismissInstallConsole() {
        if let activeInstallJob, isInstallJobInFlight(activeInstallJob) {
            installConsoleAutoPresentationSuppressed = true
        }
        installConsolePresented = false
    }

    func applyDiscoveredBackend(_ backend: DiscoveredBackend) {
        backendURL = backend.url
        errorMessage = nil
    }

    func signInAppleAccount(appleId: String, password: String) async {
        guard isPaired else {
            errorMessage = "Pair with a Sidelink server before adding an Apple ID"
            return
        }

        let normalizedAppleId = appleId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedAppleId.isEmpty, !password.isEmpty else {
            errorMessage = "Apple ID and password are required"
            return
        }

        errorMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await api.signInAppleAccount(
                baseURL: backendURL,
                token: helperToken,
                appleId: normalizedAppleId,
                password: password
            )

            if response.requires2FA == true {
                pendingAppleAuth = PendingAppleAuthContext(
                    mode: .signIn,
                    appleId: normalizedAppleId,
                    password: password,
                    accountId: nil,
                    authType: response.authType
                )
                toastMessage = "Enter the 6-digit verification code to finish adding this Apple ID"
                return
            }

            guard let account = response.account else {
                errorMessage = "Apple sign-in returned an unexpected response"
                return
            }

            pendingAppleAuth = nil
            if primarySigningAccountId.isEmpty {
                setPrimarySigningAccount(account.id, showConfirmation: false)
                toastMessage = "Apple ID added and set as your primary signing identity"
            } else {
                toastMessage = "Apple ID added. Your primary signing identity stayed the same"
            }
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func reauthenticateAppleAccount(accountId: String) async {
        guard isPaired else {
            errorMessage = "Pair with a Sidelink server before re-authenticating Apple IDs"
            return
        }
        guard let account = accounts.first(where: { $0.id == accountId }) else {
            errorMessage = "Apple account not found"
            return
        }

        errorMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await api.reauthenticateAppleAccount(
                baseURL: backendURL,
                token: helperToken,
                accountId: accountId
            )

            if response.requires2FA == true {
                pendingAppleAuth = PendingAppleAuthContext(
                    mode: .reauth,
                    appleId: account.appleId,
                    password: "",
                    accountId: accountId,
                    authType: response.authType
                )
                toastMessage = "Enter the 6-digit verification code to re-authenticate \(account.appleId)"
                return
            }

            pendingAppleAuth = nil
            if primarySigningAccountId.isEmpty {
                setPrimarySigningAccount(accountId, showConfirmation: false)
                toastMessage = "Apple ID re-authenticated and set as your primary signing identity"
            } else {
                toastMessage = "Apple ID re-authenticated"
            }
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func submitPendingAppleAccount2FA(code: String) async {
        guard isPaired else {
            errorMessage = "Pair with a Sidelink server before verifying Apple IDs"
            return
        }
        guard let pendingAppleAuth else {
            errorMessage = "No Apple ID verification is pending"
            return
        }

        errorMessage = nil

        let trimmedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedCode.count == 6, trimmedCode.allSatisfy(\.isNumber) else {
            errorMessage = "Enter the 6-digit verification code"
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let account: AccountDTO
            switch pendingAppleAuth.mode {
            case .signIn:
                account = try await api.submitAppleAccount2FA(
                    baseURL: backendURL,
                    token: helperToken,
                    appleId: pendingAppleAuth.appleId,
                    password: pendingAppleAuth.password,
                    code: trimmedCode
                )
            case .reauth:
                guard let accountId = pendingAppleAuth.accountId else {
                    errorMessage = "Missing Apple account ID for verification"
                    return
                }
                account = try await api.submitAppleAccountReauth2FA(
                    baseURL: backendURL,
                    token: helperToken,
                    accountId: accountId,
                    code: trimmedCode
                )
            }

            self.pendingAppleAuth = nil
            if primarySigningAccountId.isEmpty {
                setPrimarySigningAccount(account.id, showConfirmation: false)
                toastMessage = "Apple ID verified and set as your primary signing identity"
            } else {
                toastMessage = "Apple ID verified successfully"
            }
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deleteAppleAccount(_ accountId: String) async {
        guard isPaired else {
            errorMessage = "Pair with a Sidelink server before removing Apple IDs"
            return
        }

        errorMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            let removedPrimarySigningIdentity = primarySigningAccountId == accountId
            try await api.deleteAppleAccount(baseURL: backendURL, token: helperToken, accountId: accountId)
            if removedPrimarySigningIdentity {
                primarySigningAccountId = ""
            }
            if selectedAccountId == accountId {
                selectedAccountId = ""
            }
            pendingAppleAuth = nil
            await refreshAll()
            if removedPrimarySigningIdentity {
                if let fallback = primaryActiveSigningAccount {
                    toastMessage = "Primary signing identity removed. Sidelink switched to \(fallback.appleId)"
                } else {
                    toastMessage = "Primary signing identity removed"
                }
            } else {
                toastMessage = "Apple ID removed"
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deleteInstalledApp(_ appId: String) async {
        guard requirePairing(for: "remove installed apps") else { return }

        errorMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            try await api.deleteInstalledApp(baseURL: backendURL, token: helperToken, appId: appId)
            installedApps.removeAll { $0.id == appId }
            toastMessage = "Removed installed app entry"
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadCustomSourcesFromStorage() {
        guard let data = customSourceURLsJSON.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([String].self, from: data)
        else {
            customSourceURLs = []
            return
        }
        customSourceURLs = Array(Set(decoded.map(SidelinkSourceURLUtil.normalized))).sorted()
    }

    private func ensureDefaultSourcePresent() {
        if !customSourceURLs.contains(where: { SidelinkSourceURLUtil.normalized($0) == Self.officialSourceURL }) {
            customSourceURLs.append(Self.officialSourceURL)
            persistCustomSources()
        }
    }

    private func persistCustomSources() {
        let unique = Array(Set(customSourceURLs.map(SidelinkSourceURLUtil.normalized))).sorted()
        customSourceURLs = unique
        let encoded = (try? JSONEncoder().encode(unique)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        customSourceURLsJSON = encoded
    }

    private func requirePairing(for action: String) -> Bool {
        guard isPaired else {
            errorMessage = "Pair with a Sidelink server before you \(action)."
            return false
        }
        return true
    }

    private func requireInstallReadiness() -> Bool {
        guard let message = installReadinessMessage else {
            return true
        }

        errorMessage = message
        return false
    }

    private func refreshSourceCatalogs() async {
        let feedURLs = ((config?.sourceFeeds.map { $0.url } ?? []) + customSourceURLs).map(SidelinkSourceURLUtil.normalized)
        let uniqueURLs = Array(Set(feedURLs + [Self.officialSourceURL])).sorted()

        var catalogs: [SourceCatalog] = []
        var failures: [String] = []
        for url in uniqueURLs {
            do {
                let manifest = try await api.fetchSourceManifest(urlString: url)
                catalogs.append(SourceCatalog(sourceURL: url, manifest: manifest))
            } catch {
                failures.append("\(url): \(error.localizedDescription)")
            }
        }

        sourceCatalogFailures = failures
        sourceCatalogs = catalogs.sorted { $0.manifest.name.localizedCaseInsensitiveCompare($1.manifest.name) == .orderedAscending }
    }

    private func prepareInstallConsole(title: String, subtitle: String) {
        installConsoleTitle = title
        installConsoleSubtitle = subtitle
        installConsoleAutoPresentationSuppressed = false
        installConsolePresented = true
        activeInstall2FACode = ""
        errorMessage = nil
    }

    private func inferredInstallName(for job: InstallJobDetailDTO) -> String {
        if let ipa = ipas.first(where: { $0.id == job.ipaId }) {
            return ipa.bundleName
        }

        if let install = installedApps.first(where: { $0.id == job.ipaId || $0.bundleId == job.ipaId || $0.originalBundleId == job.ipaId }) {
            return install.appName ?? install.bundleId
        }

        return "App Install"
    }

    private func inferredInstallSubtitle(for job: InstallJobDetailDTO) -> String {
        let account = accounts.first(where: { $0.id == job.accountId })?.appleId
        let device = devices.first(where: { $0.id == job.deviceUdid })?.name

        if let account, let device {
            return "Signing with \(account) on \(device)"
        }

        if let device {
            return "Signing and installing to \(device)"
        }

        return "Signing, provisioning, and device installation happen here in one place."
    }

    private func installSubtitle(base: String) -> String {
        let summaryBase = base.trimmingCharacters(in: .whitespacesAndNewlines)

        if let account = effectiveSigningAccount?.appleId,
           let device = selectedDevice?.name {
            return "\(summaryBase). Using \(account) on \(device)."
        }

        if let account = effectiveSigningAccount?.appleId {
            return "\(summaryBase). Using \(account)."
        }

        if let device = selectedDevice?.name {
            return "\(summaryBase). Installing to \(device)."
        }

        return summaryBase
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

    private func recordLocalActivity(level: String, code: String, message: String) {
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

    private func refreshLatestInstallJob() async {
        guard isPaired else { return }

        do {
            let jobs = try await api.listInstallJobs(baseURL: backendURL, token: helperToken)
            guard let latest = jobs.max(by: { $0.updatedAt < $1.updatedAt }) else {
                activeInstallJob = nil
                activeInstallLogs = []
                installConsoleAutoPresentationSuppressed = false
                return
            }
            let logs = await refreshActiveInstallLogs(jobId: latest.id)
            let resolved = applyInstallSnapshot(latest, logs: logs)
            if installConsoleTitle.isEmpty {
                installConsoleTitle = inferredInstallName(for: resolved)
            }
            if installConsoleSubtitle.isEmpty {
                installConsoleSubtitle = inferredInstallSubtitle(for: resolved)
            }
            if isInstallJobInFlight(resolved) && !installConsoleAutoPresentationSuppressed {
                installConsolePresented = true
            }
            if isInstallJobInFlight(resolved) {
                beginPollingInstallJob(jobId: resolved.id)
            }
        } catch {
            // Non-fatal for the main dashboard; install progress is best-effort.
        }
    }

    private func beginPollingInstallJob(jobId: String) {
        activeJobPollingTask?.cancel()
        activeJobPollingTask = Task { [weak self] in
            guard let self else { return }
            let startedAt = Date()
            while !Task.isCancelled {
                if Date().timeIntervalSince(startedAt) > Self.installPollingTimeout {
                    await MainActor.run {
                        self.activeJobPollingTask = nil
                    }
                    break
                }
                do {
                    let job = try await self.api.getInstallJob(baseURL: self.backendURL, token: self.helperToken, jobId: jobId)
                    let logs = await self.refreshActiveInstallLogs(jobId: job.id)

                    let resolved = await MainActor.run {
                        let snapshot = self.applyInstallSnapshot(job, logs: logs)
                        if self.installConsoleTitle.isEmpty {
                            self.installConsoleTitle = self.inferredInstallName(for: snapshot)
                        }
                        if self.installConsoleSubtitle.isEmpty {
                            self.installConsoleSubtitle = self.inferredInstallSubtitle(for: snapshot)
                        }
                        return snapshot
                    }

                    if resolved.status == "completed" || resolved.status == "failed" {
                        await MainActor.run {
                            self.activeJobPollingTask = nil
                        }
                        break
                    }
                } catch {
                    await MainActor.run {
                        self.activeJobPollingTask = nil
                    }
                    break
                }

                try? await Task.sleep(nanoseconds: 1_500_000_000)
            }
        }
    }

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

    private func isValidRemoteURL(_ raw: String) -> Bool {
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(), let host = url.host else {
            return false
        }
        guard scheme == "https" || scheme == "http" else {
            return false
        }
        return scheme == "https" || isLocalHost(host)
    }

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
                await refreshAll()
            }
        }
    }

    private func refreshActiveInstallLogs(jobId: String) async -> [InstallJobLogDTO] {
        do {
            let logs = try await api.getInstallJobLogs(baseURL: backendURL, token: helperToken, jobId: jobId)
            await MainActor.run {
                self.activeInstallLogs = logs
            }
            return logs
        } catch {
            // Keep existing logs if refresh fails.
            return activeInstallLogs
        }
    }

    private func isInstallJobInFlight(_ job: InstallJobDetailDTO) -> Bool {
        job.status == "queued" || job.status == "running" || job.status == "waiting_2fa"
    }

    @discardableResult
    private func applyInstallSnapshot(_ job: InstallJobDetailDTO, logs: [InstallJobLogDTO]? = nil) -> InstallJobDetailDTO {
        let previous = activeInstallJob
        let resolved = reconcileInstallJob(job, logs: logs ?? activeInstallLogs)
        activeInstallJob = resolved

        if previous?.id == resolved.id,
           previous?.status != resolved.status,
           (resolved.status == "completed" || resolved.status == "failed") {
            installConsoleAutoPresentationSuppressed = false
            if !installConsolePresented {
                if resolved.status == "completed" {
                    toastMessage = "\(installConsoleResolvedTitle) installed successfully"
                } else {
                    let failureMessage = resolved.error.map(SidelinkLogRedaction.sanitize)
                    toastMessage = failureMessage.map { "Install failed: \($0)" } ?? "Install failed"
                }
            }
        }

        return resolved
    }

    private func reconcileInstallJob(_ job: InstallJobDetailDTO, logs: [InstallJobLogDTO]) -> InstallJobDetailDTO {
        let failedStep = job.steps.first(where: { $0.status == "failed" })
        let existingError = job.error?.trimmingCharacters(in: .whitespacesAndNewlines)
        let logError = latestInstallFailureMessage(from: logs)
        let effectiveError = failedStep?.error.map(SidelinkLogRedaction.sanitize)
            ?? ((existingError?.isEmpty == false) ? existingError.map(SidelinkLogRedaction.sanitize) : nil)
            ?? logError.map(SidelinkLogRedaction.sanitize)

        let shouldSynthesizeFailure = job.status != "failed"
            && (failedStep != nil || ((job.status == "queued" || job.status == "running") && effectiveError != nil))

        guard shouldSynthesizeFailure else {
            return job
        }

        let resolvedSteps = job.steps.map { step in
            guard failedStep == nil,
                  step.name == job.currentStep,
                  step.status == "running"
            else {
                return step
            }

            return PipelineStepDTO(
                name: step.name,
                status: "failed",
                startedAt: step.startedAt,
                completedAt: logs.last?.at ?? step.completedAt,
                error: effectiveError
            )
        }

        return InstallJobDetailDTO(
            id: job.id,
            ipaId: job.ipaId,
            deviceUdid: job.deviceUdid,
            accountId: job.accountId,
            includeExtensions: job.includeExtensions,
            status: "failed",
            currentStep: job.currentStep,
            steps: resolvedSteps,
            error: effectiveError,
            createdAt: job.createdAt,
            updatedAt: logs.last?.at ?? job.updatedAt
        )
    }

    private func latestInstallFailureMessage(from logs: [InstallJobLogDTO]) -> String? {
        for entry in logs.reversed() where entry.level.lowercased() == "error" {
            let message = entry.message.trimmingCharacters(in: .whitespacesAndNewlines)
            if message.isEmpty {
                continue
            }

            if let range = message.range(of: " - ", options: .backwards) {
                let suffix = String(message[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                if !suffix.isEmpty {
                    return suffix
                }
            }

            return SidelinkLogRedaction.sanitize(message)
        }

        return nil
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
