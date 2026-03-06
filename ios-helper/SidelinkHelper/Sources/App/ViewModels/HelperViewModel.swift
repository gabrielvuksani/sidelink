import Foundation
import SwiftUI

@MainActor
final class HelperViewModel: ObservableObject {
    @AppStorage("backendURL") var backendURL = ""
    @AppStorage("helperToken") private var legacyHelperToken = ""
    @Published var helperToken = ""
    @AppStorage("serverName") var serverName = ""
    @AppStorage("serverVersion") var serverVersion = ""
    @AppStorage("deviceId") var deviceId = ""
    @AppStorage("customSourceURLs") private var customSourceURLsJSON = "[]"
    @AppStorage("selectedAccountId") private var persistedSelectedAccountId = ""
    @AppStorage("selectedDeviceUdid") private var persistedSelectedDeviceUdid = ""

    @Published var pairingCode = ""
    @Published var importURL = ""
    @Published var selectedAccountId = "" {
        didSet { persistedSelectedAccountId = selectedAccountId }
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

    private let api = APIClient()
    private let discovery = DiscoveryListener()
    private let sseClient = SSEClient()
    private var activeJobPollingTask: Task<Void, Never>?

    init() {
        if let stored = KeychainStore.get("helperToken"), !stored.isEmpty {
            helperToken = stored
        } else if !legacyHelperToken.isEmpty {
            helperToken = legacyHelperToken
            _ = KeychainStore.set("helperToken", value: legacyHelperToken)
            legacyHelperToken = ""
        }

        loadCustomSourcesFromStorage()
        selectedAccountId = persistedSelectedAccountId
        selectedDeviceUdid = persistedSelectedDeviceUdid

        discovery.onPayload = { [weak self] payload in
            Task { @MainActor in
                self?.ingestDiscovery(payload)
            }
        }

        sseClient.onEvent = { [weak self] event, data in
            Task { @MainActor in
                self?.handleSSEEvent(event: event, data: data)
            }
        }

        discovery.start()
    }

    deinit {
        activeJobPollingTask?.cancel()
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
        installedApps.count
    }

    var isAtFreeSlotLimit: Bool {
        activeAppSlotUsage >= maxActiveAppSlots
    }

    var canStartInstall: Bool {
        isPaired && !selectedAccountId.isEmpty && !selectedDeviceUdid.isEmpty && !isAtFreeSlotLimit
    }

    func pair() async {
        let code = pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)
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

        if scheme == "http", let host = url.host, !isLocalHost(host) {
            return nil
        }

        let normalized = value.hasSuffix("/") ? String(value.dropLast()) : value
        return normalized
    }

