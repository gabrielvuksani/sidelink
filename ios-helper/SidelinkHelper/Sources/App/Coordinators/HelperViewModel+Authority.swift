import Foundation

enum PairingCredentialStorage {
    static let baseURLKey = "pairedBackendURL"
    static let tokenKey = "helperToken"
    static let identityKey = "pairingIdentity.v1"
    static let revocationTombstonesKey = "pairingIdentity.revocations.v1"

    private static let storageLock = NSLock()

    struct StoredIdentity: Codable, Equatable, Sendable {
        let id: String
        let baseURL: String
        let token: String
    }

    static func loadIdentity() -> StoredIdentity? {
        storageLock.lock()
        defer { storageLock.unlock() }
        guard let identity = loadRawIdentityLocked(),
              !revokedIdentityIDsLocked().contains(identity.id)
        else { return nil }
        return identity
    }

    static func storeIdentity(baseURL: String, token: String, id: String = UUID().uuidString) -> StoredIdentity? {
        storageLock.lock()
        defer { storageLock.unlock() }
        let identity = StoredIdentity(id: id, baseURL: baseURL, token: token)
        guard !revokedIdentityIDsLocked().contains(id),
              let data = try? JSONEncoder().encode(identity),
              let rawValue = String(data: data, encoding: .utf8),
              KeychainStore.set(identityKey, value: rawValue)
        else {
            return nil
        }
        return identity
    }

    static func isRevoked(identityID: String) -> Bool {
        guard !identityID.isEmpty else { return false }
        storageLock.lock()
        defer { storageLock.unlock() }
        return revokedIdentityIDsLocked().contains(identityID)
    }

    static func markRevoked(identityID: String) {
        guard !identityID.isEmpty else { return }
        storageLock.lock()
        defer { storageLock.unlock() }
        markRevokedLocked(identityID)
    }

    @discardableResult
    static func revokeIdentity(_ identity: StoredIdentity) -> Bool {
        storageLock.lock()
        defer { storageLock.unlock() }

        markRevokedLocked(identity.id)
        guard loadRawIdentityLocked() == identity else {
            return true
        }
        return clearRawIdentityLocked()
    }

    private static func loadRawIdentityLocked() -> StoredIdentity? {
        guard let rawValue = KeychainStore.get(identityKey),
              let data = rawValue.data(using: .utf8),
              let identity = try? JSONDecoder().decode(StoredIdentity.self, from: data),
              !identity.id.isEmpty,
              !identity.baseURL.isEmpty,
              !identity.token.isEmpty
        else {
            return nil
        }
        return identity
    }

    private static func clearRawIdentityLocked() -> Bool {
        guard KeychainStore.set(identityKey, value: "") else { return false }
        _ = KeychainStore.remove(identityKey)
        return true
    }

    private static func revokedIdentityIDsLocked() -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: revocationTombstonesKey) ?? [])
    }

    private static func markRevokedLocked(_ identityID: String) {
        var revokedIDs = revokedIdentityIDsLocked()
        revokedIDs.insert(identityID)
        UserDefaults.standard.set(revokedIDs.sorted(), forKey: revocationTombstonesKey)
    }
}

extension HelperViewModel {
    struct PairingIdentity: Equatable, Sendable {
        let id: String
        let generation: UInt64
        let baseURL: String
        let token: String
    }

    struct DailyOperationSelectionSnapshot: Equatable {
        let generation: UInt64
        let jobId: String?
    }

    var dailyOperationsAreStale: Bool {
        !hasCurrentDailyOperationsAuthority()
    }

    func pairingIdentityDidChange() {
        pairingIdentityGeneration &+= 1
        clearLiveHostStateAfterPairingIdentityChange()
    }

    func currentPairingIdentity() -> PairingIdentity? {
        guard !storedPairingIdentityID.isEmpty,
              !PairingCredentialStorage.isRevoked(identityID: storedPairingIdentityID),
              !pairedBackendURL.isEmpty,
              !helperToken.isEmpty
        else { return nil }
        return PairingIdentity(
            id: storedPairingIdentityID,
            generation: pairingIdentityGeneration,
            baseURL: pairedBackendURL,
            token: helperToken
        )
    }

    func isCurrentPairingIdentity(_ identity: PairingIdentity) -> Bool {
        !PairingCredentialStorage.isRevoked(identityID: identity.id)
            && storedPairingIdentityID == identity.id
            && pairingIdentityGeneration == identity.generation
            && pairedBackendURL == identity.baseURL
            && helperToken == identity.token
    }

    func losePairingAuthority(
        pairingIdentity identity: PairingIdentity,
        message: String = "Your helper token is no longer valid. Re-pair with your desktop."
    ) {
        guard isCurrentPairingIdentity(identity) else { return }
        _ = revokeCommittedPairingIdentity(pairingIdentity: identity)
        hostReachable = false
        expireDailyOperationsAuthority(message: "Re-pair with your desktop to update Today.")
        errorMessage = message
    }

    @discardableResult
    func handleAuthorityLossIfUnauthorized(
        _ error: Error,
        pairingIdentity identity: PairingIdentity,
        message: String = "Your helper token is no longer valid. Re-pair with your desktop."
    ) -> Bool {
        guard let apiError = error as? HelperAPIError,
              case .unauthorized = apiError
        else {
            return false
        }
        losePairingAuthority(pairingIdentity: identity, message: message)
        return true
    }

    func invalidateDailyOperationsAuthority(message: String?) {
        dailyOperationsRefreshGeneration &+= 1
        expireDailyOperationsAuthority(message: message)
    }

    func expireDailyOperationsAuthority(message: String?) {
        dailyOperationsAuthorityGeneration &+= 1
        dailyOperationsAuthorityExpiryTask?.cancel()
        dailyOperationsAuthorityExpiryTask = nil
        dailyOperationsAuthorityExpired = true
        if let message {
            dailyOperationsError = message
        }
    }

