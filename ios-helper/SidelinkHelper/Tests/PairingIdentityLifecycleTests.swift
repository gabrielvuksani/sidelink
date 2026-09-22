import Foundation
import XCTest
@testable import SidelinkHelper

@MainActor
final class PairingIdentityLifecycleTests: XCTestCase {
    private let hostA = "https://host-a.test"
    private let hostB = "https://host-b.test"
    private let hostC = "https://host-c.test"

    func testStartupDoesNotBindLegacyTokenToEditableDraftHost() {
        resetCredentialStorage()
        let credentialStore = LifecyclePairingCredentialStore()
        UserDefaults.standard.set(hostB, forKey: "backendURL")
        UserDefaults.standard.set("token-a", forKey: "helperToken")
        UserDefaults.standard.set("Old host", forKey: "serverName")

        let model = HelperViewModel(
            loadStoredPairingIdentity: credentialStore.load,
            storePairingIdentity: credentialStore.store,
            revokeStoredPairingIdentity: credentialStore.revoke,
            startLongLivedServices: false
        )
        defer { cleanUp(model) }

        XCTAssertNil(model.currentPairingIdentity())
        XCTAssertEqual(model.backendURL, hostB)
        XCTAssertEqual(model.serverName, "")
        XCTAssertNil(credentialStore.load())
    }

    func testDraftEditSupersedesDelayedPairAndKeepsOldBearerOnCommittedOrigin() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let model = makeModel(transport: transport)
        defer { cleanUp(model) }
        model.serverName = "Host A"
        model.backendURL = hostB
        model.pairingCode = "123456"

        let pairing = Task { await model.pair() }
        try await waitUntil { await transport.requestCount(path: "/api/system/pair") == 1 }
        let pairID = await transport.requestIDs(path: "/api/system/pair").first!
        let pairRequest = await transport.request(id: pairID)
        XCTAssertEqual(pairRequest?.host, "host-b.test")
        XCTAssertNil(pairRequest?.token)

        model.backendURL = hostC
        await transport.resolve(
            id: pairID,
            json: #"{"ok":true,"data":{"token":"token-b","serverName":"Host B","serverVersion":"2"}}"#
        )

        let didPair = await pairing.value
        XCTAssertFalse(didPair)
        XCTAssertEqual(model.backendURL, hostC)
        XCTAssertEqual(model.currentPairingIdentity()?.baseURL, hostA)
        XCTAssertEqual(model.currentPairingIdentity()?.token, "token-a")
        XCTAssertEqual(model.serverName, "Host A")

        let read = Task { await model.loadHelperLogs() }
        try await waitUntil { await transport.requestCount(path: "/api/helper/logs") == 1 }
        let logID = await transport.requestIDs(path: "/api/helper/logs").first!
        let logRequest = await transport.request(id: logID)
        XCTAssertEqual(logRequest?.host, "host-a.test")
        XCTAssertEqual(logRequest?.token, "token-a")
        await transport.resolve(id: logID, json: #"{"ok":true,"data":[]}"#)
        await read.value
    }

    func testAcceptedPairReturnsBeforeDeferredBootstrapCompletes() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let model = makeModel(transport: transport)
        let resultProbe = LifecyclePairingResultProbe()
        defer { cleanUp(model) }
        model.backendURL = hostB
        model.pairingCode = "123456"

        let pairing = Task {
            let result = await model.pair()
            await resultProbe.record(result)
            return result
        }
        try await waitUntil { await transport.requestCount(path: "/api/system/pair") == 1 }
        let pairIDs = await transport.requestIDs(path: "/api/system/pair")
        let pairID = try XCTUnwrap(pairIDs.first)
        let responseStartedAt = Date()
        await transport.resolve(
            id: pairID,
            json: #"{"ok":true,"data":{"token":"token-b","serverName":"Host B","serverVersion":"2"}}"#
        )

        try await waitUntil {
            let statusCount = await transport.requestCount(path: "/api/helper/status")
            let configCount = await transport.requestCount(path: "/api/helper/config")
            let accountCount = await transport.requestCount(path: "/api/helper/accounts")
            let ipaCount = await transport.requestCount(path: "/api/helper/ipas")
            return statusCount == 1 && configCount == 1 && accountCount == 1 && ipaCount == 1
        }
        for _ in 0 ..< 200 {
            if await resultProbe.value() != nil {
                break
            }
            try await Task.sleep(nanoseconds: 5_000_000)
        }

        let pairingResult = await resultProbe.value()
        XCTAssertEqual(pairingResult, true, "Accepted pairing must not await bootstrap reads")
        XCTAssertLessThan(Date().timeIntervalSince(responseStartedAt), 1)
        XCTAssertFalse(model.isPairing)
        XCTAssertEqual(model.currentPairingIdentity()?.baseURL, hostB)
        XCTAssertEqual(model.currentPairingIdentity()?.token, "token-b")
        XCTAssertTrue(model.hostReachable)
        XCTAssertNotNil(model.hostLastReachedAt)

