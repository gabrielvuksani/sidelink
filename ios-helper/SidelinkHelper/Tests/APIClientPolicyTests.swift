import Foundation
import XCTest
@testable import SidelinkHelper

final class APIClientPolicyTests: XCTestCase {
    func testForegroundGETRetriesOneTransientFailure() async throws {
        let transport = PolicySequenceTransport(outcomes: [
            .networkError(.networkConnectionLost),
            .response(status: 200),
        ])
        let client = APIClient(transport: { try await transport.handle($0) })

        let (_, response) = try await client.perform(
            request(method: "GET"),
            policy: .foregroundLiveness
        )

        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let attemptCount = await transport.attemptCount()
        XCTAssertEqual(attemptCount, 2)
    }

    func testForegroundGETStopsAfterTwoServiceUnavailableResponses() async throws {
        let transport = PolicySequenceTransport(outcomes: [
            .response(status: 503),
            .response(status: 503),
            .response(status: 200),
        ])
        let client = APIClient(transport: { try await transport.handle($0) })
        let startedAt = Date()

        let (_, response) = try await client.perform(
            request(method: "GET"),
            policy: .foregroundLiveness
        )

        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 503)
        XCTAssertLessThan(Date().timeIntervalSince(startedAt), 1)
        let attemptCount = await transport.attemptCount()
        XCTAssertEqual(attemptCount, 2)
    }

    func testPairPOSTIsNeverReplayed() async throws {
        let transport = PolicySequenceTransport(outcomes: [
            .response(status: 503),
            .response(status: 200),
        ])
        let client = APIClient(transport: { try await transport.handle($0) })

        do {
            _ = try await client.pair(baseURL: "https://host.test", code: "123456")
            XCTFail("Expected pairing to fail")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Unavailable")
        }

        let attemptCount = await transport.attemptCount()
        XCTAssertEqual(attemptCount, 1)
    }

    func testPairDeadlineCancelsUnderlyingTransportAndRequiresFreshCode() async throws {
        let transport = PolicyCancellationTransport()
        let client = APIClient(
            transport: { try await transport.handle($0) },
            foregroundDeadline: 0.05
        )
        let startedAt = Date()

        do {
            _ = try await client.pair(baseURL: "https://host.test", code: "123456")
            XCTFail("Expected pairing deadline")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("fresh pairing code"))
        }

        XCTAssertLessThan(Date().timeIntervalSince(startedAt), 0.5)
        let state = await transport.state()
        XCTAssertEqual(state.attempts, 1)
        XCTAssertEqual(state.cancellations, 1)
    }

    func testResilientPolicyStillAllowsThreeAttempts() async throws {
        let transport = PolicySequenceTransport(outcomes: [
            .response(status: 503),
            .response(status: 503),
            .response(status: 503),
            .response(status: 200),
        ])
        let client = APIClient(transport: { try await transport.handle($0) })

        let (_, response) = try await client.perform(request(method: "GET"))

        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 503)
        let attemptCount = await transport.attemptCount()
        XCTAssertEqual(attemptCount, 3)
    }

    func testJobCommandsSendTheExactRenderedReceiptVersion() async throws {
        let transport = CommandCaptureTransport(
            status: 200,
            json: #"{"ok":true}"#
        )
        let client = APIClient(transport: { await transport.handle($0) })

        try await client.cancelInstallJob(
            baseURL: "https://host.test",
            token: "token",
            jobId: "job-a",
            expectedRevision: 7,
            expectedUpdatedAt: "2026-07-21T12:00:00.000Z"
        )
        try await client.submitInstallJob2FA(
            baseURL: "https://host.test",
            token: "token",
            jobId: "job-b",
            code: "123456",
            expectedRevision: 8,
            expectedUpdatedAt: "2026-07-21T12:01:00.000Z"
        )

        let requests = await transport.requests()
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].path, "/api/helper/jobs/job-a/commands/cancel")
        XCTAssertEqual(requests[0].jsonBody?["expectedRevision"] as? Int, 7)
        XCTAssertEqual(
            requests[0].jsonBody?["expectedUpdatedAt"] as? String,
            "2026-07-21T12:00:00.000Z"
        )
        XCTAssertEqual(requests[1].path, "/api/helper/jobs/job-b/commands/2fa")
        XCTAssertEqual(requests[1].jsonBody?["code"] as? String, "123456")
        XCTAssertEqual(requests[1].jsonBody?["expectedRevision"] as? Int, 8)
    }

    func testJobVersionMismatchRemainsMachineReadable() async throws {
        let transport = CommandCaptureTransport(
            status: 409,
            json: #"{"ok":false,"code":"JOB_VERSION_MISMATCH","error":"Receipt changed"}"#
        )
        let client = APIClient(transport: { await transport.handle($0) })

        do {
            try await client.cancelInstallJob(
                baseURL: "https://host.test",
                token: "token",
                jobId: "job-a",
                expectedRevision: 7,
                expectedUpdatedAt: "2026-07-21T12:00:00.000Z"
            )
            XCTFail("Expected stale receipt rejection")
        } catch HelperAPIError.commandRejected(let status, let code, let message) {
            XCTAssertEqual(status, 409)
            XCTAssertEqual(code, "JOB_VERSION_MISMATCH")
            XCTAssertEqual(message, "Receipt changed")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testJobCommandsRequireADecodedPositiveAcknowledgement() async throws {
        let transport = CommandCaptureTransport(status: 200, json: #"{}"#)
        let client = APIClient(transport: { await transport.handle($0) })

        do {
            try await client.cancelInstallJob(
                baseURL: "https://host.test",
                token: "token",
                jobId: "job-a",
                expectedRevision: 7,
                expectedUpdatedAt: "2026-07-21T12:00:00.000Z"
            )
            XCTFail("Expected cancellation acknowledgement failure")
        } catch HelperAPIError.server(let message) {
            XCTAssertTrue(message.contains("did not confirm"))
        } catch {
            XCTFail("Unexpected cancellation error: \(error)")
        }

        do {
            try await client.submitInstallJob2FA(
                baseURL: "https://host.test",
                token: "token",
                jobId: "job-b",
                code: "123456",
                expectedRevision: 8,
                expectedUpdatedAt: "2026-07-21T12:01:00.000Z"
            )
            XCTFail("Expected verification acknowledgement failure")
        } catch HelperAPIError.server(let message) {
            XCTAssertTrue(message.contains("did not confirm"))
        } catch {
            XCTFail("Unexpected verification error: \(error)")
        }
    }

    private func request(method: String) -> URLRequest {
        var request = URLRequest(url: URL(string: "https://host.test/api/helper/jobs")!)
        request.httpMethod = method
        return request
    }
}

private struct CommandRecordedRequest: Sendable {
    let path: String
    let body: Data?

    var jsonBody: [String: Any]? {
        guard let body else { return nil }
        return try? JSONSerialization.jsonObject(with: body) as? [String: Any]
    }
}

private actor CommandCaptureTransport {
    private let status: Int
    private let json: String
    private var captured: [CommandRecordedRequest] = []

    init(status: Int, json: String) {
        self.status = status
        self.json = json
    }

    func handle(_ request: URLRequest) -> (Data, URLResponse) {
        captured.append(CommandRecordedRequest(
            path: request.url?.path ?? "",
            body: request.httpBody
        ))
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (Data(json.utf8), response)
    }

    func requests() -> [CommandRecordedRequest] {
        captured
    }
}

private actor PolicySequenceTransport {
    enum Outcome: Sendable {
        case networkError(URLError.Code)
        case response(status: Int)
    }

    private var outcomes: [Outcome]
    private var attempts = 0

    init(outcomes: [Outcome]) {
        self.outcomes = outcomes
    }

    func handle(_ request: URLRequest) throws -> (Data, URLResponse) {
        attempts += 1
        let outcome = outcomes.isEmpty ? .response(status: 500) : outcomes.removeFirst()
        switch outcome {
        case .networkError(let code):
            throw URLError(code)
        case .response(let status):
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            let body = status == 200
                ? #"{"ok":true,"data":{}}"#
                : #"{"ok":false,"error":"Unavailable"}"#
            return (Data(body.utf8), response)
        }
    }

    func attemptCount() -> Int {
        attempts
    }
}

private actor PolicyCancellationTransport {
    private var attempts = 0
    private var cancellations = 0

    func handle(_ request: URLRequest) async throws -> (Data, URLResponse) {
        attempts += 1
        do {
            try await Task.sleep(nanoseconds: .max)
            throw URLError(.unknown)
        } catch {
            if Task.isCancelled {
                cancellations += 1
            }
            throw error
        }
    }

    func state() -> (attempts: Int, cancellations: Int) {
        (attempts, cancellations)
    }
}
