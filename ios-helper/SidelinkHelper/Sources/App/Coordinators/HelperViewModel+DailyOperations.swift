import Foundation

extension HelperViewModel {
    @discardableResult
    func refreshDailyOperations(pairingIdentity providedIdentity: PairingIdentity? = nil) async -> Bool {
        guard let identity = providedIdentity ?? currentPairingIdentity(),
              isCurrentPairingIdentity(identity)
        else {
            expireDailyOperationsAuthority(
                message: dailyOperations == nil ? nil : "Re-pair with your desktop to update Today."
            )
            return false
        }
        let request = nextDailyOperationsRefreshIdentity(pairingIdentity: identity)

        do {
            let snapshot = try await api.fetchDailyOperations(
                baseURL: request.identity.baseURL,
                token: request.identity.token
            )
            guard isCurrentDailyOperationsRefresh(
                generation: request.generation,
                pairingIdentity: request.identity
            ) else {
                return false
            }
            guard snapshot.schemaVersion == 1 else {
                hostReachable = false
                dailyOperationsError = "SideLink on this phone needs an update before it can show Today."
                expireDailyOperationsAuthority(message: dailyOperationsError)
                return false
            }
            let syncedAt = authorityNow()
            dailyOperations = snapshot
            dailyOperationsError = nil
            dailyOperationsLastSyncedAt = syncedAt
            hostReachable = true
            hostLastReachedAt = syncedAt
            publishCurrentDailyOperationsAuthority(syncedAt: syncedAt)
            return true
        } catch HelperAPIError.unauthorized {
            losePairingAuthority(pairingIdentity: request.identity)
            return false
        } catch {
            guard isCurrentDailyOperationsRefresh(
                generation: request.generation,
                pairingIdentity: request.identity
            ) else {
                return false
            }
            hostReachable = false
            expireDailyOperationsAuthority(
                message: "Today could not reach the paired host. Showing the last known status."
            )
            return false
        }
    }

    func mergeOperationJobs(_ jobs: [InstallJobDetailDTO]) {
        let selectedReceipt = selectedActivityReceiptJobId.flatMap { selectedJobId in
            InstallJobRevisionCollection.merging(
                current: operationJobsById[selectedJobId].map { [selectedJobId: $0] } ?? [:],
                incoming: jobs.filter { $0.id == selectedJobId }
            )[selectedJobId]
        }
        operationJobsById = InstallJobRevisionCollection.boundedMerging(
            current: operationJobsById,
            incoming: jobs,
            limit: Self.maxOperationReceipts
        )
        if let selectedReceipt {
            operationJobsById[selectedReceipt.id] = selectedReceipt
        }
        let retainedJobIds = Set(operationJobsById.keys)
        activityAuthoritativeVersions = activityAuthoritativeVersions.filter {
            retainedJobIds.contains($0.key)
        }
        if activityAuthorityReadGenerationsByJob.count > Self.maxOperationReceipts * 2 {
            var retainedAuthorityJobIds = retainedJobIds
            retainedAuthorityJobIds.formUnion(activityMutationSuspensions.keys)
            if let selectedActivityReceiptJobId {
                retainedAuthorityJobIds.insert(selectedActivityReceiptJobId)
            }
            if let activityReceiptValidationJobId {
                retainedAuthorityJobIds.insert(activityReceiptValidationJobId)
            }
            activityAuthorityReadGenerationsByJob = activityAuthorityReadGenerationsByJob.filter {
                retainedAuthorityJobIds.contains($0.key)
            }
        }
    }

    func beginActivityListAuthorityRead() -> UInt64 {
        activityAuthorityReadGeneration &+= 1
        return activityAuthorityReadGeneration
    }

    func beginActivityDetailAuthorityRead(
        jobId: String,
        purpose: ActivityAuthorityReadPurpose = .background
    ) -> ActivityAuthorityReadToken {
        activityAuthorityReadGeneration &+= 1
        let token = ActivityAuthorityReadToken(
            jobId: jobId,
            generation: activityAuthorityReadGeneration,
            purpose: purpose
        )
        activityAuthorityReadGenerationsByJob[jobId] = token.generation
        if purpose == .invalidation {
            activityAuthoritativeVersions.removeValue(forKey: jobId)
            if selectedActivityReceiptJobId == jobId {
                activityReceiptValidationJobId = jobId
            }
        }
        return token
    }