    func publishCurrentDailyOperationsAuthority(syncedAt: Date) {
        dailyOperationsAuthorityGeneration &+= 1
        let generation = dailyOperationsAuthorityGeneration
        dailyOperationsAuthorityExpiryTask?.cancel()
        dailyOperationsAuthorityExpired = false

        let deadline = syncedAt.addingTimeInterval(authorityTTL)
        let delay = max(0, deadline.timeIntervalSince(authorityNow()))
        guard delay > 0 else {
            dailyOperationsAuthorityExpired = true
            dailyOperationsAuthorityExpiryTask = nil
            return
        }

        dailyOperationsAuthorityExpiryTask = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            } catch {
                return
            }
            guard let self,
                  self.dailyOperationsAuthorityGeneration == generation
            else {
                return
            }
            self.dailyOperationsAuthorityExpired = true
            self.dailyOperationsAuthorityExpiryTask = nil
        }
    }

    func hasCurrentDailyOperationsAuthority() -> Bool {
        guard hasPairingCredential,
              hostReachable,
              dailyOperations != nil,
              dailyOperationsError == nil,
              !dailyOperationsAuthorityExpired,
              let syncedAt = dailyOperationsLastSyncedAt
        else {
            return false
        }
        return authorityNow().timeIntervalSince(syncedAt) < authorityTTL
    }

    @discardableResult
    func requireCurrentHostAuthority(for action: String) async -> PairingIdentity? {
        guard let identity = currentPairingIdentity() else {
            _ = requirePairing(for: action)
            return nil
        }
        return await requireCurrentHostAuthority(for: action, identity: identity)
    }

    @discardableResult
    func requireCurrentHostAuthority(for action: String, identity: PairingIdentity) async -> PairingIdentity? {
        guard isCurrentPairingIdentity(identity) else {
            return nil
        }
        if hasCurrentDailyOperationsAuthority() {
            return identity
        }

        _ = await refreshDailyOperations(pairingIdentity: identity)
        guard isCurrentPairingIdentity(identity), hasCurrentDailyOperationsAuthority() else {
            if isCurrentPairingIdentity(identity) {
                errorMessage = dailyOperationsError
                    ?? "SideLink could not confirm the paired host's current state. No changes were made."
            }
            return nil
        }
        return identity
    }

    func nextDailyOperationsRefreshIdentity(
        pairingIdentity identity: PairingIdentity
    ) -> (generation: UInt64, identity: PairingIdentity) {
        dailyOperationsRefreshGeneration &+= 1
        return (dailyOperationsRefreshGeneration, identity)
    }

    func isCurrentDailyOperationsRefresh(
        generation: UInt64,
        pairingIdentity identity: PairingIdentity
    ) -> Bool {
        dailyOperationsRefreshGeneration == generation
            && isCurrentPairingIdentity(identity)
    }

    func invalidateDailyOperationSelection() {
        dailyOperationSelectionGeneration &+= 1
        activeJobPollingTask?.cancel()
        activeJobPollingTask = nil
        activeJobPollingJobId = nil
        activeJobPollingGeneration = nil
    }

    func nextDailyOperationSelectionIdentity(
        pairingIdentity identity: PairingIdentity
    ) -> (generation: UInt64, identity: PairingIdentity) {
        dailyOperationSelectionGeneration &+= 1
        return (dailyOperationSelectionGeneration, identity)
    }

    func isCurrentDailyOperationSelection(
        generation: UInt64,
        jobId: String,
        pairingIdentity identity: PairingIdentity
    ) -> Bool {
        dailyOperationSelectionGeneration == generation
            && selectedOperationJobId == jobId
            && isCurrentPairingIdentity(identity)
    }

    func captureDailyOperationSelection() -> DailyOperationSelectionSnapshot {
        DailyOperationSelectionSnapshot(
            generation: dailyOperationSelectionGeneration,
            jobId: selectedOperationJobId
        )
    }

    func selectionStillOwnsFollowUp(
        _ selection: DailyOperationSelectionSnapshot,
        operationJobId: String,
        pairingIdentity identity: PairingIdentity
    ) -> Bool {
        dailyOperationSelectionGeneration == selection.generation
            && selectedOperationJobId == selection.jobId
            && (selection.jobId == nil || selection.jobId == operationJobId)
            && isCurrentPairingIdentity(identity)
    }

    func nextAppIDRead(pairingIdentity identity: PairingIdentity) -> (generation: UInt64, identity: PairingIdentity) {
        appIDReadGeneration &+= 1
        return (appIDReadGeneration, identity)
    }

    func isCurrentAppIDRead(generation: UInt64, pairingIdentity identity: PairingIdentity) -> Bool {
        appIDReadGeneration == generation && isCurrentPairingIdentity(identity)
    }

    func nextSourceCatalogRead(pairingIdentity identity: PairingIdentity) -> (generation: UInt64, identity: PairingIdentity) {
        (nextSourceCatalogReadGeneration(), identity)
    }

    func isCurrentSourceCatalogRead(generation: UInt64, pairingIdentity identity: PairingIdentity) -> Bool {
        sourceCatalogReadGeneration == generation && isCurrentPairingIdentity(identity)
    }

    func nextSourceCatalogReadGeneration() -> UInt64 {
        sourceCatalogReadGeneration &+= 1
        return sourceCatalogReadGeneration
    }

    func isCurrentUnpairedSourceCatalogRead(
        generation: UInt64,
        pairingGeneration: UInt64
    ) -> Bool {
        sourceCatalogReadGeneration == generation
            && pairingIdentityGeneration == pairingGeneration
            && currentPairingIdentity() == nil
    }
}
