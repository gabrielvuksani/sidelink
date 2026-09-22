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
        guard !hasSourceURL(raw) else {
            recordLocalActivity(level: "info", code: "source.import.duplicate", message: "Skipped importing a source that was already added.")
            toastMessage = "Source already configured"
            return
        }

        if let capturedIdentity = currentPairingIdentity() {
            guard let identity = await requireCurrentHostAuthority(
                for: "add desktop-managed sources",
                identity: capturedIdentity
            ) else { return }
            do {
                try await api.addSource(baseURL: identity.baseURL, token: identity.token, urlString: raw)
                guard isCurrentPairingIdentity(identity) else { return }
                await refreshSourceCatalogs(pairingIdentity: identity)
                guard isCurrentPairingIdentity(identity) else { return }
                recordLocalActivity(level: "info", code: "source.import.success", message: "Imported source \(raw).")
                toastMessage = "Source imported from deep link"
            } catch {
                guard isCurrentPairingIdentity(identity) else { return }
                if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                    recordLocalActivity(level: "error", code: "source.import.failed", message: "Failed to import source: \(error.localizedDescription)")
                    toastMessage = error.localizedDescription
                }
            }
            return
        }

        let generation = pairingIdentityGeneration
        do {
            _ = try await api.fetchSourceManifest(urlString: raw)
            guard isCurrentUnpairedGeneration(generation) else { return }
            customSourceURLs.append(raw)
            persistCustomSources()
            await refreshSourceCatalogs()
            guard isCurrentUnpairedGeneration(generation) else { return }
            recordLocalActivity(level: "info", code: "source.import.success", message: "Imported source \(raw).")
            toastMessage = "Source imported from deep link"
        } catch {
            guard isCurrentUnpairedGeneration(generation) else { return }
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
        guard !hasSourceURL(raw) else {
            recordLocalActivity(level: "info", code: "source.import.duplicate", message: "Skipped importing a source that was already added.")
            errorMessage = "Source already added"
            return
        }

        if let capturedIdentity = currentPairingIdentity() {
            guard let identity = await requireCurrentHostAuthority(
                for: "add desktop-managed sources",
                identity: capturedIdentity
            ) else { return }
            isLoading = true
            defer {
                if isCurrentPairingIdentity(identity) {
                    isLoading = false
                }
            }
            do {
                try await api.addSource(baseURL: identity.baseURL, token: identity.token, urlString: raw)
                guard isCurrentPairingIdentity(identity) else { return }
                sourceURLInput = ""
                await refreshSourceCatalogs(pairingIdentity: identity)
                guard isCurrentPairingIdentity(identity) else { return }
                recordLocalActivity(level: "info", code: "source.import.success", message: "Imported source \(raw).")
                toastMessage = "Source added"
            } catch {
                guard isCurrentPairingIdentity(identity) else { return }
                if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                    recordLocalActivity(level: "error", code: "source.import.failed", message: "Failed to import source: \(error.localizedDescription)")
                    errorMessage = error.localizedDescription
                }
            }
            return
        }

        let generation = pairingIdentityGeneration
        isLoading = true
        defer {
            if isCurrentUnpairedGeneration(generation) {
                isLoading = false
            }
        }
        do {
            _ = try await api.fetchSourceManifest(urlString: raw)
            guard isCurrentUnpairedGeneration(generation) else { return }
            customSourceURLs.append(raw)
            persistCustomSources()
            sourceURLInput = ""
            await refreshSourceCatalogs()
            guard isCurrentUnpairedGeneration(generation) else { return }
            recordLocalActivity(level: "info", code: "source.import.success", message: "Imported source \(raw).")
            toastMessage = "Source added"
        } catch {
            guard isCurrentUnpairedGeneration(generation) else { return }
            recordLocalActivity(level: "error", code: "source.import.failed", message: "Failed to import source: \(error.localizedDescription)")
            errorMessage = error.localizedDescription
        }
    }

    func removeCustomSource(_ url: String) async {
        let normalized = SidelinkSourceURLUtil.normalized(url)
        if let capturedIdentity = currentPairingIdentity(),
           let source = sourceCatalogs.first(where: { SidelinkSourceURLUtil.normalized($0.sourceURL) == normalized }) {
            guard let sourceId = source.sourceId, !source.isBuiltIn else { return }
            guard let identity = await requireCurrentHostAuthority(
                for: "remove desktop-managed sources",
                identity: capturedIdentity
            ) else { return }
            do {
                try await api.deleteSource(baseURL: identity.baseURL, token: identity.token, sourceId: sourceId)
                guard isCurrentPairingIdentity(identity) else { return }
                await refreshSourceCatalogs(pairingIdentity: identity)
            } catch {
                guard isCurrentPairingIdentity(identity) else { return }
                if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                    errorMessage = error.localizedDescription
                }
            }
            return
        }

        customSourceURLs.removeAll { SidelinkSourceURLUtil.normalized($0) == normalized }
        persistCustomSources()
        await refreshSourceCatalogs()
    }

    func refreshTrustedSources() async {
        guard let identity = currentPairingIdentity() else {
            trustedSources = Self.bundledTrustedSources
            return
        }
        await refreshTrustedSources(pairingIdentity: identity)
    }

    func addTrustedSource(_ source: TrustedSourceDTO) async {
        sourceURLInput = source.url
        await addCustomSource()
    }

    func refreshDeviceInventory() async {
        guard let identity = currentPairingIdentity() else {
            unmanagedInstalledApps = []
            return
        }
        await refreshDeviceInventory(pairingIdentity: identity)
    }

    func refreshSourceCatalogs() async {
        if let identity = currentPairingIdentity() {
            await refreshSourceCatalogs(pairingIdentity: identity)
            return
        }

        let pairingGeneration = pairingIdentityGeneration
        let sourceGeneration = nextSourceCatalogReadGeneration()
        let feedURLs = ((config?.sourceFeeds.map { $0.url } ?? []) + customSourceURLs).map(SidelinkSourceURLUtil.normalized)
        let uniqueURLs = Array(Set(feedURLs + [Self.officialSourceURL])).sorted()

        var catalogs: [SourceCatalog] = []
        var failures: [String] = []
        for url in uniqueURLs {
            do {
                let manifest = try await api.fetchSourceManifest(urlString: url)
                guard isCurrentUnpairedSourceCatalogRead(
                    generation: sourceGeneration,
                    pairingGeneration: pairingGeneration
                ) else { return }
                catalogs.append(SourceCatalog(sourceId: nil, sourceURL: url, manifest: manifest, isBuiltIn: isOfficialSourceURL(url)))
            } catch {
                guard isCurrentUnpairedSourceCatalogRead(
                    generation: sourceGeneration,
                    pairingGeneration: pairingGeneration
                ) else { return }
                failures.append("\(url): \(error.localizedDescription)")
            }
        }

        guard isCurrentUnpairedSourceCatalogRead(
            generation: sourceGeneration,
            pairingGeneration: pairingGeneration
        ) else { return }
        sourceCatalogFailures = failures
        sourceCatalogs = catalogs.sorted { $0.manifest.name.localizedCaseInsensitiveCompare($1.manifest.name) == .orderedAscending }
    }

    private func isCurrentUnpairedGeneration(_ generation: UInt64) -> Bool {
        pairingIdentityGeneration == generation && currentPairingIdentity() == nil
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
