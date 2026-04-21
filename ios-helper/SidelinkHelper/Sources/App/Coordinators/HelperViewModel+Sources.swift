import Foundation
import SwiftUI

// MARK: - Source Management

extension HelperViewModel {

    func addSourceFromDeepLink(_ urlString: String) async {
        let raw = SidelinkSourceURLUtil.normalized(urlString)
        guard !raw.isEmpty, isValidRemoteURL(raw) else {
            recordLocalActivity(level: "warn", code: "source.import.invalid", message: "Rejected an invalid source URL.")
            toastMessage = "Invalid source URL"
            return
        }

        if hasSourceURL(raw) {
            recordLocalActivity(level: "info", code: "source.import.duplicate", message: "Skipped importing a source that was already added.")
            toastMessage = "Source already configured"
            return
        }

        do {
            if isPaired {
                try await api.addSource(baseURL: backendURL, token: helperToken, urlString: raw)
            } else {
                let manifest = try await api.fetchSourceManifest(urlString: raw)
                _ = manifest
                customSourceURLs.append(raw)
                persistCustomSources()
            }
            await refreshSourceCatalogs()
            recordLocalActivity(level: "info", code: "source.import.success", message: "Imported source \(raw).")
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

        if hasSourceURL(raw) {
            recordLocalActivity(level: "info", code: "source.import.duplicate", message: "Skipped importing a source that was already added.")
            errorMessage = "Source already added"
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            if isPaired {
                try await api.addSource(baseURL: backendURL, token: helperToken, urlString: raw)
            } else {
                let manifest = try await api.fetchSourceManifest(urlString: raw)
                _ = manifest
                customSourceURLs.append(raw)
                persistCustomSources()
            }
            sourceURLInput = ""
            await refreshSourceCatalogs()
            recordLocalActivity(level: "info", code: "source.import.success", message: "Imported source \(raw).")
            toastMessage = "Source added"
        } catch {
            recordLocalActivity(level: "error", code: "source.import.failed", message: "Failed to import source: \(error.localizedDescription)")
            errorMessage = error.localizedDescription
        }
    }

    func removeCustomSource(_ url: String) async {
        let normalized = SidelinkSourceURLUtil.normalized(url)
        if isPaired, let source = sourceCatalogs.first(where: { SidelinkSourceURLUtil.normalized($0.sourceURL) == normalized }) {
            guard let sourceId = source.sourceId, !source.isBuiltIn else {
                return
            }
            do {
                try await api.deleteSource(baseURL: backendURL, token: helperToken, sourceId: sourceId)
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        } else {
            customSourceURLs.removeAll { SidelinkSourceURLUtil.normalized($0) == normalized }
            persistCustomSources()
        }
        await refreshSourceCatalogs()
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

    func refreshSourceCatalogs() async {
        if isPaired {
            do {
                let sources = try await api.listSources(baseURL: backendURL, token: helperToken)
                sourceCatalogFailures = sources
                    .filter { $0.enabled && $0.cachedManifest == nil }
                    .map { "\($0.name): manifest is not available yet. Refresh the source from the desktop if this persists." }
                sourceCatalogs = sources
                    .filter { $0.enabled }
                    .compactMap { source in
                        guard let manifest = source.cachedManifest else {
                            return nil
                        }
                        return SourceCatalog(
                            sourceId: source.id,
                            sourceURL: source.url,
                            manifest: manifest,
                            isBuiltIn: source.isBuiltIn
                        )
                    }
                    .sorted { $0.manifest.name.localizedCaseInsensitiveCompare($1.manifest.name) == .orderedAscending }
                return
            } catch {
                sourceCatalogFailures = ["Desktop-managed sources could not be refreshed: \(error.localizedDescription)"]
                sourceCatalogs = []
                return
            }
        }

        let feedURLs = ((config?.sourceFeeds.map { $0.url } ?? []) + customSourceURLs).map(SidelinkSourceURLUtil.normalized)
        let uniqueURLs = Array(Set(feedURLs + [Self.officialSourceURL])).sorted()

        var catalogs: [SourceCatalog] = []
        var failures: [String] = []
        for url in uniqueURLs {
            do {
                let manifest = try await api.fetchSourceManifest(urlString: url)
                catalogs.append(SourceCatalog(sourceId: nil, sourceURL: url, manifest: manifest, isBuiltIn: isOfficialSourceURL(url)))
            } catch {
                failures.append("\(url): \(error.localizedDescription)")
            }
        }

        sourceCatalogFailures = failures
        sourceCatalogs = catalogs.sorted { $0.manifest.name.localizedCaseInsensitiveCompare($1.manifest.name) == .orderedAscending }
    }

    // MARK: - Source Helpers

    func loadCustomSourcesFromStorage() {
        guard let data = customSourceURLsJSON.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([String].self, from: data)
        else {
            customSourceURLs = []
            return
        }
        customSourceURLs = Array(Set(decoded.map(SidelinkSourceURLUtil.normalized))).sorted()
    }

    func ensureDefaultSourcePresent() {
        if !customSourceURLs.contains(where: { SidelinkSourceURLUtil.normalized($0) == Self.officialSourceURL }) {
            customSourceURLs.append(Self.officialSourceURL)
            persistCustomSources()
        }
    }

    func persistCustomSources() {
        let unique = Array(Set(customSourceURLs.map(SidelinkSourceURLUtil.normalized))).sorted()
        customSourceURLs = unique
        let encoded = (try? JSONEncoder().encode(unique)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        customSourceURLsJSON = encoded
    }

    func hasSourceURL(_ url: String) -> Bool {
        let normalized = SidelinkSourceURLUtil.normalized(url)
        if isPaired {
            return sourceCatalogs.contains(where: { SidelinkSourceURLUtil.normalized($0.sourceURL) == normalized })
        }
        return customSourceURLs.contains(where: { SidelinkSourceURLUtil.normalized($0) == normalized })
    }

    func mergeTrustedSources(_ remoteSources: [TrustedSourceDTO]) -> [TrustedSourceDTO] {
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
}
