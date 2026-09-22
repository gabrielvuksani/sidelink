import Foundation
import XCTest
@testable import SidelinkHelper

private typealias HTTPOutput = (Data, URLResponse)

private struct RecordedRequest: Sendable {
    let id: Int
    let method: String
    let path: String
    let query: String?
    let token: String?
    let body: Data?
}

private actor DeferredHTTPTransport {
    private var nextID = 0
    private var requests: [RecordedRequest] = []
    private var continuations: [Int: CheckedContinuation<HTTPOutput, Error>] = [:]

    func handle(_ request: URLRequest) async throws -> HTTPOutput {
        let id = nextID
        nextID += 1
        requests.append(
            RecordedRequest(
                id: id,
                method: request.httpMethod ?? "GET",
                path: request.url?.path ?? "",
                query: request.url?.query,
                token: request.value(forHTTPHeaderField: "x-sidelink-helper-token"),
                body: request.httpBody
            )
        )
        return try await withCheckedThrowingContinuation { continuation in
            continuations[id] = continuation
        }
    }

    func requestIDs(path: String) -> [Int] {
        requests.filter { $0.path == path }.map(\.id)
    }

    func requestCount() -> Int {
        requests.count
    }

    func request(id: Int) -> RecordedRequest? {
        requests.first(where: { $0.id == id })
    }

    func hasPendingRequest(id: Int) -> Bool {
        continuations[id] != nil
    }

    @discardableResult
    func resolve(id: Int, status: Int = 200, json: String) -> Bool {
        guard let continuation = continuations.removeValue(forKey: id),
              let request = requests.first(where: { $0.id == id }),
              let url = URL(string: "http://127.0.0.1:4010\(request.path)")
        else {
            return false
        }
        let response = HTTPURLResponse(
            url: url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        continuation.resume(returning: (Data(json.utf8), response))
        return true
    }

    @discardableResult
    func reject(id: Int, error: Error) -> Bool {
        guard let continuation = continuations.removeValue(forKey: id) else {
            return false
        }
        continuation.resume(throwing: error)
        return true
    }
}

private actor ImmediateHTTPRouter {
    enum Mode {
        case todayAuthorized
        case todayUnauthorized
        case allUnauthorized
    }

    private var mode: Mode
    private var requests: [RecordedRequest] = []

    init(mode: Mode) {
        self.mode = mode
    }

    func setMode(_ mode: Mode) {
        self.mode = mode
    }

    func count(path: String, method: String? = nil, query: String? = nil) -> Int {
        requests.filter { request in
            request.path == path
                && (method == nil || request.method == method)
                && (query == nil || request.query == query)
        }.count
    }

    func handle(_ request: URLRequest) -> HTTPOutput {
        let record = RecordedRequest(
            id: requests.count,
            method: request.httpMethod ?? "GET",
            path: request.url?.path ?? "",
            query: request.url?.query,
            token: request.value(forHTTPHeaderField: "x-sidelink-helper-token"),
            body: request.httpBody
        )
        requests.append(record)

        if mode == .allUnauthorized {
            return response(for: request, status: 401, json: #"{"ok":false,"error":"Unauthorized"}"#)
        }

        switch record.path {
        case "/api/helper/today":
            if mode == .todayUnauthorized {
                return response(for: request, status: 401, json: #"{"ok":false,"error":"Unauthorized"}"#)
            }
            return response(for: request, json: todayEnvelope(headline: "Current host"))
        case "/api/helper/app-ids", "/api/helper/app-ids/usage":
            return response(for: request, json: #"{"ok":true,"data":[]}"#)
        default:
            if record.method == "DELETE" {
                return response(for: request, json: #"{"ok":true,"data":true}"#)
            }
            return response(for: request, status: 404, json: #"{"ok":false,"error":"Not found"}"#)
        }
    }

    private func response(
        for request: URLRequest,
        status: Int = 200,
        json: String
    ) -> HTTPOutput {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (Data(json.utf8), response)
    }
}

private actor PairingAwareHTTPTransport {
    private let deferredToken: String
    private var nextID = 0
    private var requests: [RecordedRequest] = []
    private var continuations: [Int: CheckedContinuation<HTTPOutput, Error>] = [:]

    init(deferredToken: String) {
        self.deferredToken = deferredToken
    }

    func handle(_ request: URLRequest) async throws -> HTTPOutput {
        let record = RecordedRequest(
            id: nextID,
            method: request.httpMethod ?? "GET",
            path: request.url?.path ?? "",
            query: request.url?.query,
            token: request.value(forHTTPHeaderField: "x-sidelink-helper-token"),
            body: request.httpBody
        )
        nextID += 1
        requests.append(record)

        guard record.token == deferredToken else {
            return immediateFullRefreshResponse(for: request, token: record.token ?? "missing")
        }
        return try await withCheckedThrowingContinuation { continuation in
            continuations[record.id] = continuation
        }
    }

    func requestIDs(path: String, token: String) -> [Int] {
        requests.filter { $0.path == path && $0.token == token }.map(\.id)
    }

    func requestCount(token: String) -> Int {
        requests.filter { $0.token == token }.count
    }

    @discardableResult
    func resolve(id: Int, status: Int = 200, json: String) -> Bool {
        guard let continuation = continuations.removeValue(forKey: id),
              let request = requests.first(where: { $0.id == id }),
              let url = URL(string: "https://host-a.test\(request.path)")
        else {
            return false
        }
        let response = HTTPURLResponse(
            url: url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        continuation.resume(returning: (Data(json.utf8), response))
        return true
    }
}

private actor TrailingRefreshHTTPTransport {
    private let blocksEveryJobsRead: Bool
    private var requestCounts: [String: Int] = [:]
    private var todayHeadline = "First snapshot"
    private var blockedJobsRequests: [(
        request: URLRequest,
        continuation: CheckedContinuation<HTTPOutput, Never>
    )] = []

    init(blocksEveryJobsRead: Bool = false) {
        self.blocksEveryJobsRead = blocksEveryJobsRead
    }

    func handle(_ request: URLRequest) async -> HTTPOutput {
        let path = request.url?.path ?? ""
        requestCounts[path, default: 0] += 1

        if path == "/api/helper/today" {
            return response(for: request, json: todayEnvelope(headline: todayHeadline))
        }

        if path == "/api/helper/jobs",
           blocksEveryJobsRead || requestCounts[path] == 1 {
            return await withCheckedContinuation { continuation in
                blockedJobsRequests.append((request, continuation))
            }
        }

        return immediateFullRefreshResponse(
            for: request,
            token: request.value(forHTTPHeaderField: "x-sidelink-helper-token") ?? "missing"
        )
    }

    func requestCount(path: String) -> Int {
        requestCounts[path, default: 0]
    }

    func setTodayHeadline(_ headline: String) {
        todayHeadline = headline
    }

    func releaseFirstJobsRead() {
        releaseNextJobsRead()
    }

    func releaseNextJobsRead() {
        guard !blockedJobsRequests.isEmpty else { return }
        let blockedJobsRequest = blockedJobsRequests.removeFirst()
        blockedJobsRequest.continuation.resume(
            returning: response(for: blockedJobsRequest.request, json: #"{"ok":true,"data":[]}"#)
        )
    }

    private func response(for request: URLRequest, json: String) -> HTTPOutput {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (Data(json.utf8), response)
    }
}

private actor RefreshCompletionProbe {
    private var completed = false

    func markCompleted() {
        completed = true
    }

    func isCompleted() -> Bool {
        completed
    }
}

@MainActor
final class DailyOperationsAuthorityTests: XCTestCase {
    func testStaleAuthorityKeepsPairedOperationInspectionAvailableButBlocksCommands() {
        let stalePolicy = TodayInteractionPolicy(
            hasPairingCredential: true,
            hasCurrentCommandAuthority: false,
            isLoading: false
        )

        XCTAssertTrue(stalePolicy.canInspectOperation)
        XCTAssertFalse(stalePolicy.canIssueCommand)

        let busyPolicy = TodayInteractionPolicy(
            hasPairingCredential: true,
            hasCurrentCommandAuthority: true,
            isLoading: true
        )

        XCTAssertTrue(busyPolicy.canInspectOperation)
        XCTAssertFalse(busyPolicy.canIssueCommand)

        let unpairedPolicy = TodayInteractionPolicy(
            hasPairingCredential: false,
            hasCurrentCommandAuthority: true,
            isLoading: false
        )

        XCTAssertFalse(unpairedPolicy.canInspectOperation)
        XCTAssertFalse(unpairedPolicy.canIssueCommand)
    }

    func testNewestTodayRequestOwnsSuccessFailureAndCredentialIdentity() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }

        let oldSuccess = Task { await model.refreshDailyOperations() }
        try await waitUntil { await transport.requestCount() == 1 }
        let newSuccess = Task { await model.refreshDailyOperations() }
        try await waitUntil { await transport.requestCount() == 2 }
        let todayIDs = await transport.requestIDs(path: "/api/helper/today")

        await transport.resolve(id: todayIDs[1], json: todayEnvelope(headline: "Newest"))
        _ = await newSuccess.value
        await transport.resolve(id: todayIDs[0], json: todayEnvelope(headline: "Older"))
        _ = await oldSuccess.value

        XCTAssertEqual(model.dailyOperations?.headline, "Newest")
        XCTAssertNil(model.dailyOperationsError)
        XCTAssertTrue(model.hasCurrentDailyOperationsAuthority())

        let oldFailure = Task { await model.refreshDailyOperations() }
        try await waitUntil { await transport.requestCount() == 3 }
        let currentSuccess = Task { await model.refreshDailyOperations() }
        try await waitUntil { await transport.requestCount() == 4 }
        let refreshedIDs = await transport.requestIDs(path: "/api/helper/today")
        await transport.resolve(id: refreshedIDs[3], json: todayEnvelope(headline: "Current"))
        _ = await currentSuccess.value
        await transport.resolve(
            id: refreshedIDs[2],
            status: 400,
            json: #"{"ok":false,"error":"Invalid request"}"#
        )
        _ = await oldFailure.value

        XCTAssertEqual(model.dailyOperations?.headline, "Current")
        XCTAssertNil(model.dailyOperationsError)
        XCTAssertTrue(model.hostReachable)

        let supersededCredential = Task { await model.refreshDailyOperations() }
        try await waitUntil { await transport.requestCount() == 5 }
        let credentialRequestID = await transport.requestIDs(path: "/api/helper/today").last!
        model.replacePairingIdentity(baseURL: model.backendURL, token: "replacement-token")
        await transport.resolve(id: credentialRequestID, json: todayEnvelope(headline: "Wrong credential"))
        _ = await supersededCredential.value

        XCTAssertNil(model.dailyOperations)
        XCTAssertNil(model.dailyOperationsLastSyncedAt)
        XCTAssertTrue(model.dailyOperationsAreStale)
        XCTAssertFalse(model.hostReachable)
    }

    func testSupersededTodayUnauthorizedStillRevokesCurrentPairingIdentity() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }

        let oldRequest = Task { await model.refreshDailyOperations() }
        try await waitUntil { await transport.requestCount() == 1 }
        let newRequest = Task { await model.refreshDailyOperations() }
        try await waitUntil { await transport.requestCount() == 2 }
        let todayIDs = await transport.requestIDs(path: "/api/helper/today")

        await transport.resolve(id: todayIDs[1], json: todayEnvelope(headline: "Current"))
        _ = await newRequest.value
        await transport.resolve(
            id: todayIDs[0],
            status: 401,
            json: #"{"ok":false,"error":"Unauthorized"}"#
        )
        _ = await oldRequest.value

        XCTAssertNil(model.currentPairingIdentity())
        XCTAssertEqual(model.dailyOperations?.headline, "Current")
        XCTAssertTrue(model.dailyOperationsAreStale)
        XCTAssertFalse(model.hostReachable)
        XCTAssertTrue(model.dailyOperationsError?.contains("Re-pair") == true)
    }

    func testDelayedOperationCannotStealSelectionOrPublishAfterInstallPreparation() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)

        let openA = Task { await model.openDailyOperation(jobId: "job-a") }
        try await waitUntil { await transport.requestCount() == 2 }
        model.activeJobPollingJobId = "job-a"
        model.activeJobPollingGeneration = UUID()
        model.activeJobPollingTask = Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
        let openB = Task { await model.openDailyOperation(jobId: "job-b") }
        try await waitUntil { await transport.requestCount() == 4 }
        XCTAssertNil(model.activeJobPollingJobId)
        XCTAssertNil(model.activeJobPollingGeneration)
        XCTAssertNil(model.activeJobPollingTask)

        await resolveOperation(transport, jobId: "job-b", title: "Operation B", status: 200)
        _ = await openB.value
        XCTAssertEqual(model.presentedInstallJob?.id, "job-b")
        XCTAssertEqual(model.installConsoleResolvedTitle, "Operation B")

        await resolveOperation(transport, jobId: "job-a", title: "Operation A", status: 200)
        _ = await openA.value
        XCTAssertEqual(model.presentedInstallJob?.id, "job-b")
        XCTAssertEqual(model.installConsoleResolvedTitle, "Operation B")
        XCTAssertNil(model.errorMessage)

        let openC = Task { await model.openDailyOperation(jobId: "job-c") }
        try await waitUntil { await transport.requestCount() == 6 }
        model.prepareInstallConsole(title: "New install", subtitle: "Preparing")
        await resolveOperation(transport, jobId: "job-c", title: "Operation C", status: 404)
        _ = await openC.value

        XCTAssertEqual(model.installConsoleResolvedTitle, "New install")
        XCTAssertNil(model.selectedOperationJobId)
        XCTAssertNil(model.errorMessage)
    }

    func testCachedActivityReceiptOpensBeforeTheHostRefreshCompletes() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        let cached = installJob(id: "cached-job", title: "Cached receipt", status: "completed")
        model.operationJobsById = [cached.id: cached]

        let open = Task { await model.openDailyOperation(jobId: cached.id) }
        try await waitUntil { await transport.requestCount() == 2 }

        XCTAssertTrue(model.installConsolePresented)
        XCTAssertEqual(model.presentedInstallJob?.id, cached.id)
        XCTAssertEqual(model.installConsoleResolvedTitle, "Cached receipt")

        await resolveOperation(
            transport,
            jobId: cached.id,
            title: "Current receipt",
            status: 200
        )
        _ = await open.value

        XCTAssertEqual(model.presentedInstallJob?.id, cached.id)
        XCTAssertEqual(model.installConsoleResolvedTitle, "Current receipt")
    }

    func testActivityForegroundDeadlinePreservesCachedReceiptsAndClearsLoading() async throws {
        let api = APIClient(
            transport: { _ in
                try await Task.sleep(nanoseconds: .max)
                throw URLError(.unknown)
            },
            foregroundDeadline: 0.05
        )
        let model = makeModel(api: api)
        defer { model.clearPairing() }
        let cached = installJob(id: "cached-deadline", title: "Cached receipt", status: "completed")
        model.operationJobsById = [cached.id: cached]
        model.activityLastSyncedAt = Date(timeIntervalSince1970: 1_750_000_000)
        model.activityHostReachable = true

        let startedAt = Date()
        let refresh = Task { await model.refreshOperationActivity() }
        try await waitUntil { model.isLoadingOp("activity") }
        _ = await refresh.value

        XCTAssertLessThan(Date().timeIntervalSince(startedAt), 0.5)
        XCTAssertEqual(model.operationActivity.recent.map(\.id), [cached.id])
        XCTAssertFalse(model.activityHostReachable)
        XCTAssertFalse(model.hasCurrentActivitySnapshot)
        XCTAssertNotNil(model.activityError)
        XCTAssertFalse(model.isLoadingOp("activity"))
    }

    func testCachedInFlightReceiptAppliesCurrentDetailAndStartsPollingBeforeOptionalLogsResolve() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        let jobId = "cached-running"
        let detailPath = "/api/helper/jobs/\(jobId)"
        let logPath = "\(detailPath)/logs"
        let cached = installJob(id: jobId, title: "Cached running receipt", status: "running")
        model.operationJobsById = [cached.id: cached]

        let open = Task { await model.openDailyOperation(jobId: jobId) }
        try await waitUntil { await transport.requestCount() == 2 }
        let detailIDs = await transport.requestIDs(path: detailPath)
        let logIDs = await transport.requestIDs(path: logPath)
        let detailID = try XCTUnwrap(detailIDs.first)
        let logID = try XCTUnwrap(logIDs.first)

        await transport.resolve(
            id: detailID,
            json: #"{"ok":true,"data":"#
                + installJobJSON(id: jobId, title: "Current running receipt", status: "running")
                + #"}"#
        )

        try await waitUntil {
            model.presentedInstallJob?.title == "Current running receipt"
                && model.activeJobPollingJobId == jobId
                && model.activeJobPollingTask != nil
        }
        let initialLogsArePending = await transport.hasPendingRequest(id: logID)
        XCTAssertTrue(initialLogsArePending)
        XCTAssertEqual(model.presentedInstallJob?.status, "running")
        XCTAssertEqual(model.installConsoleResolvedTitle, "Current running receipt")

        try await waitUntil { await transport.requestIDs(path: detailPath).count == 2 }
        let pollingDetailIDs = await transport.requestIDs(path: detailPath)
        let pollingDetailID = try XCTUnwrap(pollingDetailIDs.last)
        await transport.resolve(
            id: pollingDetailID,
            json: installJobEnvelope(id: jobId, title: "Completed receipt")
        )
        try await waitUntil { await transport.requestIDs(path: logPath).count == 2 }
        let pollingLogIDs = await transport.requestIDs(path: logPath)
        let pollingLogID = try XCTUnwrap(pollingLogIDs.last)
        await transport.resolve(id: pollingLogID, json: #"{"ok":true,"data":[]}"#)
        try await waitUntil {
            model.activeJobPollingJobId == nil && model.activeJobPollingTask == nil
        }

        let initialLogsRemainPending = await transport.hasPendingRequest(id: logID)
        XCTAssertTrue(initialLogsRemainPending)
        await transport.resolve(id: logID, json: #"{"ok":true,"data":[]}"#)
        _ = await open.value
    }

    func testNewestActivityRefreshOwnsReceiptsAndErrorState() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }

        let oldRefresh = Task { await model.refreshOperationActivity() }
        try await waitUntil { await transport.requestCount() == 1 }
        let newRefresh = Task { await model.refreshOperationActivity() }
        try await waitUntil { await transport.requestCount() == 2 }
        let requestIDs = await transport.requestIDs(path: "/api/helper/jobs")

        await transport.resolve(
            id: requestIDs[1],
            json: #"{"ok":true,"data":["#
                + installJobJSON(id: "newest", title: "Newest receipt", status: "running")
                + #"]}"#
        )
        _ = await newRefresh.value
        await transport.resolve(
            id: requestIDs[0],
            status: 400,
            json: #"{"ok":false,"error":"Invalid request"}"#
        )
        _ = await oldRefresh.value

        XCTAssertEqual(model.operationActivity.active.map(\.id), ["newest"])
        XCTAssertNil(model.activityError)
        XCTAssertNotNil(model.activityLastSyncedAt)
        XCTAssertFalse(model.isLoadingOp("activity"))
    }

    func testFailedActivityRefreshCannotBecomeCurrentWhenAnotherSurfaceRestoresSharedReachability() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        let cached = installJob(id: "cached", title: "Cached receipt", status: "completed")
        model.mergeOperationJobs([cached])
        model.publishActivityListAuthority(
            [cached],
            readGeneration: model.beginActivityListAuthorityRead()
        )
        model.activityLastSyncedAt = Date(timeIntervalSince1970: 1_750_000_000)
        model.activityHostReachable = true
        model.hostReachable = true
        XCTAssertEqual(model.activityAuthorityState(for: cached), .current)

        let refresh = Task { await model.refreshOperationActivity() }
        try await waitUntil { await transport.requestCount() == 1 }
        let requestIDs = await transport.requestIDs(path: "/api/helper/jobs")
        let requestID = try XCTUnwrap(requestIDs.first)
        await transport.resolve(
            id: requestID,
            status: 400,
            json: #"{"ok":false,"error":"Host unavailable"}"#
        )
        _ = await refresh.value

        XCTAssertFalse(model.activityHostReachable)
        XCTAssertFalse(model.hasCurrentActivitySnapshot)
        XCTAssertFalse(model.hostReachable)
        XCTAssertNotNil(model.activityError)
        XCTAssertEqual(model.activityAuthorityState(for: cached), .lastKnown)
        XCTAssertTrue(model.activityAuthoritativeVersions.isEmpty)

        model.hostReachable = true

        XCTAssertTrue(model.hostReachable)
        XCTAssertFalse(model.activityHostReachable)
        XCTAssertFalse(model.hasCurrentActivitySnapshot)
    }

    func testActivityListAuthorizesOnlyListedExactVersionsAndMarksOmissionsLastKnown() {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let listed = installJob(
            id: "listed",
            title: "Listed",
            status: "running",
            revision: 2,
            updatedAt: "2026-07-20T12:02:00.000Z"
        )
        let omitted = installJob(
            id: "omitted",
            title: "Omitted",
            status: "completed",
            revision: 1,
            updatedAt: "2026-07-20T12:01:00.000Z"
        )
        model.mergeOperationJobs([listed, omitted])
        model.publishActivityListAuthority(
            [listed, omitted],
            readGeneration: model.beginActivityListAuthorityRead()
        )
        XCTAssertEqual(model.activityAuthorityState(for: listed), .current)
        XCTAssertEqual(model.activityAuthorityState(for: omitted), .current)

        let newerRendered = installJob(
            id: listed.id,
            title: "Newer rendered",
            status: "running",
            revision: 3,
            updatedAt: "2026-07-20T12:03:00.000Z"
        )
        model.mergeOperationJobs([newerRendered])
        model.publishActivityListAuthority(
            [listed],
            readGeneration: model.beginActivityListAuthorityRead()
        )

        XCTAssertEqual(model.operationJobsById[listed.id]?.revision, 3)
        XCTAssertEqual(model.activityAuthorityState(for: newerRendered), .lastKnown)
        XCTAssertEqual(model.activityAuthorityState(for: omitted), .lastKnown)
    }

    func testCachedActivityCommandsStayDisabledWhileDetailIsPendingAndAfterFailure() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        let cached = installJob(id: "cached-waiting", title: "Cached waiting", status: "waiting_2fa")
        model.mergeOperationJobs([cached])
        model.publishActivityListAuthority(
            [cached],
            readGeneration: model.beginActivityListAuthorityRead()
        )

        let open = Task { await model.openDailyOperation(jobId: cached.id) }
        try await waitUntil { await transport.requestCount() == 2 }

        XCTAssertEqual(model.activityAuthorityState(for: cached), .checking)
        XCTAssertNotNil(model.presentedActivityCommandDisabledReason)
        model.activeInstall2FACode = "123456"
        await model.submitActiveInstall2FA(renderedJob: cached)
        await model.cancelPresentedInstallJob(renderedJob: cached)
        let pendingRequestCount = await transport.requestCount()
        XCTAssertEqual(pendingRequestCount, 2)

        await resolveOperation(
            transport,
            jobId: cached.id,
            title: cached.title,
            status: 404
        )
        _ = await open.value

        XCTAssertEqual(model.activityAuthorityState(for: cached), .lastKnown)
        XCTAssertNotNil(model.presentedActivityCommandDisabledReason)
        model.activeInstall2FACode = "123456"
        await model.submitActiveInstall2FA(renderedJob: cached)
        await model.cancelPresentedInstallJob(renderedJob: cached)
        let failedRequestCount = await transport.requestCount()
        XCTAssertEqual(failedRequestCount, 2)
    }

    func testStaleDetailCannotAuthorizeNewerRenderedActivityReceipt() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        let cached = installJob(
            id: "stale-detail",
            title: "Cached",
            status: "completed",
            revision: 1,
            updatedAt: "2026-07-20T12:01:00.000Z"
        )
        model.mergeOperationJobs([cached])
        model.publishActivityListAuthority(
            [cached],
            readGeneration: model.beginActivityListAuthorityRead()
        )

        let open = Task { await model.openDailyOperation(jobId: cached.id) }
        try await waitUntil { await transport.requestCount() == 2 }
        let newerRendered = installJob(
            id: cached.id,
            title: "Newer rendered",
            status: "completed",
            revision: 3,
            updatedAt: "2026-07-20T12:03:00.000Z"
        )
        model.mergeOperationJobs([newerRendered])

        let detailPath = "/api/helper/jobs/\(cached.id)"
        let logPath = "\(detailPath)/logs"
        let detailIDs = await transport.requestIDs(path: detailPath)
        let logIDs = await transport.requestIDs(path: logPath)
        let detailID = try XCTUnwrap(detailIDs.first)
        let logID = try XCTUnwrap(logIDs.first)
        await transport.resolve(
            id: detailID,
            json: #"{"ok":true,"data":"#
                + installJobJSON(
                    id: cached.id,
                    title: "Stale response",
                    status: "completed",
                    revision: 2,
                    updatedAt: "2026-07-20T12:02:00.000Z"
                )
                + #"}"#
        )
        await transport.resolve(id: logID, json: #"{"ok":true,"data":[]}"#)
        _ = await open.value

        let rendered = try XCTUnwrap(model.operationJobsById[cached.id])
        XCTAssertEqual(rendered.revision, 3)
        XCTAssertEqual(model.presentedInstallJob?.revision, 3)
        XCTAssertEqual(model.activityAuthorityState(for: rendered), .lastKnown)
        XCTAssertNotNil(model.presentedActivityCommandDisabledReason)
    }

    func testAcceptedActivityMutationStaysSuspendedUntilDifferentExactReceiptArrives() {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let current = installJob(
            id: "mutation",
            title: "Current",
            status: "running",
            revision: 4,
            updatedAt: "2026-07-20T12:04:00.000Z"
        )
        model.mergeOperationJobs([current])
        let selectionRead = model.beginActivityReceiptSelection(jobId: current.id)
        model.publishActivityDetailAuthority(current, readToken: selectionRead)
        XCTAssertEqual(model.activityAuthorityState(for: current), .current)

        let suspendedFingerprint = model.suspendActivityMutationIfNeeded(for: current)
        XCTAssertEqual(model.activityAuthorityState(for: current), .commandSubmitting)
        model.markActivityMutationAccepted(jobId: current.id, fingerprint: suspendedFingerprint)
        XCTAssertEqual(model.activityAuthorityState(for: current), .commandAccepted)
        let unchangedRead = model.beginActivityDetailAuthorityRead(jobId: current.id)
        model.publishActivityDetailAuthority(current, readToken: unchangedRead)
        XCTAssertEqual(model.activityAuthorityState(for: current), .commandAccepted)

        let advanced = installJob(
            id: current.id,
            title: "Advanced",
            status: "completed",
            revision: 5,
            updatedAt: "2026-07-20T12:05:00.000Z"
        )
        let advancedRead = model.beginActivityDetailAuthorityRead(jobId: advanced.id)
        model.publishActivityDetailAuthority(advanced, readToken: advancedRead)
        XCTAssertEqual(model.activityAuthorityState(for: advanced), .current)
        XCTAssertNil(model.activityMutationSuspensions[current.id])

        let secondFingerprint = model.suspendActivityMutationIfNeeded(for: advanced)
        XCTAssertNotNil(secondFingerprint)
        model.restoreActivityMutationAfterRequestFailure(
            jobId: advanced.id,
            fingerprint: secondFingerprint
        )
        XCTAssertEqual(model.activityAuthorityState(for: advanced), .current)
        XCTAssertNotNil(suspendedFingerprint)
    }

    func testLostVerificationResponseKeepsSameReceiptSuspended() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        let receipt = installJob(id: "ambiguous-2fa", title: "Ambiguous 2FA", status: "waiting_2fa")
        model.mergeOperationJobs([receipt])
        let selectionRead = model.beginActivityReceiptSelection(jobId: receipt.id)
        model.publishActivityDetailAuthority(receipt, readToken: selectionRead)
        model.selectedOperationJobId = receipt.id
        model.installConsolePresentationJobId = receipt.id
        model.activeInstallJob = receipt
        model.activeInstall2FACode = "123456"

        let submission = Task { await model.submitActiveInstall2FA(renderedJob: receipt) }
        try await waitUntil {
            await transport.requestIDs(path: "/api/helper/jobs/ambiguous-2fa/commands/2fa").count == 1
        }
        let requestIDs = await transport.requestIDs(path: "/api/helper/jobs/ambiguous-2fa/commands/2fa")
        let requestID = try XCTUnwrap(requestIDs.first)
        await transport.reject(id: requestID, error: URLError(.networkConnectionLost))
        _ = await submission.value

        XCTAssertEqual(model.activityAuthorityState(for: receipt), .commandOutcomeUnknown)
        XCTAssertTrue(model.errorMessage?.contains("could not be confirmed") == true)

        model.activeInstall2FACode = "123456"
        await model.submitActiveInstall2FA(renderedJob: receipt)
        let requestCount = await transport.requestIDs(path: "/api/helper/jobs/ambiguous-2fa/commands/2fa").count
        XCTAssertEqual(requestCount, 1)
    }

    func testTimedOutVerificationResponseKeepsSameReceiptSuspended() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        let receipt = installJob(id: "timed-out-2fa", title: "Timed out 2FA", status: "waiting_2fa")
        model.mergeOperationJobs([receipt])
        let selectionRead = model.beginActivityReceiptSelection(jobId: receipt.id)
        model.publishActivityDetailAuthority(receipt, readToken: selectionRead)
        model.selectedOperationJobId = receipt.id
        model.installConsolePresentationJobId = receipt.id
        model.activeInstallJob = receipt
        model.activeInstall2FACode = "123456"

        let submission = Task { await model.submitActiveInstall2FA(renderedJob: receipt) }
        let path = "/api/helper/jobs/timed-out-2fa/commands/2fa"
        try await waitUntil { await transport.requestIDs(path: path).count == 1 }
        let requestIDs = await transport.requestIDs(path: path)
        let requestID = try XCTUnwrap(requestIDs.first)
        await transport.resolve(
            id: requestID,
            status: 408,
            json: #"{"ok":false,"error":"Request timed out"}"#
        )
        _ = await submission.value

        XCTAssertEqual(model.activityAuthorityState(for: receipt), .commandOutcomeUnknown)
        XCTAssertTrue(model.errorMessage?.contains("could not be confirmed") == true)

        model.activeInstall2FACode = "123456"
        await model.submitActiveInstall2FA(renderedJob: receipt)
        let requestCount = await transport.requestIDs(path: path).count
        XCTAssertEqual(requestCount, 1)
    }

    func testMalformedVerificationAcknowledgementDoesNotClaimAcceptance() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        let receipt = installJob(id: "malformed-2fa", title: "Malformed 2FA", status: "waiting_2fa")
        model.mergeOperationJobs([receipt])
        let selectionRead = model.beginActivityReceiptSelection(jobId: receipt.id)
        model.publishActivityDetailAuthority(receipt, readToken: selectionRead)
        model.selectedOperationJobId = receipt.id
        model.installConsolePresentationJobId = receipt.id
        model.activeInstallJob = receipt
        model.activeInstall2FACode = "123456"

        let submission = Task { await model.submitActiveInstall2FA(renderedJob: receipt) }
        let path = "/api/helper/jobs/malformed-2fa/commands/2fa"
        try await waitUntil { await transport.requestIDs(path: path).count == 1 }
        let requestIDs = await transport.requestIDs(path: path)
        let requestID = try XCTUnwrap(requestIDs.first)
        await transport.resolve(id: requestID, json: #"{}"#)
        _ = await submission.value

        XCTAssertEqual(model.activityAuthorityState(for: receipt), .commandOutcomeUnknown)
        XCTAssertTrue(model.errorMessage?.contains("could not be confirmed") == true)
    }

    func testLegacyHostCapabilityKeepsReceiptCommandsFailClosed() async {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        model.dailyOperations = decodeTodaySnapshot(headline: "Legacy host", exactJobCommands: false)

        let receipt = installJob(id: "legacy-host", title: "Legacy host", status: "waiting_2fa")
        model.mergeOperationJobs([receipt])
        let selectionRead = model.beginActivityReceiptSelection(jobId: receipt.id)
        model.publishActivityDetailAuthority(receipt, readToken: selectionRead)
        model.selectedOperationJobId = receipt.id
        model.installConsolePresentationJobId = receipt.id
        model.activeInstallJob = receipt
        model.activeInstall2FACode = "123456"

        await model.submitActiveInstall2FA(renderedJob: receipt)

        let requestCount = await transport.requestCount()
        XCTAssertEqual(requestCount, 0)
        XCTAssertTrue(model.errorMessage?.contains("Update SideLink on the paired Mac") == true)
    }

    func testCancelRefusesAReceiptThatAdvancedAfterRendering() async {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        let rendered = installJob(
            id: "rendered-cancel",
            title: "Rendered",
            status: "running",
            revision: 1,
            updatedAt: "2026-07-20T12:01:00.000Z"
        )
        let advanced = installJob(
            id: rendered.id,
            title: "Advanced",
            status: "running",
            revision: 2,
            updatedAt: "2026-07-20T12:02:00.000Z"
        )
        model.activeInstallJob = advanced
        model.installConsolePresentationJobId = rendered.id
        model.mergeOperationJobs([advanced])

        await model.cancelPresentedInstallJob(renderedJob: rendered)

        let requestCount = await transport.requestCount()
        XCTAssertEqual(requestCount, 0)
        XCTAssertTrue(model.errorMessage?.contains("changed after it was rendered") == true)
    }

    func testVerificationRefusesAReceiptThatAdvancedAfterRendering() async {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        let rendered = installJob(
            id: "rendered-2fa",
            title: "Rendered",
            status: "waiting_2fa",
            revision: 1,
            updatedAt: "2026-07-20T12:01:00.000Z"
        )
        let advanced = installJob(
            id: rendered.id,
            title: "Advanced",
            status: "waiting_2fa",
            revision: 2,
            updatedAt: "2026-07-20T12:02:00.000Z"
        )
        model.activeInstallJob = advanced
        model.installConsolePresentationJobId = rendered.id
        model.mergeOperationJobs([advanced])
        model.activeInstall2FACode = "123456"

        await model.submitActiveInstall2FA(renderedJob: rendered)

        let requestCount = await transport.requestCount()
        XCTAssertEqual(requestCount, 0)
        XCTAssertTrue(model.errorMessage?.contains("changed after it was rendered") == true)
    }

    func testUnrelatedConsoleSelectionDoesNotSuppressTodayCancellation() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        let receipt = installJob(id: "today-cancel", title: "Today cancel", status: "running")
        model.mergeOperationJobs([receipt])
        model.selectedOperationJobId = "unrelated-console-job"

        let cancellation = Task {
            await model.cancelDailyOperation(
                jobId: receipt.id,
                expectedRevision: receipt.revision!,
                expectedUpdatedAt: receipt.updatedAt
            )
        }
        let path = "/api/helper/jobs/today-cancel/commands/cancel"
        try await waitUntil { await transport.requestIDs(path: path).count == 1 }
        let requestIDs = await transport.requestIDs(path: path)
        let requestID = try XCTUnwrap(requestIDs.first)
        await transport.resolve(
            id: requestID,
            status: 409,
            json: #"{"ok":false,"code":"JOB_NOT_COMMANDABLE","error":"Cannot cancel"}"#
        )
        _ = await cancellation.value

        let requestCount = await transport.requestIDs(path: path).count
        XCTAssertEqual(requestCount, 1)
    }

    func testCancelCoordinatorSendsTheInitiatingRenderedVersion() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        let rendered = installJob(
            id: "bound-cancel",
            title: "Bound",
            status: "running",
            revision: 7,
            updatedAt: "2026-07-20T12:07:00.000Z"
        )
        model.activeInstallJob = rendered
        model.installConsolePresentationJobId = rendered.id

        let cancellation = Task { await model.cancelPresentedInstallJob(renderedJob: rendered) }
        let path = "/api/helper/jobs/bound-cancel/commands/cancel"
        try await waitUntil { await transport.requestIDs(path: path).count == 1 }
        let requestIDs = await transport.requestIDs(path: path)
        let requestID = try XCTUnwrap(requestIDs.first)
        let recordedRequest = await transport.request(id: requestID)
        let request = try XCTUnwrap(recordedRequest)
        let body = try XCTUnwrap(request.body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["expectedRevision"] as? Int, 7)
        XCTAssertEqual(json["expectedUpdatedAt"] as? String, "2026-07-20T12:07:00.000Z")
        await transport.resolve(
            id: requestID,
            status: 409,
            json: #"{"ok":false,"code":"JOB_NOT_COMMANDABLE","error":"Cannot cancel"}"#
        )
        _ = await cancellation.value
    }

    func testVersionMismatchMakesRenderedReceiptLastKnown() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        let receipt = installJob(id: "stale-2fa", title: "Stale 2FA", status: "waiting_2fa")
        model.mergeOperationJobs([receipt])
        let selectionRead = model.beginActivityReceiptSelection(jobId: receipt.id)
        model.publishActivityDetailAuthority(receipt, readToken: selectionRead)
        model.selectedOperationJobId = receipt.id
        model.installConsolePresentationJobId = receipt.id
        model.activeInstallJob = receipt
        model.activeInstall2FACode = "123456"

        let submission = Task { await model.submitActiveInstall2FA(renderedJob: receipt) }
        try await waitUntil {
            await transport.requestIDs(path: "/api/helper/jobs/stale-2fa/commands/2fa").count == 1
        }
        let requestIDs = await transport.requestIDs(path: "/api/helper/jobs/stale-2fa/commands/2fa")
        let requestID = try XCTUnwrap(requestIDs.first)
        await transport.resolve(
            id: requestID,
            status: 409,
            json: #"{"ok":false,"code":"JOB_VERSION_MISMATCH","error":"Receipt changed"}"#
        )
        _ = await submission.value

        XCTAssertEqual(model.activityAuthorityState(for: receipt), .lastKnown)
        XCTAssertNil(model.activityMutationSuspensions[receipt.id])
        XCTAssertEqual(model.errorMessage, "Receipt changed")
    }

    func testCodeLessNotFoundCommandInvalidatesRenderedAuthority() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        let receipt = installJob(id: "missing-2fa", title: "Missing 2FA", status: "waiting_2fa")
        model.mergeOperationJobs([receipt])
        let selectionRead = model.beginActivityReceiptSelection(jobId: receipt.id)
        model.publishActivityDetailAuthority(receipt, readToken: selectionRead)
        model.selectedOperationJobId = receipt.id
        model.installConsolePresentationJobId = receipt.id
        model.activeInstallJob = receipt
        model.activeInstall2FACode = "123456"

        let submission = Task { await model.submitActiveInstall2FA(renderedJob: receipt) }
        let path = "/api/helper/jobs/missing-2fa/commands/2fa"
        try await waitUntil { await transport.requestIDs(path: path).count == 1 }
        let requestIDs = await transport.requestIDs(path: path)
        let requestID = try XCTUnwrap(requestIDs.first)
        await transport.resolve(
            id: requestID,
            status: 404,
            json: #"{"ok":false,"error":"Missing"}"#
        )
        _ = await submission.value

        XCTAssertEqual(model.activityAuthorityState(for: receipt), .lastKnown)
        XCTAssertNil(model.activityMutationSuspensions[receipt.id])
    }

    func testOlderDetailCannotCompleteNewerReceiptSelectionValidation() {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let receipt = installJob(id: "read-race", title: "Read race", status: "waiting_2fa")
        model.mergeOperationJobs([receipt])

        let olderBackgroundRead = model.beginActivityDetailAuthorityRead(jobId: receipt.id)
        let selectionRead = model.beginActivityReceiptSelection(jobId: receipt.id)

        XCTAssertNil(model.publishActivityDetailAuthority(receipt, readToken: olderBackgroundRead))
        XCTAssertEqual(model.activityAuthorityState(for: receipt), .checking)

        XCTAssertNotNil(model.publishActivityDetailAuthority(receipt, readToken: selectionRead))
        XCTAssertEqual(model.activityAuthorityState(for: receipt), .current)
    }

    func testNewerInvalidationReadSupersedesOlderReceiptSelection() {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let older = installJob(
            id: "reverse-read-race",
            title: "Older",
            status: "running",
            revision: 1,
            updatedAt: "2026-07-20T12:01:00.000Z"
        )
        let newer = installJob(
            id: older.id,
            title: "Newer",
            status: "completed",
            revision: 2,
            updatedAt: "2026-07-20T12:02:00.000Z"
        )
        model.mergeOperationJobs([older])

        let selectionRead = model.beginActivityReceiptSelection(jobId: older.id)
        let invalidationRead = model.beginActivityDetailAuthorityRead(
            jobId: older.id,
            purpose: .invalidation
        )

        XCTAssertNotNil(model.publishActivityDetailAuthority(newer, readToken: invalidationRead))
        XCTAssertNil(model.publishActivityDetailAuthority(older, readToken: selectionRead))
        XCTAssertEqual(model.operationJobsById[older.id]?.revision, 2)
        XCTAssertEqual(model.activityAuthorityState(for: newer), .current)
        XCTAssertNil(model.activityReceiptValidationJobId)
    }

    func testNewerListSupersedesOlderReceiptSelection() {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let older = installJob(
            id: "reverse-list-race",
            title: "Older",
            status: "running",
            revision: 1,
            updatedAt: "2026-07-20T12:01:00.000Z"
        )
        let newer = installJob(
            id: older.id,
            title: "Newer",
            status: "completed",
            revision: 2,
            updatedAt: "2026-07-20T12:02:00.000Z"
        )
        model.mergeOperationJobs([older])

        let selectionRead = model.beginActivityReceiptSelection(jobId: older.id)
        let listRead = model.beginActivityListAuthorityRead()
        model.mergeOperationJobs([newer])
        model.publishActivityListAuthority([newer], readGeneration: listRead)

        XCTAssertNil(model.publishActivityDetailAuthority(older, readToken: selectionRead))
        XCTAssertEqual(model.operationJobsById[older.id]?.revision, 2)
        XCTAssertEqual(model.activityAuthorityState(for: newer), .current)
        XCTAssertNil(model.activityReceiptValidationJobId)
    }

    func testFailedInvalidationLeavesReceiptLastKnown() {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let receipt = installJob(id: "failed-invalidation", title: "Invalidated", status: "running")
        model.mergeOperationJobs([receipt])
        let initialRead = model.beginActivityDetailAuthorityRead(jobId: receipt.id)
        model.publishActivityDetailAuthority(receipt, readToken: initialRead)
        XCTAssertEqual(model.activityAuthorityState(for: receipt), .current)

        let invalidationRead = model.beginActivityDetailAuthorityRead(
            jobId: receipt.id,
            purpose: .invalidation
        )
        XCTAssertEqual(model.activityAuthorityState(for: receipt), .lastKnown)
        model.finishActivityDetailAuthorityReadFailure(
            jobId: receipt.id,
            readToken: invalidationRead
        )

        XCTAssertEqual(model.activityAuthorityState(for: receipt), .lastKnown)
    }

    func testListStartedBeforeFailedSelectionCannotReauthorizeReceipt() {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let receipt = installJob(id: "list-race", title: "List race", status: "running")
        model.mergeOperationJobs([receipt])
        let olderListRead = model.beginActivityListAuthorityRead()
        let selectionRead = model.beginActivityReceiptSelection(jobId: receipt.id)

        model.finishActivityReceiptValidationFailure(
            jobId: receipt.id,
            readToken: selectionRead
        )
        model.publishActivityListAuthority([receipt], readGeneration: olderListRead)

        XCTAssertEqual(model.activityAuthorityState(for: receipt), .lastKnown)
    }

    func testAcceptedMutationSuspensionSurvivesReceiptCacheEvictionAndReentry() {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let receipt = installJob(
            id: "evicted-command",
            title: "Evicted command",
            status: "completed",
            revision: 4,
            updatedAt: "2026-07-19T12:00:00.000Z"
        )
        model.mergeOperationJobs([receipt])
        let selectionRead = model.beginActivityReceiptSelection(jobId: receipt.id)
        model.publishActivityDetailAuthority(receipt, readToken: selectionRead)
        let fingerprint = model.suspendActivityMutationIfNeeded(for: receipt)
        model.markActivityMutationAccepted(jobId: receipt.id, fingerprint: fingerprint)
        model.clearActivityReceiptSelection()

        let newerHistory = (0 ..< 205).map { index in
            installJob(
                id: "eviction-history-\(index)",
                title: "History \(index)",
                status: "completed",
                revision: index + 5,
                updatedAt: "2026-07-20T12:\(String(format: "%03d", index)):00.000Z"
            )
        }
        model.mergeOperationJobs(newerHistory)

        XCTAssertNil(model.operationJobsById[receipt.id])
        XCTAssertNotNil(model.activityMutationSuspensions[receipt.id])

        let reentryRead = model.beginActivityDetailAuthorityRead(jobId: receipt.id)
        model.publishActivityDetailAuthority(receipt, readToken: reentryRead)

        XCTAssertEqual(model.activityAuthorityState(for: receipt), .commandAccepted)
    }

    func testDefinitiveMissingDetailInvalidatesExactAuthority() {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let receipt = installJob(id: "missing-detail", title: "Missing", status: "running")
        model.mergeOperationJobs([receipt])
        let firstRead = model.beginActivityDetailAuthorityRead(jobId: receipt.id)
        model.publishActivityDetailAuthority(receipt, readToken: firstRead)
        XCTAssertEqual(model.activityAuthorityState(for: receipt), .current)

        let missingRead = model.beginActivityDetailAuthorityRead(jobId: receipt.id)
        XCTAssertTrue(model.invalidateActivityDetailAuthority(
            jobId: receipt.id,
            readToken: missingRead
        ))

        XCTAssertEqual(model.activityAuthorityState(for: receipt), .lastKnown)
    }

    func testDismissingActivityConsoleReleasesReceiptSelection() throws {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let receipt = installJob(id: "dismissed-receipt", title: "Dismissed", status: "completed")
        model.mergeOperationJobs([receipt])
        _ = model.beginActivityReceiptSelection(jobId: receipt.id)
        model.selectedOperationJobId = receipt.id
        model.installConsolePresentationJobId = receipt.id
        model.activeInstallJob = receipt
        model.installConsolePresented = true

        model.dismissInstallConsole()

        XCTAssertNil(model.selectedActivityReceiptJobId)
        XCTAssertNil(model.selectedOperationJobId)
        XCTAssertNil(model.activityReceiptValidationJobId)
        let releasedSelection = model.captureDailyOperationSelection()
        let identity = try XCTUnwrap(model.currentPairingIdentity())
        XCTAssertTrue(model.selectionStillOwnsFollowUp(
            releasedSelection,
            operationJobId: "another-job",
            pairingIdentity: identity
        ))
    }

    func testPairingReplacementClearsExactActivityAuthority() {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let current = installJob(id: "pairing-reset", title: "Current", status: "completed")
        model.mergeOperationJobs([current])
        let selectionRead = model.beginActivityReceiptSelection(jobId: current.id)
        model.publishActivityDetailAuthority(current, readToken: selectionRead)
        XCTAssertEqual(model.activityAuthorityState(for: current), .current)

        XCTAssertTrue(model.replacePairingIdentity(baseURL: model.backendURL, token: "replacement-token"))

        XCTAssertTrue(model.operationJobsById.isEmpty)
        XCTAssertTrue(model.activityAuthoritativeVersions.isEmpty)
        XCTAssertTrue(model.activityMutationSuspensions.isEmpty)
        XCTAssertNil(model.activityReceiptValidationJobId)
        XCTAssertNil(model.selectedActivityReceiptJobId)
    }

    func testSelectedActivityReceiptSurvivesBoundedHistoryReconciliation() {
        let model = makeModel(api: APIClient(transport: { _ in throw URLError(.notConnectedToInternet) }))
        defer { model.clearPairing() }
        let selected = installJob(
            id: "selected-old",
            title: "Selected",
            status: "completed",
            revision: 1,
            updatedAt: "2026-07-19T12:00:00.000Z"
        )
        model.mergeOperationJobs([selected])
        _ = model.beginActivityReceiptSelection(jobId: selected.id)
        let newerHistory = (0 ..< 205).map { index in
            installJob(
                id: "history-\(String(format: "%03d", index))",
                title: "History \(index)",
                status: "completed",
                revision: index + 2,
                updatedAt: "2026-07-20T12:\(String(format: "%03d", index)):00.000Z"
            )
        }

        model.mergeOperationJobs(newerHistory)

        XCTAssertNotNil(model.operationJobsById[selected.id])
        XCTAssertLessThanOrEqual(model.operationJobsById.count, HelperViewModel.maxOperationReceipts + 1)
    }

    func testPublishedAuthorityExpiresOnScheduleAndLiveClock() async throws {
        let router = ImmediateHTTPRouter(mode: .todayAuthorized)
        var now = Date()
        let model = makeModel(
            api: APIClient(transport: { await router.handle($0) }),
            authorityNow: { now },
            authorityTTL: 0.05
        )
        defer { model.clearPairing() }

        let refreshed = await model.refreshDailyOperations()
        XCTAssertTrue(refreshed)
        XCTAssertFalse(model.dailyOperationsAuthorityExpired)
        XCTAssertFalse(model.dailyOperationsAreStale)

        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(model.dailyOperationsAuthorityExpired)
        XCTAssertTrue(model.dailyOperationsAreStale)

        now = now.addingTimeInterval(60)
        XCTAssertTrue(model.dailyOperationsAreStale)
    }

    func testGuardChecksLiveClockBeforeTheExpiryTaskCanFire() async throws {
        let router = ImmediateHTTPRouter(mode: .todayAuthorized)
        var now = Date()
        let model = makeModel(
            api: APIClient(transport: { await router.handle($0) }),
            authorityNow: { now },
            authorityTTL: 60 * 60
        )
        defer { model.clearPairing() }

        let refreshed = await model.refreshDailyOperations()
        XCTAssertTrue(refreshed)
        XCTAssertFalse(model.dailyOperationsAuthorityExpired)

        now = now.addingTimeInterval(2 * 60 * 60)
        XCTAssertFalse(model.dailyOperationsAuthorityExpired)
        XCTAssertTrue(model.dailyOperationsAreStale)

        await model.loadAppIds(sync: true)
        let todayCount = await router.count(path: "/api/helper/today")
        let syncCount = await router.count(path: "/api/helper/app-ids", query: "sync=true")
        XCTAssertEqual(todayCount, 2)
        XCTAssertEqual(syncCount, 1)
    }

    func testGuardRevalidatesBeforeSyncAndPlainAppIDReadStaysReadOnly() async throws {
        let router = ImmediateHTTPRouter(mode: .todayUnauthorized)
        let model = makeModel(api: APIClient(transport: { await router.handle($0) }))
        defer { model.clearPairing() }

        await model.loadAppIds(sync: true)
        let rejectedTodayCount = await router.count(path: "/api/helper/today")
        let rejectedSyncCount = await router.count(path: "/api/helper/app-ids", query: "sync=true")
        XCTAssertEqual(rejectedTodayCount, 1)
        XCTAssertEqual(rejectedSyncCount, 0)
        XCTAssertTrue(model.errorMessage?.contains("Re-pair") == true)

        await router.setMode(.todayAuthorized)
        model.backendURL = "http://127.0.0.1:4010"
        XCTAssertTrue(model.replacePairingIdentity(baseURL: model.backendURL, token: "test-token"))
        await model.loadAppIds(sync: true)
        let acceptedTodayCount = await router.count(path: "/api/helper/today")
        let acceptedSyncCount = await router.count(path: "/api/helper/app-ids", query: "sync=true")
        XCTAssertEqual(acceptedTodayCount, 2)
        XCTAssertEqual(acceptedSyncCount, 1)

        let todayCount = await router.count(path: "/api/helper/today")
        await model.loadAppIds()
        let afterReadTodayCount = await router.count(path: "/api/helper/today")
        let appIDReadCount = await router.count(path: "/api/helper/app-ids")
        XCTAssertEqual(afterReadTodayCount, todayCount)
        XCTAssertGreaterThanOrEqual(appIDReadCount, 2)

        await model.deleteAppId("app-id")
        let deleteCount = await router.count(path: "/api/helper/app-ids/app-id", method: "DELETE")
        XCTAssertEqual(deleteCount, 1)
    }

    func testStaleCachedRetryAndInstall2FAMakeNoMutationRequest() async throws {
        let router = ImmediateHTTPRouter(mode: .todayUnauthorized)
        let model = makeModel(api: APIClient(transport: { await router.handle($0) }))
        defer { model.clearPairing() }

        let waitingReceipt = installJob(id: "waiting", title: "Waiting", status: "waiting_2fa")
        model.activeInstallJob = waitingReceipt
        model.activeInstall2FACode = "123456"
        model.lastInstallRequest = .library(
            ipaId: "private-ipa",
            appName: "Private app",
            subtitle: "Retry",
            idempotencyKey: "retry-key"
        )

        await model.submitActiveInstall2FA(renderedJob: waitingReceipt)
        await model.retryLastInstallRequest()

        let twoFACount = await router.count(path: "/api/helper/jobs/waiting/commands/2fa", method: "POST")
        let installCount = await router.count(path: "/api/helper/install", method: "POST")
        let todayCount = await router.count(path: "/api/helper/today")
        XCTAssertEqual(twoFACount, 0)
        XCTAssertEqual(installCount, 0)
        XCTAssertEqual(todayCount, 1)
    }

    func testOuterUnauthorizedRefreshRetainsOnlyTodayUntilExplicitClear() async throws {
        let router = ImmediateHTTPRouter(mode: .allUnauthorized)
        let syncedAt = Date(timeIntervalSince1970: 1_750_000_000)
        let model = makeModel(api: APIClient(transport: { await router.handle($0) }))
        primeAuthority(model, headline: "Retained", syncedAt: syncedAt)
        model.activeInstallJob = installJob(id: "raw-job", title: "Raw", status: "running")
        model.operationJobsById = ["raw-job": model.activeInstallJob!]
        model.helperLogs = [
            HelperLogEntryDTO(
                id: "raw-log",
                level: "info",
                code: "raw",
                message: "raw host detail",
                at: "2026-07-20T12:00:00.000Z"
            )
        ]

        await model.refreshAll()

        XCTAssertEqual(model.dailyOperations?.headline, "Retained")
        XCTAssertEqual(model.dailyOperationsLastSyncedAt, syncedAt)
        XCTAssertTrue(model.dailyOperationsAreStale)
        XCTAssertTrue(model.dailyOperationsError?.contains("Re-pair") == true)
        XCTAssertFalse(model.hasPairingCredential)
        XCTAssertNil(model.activeInstallJob)
        XCTAssertTrue(model.operationJobsById.isEmpty)
        XCTAssertTrue(model.helperLogs.isEmpty)
        XCTAssertNil(model.dailyOperationsAuthorityExpiryTask)

        model.clearPairing()
        XCTAssertNil(model.dailyOperations)
        XCTAssertNil(model.dailyOperationsLastSyncedAt)
        XCTAssertNil(model.dailyOperationsAuthorityExpiryTask)
    }

    func testReplacementPairingSupersedesDelayedFullRefreshSuccess() async throws {
        let transport = PairingAwareHTTPTransport(deferredToken: "token-a")
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        model.backendURL = "https://host-a.test"
        model.replacePairingIdentity(baseURL: model.backendURL, token: "token-a")

        let oldRefresh = Task { await model.refreshAll() }
        try await waitUntil { await transport.requestCount(token: "token-a") == 4 }

        model.backendURL = "https://host-b.test"
        model.replacePairingIdentity(baseURL: model.backendURL, token: "token-b")
        let replacementRefresh = Task { await model.refreshAll() }

        try await waitUntil {
            let statusRequests = await transport.requestIDs(path: "/api/helper/status", token: "token-b")
            let configRequests = await transport.requestIDs(path: "/api/helper/config", token: "token-b")
            let accountRequests = await transport.requestIDs(path: "/api/helper/accounts", token: "token-b")
            let ipaRequests = await transport.requestIDs(path: "/api/helper/ipas", token: "token-b")
            return !statusRequests.isEmpty
                && !configRequests.isEmpty
                && !accountRequests.isEmpty
                && !ipaRequests.isEmpty
        }
        let replacementRequestCountBeforeOldRelease = await transport.requestCount(token: "token-b")
        XCTAssertGreaterThanOrEqual(
            replacementRequestCountBeforeOldRelease,
            4,
            "The replacement identity must start refreshing before the stale identity returns"
        )
        _ = await replacementRefresh.value

        await resolveCoreRefresh(
            transport,
            token: "token-a",
            statusJSON: fullRefreshStatus(mode: "old-host"),
            accountJSON: accountListEnvelope(id: "old-account")
        )
        _ = await oldRefresh.value

        XCTAssertEqual(model.currentPairingIdentity()?.token, "token-b")
        XCTAssertEqual(model.status?.mode, "token-b")
        XCTAssertEqual(model.config?.serverName, "Host token-b")
        XCTAssertEqual(model.dailyOperations?.headline, "Host token-b")
        XCTAssertFalse(model.accounts.contains(where: { $0.id == "old-account" }))
        let replacementRequestCount = await transport.requestCount(token: "token-b")
        XCTAssertGreaterThanOrEqual(replacementRequestCount, 4)
    }

    func testSameIdentityRefreshDuringInFlightCycleRunsTrailingRefreshAndPublishesLatestSnapshot() async throws {
        let transport = TrailingRefreshHTTPTransport()
        let model = makeModel(api: APIClient(transport: { await transport.handle($0) }))
        defer { model.clearPairing() }

        let firstRefresh = Task { await model.refreshAll() }
        try await waitUntil {
            let todayCount = await transport.requestCount(path: "/api/helper/today")
            let jobsCount = await transport.requestCount(path: "/api/helper/jobs")
            return todayCount == 1 && jobsCount == 1
        }
        XCTAssertEqual(model.dailyOperations?.headline, "First snapshot")

        await transport.setTodayHeadline("Trailing snapshot")
        await model.refreshAllSilently()
        await transport.releaseFirstJobsRead()
        _ = await firstRefresh.value

        let todayRequestCount = await transport.requestCount(path: "/api/helper/today")
        XCTAssertEqual(todayRequestCount, 2)
        XCTAssertEqual(model.dailyOperations?.headline, "Trailing snapshot")
        XCTAssertTrue(model.hasCurrentDailyOperationsAuthority())
    }

    func testSSEInvalidationsDuringTrailingRefreshCompleteForegroundAndEventuallyConverge() async throws {
        let transport = TrailingRefreshHTTPTransport(blocksEveryJobsRead: true)
        let model = makeModel(api: APIClient(transport: { await transport.handle($0) }))
        let completion = RefreshCompletionProbe()
        defer { model.clearPairing() }
        let identity = try XCTUnwrap(model.currentPairingIdentity())

        let foregroundRefresh = Task {
            await model.refreshAll()
            await completion.markCompleted()
        }
        try await waitUntil { await transport.requestCount(path: "/api/helper/jobs") == 1 }
        XCTAssertTrue(model.isLoading)

        await transport.setTodayHeadline("Trailing snapshot")
        model.handleSSEEvent(event: "device-update", data: "{}", pairingIdentity: identity)
        await Task.yield()
        await Task.yield()
        await transport.releaseNextJobsRead()

        try await waitUntil { await transport.requestCount(path: "/api/helper/jobs") == 2 }
        XCTAssertFalse(model.isLoading, "The foreground loading state must end with its own refresh pass")

        await transport.setTodayHeadline("Follow-up snapshot")
        model.handleSSEEvent(event: "account-update", data: "{}", pairingIdentity: identity)
        await Task.yield()
        await Task.yield()
        await transport.releaseNextJobsRead()

        try await waitUntil { await transport.requestCount(path: "/api/helper/jobs") == 3 }
        try await waitUntil { await completion.isCompleted() }
        let foregroundCompletedBeforeFollowUpRelease = await completion.isCompleted()
        let jobsRequestCount = await transport.requestCount(path: "/api/helper/jobs")
        XCTAssertTrue(
            foregroundCompletedBeforeFollowUpRelease,
            "The foreground caller must not own an unbounded invalidation drain"
        )
        XCTAssertFalse(model.isLoading)
        XCTAssertEqual(jobsRequestCount, 3, "The trailing invalidation must schedule one coalesced follow-up")

        await transport.releaseNextJobsRead()
        try await waitUntil { await transport.requestCount(path: "/api/helper/app-ids/usage") == 3 }
        _ = await foregroundRefresh.value

        XCTAssertEqual(model.dailyOperations?.headline, "Follow-up snapshot")
        XCTAssertFalse(model.isLoading)
    }

    func testDelayedFullRefreshUnauthorizedCannotClearReplacementPairing() async throws {
        let transport = PairingAwareHTTPTransport(deferredToken: "token-a")
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        model.backendURL = "https://host-a.test"
        model.replacePairingIdentity(baseURL: model.backendURL, token: "token-a")

        let oldRefresh = Task { await model.refreshAll() }
        try await waitUntil { await transport.requestCount(token: "token-a") == 4 }

        model.backendURL = "https://host-b.test"
        model.replacePairingIdentity(baseURL: model.backendURL, token: "token-b")
        primeAuthority(model, headline: "Replacement host")

        await resolveCoreRefresh(
            transport,
            token: "token-a",
            statusJSON: #"{"ok":false,"error":"Unauthorized"}"#,
            statusCode: 401,
            accountJSON: accountListEnvelope(id: "old-account")
        )
        _ = await oldRefresh.value

        XCTAssertEqual(model.currentPairingIdentity()?.baseURL, "https://host-b.test")
        XCTAssertEqual(model.currentPairingIdentity()?.token, "token-b")
        XCTAssertEqual(model.dailyOperations?.headline, "Replacement host")
        XCTAssertTrue(model.hasPairingCredential)
    }

    func testDelayedAppleChallengeCannotCrossPairingIdentity() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)

        let signIn = Task {
            await model.signInAppleAccount(appleId: "person@example.com", password: "secret")
        }
        try await waitUntil { await transport.requestIDs(path: "/api/helper/apple/signin").count == 1 }
        let signInID = await transport.requestIDs(path: "/api/helper/apple/signin").first!

        model.backendURL = "https://host-b.test"
        model.replacePairingIdentity(baseURL: model.backendURL, token: "token-b")
        await transport.resolve(
            id: signInID,
            json: #"{"ok":true,"data":{"requires2FA":true,"authType":"trusted_device","trustedPhoneNumbers":[]}}"#
        )
        _ = await signIn.value

        XCTAssertNil(model.pendingAppleAuth)
        XCTAssertNil(model.pendingAppleAuthIdentity)
        let countBeforeSubmit = await transport.requestCount()
        await model.submitPendingAppleAccount2FA(code: "123456")
        let countAfterSubmit = await transport.requestCount()
        XCTAssertEqual(countAfterSubmit, countBeforeSubmit)
    }

    func testHostSwitchMidImportNeverSubmitsOldArtifactToReplacementHost() async throws {
        let transport = DeferredHTTPTransport()
        let model = makeModel(api: APIClient(transport: { try await transport.handle($0) }))
        defer { model.clearPairing() }
        primeAuthority(model)
        primeInstallReadiness(model)

        let install = Task { await model.installFromSource(sourceApp()) }
        try await waitUntil { await transport.requestIDs(path: "/api/helper/ipas/import-url").count == 1 }
        let importID = await transport.requestIDs(path: "/api/helper/ipas/import-url").first!

        model.backendURL = "https://host-b.test"
        model.replacePairingIdentity(baseURL: model.backendURL, token: "token-b")
        await transport.resolve(id: importID, json: ipaEnvelope(id: "ipa-from-host-a"))
        _ = await install.value

        let installRequestIDs = await transport.requestIDs(path: "/api/helper/install")
        XCTAssertTrue(installRequestIDs.isEmpty)
        XCTAssertNil(model.lastInstallRequest)
        XCTAssertNil(model.expectedInstallJobId)
    }

    func testAuthorityExpiryBetweenImportAndInstallRevalidatesBeforeMutation() async throws {
        let transport = DeferredHTTPTransport()
        var now = Date(timeIntervalSince1970: 1_750_000_000)
        let model = makeModel(
            api: APIClient(transport: { try await transport.handle($0) }),
            authorityNow: { now },
            authorityTTL: 300
        )
        defer { model.clearPairing() }
        primeAuthority(model, syncedAt: now)
        primeInstallReadiness(model)

        let install = Task { await model.installFromSource(sourceApp()) }
        try await waitUntil { await transport.requestIDs(path: "/api/helper/ipas/import-url").count == 1 }
        let importID = await transport.requestIDs(path: "/api/helper/ipas/import-url").first!
        now = now.addingTimeInterval(301)
        await transport.resolve(id: importID, json: ipaEnvelope(id: "expired-authority-ipa"))

        try await waitUntil { await transport.requestIDs(path: "/api/helper/today").count == 1 }
        let todayID = await transport.requestIDs(path: "/api/helper/today").first!
        await transport.resolve(
            id: todayID,
            status: 401,
            json: #"{"ok":false,"error":"Unauthorized"}"#
        )
        _ = await install.value

        let installRequestIDs = await transport.requestIDs(path: "/api/helper/install")
        XCTAssertTrue(installRequestIDs.isEmpty)
        XCTAssertTrue(model.dailyOperationsAreStale)
    }

    private func makeModel(
        api: APIClient,
        authorityNow: @escaping () -> Date = Date.init,
        authorityTTL: TimeInterval = 5 * 60
    ) -> HelperViewModel {
        let credentialStore = LifecyclePairingCredentialStore()
        UserDefaults.standard.removeObject(forKey: "backendURL")
        UserDefaults.standard.removeObject(forKey: PairingCredentialStorage.baseURLKey)
        UserDefaults.standard.removeObject(forKey: "helperToken")
        UserDefaults.standard.removeObject(forKey: PairingCredentialStorage.revocationTombstonesKey)
        _ = KeychainStore.remove(PairingCredentialStorage.identityKey)
        _ = KeychainStore.remove("helperToken")
        let model = HelperViewModel(
            api: api,
            authorityNow: authorityNow,
            authorityTTL: authorityTTL,
            loadStoredPairingIdentity: credentialStore.load,
            storePairingIdentity: credentialStore.store,
            revokeStoredPairingIdentity: credentialStore.revoke,
            startLongLivedServices: false
        )
        model.clearPairing()
        model.backendURL = "http://127.0.0.1:4010"
        model.replacePairingIdentity(baseURL: model.backendURL, token: "test-token")
        return model
    }

    private func primeAuthority(
        _ model: HelperViewModel,
        headline: String = "Current",
        syncedAt: Date = Date()
    ) {
        model.dailyOperations = decodeTodaySnapshot(headline: headline)
        model.dailyOperationsError = nil
        model.dailyOperationsLastSyncedAt = syncedAt
        model.hostReachable = true
        model.publishCurrentDailyOperationsAuthority(syncedAt: syncedAt)
    }

    private func primeInstallReadiness(_ model: HelperViewModel) {
        let account = AccountDTO(
            id: "account-a",
            appleId: "person@example.com",
            teamId: "TEAM",
            teamName: "Team",
            accountType: "free",
            status: "active",
            lastAuthAt: nil,
            createdAt: nil
        )
        let device = try! JSONDecoder().decode(
            DeviceDTO.self,
            from: Data(#"{"id":"device-a","name":"iPhone","connection":"usb","transport":"usb"}"#.utf8)
        )
        model.accounts = [account]
        model.devices = [device]
        model.setPrimarySigningAccount(account.id, showConfirmation: false)
        model.selectedDeviceUdid = device.id
    }

    private func waitUntil(
        timeoutIterations: Int = 200,
        _ condition: @escaping () async -> Bool
    ) async throws {
        for _ in 0 ..< timeoutIterations {
            if await condition() {
                return
            }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTFail("Timed out waiting for the expected HTTP request")
    }

    private func resolveOperation(
        _ transport: DeferredHTTPTransport,
        jobId: String,
        title: String,
        status: Int
    ) async {
        let detailPath = "/api/helper/jobs/\(jobId)"
        let logPath = "\(detailPath)/logs"
        let detailID = await transport.requestIDs(path: detailPath).last!
        let logID = await transport.requestIDs(path: logPath).last!
        await transport.resolve(id: logID, json: #"{"ok":true,"data":[]}"#)
        if status == 200 {
            await transport.resolve(id: detailID, json: installJobEnvelope(id: jobId, title: title))
        } else {
            await transport.resolve(
                id: detailID,
                status: status,
                json: #"{"ok":false,"error":"Missing"}"#
            )
        }
    }

    private func resolveCoreRefresh(
        _ transport: PairingAwareHTTPTransport,
        token: String,
        statusJSON: String,
        statusCode: Int = 200,
        accountJSON: String
    ) async {
        let statusID = await transport.requestIDs(path: "/api/helper/status", token: token).first!
        let configID = await transport.requestIDs(path: "/api/helper/config", token: token).first!
        let accountID = await transport.requestIDs(path: "/api/helper/accounts", token: token).first!
        let ipaID = await transport.requestIDs(path: "/api/helper/ipas", token: token).first!
        await transport.resolve(id: statusID, status: statusCode, json: statusJSON)
        await transport.resolve(id: configID, json: fullRefreshConfigEnvelope(name: "Old host"))
        await transport.resolve(id: accountID, json: accountJSON)
        await transport.resolve(id: ipaID, json: #"{"ok":true,"data":[]}"#)
    }
}

private func todayEnvelope(headline: String) -> String {
    """
    {"ok":true,"data":\(todaySnapshotJSON(headline: headline))}
    """
}

private func immediateFullRefreshResponse(for request: URLRequest, token: String) -> HTTPOutput {
    let path = request.url?.path ?? ""
    let json: String
    let status: Int
    switch path {
    case "/api/helper/status":
        json = fullRefreshStatus(mode: token)
        status = 200
    case "/api/helper/config":
        json = fullRefreshConfigEnvelope(name: "Host \(token)")
        status = 200
    case "/api/helper/today":
        json = todayEnvelope(headline: "Host \(token)")
        status = 200
    case "/api/helper/accounts",
         "/api/helper/ipas",
         "/api/helper/devices",
         "/api/helper/apps",
         "/api/helper/jobs",
         "/api/helper/sources",
         "/api/helper/trusted-sources",
         "/api/helper/auto-refresh-states",
         "/api/helper/app-ids",
         "/api/helper/app-ids/usage":
        json = #"{"ok":true,"data":[]}"#
        status = 200
    default:
        json = #"{"ok":false,"error":"Not found"}"#
        status = 404
    }
    let response = HTTPURLResponse(
        url: request.url!,
        statusCode: status,
        httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/json"]
    )!
    return (Data(json.utf8), response)
}

private func fullRefreshStatus(mode: String) -> String {
    """
    {
      "ok":true,
      "now":"2026-07-20T12:00:00.000Z",
      "mode":"\(mode)",
      "scheduler":{"running":true,"simulatedNow":"2026-07-20T12:00:00.000Z","autoRefreshThresholdHours":24},
      "installs":[],
      "devices":[],
      "helperArtifact":{"available":true,"message":null}
    }
    """
}

private func fullRefreshConfigEnvelope(name: String) -> String {
    """
    {"ok":true,"data":{
      "serverName":"\(name)",
      "serverVersion":"1.0.0",
      "schedulerEnabled":true,
      "schedulerCheckIntervalMs":60000,
      "sourceFeeds":[]
    }}
    """
}

private func accountListEnvelope(id: String) -> String {
    """
    {"ok":true,"data":[{
      "id":"\(id)",
      "appleId":"old@example.com",
      "teamId":"OLDTEAM",
      "teamName":"Old Team",
      "accountType":"free",
      "status":"active"
    }]}
    """
}

private func ipaEnvelope(id: String) -> String {
    """
    {"ok":true,"data":{
      "id":"\(id)",
      "originalName":"Imported.ipa",
      "bundleName":"Imported",
      "bundleId":"com.example.imported",
      "bundleShortVersion":"1.0",
      "warnings":[]
    }}
    """
}

private func sourceApp() -> SourceAppDTO {
    try! JSONDecoder().decode(
        SourceAppDTO.self,
        from: Data(
            #"{"name":"Source App","bundleIdentifier":"com.example.source","downloadURL":"https://example.com/app.ipa"}"#.utf8
        )
    )
}

private func todaySnapshotJSON(headline: String) -> String {
    """
    {
      "schemaVersion":1,
      "jobCommandPreconditionVersion":1,
      "generatedAt":"2026-07-20T12:00:00.000Z",
      "headline":"\(headline)",
      "summary":"Everything is current.",
      "actions":[],
      "operations":[],
      "expiryPressure":[],
      "expiryHorizonDays":10,
      "quotaPressure":[],
      "quotaAvailability":"available",
      "recentOutcomes":[],
      "fleet":{
        "accounts":{"active":1,"total":1},
        "devices":{"online":1,"detected":1,"paired":1,"managed":1},
        "apps":{"active":1,"total":1},
        "library":{"total":1}
      },
      "readiness":{"status":"ready","issues":[],"helperPairing":"paired"}
    }
    """
}

private func decodeTodaySnapshot(
    headline: String,
    exactJobCommands: Bool = true
) -> DailyOperationsSnapshotDTO {
    struct Envelope: Decodable {
        let data: DailyOperationsSnapshotDTO
    }
    let encoded = todayEnvelope(headline: headline)
    let payload = exactJobCommands
        ? encoded
        : encoded.replacingOccurrences(of: #""jobCommandPreconditionVersion":1,"#, with: "")
    return try! JSONDecoder().decode(
        Envelope.self,
        from: Data(payload.utf8)
    ).data
}

private func installJobEnvelope(id: String, title: String) -> String {
    """
    {"ok":true,"data":\(installJobJSON(id: id, title: title, status: "completed"))}
    """
}

private func installJobJSON(
    id: String,
    title: String,
    status: String,
    revision: Int = 2,
    updatedAt: String = "2026-07-20T12:01:00.000Z"
) -> String {
    """
    {
      "id":"\(id)",
      "title":"\(title)",
      "detail":"Safe operation detail",
      "operation":"install",
      "status":"\(status)",
      "currentStep":null,
      "steps":[],
      "revision":\(revision),
      "createdAt":"2026-07-20T12:00:00.000Z",
      "updatedAt":"\(updatedAt)",
      "eligibleCommands":[]
    }
    """
}

private func installJob(
    id: String,
    title: String,
    status: String,
    revision: Int = 1,
    updatedAt: String = "2026-07-20T12:01:00.000Z"
) -> InstallJobDetailDTO {
    InstallJobDetailDTO(
        id: id,
        title: title,
        detail: "Safe detail",
        operation: "install",
        status: status,
        currentStep: status == "waiting_2fa" ? "sign" : nil,
        steps: [],
        revision: revision,
        createdAt: "2026-07-20T12:00:00.000Z",
        updatedAt: updatedAt,
        eligibleCommands: status == "waiting_2fa" ? ["submit_2fa"] : []
    )
}
