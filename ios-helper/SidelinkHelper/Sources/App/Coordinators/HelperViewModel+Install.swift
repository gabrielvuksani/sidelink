import Foundation
import SwiftUI

// MARK: - Install Pipeline

extension HelperViewModel {

    func retainedJobCommandKey(for command: String) -> String {
        if let existing = pendingJobCommandKeys[command] {
            return existing
        }
        let key = UUID().uuidString
        pendingJobCommandKeys[command] = key
        return key
    }

    func retireJobCommandKey(for command: String) {
        pendingJobCommandKeys.removeValue(forKey: command)
    }

    func triggerRefresh(installId: String) async {
        if installedApps.first(where: { $0.id == installId })?.renewalRepairRequired == true {
            errorMessage = "Open Installed Apps in SideLink on your computer and choose Review renewal settings for this app."
            return
        }
        guard let identity = await requireCurrentHostAuthority(for: "refresh installed apps") else { return }

        errorMessage = nil

        isLoading = true
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        let command = "refresh:\(installId)"
        let idempotencyKey = retainedJobCommandKey(for: command)
        do {
            let receipt = try await api.triggerRefresh(
                baseURL: identity.baseURL,
                token: identity.token,
                installId: installId,
                idempotencyKey: idempotencyKey
            )
            guard isCurrentPairingIdentity(identity) else { return }
            retireJobCommandKey(for: command)
            switch receipt.job?.status {
            case "completed":
                toastMessage = receipt.job?.outcome == "not_needed"
                    ? (receipt.job?.outcomeReason == "deactivated" ? "Deactivated app left unchanged" : "No renewal needed; app left unchanged")
                    : "Refresh completed"
            case "failed":
                toastMessage = "Refresh failed"
            default:
                toastMessage = receipt.disposition == "already_running" ? "Refresh already running" : "Refresh queued"
            }
            expectedInstallJobId = receipt.job?.id
            await refreshAll(pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            if let job = receipt.job {
                await observeAcceptedInstallJob(jobId: job.id, pairingIdentity: identity)
            } else {
                await refreshLatestInstallJob(pairingIdentity: identity)
            }
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                errorMessage = error.localizedDescription
            }
        }
    }

    func startInstall(
        ipaId: String,
        appName: String? = nil,
        subtitle: String? = nil,
        idempotencyKey: String? = nil
    ) async {
        guard let identity = currentPairingIdentity() else {
            _ = requirePairing(for: "install apps")
            return
        }
        await startInstall(
            ipaId: ipaId,
            appName: appName,
            subtitle: subtitle,
            idempotencyKey: idempotencyKey,
            pairingIdentity: identity
        )
    }