    func isCurrentActivityDetailAuthorityRead(_ token: ActivityAuthorityReadToken) -> Bool {
        activityAuthorityReadGenerationsByJob[token.jobId] == token.generation
    }

    func publishActivityListAuthority(
        _ jobs: [InstallJobDetailDTO],
        readGeneration: UInt64
    ) {
        let listedJobs = InstallJobRevisionCollection.boundedMerging(
            current: [:],
            incoming: jobs,
            limit: Self.maxOperationReceipts
        )
        let retainedJobIds = Set(operationJobsById.keys)
        var publishedJobIds = Set<String>()
        var nextAuthority = activityAuthoritativeVersions.filter { jobId, _ in
            guard retainedJobIds.contains(jobId) else { return false }
            return (activityAuthorityReadGenerationsByJob[jobId] ?? 0) > readGeneration
        }
        for job in listedJobs.values {
            guard retainedJobIds.contains(job.id),
                  (activityAuthorityReadGenerationsByJob[job.id] ?? 0) <= readGeneration
            else { continue }
            activityAuthorityReadGenerationsByJob[job.id] = readGeneration
            nextAuthority[job.id] = InstallJobVersionFingerprint(job: job)
            publishedJobIds.insert(job.id)
            if selectedActivityReceiptJobId == job.id,
               activityReceiptValidationJobId == job.id {
                activityReceiptValidationJobId = nil
            }
        }
        activityAuthoritativeVersions = nextAuthority

        var resolvedSuspensionJobIds: [String] = []
        for (jobId, suspension) in activityMutationSuspensions {
            guard publishedJobIds.contains(jobId),
                  let listedJob = listedJobs[jobId],
                  let renderedJob = operationJobsById[jobId]
            else { continue }
            let listedFingerprint = InstallJobVersionFingerprint(job: listedJob)
            let renderedFingerprint = InstallJobVersionFingerprint(job: renderedJob)
            if listedFingerprint == renderedFingerprint,
               listedFingerprint != suspension.fingerprint {
                resolvedSuspensionJobIds.append(jobId)
            }
        }
        for jobId in resolvedSuspensionJobIds {
            activityMutationSuspensions.removeValue(forKey: jobId)
        }
    }

    @discardableResult
    func publishActivityDetailAuthority(
        _ job: InstallJobDetailDTO,
        readToken: ActivityAuthorityReadToken
    ) -> InstallJobDetailDTO? {
        guard readToken.jobId == job.id,
              isCurrentActivityDetailAuthorityRead(readToken)
        else { return nil }

        mergeOperationJobs([job])
        var retainedJobIds = Set(operationJobsById.keys)
        if let selectedActivityReceiptJobId {
            retainedJobIds.insert(selectedActivityReceiptJobId)
        }
        activityAuthoritativeVersions = activityAuthoritativeVersions.filter {
            retainedJobIds.contains($0.key)
        }
        let returnedFingerprint = InstallJobVersionFingerprint(job: job)
        activityAuthoritativeVersions[job.id] = returnedFingerprint
        if let suspension = activityMutationSuspensions[job.id],
           let renderedJob = operationJobsById[job.id] {
            let renderedFingerprint = InstallJobVersionFingerprint(job: renderedJob)
            if returnedFingerprint == renderedFingerprint,
               returnedFingerprint != suspension.fingerprint {
                activityMutationSuspensions.removeValue(forKey: job.id)
            }
        }
        if selectedActivityReceiptJobId == job.id,
           activityReceiptValidationJobId == job.id {
            activityReceiptValidationJobId = nil
        }
        return operationJobsById[job.id]
    }

    func beginActivityReceiptSelection(jobId: String) -> ActivityAuthorityReadToken {
        if let previousJobId = selectedActivityReceiptJobId,
           previousJobId != jobId {
            activityAuthorityReadGeneration &+= 1
            activityAuthorityReadGenerationsByJob[previousJobId] = activityAuthorityReadGeneration
        }
        selectedActivityReceiptJobId = jobId
        activityReceiptValidationJobId = jobId
        activityAuthoritativeVersions.removeValue(forKey: jobId)
        return beginActivityDetailAuthorityRead(jobId: jobId, purpose: .receiptSelection)
    }

