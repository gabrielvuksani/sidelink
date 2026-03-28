import Foundation
import SwiftUI

// MARK: - Install Pipeline

extension HelperViewModel {

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
               let existing = ipas.first(where: { $0.originalName.caseInsensitiveCompare(fileName) == .orderedSame }) {
                toastMessage = "IPA already in your library. Opening the install console."
                importURL = ""
                await startInstall(
                    ipaId: existing.id,
                    appName: existing.bundleName,
                    subtitle: "Installing an imported IPA from URL"
                )
                return
            }

            let imported = try await api.importIpaFromURL(baseURL: backendURL, token: helperToken, urlString: raw)
            let isDuplicateBundle = ipas.contains(where: { $0.bundleId == imported.bundleId && $0.id != imported.id })
            importURL = ""
            toastMessage = isDuplicateBundle
                ? "Imported another version of \(imported.bundleId). Opening the install console."
                : "IPA imported. Opening the install console."
            await startInstall(
                ipaId: imported.id,
                appName: imported.bundleName,
                subtitle: "Installing an imported IPA from URL"
            )
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
            if let existing = ipas.first(where: { $0.originalName.caseInsensitiveCompare(effectiveName) == .orderedSame }) {
                toastMessage = "IPA already in your library. Opening the install console."
                await startInstall(
                    ipaId: existing.id,
                    appName: existing.bundleName,
                    subtitle: "Installing an imported IPA from Files"
                )
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
                ? "Imported another version of \(imported.bundleId). Opening the install console."
                : "IPA imported. Opening the install console."
            await startInstall(
                ipaId: imported.id,
                appName: imported.bundleName,
                subtitle: "Installing an imported IPA from Files"
            )
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
        installConsoleAllowsNextDismissal = false
        installConsoleAutoPresentationSuppressed = false
        installConsolePresented = true
    }

    func requestInstallConsoleClose() {
        installConsoleAllowsNextDismissal = true
        dismissInstallConsole()
    }

    func handleInstallConsoleDismissAttempt() {
        if installConsoleAllowsNextDismissal {
            installConsoleAllowsNextDismissal = false
            installConsolePresented = false
            return
        }

        if installConsoleRequiresPersistentPresentation {
            installConsolePresented = true
            return
        }

        dismissInstallConsole()
    }

    func dismissInstallConsole() {
        if let activeInstallJob, isInstallJobInFlight(activeInstallJob) {
            installConsoleAutoPresentationSuppressed = true
        }
        installConsolePresented = false
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

    // MARK: - Install Pipeline (Internal Helpers)

    func prepareInstallConsole(title: String, subtitle: String) {
        installConsoleTitle = title
        installConsoleSubtitle = subtitle
        installConsoleAutoPresentationSuppressed = false
        installConsolePresented = true
        activeInstall2FACode = ""
        errorMessage = nil
    }

    func inferredInstallName(for job: InstallJobDetailDTO) -> String {
        if let ipa = ipas.first(where: { $0.id == job.ipaId }) {
            return ipa.bundleName
        }

        if let install = installedApps.first(where: { $0.id == job.ipaId || $0.bundleId == job.ipaId || $0.originalBundleId == job.ipaId }) {
            return install.appName ?? install.bundleId
        }

        return "App Install"
    }

    func inferredInstallSubtitle(for job: InstallJobDetailDTO) -> String {
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

    func installSubtitle(base: String) -> String {
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

    func refreshLatestInstallJob() async {
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

    func beginPollingInstallJob(jobId: String) {
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

    func refreshActiveInstallLogs(jobId: String) async -> [InstallJobLogDTO] {
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

    func isInstallJobInFlight(_ job: InstallJobDetailDTO) -> Bool {
        job.status == "queued" || job.status == "running" || job.status == "waiting_2fa"
    }

    @discardableResult
    func applyInstallSnapshot(_ job: InstallJobDetailDTO, logs: [InstallJobLogDTO]? = nil) -> InstallJobDetailDTO {
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

            Task {
                await refreshAllSilently()
            }
        }

        return resolved
    }

    func reconcileInstallJob(_ job: InstallJobDetailDTO, logs: [InstallJobLogDTO]) -> InstallJobDetailDTO {
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

    func latestInstallFailureMessage(from logs: [InstallJobLogDTO]) -> String? {
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
}
