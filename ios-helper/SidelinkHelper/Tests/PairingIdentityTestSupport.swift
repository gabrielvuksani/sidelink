import Foundation
import UserNotifications
@testable import SidelinkHelper

typealias TestHTTPOutput = (Data, URLResponse)

struct LifecycleRecordedRequest: Sendable {
    let id: Int
    let method: String
    let url: URL
    let token: String?
    let body: Data?

    var host: String { url.host ?? "" }
    var path: String { url.path }
}

struct LifecycleSSEConnection {
    let id: UUID
    let url: URL
    let headers: [String: String]
}

@MainActor
final class LifecyclePairingCredentialStore {
    private(set) var identity: PairingCredentialStorage.StoredIdentity?
    var failsWrites = false
    var failsClears = false

    init(identity: PairingCredentialStorage.StoredIdentity? = nil) {
        self.identity = identity
    }

    func load() -> PairingCredentialStorage.StoredIdentity? {
        identity
    }

    func store(baseURL: String, token: String) -> PairingCredentialStorage.StoredIdentity? {
        guard !failsWrites else { return nil }
        let stored = PairingCredentialStorage.StoredIdentity(
            id: UUID().uuidString,
            baseURL: baseURL,
            token: token
        )
        identity = stored
        return stored
    }

    func clear() -> Bool {
        guard !failsClears else { return false }
        identity = nil
        return true
    }

    func revoke(_ expectedIdentity: PairingCredentialStorage.StoredIdentity) -> Bool {
        PairingCredentialStorage.markRevoked(identityID: expectedIdentity.id)
        guard identity == expectedIdentity else { return true }
        return clear()
    }
}

actor LifecycleDeferredHTTPTransport {
    private var nextID = 0
    private var requests: [LifecycleRecordedRequest] = []
    private var continuations: [Int: CheckedContinuation<TestHTTPOutput, Error>] = [:]

    func handle(_ request: URLRequest) async throws -> TestHTTPOutput {
        guard let url = request.url else {
            throw URLError(.badURL)
        }
        let id = nextID
        nextID += 1
        requests.append(
            LifecycleRecordedRequest(
                id: id,
                method: request.httpMethod ?? "GET",
                url: url,
                token: request.value(forHTTPHeaderField: "x-sidelink-helper-token"),
                body: request.httpBody
            )
        )
        return try await withCheckedThrowingContinuation { continuation in
            continuations[id] = continuation
        }
    }

    func requestIDs(path: String, method: String? = nil) -> [Int] {
        requests.filter {
            $0.path == path && (method == nil || $0.method == method)
        }.map(\.id)
    }

    func request(id: Int) -> LifecycleRecordedRequest? {
        requests.first(where: { $0.id == id })
    }

    func requestCount(path: String? = nil) -> Int {
        guard let path else { return requests.count }
        return requests.filter { $0.path == path }.count
    }

    @discardableResult
    func resolve(id: Int, status: Int = 200, json: String) -> Bool {
        guard let continuation = continuations.removeValue(forKey: id),
              let request = requests.first(where: { $0.id == id })
        else {
            return false
        }
        let response = HTTPURLResponse(
            url: request.url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        continuation.resume(returning: (Data(json.utf8), response))
        return true
    }
}

actor LifecyclePairingResultProbe {
    private var result: Bool?

    func record(_ result: Bool) {
        self.result = result
    }

    func value() -> Bool? {
        result
    }
}

actor LifecyclePairingTimeoutTransport {
    private var requests: [LifecycleRecordedRequest] = []

    func handle(_ request: URLRequest) async throws -> TestHTTPOutput {
        guard let url = request.url else {
            throw URLError(.badURL)
        }
        requests.append(
            LifecycleRecordedRequest(
                id: requests.count,
                method: request.httpMethod ?? "GET",
                url: url,
                token: request.value(forHTTPHeaderField: "x-sidelink-helper-token"),
                body: request.httpBody
            )
        )
        try await Task.sleep(nanoseconds: .max)
        throw URLError(.unknown)
    }

    func requestCount(path: String? = nil, method: String? = nil) -> Int {
        requests.filter {
            (path == nil || $0.path == path) && (method == nil || $0.method == method)
        }.count
    }
}

final class LifecycleSSEStream: SSEStreaming, @unchecked Sendable {
    var onEvent: (@Sendable (UUID, String, String) -> Void)?
    var onFailure: (@Sendable (UUID, Error) -> Void)?

    private let lock = NSLock()
    private var connections: [LifecycleSSEConnection] = []

    @discardableResult
    func connect(url: URL, headers: [String: String]) -> UUID {
        let id = UUID()
        lock.lock()
        connections.append(LifecycleSSEConnection(id: id, url: url, headers: headers))
        lock.unlock()
        return id
    }

    func disconnect() {}

    func connectionIDs() -> [UUID] {
        lock.lock()
        defer { lock.unlock() }
        return connections.map(\.id)
    }

    func connection(id: UUID) -> LifecycleSSEConnection? {
        lock.lock()
        defer { lock.unlock() }
        return connections.first(where: { $0.id == id })
    }

    func emitEvent(connectionID: UUID, event: String, data: String) {
        onEvent?(connectionID, event, data)
    }

    func emitFailure(connectionID: UUID, error: Error = URLError(.networkConnectionLost)) {
        onFailure?(connectionID, error)
    }
}

actor LifecycleBackgroundNotificationCenter: BackgroundRefreshNotificationCenter {
    private let defersAdds: Bool
    private var added: [String] = []
    private var pendingRemovals: [[String]] = []
    private var deliveredRemovals: [[String]] = []
    private var addContinuations: [CheckedContinuation<Void, Error>] = []

    init(defersAdds: Bool = false) {
        self.defersAdds = defersAdds
    }

    func requestAuthorizationIfNeeded() async {}

    func add(_ request: UNNotificationRequest) async throws {
        added.append(request.identifier)
        guard defersAdds else { return }
        try await withCheckedThrowingContinuation { continuation in
            addContinuations.append(continuation)
        }
    }

    func removePendingNotificationRequests(withIdentifiers identifiers: [String]) async {
        pendingRemovals.append(identifiers)
    }

    func removeDeliveredNotifications(withIdentifiers identifiers: [String]) async {
        deliveredRemovals.append(identifiers)
    }

    func addedIdentifiers() -> [String] {
        added
    }

    func pendingRemovalIdentifiers() -> [String] {
        pendingRemovals.flatMap { $0 }
    }

    func deliveredRemovalIdentifiers() -> [String] {
        deliveredRemovals.flatMap { $0 }
    }

    func resumeNextAdd() {
        guard !addContinuations.isEmpty else { return }
        addContinuations.removeFirst().resume(returning: ())
    }
}

actor LifecycleDeferredSleeper {
    private var continuations: [CheckedContinuation<Void, Never>] = []
    private var invocations = 0

    func sleep() async {
        invocations += 1
        await withCheckedContinuation { continuation in
            continuations.append(continuation)
        }
    }

    func invocationCount() -> Int {
        invocations
    }

    func resumeNext() {
        guard !continuations.isEmpty else { return }
        continuations.removeFirst().resume()
    }
}