    func finishActivityReceiptValidationFailure(
        jobId: String,
        readToken: ActivityAuthorityReadToken
    ) {
        guard readToken.jobId == jobId,
              selectedActivityReceiptJobId == jobId,
              activityReceiptValidationJobId == jobId,
              isCurrentActivityDetailAuthorityRead(readToken)
        else { return }
        activityReceiptValidationJobId = nil
        activityAuthoritativeVersions.removeValue(forKey: jobId)
        activityAuthorityReadGeneration &+= 1
        activityAuthorityReadGenerationsByJob[jobId] = activityAuthorityReadGeneration
    }

    func finishActivityDetailAuthorityReadFailure(
        jobId: String,
        readToken: ActivityAuthorityReadToken
    ) {
        guard readToken.jobId == jobId,
              isCurrentActivityDetailAuthorityRead(readToken),
              readToken.purpose == .invalidation || activityReceiptValidationJobId == jobId
        else { return }
        activityAuthoritativeVersions.removeValue(forKey: jobId)
        if activityReceiptValidationJobId == jobId {
            activityReceiptValidationJobId = nil
        }
        activityAuthorityReadGeneration &+= 1
        activityAuthorityReadGenerationsByJob[jobId] = activityAuthorityReadGeneration
    }

    @discardableResult
    func invalidateActivityDetailAuthority(
        jobId: String,
        readToken: ActivityAuthorityReadToken
    ) -> Bool {
        guard readToken.jobId == jobId,
              isCurrentActivityDetailAuthorityRead(readToken)
        else { return false }
        activityAuthoritativeVersions.removeValue(forKey: jobId)
        if activityReceiptValidationJobId == jobId {
            activityReceiptValidationJobId = nil
        }
        activityAuthorityReadGeneration &+= 1
        activityAuthorityReadGenerationsByJob[jobId] = activityAuthorityReadGeneration
        return true
    }

    func clearActivityReceiptSelection() {
        if let selectedActivityReceiptJobId {
            activityAuthorityReadGeneration &+= 1
            activityAuthorityReadGenerationsByJob[selectedActivityReceiptJobId] = activityAuthorityReadGeneration
            if selectedOperationJobId == selectedActivityReceiptJobId {
                selectedOperationJobId = nil
            }
        }
        dailyOperationSelectionGeneration &+= 1
        selectedActivityReceiptJobId = nil
        activityReceiptValidationJobId = nil
    }

    func requireExactActivityMutationAuthorityIfNeeded(
        jobId: String,
        fingerprint: InstallJobVersionFingerprint,
        action: String
    ) -> Bool {
        guard supportsExactJobCommandPreconditions else {
            errorMessage = "Update SideLink on the paired Mac before trying to \(action). This host has not confirmed exact-version enforcement."
            return false
        }
        if let suspension = activityMutationSuspensions[jobId],
           suspension.fingerprint == fingerprint {
            switch suspension.disposition {
            case .submitting:
                errorMessage = "SideLink is already sending this command. It will not send it twice."
            case .accepted:
                errorMessage = "The host accepted the last command. SideLink will not send another until the receipt changes."
            case .outcomeUnknown:
                errorMessage = "The last command may have reached the host. SideLink will not send it again until the receipt changes."
            }
            return false
        }
        guard selectedActivityReceiptJobId == jobId else {
            return true
        }
        guard let job = operationJobsById[jobId],
              InstallJobVersionFingerprint(job: job) == fingerprint
        else {
            errorMessage = "This receipt changed after it was rendered. Refresh it from the paired host before trying to \(action)."
            return false
        }
        guard activityAuthorityState(for: job) == .current else {
            errorMessage = presentedActivityCommandDisabledReason
                ?? "SideLink could not confirm this exact receipt with the paired host before trying to \(action). No changes were made."
            return false
        }
        return true
    }

    func suspendActivityMutation(
        jobId: String,
        fingerprint: InstallJobVersionFingerprint
    ) -> InstallJobVersionFingerprint {
        activityMutationSuspensions[jobId] = ActivityMutationSuspension(
            fingerprint: fingerprint,
            disposition: .submitting
        )
        return fingerprint
    }

    func suspendActivityMutationIfNeeded(
        for job: InstallJobDetailDTO
    ) -> InstallJobVersionFingerprint {
        suspendActivityMutation(
            jobId: job.id,
            fingerprint: InstallJobVersionFingerprint(job: job)
        )
    }