    func refreshAll() async {
        guard isPaired else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            async let statusCall = api.fetchStatus(baseURL: backendURL, token: helperToken, deviceId: deviceId.isEmpty ? nil : deviceId)
            async let configCall = api.fetchConfig(baseURL: backendURL, token: helperToken)
            async let accountCall = api.listAccounts(baseURL: backendURL, token: helperToken)
            async let deviceCall = api.listDevices(baseURL: backendURL, token: helperToken)
            async let ipaCall = api.listIpas(baseURL: backendURL, token: helperToken)
            async let installedCall = api.listInstalledApps(baseURL: backendURL, token: helperToken, deviceUdid: deviceId.isEmpty ? nil : deviceId)

            status = try await statusCall
            config = try await configCall
            let allAccounts = try await accountCall
            accounts = allAccounts.filter { $0.status == "active" }
            devices = try await deviceCall
            ipas = try await ipaCall
            installedApps = try await installedCall

            if selectedAccountId.isEmpty || !accounts.contains(where: { $0.id == selectedAccountId }) {
                selectedAccountId = accounts.first?.id ?? ""
            }
            if selectedDeviceUdid.isEmpty || !devices.contains(where: { $0.id == selectedDeviceUdid }) {
                selectedDeviceUdid = devices.first?.id ?? ""
            }

            await refreshLatestInstallJob()
            await refreshSourceCatalogs()
            connectSSEIfPossible()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func triggerRefresh(installId: String) async {
        guard isPaired else { return }

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
        guard isPaired else { return }
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

    func startInstall(ipaId: String) async {
        guard isPaired else { return }
        guard !selectedAccountId.isEmpty, !selectedDeviceUdid.isEmpty else {
            errorMessage = "Select an Apple account and device first"
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            _ = try await api.startInstall(
                baseURL: backendURL,
                token: helperToken,
                ipaId: ipaId,
                accountId: selectedAccountId,
                deviceUdid: selectedDeviceUdid
            )
            toastMessage = "Install job queued"
            await refreshLatestInstallJob()
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func installFromSource(_ app: SourceAppDTO) async {
        guard isPaired else { return }
        guard !selectedAccountId.isEmpty, !selectedDeviceUdid.isEmpty else {
            errorMessage = "Select an Apple account and device first"
            return
        }

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
                accountId: selectedAccountId,
                deviceUdid: selectedDeviceUdid
            )
            toastMessage = "Queued install for \(app.name)"
            await refreshLatestInstallJob()
            await refreshAll()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func addSourceFromDeepLink(_ urlString: String) async {
        guard isPaired else {
            errorMessage = "Pair with a server before importing a source"
            return
        }

        let raw = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, isValidRemoteURL(raw) else {
            errorMessage = "Invalid source URL"
            return
        }

        if customSourceURLs.contains(raw) {
            toastMessage = "Source already configured"
            return
        }

        do {
            _ = try await api.fetchSourceManifest(urlString: raw)
            customSourceURLs.append(raw)
            persistCustomSources()
            await refreshSourceCatalogs()
            toastMessage = "Source imported from deep link"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func addCustomSource() async {
        guard isPaired else { return }

        let raw = sourceURLInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else {
            errorMessage = "Enter a source URL"
            return
        }

        guard isValidRemoteURL(raw) else {
            errorMessage = "Invalid source URL"
            return
        }

        if customSourceURLs.contains(raw) {
            errorMessage = "Source already added"
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            _ = try await api.fetchSourceManifest(urlString: raw)
            customSourceURLs.append(raw)
            persistCustomSources()
            sourceURLInput = ""
            await refreshSourceCatalogs()
            toastMessage = "Source added"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func removeCustomSource(_ url: String) async {
        customSourceURLs.removeAll { $0 == url }
        persistCustomSources()
        await refreshSourceCatalogs()
    }

    func clearPairing() {
        activeJobPollingTask?.cancel()
        activeJobPollingTask = nil
        sseClient.disconnect()
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
        activeInstall2FACode = ""
        selectedAccountId = ""
        selectedDeviceUdid = ""
    }

    func submitActiveInstall2FA() async {
        guard isPaired else { return }
        guard let job = activeInstallJob, job.status == "waiting_2fa" else {
            errorMessage = "No install job is currently waiting for 2FA"
            return
        }

        let code = activeInstall2FACode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard code.count == 6 else {
            errorMessage = "Enter the 6-digit verification code"
            return
        }

        do {
            try await api.submitInstallJob2FA(baseURL: backendURL, token: helperToken, jobId: job.id, code: code)
            activeInstall2FACode = ""
            toastMessage = "2FA code submitted"
            let updated = try await api.getInstallJob(baseURL: backendURL, token: helperToken, jobId: job.id)
            activeInstallJob = updated
            await refreshActiveInstallLogs(jobId: updated.id)
            if updated.status == "running" || updated.status == "queued" {
                beginPollingInstallJob(jobId: updated.id)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func applyDiscoveredBackend(_ backend: DiscoveredBackend) {
        backendURL = backend.url
        toastMessage = "Using \(backend.name)"
    }

    func deleteInstalledApp(_ appId: String) async {
        guard isPaired else { return }

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
        customSourceURLs = decoded
    }

    private func persistCustomSources() {
        let unique = Array(Set(customSourceURLs)).sorted()
        customSourceURLs = unique
        let encoded = (try? JSONEncoder().encode(unique)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        customSourceURLsJSON = encoded
    }

    private func refreshSourceCatalogs() async {
        guard isPaired else {
            sourceCatalogs = []
            return
        }

        let feedURLs = (config?.sourceFeeds.map { $0.url } ?? []) + customSourceURLs
        let uniqueURLs = Array(Set(feedURLs)).sorted()

        var catalogs: [SourceCatalog] = []
        for url in uniqueURLs {
            if let manifest = try? await api.fetchSourceManifest(urlString: url) {
                catalogs.append(SourceCatalog(sourceURL: url, manifest: manifest))
            }
        }

        sourceCatalogs = catalogs.sorted { $0.manifest.name.localizedCaseInsensitiveCompare($1.manifest.name) == .orderedAscending }
    }

    private func refreshLatestInstallJob() async {
        guard isPaired else { return }

        do {
            let jobs = try await api.listInstallJobs(baseURL: backendURL, token: helperToken)
            guard let latest = jobs.max(by: { $0.updatedAt < $1.updatedAt }) else {
                activeInstallJob = nil
                activeInstallLogs = []
                return
            }
            activeInstallJob = latest
            await refreshActiveInstallLogs(jobId: latest.id)
            if latest.status == "queued" || latest.status == "running" || latest.status == "waiting_2fa" {
                beginPollingInstallJob(jobId: latest.id)
            }
        } catch {
            // Non-fatal for the main dashboard; install progress is best-effort.
        }
    }

    private func beginPollingInstallJob(jobId: String) {
        activeJobPollingTask?.cancel()
        activeJobPollingTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do {
                    let job = try await self.api.getInstallJob(baseURL: self.backendURL, token: self.helperToken, jobId: jobId)
                    await MainActor.run {
                        self.activeInstallJob = job
                    }
                    await self.refreshActiveInstallLogs(jobId: job.id)

                    if job.status == "completed" || job.status == "failed" {
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
        sseClient.connect(url: url, headers: ["x-sidelink-helper-token": helperToken])
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
        let lower = host.lowercased()
        if lower == "localhost" || lower.hasSuffix(".local") {
            return true
        }

        let parts = lower.split(separator: ".")
        guard parts.count == 4,
              let a = Int(parts[0]),
              let b = Int(parts[1]) else {
            return false
        }

        if a == 10 || a == 127 || (a == 192 && b == 168) {
            return true
        }
        return a == 172 && (16...31).contains(b)
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
                            self.activeInstallJob = job
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
            if activeInstallLogs.count > 300 {
                activeInstallLogs.removeFirst(activeInstallLogs.count - 300)
            }
            return
        }

        if event == "device-update" {
            Task {
                await refreshAll()
            }
        }
    }

    private func refreshActiveInstallLogs(jobId: String) async {
        do {
            let logs = try await api.getInstallJobLogs(baseURL: backendURL, token: helperToken, jobId: jobId)
            await MainActor.run {
                self.activeInstallLogs = logs
            }
        } catch {
            // Keep existing logs if refresh fails.
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

    private func ingestDiscovery(_ payload: DiscoveryBroadcastDTO) {
        guard let firstAddress = payload.addresses.first(where: { !$0.isEmpty }) else {
            return
        }

        let url = "http://\(firstAddress):\(payload.port)"
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
    }
}