        let statusIDs = await transport.requestIDs(path: "/api/helper/status")
        let configIDs = await transport.requestIDs(path: "/api/helper/config")
        let accountIDs = await transport.requestIDs(path: "/api/helper/accounts")
        let ipaIDs = await transport.requestIDs(path: "/api/helper/ipas")
        model.clearPairing()
        for requestID in statusIDs + configIDs + accountIDs + ipaIDs {
            await transport.resolve(
                id: requestID,
                status: 400,
                json: #"{"ok":false,"error":"Bootstrap released"}"#
            )
        }
        _ = await pairing.value
    }

    func testPairingTimeoutPreservesCommittedIdentityAndRequiresFreshCode() async throws {
        resetCredentialStorage()
        let transport = LifecyclePairingTimeoutTransport()
        let credentialStore = LifecyclePairingCredentialStore()
        let model = HelperViewModel(
            api: APIClient(
                transport: { try await transport.handle($0) },
                foregroundDeadline: 0.05
            ),
            loadStoredPairingIdentity: credentialStore.load,
            storePairingIdentity: credentialStore.store,
            revokeStoredPairingIdentity: credentialStore.revoke,
            startLongLivedServices: false
        )
        defer { cleanUp(model) }
        model.backendURL = hostA
        XCTAssertTrue(model.replacePairingIdentity(baseURL: hostA, token: "token-a"))
        model.backendURL = hostB
        model.pairingCode = "123456"

        let didPair = await model.pair()

        XCTAssertFalse(didPair)
        XCTAssertFalse(model.isPairing)
        XCTAssertEqual(model.currentPairingIdentity()?.baseURL, hostA)
        XCTAssertEqual(model.currentPairingIdentity()?.token, "token-a")
        XCTAssertEqual(credentialStore.load()?.baseURL, hostA)
        XCTAssertEqual(credentialStore.load()?.token, "token-a")
        XCTAssertEqual(
            model.errorMessage,
            "Pairing could not be confirmed. Generate a fresh pairing code on your desktop, then try again."
        )
        let pairRequestCount = await transport.requestCount(
            path: "/api/system/pair",
            method: "POST"
        )
        XCTAssertEqual(pairRequestCount, 1)
        let totalRequestCount = await transport.requestCount()
        XCTAssertEqual(totalRequestCount, 1)
    }

    func testPairingFailsClosedWhenAtomicCredentialWriteCannotBeReloaded() async throws {
        resetCredentialStorage()
        let transport = LifecycleDeferredHTTPTransport()
        let credentialStore = LifecyclePairingCredentialStore()
        credentialStore.failsWrites = true
        let model = HelperViewModel(
            api: APIClient(transport: { try await transport.handle($0) }),
            loadStoredPairingIdentity: credentialStore.load,
            storePairingIdentity: credentialStore.store,
            revokeStoredPairingIdentity: credentialStore.revoke,
            startLongLivedServices: false
        )
        defer { cleanUp(model) }
        model.backendURL = hostA
        model.pairingCode = "123456"

        let pairing = Task { await model.pair() }
        try await waitUntil { await transport.requestCount(path: "/api/system/pair") == 1 }
        let requestIDs = await transport.requestIDs(path: "/api/system/pair")
        let requestID = try XCTUnwrap(requestIDs.first)
        await transport.resolve(
            id: requestID,
            json: #"{"ok":true,"data":{"token":"token-a","serverName":"Host A","serverVersion":"2"}}"#
        )

        let didPair = await pairing.value
        XCTAssertFalse(didPair)
        XCTAssertNil(model.currentPairingIdentity())
        XCTAssertTrue(model.pairedBackendURL.isEmpty)
        XCTAssertNil(credentialStore.load())
        XCTAssertEqual(model.errorMessage, "Could not securely store the paired host identity.")
        XCTAssertTrue(model.serverName.isEmpty)
    }

    func testPairingSurfacesServerEnvelopeErrorInsteadOfRawJSON() async throws {
        let client = APIClient { request in
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 401,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (
                Data(#"{"ok":false,"error":"Invalid or expired pairing code"}"#.utf8),
                response
            )
        }

        do {
            _ = try await client.pair(baseURL: hostA, code: "123456")
            XCTFail("Expected pairing to reject an invalid code")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Invalid or expired pairing code")
            XCTAssertFalse(error.localizedDescription.contains("{"))
        }
    }

    func testStaleSSEEventAndFailureCannotPublishOrReconnectReplacementIdentity() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let stream = LifecycleSSEStream()
        let sleeper = LifecycleDeferredSleeper()
        let model = makeModel(
            transport: transport,
            sseClient: stream,
            sseReconnectSleep: { _ in await sleeper.sleep() }
        )
        defer { cleanUp(model) }
        let identityA = try XCTUnwrap(model.currentPairingIdentity())
        model.connectSSEIfPossible(pairingIdentity: identityA)
        let connectionA = try XCTUnwrap(stream.connectionIDs().last)

        replaceWithHostB(model)
        let identityB = try XCTUnwrap(model.currentPairingIdentity())
        model.connectSSEIfPossible(pairingIdentity: identityB)
        let connectionB = try XCTUnwrap(stream.connectionIDs().last)
        stream.emitEvent(connectionID: connectionB, event: "message", data: "{}")
        try await waitUntil { model.sseConnected }

        stream.emitEvent(
            connectionID: connectionA,
            event: "log",
            data: #"{"id":"old-log","level":"info","code":"old","message":"old host","at":"2026-07-20T12:00:00.000Z"}"#
        )
        stream.emitFailure(connectionID: connectionA)
        for _ in 0 ..< 5 {
            await Task.yield()
        }

        XCTAssertTrue(model.helperLogs.isEmpty)
        XCTAssertTrue(model.sseConnected)
        XCTAssertEqual(stream.connectionIDs().count, 2)
        let reconnectSleepCount = await sleeper.invocationCount()
        XCTAssertEqual(reconnectSleepCount, 0)
    }

    func testRepeatedConnectForCurrentIdentityReusesExistingStream() throws {
        let stream = LifecycleSSEStream()
        let model = makeModel(
            transport: LifecycleDeferredHTTPTransport(),
            sseClient: stream
        )
        defer { cleanUp(model) }
        let identity = try XCTUnwrap(model.currentPairingIdentity())

        model.connectSSEIfPossible(pairingIdentity: identity)
        model.connectSSEIfPossible(pairingIdentity: identity)

        XCTAssertEqual(stream.connectionIDs().count, 1)
    }

    func testSSEReconnectKeepsOldTokenOnCommittedOriginAfterDraftHostEdit() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let stream = LifecycleSSEStream()
        let sleeper = LifecycleDeferredSleeper()
        let model = makeModel(
            transport: transport,
            sseClient: stream,
            sseReconnectSleep: { _ in await sleeper.sleep() }
        )
        defer { cleanUp(model) }
        let identityA = try XCTUnwrap(model.currentPairingIdentity())
        model.connectSSEIfPossible(pairingIdentity: identityA)
        let connectionA = try XCTUnwrap(stream.connectionIDs().last)

        model.backendURL = hostB
        stream.emitFailure(connectionID: connectionA)
        try await waitUntil { await sleeper.invocationCount() == 1 }
        await sleeper.resumeNext()
        try await waitUntil { stream.connectionIDs().count == 2 }

        let reconnectID = try XCTUnwrap(stream.connectionIDs().last)
        let reconnect = try XCTUnwrap(stream.connection(id: reconnectID))
        XCTAssertEqual(reconnect.url.host, "host-a.test")
        XCTAssertEqual(reconnect.headers["x-sidelink-helper-token"], "token-a")
        XCTAssertEqual(model.backendURL, hostB)
        XCTAssertEqual(model.currentPairingIdentity(), identityA)
    }

    func testCurrentSSECloseClearsConnectivityAndSchedulesOnlyOneReconnect() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let stream = LifecycleSSEStream()
        let sleeper = LifecycleDeferredSleeper()
        let model = makeModel(
            transport: transport,
            sseClient: stream,
            sseReconnectSleep: { _ in await sleeper.sleep() }
        )
        defer { cleanUp(model) }
        primeAuthority(model)
        let identity = try XCTUnwrap(model.currentPairingIdentity())
        model.connectSSEIfPossible(pairingIdentity: identity)
        let connectionID = try XCTUnwrap(stream.connectionIDs().last)
        stream.emitEvent(connectionID: connectionID, event: "message", data: "{}")
        try await waitUntil { model.sseConnected && model.hostReachable }

        stream.emitEvent(connectionID: connectionID, event: "close", data: "")
        try await waitUntil {
            let reconnectSleepCount = await sleeper.invocationCount()
            return !model.sseConnected
                && !model.hostReachable
                && reconnectSleepCount == 1
        }

        stream.emitEvent(connectionID: connectionID, event: "close", data: "")
        stream.emitFailure(connectionID: connectionID)
        for _ in 0 ..< 5 {
            await Task.yield()
        }
        let reconnectSleepCount = await sleeper.invocationCount()
        XCTAssertEqual(reconnectSleepCount, 1)
        XCTAssertEqual(stream.connectionIDs().count, 1)
        XCTAssertEqual(model.currentPairingIdentity(), identity)

        await sleeper.resumeNext()
        try await waitUntil { stream.connectionIDs().count == 2 }
        let reconnectID = try XCTUnwrap(stream.connectionIDs().last)
        let reconnect = try XCTUnwrap(stream.connection(id: reconnectID))
        XCTAssertEqual(reconnect.url.host, "host-a.test")
        XCTAssertEqual(reconnect.headers["x-sidelink-helper-token"], "token-a")
    }

    func testAuthorityRevocationDisconnectsWithoutReconnectingWhenCloseFollows() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let stream = LifecycleSSEStream()
        let sleeper = LifecycleDeferredSleeper()
        let model = makeModel(
            transport: transport,
            sseClient: stream,
            sseReconnectSleep: { _ in await sleeper.sleep() }
        )
        defer { cleanUp(model) }
        primeAuthority(model)
        let identity = try XCTUnwrap(model.currentPairingIdentity())
        model.connectSSEIfPossible(pairingIdentity: identity)
        let connectionID = try XCTUnwrap(stream.connectionIDs().last)

        stream.emitEvent(
            connectionID: connectionID,
            event: "authority-revoked",
            data: #"{"reason":"token_rotated"}"#
        )
        stream.emitEvent(connectionID: connectionID, event: "close", data: "")
        stream.emitFailure(connectionID: connectionID, error: SSEStreamingError.closed)
        try await waitUntil { model.currentPairingIdentity() == nil }

        XCTAssertFalse(model.sseConnected)
        XCTAssertFalse(model.hostReachable)
        XCTAssertTrue(model.dailyOperationsAreStale)
        XCTAssertEqual(stream.connectionIDs().count, 1)
        let reconnectSleepCount = await sleeper.invocationCount()
        XCTAssertEqual(reconnectSleepCount, 0)
    }

    func testDelayedSSEJobLookupCannotPublishAfterIdentityReplacement() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let stream = LifecycleSSEStream()
        let model = makeModel(transport: transport, sseClient: stream)
        defer { cleanUp(model) }
        let identityA = try XCTUnwrap(model.currentPairingIdentity())
        model.connectSSEIfPossible(pairingIdentity: identityA)
        let connectionA = try XCTUnwrap(stream.connectionIDs().last)

        stream.emitEvent(connectionID: connectionA, event: "job-update", data: #"{"jobId":"old-job"}"#)
        try await waitUntil { await transport.requestCount(path: "/api/helper/jobs/old-job") == 1 }
        let requestID = await transport.requestIDs(path: "/api/helper/jobs/old-job").first!
        replaceWithHostB(model)
        await transport.resolve(id: requestID, json: installJobEnvelope(id: "old-job"))
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertTrue(model.operationJobsById.isEmpty)
        XCTAssertNil(model.activeInstallJob)
        let requestCount = await transport.requestCount()
        XCTAssertEqual(requestCount, 1)
    }

    func testDelayedRefreshReceiptCannotPublishOrFollowUpOnReplacementHost() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let model = makeModel(transport: transport)
        defer { cleanUp(model) }
        primeAuthority(model)

        let refresh = Task { await model.triggerRefresh(installId: "install-a") }
        try await waitUntil { await transport.requestCount(path: "/api/helper/refresh") == 1 }
        let requestID = await transport.requestIDs(path: "/api/helper/refresh").first!
        replaceWithHostB(model)
        await transport.resolve(
            id: requestID,
            json: #"{"ok":true,"data":{"disposition":"accepted","job":{"id":"old-job","status":"queued"}}}"#
        )
        await refresh.value

        XCTAssertNil(model.expectedInstallJobId)
        XCTAssertNil(model.toastMessage)
        XCTAssertTrue(model.pendingJobCommandKeys.isEmpty)
        XCTAssertNil(model.dailyOperations)
        XCTAssertNil(model.dailyOperationsLastSyncedAt)
        let requestCount = await transport.requestCount()
        XCTAssertEqual(requestCount, 1)
    }

    func testDelayedInstall2FACannotReadOrPublishAfterIdentityReplacement() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let model = makeModel(transport: transport)
        defer { cleanUp(model) }
        primeAuthority(model)
        let waitingReceipt = installJob(id: "waiting", status: "waiting_2fa")
        model.activeInstallJob = waitingReceipt
        model.installConsolePresentationJobId = "waiting"
        model.activeInstall2FACode = "123456"

        let submit = Task { await model.submitActiveInstall2FA(renderedJob: waitingReceipt) }
        try await waitUntil { await transport.requestCount(path: "/api/helper/jobs/waiting/commands/2fa") == 1 }
        let requestID = await transport.requestIDs(path: "/api/helper/jobs/waiting/commands/2fa").first!
        replaceWithHostB(model)
        await transport.resolve(id: requestID, json: #"{"ok":true}"#)
        await submit.value

        XCTAssertNil(model.activeInstallJob)
        XCTAssertTrue(model.activeInstall2FACode.isEmpty)
        let requestCount = await transport.requestCount()
        XCTAssertEqual(requestCount, 1)
    }

    func testDelayedAppIDDeleteCannotToastOrReloadReplacementHost() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let model = makeModel(transport: transport)
        defer { cleanUp(model) }
        primeAuthority(model)

        let deletion = Task { await model.deleteAppId("old-app-id") }
        try await waitUntil { await transport.requestCount(path: "/api/helper/app-ids/old-app-id") == 1 }
        let requestID = await transport.requestIDs(path: "/api/helper/app-ids/old-app-id").first!
        replaceWithHostB(model)
        await transport.resolve(id: requestID, json: #"{"ok":true}"#)
        await deletion.value

        XCTAssertNil(model.toastMessage)
        XCTAssertTrue(model.appIds.isEmpty)
        let requestCount = await transport.requestCount()
        XCTAssertEqual(requestCount, 1)
    }

    func testDelayedCancelCannotReadOrRefreshAfterIdentityReplacement() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let model = makeModel(transport: transport)
        defer { cleanUp(model) }
        primeAuthority(model)
        model.activeInstallJob = installJob(id: "old-job", status: "running")
        model.installConsolePresentationJobId = "old-job"

        let cancellation = Task {
            await model.cancelDailyOperation(
                jobId: "old-job",
                expectedRevision: 1,
                expectedUpdatedAt: "2026-07-20T12:01:00.000Z"
            )
        }
        try await waitUntil { await transport.requestCount(path: "/api/helper/jobs/old-job/commands/cancel") == 1 }
        let requestID = await transport.requestIDs(path: "/api/helper/jobs/old-job/commands/cancel").first!
        replaceWithHostB(model)
        await transport.resolve(id: requestID, json: #"{"ok":true,"data":true}"#)
        await cancellation.value

        XCTAssertNil(model.toastMessage)
        XCTAssertTrue(model.operationJobsById.isEmpty)
        let requestCount = await transport.requestCount()
        XCTAssertEqual(requestCount, 1)
    }

    func testDelayedOldCommandRejectionsCannotMutateSameHostReplacementAuthority() async throws {
        let rejections = [
            (400, #"{"ok":false,"code":"INVALID_REQUEST","error":"Rejected"}"#),
            (408, #"{"ok":false,"error":"Timed out"}"#),
            (404, #"{"ok":false,"error":"Missing"}"#),
        ]
        for (status, json) in rejections {
            try await assertDelayedOldCommandRejectionIsIsolated(status: status, json: json)
        }
    }

    func testDelayedSourceMutationCannotClearDraftOrRefreshReplacementHost() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let model = makeModel(transport: transport)
        defer { cleanUp(model) }
        primeAuthority(model)
        model.sourceURLInput = "https://example.com/source.json"

        let addition = Task { await model.addCustomSource() }
        try await waitUntil { await transport.requestCount(path: "/api/helper/sources") == 1 }
        let requestID = await transport.requestIDs(path: "/api/helper/sources").first!
        replaceWithHostB(model)
        await transport.resolve(id: requestID, json: #"{"ok":true}"#)
        await addition.value

        XCTAssertEqual(model.sourceURLInput, "https://example.com/source.json")
        XCTAssertNil(model.toastMessage)
        XCTAssertTrue(model.sourceCatalogs.isEmpty)
        let requestCount = await transport.requestCount()
        XCTAssertEqual(requestCount, 1)
    }

    func testDelayedReadLoaderCannotPublishOldHostData() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let model = makeModel(transport: transport)
        defer { cleanUp(model) }

        let read = Task { await model.loadHelperLogs() }
        try await waitUntil { await transport.requestCount(path: "/api/helper/logs") == 1 }
        let requestID = await transport.requestIDs(path: "/api/helper/logs").first!
        replaceWithHostB(model)
        await transport.resolve(
            id: requestID,
            json: #"{"ok":true,"data":[{"id":"old-log","level":"info","code":"old","message":"old host","at":"2026-07-20T12:00:00.000Z"}]}"#
        )
        await read.value

        XCTAssertTrue(model.helperLogs.isEmpty)
        XCTAssertNil(model.errorMessage)
    }

    func testClearPairingTombstonesIdentityWhenCredentialDeletionFailsAndRestartRejectsIt() throws {
        let transport = LifecycleDeferredHTTPTransport()
        let credentialStore = LifecyclePairingCredentialStore()
        let model = makeModel(transport: transport, credentialStore: credentialStore)
        defer {
            credentialStore.failsClears = false
            cleanUp(model)
        }
        let storedIdentity = try XCTUnwrap(credentialStore.load())
        credentialStore.failsClears = true

        model.clearPairing()

        XCTAssertNil(model.currentPairingIdentity())
        XCTAssertTrue(model.pairedBackendURL.isEmpty)
        XCTAssertEqual(credentialStore.load(), storedIdentity)
        XCTAssertTrue(PairingCredentialStorage.isRevoked(identityID: storedIdentity.id))

        let restarted = HelperViewModel(
            loadStoredPairingIdentity: credentialStore.load,
            storePairingIdentity: credentialStore.store,
            revokeStoredPairingIdentity: credentialStore.revoke,
            startLongLivedServices: false
        )
        XCTAssertNil(restarted.currentPairingIdentity())
        XCTAssertTrue(restarted.pairedBackendURL.isEmpty)
        restarted.invalidate()
    }

    func testAuthorityRevocationTombstonesIdentityWhenCredentialDeletionFails() throws {
        let transport = LifecycleDeferredHTTPTransport()
        let credentialStore = LifecyclePairingCredentialStore()
        let model = makeModel(transport: transport, credentialStore: credentialStore)
        defer {
            credentialStore.failsClears = false
            cleanUp(model)
        }
        let identity = try XCTUnwrap(model.currentPairingIdentity())
        credentialStore.failsClears = true

        model.losePairingAuthority(pairingIdentity: identity)

        XCTAssertNil(model.currentPairingIdentity())
        XCTAssertTrue(PairingCredentialStorage.isRevoked(identityID: identity.id))
        XCTAssertEqual(credentialStore.load()?.id, identity.id)
        XCTAssertEqual(model.errorMessage, "Your helper token is no longer valid. Re-pair with your desktop.")
    }

    func testBackgroundInitialUnauthorizedTombstonesExactIdentityAndForegroundReconciles() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let credentialStore = LifecyclePairingCredentialStore()
        let model = makeModel(transport: transport, credentialStore: credentialStore)
        let notificationCenter = LifecycleBackgroundNotificationCenter()
        defer {
            credentialStore.failsClears = false
            cleanUp(model)
        }
        let storedIdentity = try XCTUnwrap(credentialStore.load())
        credentialStore.failsClears = true
        let coordinator = BackgroundRefreshCoordinator(
            api: APIClient(transport: { try await transport.handle($0) }),
            notificationCenter: notificationCenter,
            loadStoredPairingIdentity: credentialStore.load,
            revokeStoredPairingIdentity: credentialStore.revoke
        )

        let cycle = Task { await coordinator.performRefreshCycle() }
        try await waitUntil { await transport.requestCount(path: "/api/helper/auto-refresh-states") == 1 }
        let requestIDs = await transport.requestIDs(path: "/api/helper/auto-refresh-states")
        let requestID = try XCTUnwrap(requestIDs.first)
        await transport.resolve(id: requestID, status: 401, json: #"{"ok":false,"error":"unauthorized"}"#)

        let succeeded = await cycle.value
        XCTAssertFalse(succeeded)
        XCTAssertEqual(credentialStore.load(), storedIdentity)
        XCTAssertTrue(PairingCredentialStorage.isRevoked(identityID: storedIdentity.id))
        let addedIdentifiers = await notificationCenter.addedIdentifiers()
        XCTAssertTrue(addedIdentifiers.isEmpty)
        XCTAssertEqual(model.pairedBackendURL, hostA)

        XCTAssertTrue(model.reconcilePairingAuthority())
        XCTAssertNil(model.currentPairingIdentity())
        XCTAssertTrue(model.pairedBackendURL.isEmpty)
        XCTAssertEqual(model.errorMessage, "Your helper token is no longer valid. Re-pair with your desktop.")
    }

    func testStaleBackgroundUnauthorizedTombstonesCapturedIdentityWithoutRevokingReplacement() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let credentialStore = LifecyclePairingCredentialStore()
        let model = makeModel(transport: transport, credentialStore: credentialStore)
        let notificationCenter = LifecycleBackgroundNotificationCenter()
        defer { cleanUp(model) }
        let capturedIdentity = try XCTUnwrap(credentialStore.load())
        let coordinator = BackgroundRefreshCoordinator(
            api: APIClient(transport: { try await transport.handle($0) }),
            notificationCenter: notificationCenter,
            loadStoredPairingIdentity: credentialStore.load,
            revokeStoredPairingIdentity: credentialStore.revoke
        )

        let cycle = Task { await coordinator.performRefreshCycle() }
        try await waitUntil { await transport.requestCount(path: "/api/helper/auto-refresh-states") == 1 }
        let requestIDs = await transport.requestIDs(path: "/api/helper/auto-refresh-states")
        let requestID = try XCTUnwrap(requestIDs.first)
        let replacementIdentity = try XCTUnwrap(
            credentialStore.store(baseURL: hostB, token: "token-b")
        )
        await transport.resolve(id: requestID, status: 401, json: #"{"ok":false,"error":"unauthorized"}"#)

        let succeeded = await cycle.value
        XCTAssertFalse(succeeded)
        XCTAssertEqual(credentialStore.load(), replacementIdentity)
        XCTAssertTrue(PairingCredentialStorage.isRevoked(identityID: capturedIdentity.id))
        XCTAssertFalse(PairingCredentialStorage.isRevoked(identityID: replacementIdentity.id))
        let addedIdentifiers = await notificationCenter.addedIdentifiers()
        XCTAssertTrue(addedIdentifiers.isEmpty)
    }

    func testBackgroundPerAppUnauthorizedAbortsRemainingRequestsAndSuppressesNotifications() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let credentialStore = LifecyclePairingCredentialStore()
        let model = makeModel(transport: transport, credentialStore: credentialStore)
        let notificationCenter = LifecycleBackgroundNotificationCenter()
        defer { cleanUp(model) }
        let storedIdentity = try XCTUnwrap(credentialStore.load())
        let coordinator = BackgroundRefreshCoordinator(
            api: APIClient(transport: { try await transport.handle($0) }),
            notificationCenter: notificationCenter,
            loadStoredPairingIdentity: credentialStore.load,
            revokeStoredPairingIdentity: credentialStore.revoke
        )

        let cycle = Task { await coordinator.performRefreshCycle() }
        try await waitUntil { await transport.requestCount(path: "/api/helper/auto-refresh-states") == 1 }
        let listRequestIDs = await transport.requestIDs(path: "/api/helper/auto-refresh-states")
        let listRequestID = try XCTUnwrap(listRequestIDs.first)
        await transport.resolve(id: listRequestID, json: autoRefreshStatesEnvelope(candidateCount: 2))
        try await waitUntil { await transport.requestCount(path: "/api/helper/refresh") == 1 }
        let refreshRequestIDs = await transport.requestIDs(path: "/api/helper/refresh")
        let refreshRequestID = try XCTUnwrap(refreshRequestIDs.first)
        await transport.resolve(id: refreshRequestID, status: 401, json: #"{"ok":false,"error":"unauthorized"}"#)

        let succeeded = await cycle.value
        let refreshRequestCount = await transport.requestCount(path: "/api/helper/refresh")
        XCTAssertFalse(succeeded)
        XCTAssertEqual(refreshRequestCount, 1)
        XCTAssertTrue(PairingCredentialStorage.isRevoked(identityID: storedIdentity.id))
        let addedIdentifiers = await notificationCenter.addedIdentifiers()
        XCTAssertTrue(addedIdentifiers.isEmpty)
    }

    func testBackgroundNotificationIsIdentityBoundAndRemovedWhenIdentityChangesDuringAdd() async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let credentialStore = LifecyclePairingCredentialStore()
        let model = makeModel(transport: transport, credentialStore: credentialStore)
        let notificationCenter = LifecycleBackgroundNotificationCenter(defersAdds: true)
        defer { cleanUp(model) }
        let storedIdentity = try XCTUnwrap(credentialStore.load())
        let coordinator = BackgroundRefreshCoordinator(
            api: APIClient(transport: { try await transport.handle($0) }),
            notificationCenter: notificationCenter,
            loadStoredPairingIdentity: credentialStore.load,
            revokeStoredPairingIdentity: credentialStore.revoke
        )

        let cycle = Task { await coordinator.performRefreshCycle() }
        try await waitUntil { await transport.requestCount(path: "/api/helper/auto-refresh-states") == 1 }
        let listRequestIDs = await transport.requestIDs(path: "/api/helper/auto-refresh-states")
        let listRequestID = try XCTUnwrap(listRequestIDs.first)
        await transport.resolve(id: listRequestID, json: autoRefreshStatesEnvelope(candidateCount: 1))
        try await waitUntil { await transport.requestCount(path: "/api/helper/refresh") == 1 }
        let refreshRequestIDs = await transport.requestIDs(path: "/api/helper/refresh")
        let refreshRequestID = try XCTUnwrap(refreshRequestIDs.first)
        await transport.resolve(
            id: refreshRequestID,
            json: #"{"ok":true,"data":{"disposition":"accepted","job":null}}"#
        )
        try await waitUntil { await notificationCenter.addedIdentifiers().count == 1 }

        let queuedIdentifier = "sidelink.refresh.\(storedIdentity.id).queued"
        let addedIdentifiers = await notificationCenter.addedIdentifiers()
        XCTAssertEqual(addedIdentifiers, [queuedIdentifier])
        _ = credentialStore.store(baseURL: hostB, token: "token-b")
        await notificationCenter.resumeNextAdd()

        let succeeded = await cycle.value
        XCTAssertFalse(succeeded)
        let pendingRemovals = await notificationCenter.pendingRemovalIdentifiers()
        let deliveredRemovals = await notificationCenter.deliveredRemovalIdentifiers()
        XCTAssertTrue(pendingRemovals.contains(queuedIdentifier))
        XCTAssertTrue(deliveredRemovals.contains(queuedIdentifier))
    }

    private func makeModel(
        transport: LifecycleDeferredHTTPTransport,
        sseClient: any SSEStreaming = LifecycleSSEStream(),
        sseReconnectSleep: @escaping @Sendable (TimeInterval) async -> Void = { _ in },
        credentialStore: LifecyclePairingCredentialStore? = nil
    ) -> HelperViewModel {
        resetCredentialStorage()
        let credentialStore = credentialStore ?? LifecyclePairingCredentialStore()
        let model = HelperViewModel(
            api: APIClient(transport: { try await transport.handle($0) }),
            sseClient: sseClient,
            sseReconnectSleep: sseReconnectSleep,
            loadStoredPairingIdentity: credentialStore.load,
            storePairingIdentity: credentialStore.store,
            revokeStoredPairingIdentity: credentialStore.revoke,
            startLongLivedServices: false
        )
        model.clearPairing()
        model.backendURL = hostA
        XCTAssertTrue(model.replacePairingIdentity(baseURL: hostA, token: "token-a"))
        return model
    }

    private func replaceWithHostB(_ model: HelperViewModel) {
        model.backendURL = hostB
        XCTAssertTrue(model.replacePairingIdentity(baseURL: hostB, token: "token-b"))
    }

    private func assertDelayedOldCommandRejectionIsIsolated(
        status: Int,
        json: String
    ) async throws {
        let transport = LifecycleDeferredHTTPTransport()
        let model = makeModel(transport: transport)
        defer { cleanUp(model) }
        primeAuthority(model)
        let receipt = installJob(id: "shared-job", status: "running")
        model.activeInstallJob = receipt
        model.installConsolePresentationJobId = receipt.id

        let cancellation = Task {
            await model.cancelDailyOperation(
                jobId: receipt.id,
                expectedRevision: 1,
                expectedUpdatedAt: receipt.updatedAt
            )
        }
        let path = "/api/helper/jobs/shared-job/commands/cancel"
        try await waitUntil { await transport.requestCount(path: path) == 1 }
        let requestIDs = await transport.requestIDs(path: path)
        let requestID = try XCTUnwrap(requestIDs.first)

        model.backendURL = hostA
        XCTAssertTrue(model.replacePairingIdentity(
            baseURL: hostA,
            token: "replacement-token-\(status)"
        ))
        primeAuthority(model)
        model.mergeOperationJobs([receipt])
        let selectionRead = model.beginActivityReceiptSelection(jobId: receipt.id)
        _ = model.publishActivityDetailAuthority(receipt, readToken: selectionRead)
        let replacementFingerprint = model.suspendActivityMutationIfNeeded(for: receipt)

        await transport.resolve(id: requestID, status: status, json: json)
        _ = await cancellation.value

        XCTAssertEqual(
            model.activityMutationSuspensions[receipt.id],
            ActivityMutationSuspension(
                fingerprint: replacementFingerprint,
                disposition: .submitting
            )
        )
        XCTAssertEqual(
            model.activityAuthoritativeVersions[receipt.id],
            replacementFingerprint
        )
        XCTAssertEqual(model.currentPairingIdentity()?.token, "replacement-token-\(status)")
    }

    private func cleanUp(_ model: HelperViewModel) {
        model.clearPairing()
        resetCredentialStorage()
    }

    private func resetCredentialStorage() {
        UserDefaults.standard.removeObject(forKey: "backendURL")
        UserDefaults.standard.removeObject(forKey: PairingCredentialStorage.baseURLKey)
        UserDefaults.standard.removeObject(forKey: "helperToken")
        UserDefaults.standard.removeObject(forKey: PairingCredentialStorage.revocationTombstonesKey)
        _ = KeychainStore.remove(PairingCredentialStorage.identityKey)
        _ = KeychainStore.remove(PairingCredentialStorage.tokenKey)
    }

    private func primeAuthority(_ model: HelperViewModel) {
        model.dailyOperations = try! JSONDecoder().decode(
            DailyOperationsSnapshotDTO.self,
            from: Data(todaySnapshotJSON.utf8)
        )
        let now = Date()
        model.dailyOperationsError = nil
        model.dailyOperationsLastSyncedAt = now
        model.hostReachable = true
        model.publishCurrentDailyOperationsAuthority(syncedAt: now)
    }

    private func waitUntil(
        timeoutIterations: Int = 300,
        _ condition: @escaping () async -> Bool
    ) async throws {
        for _ in 0 ..< timeoutIterations {
            if await condition() { return }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTFail("Timed out waiting for lifecycle request")
    }

    private func installJob(id: String, status: String) -> InstallJobDetailDTO {
        InstallJobDetailDTO(
            id: id,
            title: "Old job",
            detail: "Old host detail",
            operation: "install",
            status: status,
            currentStep: status == "waiting_2fa" ? "sign" : nil,
            steps: [],
            revision: 1,
            createdAt: "2026-07-20T12:00:00.000Z",
            updatedAt: "2026-07-20T12:01:00.000Z",
            eligibleCommands: status == "waiting_2fa" ? ["submit_2fa"] : []
        )
    }

    private func installJobEnvelope(id: String) -> String {
        """
        {"ok":true,"data":{
          "id":"\(id)","title":"Old job","detail":"Old host detail","operation":"install",
          "status":"running","currentStep":"install","steps":[],"revision":1,
          "createdAt":"2026-07-20T12:00:00.000Z","updatedAt":"2026-07-20T12:01:00.000Z",
          "eligibleCommands":[]
        }}
        """
    }

    private func autoRefreshStatesEnvelope(candidateCount: Int) -> String {
        let states = (0 ..< candidateCount).map { index in
            """
            {
              "installedAppId":"install-\(index)","bundleId":"com.example.app\(index)",
              "appName":"App \(index)","deviceUdid":"device-a",
              "expiresAt":"2026-07-21T12:00:00.000Z","isExpired":false,
              "needsRefresh":true,"msUntilExpiry":3600000,"refreshInProgress":false,
              "lastRefreshAt":null,"lastError":null
            }
            """
        }.joined(separator: ",")
        return "{\"ok\":true,\"data\":[\(states)]}"
    }

    private var todaySnapshotJSON: String {
        """
        {
          "schemaVersion":1,"jobCommandPreconditionVersion":1,"generatedAt":"2026-07-20T12:00:00.000Z",
          "headline":"Current","summary":"Current host","actions":[],"operations":[],
          "expiryPressure":[],"expiryHorizonDays":10,"quotaPressure":[],
          "quotaAvailability":"available","recentOutcomes":[],
          "fleet":{"accounts":{"active":1,"total":1},"devices":{"online":1,"detected":1,"paired":1,"managed":1},"apps":{"active":1,"total":1},"library":{"total":1}},
          "readiness":{"status":"ready","issues":[],"helperPairing":"paired"}
        }
        """
    }
}