    func markActivityMutationAccepted(
        jobId: String,
        fingerprint: InstallJobVersionFingerprint?
    ) {
        updateActivityMutationDisposition(
            jobId: jobId,
            fingerprint: fingerprint,
            disposition: .accepted
        )
    }

    func markActivityMutationOutcomeUnknown(
        jobId: String,
        fingerprint: InstallJobVersionFingerprint?
    ) {
        updateActivityMutationDisposition(
            jobId: jobId,
            fingerprint: fingerprint,
            disposition: .outcomeUnknown
        )
    }

    private func updateActivityMutationDisposition(
        jobId: String,
        fingerprint: InstallJobVersionFingerprint?,
        disposition: ActivityMutationDisposition
    ) {
        guard let fingerprint,
              activityMutationSuspensions[jobId]?.fingerprint == fingerprint
        else { return }
        activityMutationSuspensions[jobId] = ActivityMutationSuspension(
            fingerprint: fingerprint,
            disposition: disposition
        )
    }

    func restoreActivityMutationAfterRequestFailure(
        jobId: String,
        fingerprint: InstallJobVersionFingerprint?
    ) {
        guard let fingerprint,
              activityMutationSuspensions[jobId]?.fingerprint == fingerprint
        else { return }
        activityMutationSuspensions.removeValue(forKey: jobId)
    }

    func invalidateActivityMutationAfterStaleRejection(
        jobId: String,
        fingerprint: InstallJobVersionFingerprint?
    ) {
        if let fingerprint,
           activityMutationSuspensions[jobId]?.fingerprint == fingerprint {
            activityMutationSuspensions.removeValue(forKey: jobId)
        }
        activityAuthoritativeVersions.removeValue(forKey: jobId)
        activityAuthorityReadGeneration &+= 1
        activityAuthorityReadGenerationsByJob[jobId] = activityAuthorityReadGeneration
    }

    func expireActivityListAuthority(readGeneration: UInt64) {
        activityAuthoritativeVersions = activityAuthoritativeVersions.filter { jobId, _ in
            if activityReceiptValidationJobId == jobId { return true }
            return (activityAuthorityReadGenerationsByJob[jobId] ?? 0) > readGeneration
        }
    }

    func refreshOperationActivity() async {
        guard let identity = currentPairingIdentity(), isCurrentPairingIdentity(identity) else {
            activityHostReachable = false
            activityAuthoritativeVersions = [:]
            activityError = operationJobsById.isEmpty
                ? "Pair with a host to load activity."
                : "Re-pair with the host to update these receipts."
            return
        }

        let authorityReadGeneration = beginActivityListAuthorityRead()
        activityRefreshGeneration &+= 1
        let generation = activityRefreshGeneration
        setLoading("activity", true)
        defer {
            if activityRefreshGeneration == generation, isCurrentPairingIdentity(identity) {
                setLoading("activity", false)
            }
        }

        do {
            let jobs = try await api.listInstallJobs(
                baseURL: identity.baseURL,
                token: identity.token,
                policy: .foregroundLiveness
            )
            guard activityRefreshGeneration == generation,
                  isCurrentPairingIdentity(identity)
            else { return }

            mergeOperationJobs(jobs)
            publishActivityListAuthority(jobs, readGeneration: authorityReadGeneration)
            let syncedAt = authorityNow()
            activityError = nil
            activityLastSyncedAt = syncedAt
            activityHostReachable = true
            hostReachable = true
            hostLastReachedAt = syncedAt
        } catch HelperAPIError.unauthorized {
            guard isCurrentPairingIdentity(identity) else { return }
            losePairingAuthority(
                pairingIdentity: identity,
                message: "Re-pair with your desktop to update Activity."
            )
        } catch {
            guard activityRefreshGeneration == generation,
                  isCurrentPairingIdentity(identity)
            else { return }
            activityHostReachable = false
            hostReachable = false
            expireActivityListAuthority(readGeneration: authorityReadGeneration)
            activityError = operationJobsById.isEmpty
                ? "Activity could not reach the paired host."
                : "The latest Activity update failed. Showing the last known receipts."
        }
    }

