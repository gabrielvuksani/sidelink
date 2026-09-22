import Foundation

// MARK: - IPA Acquisition

extension HelperViewModel {

    func importFromURL() async {
        guard let identity = currentPairingIdentity() else {
            _ = requirePairing(for: "import IPA URLs")
            return
        }

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
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            guard await requireCurrentHostAuthority(for: "import IPA URLs", identity: identity) != nil else { return }
            if let fileName = URL(string: raw)?.lastPathComponent,
               let existing = ipas.first(where: { $0.originalName.caseInsensitiveCompare(fileName) == .orderedSame }) {
                toastMessage = "IPA already in your library. Opening the install console."
                importURL = ""
                await startInstall(
                    ipaId: existing.id,
                    appName: existing.bundleName,
                    subtitle: "Installing an imported IPA from URL",
                    pairingIdentity: identity
                )
                return
            }

            let imported = try await api.importIpaFromURL(
                baseURL: identity.baseURL,
                token: identity.token,
                urlString: raw
            )
            guard isCurrentPairingIdentity(identity) else { return }
            let isDuplicateBundle = ipas.contains(where: { $0.bundleId == imported.bundleId && $0.id != imported.id })
            importURL = ""
            toastMessage = isDuplicateBundle
                ? "Imported another version of \(imported.bundleId). Opening the install console."
                : "IPA imported. Opening the install console."
            await startInstall(
                ipaId: imported.id,
                appName: imported.bundleName,
                subtitle: "Installing an imported IPA from URL",
                pairingIdentity: identity
            )
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            errorMessage = error.localizedDescription
        }
    }

    func importLocalIpa(fileName: String, fileData: Data) async {
        guard let identity = currentPairingIdentity() else {
            _ = requirePairing(for: "upload IPA files")
            return
        }

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
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            guard await requireCurrentHostAuthority(for: "upload IPA files", identity: identity) != nil else { return }
            if let existing = ipas.first(where: { $0.originalName.caseInsensitiveCompare(effectiveName) == .orderedSame }) {
                toastMessage = "IPA already in your library. Opening the install console."
                await startInstall(
                    ipaId: existing.id,
                    appName: existing.bundleName,
                    subtitle: "Installing an imported IPA from Files",
                    pairingIdentity: identity
                )
                return
            }

            let imported = try await api.uploadIpa(
                baseURL: identity.baseURL,
                token: identity.token,
                fileName: effectiveName,
                fileData: fileData
            )
            guard isCurrentPairingIdentity(identity) else { return }

            let isDuplicateBundle = ipas.contains(where: { $0.bundleId == imported.bundleId && $0.id != imported.id })
            toastMessage = isDuplicateBundle
                ? "Imported another version of \(imported.bundleId). Opening the install console."
                : "IPA imported. Opening the install console."
            await startInstall(
                ipaId: imported.id,
                appName: imported.bundleName,
                subtitle: "Installing an imported IPA from Files",
                pairingIdentity: identity
            )
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            errorMessage = error.localizedDescription
        }
    }
}
