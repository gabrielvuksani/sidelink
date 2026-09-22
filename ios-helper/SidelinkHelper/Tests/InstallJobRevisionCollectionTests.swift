import XCTest
@testable import SidelinkHelper

final class InstallJobRevisionCollectionTests: XCTestCase {
    func testLowerRevisionCannotRegressTerminalJobWhileAnotherJobAdvances() {
        let terminalA = job(
            id: "job-a",
            status: "completed",
            revision: 8,
            updatedAt: "2026-07-20T12:08:00.000Z"
        )
        let staleA = job(
            id: "job-a",
            status: "running",
            revision: 7,
            updatedAt: "2026-07-20T12:09:00.000Z"
        )
        let currentB = job(
            id: "job-b",
            status: "waiting_2fa",
            revision: 4,
            updatedAt: "2026-07-20T12:10:00.000Z"
        )

        let result = InstallJobRevisionCollection.merging(
            current: [terminalA.id: terminalA],
            incoming: [staleA, currentB]
        )

        XCTAssertEqual(result["job-a"]?.status, "completed")
        XCTAssertEqual(result["job-a"]?.revision, 8)
        XCTAssertEqual(result["job-b"]?.status, "waiting_2fa")
        XCTAssertEqual(result["job-b"]?.revision, 4)
    }

    func testActivityProjectionPartitionsEveryReceiptAndOrdersActionableWorkFirst() {
        let jobs = [
            job(id: "completed-old", status: "completed", revision: 2, updatedAt: "2026-07-20T12:01:00.000Z"),
            job(id: "queued", status: "queued", revision: 1, updatedAt: "2026-07-20T12:04:00.000Z"),
            job(id: "failed", status: "failed", revision: 3, updatedAt: "2026-07-20T12:03:00.000Z"),
            job(id: "running", status: "running", revision: 4, updatedAt: "2026-07-20T12:02:00.000Z"),
            job(id: "waiting", status: "waiting_2fa", revision: 5, updatedAt: "2026-07-20T12:05:00.000Z"),
            job(id: "completed-new", status: "completed", revision: 6, updatedAt: "2026-07-20T12:06:00.000Z"),
            job(id: "future-old", status: "paused_by_host", revision: 7, updatedAt: "2026-07-20T12:07:00.000Z"),
            job(id: "future-new", status: "awaiting_policy", revision: 8, updatedAt: "2026-07-20T12:08:00.000Z"),
        ]

        let projection = OperationActivityProjection.make(from: jobs)

        XCTAssertEqual(projection.attention.map(\.id), ["waiting", "failed"])
        XCTAssertEqual(projection.active.map(\.id), ["queued", "running"])
        XCTAssertEqual(projection.recent.map(\.id), ["completed-new", "completed-old"])
        XCTAssertEqual(projection.needsReview.map(\.id), ["future-new", "future-old"])
        let partitioned = projection.attention
            + projection.active
            + projection.recent
            + projection.needsReview
        XCTAssertEqual(partitioned.count, jobs.count)
        XCTAssertEqual(
            Set(partitioned.map(\.id)),
            Set(jobs.map(\.id))
        )
    }

    func testBoundedActivityMergeRetainsActionableReceiptAheadOfNewerHistory() {
        let waiting = job(
            id: "waiting-old",
            status: "waiting_2fa",
            revision: 1,
            updatedAt: "2026-07-20T12:01:00.000Z"
        )
        let completedNew = job(
            id: "completed-new",
            status: "completed",
            revision: 4,
            updatedAt: "2026-07-20T12:04:00.000Z"
        )
        let completedNewest = job(
            id: "completed-newest",
            status: "completed",
            revision: 5,
            updatedAt: "2026-07-20T12:05:00.000Z"
        )

        let result = InstallJobRevisionCollection.boundedMerging(
            current: [waiting.id: waiting, completedNew.id: completedNew],
            incoming: [completedNewest],
            limit: 2
        )

        XCTAssertEqual(Set(result.keys), Set([waiting.id, completedNewest.id]))
    }

    func testFallbackFingerprintChangesWhenUnversionedReceiptContentChanges() {
        let original = InstallJobDetailDTO(
            id: "unversioned",
            title: "Original",
            detail: "Safe detail",
            operation: "install",
            status: "running",
            currentStep: "sign",
            steps: [],
            revision: nil,
            createdAt: "2026-07-20T12:00:00.000Z",
            updatedAt: "",
            eligibleCommands: ["cancel"]
        )
        let changed = InstallJobDetailDTO(
            id: original.id,
            title: "Changed",
            detail: original.detail,
            operation: original.operation,
            status: original.status,
            currentStep: original.currentStep,
            steps: original.steps,
            revision: nil,
            createdAt: original.createdAt,
            updatedAt: original.updatedAt,
            eligibleCommands: original.eligibleCommands
        )

        XCTAssertNotEqual(
            InstallJobVersionFingerprint(job: original),
            InstallJobVersionFingerprint(job: changed)
        )
    }

    private func job(
        id: String,
        status: String,
        revision: Int,
        updatedAt: String
    ) -> InstallJobDetailDTO {
        InstallJobDetailDTO(
            id: id,
            title: "Install Demo",
            detail: "Operation detail",
            operation: "install",
            status: status,
            currentStep: status == "completed" ? nil : "install",
            steps: [],
            revision: revision,
            createdAt: "2026-07-20T12:00:00.000Z",
            updatedAt: updatedAt,
            eligibleCommands: []
        )
    }
}

final class InstallJobLogOrderingTests: XCTestCase {
    func testSameMillisecondLogsUseDurableSequenceInsteadOfIdentifierText() {
        let at = "2026-07-20T12:00:00.000Z"
        let first = InstallJobLogDTO(
            id: "z-first", jobId: "job", sequence: 1, step: nil,
            level: "info", message: "first", at: at
        )
        let second = InstallJobLogDTO(
            id: "a-second", jobId: "job", sequence: 2, step: nil,
            level: "info", message: "second", at: at
        )

        XCTAssertEqual(
            InstallJobLogOrdering.merge(
                persisted: [second], live: [first], jobId: "job", limit: 10
            ).map(\.id),
            ["z-first", "a-second"]
        )
    }
}