    func openDailyOperation(jobId: String) async {
        invalidateDailyOperationSelection()
        let authorityRead = beginActivityReceiptSelection(jobId: jobId)
        selectedOperationJobId = jobId
        installConsolePresentationJobId = jobId
        installConsoleAutoPresentationSuppressed = false
        hasPendingInstallPresentation = false
        activeInstall2FACode = ""
        errorMessage = nil

        if let cached = operationJobsById[jobId] {
            let resolved = applyInstallSnapshot(cached)
            installConsoleTitle = inferredInstallName(for: resolved)
            installConsoleSubtitle = inferredInstallSubtitle(for: resolved)
            installConsolePresented = true
        }

        guard let identity = currentPairingIdentity() else {
            finishActivityReceiptValidationFailure(jobId: jobId, readToken: authorityRead)
            _ = requirePairing(for: "update this operation")
            return
        }
        let selection = nextDailyOperationSelectionIdentity(pairingIdentity: identity)

        do {
            async let jobCall = api.getInstallJob(
                baseURL: selection.identity.baseURL,
                token: selection.identity.token,
                jobId: jobId,
                policy: .foregroundLiveness
            )
            async let logCall = api.getInstallJobLogs(
                baseURL: selection.identity.baseURL,
                token: selection.identity.token,
                jobId: jobId,
                policy: .foregroundLiveness
            )
            let job = try await jobCall
            guard isCurrentDailyOperationSelection(
                generation: selection.generation,
                jobId: jobId,
                pairingIdentity: selection.identity
            ) else {
                return
            }

            guard let renderedJob = publishActivityDetailAuthority(
                job,
                readToken: authorityRead
            ) else {
                return
            }
            let resolved = applyInstallSnapshot(renderedJob, pairingIdentity: selection.identity)
            guard resolved.id == jobId else {
                errorMessage = "This operation could not be opened. Refresh Today and try again."
                return
            }

            installConsoleTitle = inferredInstallName(for: resolved)
            installConsoleSubtitle = inferredInstallSubtitle(for: resolved)
            installConsolePresented = true
            if isInstallJobInFlight(resolved) {
                beginPollingInstallJob(jobId: jobId, pairingIdentity: selection.identity)
            }

            let logs: [InstallJobLogDTO]
            do {
                logs = try await logCall
            } catch HelperAPIError.unauthorized {
                losePairingAuthority(
                    pairingIdentity: selection.identity,
                    message: "Re-pair with your desktop to view this operation."
                )
                return
            } catch {
                logs = []
            }
            guard isCurrentDailyOperationSelection(
                generation: selection.generation,
                jobId: jobId,
                pairingIdentity: selection.identity
            ) else {
                return
            }

            _ = applyInstallSnapshot(renderedJob, logs: logs, pairingIdentity: selection.identity)
        } catch HelperAPIError.unauthorized {
            losePairingAuthority(
                pairingIdentity: selection.identity,
                message: "Re-pair with your desktop to view this operation."
            )
        } catch HelperAPIError.notFound(let message) {
            guard isCurrentDailyOperationSelection(
                generation: selection.generation,
                jobId: jobId,
                pairingIdentity: selection.identity
            ) else { return }
            finishActivityReceiptValidationFailure(jobId: jobId, readToken: authorityRead)
            errorMessage = message
        } catch {
            guard isCurrentDailyOperationSelection(
                generation: selection.generation,
                jobId: jobId,
                pairingIdentity: selection.identity
            ) else { return }
            finishActivityReceiptValidationFailure(jobId: jobId, readToken: authorityRead)
            errorMessage = "This operation could not be loaded from the paired host."
        }
    }