    func startInstall(
        ipaId: String,
        appName: String? = nil,
        subtitle: String? = nil,
        idempotencyKey: String? = nil,
        pairingIdentity identity: PairingIdentity
    ) async {
        guard await requireCurrentHostAuthority(for: "install apps", identity: identity) != nil else { return }

        let resolvedName = appName ?? ipas.first(where: { $0.id == ipaId })?.bundleName ?? "Library App"
        let resolvedSubtitle = installSubtitle(base: subtitle ?? "Installing from your library")
        let operationKey = idempotencyKey ?? UUID().uuidString
        prepareInstallConsole(title: resolvedName, subtitle: resolvedSubtitle)
        lastInstallRequest = .library(
            ipaId: ipaId,
            appName: resolvedName,
            subtitle: resolvedSubtitle,
            idempotencyKey: operationKey
        )

        guard requireInstallReadiness() else {
            return
        }

        errorMessage = nil

        isLoading = true
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            guard isCurrentPairingIdentity(identity), hasCurrentDailyOperationsAuthority() else { return }
            let receipt = try await api.startInstall(
                baseURL: identity.baseURL,
                token: identity.token,
                ipaId: ipaId,
                accountId: primarySigningAccountId,
                deviceUdid: selectedDeviceUdid,
                idempotencyKey: operationKey
            )
            guard isCurrentPairingIdentity(identity) else { return }
            expectedInstallJobId = receipt.id
            await refreshAll(pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            await observeAcceptedInstallJob(jobId: receipt.id, pairingIdentity: identity)
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                errorMessage = error.localizedDescription
            }
        }
    }

    func installFromSource(
        _ app: SourceAppDTO,
        sourceName: String? = nil,
        subtitle: String? = nil,
        idempotencyKey: String? = nil,
        pairingIdentity providedIdentity: PairingIdentity? = nil
    ) async {
        guard let identity = providedIdentity ?? currentPairingIdentity(),
              isCurrentPairingIdentity(identity)
        else {
            _ = requirePairing(for: "install apps from sources")
            return
        }
        guard await requireCurrentHostAuthority(for: "install apps from sources", identity: identity) != nil else { return }

        let resolvedSourceName = sourceName ?? sourceCatalogs.first(where: { $0.manifest.apps.contains(where: { $0.id == app.id }) })?.manifest.name ?? "Source"
        let resolvedSubtitle = installSubtitle(base: subtitle ?? "Installing from \(resolvedSourceName)")
        let operationKey = idempotencyKey ?? UUID().uuidString
        prepareInstallConsole(title: app.name, subtitle: resolvedSubtitle)
        lastInstallRequest = .source(
            app: app,
            sourceName: resolvedSourceName,
            subtitle: resolvedSubtitle,
            idempotencyKey: operationKey
        )

        guard requireInstallReadiness() else {
            return
        }

        errorMessage = nil

        isLoading = true
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            let downloadURL = app.primaryDownloadURL
            guard !downloadURL.isEmpty else {
                errorMessage = "Selected source app has no download URL"
                return
            }

            let imported = try await api.importIpaFromURL(
                baseURL: identity.baseURL,
                token: identity.token,
                urlString: downloadURL
            )
            guard isCurrentPairingIdentity(identity) else { return }
            lastInstallRequest = .library(
                ipaId: imported.id,
                appName: app.name,
                subtitle: resolvedSubtitle,
                idempotencyKey: operationKey
            )
            guard await requireCurrentHostAuthority(for: "install apps from sources", identity: identity) != nil,
                  isCurrentPairingIdentity(identity),
                  hasCurrentDailyOperationsAuthority()
            else { return }
            let receipt = try await api.startInstall(
                baseURL: identity.baseURL,
                token: identity.token,
                ipaId: imported.id,
                accountId: primarySigningAccountId,
                deviceUdid: selectedDeviceUdid,
                idempotencyKey: operationKey
            )
            guard isCurrentPairingIdentity(identity) else { return }
            expectedInstallJobId = receipt.id
            await refreshAll(pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            await observeAcceptedInstallJob(jobId: receipt.id, pairingIdentity: identity)
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                errorMessage = error.localizedDescription
            }
        }
    }

    func submitActiveInstall2FA(renderedJob: InstallJobDetailDTO) async {
        guard let capturedIdentity = currentPairingIdentity() else {
            _ = requirePairing(for: "verify install jobs")
            return
        }
        guard renderedJob.status == "waiting_2fa" else {
            errorMessage = "No install job is currently waiting for 2FA"
            return
        }
        guard let expectedRevision = renderedJob.revision,
              let renderedFingerprint = InstallJobVersionFingerprint(
                  jobId: renderedJob.id,
                  revision: expectedRevision,
                  updatedAt: renderedJob.updatedAt
              )
        else {
            errorMessage = "This verification receipt has no durable version. Refresh Activity and try again."
            return
        }
        guard let activeInstallJob,
              activeInstallJob.id == renderedJob.id,
              InstallJobVersionFingerprint(job: activeInstallJob) == renderedFingerprint
        else {
            activityAuthoritativeVersions.removeValue(forKey: renderedJob.id)
            errorMessage = "This verification receipt changed after it was rendered. Refresh Activity and try again."
            return
        }
        let job = renderedJob

        installConsolePresented = true
        errorMessage = nil

        let code = activeInstall2FACode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard code.count == 6 else {
            errorMessage = "Enter the 6-digit verification code"
            return
        }
        let selection = captureDailyOperationSelection()
        guard let identity = await requireCurrentHostAuthority(
            for: "verify install jobs",
            identity: capturedIdentity
        ) else { return }
        guard selectionStillOwnsFollowUp(
            selection,
            operationJobId: job.id,
            pairingIdentity: identity
        ) else { return }
        guard let presentedJob = presentedInstallJob,
              presentedJob.id == job.id,
              presentedJob.status == "waiting_2fa",
              InstallJobVersionFingerprint(job: presentedJob) == renderedFingerprint
        else {
            activityAuthoritativeVersions.removeValue(forKey: job.id)
            errorMessage = "This verification receipt changed after it was rendered. Refresh Activity and try again."
            return
        }
        guard requireExactActivityMutationAuthorityIfNeeded(
            jobId: job.id,
            fingerprint: renderedFingerprint,
            action: "submit this verification code"
        ) else { return }
        let suspendedFingerprint = suspendActivityMutation(
            jobId: job.id,
            fingerprint: renderedFingerprint
        )
        var mutationAccepted = false

        do {
            try await api.submitInstallJob2FA(
                baseURL: identity.baseURL,
                token: identity.token,
                jobId: job.id,
                code: code,
                expectedRevision: expectedRevision,
                expectedUpdatedAt: job.updatedAt
            )
            guard isCurrentPairingIdentity(identity) else { return }
            mutationAccepted = true
            markActivityMutationAccepted(jobId: job.id, fingerprint: suspendedFingerprint)
            if selectionStillOwnsFollowUp(
                selection,
                operationJobId: job.id,
                pairingIdentity: identity
            ) {
                activeInstall2FACode = ""
            }
            let authorityRead = beginActivityDetailAuthorityRead(jobId: job.id)
            let updated = try await api.getInstallJob(
                baseURL: identity.baseURL,
                token: identity.token,
                jobId: job.id
            )
            guard isCurrentPairingIdentity(identity) else { return }
            guard let renderedJob = publishActivityDetailAuthority(
                updated,
                readToken: authorityRead
            ) else { return }
            guard selectionStillOwnsFollowUp(
                selection,
                operationJobId: job.id,
                pairingIdentity: identity
            ) else {
                return
            }
            let logs = await refreshActiveInstallLogs(jobId: updated.id, pairingIdentity: identity)
            guard selectionStillOwnsFollowUp(
                selection,
                operationJobId: job.id,
                pairingIdentity: identity
            ) else { return }
            let resolved = applyInstallSnapshot(renderedJob, logs: logs, pairingIdentity: identity)
            if resolved.status == "running" || resolved.status == "queued" {
                beginPollingInstallJob(jobId: resolved.id, pairingIdentity: identity)
            }
        } catch HelperAPIError.commandRejected(let statusCode, let rejectionCode, let message) {
            guard isCurrentPairingIdentity(identity) else { return }
            if !mutationAccepted {
                if statusCode == 408 {
                    markActivityMutationOutcomeUnknown(
                        jobId: job.id,
                        fingerprint: suspendedFingerprint
                    )
                } else if statusCode == 404
                    || rejectionCode == "JOB_VERSION_MISMATCH"
                    || rejectionCode == "JOB_NOT_FOUND" {
                    invalidateActivityMutationAfterStaleRejection(
                        jobId: job.id,
                        fingerprint: suspendedFingerprint
                    )
                } else {
                    restoreActivityMutationAfterRequestFailure(
                        jobId: job.id,
                        fingerprint: suspendedFingerprint
                    )
                }
            }
            guard selectionStillOwnsFollowUp(
                selection,
                operationJobId: job.id,
                pairingIdentity: identity
            ) else { return }
            errorMessage = statusCode == 408
                ? "The verification outcome could not be confirmed. SideLink will not send the code again until the receipt changes."
                : message
        } catch {
            if handleAuthorityLossIfUnauthorized(
                error,
                pairingIdentity: identity,
                message: "Re-pair with your desktop to verify install jobs."
            ) {
                return
            }
            guard isCurrentPairingIdentity(identity) else { return }
            if !mutationAccepted {
                markActivityMutationOutcomeUnknown(
                    jobId: job.id,
                    fingerprint: suspendedFingerprint
                )
            }
            guard selectionStillOwnsFollowUp(
                selection,
                operationJobId: job.id,
                pairingIdentity: identity
            ) else { return }
            errorMessage = mutationAccepted
                ? "The host accepted the verification code, but the latest receipt could not be confirmed yet."
                : "The verification outcome could not be confirmed. SideLink will not send the code again until the receipt changes."
        }
    }

    func retryLastInstallRequest() async {
        if presentedInstallJob?.operationKind == .repair {
            errorMessage = "Review renewal settings in SideLink on your computer to retry this repair."
            return
        }
        if let reason = presentedActivityRetryDisabledReason {
            errorMessage = reason
            return
        }
        guard let identity = await requireCurrentHostAuthority(for: "retry install operations") else { return }

        guard let lastInstallRequest else {
            if presentedInstallJob != nil {
                errorMessage = "Retry this operation from its app or library entry. Historical operation details do not include private identifiers."
            }
            return
        }

        switch lastInstallRequest {
        case .library(let ipaId, let appName, let subtitle, let idempotencyKey):
            await startInstall(
                ipaId: ipaId,
                appName: appName,
                subtitle: subtitle,
                idempotencyKey: idempotencyKey,
                pairingIdentity: identity
            )
        case .source(let app, let sourceName, let subtitle, let idempotencyKey):
            await installFromSource(
                app,
                sourceName: sourceName,
                subtitle: subtitle,
                idempotencyKey: idempotencyKey,
                pairingIdentity: identity
            )
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
        if selectedActivityReceiptJobId != nil {
            clearActivityReceiptSelection()
        }
        installConsolePresented = false
    }

    func refreshAllApps() async {
        guard let identity = await requireCurrentHostAuthority(for: "refresh all installed apps") else { return }

        errorMessage = nil

        isLoading = true
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            let result = try await api.refreshAll(baseURL: identity.baseURL, token: identity.token)
            guard isCurrentPairingIdentity(identity) else { return }
            var outcomes = ["Queued \(result.triggered) refresh\(result.triggered == 1 ? "" : "es") on the paired host"]
            if let alreadyRunning = result.alreadyRunning, alreadyRunning > 0 {
                outcomes.append("\(alreadyRunning) already running")
            }
            if result.skipped > 0 {
                outcomes.append("\(result.skipped) skipped")
            }
            if !result.errors.isEmpty {
                outcomes.append("\(result.errors.count) could not be queued")
            }
            toastMessage = outcomes.joined(separator: "; ")
            await refreshAll(pairingIdentity: identity)
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                errorMessage = error.localizedDescription
            }
        }
    }

    func deactivateInstalledApp(_ appId: String) async {
        guard let identity = await requireCurrentHostAuthority(for: "deactivate installed apps") else { return }

        errorMessage = nil

        isLoading = true
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            _ = try await api.deactivateInstalledApp(
                baseURL: identity.baseURL,
                token: identity.token,
                appId: appId
            )
            guard isCurrentPairingIdentity(identity) else { return }
            toastMessage = "App deactivated"
            await refreshAll(pairingIdentity: identity)
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                errorMessage = error.localizedDescription
            }
        }
    }

    func reactivateInstalledApp(_ appId: String) async {
        guard let identity = await requireCurrentHostAuthority(for: "reactivate installed apps") else { return }

        errorMessage = nil

        isLoading = true
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        let command = "reactivation:\(appId)"
        let idempotencyKey = retainedJobCommandKey(for: command)
        do {
            let receipt = try await api.reactivateInstalledApp(
                baseURL: identity.baseURL,
                token: identity.token,
                appId: appId,
                idempotencyKey: idempotencyKey
            )
            guard isCurrentPairingIdentity(identity) else { return }
            retireJobCommandKey(for: command)
            switch receipt.status {
            case "completed":
                toastMessage = "Reactivation completed"
            case "failed":
                toastMessage = "Reactivation failed"
            default:
                toastMessage = "Reactivation queued"
            }
            expectedInstallJobId = receipt.id
            await refreshAll(pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            await observeAcceptedInstallJob(jobId: receipt.id, pairingIdentity: identity)
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                errorMessage = error.localizedDescription
            }
        }
    }

    func deleteInstalledApp(_ appId: String) async {
        guard let identity = await requireCurrentHostAuthority(for: "remove installed apps") else { return }

        errorMessage = nil

        isLoading = true
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            try await api.deleteInstalledApp(
                baseURL: identity.baseURL,
                token: identity.token,
                appId: appId
            )
            guard isCurrentPairingIdentity(identity) else { return }
            installedApps.removeAll { $0.id == appId }
            toastMessage = "Removed installed app entry"
            await refreshAll(pairingIdentity: identity)
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity) {
                errorMessage = error.localizedDescription
            }
        }
    }

    // MARK: - Install Pipeline (Internal Helpers)

    func prepareInstallConsole(title: String, subtitle: String) {
        invalidateDailyOperationSelection()
        clearActivityReceiptSelection()
        installConsoleTitle = title
        installConsoleSubtitle = subtitle
        installConsolePresentationJobId = nil
        expectedInstallJobId = nil
        selectedOperationJobId = nil
        hasPendingInstallPresentation = true
        installConsoleAutoPresentationSuppressed = false
        installConsolePresented = true
        activeInstall2FACode = ""
        errorMessage = nil
    }

    func inferredInstallName(for job: InstallJobDetailDTO) -> String {
        job.title
    }

    func inferredInstallSubtitle(for job: InstallJobDetailDTO) -> String {
        job.detail
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

    func observeAcceptedInstallJob(
        jobId: String,
        pairingIdentity providedIdentity: PairingIdentity? = nil
    ) async {
        guard let identity = providedIdentity ?? currentPairingIdentity(),
              isCurrentPairingIdentity(identity)
        else { return }
        expectedInstallJobId = jobId
        let authorityRead = beginActivityDetailAuthorityRead(jobId: jobId)

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
            let logs = await refreshActiveInstallLogs(jobId: jobId, pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            let resolved = applyInstallSnapshot(renderedJob, logs: logs, pairingIdentity: identity)
            guard resolved.id == jobId else { return }

            if isInstallJobInFlight(resolved) && !installConsoleAutoPresentationSuppressed {
                installConsolePresented = true
            }
            if isInstallJobInFlight(resolved) {
                beginPollingInstallJob(jobId: jobId, pairingIdentity: identity)
            }
        } catch HelperAPIError.unauthorized {
            guard isCurrentPairingIdentity(identity) else { return }
            losePairingAuthority(
                pairingIdentity: identity,
                message: "SideLink can no longer read this operation. Re-pair with your desktop."
            )
        } catch HelperAPIError.notFound(let message) {
            guard isCurrentPairingIdentity(identity) else { return }
            _ = invalidateActivityDetailAuthority(jobId: jobId, readToken: authorityRead)
            errorMessage = message
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            finishActivityDetailAuthorityReadFailure(
                jobId: jobId,
                readToken: authorityRead
            )
            beginPollingInstallJob(jobId: jobId, pairingIdentity: identity)
        }
    }

    func refreshLatestInstallJob(pairingIdentity providedIdentity: PairingIdentity? = nil) async {
        guard let identity = providedIdentity ?? currentPairingIdentity(),
              isCurrentPairingIdentity(identity)
        else { return }
        let authorityReadGeneration = beginActivityListAuthorityRead()

        do {
            let jobs = try await api.listInstallJobs(baseURL: identity.baseURL, token: identity.token)
            guard isCurrentPairingIdentity(identity) else { return }
            mergeOperationJobs(jobs)
            publishActivityListAuthority(jobs, readGeneration: authorityReadGeneration)
            let candidate: InstallJobDetailDTO?
            if let expectedInstallJobId {
                candidate = jobs.first(where: { $0.id == expectedInstallJobId })
            } else if hasPendingInstallPresentation {
                candidate = nil
            } else if let selectedOperationJobId {
                candidate = jobs.first(where: { $0.id == selectedOperationJobId })
            } else if let activeJobId = activeInstallJob?.id {
                candidate = jobs.first(where: { $0.id == activeJobId })
            } else {
                candidate = InstallJobSnapshotOrdering.newest(in: jobs.filter(isInstallJobInFlight))
            }

            guard let latest = candidate else {
                if activeInstallJob == nil {
                    activeInstallLogs = []
                    activeInstallLogJobId = nil
                    installConsoleAutoPresentationSuppressed = false
                }
                return
            }
            let isCurrentJob = activeInstallJob?.id == latest.id
            let matchesExpectedReceipt = expectedInstallJobId == latest.id
            let matchesExplicitSelection = selectedOperationJobId == latest.id
            guard matchesExpectedReceipt
                    || matchesExplicitSelection
                    || isCurrentJob
                    || InstallJobSnapshotOrdering.shouldAccept(current: activeInstallJob, incoming: latest)
            else {
                return
            }

            let selection = captureDailyOperationSelection()
            let logs = await refreshActiveInstallLogs(jobId: latest.id, pairingIdentity: identity)
            guard selectionStillOwnsFollowUp(
                selection,
                operationJobId: latest.id,
                pairingIdentity: identity
            ) else { return }
            let renderedJob = operationJobsById[latest.id] ?? latest
            let resolved = applyInstallSnapshot(renderedJob, logs: logs, pairingIdentity: identity)
            guard resolved.id == latest.id else {
                return
            }
            if isInstallJobInFlight(resolved) && !installConsoleAutoPresentationSuppressed {
                installConsolePresented = true
            }
            if isInstallJobInFlight(resolved) {
                beginPollingInstallJob(jobId: resolved.id, pairingIdentity: identity)
            }
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            _ = handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity)
        }
    }

    func beginPollingInstallJob(jobId: String, pairingIdentity identity: PairingIdentity) {
        guard isCurrentPairingIdentity(identity) else { return }
        if activeJobPollingJobId == jobId, activeJobPollingTask != nil {
            return
        }

        activeJobPollingTask?.cancel()
        let generation = UUID()
        activeJobPollingJobId = jobId
        activeJobPollingGeneration = generation
        activeJobPollingTask = Task { [weak self] in
            // Re-weaken `self` per iteration so a dismissed view model can be
            // deallocated mid-poll rather than kept alive by the strong
            // capture the old `guard let self` created.
            let startedAt = Date()
            var consecutiveFailures = 0
            while !Task.isCancelled {
                guard let self else { return }
                guard self.activeJobPollingJobId == jobId,
                      self.activeJobPollingGeneration == generation,
                      self.isCurrentPairingIdentity(identity)
                else {
                    return
                }
                if Date().timeIntervalSince(startedAt) > Self.installPollingTimeout {
                    self.finishPollingInstallJob(
                        jobId: jobId,
                        generation: generation,
                        pairingIdentity: identity,
                        message: "SideLink stopped waiting after 20 minutes. Refresh to check the latest status."
                    )
                    return
                }
                let authorityRead = self.beginActivityDetailAuthorityRead(jobId: jobId)
                do {
                    let job = try await self.api.getInstallJob(
                        baseURL: identity.baseURL,
                        token: identity.token,
                        jobId: jobId
                    )
                    guard !Task.isCancelled,
                          self.activeJobPollingJobId == jobId,
                          self.activeJobPollingGeneration == generation,
                          self.isCurrentPairingIdentity(identity)
                    else {
                        return
                    }
                    guard let renderedJob = self.publishActivityDetailAuthority(
                        job,
                        readToken: authorityRead
                    ) else {
                        try await Task.sleep(nanoseconds: 1_500_000_000)
                        continue
                    }
                    let logs = await self.refreshActiveInstallLogs(jobId: job.id, pairingIdentity: identity)
                    guard !Task.isCancelled,
                          self.activeJobPollingJobId == jobId,
                          self.activeJobPollingGeneration == generation,
                          self.isCurrentPairingIdentity(identity)
                    else {
                        return
                    }

                    let resolved = self.applyInstallSnapshot(
                        renderedJob,
                        logs: logs,
                        pairingIdentity: identity
                    )
                    if self.installConsoleTitle.isEmpty {
                        self.installConsoleTitle = self.inferredInstallName(for: resolved)
                    }
                    if self.installConsoleSubtitle.isEmpty {
                        self.installConsoleSubtitle = self.inferredInstallSubtitle(for: resolved)
                    }
                    guard resolved.id == jobId else { return }
                    consecutiveFailures = 0
                    if resolved.status == "completed" || resolved.status == "failed" {
                        self.finishPollingInstallJob(
                            jobId: jobId,
                            generation: generation,
                            pairingIdentity: identity
                        )
                        return
                    }
                } catch HelperAPIError.unauthorized {
                    guard self.isCurrentPairingIdentity(identity) else { return }
                    self.losePairingAuthority(
                        pairingIdentity: identity,
                        message: "SideLink can no longer read this operation. Re-pair with your desktop."
                    )
                    return
                } catch HelperAPIError.notFound(let message) {
                    guard self.isCurrentPairingIdentity(identity) else { return }
                    _ = self.invalidateActivityDetailAuthority(
                        jobId: jobId,
                        readToken: authorityRead
                    )
                    self.finishPollingInstallJob(
                        jobId: jobId,
                        generation: generation,
                        pairingIdentity: identity,
                        message: message
                    )
                    return
                } catch {
                    if Task.isCancelled || !self.isCurrentPairingIdentity(identity) { return }
                    self.finishActivityDetailAuthorityReadFailure(
                        jobId: jobId,
                        readToken: authorityRead
                    )
                    consecutiveFailures += 1
                }

                let delaySeconds = consecutiveFailures == 0
                    ? 1.5
                    : min(1.5 * pow(2.0, Double(consecutiveFailures - 1)), 10.0)
                do {
                    try await Task.sleep(nanoseconds: UInt64(delaySeconds * 1_000_000_000))
                } catch {
                    return
                }
            }
        }
    }

    func finishPollingInstallJob(
        jobId: String,
        generation: UUID,
        pairingIdentity identity: PairingIdentity,
        message: String? = nil
    ) {
        guard activeJobPollingJobId == jobId,
              activeJobPollingGeneration == generation,
              isCurrentPairingIdentity(identity)
        else {
            return
        }
        activeJobPollingTask = nil
        activeJobPollingJobId = nil
        activeJobPollingGeneration = nil
        if let message {
            errorMessage = message
        }
    }

    func refreshActiveInstallLogs(
        jobId: String,
        pairingIdentity providedIdentity: PairingIdentity? = nil
    ) async -> [InstallJobLogDTO]? {
        guard let identity = providedIdentity ?? currentPairingIdentity(),
              isCurrentPairingIdentity(identity)
        else { return nil }
        do {
            let logs = try await api.getInstallJobLogs(
                baseURL: identity.baseURL,
                token: identity.token,
                jobId: jobId
            )
            guard isCurrentPairingIdentity(identity) else { return nil }
            return logs.filter { $0.jobId == jobId }
        } catch {
            guard isCurrentPairingIdentity(identity) else { return nil }
            _ = handleAuthorityLossIfUnauthorized(error, pairingIdentity: identity)
            return nil
        }
    }

    func isInstallJobInFlight(_ job: InstallJobDetailDTO) -> Bool {
        job.status == "queued" || job.status == "running" || job.status == "waiting_2fa"
    }

    @discardableResult
    func applyInstallSnapshot(
        _ job: InstallJobDetailDTO,
        logs: [InstallJobLogDTO]? = nil,
        pairingIdentity providedIdentity: PairingIdentity? = nil
    ) -> InstallJobDetailDTO {
        if let providedIdentity, !isCurrentPairingIdentity(providedIdentity) {
            return activeInstallJob ?? job
        }
        mergeOperationJobs([job])
        let previous = activeInstallJob
        let replacesCurrentJob = previous?.id != job.id
        let matchesExpectedReceipt = expectedInstallJobId == job.id
        let matchesExplicitSelection = selectedOperationJobId == job.id
        if replacesCurrentJob,
           (hasPendingInstallPresentation || expectedInstallJobId != nil),
           !matchesExpectedReceipt,
           !matchesExplicitSelection {
            return previous ?? job
        }

        let acceptsSnapshot = (replacesCurrentJob && (matchesExpectedReceipt || matchesExplicitSelection))
            || InstallJobSnapshotOrdering.shouldAccept(current: previous, incoming: job)
        guard acceptsSnapshot || (previous?.id == job.id && logs != nil) else {
            return previous ?? job
        }

        let authoritativeJob = acceptsSnapshot ? job : previous ?? job

        let currentLogs = previous?.id == authoritativeJob.id && activeInstallLogJobId == authoritativeJob.id
            ? activeInstallLogs
            : []
        let resolvedLogs = logs.map {
            InstallJobLogOrdering.merge(
                persisted: $0,
                live: currentLogs,
                jobId: authoritativeJob.id,
                limit: Self.maxInstallLogEntries
            )
        } ?? currentLogs
        let resolved = reconcileInstallJob(authoritativeJob, logs: resolvedLogs)

        if previous?.id != resolved.id {
            activeInstallLogs = []
            activeInstallLogJobId = resolved.id
        }
        activeInstallJob = resolved
        mergeOperationJobs([resolved])
        activeInstallLogs = resolvedLogs
        activeInstallLogJobId = resolved.id

        if expectedInstallJobId == resolved.id {
            expectedInstallJobId = nil
            selectedOperationJobId = resolved.id
            hasPendingInstallPresentation = false
        }

        if previous?.id != resolved.id {
            let replacesPriorPresentation = previous.map { installConsolePresentationJobId == $0.id } ?? false
            if replacesPriorPresentation || installConsoleTitle.isEmpty {
                installConsoleTitle = inferredInstallName(for: resolved)
            }
            if replacesPriorPresentation || installConsoleSubtitle.isEmpty {
                installConsoleSubtitle = inferredInstallSubtitle(for: resolved)
            }
            installConsolePresentationJobId = resolved.id
        } else if installConsolePresentationJobId == nil && !hasPendingInstallPresentation {
            if installConsoleTitle.isEmpty {
                installConsoleTitle = inferredInstallName(for: resolved)
            }
            if installConsoleSubtitle.isEmpty {
                installConsoleSubtitle = inferredInstallSubtitle(for: resolved)
            }
            installConsolePresentationJobId = resolved.id
        }

        if previous?.id == resolved.id,
           previous?.status != resolved.status,
           (resolved.status == "completed" || resolved.status == "failed") {
            installConsoleAutoPresentationSuppressed = false
            if !installConsolePresented {
                if resolved.status == "completed" {
                    toastMessage = resolved.outcome == "not_needed"
                        ? (resolved.outcomeReason == "deactivated" ? "Deactivated app left unchanged" : "No renewal needed; app left unchanged")
                        : "\(installConsoleResolvedTitle) \(resolved.operationKind.completedVerb) successfully"
                } else {
                    let failureMessage = resolved.error.map(SidelinkLogRedaction.sanitize)
                    toastMessage = failureMessage.map { "\(resolved.operationKind.noun) failed: \($0)" }
                        ?? "\(resolved.operationKind.noun) failed"
                }
            }

            if let identity = providedIdentity ?? currentPairingIdentity() {
                Task {
                    await refreshAllSilently(pairingIdentity: identity)
                }
            }
        }

        return resolved
    }

    func reconcileInstallJob(_ job: InstallJobDetailDTO, logs: [InstallJobLogDTO]) -> InstallJobDetailDTO {
        let failedStep = job.steps.first(where: { $0.status == "failed" })
        let existingError = job.error?.trimmingCharacters(in: .whitespacesAndNewlines)
        let logError = latestInstallFailureMessage(from: logs)
        let effectiveError = ((existingError?.isEmpty == false) ? existingError.map(SidelinkLogRedaction.sanitize) : nil)
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
                completedAt: logs.last?.at ?? step.completedAt
            )
        }

        return InstallJobDetailDTO(
            id: job.id,
            title: job.title,
            detail: job.detail,
            operation: job.operation,
            status: "failed",
            currentStep: job.currentStep,
            steps: resolvedSteps,
            revision: job.revision,
            createdAt: job.createdAt,
            updatedAt: logs.last?.at ?? job.updatedAt,
            eligibleCommands: [],
            error: effectiveError,
            outcome: job.outcome,
            outcomeReason: job.outcomeReason
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