    func cancelDailyOperation(
        jobId: String,
        expectedRevision: Int,
        expectedUpdatedAt: String
    ) async {
        guard let identity = await requireCurrentHostAuthority(for: "cancel this operation") else { return }
        let selection = captureDailyOperationSelection()
        guard let renderedFingerprint = InstallJobVersionFingerprint(
            jobId: jobId,
            revision: expectedRevision,
            updatedAt: expectedUpdatedAt
        ) else {
            errorMessage = "This receipt has no durable version. Refresh it from the paired host before trying again."
            return
        }
        let knownJobs = [operationJobsById[jobId], activeInstallJob?.id == jobId ? activeInstallJob : nil]
            .compactMap { $0 }
        if knownJobs.contains(where: {
            guard let revision = $0.revision else { return false }
            return revision > expectedRevision
                || (revision == expectedRevision && $0.updatedAt != expectedUpdatedAt)
        }) {
            activityAuthoritativeVersions.removeValue(forKey: jobId)
            errorMessage = "This receipt changed after it was rendered. Refresh it from the paired host before cancelling."
            return
        }
        guard requireExactActivityMutationAuthorityIfNeeded(
            jobId: jobId,
            fingerprint: renderedFingerprint,
            action: "cancel this operation"
        ) else { return }
        let suspendedFingerprint = suspendActivityMutation(
            jobId: jobId,
            fingerprint: renderedFingerprint
        )
        var mutationAccepted = false

        isLoading = true
        errorMessage = nil
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            try await api.cancelInstallJob(
                baseURL: identity.baseURL,
                token: identity.token,
                jobId: jobId,
                expectedRevision: expectedRevision,
                expectedUpdatedAt: expectedUpdatedAt
            )
            guard isCurrentPairingIdentity(identity) else { return }
            mutationAccepted = true
            markActivityMutationAccepted(jobId: jobId, fingerprint: suspendedFingerprint)
            toastMessage = "Cancellation requested on the paired host."

            let refreshed: InstallJobDetailDTO?
            do {
                let authorityRead = beginActivityDetailAuthorityRead(jobId: jobId)
                let response = try await api.getInstallJob(
                    baseURL: identity.baseURL,
                    token: identity.token,
                    jobId: jobId,
                    policy: .foregroundLiveness
                )
                refreshed = publishActivityDetailAuthority(response, readToken: authorityRead)
            } catch HelperAPIError.unauthorized {
                throw HelperAPIError.unauthorized
            } catch {
                refreshed = nil
            }
            guard isCurrentPairingIdentity(identity) else { return }
            if let refreshed {
                let renderedJob = operationJobsById[refreshed.id] ?? refreshed
                if selectionStillOwnsFollowUp(
                    selection,
                    operationJobId: jobId,
                    pairingIdentity: identity
                ) {
                    _ = applyInstallSnapshot(renderedJob, pairingIdentity: identity)
                }
            }
            await refreshDailyOperations(pairingIdentity: identity)
        } catch HelperAPIError.commandRejected(let statusCode, let code, let message) {
            guard isCurrentPairingIdentity(identity) else { return }
            if !mutationAccepted {
                if statusCode == 408 {
                    markActivityMutationOutcomeUnknown(
                        jobId: jobId,
                        fingerprint: suspendedFingerprint
                    )
                } else if statusCode == 404 || code == "JOB_VERSION_MISMATCH" || code == "JOB_NOT_FOUND" {
                    invalidateActivityMutationAfterStaleRejection(
                        jobId: jobId,
                        fingerprint: suspendedFingerprint
                    )
                } else {
                    restoreActivityMutationAfterRequestFailure(
                        jobId: jobId,
                        fingerprint: suspendedFingerprint
                    )
                }
            }
            errorMessage = statusCode == 408
                ? "The cancellation outcome could not be confirmed. SideLink will not send it again until the receipt changes."
                : message
        } catch HelperAPIError.unauthorized {
            guard isCurrentPairingIdentity(identity) else { return }
            if !mutationAccepted {
                restoreActivityMutationAfterRequestFailure(
                    jobId: jobId,
                    fingerprint: suspendedFingerprint
                )
            }
            losePairingAuthority(
                pairingIdentity: identity,
                message: "Re-pair with your desktop to cancel this operation."
            )
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            if !mutationAccepted {
                markActivityMutationOutcomeUnknown(
                    jobId: jobId,
                    fingerprint: suspendedFingerprint
                )
            }
            errorMessage = mutationAccepted
                ? "The host accepted cancellation, but the latest receipt could not be confirmed yet."
                : "The cancellation outcome could not be confirmed. SideLink will not send it again until the receipt changes."
        }
    }

    func cancelPresentedInstallJob(renderedJob: InstallJobDetailDTO) async {
        guard isInstallJobInFlight(renderedJob) else {
            return
        }
        guard let revision = renderedJob.revision else {
            errorMessage = "This receipt has no durable version. Refresh it from the paired host before trying again."
            return
        }
        await cancelDailyOperation(
            jobId: renderedJob.id,
            expectedRevision: revision,
            expectedUpdatedAt: renderedJob.updatedAt
        )
    }
}
